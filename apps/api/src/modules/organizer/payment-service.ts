import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  ErrorCode,
  JobQueue,
  PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS,
  PAYMENT_SERVICE_PROBE_INTERVAL_MINUTES,
  PaymentServiceReason,
  PaymentServiceResumedPayload,
  PaymentServiceResumePath,
  PaymentServiceStatus,
  RealtimeTopic,
  type PaymentServiceState,
  type SuspendedPaymentServiceOrganization,
} from '@tickee/contracts';
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import {
  orgScope,
  type AccessContext,
  type PlatformAdminContext,
  type PlatformAdminReader,
} from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { parseCredentialKeys, SecretBox, SecretBoxError } from '../../platform/crypto/index.js';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import {
  BOSS,
  defineQueue,
  errorName,
  JOB_COMPLETED,
  QueueProducer,
  registerQueueWorker,
} from '../../platform/jobs/index.js';
import { realtime } from '../../platform/realtime/index.js';
import { TINGEE_CLIENT, type MerchantServiceStatus, type TingeeClient } from '../tingee/index.js';
import { defaultPayoutTargetOf, type PayoutTarget } from './payout-targets.js';
import { organizations, tingeeCredentials } from './schema.js';

/*
 * Dịch vụ thanh toán của BTC (FR-15, FR-20, AD-32, Story 4.2-a): `organizer` sở hữu cờ `organizations.payment_service_*`.
 *
 * - Bật (`suspendPaymentService`, trong `tx` hết hạn Đơn của `ordering.PaymentLinks`): `create-link` bằng key hiện hành bị
 *   Tingee từ chối với mã ngắt dịch vụ. CAS `active → suspended`; đã `suspended` thì chỉ đổi lý do (giữ `since`).
 *   Credential đã bị thay trước lúc ghi → không bật (key cũ, như Đối soát bù của 4.1).
 * - Tắt (`resumePaymentService`, một hàm cho mọi đường: dò, "Kiểm tra lại", Quản trị Tingee, lưu key mới): CAS
 *   `suspended → active`, audit đường mở lại, `org_status_changed`, và job "đã mở lại" (`payment.service-resumed`) cùng
 *   `tx`: `payment` nhận job rồi Đối soát bù mọi Đơn còn mở của BTC. Bên thua CAS không làm gì.
 * - Dò (`PaymentServiceProber`): giành lượt bằng `payment_service_checked_at` (CAS: BTC `suspended`, lần dò trước đã quá
 *   `PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS`), rồi gọi `tingee.getMerchantServiceStatus` bằng key hiện hành NGOÀI
 *   transaction (adapter có timeout): hoạt động → tắt cờ; vẫn ngắt → cập nhật lý do; không biết, hay BTC không có tài
 *   khoản mặc định → giữ cờ, chỉ log. Dò không bao giờ bật cờ. Job cron mỗi `PAYMENT_SERVICE_PROBE_INTERVAL_MINUTES` phút
 *   (vai worker) dò tuần tự các BTC `suspended`; Owner bấm "Kiểm tra lại" dò một BTC.
 * - Lý do `gateway_permission_missing` (1133: key đúng nhưng chưa được cấp quyền "Cổng thanh toán"; quyết định 13/11/2026
 *   sau review lượt 1): `get-va-paging` không thấy được thiếu quyền này, nên job dò bỏ qua BTC có lý do này (không gọi
 *   Tingee), và "Kiểm tra lại" của Owner tắt cờ không cần Tingee xác nhận (vẫn sau lượt chờ 30 giây; còn thiếu quyền thì
 *   lần tạo link kế bật lại). Lưu key mới hợp lệ tắt cờ cho cả lý do này và `credential_invalid`.
 *
 * Mỗi lần đổi cờ có audit (`organization.payment_service_*`, actor `null` khi do hệ thống) và `org_status_changed` trong
 * cùng `tx`. Không bao giờ log credential.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const organizationNotFound = () => new AppError(ErrorCode.NOT_FOUND, 'Không tìm thấy BTC.');
const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');

/** Cờ dịch vụ thanh toán của một BTC (dòng `organizations`). */
export interface PaymentServiceRow {
  status: PaymentServiceStatus;
  /** Có đúng khi `suspended` (CHECK của DB). */
  reason: PaymentServiceReason | null;
  /** Lúc bắt đầu ngắt; có đúng khi `suspended`. */
  since: Date | null;
  /** Lần dò gần nhất; `null` khi chưa dò lần nào. */
  checkedAt: Date | null;
}

