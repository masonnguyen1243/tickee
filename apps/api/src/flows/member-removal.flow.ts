import type { PgBoss } from 'pg-boss';
import { revokeCheckersOfMember } from '../modules/checkin/index.js';
import { revokeSheetConnectionsOfGrantor } from '../modules/integration/index.js';
import { removeAdminMember } from '../modules/organizer/index.js';
import type { AccessContext } from '../platform/access/index.js';
import type { Database } from '../platform/db/index.js';

/*
 * Xóa Admin khỏi BTC (Story 2.4; Story 6.6, FR-32, AD-23, AD-25): ở flows vì một lệnh ghi ba mô-đun trong một
 * transaction, mà `organizer` không được gọi `checkin` hay `integration`. Rollback (lỗi DB, lỗi enqueue…) thì Admin chưa
 * bị xóa, không dòng CTV nào đổi, không kết nối nào chuyển `auth_revoked`, không email nào. Người gọi đã
 * `SheetRevocationQueues.ready()` trước transaction.
 */

/** Kết quả xóa Admin (cho test và log): tài khoản bị xóa, CTV vừa thu hồi, kết nối Google Sheets vừa chuyển mất quyền. */
export interface MemberRemoval {
  userId: string;
  revokedCheckerIds: string[];
  revokedSheetConnectionIds: string[];
}

/**
 * `DELETE /v1/orgs/:orgId/members/:memberId`, một transaction:
 * 1. xóa dòng `members` `role='admin'` + audit `member.removed` (`organizer.removeAdminMember`; Owner, id lạ, sai dạng
 *    hay của BTC khác → `404 NOT_FOUND`);
 * 2. thu hồi mọi dòng CTV `active` của người đó trong các Sự kiện của BTC + audit `checker.revoked` mỗi dòng
 *    (`checkin.revokeCheckersOfMember`, Quyết định 1 của Story 6.6);
 * 3. mọi kết nối Google Sheets người đó cấp trong BTC chuyển `auth_revoked` (`grantor_removed`), mỗi kết nối một job
 *    email, phát `org_status_changed` (`integration.revokeSheetConnectionsOfGrantor`).
 */
export async function removeMember(
  db: Database,
  boss: PgBoss,
  ctx: AccessContext,
  memberId: string,
): Promise<MemberRemoval> {
  return db.transaction(async (tx) => {
    const { userId } = await removeAdminMember(tx, ctx, memberId);
    const revokedCheckerIds = await revokeCheckersOfMember(tx, ctx, userId);
    const revokedSheetConnectionIds = await revokeSheetConnectionsOfGrantor(tx, boss, ctx.organizationId, userId);
    return { userId, revokedCheckerIds, revokedSheetConnectionIds };
  });
}
