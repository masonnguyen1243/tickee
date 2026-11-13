import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ErrorCode, OrderStatus } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import type { WorkerConfig } from '../../platform/config/index.js';
import { parseCredentialKeys, SecretBox, SecretBoxError } from '../../platform/crypto/index.js';
import { DATABASE, dbClock, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS, errorName, JOB_COMPLETED, registerQueueWorker } from '../../platform/jobs/index.js';
import {
  orderForReconciliation,
  RECONCILE_AFTER_EXPIRY_MS,
  RECONCILE_MAX_FAILURES,
  RECONCILE_ORDER_QUEUE,
  scheduleNextReconciliation,
  scheduleReconciliationRetry,
  type OrderForReconciliation,
  type ReconcileOrderPayload,
} from '../ordering/index.js';
import { payoutCredentialOf } from '../organizer/index.js';
import { TINGEE_CLIENT, type TingeeClient, type TingeeCredential, type TingeeDomainError } from '../tingee/index.js';
import { IPN_EXPIRING_STATUSES, IPN_SUCCESS_STATUS, IpnProcessor, TingeeIpn, type IpnBranch } from './ipn-processor.js';

/*
 * Đối soát bù (Story 4.1, FR-20, AD-8), vai worker: job `payment.reconcile-order` (queue và lịch ở `ordering`) tra trạng
 * thái đơn Gateway của một Đơn theo `orderId` (mã Đơn) bằng credential chụp ở `orders.payout_account_id` (kể cả
 * credential đã gỡ mềm), rồi đưa kết quả vào đúng `IpnProcessor.process` với nguồn `reconciliation`: cùng whitelist
 * (`TingeeIpn`), cùng khóa unique `payment_events`, cùng thứ tự kiểm AD-7, cùng cách tạo mục Cần xử lý.
 *
 * - `success` → `markPaid` nguồn `reconciliation` (Đơn `pending`/`expired` đi bước 3–7 như IPN; Đơn đã rời hai trạng
 *   thái đó → `already_settled`).
 * - `expired`/`canceled` → hết hạn Đơn còn `pending` (nhả chỗ), như IPN trạng thái.
 * - `pending` ("chưa trả, link còn") → không lưu gì.
 * Tra được thì enqueue mốc kế (hoặc dừng: hết mốc, Đơn không còn chờ tiền). Đơn đã `expired` (vd. IPN `expired` tới
 * trước `expires_at`) mà job của một mốc `pending` còn lại chạy → không gọi Tingee, chỉ hẹn mốc `expires_at` + 30 phút.
 * Tra lỗi (Tingee tạm lỗi, timeout, mã lạ, không
 * tìm thấy đơn, `MERCHANT_SUSPENDED`, kết quả sai dạng, trạng thái lạ) → tra lại cùng mốc sau 1, 2, 4 phút; lỗi lần thứ
 * 4 liên tiếp → dừng chuỗi, log `error` có `alert: 'payment_reconciliation_stopped'`. Key sai (`TINGEE_CREDENTIAL_INVALID`,
 * kể cả credential cũ đã gỡ) → dừng ngay, lý do `credential_invalid`; không đụng trạng thái dịch vụ thanh toán của BTC
 * (Đơn hết hạn theo job (c)). Không đọc được credential → dừng, lý do `credential_unreadable`.
 *
 * Gọi Tingee ngoài transaction, có timeout (adapter). Credential giải mã ngay trước lời gọi, không bao giờ log hay vào
 * payload job. Worker tra tuần tự (mặc định của `registerQueueWorker`).
 */

/** Marker log của cảnh báo vận hành khi chuỗi Đối soát bù của một Đơn dừng (Story 4.6 nối kênh cảnh báo theo marker). */
export const PAYMENT_RECONCILIATION_STOPPED_ALERT = 'payment_reconciliation_stopped';

/** Trạng thái đơn Gateway "chưa trả, link còn" (hợp đồng tạm của API tra đơn). */
export const GATEWAY_PENDING_STATUS = 'pending';