const stateColumns = {
  status: organizations.paymentServiceStatus,
  reason: organizations.paymentServiceReason,
  since: organizations.paymentServiceSince,
  checkedAt: organizations.paymentServiceCheckedAt,
};

/** Dạng trả web (`PaymentServiceState`). */
export const paymentServiceStateDto = (row: PaymentServiceRow): PaymentServiceState => ({
  status: row.status,
  reason: row.reason,
  since: row.since?.toISOString() ?? null,
  checkedAt: row.checkedAt?.toISOString() ?? null,
});

/**
 * Read model cho mô-đun khác (`ordering.sellability`, `reporting.notices`) và tổng quan Tài khoản nhận tiền: cờ dịch vụ
 * thanh toán của BTC trong `scope` (qua `orgScope`); BTC không còn → `null`.
 */
export async function paymentServiceStateOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<PaymentServiceRow | null> {
  const [row] = await db
    .select(stateColumns)
    .from(organizations)
    .where(orgScope(scope)({ organizationId: organizations.id }));
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Job "đã mở lại": `organizer` enqueue cùng `tx` tắt cờ, `payment` đăng ký worker (Đối soát bù mọi Đơn còn mở)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Queue "đã mở lại". Retry chỉ cho lỗi DB khi enqueue job tra: 5 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 10 phút), hết
 * lượt thì sang dead-letter. Khai báo ở đây (không ở `payment`) để mọi đường tắt cờ enqueue bằng chính `tx` mà
 * `organizer`/`admin` không import `payment`.
 */
export const PAYMENT_SERVICE_RESUMED_QUEUE = defineQueue({
  name: JobQueue.PAYMENT_SERVICE_RESUMED,
  deadLetter: JobQueue.PAYMENT_SERVICE_RESUMED_DEAD_LETTER,
  options: { retryLimit: 5, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 },
  work: { batchSize: 5, perJobResults: true },
  payload: PaymentServiceResumedPayload,
});

/**
 * Start pg-boss (vai api: producer) và tạo queue "đã mở lại"; mọi đường tắt cờ gọi `ready()` trước transaction (cả vai
 * worker: job dò). Không đăng ký handler.
 */
@Injectable()
export class PaymentServiceQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, PAYMENT_SERVICE_RESUMED_QUEUE, 'khi mở lại dịch vụ thanh toán');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bật, đổi lý do, tắt cờ
// ---------------------------------------------------------------------------------------------------------------

/** Kết quả bật cờ: vừa bật, đổi lý do, đã ở đúng trạng thái đó, hoặc credential không còn hiện hành (không đổi gì). */
export type PaymentServiceSuspension = 'suspended' | 'reason_changed' | 'unchanged' | 'stale_credential';

/** Kết quả nội bộ của `applySuspension`: thêm `not_suspended` (chỉ đổi lý do mà BTC đã `active`: không đổi gì). */
type SuspensionResult = PaymentServiceSuspension | 'not_suspended';

export interface SuspensionInput {
  organizationId: string;
  reason: PaymentServiceReason;
  /** Credential của lời gọi bị Tingee từ chối: chỉ bật cờ khi nó vẫn là credential hiện hành của BTC lúc ghi. */
  credentialId: string;
  /** Người gây ra lần ghi (Owner bấm "Kiểm tra lại"); mặc định `null` (hệ thống: tạo link, job dò). */
  actorUserId?: string | null;
}

/**
 * Ghi lý do ngắt trong `tx`. Khóa dòng BTC trước (`FOR NO KEY UPDATE`: chặn ghi cờ và đổi key song song, không chặn
 * INSERT Đơn hay Sự kiện tham chiếu BTC), rồi kiểm credential bằng một câu mới (READ COMMITTED: đổi key vừa commit thì
 * thấy credential đã gỡ). `activate`: BTC `active` thì bật (lần ngắt mới: xóa `checked_at` của lần trước để thời gian chờ
 * cũ không nuốt lần "Kiểm tra lại" đầu); không thì chỉ đổi lý do của BTC đang `suspended` (`active` → `not_suspended`:
 * dò không bao giờ bật cờ).
 */
