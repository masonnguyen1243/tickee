import { Inject, Injectable } from '@nestjs/common';
import {
  JobQueue,
  NOTIFICATION_CATALOG,
  RealtimeTopic,
  SheetConnectionStatus,
  SheetsAuthRevokedEmailPayload,
  SheetSyncErrorCode,
} from '@tickee/contracts';
import { and, asc, eq, ne, sql, type SQL } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { BOSS, defineQueue, derivedJobId, QueueProducer } from '../../platform/jobs/index.js';
import { realtime } from '../../platform/realtime/index.js';
import { sheetConnections } from './schema.js';

/*
 * Kết nối Google Sheets chuyển `auth_revoked` (Story 6.6, FR-32, AD-23, AD-34). Hai nguồn, chung một cách chuyển:
 * - lỗi Google ở lần đẩy đầu hay flush (`invalid_grant`, 401, 403 không vì quota): `revokeSheetConnection`;
 * - người cấp OAuth bị xóa khỏi BTC (`flows.removeMember`): `revokeSheetConnectionsOfGrantor`, mã `grantor_removed`.
 * Trong `tx` của người gọi, CAS `status <> 'auth_revoked'`: đặt `status`, `last_error_code`, `auth_revoked_at = now()`,
 * enqueue job gốc email mất quyền (id cố định theo kết nối và mốc) và phát `org_status_changed` (banner hiện ngay qua
 * SSE). Kết nối đã `auth_revoked` thì không đổi gì: giữ mã và mốc đầu tiên, không email thứ hai. Dòng bẩn giữ nguyên,
 * không thử lại; "Kết nối lại" ghi bù. Không gọi Google (không bao giờ gọi endpoint revoke: nó hủy cả grant của tài
 * khoản đó, làm hỏng kết nối Sự kiện khác của cùng người cấp).
 */

/** Queue email mất quyền, đọc từ danh mục thông báo (nguồn duy nhất). */
const EMAIL_QUEUE = NOTIFICATION_CATALOG.sheets_auth_revoked.emailQueue;

/**
 * Queue email mất quyền Google Sheets (job gốc và job con chung queue). Retry và dead-letter như email cảnh báo Token: 8
 * lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ), hết lượt thì sang dead-letter. Lô tối đa 10 job, lấy tiếp ngay khi lô
 * đầy; mỗi job được chốt riêng.
 */
export const SHEETS_AUTH_REVOKED_EMAIL_QUEUE = defineQueue({
  name: EMAIL_QUEUE,
  deadLetter: JobQueue.INTEGRATION_SHEETS_AUTH_REVOKED_EMAIL_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: SheetsAuthRevokedEmailPayload,
});

/**
 * Id job gốc email của một lần mất quyền: suy cố định từ id kết nối và mốc (`derivedJobId(connectionId, '<queue>:<mốc
 * ISO>')`), nên enqueue lặp cho cùng lần mất quyền không tạo job thứ hai.
 */
export const sheetsAuthRevokedEmailJobId = (connectionId: string, authRevokedAt: Date): string =>
  derivedJobId(connectionId, `${EMAIL_QUEUE}:${authRevokedAt.toISOString()}`);

/**
 * Start pg-boss và tạo queue email mất quyền (gọi lại không sao). Vai api: luồng xóa thành viên (`flows`) gọi `ready()`
 * trước transaction. Vai worker: lần đẩy đầu và flush tạo queue lúc khởi động (`ensure`). Không đăng ký handler.
 */
@Injectable()
export class SheetRevocationQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, SHEETS_AUTH_REVOKED_EMAIL_QUEUE, 'khi kết nối Google Sheets mất quyền');
  }
}

const revokedColumns = {
  id: sheetConnections.id,
  organizationId: sheetConnections.organizationId,
  authRevokedAt: sheetConnections.authRevokedAt,
};

