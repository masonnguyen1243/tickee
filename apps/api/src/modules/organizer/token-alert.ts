import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  JobQueue,
  NOTIFICATION_CATALOG,
  PaymentServiceStatus,
  RealtimeTopic,
  TokenAlertEmailPayload,
  type TokenAlert,
} from '@tickee/contracts';
import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import type { Database, DbExecutor } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS, defineQueue, derivedJobId, QueueProducer } from '../../platform/jobs/index.js';
import { realtime } from '../../platform/realtime/index.js';
import { organizations } from './schema.js';

/*
 * Cảnh báo Token (Story 4.5-b, FR-34): `organizer` sở hữu `organizations.token_alert_threshold` (ngưỡng Owner đặt) và
 * `organizations.token_below_threshold_since` (lần vượt ngưỡng gần nhất). Không bao giờ lưu hay log số dư, hạn mức hay
 * Token khả dụng: số khả dụng của lần đọc chỉ đi vào điều kiện `WHERE` của câu đánh giá.
 *
 * - Đánh giá (`evaluateTokenAlert`), sau mỗi lần đọc Token `ok` (trang Token, job dò mỗi giờ), NGOÀI lời gọi Tingee:
 *   một transaction, mỗi chuyển trạng thái là compare-and-set trong một câu UPDATE (điều kiện ngưỡng nằm trong `WHERE`).
 *   - Vượt ngưỡng: cột đang `null`, có ngưỡng, khả dụng < ngưỡng → `now()` của DB; cùng `tx` enqueue email (id job cố
 *     định theo BTC và mốc) và phát `org_status_changed`.
 *   - Về trên ngưỡng: cột khác `null` và (khả dụng ≥ ngưỡng hoặc không còn ngưỡng) → `null`, phát `org_status_changed`.
 *   Trang và job đọc cùng lúc, hay Owner đổi ngưỡng giữa chừng: bên thua CAS không làm gì, nên mỗi lần vượt ngưỡng có
 *   đúng một job email.
 * - Đặt ngưỡng (`updateTokenAlertThreshold`, chỉ Owner): một transaction, giá trị không đổi thì không ghi; audit
 *   `organization.token_alert_threshold_update`. Tắt cảnh báo (`null`) xóa mốc dưới ngưỡng và phát `org_status_changed`;
 *   đổi sang ngưỡng khác giữ nguyên mốc (không gửi lại email khi vẫn dưới ngưỡng).
 */

const notAMember = () => new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');

/** Trạng thái cảnh báo Token của một BTC (dòng `organizations`). */
export interface TokenAlertRow {
  /** Ngưỡng Owner đặt; `null`: chưa đặt hoặc đã tắt. */
  threshold: number | null;
  /** Lần vượt ngưỡng gần nhất; `null`: không dưới ngưỡng. Chỉ khác `null` khi có ngưỡng (CHECK của DB). */
  since: Date | null;
}

const alertColumns = {
  threshold: organizations.tokenAlertThreshold,
  since: organizations.tokenBelowThresholdSince,
};

/** Dạng trả web (`TokenAlert`). */
export const tokenAlertDto = (row: TokenAlertRow): TokenAlert => ({
  threshold: row.threshold,
  belowThresholdSince: row.since?.toISOString() ?? null,
});

/**
 * Read model cho mô-đun khác (`reporting.notices`) và trang Token: trạng thái cảnh báo Token của BTC trong `scope` (qua
 * `orgScope`); BTC không còn → `null`.
 */
export async function tokenAlertStateOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<TokenAlertRow | null> {
  const [row] = await db
    .select(alertColumns)
    .from(organizations)
    .where(orgScope(scope)({ organizationId: organizations.id }));
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Queue email (producer ở đây để lần đánh giá enqueue bằng chính `tx`; worker ở `token-alert-jobs.ts`)
// ---------------------------------------------------------------------------------------------------------------

/** Queue email của thông báo Token dưới ngưỡng, đọc từ danh mục thông báo (nguồn duy nhất). */
const EMAIL_QUEUE = NOTIFICATION_CATALOG.token_below_threshold.emailQueue;

/**
 * Queue email cảnh báo Token. Retry và dead-letter như email cảnh báo đổi tài khoản nhận tiền mặc định: 8 lần, chờ 30
 * giây rồi tăng gấp đôi (tối đa 1 giờ), hết lượt thì sang dead-letter. Lô tối đa 10 job, lấy tiếp ngay khi lô đầy; mỗi
 * job được chốt riêng.
 */
export const TOKEN_ALERT_EMAIL_QUEUE = defineQueue({
  name: EMAIL_QUEUE,
  deadLetter: JobQueue.TOKEN_ALERT_EMAIL_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: TokenAlertEmailPayload,
});

/**
 * Id job email của một lần vượt ngưỡng: suy cố định từ id BTC và mốc (`derivedJobId(orgId, '<queue>:<since ISO>')`),
 * nên enqueue lặp cho cùng lần vượt không tạo job thứ hai.
 */
export const tokenAlertEmailJobId = (organizationId: string, since: Date): string =>
  derivedJobId(organizationId, `${EMAIL_QUEUE}:${since.toISOString()}`);

/**
 * Start pg-boss (vai api: producer) và tạo queue email cảnh báo Token; lần đánh giá ngưỡng gọi `ready()` trước
 * transaction (cả vai worker: job dò). Không đăng ký handler.
 */
@Injectable()
export class TokenAlertQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, TOKEN_ALERT_EMAIL_QUEUE, 'khi Token xuống dưới ngưỡng');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Đánh giá ngưỡng
// ---------------------------------------------------------------------------------------------------------------