async function applySuspension(tx: Tx, input: SuspensionInput, activate: boolean): Promise<SuspensionResult> {
  const id = input.organizationId;
  const [org] = await tx
    .select({ status: organizations.paymentServiceStatus, reason: organizations.paymentServiceReason })
    .from(organizations)
    .where(eq(organizations.id, id))
    .for('no key update');
  if (!org) return 'unchanged';
  const [current] = await tx
    .select({ id: tingeeCredentials.id })
    .from(tingeeCredentials)
    .where(
      and(
        eq(tingeeCredentials.id, input.credentialId),
        eq(tingeeCredentials.organizationId, id),
        isNull(tingeeCredentials.retiredAt),
      ),
    );
  if (!current) return 'stale_credential';

  let result: 'suspended' | 'reason_changed';
  if (org.status === PaymentServiceStatus.ACTIVE) {
    if (!activate) return 'not_suspended';
    await tx
      .update(organizations)
      .set({
        paymentServiceStatus: PaymentServiceStatus.SUSPENDED,
        paymentServiceReason: input.reason,
        paymentServiceSince: sql`now()`,
        paymentServiceCheckedAt: null,
      })
      .where(and(eq(organizations.id, id), eq(organizations.paymentServiceStatus, PaymentServiceStatus.ACTIVE)));
    result = 'suspended';
  } else {
    if (org.reason === input.reason) return 'unchanged';
    await tx
      .update(organizations)
      .set({ paymentServiceReason: input.reason })
      .where(and(eq(organizations.id, id), eq(organizations.paymentServiceStatus, PaymentServiceStatus.SUSPENDED)));
    result = 'reason_changed';
  }
  await audit.record(tx, {
    actorUserId: input.actorUserId ?? null,
    organizationId: id,
    action:
      result === 'suspended' ? 'organization.payment_service_suspended' : 'organization.payment_service_reason_changed',
    target: { type: 'payment_service_reason', id: input.reason },
    changedFields:
      result === 'suspended'
        ? ['payment_service_status', 'payment_service_reason', 'payment_service_since']
        : ['payment_service_reason'],
  });
  await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, id);
  return result;
}

/**
 * Bật cờ trong `tx` của người gọi (`ordering.PaymentLinks`: cùng transaction hết hạn Đơn) khi `create-link` bằng
 * credential `input.credentialId` bị Tingee từ chối với lý do ngắt `input.reason`. CAS `active → suspended` (`since` =
 * `now()`); đã `suspended` thì chỉ đổi lý do (giữ `since`), cùng lý do thì không làm gì. Credential không còn hiện hành
 * (Owner vừa đổi key) → `stale_credential`, không đổi gì. Có đổi thì audit (actor `null`) và `org_status_changed`.
 */
export async function suspendPaymentService(tx: Tx, input: SuspensionInput): Promise<PaymentServiceSuspension> {
  const result = await applySuspension(tx, input, true);
  // `activate` = true: BTC `active` luôn được bật, không bao giờ `not_suspended`.
  return result === 'not_suspended' ? 'unchanged' : result;
}

export interface ResumeInput {
  organizationId: string;
  path: PaymentServiceResumePath;
  /** Người làm (Owner, Quản trị Tingee); `null` với job dò. */
  actorUserId: string | null;
  /** Chỉ tắt khi BTC vẫn ngắt vì lý do này (CAS kèm lý do); thiếu → mọi lý do. */
  expectedReason?: PaymentServiceReason;
}

/**
 * Tắt cờ — hàm duy nhất cho mọi đường. Trong `tx` của người gọi: CAS `suspended → active` (xóa lý do và `since`), audit
 * (`organization.payment_service_resumed`, đối tượng là đường mở lại), `org_status_changed`, enqueue job "đã mở lại"
 * (rollback thì không có job). Người gọi đã `PaymentServiceQueues.ready()` trước transaction. `false`: BTC không
 * `suspended` (kể cả bên kia vừa thắng CAS), hoặc lý do không còn là `expectedReason` — không làm gì.
 */