/** Lý do dừng chuỗi kèm cảnh báo: lỗi liên tiếp quá trần, key sai, không đọc được credential. */
export type ReconciliationStopReason = 'failed' | 'credential_invalid' | 'credential_unreadable';

/**
 * Lý do một lần tra lỗi (tra lại cùng mốc): lỗi miền của Tingee (trừ key sai), Tingee không tìm thấy đơn, kết quả không
 * qua whitelist IPN (hoặc là đơn khác), trạng thái lạ, lỗi không rõ của adapter.
 */
export type ReconciliationError =
  | Exclude<TingeeDomainError, typeof ErrorCode.TINGEE_CREDENTIAL_INVALID>
  | 'order_not_found'
  | 'invalid_result'
  | 'unknown_status'
  | 'unexpected_error';

/** Kết quả một job tra (cho log và test). */
export type ReconcileOutcome =
  /** Cờ `TINGEE_ORDER_STATUS_QUERY` tắt: không gọi Tingee, không enqueue mốc kế. */
  | { result: 'disabled' }
  /** Không gọi Tingee, dừng chuỗi: không có Đơn, hoặc Đơn không còn `pending`/`expired`. */
  | { result: 'skipped'; reason: 'order_not_found' | 'not_open' }
  /**
   * Không gọi Tingee: Đơn đã `expired` trước mốc sau hết hạn đầu tiên (job của mốc `pending` còn lại); đã hẹn `next`
   * (`expires_at` + 30 phút).
   */
  | { result: 'skipped'; reason: 'before_post_expiry'; next: Date | null }
  /** Tra được: `branch` của đường xử lý IPN (`null` khi đơn Gateway còn mở: không lưu gì); `next` = mốc kế hoặc `null`. */
  | { result: 'checked'; gatewayStatus: string; branch: IpnBranch | null; next: Date | null }
  /** Tra lỗi lần thứ `failures` (< trần): đã enqueue tra lại cùng mốc lúc `retryAt`. */
  | { result: 'retry'; error: ReconciliationError; failures: number; retryAt: Date }
  /** Dừng chuỗi kèm cảnh báo vận hành. */
  | { result: 'stopped'; reason: ReconciliationStopReason; error: ReconciliationError | null };

/** Token DI của cấu hình Đối soát bù. */
export const RECONCILIATION_SETTINGS = Symbol('RECONCILIATION_SETTINGS');

export interface ReconciliationSettings {
  /** Giải mã Secret Token Tingee của BTC (khóa `TINGEE_CREDENTIAL_KEYS`). */
  secretBox: SecretBox;
  /** Cờ `TINGEE_ORDER_STATUS_QUERY`: tắt thì job tra xong ngay, không gọi Tingee. */
  orderStatusQuery: boolean;
}

/** Cấu hình Đối soát bù từ env đã kiểm của vai worker. */
export type ReconciliationConfig = Pick<WorkerConfig, 'TINGEE_CREDENTIAL_KEYS' | 'TINGEE_ORDER_STATUS_QUERY'>;

export function reconciliationSettings(config: ReconciliationConfig): ReconciliationSettings {
  return {
    secretBox: new SecretBox(parseCredentialKeys(config.TINGEE_CREDENTIAL_KEYS)),
    orderStatusQuery: config.TINGEE_ORDER_STATUS_QUERY,
  };
}

/** Lỗi miền của Tingee coi là lỗi tạm (tra lại cùng mốc). */
const RETRYABLE_TINGEE_ERRORS: ReadonlySet<string> = new Set<ReconciliationError>([
  ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
  ErrorCode.MERCHANT_SUSPENDED,
  ErrorCode.PAYMENT_ACCOUNT_NOT_ALLOWED,
]);

/** Kết quả một lời gọi tra: kết quả đã qua whitelist IPN, hoặc lỗi. */
type Lookup =
  | { ok: true; ipn: TingeeIpn }
  | { ok: false; stop: true; reason: 'credential_invalid' }
  | { ok: false; stop: false; error: ReconciliationError };