/** Kết quả một lần đánh giá: vừa vượt ngưỡng, vừa về trên ngưỡng, hoặc không đổi gì. */
export type TokenAlertTransition = 'crossed' | 'recovered' | 'unchanged';

export interface TokenAlertEvaluation {
  /** Trạng thái sau lần đánh giá; BTC không còn → `null`. */
  state: TokenAlertRow | null;
  transition: TokenAlertTransition;
}

/**
 * Đánh giá ngưỡng của BTC với Token khả dụng `available` của một lần đọc `ok` vừa xong (ngoài lời gọi Tingee). Người gọi
 * đã `TokenAlertQueues.ready()` trước. Lỗi DB → ném (transaction rollback: không mốc, không job, không tín hiệu).
 */
export async function evaluateTokenAlert(
  db: Database,
  boss: PgBoss,
  organizationId: string,
  available: number,
): Promise<TokenAlertEvaluation> {
  const threshold = organizations.tokenAlertThreshold;
  const since = organizations.tokenBelowThresholdSince;
  return db.transaction(async (tx) => {
    const [crossed] = await tx
      .update(organizations)
      .set({ tokenBelowThresholdSince: sql`now()` })
      .where(and(eq(organizations.id, organizationId), isNull(since), isNotNull(threshold), gt(threshold, available)))
      .returning(alertColumns);
    if (crossed?.since) {
      await TOKEN_ALERT_EMAIL_QUEUE.enqueue(
        boss,
        tx,
        { organizationId, belowThresholdSince: crossed.since.toISOString() },
        { id: tokenAlertEmailJobId(organizationId, crossed.since) },
      );
      await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, organizationId);
      return { state: crossed, transition: 'crossed' };
    }

    const [recovered] = await tx
      .update(organizations)
      .set({ tokenBelowThresholdSince: null })
      .where(
        and(eq(organizations.id, organizationId), isNotNull(since), or(isNull(threshold), lte(threshold, available))),
      )
      .returning(alertColumns);
    if (recovered) {
      await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, organizationId);
      return { state: recovered, transition: 'recovered' };
    }

    const [current] = await tx.select(alertColumns).from(organizations).where(eq(organizations.id, organizationId));
    return { state: current ?? null, transition: 'unchanged' };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Đặt ngưỡng (Owner)
// ---------------------------------------------------------------------------------------------------------------

/**
 * `PUT /v1/orgs/:orgId/token/alert-threshold`: đặt ngưỡng `threshold`, hoặc `null` để tắt cảnh báo. Một transaction,
 * khóa dòng BTC (`FOR NO KEY UPDATE`: chặn đánh giá ngưỡng song song, không chặn INSERT tham chiếu BTC). Giá trị không đổi
 * → không ghi gì. Có đổi → audit `organization.token_alert_threshold_update` (`changedFields`
 * `['token_alert_threshold']`, thêm `token_below_threshold_since` khi mốc bị xóa). Tắt → xóa mốc dưới ngưỡng và phát
 * `org_status_changed` (banner tắt); đổi sang ngưỡng khác → giữ mốc (lần đọc kế đánh giá lại với ngưỡng mới).
 */
export async function updateTokenAlertThreshold(
  db: Database,
  ctx: AccessContext,
  threshold: number | null,
): Promise<TokenAlertRow> {
  return db.transaction(async (tx) => {
    const scope = orgScope(ctx)({ organizationId: organizations.id });
    const [current] = await tx.select(alertColumns).from(organizations).where(scope).for('no key update');
    if (!current) throw notAMember();
    if (current.threshold === threshold) return current;

    const disabling = threshold === null;
    const [updated] = await tx
      .update(organizations)
      .set(disabling ? { tokenAlertThreshold: null, tokenBelowThresholdSince: null } : { tokenAlertThreshold: threshold })
      .where(scope)
      .returning(alertColumns);
    if (!updated) throw notAMember();
    const sinceCleared = current.since !== null && updated.since === null;
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: 'organization.token_alert_threshold_update',
      target: { type: 'organization', id: ctx.organizationId },
      changedFields: sinceCleared
        ? ['token_alert_threshold', 'token_below_threshold_since']
        : ['token_alert_threshold'],
    });
    if (disabling) await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, ctx.organizationId);
    return updated;
  });
}

/**
 * Id các BTC mà job dò Token mỗi giờ đọc: có ngưỡng và dịch vụ thanh toán `active` (BTC Tạm ngừng bán đã có banner của
 * 4.2). Không qua `orgScope`: chỉ job nền của worker.
 */
export async function tokenAlertScanOrganizationIds(db: DbExecutor): Promise<string[]> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(isNotNull(organizations.tokenAlertThreshold), eq(organizations.paymentServiceStatus, PaymentServiceStatus.ACTIVE)))
    .orderBy(organizations.createdAt, organizations.id);
  return rows.map((row) => row.id);
}