export async function resumePaymentService(boss: PgBoss, tx: Tx, input: ResumeInput): Promise<boolean> {
  const [row] = await tx
    .update(organizations)
    .set({ paymentServiceStatus: PaymentServiceStatus.ACTIVE, paymentServiceReason: null, paymentServiceSince: null })
    .where(
      and(
        eq(organizations.id, input.organizationId),
        eq(organizations.paymentServiceStatus, PaymentServiceStatus.SUSPENDED),
        input.expectedReason ? eq(organizations.paymentServiceReason, input.expectedReason) : undefined,
      ),
    )
    .returning({ id: organizations.id });
  if (!row) return false;
  await audit.record(tx, {
    actorUserId: input.actorUserId,
    organizationId: input.organizationId,
    action: 'organization.payment_service_resumed',
    target: { type: 'payment_service_resume', id: input.path },
    changedFields: ['payment_service_status', 'payment_service_reason', 'payment_service_since'],
  });
  await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, input.organizationId);
  await PAYMENT_SERVICE_RESUMED_QUEUE.enqueue(boss, tx, { organizationId: input.organizationId });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Dò dịch vụ (job cron, "Kiểm tra lại")
// ---------------------------------------------------------------------------------------------------------------

/** Token DI của cấu hình dò dịch vụ. */
export const PAYMENT_SERVICE_SETTINGS = Symbol('PAYMENT_SERVICE_SETTINGS');

export interface PaymentServiceSettings {
  /** Giải mã Secret Token Tingee của BTC (khóa `TINGEE_CREDENTIAL_KEYS`). */
  secretBox: SecretBox;
}

export function paymentServiceSettings(config: { TINGEE_CREDENTIAL_KEYS: string }): PaymentServiceSettings {
  return { secretBox: new SecretBox(parseCredentialKeys(config.TINGEE_CREDENTIAL_KEYS)) };
}

/**
 * Kết quả một lần dò:
 * - `skipped`: không đổi gì — BTC không `suspended`, lần dò trước chưa quá `PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS`, job
 *   dò gặp lý do `gateway_permission_missing` (không gọi Tingee), hoặc trong lúc gọi Tingee bên khác vừa tắt cờ hay Owner
 *   vừa đổi key;
 * - `resumed`: Tingee nhận key hiện hành (hoặc Owner "Kiểm tra lại" trên lý do `gateway_permission_missing`) → đã tắt cờ;
 * - `still_suspended` / `reason_changed`: Tingee vẫn ngắt (BTC vẫn `suspended` cùng lý do / lý do khác, đã cập nhật);
 * - `unknown`: không kết luận được (Tingee tạm lỗi, timeout, mã khác, không giải mã được credential) → giữ cờ;
 * - `no_target`: BTC không có tài khoản nhận tiền mặc định (không có key để dò) → giữ cờ.
 */
export type PaymentServiceProbeOutcome =
  | 'skipped'
  | 'resumed'
  | 'still_suspended'
  | 'reason_changed'
  | 'unknown'
  | 'no_target';

/** Đường của một lần dò (cũng là đường mở lại ghi vào audit khi dò thấy dịch vụ về). */
export type PaymentServiceProbePath = typeof PaymentServiceResumePath.PROBE | typeof PaymentServiceResumePath.OWNER_CHECK;

/**
 * Lý do khác `gateway_permission_missing`: job dò chỉ dò các BTC này (`get-va-paging` không thấy được thiếu quyền "Cổng
 * thanh toán").
 */
const notGatewayPermissionMissing = ne(
  organizations.paymentServiceReason,
  PaymentServiceReason.GATEWAY_PERMISSION_MISSING,
);

