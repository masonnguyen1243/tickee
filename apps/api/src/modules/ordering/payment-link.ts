import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  OrderStatus,
  orderPath,
  PAYMENT_LINK_GRACE_SECONDS,
  PAYMENT_LINK_MINUTES,
  PaymentLinkError,
  type EventSaleReason,
} from '@tickee/contracts';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { parseCredentialKeys, SecretBox } from '../../platform/crypto/index.js';
import { DATABASE, dbNow, type Database } from '../../platform/db/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import {
  defaultPayoutTargetOf,
  suspendPaymentService,
  type PaymentServiceSuspension,
  type PayoutTarget,
  type SuspensionInput,
} from '../organizer/index.js';
import { CreateLinkError, TINGEE_CLIENT, type TingeeClient } from '../tingee/index.js';
import { releaseOrderHeld } from './inventory.service.js';
import { notifyOrderChanged, orderSignalColumns } from './order-changed.js';
import { enqueueOrderExpiry, OrderQueues } from './order-jobs.js';
import { enqueueReconciliation, firstCheckAt } from './reconciliation-jobs.js';
import { orders } from './schema.js';
import { paymentLinkBlock } from './sellability.js';

/*
 * Bảo đảm link thanh toán Gateway cho một Đơn có phí (Story 3.4, AD-4, AD-5, AD-6). Một hàm cho hai điểm vào: tạo Đơn
 * (`POST /v1/events/:slug/orders`, kể cả gửi lại cùng khóa) và thử lại (`POST /v1/me/orders/:code/payment-link`).
 *
 * Một lần gọi tại một thời điểm: trước khi gọi Tingee, CAS giành "lượt" (`payment_link_attempt_at`) với điều kiện Đơn
 * `pending`, chưa có link, còn lượt và còn hạn (TX1 đặt sẵn lượt cho lần gọi đầu). Chỉ kết quả rõ ràng mới trả lượt;
 * lượt không được trả (kết quả mơ hồ, process chết giữa chừng) thì không bao giờ gọi lại cùng `orderId`.
 *
 * Chốt link (E3-2): đang giữ lượt, trước khi đọc nơi nhận tiền và gọi Tingee, hỏi `sellability` (`paymentLinkBlock`,
 * đồng hồ DB): Sự kiện hủy, Sự kiện hoặc BTC bị khóa, đã kết thúc, Ẩn, hoặc BTC không còn đủ điều kiện bán Vé có phí →
 * log cảnh báo kèm lý do rồi hết hạn Đơn như nhóm tạm ngừng dưới đây (`sales_paused`), không gọi Tingee. Mọi đường
 * (lần gọi đầu sau TX1, gửi lại cùng khóa, "Thử lại") đều qua chốt này.
 *
 * Gọi Tingee NGOÀI transaction (timeout 5 giây). Kết quả:
 * - ok → TX2: CAS gắn link (`WHERE status = 'pending' AND payment_link IS NULL`), chụp `payout_account_id`, `expires_at`
 *   = lượt + 15 phút, enqueue job (c) và job Đối soát bù đầu tiên (Story 4.1) bằng chính `tx`. 0 dòng (job (a) đã thắng)
 *   → không có link.
 * - rõ ràng, nhóm tạm ngừng (merchant bị khóa, key không còn dùng được, VA chưa được cho phép) hoặc BTC không còn tài
 *   khoản mặc định → một transaction: CAS `pending → expired`, nhả chỗ, `payment_link_error = 'sales_paused'`. Mã ngắt
 *   dịch vụ (merchant bị ngắt, hết Token, key hiện hành không còn dùng được; Story 4.2; VA của tài khoản mặc định bị từ
 *   chối, `PAYMENT_ACCOUNT_NOT_ALLOWED`, Story 4.2-d) còn bật cờ dịch vụ thanh toán của BTC trong cùng transaction
 *   (`organizer.suspendPaymentService`, kèm credential và tài khoản đã dùng: mọi Hạng vé > 0đ "Tạm ngừng bán" từ đó).
 * - rõ ràng, mã khác → trả lượt, `payment_link_error = 'provider_error'`, Đơn vẫn `pending` (thử lại được).
 * - mơ hồ → như nhóm tạm ngừng nhưng `payment_link_error = 'timeout'`.
 * Mỗi lần Tingee từ chối hoặc kết quả mơ hồ đều log cảnh báo (BTC, mã Đơn, mã Tingee hoặc loại lỗi); không bao giờ log
 * credential, checkout URL, VA hay tên chủ tài khoản. BTC được báo qua cờ dịch vụ thanh toán (`notices`, Story 4.2).
 */

