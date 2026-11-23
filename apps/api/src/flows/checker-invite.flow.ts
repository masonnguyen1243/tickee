import {
  Permission,
  roleHasPermission,
  type AcceptedCheckerInvite,
  type CheckerInvitePreview,
} from '@tickee/contracts';
import {
  checkerInviteActive,
  checkerInviteByToken,
  checkerInviteInvalid,
  checkerRevoked,
  checkerStatusOf,
  joinChecker,
} from '../modules/checkin/index.js';
import { checkinEventById, lockCheckinEventByIdForShare, type CheckinEventDetail } from '../modules/event/index.js';
import { memberRoleOf, organizationNameOf } from '../modules/organizer/index.js';
import { audit } from '../platform/audit/index.js';
import type { Database, DbExecutor } from '../platform/db/index.js';

/*
 * Nhận lời mời CTV (Story 5.2, FR-26, FR-29, AD-30). Ở flows vì cần cả `checkin` (link, `checkers`), `event` (Sự kiện của
 * link) và `organizer` (tên BTC; Owner/Admin quét không cần lời mời), mà `checkin` không được gọi `organizer`. Luật "link
 * còn hiệu lực" là `checkerInviteActive` của `checkin` (cùng luật với badge ở tab Check-in). Mọi lỗi về link là `404
 * CHECKER_INVITE_INVALID`, không lộ tên Sự kiện, tên BTC hay id. Token chỉ được `checkin` băm để tìm link; không vào log
 * hay audit.
 */

/** Owner/Admin của BTC sở hữu Sự kiện quét được mà không cần lời mời (ma trận quyền FR-4, `checkin.scan`). */
async function organizerCanScan(db: DbExecutor, userId: string, event: CheckinEventDetail): Promise<boolean> {
  const role = await memberRoleOf(db, userId, event.organizationId);
  return role !== null && roleHasPermission(role, Permission.CHECKIN_SCAN);
}

/** Người xem đã có quyền quét Sự kiện: Owner/Admin của BTC sở hữu, hoặc CTV `active`. */
async function canScan(db: DbExecutor, userId: string, event: CheckinEventDetail): Promise<boolean> {
  if (await organizerCanScan(db, userId, event)) return true;
  return (await checkerStatusOf(db, event, event.id, userId)) === 'active';
}

/**
 * Xem trước link mời (`userId` `null` khi ẩn danh), theo thứ tự: không link nào khớp hash → 404; người xem đã có quyền
 * quét → kèm `scanEventId` (kể cả khi link đã hết hiệu lực: mở lại link để quay lại Màn quét); link không còn hiệu lực
 * → 404; còn lại `scanEventId: null`.
 */
export async function previewCheckerInvite(
  db: Database,
  userId: string | null,
  token: string,
): Promise<CheckerInvitePreview> {
  const invite = await checkerInviteByToken(db.orm, token);
  if (!invite) throw checkerInviteInvalid();
  const event = await checkinEventById(db.orm, invite.eventId);
  if (!event) throw checkerInviteInvalid();

  const scanner = userId !== null && (await canScan(db.orm, userId, event));
  if (!scanner && !(await checkerInviteActive(db.orm, invite, event))) throw checkerInviteInvalid();
  const organizationName = await organizationNameOf(db.orm, event);
  if (organizationName === null) throw checkerInviteInvalid();
  return { eventName: event.name, organizationName, scanEventId: scanner ? event.id : null };
}

/**
 * Nhận lời mời bằng tài khoản đang đăng nhập, một transaction: không link nào khớp hash → 404; khóa Sự kiện `FOR SHARE`
 * (mọi lệnh ghi của BTC lên Sự kiện chờ lần nhận này); Owner/Admin hoặc đã là CTV `active` → trả `eventId`, không ghi gì;
 * đang có dòng `revoked` → `403 CHECKER_REVOKED`; link không còn hiệu lực → 404; còn lại ghi dòng `active` kèm audit
 * `checker.joined`. Hai lần nhận song song của cùng người chỉ ra một dòng (lần sau đọc lại dòng của lần đầu).
 */
export async function acceptCheckerInvite(db: Database, userId: string, token: string): Promise<AcceptedCheckerInvite> {
  return db.transaction(async (tx) => {
    const invite = await checkerInviteByToken(tx, token);
    if (!invite) throw checkerInviteInvalid();
    const event = await lockCheckinEventByIdForShare(tx, invite.eventId);
    if (!event) throw checkerInviteInvalid();
    const accepted: AcceptedCheckerInvite = { eventId: event.id };

    if (await organizerCanScan(tx, userId, event)) return accepted;
    const status = await checkerStatusOf(tx, event, event.id, userId);
    if (status === 'active') return accepted;
    if (status === 'revoked') throw checkerRevoked();
    if (!(await checkerInviteActive(tx, invite, event))) throw checkerInviteInvalid();

    const checker = await joinChecker(tx, event, event.id, userId);
    if (!checker.joined) {
      // Lần nhận song song khác đã ghi trước; bị thu hồi xen giữa thì không kích hoạt lại.
      if (checker.status === 'revoked') throw checkerRevoked();
      return accepted;
    }
    await audit.record(tx, {
      actorUserId: userId,
      organizationId: event.organizationId,
      action: 'checker.joined',
      target: { type: 'checker', id: checker.id },
    });
    return accepted;
  });
}