/** Dò dịch vụ thanh toán của một BTC (job cron và "Kiểm tra lại" dùng chung). */
@Injectable()
export class PaymentServiceProber {
  private readonly logger = new Logger('PaymentService');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(TINGEE_CLIENT) private readonly tingee: TingeeClient,
    @Inject(PAYMENT_SERVICE_SETTINGS) private readonly settings: PaymentServiceSettings,
    @Inject(PaymentServiceQueues) private readonly queues: PaymentServiceQueues,
  ) {}

  /**
   * Một lần dò BTC `organizationId`: giành lượt (ghi `payment_service_checked_at`), đọc key hiện hành (tài khoản mặc
   * định), gọi Tingee ngoài transaction, rồi ghi kết quả. `actorUserId`: Owner bấm "Kiểm tra lại"; `null` với job dò.
   * Lỗi DB → ném.
   */
  async probe(
    organizationId: string,
    path: PaymentServiceProbePath,
    actorUserId: string | null,
  ): Promise<PaymentServiceProbeOutcome> {
    const claimed = await this.claim(organizationId, path);
    if (!claimed) return 'skipped';
    const context = { organizationId, path };

    // `get-va-paging` không thấy thiếu quyền "Cổng thanh toán": Owner báo đã cấp quyền → tắt cờ, không gọi Tingee (job dò
    // không giành được lượt cho lý do này). CAS kèm lý do: lý do đổi sau lúc giành lượt thì không mở lại.
    if (claimed.reason === PaymentServiceReason.GATEWAY_PERMISSION_MISSING) {
      await this.queues.ready();
      const expectedReason = PaymentServiceReason.GATEWAY_PERMISSION_MISSING;
      const resumed = await this.db.transaction((tx) =>
        resumePaymentService(this.boss, tx, { organizationId, path, actorUserId, expectedReason }),
      );
      if (resumed) this.logger.log(context, 'Owner báo đã cấp quyền Cổng thanh toán; đã mở lại, không gọi Tingee');
      return resumed ? 'resumed' : 'skipped';
    }

    let target: PayoutTarget | null;
    try {
      target = await defaultPayoutTargetOf(this.db.orm, this.settings.secretBox, organizationId);
    } catch (err) {
      if (!(err instanceof SecretBoxError)) throw err;
      this.logger.warn({ ...context, error: errorName(err) }, 'Dò dịch vụ thanh toán: không giải mã được key; giữ cờ');
      return 'unknown';
    }
    if (!target) {
      this.logger.warn(context, 'Dò dịch vụ thanh toán: BTC không có tài khoản nhận tiền mặc định; giữ cờ');
      return 'no_target';
    }

    const status: MerchantServiceStatus = await this.tingee.getMerchantServiceStatus(target.credential);
    switch (status.status) {
      case 'active': {
        await this.queues.ready();
        const resumed = await this.db.transaction((tx) =>
          resumePaymentService(this.boss, tx, { organizationId, path, actorUserId }),
        );
        if (resumed) this.logger.log(context, 'Dò dịch vụ thanh toán: Tingee nhận key; đã mở lại');
        return resumed ? 'resumed' : 'skipped';
      }
      case 'suspended': {
        const input = { organizationId, reason: status.reason, credentialId: target.credentialId, actorUserId };
        const result = await this.db.transaction((tx) => applySuspension(tx, input, false));
        if (result === 'not_suspended' || result === 'stale_credential') {
          // Trong lúc gọi Tingee, bên khác vừa mở lại hoặc Owner vừa đổi key: kết quả này đã cũ, không đổi gì.
          this.logger.log({ ...context, reason: status.reason, result }, 'Dò dịch vụ thanh toán: kết quả đã cũ; bỏ qua');
          return 'skipped';
        }
        this.logger.warn({ ...context, reason: status.reason, result }, 'Dò dịch vụ thanh toán: Tingee vẫn ngắt; giữ cờ');
        return result === 'reason_changed' ? 'reason_changed' : 'still_suspended';
      }
      case 'unknown':
        this.logger.warn(context, 'Dò dịch vụ thanh toán: không kết luận được; giữ cờ');
        return 'unknown';
    }
  }

  /**
   * Giành lượt dò: CAS ghi `payment_service_checked_at = now()` khi BTC `suspended` và lần dò trước đã quá thời gian chờ;
   * job dò không giành lượt cho lý do `gateway_permission_missing`. Hai lần dò cùng lúc (job, Owner bấm liên tục) → chỉ một
   * bên làm. Trả lý do lúc giành; không giành được → `null`.
   */
  private async claim(
    organizationId: string,
    path: PaymentServiceProbePath,
  ): Promise<{ reason: PaymentServiceReason | null } | null> {
    const checkedAt = organizations.paymentServiceCheckedAt;
    const [row] = await this.db.orm
      .update(organizations)
      .set({ paymentServiceCheckedAt: sql`now()` })
      .where(
        and(
          eq(organizations.id, organizationId),
          eq(organizations.paymentServiceStatus, PaymentServiceStatus.SUSPENDED),
          or(
            isNull(checkedAt),
            lte(checkedAt, sql`now() - make_interval(secs => ${PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS})`),
          ),
          path === PaymentServiceResumePath.PROBE ? notGatewayPermissionMissing : undefined,
        ),
      )
      .returning({ reason: organizations.paymentServiceReason });
    return row ?? null;
  }
}