/** Chuyển `auth_revoked` mọi kết nối khớp `target` (chưa `auth_revoked`), rồi email và tín hiệu; trả id đã chuyển. */
async function revokeWhere(tx: Tx, boss: PgBoss, target: SQL | undefined, code: SheetSyncErrorCode): Promise<string[]> {
  const rows = await tx
    .update(sheetConnections)
    .set({
      status: SheetConnectionStatus.AUTH_REVOKED,
      lastErrorCode: code,
      authRevokedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(target, ne(sheetConnections.status, SheetConnectionStatus.AUTH_REVOKED)))
    .returning(revokedColumns);
  for (const row of rows) {
    const authRevokedAt = row.authRevokedAt!;
    await SHEETS_AUTH_REVOKED_EMAIL_QUEUE.enqueue(
      boss,
      tx,
      { connectionId: row.id, authRevokedAt: authRevokedAt.toISOString() },
      { id: sheetsAuthRevokedEmailJobId(row.id, authRevokedAt) },
    );
  }
  for (const organizationId of new Set(rows.map((row) => row.organizationId))) {
    await realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, organizationId);
  }
  return rows.map((row) => row.id);
}

/**
 * Lỗi Google mất quyền ở lần đẩy đầu hay flush: chuyển kết nối `connectionId` sang `auth_revoked` với mã `code` (xem chú
 * thích đầu file). `false` khi kết nối đã bị xóa hoặc đã `auth_revoked` (không đổi gì). Người gọi đã có queue email
 * (vai worker tạo lúc khởi động).
 */
export async function revokeSheetConnection(
  tx: Tx,
  boss: PgBoss,
  connectionId: string,
  code: SheetSyncErrorCode,
): Promise<boolean> {
  return (await revokeWhere(tx, boss, eq(sheetConnections.id, connectionId), code)).length > 0;
}

/**
 * Người cấp `userId` vừa bị xóa khỏi BTC `organizationId` (cùng `tx` xóa thành viên): mọi kết nối người đó cấp trong BTC
 * chuyển `auth_revoked` với mã `grantor_removed`, mỗi kết nối một email (một tín hiệu cho cả BTC). Trả id các kết nối vừa
 * chuyển (rỗng khi người đó không cấp kết nối nào, hay mọi kết nối đã `auth_revoked`). Người gọi đã
 * `SheetRevocationQueues.ready()` trước transaction.
 */
export async function revokeSheetConnectionsOfGrantor(
  tx: Tx,
  boss: PgBoss,
  organizationId: string,
  userId: string,
): Promise<string[]> {
  return revokeWhere(
    tx,
    boss,
    and(orgScope({ organizationId })(sheetConnections), eq(sheetConnections.grantedByUserId, userId)),
    SheetSyncErrorCode.GRANTOR_REMOVED,
  );
}

/** Một kết nối mất quyền, cho banner (`reporting.notices`). */
export interface RevokedSheetConnection {
  eventId: string;
  /** Lúc mất quyền (`version` của banner). */
  authRevokedAt: Date;
  lastErrorCode: SheetSyncErrorCode | null;
}

/**
 * Read model cho `reporting.notices` (Story 6.6): mọi kết nối `auth_revoked` của BTC trong `scope` (qua `orgScope`), mất
 * quyền trước đứng trước (rồi theo Sự kiện). Không có token, id spreadsheet hay người cấp.
 */
export async function revokedSheetConnectionsOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<RevokedSheetConnection[]> {
  const rows = await db
    .select({
      eventId: sheetConnections.eventId,
      authRevokedAt: sheetConnections.authRevokedAt,
      lastErrorCode: sheetConnections.lastErrorCode,
    })
    .from(sheetConnections)
    .where(
      and(orgScope(scope)(sheetConnections), eq(sheetConnections.status, SheetConnectionStatus.AUTH_REVOKED)),
    )
    .orderBy(asc(sheetConnections.authRevokedAt), asc(sheetConnections.eventId));
  return rows.flatMap((row) =>
    row.authRevokedAt
      ? [
          {
            eventId: row.eventId,
            authRevokedAt: row.authRevokedAt,
            lastErrorCode: row.lastErrorCode as SheetSyncErrorCode | null,
          },
        ]
      : [],
  );
}