/** Token DI của cấu hình tạo link. */
export const PAYMENT_LINK_SETTINGS = Symbol('PAYMENT_LINK_SETTINGS');

export interface PaymentLinkSettings {
  /** Giải mã Secret Token Tingee của BTC (khóa `TINGEE_CREDENTIAL_KEYS`). */
  secretBox: SecretBox;
  /** `WEB_ORIGIN`: gốc của `returnUrl` (Trang Đơn). */
  webOrigin: string;
}

/** Dựng cấu hình từ env đã kiểm (Zod đã bảo đảm `TINGEE_CREDENTIAL_KEYS` hợp lệ). */
export function paymentLinkSettings(config: { WEB_ORIGIN: string; TINGEE_CREDENTIAL_KEYS: string }): PaymentLinkSettings {
  return {
    secretBox: new SecretBox(parseCredentialKeys(config.TINGEE_CREDENTIAL_KEYS)),
    webOrigin: config.WEB_ORIGIN,
  };
}

/** Lỗi miền từ Tingee khiến BTC "tạm ngừng bán": Đơn hết hạn, không thử lại. */
const SALES_PAUSED_CODES: ReadonlySet<string> = new Set([
  ErrorCode.MERCHANT_SUSPENDED,
  ErrorCode.TINGEE_CREDENTIAL_INVALID,
  ErrorCode.PAYMENT_ACCOUNT_NOT_ALLOWED,
]);

/** Phần của Đơn mà hàm bảo đảm link cần (dòng `orders` vừa đọc). */
export type LinkCandidate = Pick<
  typeof orders.$inferSelect,
  'id' | 'code' | 'organizationId' | 'eventId' | 'totalAmount' | 'status' | 'paymentLink' | 'paymentLinkAttemptAt'
>;