/** "Kiểm tra lại" của Owner (`POST /v1/orgs/:orgId/payment-service/check`). */
@Injectable()
export class PaymentServiceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PaymentServiceProber) private readonly prober: PaymentServiceProber,
  ) {}

  /**
   * Dò rồi trả trạng thái mới. BTC đang `active`, hoặc lần dò trước chưa quá thời gian chờ → trả trạng thái hiện tại,
   * không gọi Tingee.
   */
  async check(ctx: AccessContext): Promise<PaymentServiceState> {
    await this.prober.probe(ctx.organizationId, PaymentServiceResumePath.OWNER_CHECK, ctx.userId);
    const state = await paymentServiceStateOf(this.db.orm, ctx);
    if (!state) throw notAMember();
    return paymentServiceStateDto(state);
  }
}

/**
 * Id các BTC đang `suspended` mà job dò dò được (trừ lý do `gateway_permission_missing`), BTC dò lâu nhất (chưa dò lần
 * nào) trước. Không qua `orgScope`: chỉ job nền của worker.
 */
export async function suspendedOrganizationIds(db: DbExecutor): Promise<string[]> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(eq(organizations.paymentServiceStatus, PaymentServiceStatus.SUSPENDED), notGatewayPermissionMissing))
    .orderBy(
      sql`${organizations.paymentServiceCheckedAt} ASC NULLS FIRST`,
      asc(organizations.paymentServiceSince),
      asc(organizations.id),
    );
  return rows.map((row) => row.id);
}

/** Lịch job dò (cron, UTC): mỗi `PAYMENT_SERVICE_PROBE_INTERVAL_MINUTES` phút. */
export const PAYMENT_SERVICE_PROBE_CRON = `*/${PAYMENT_SERVICE_PROBE_INTERVAL_MINUTES} * * * *`;

/**
 * Queue cron của job dò: không payload (pg-boss gửi `null`), không retry, không dead-letter (lần chạy kế tiếp làm lại).
 * Hai lần chạy chồng nhau (nhiều worker, một lượt chạy lâu) không gọi Tingee hai lần cho một BTC nhờ lượt dò.
 */
export const PAYMENT_SERVICE_PROBE_QUEUE = defineQueue({
  name: JobQueue.ORGANIZER_PROBE_PAYMENT_SERVICE,
  options: { retryLimit: 0 },
  work: { batchSize: 1, perJobResults: true },
  payload: z.unknown(),
});