@Injectable()
export class ReconciliationWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('ReconciliationWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
    @Inject(IpnProcessor) private readonly processor: IpnProcessor,
    @Inject(RECONCILIATION_SETTINGS) private readonly settings: ReconciliationSettings,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerQueueWorker(this.boss, RECONCILE_ORDER_QUEUE, {
      logger: this.logger,
      label: 'Đối soát bù',
      logContext: ({ orderId, failures }) => ({ orderId, failures }),
      handle: async (payload, job) => {
        await this.reconcile(payload, job.id);
        return JOB_COMPLETED;
      },
    });
  }

  /**
   * Một job tra `{ orderId, failures }` (id job `jobId`: gốc của id lần tra lại). Lỗi DB (đọc Đơn, xử lý kết quả, enqueue)
   * → ném: pg-boss retry cả job (gọi Tingee lại: chỉ đọc; xử lý lại: `payment_events` chống lặp; id job kế cố định).
   */
  async reconcile({ orderId, failures }: ReconcileOrderPayload, jobId: string): Promise<ReconcileOutcome> {
    if (!this.settings.orderStatusQuery) return { result: 'disabled' };

    const order = await orderForReconciliation(this.db.orm, orderId);
    if (!order) {
      this.logger.warn({ orderId }, 'Đối soát bù: không có Đơn; dừng');
      return { result: 'skipped', reason: 'order_not_found' };
    }
    const context = { organizationId: order.organizationId, orderCode: order.code };
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.EXPIRED) {
      // IPN (hay một lần tra trước) đã chốt Đơn: không gọi Tingee.
      this.logger.log({ ...context, status: order.status }, 'Đối soát bù: Đơn không còn chờ tiền; dừng');
      return { result: 'skipped', reason: 'not_open' };
    }
    if (order.status === OrderStatus.EXPIRED) {
      // Đơn `expired` chỉ còn các mốc sau hết hạn: job của mốc `pending` còn lại (Đơn hết hạn sớm) bỏ, không gọi Tingee.
      const firstAfterExpiry = order.expiresAt.getTime() + RECONCILE_AFTER_EXPIRY_MS[0];
      if ((await dbClock(this.db.orm)).getTime() < firstAfterExpiry) {
        const next = await scheduleNextReconciliation(this.boss, this.db, orderId);
        this.logger.log(
          { ...context, nextCheckAt: next?.toISOString() ?? null },
          'Đối soát bù: Đơn đã hết hạn; bỏ các mốc chờ tiền còn lại, hẹn mốc sau hết hạn',
        );
        return { result: 'skipped', reason: 'before_post_expiry', next };
      }
    }

    const credential = await this.credentialOf(order);
    if (!credential) return this.stop(context, 'credential_unreadable', null, failures);

    const lookup = await this.lookup(credential, context);
    if (!lookup.ok) {
      if (lookup.stop) return this.stop(context, lookup.reason, null, failures);
      return this.fail(context, { jobId, orderId, failures: failures + 1 }, lookup.error);
    }

    const { ipn } = lookup;
    let branch: IpnBranch | null = null;
    if (ipn.status === IPN_SUCCESS_STATUS || IPN_EXPIRING_STATUSES.has(ipn.status)) {
      branch = (await this.processor.process(order.organizationId, ipn, 'reconciliation')).branch;
    } else if (ipn.status !== GATEWAY_PENDING_STATUS) {
      return this.fail(context, { jobId, orderId, failures: failures + 1 }, 'unknown_status');
    }
    const next = await scheduleNextReconciliation(this.boss, this.db, orderId);
    this.logger.log(
      { ...context, gatewayStatus: ipn.status, branch, nextCheckAt: next?.toISOString() ?? null },
      next ? 'Đối soát bù: đã tra; hẹn mốc kế' : 'Đối soát bù: đã tra; hết mốc hoặc Đơn đã chốt, dừng',
    );
    return { result: 'checked', gatewayStatus: ipn.status, branch, next };
  }

  /**
   * Credential đã chụp của Đơn (giải mã ngay trước lời gọi). Đơn thiếu `payout_account_id`, tài khoản không thuộc BTC,
   * hay giải mã lỗi (`SecretBoxError`: ciphertext hỏng, thiếu khóa) → `null`, chỉ log tên lớp lỗi. Lỗi khác (DB) → ném:
   * pg-boss retry cả job, không dừng chuỗi.
   */
  private async credentialOf(order: OrderForReconciliation): Promise<TingeeCredential | null> {
    if (!order.payoutAccountId) return null;
    try {
      return await payoutCredentialOf(this.db.orm, this.settings.secretBox, {
        organizationId: order.organizationId,
        payoutAccountId: order.payoutAccountId,
      });
    } catch (err) {
      if (!(err instanceof SecretBoxError)) throw err;
      this.logger.warn(
        { organizationId: order.organizationId, orderCode: order.code, error: errorName(err) },
        'Đối soát bù: không giải mã được credential của Đơn',
      );
      return null;
    }
  }

  /** Gọi Tingee (ngoài transaction) rồi đưa kết quả qua whitelist IPN; kết quả phải là đơn của chính Đơn này. */
  private async lookup(
    credential: TingeeCredential,
    context: { organizationId: string; orderCode: string },
  ): Promise<Lookup> {
    const orderCode = context.orderCode;
    let raw: unknown;
    try {
      raw = await this.tingee.getGatewayOrder(credential, orderCode);
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.TINGEE_CREDENTIAL_INVALID) {
        return { ok: false, stop: true, reason: 'credential_invalid' };
      }
      if (err instanceof AppError && RETRYABLE_TINGEE_ERRORS.has(err.code)) {
        return { ok: false, stop: false, error: err.code as ReconciliationError };
      }
      // Giữ nguyên nhân gốc trước khi gộp thành `unexpected_error` (log lần tra lại/dừng chỉ có nhãn đó). Không credential,
      // không body.
      this.logger.warn(
        { ...context, error: errorName(err), errorCode: err instanceof AppError ? err.code : undefined },
        'Đối soát bù: lỗi không rõ khi tra Tingee',
      );
      return { ok: false, stop: false, error: 'unexpected_error' };
    }
    if (raw === null) return { ok: false, stop: false, error: 'order_not_found' };
    const parsed = TingeeIpn.safeParse(raw);
    if (!parsed.success || parsed.data.orderId !== orderCode) return { ok: false, stop: false, error: 'invalid_result' };
    return { ok: true, ipn: parsed.data };
  }

  /** Tra lỗi lần thứ `failures`: dưới trần thì enqueue tra lại cùng mốc; tới trần thì dừng kèm cảnh báo. */
  private async fail(
    context: { organizationId: string; orderCode: string },
    input: { jobId: string; orderId: string; failures: number },
    error: ReconciliationError,
  ): Promise<ReconcileOutcome> {
    if (input.failures >= RECONCILE_MAX_FAILURES) return this.stop(context, 'failed', error, input.failures);
    const retryAt = await scheduleReconciliationRetry(this.boss, this.db, {
      parentJobId: input.jobId,
      orderId: input.orderId,
      failures: input.failures,
    });
    this.logger.warn(
      { ...context, error, failures: input.failures, retryAt: retryAt.toISOString() },
      'Đối soát bù: tra lỗi; tra lại cùng mốc',
    );
    return { result: 'retry', error, failures: input.failures, retryAt };
  }

  /** Dừng chuỗi: log `error` có marker cảnh báo vận hành, mã Đơn và lý do. Không enqueue gì. */
  private stop(
    context: { organizationId: string; orderCode: string },
    reason: ReconciliationStopReason,
    error: ReconciliationError | null,
    failures: number,
  ): ReconcileOutcome {
    this.logger.error(
      { ...context, alert: PAYMENT_RECONCILIATION_STOPPED_ALERT, reason, error: error ?? undefined, failures },
      'Đối soát bù dừng cho Đơn này; cần vận hành kiểm tra',
    );
    return { result: 'stopped', reason, error };
  }
}