@Injectable()
export class PaymentLinks {
  private readonly logger = new Logger('PaymentLinks');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(OrderQueues) private readonly queues: OrderQueues,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
    @Inject(PAYMENT_LINK_SETTINGS) private readonly settings: PaymentLinkSettings,
  ) {}

  /**
   * Bảo đảm link cho Đơn `order`. `claimed`: TX1 vừa đặt sẵn lượt cho chính request này (lần gọi đầu). Không thì giành
   * lượt bằng CAS; Đơn không đủ điều kiện (không còn `pending`, đã có link, đang có lượt khác, Đơn 0đ) → không gọi Tingee,
   * không đổi gì, trả `false`. Đơn đủ điều kiện: `beforeClaim` chạy trước khi giành lượt (giới hạn tốc độ của người gọi:
   * mỗi lần trả lượt cho phép một lời gọi Tingee nữa bằng key của BTC); ném → không giành lượt, không gọi Tingee. `true`:
   * đã giữ lượt và xử lý xong kết quả, người gọi đọc lại Đơn. Ngoài `beforeClaim`, lỗi chỉ ném khi DB hoặc pg-boss lỗi.
   */
  async ensure(
    order: LinkCandidate,
    options: { claimed: true } | { claimed: false; beforeClaim: () => Promise<void> },
  ): Promise<boolean> {
    if (!options.claimed) {
      const eligible =
        order.status === OrderStatus.PENDING &&
        order.totalAmount > 0 &&
        order.paymentLink === null &&
        order.paymentLinkAttemptAt === null;
      if (!eligible) return false;
      // TX2 enqueue job (c) bằng `tx`: pg-boss phải sẵn sàng, kiểm trước khi giành lượt.
      await this.queues.ready();
      await options.beforeClaim();
      if (!(await this.claim(order.id))) return false;
    }
    await this.attempt(order);
    return true;
  }

  /** CAS giành lượt; `false` khi Đơn không còn đủ điều kiện hoặc request khác đang giữ lượt. */
  private async claim(orderId: string): Promise<boolean> {
    const [row] = await this.db.orm
      .update(orders)
      .set({ paymentLinkAttemptAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.status, OrderStatus.PENDING),
          isNull(orders.paymentLink),
          isNull(orders.paymentLinkAttemptAt),
          gt(orders.expiresAt, sql`clock_timestamp()`),
          gt(orders.totalAmount, 0),
        ),
      )
      .returning({ id: orders.id });
    return row !== undefined;
  }

  /**
   * Đang giữ lượt: chốt link (`sellability`), đọc nơi nhận tiền, gọi Tingee (ngoài transaction) rồi xử lý theo kết quả.
   * Chốt chặn → hết hạn Đơn (`sales_paused`), không trả lượt, không gọi Tingee. Chốt lỗi (DB) → trả lượt như khi không
   * đọc được nơi nhận tiền.
   */
  private async attempt(order: LinkCandidate): Promise<void> {
    const context = { organizationId: order.organizationId, orderCode: order.code };
    let blocked: EventSaleReason | null;
    try {
      blocked = await paymentLinkBlock(this.db.orm, order.eventId, await dbNow(this.db.orm));
    } catch (err) {
      // Chưa gọi Tingee: trả lượt, Đơn vẫn chờ (thử lại được).
      const error = err instanceof Error ? err.name : 'unknown';
      this.logger.error({ ...context, error }, 'Không kiểm được trạng thái bán; chưa tạo được link thanh toán');
      await this.release(order.id);
      return;
    }
    if (blocked !== null) {
      this.logger.warn(
        { ...context, reason: blocked },
        'Sự kiện không còn bán; Đơn hết hạn (tạm ngừng bán), không gọi Tingee',
      );
      await this.expire(order.id, PaymentLinkError.SALES_PAUSED);
      return;
    }

    let target: PayoutTarget | null;
    try {
      target = await defaultPayoutTargetOf(this.db.orm, this.settings.secretBox, order.organizationId);
    } catch (err) {
      // Chưa gọi Tingee (vd. thiếu khóa giải mã credential): trả lượt, Đơn vẫn chờ.
      const error = err instanceof Error ? err.name : 'unknown';
      this.logger.error({ ...context, error }, 'Không đọc được nơi nhận tiền của BTC; chưa tạo được link thanh toán');
      await this.release(order.id);
      return;
    }
    if (!target) {
      this.logger.warn(
        { ...context, reason: 'no_default_payout_account' },
        'BTC không còn tài khoản nhận tiền mặc định; Đơn hết hạn (tạm ngừng bán)',
      );
      await this.expire(order.id, PaymentLinkError.SALES_PAUSED);
      return;
    }

    let checkoutUrl: string;
    try {
      checkoutUrl = await this.tingee.createPaymentLink(target.credential, {
        orderId: order.code,
        amount: order.totalAmount,
        vaAccountNumber: target.vaAccountNumber,
        expireInMinute: PAYMENT_LINK_MINUTES,
        returnUrl: new URL(orderPath(order.code), this.settings.webOrigin).toString(),
        description: `Thanh toán Đơn ${order.code}`,
      });
    } catch (err) {
      if (err instanceof CreateLinkError && err.outcome === 'rejected') {
        const paused = SALES_PAUSED_CODES.has(err.code);
        this.logger.warn(
          { ...context, tingeeCode: err.tingeeCode, domainCode: err.code },
          paused ? 'Tingee từ chối tạo link; Đơn hết hạn (tạm ngừng bán)' : 'Tingee từ chối tạo link; Đơn chờ thử lại',
        );
        if (!paused) {
          await this.release(order.id);
          return;
        }
        // Mã ngắt dịch vụ (key hiện hành, hoặc VA của tài khoản mặc định): bật cờ của BTC cùng transaction hết hạn Đơn.
        const suspension: SuspensionInput | null = err.serviceReason
          ? {
              organizationId: order.organizationId,
              reason: err.serviceReason,
              credentialId: target.credentialId,
              payoutAccountId: target.payoutAccountId,
            }
          : null;
        await this.expire(order.id, PaymentLinkError.SALES_PAUSED, suspension);
        return;
      }
      // Mơ hồ (kể cả lỗi lạ không phải `CreateLinkError`: không biết Tingee đã nhận request chưa): không gọi lại.
      const detail =
        err instanceof CreateLinkError
          ? { reason: err.reason, httpStatus: err.httpStatus, tingeeCode: err.tingeeCode }
          : { reason: 'unexpected' };
      this.logger.warn({ ...context, ...detail }, 'Không rõ kết quả tạo link; Đơn hết hạn, không gọi lại');
      await this.expire(order.id, PaymentLinkError.TIMEOUT);
      return;
    }
    await this.attach(order, checkoutUrl, target.payoutAccountId);
  }

  /**
   * TX2: CAS gắn link, chụp tài khoản nhận tiền, `expires_at` = lượt + `PAYMENT_LINK_MINUTES` (đồng hồ DB lúc giành lượt,
   * trước khi gửi request: không bao giờ muộn hơn hạn thật của link), rồi enqueue bằng chính `tx` job (c) chạy từ
   * `expires_at + PAYMENT_LINK_GRACE_SECONDS` và job Đối soát bù đầu tiên chạy từ lượt + 2 phút (Story 4.1, id cố định
   * theo Đơn và mốc), rồi phát `order_changed`. 0 dòng: Đơn đã hết hạn trước khi gắn link (job (a) thắng) → không làm gì.
   */
  private async attach(order: LinkCandidate, checkoutUrl: string, payoutAccountId: string): Promise<void> {
    const attached = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({
          paymentLink: checkoutUrl,
          payoutAccountId,
          paymentLinkError: null,
          expiresAt: sql`${orders.paymentLinkAttemptAt} + make_interval(mins => ${PAYMENT_LINK_MINUTES})`,
        })
        .where(
          and(
            eq(orders.id, order.id),
            eq(orders.status, OrderStatus.PENDING),
            isNull(orders.paymentLink),
            isNotNull(orders.paymentLinkAttemptAt),
          ),
        )
        .returning({ ...orderSignalColumns, expiresAt: orders.expiresAt, attemptAt: orders.paymentLinkAttemptAt });
      if (!row) return false;
      // CAS đòi `payment_link_attempt_at IS NOT NULL`: thiếu là lỗi lập trình → ném, cả TX2 rollback.
      if (!row.attemptAt) throw new Error('TX2: Đơn vừa gắn link không có payment_link_attempt_at');
      const startAfter = new Date(row.expiresAt.getTime() + PAYMENT_LINK_GRACE_SECONDS * 1000);
      await enqueueOrderExpiry(this.boss, tx, order.id, startAfter, 'link');
      await enqueueReconciliation(this.boss, tx, order.id, firstCheckAt(row.attemptAt));
      await notifyOrderChanged(tx, row);
      return true;
    });
    if (!attached) {
      // Link đã có ở Tingee nhưng Đơn không còn chờ: tiền về sau đó đi nhánh tiền về muộn của IPN (Story 3.5/3.6).
      this.logger.warn(
        { organizationId: order.organizationId, orderCode: order.code },
        'Đơn đã hết hạn trước khi gắn link thanh toán',
      );
    }
  }

  /**
   * Trả lượt khi chắc chắn chưa có link: Tingee từ chối rõ ràng bằng mã thường, hoặc chưa gọi Tingee vì chốt link lỗi
   * hay không đọc được nơi nhận tiền (vd. không giải mã được credential). Ghi `provider_error`; Đơn vẫn `pending`, thử
   * lại được. Đơn đã rời `pending` (job (a) thắng) → không đổi gì.
   */
  private async release(orderId: string): Promise<void> {
    await this.db.orm
      .update(orders)
      .set({ paymentLinkAttemptAt: null, paymentLinkError: PaymentLinkError.PROVIDER_ERROR })
      .where(and(eq(orders.id, orderId), eq(orders.status, OrderStatus.PENDING), isNull(orders.paymentLink)))
      .returning({ id: orders.id });
  }

  /**
   * Một transaction: CAS `pending → expired` (chưa có link) kèm lý do, rồi nhả chỗ như mọi đường hết hạn khác
   * (`releaseOrderHeld`) và phát `order_changed`. Lượt không được trả. 0 dòng (job (a) đã hết hạn Đơn) → Đơn không đổi.
   * `suspension` (Tingee báo ngắt dịch vụ bằng key hiện hành, hoặc từ chối VA của tài khoản mặc định): bật cờ dịch vụ
   * thanh toán của BTC trong cùng transaction, kể cả khi job (a) đã hết hạn Đơn trước (Tingee vẫn đã báo ngắt), rồi log
   * sau commit.
   */
  private async expire(orderId: string, reason: PaymentLinkError, suspension: SuspensionInput | null = null): Promise<void> {
    const suspended = await this.db.transaction(async (tx): Promise<PaymentServiceSuspension | null> => {
      const [expired] = await tx
        .update(orders)
        .set({ status: OrderStatus.EXPIRED, paymentLinkError: reason })
        .where(and(eq(orders.id, orderId), eq(orders.status, OrderStatus.PENDING), isNull(orders.paymentLink)))
        .returning(orderSignalColumns);
      if (expired) {
        await releaseOrderHeld(tx, orderId);
        await notifyOrderChanged(tx, expired);
      }
      return suspension ? suspendPaymentService(tx, suspension) : null;
    });
    if (!suspension || suspended === null) return;
    const context = { organizationId: suspension.organizationId, reason: suspension.reason, result: suspended };
    if (suspended === 'suspended' || suspended === 'reason_changed') {
      this.logger.warn(context, 'Tingee ngắt dịch vụ thanh toán của BTC; mọi Hạng vé có phí Tạm ngừng bán');
    } else if (suspended === 'stale_credential') {
      this.logger.log(context, 'Key Tingee vừa bị thay; không bật cờ dịch vụ thanh toán');
    } else if (suspended === 'stale_account') {
      this.logger.log(context, 'Tài khoản nhận tiền mặc định vừa đổi; không bật cờ dịch vụ thanh toán');
    }
  }
}