/** Vai `worker`: tạo queue, lên lịch mỗi 5 phút (upsert: nhiều worker vẫn một lịch) và đăng ký handler dò. */
@Injectable()
export class PaymentServiceProbeWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('PaymentServiceProbeWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(PaymentServiceProber) private readonly prober: PaymentServiceProber,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerQueueWorker(this.boss, PAYMENT_SERVICE_PROBE_QUEUE, {
      logger: this.logger,
      label: 'Dò dịch vụ thanh toán',
      logContext: () => ({}),
      handle: async () => {
        await this.probeSuspended();
        return JOB_COMPLETED;
      },
    });
    await this.boss.schedule(PAYMENT_SERVICE_PROBE_QUEUE.name, PAYMENT_SERVICE_PROBE_CRON);
  }

  /**
   * Dò tuần tự mọi BTC `suspended`. Lỗi (DB) ở một BTC chỉ log rồi sang BTC kế (lần chạy sau dò lại). Trả kết quả theo
   * BTC (log, test).
   */
  async probeSuspended(): Promise<Map<string, PaymentServiceProbeOutcome | 'error'>> {
    const outcomes = new Map<string, PaymentServiceProbeOutcome | 'error'>();
    for (const organizationId of await suspendedOrganizationIds(this.db.orm)) {
      try {
        outcomes.set(organizationId, await this.prober.probe(organizationId, PaymentServiceResumePath.PROBE, null));
      } catch (err) {
        outcomes.set(organizationId, 'error');
        this.logger.warn({ organizationId, error: errorName(err) }, 'Dò dịch vụ thanh toán lỗi; lần chạy sau dò lại');
      }
    }
    if (outcomes.size > 0) this.logger.log({ organizations: outcomes.size }, 'Đã dò dịch vụ thanh toán các BTC bị ngắt');
    return outcomes;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Quản trị Tingee (`admin`)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Danh sách BTC `suspended` cho Quản trị Tingee: ngắt lâu nhất trước. Đọc chéo mọi BTC nên chỉ nhận `tx` đã qua
 * `platformAdminScope` (đã có audit). Không có kênh liên hệ hay PII.
 */
export async function listSuspendedPaymentServices(
  reader: PlatformAdminReader,
): Promise<SuspendedPaymentServiceOrganization[]> {
  const rows = await reader
    .select({ id: organizations.id, name: organizations.name, ...stateColumns })
    .from(organizations)
    .where(eq(organizations.paymentServiceStatus, PaymentServiceStatus.SUSPENDED))
    .orderBy(asc(organizations.paymentServiceSince), asc(organizations.id));
  return rows.flatMap((row) =>
    // CHECK của DB bảo đảm `suspended` luôn có lý do và mốc.
    row.reason && row.since
      ? [
          {
            id: row.id,
            name: row.name,
            reason: row.reason,
            since: row.since.toISOString(),
            checkedAt: row.checkedAt?.toISOString() ?? null,
          },
        ]
      : [],
  );
}

/**
 * Quản trị Tingee mở lại dịch vụ thanh toán của một BTC (`resumePaymentService`, đường `platform_admin`). Id lạ hoặc sai
 * dạng → 404; BTC đang `active` (kể cả đường khác vừa mở lại) → 409 `PAYMENT_SERVICE_NOT_SUSPENDED`, không đổi gì.
 */
export async function resumePaymentServiceByPlatformAdmin(
  db: Database,
  boss: PgBoss,
  queues: PaymentServiceQueues,
  ctx: PlatformAdminContext,
  organizationId: string,
): Promise<void> {
  if (!UUID.test(organizationId)) throw organizationNotFound();
  const id = organizationId.toLowerCase();
  await queues.ready();
  await db.transaction(async (tx) => {
    const input = { organizationId: id, path: PaymentServiceResumePath.PLATFORM_ADMIN, actorUserId: ctx.userId };
    if (await resumePaymentService(boss, tx, input)) return;
    const [row] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id));
    if (!row) throw organizationNotFound();
    throw new AppError(ErrorCode.PAYMENT_SERVICE_NOT_SUSPENDED, 'Dịch vụ thanh toán của BTC này không bị ngắt.');
  });
}

/**
 * Đổi key Tingee (`replaceKey`, 2.13-b) trong `tx` của nó: BTC đang `suspended` vì key (`credential_invalid`,
 * `gateway_permission_missing`) → tắt cờ (đường `new_key`, actor là Owner); lý do khác (merchant bị ngắt, hết Token: key
 * mới không chữa được) → giữ cờ. Trả `true` khi đã tắt.
 */
export async function resumeAfterNewKey(boss: PgBoss, tx: Tx, ctx: AccessContext): Promise<boolean> {
  const [org] = await tx
    .select({ reason: organizations.paymentServiceReason })
    .from(organizations)
    .where(
      and(
        orgScope(ctx)({ organizationId: organizations.id }),
        eq(organizations.paymentServiceStatus, PaymentServiceStatus.SUSPENDED),
        inArray(organizations.paymentServiceReason, [
          PaymentServiceReason.CREDENTIAL_INVALID,
          PaymentServiceReason.GATEWAY_PERMISSION_MISSING,
        ]),
      ),
    );
  if (!org) return false;
  return resumePaymentService(boss, tx, {
    organizationId: ctx.organizationId,
    path: PaymentServiceResumePath.NEW_KEY,
    actorUserId: ctx.userId,
  });
}
