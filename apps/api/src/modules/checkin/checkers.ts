import { ErrorCode } from '@tickee/contracts';
import { and, eq } from 'drizzle-orm';
import { orgScope, type AccessContext, type CheckerStatus } from '../../platform/access/index.js';
import type { DbExecutor, Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { inviteActiveSql, type InviteEventState } from './invite-rule.js';
import { hashCheckerInviteToken } from './invite-token.js';
import { checkerInvites, checkers } from './schema.js';

/*
 * Phần `checkin` mà luồng nhận lời mời CTV (`flows.acceptCheckerInvite`, `flows.previewCheckerInvite`, Story 5.2) và cổng
 * quyền CTV cần. Token chỉ vào đây và chỉ được băm: không trả ra, không log. Đọc theo BTC qua `orgScope`, trừ một ngoại
 * lệ có chủ ý: `checkerInviteByToken` tìm link theo hash token trên mọi BTC (người mở link chưa thuộc BTC nào; token 128
 * bit là khóa tra), rồi các bước sau dùng BTC của chính link đó.
 */

const ci = checkerInvites;

type Scope = Pick<AccessContext, 'organizationId'>;

/** Link mời CTV tìm theo token: BTC và Sự kiện của link (không token, không hash). */
export interface CheckerInviteRef {
  id: string;
  organizationId: string;
  eventId: string;
}

/** Mọi lỗi về link (sai, sai dạng, hết hạn, bị thu hồi, Sự kiện đã hủy hay đã kết thúc): một mã, một câu, không dữ liệu. */
export const checkerInviteInvalid = () =>
  new AppError(ErrorCode.CHECKER_INVITE_INVALID, 'Link mời đã hết hạn. Liên hệ BTC để nhận link mới.');

/** CTV đã bị thu hồi ở Sự kiện này: không tự kích hoạt lại bằng link (Story 5.6 mới "Khôi phục"). */
export const checkerRevoked = () =>
  new AppError(ErrorCode.CHECKER_REVOKED, 'Bạn không còn quyền soát vé cho Sự kiện này.');

/**
 * Link mời khớp hash của `token`, kể cả link đã hết hạn hay bị thu hồi (bên gọi áp luật hiệu lực sau); không có → `null`.
 * Token sai dạng chỉ là một token không khớp link nào.
 */
export async function checkerInviteByToken(db: DbExecutor, token: string): Promise<CheckerInviteRef | null> {
  const [row] = await db
    .select({ id: ci.id, organizationId: ci.organizationId, eventId: ci.eventId })
    .from(ci)
    .where(eq(ci.tokenHash, hashCheckerInviteToken(token)));
  return row ?? null;
}

/** Link `invite` còn hiệu lực với Sự kiện `event` của nó (luật chung `inviteActiveSql`, so bằng `now()` của DB). */
export async function checkerInviteActive(
  db: DbExecutor,
  invite: CheckerInviteRef,
  event: InviteEventState,
): Promise<boolean> {
  const [row] = await db
    .select({ active: inviteActiveSql(event) })
    .from(ci)
    .where(and(orgScope(invite)(ci), eq(ci.id, invite.id)));
  return row?.active === true;
}

/** Trạng thái CTV của `userId` ở Sự kiện `eventId` của BTC `scope`; chưa từng nhận lời mời → `null`. */
export async function checkerStatusOf(
  db: DbExecutor,
  scope: Scope,
  eventId: string,
  userId: string,
): Promise<CheckerStatus | null> {
  const [row] = await db
    .select({ status: checkers.status })
    .from(checkers)
    .where(and(orgScope(scope)(checkers), eq(checkers.eventId, eventId), eq(checkers.userId, userId)));
  return row?.status ?? null;
}

/**
 * Ghi `userId` làm CTV `active` của Sự kiện `eventId` (BTC `scope`) trong `tx` của bên gọi: `INSERT … ON CONFLICT DO
 * NOTHING` trên unique `(event_id, user_id)`, rồi đọc lại khi trùng. Hai lần nhận song song của cùng người: lần sau chờ
 * lần đầu commit rồi không chèn gì, nên chỉ có một dòng. `joined`: dòng vừa được chèn (bên gọi ghi audit); `false` thì
 * `status` là trạng thái của dòng đã có (có thể đã bị thu hồi xen giữa).
 */
export async function joinChecker(
  tx: Tx,
  scope: Scope,
  eventId: string,
  userId: string,
): Promise<{ id: string; joined: boolean; status: CheckerStatus }> {
  const [inserted] = await tx
    .insert(checkers)
    .values({ organizationId: scope.organizationId, eventId, userId, status: 'active' })
    .onConflictDoNothing({ target: [checkers.eventId, checkers.userId] })
    .returning({ id: checkers.id });
  if (inserted) return { id: inserted.id, joined: true, status: 'active' };

  const [existing] = await tx
    .select({ id: checkers.id, status: checkers.status })
    .from(checkers)
    .where(and(orgScope(scope)(checkers), eq(checkers.eventId, eventId), eq(checkers.userId, userId)));
  if (!existing) throw new Error('INSERT checkers trùng khóa nhưng không đọc lại được dòng');
  return { id: existing.id, joined: false, status: existing.status };
}
