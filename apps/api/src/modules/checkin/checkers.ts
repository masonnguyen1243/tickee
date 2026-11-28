import { CheckerAction, ErrorCode } from '@tickee/contracts';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { orgScope, type AccessContext, type CheckerStatus } from '../../platform/access/index.js';
import { audit, type AuditAction } from '../../platform/audit/index.js';
import type { Database, DbExecutor, Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { lockEventForCheckerInvite } from '../event/index.js';
import { inviteActiveSql, type InviteEventState } from './invite-rule.js';
import { hashCheckerInviteToken } from './invite-token.js';
import { checkerInvites, checkers } from './schema.js';

/*
 * Phần `checkin` mà luồng nhận lời mời CTV (`flows.acceptCheckerInvite`, `flows.previewCheckerInvite`, Story 5.2), cổng
 * quyền CTV, danh sách CTV (`flows`, Story 5.6), "Thu hồi"/"Khôi phục" (Story 5.6) và xóa Admin (`flows.removeMember`,
 * Story 6.6) cần. Token chỉ vào đây và chỉ được
 * băm: không trả ra, không log. Đọc theo BTC qua `orgScope`, trừ một ngoại lệ có chủ ý: `checkerInviteByToken` tìm link
 * theo hash token trên mọi BTC (người mở link chưa thuộc BTC nào; token 128 bit là khóa tra), rồi các bước sau dùng BTC
 * của chính link đó.
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

// ---------------------------------------------------------------------------------------------------------------
// Danh sách, thu hồi, khôi phục CTV (Story 5.6, FR-26, AD-30)
// ---------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `checkerId` sai dạng, lạ hoặc của Sự kiện khác: một mã, một câu. */
const checkerNotFound = () => new AppError(ErrorCode.NOT_FOUND, 'CTV này không còn trong Sự kiện.');

/** Một dòng `checkers` cho danh sách CTV của BTC (tên, email đọc ở `flows` qua `identity`). */
export interface CheckerRow {
  id: string;
  userId: string;
  status: CheckerStatus;
  /** Lúc nhận lời mời lần đầu (`created_at`). */
  acceptedAt: Date;
  revokedAt: Date | null;
}

/**
 * Mọi CTV của Sự kiện `eventId` (BTC `scope`), kể cả đã bị thu hồi, theo lúc nhận lời mời tăng dần (rồi id, UUIDv7):
 * thứ tự không đổi khi đổi trạng thái. Bên gọi đã kiểm Sự kiện thuộc BTC.
 */
export async function checkersOf(db: DbExecutor, scope: Scope, eventId: string): Promise<CheckerRow[]> {
  return db
    .select({
      id: checkers.id,
      userId: checkers.userId,
      status: checkers.status,
      acceptedAt: checkers.createdAt,
      revokedAt: checkers.revokedAt,
    })
    .from(checkers)
    .where(and(orgScope(scope)(checkers), eq(checkers.eventId, eventId)))
    .orderBy(asc(checkers.createdAt), asc(checkers.id));
}

/** Trạng thái đích và audit của mỗi thao tác. */
const ACTION_RULES = {
  [CheckerAction.REVOKE]: { status: 'revoked', audit: 'checker.revoked' },
  [CheckerAction.RESTORE]: { status: 'active', audit: 'checker.restored' },
} as const satisfies Record<CheckerAction, { status: CheckerStatus; audit: AuditAction }>;

/**
 * "Thu hồi" (`revoke`) hoặc "Khôi phục" (`restore`) CTV `checkerId` của Sự kiện `eventId`, một transaction:
 * 1. khóa Sự kiện của BTC `FOR UPDATE` (`lockEventForCheckerInvite`; lạ, sai dạng, của BTC khác → `404 EVENT_NOT_FOUND`):
 *    hai lần bấm đồng thời xếp hàng, và chạy tuần tự với "Kết thúc";
 * 2. khôi phục khi Sự kiện đã kết thúc → `409 EVENT_ALREADY_ENDED`; thu hồi không bị chặn theo thời gian;
 * 3. `UPDATE` có điều kiện trên `status` trong `orgScope` và `event_id`: thu hồi ghi `revoked` + người bấm + `now()`;
 *    khôi phục ghi `active` và xóa `revoked_*` (lịch sử ở audit);
 * 4. không dòng nào đổi: dòng đã ở trạng thái đích → xong, không ghi gì, không audit (lần bấm trước giữ người/lúc thu
 *    hồi); không có dòng (`checkerId` sai dạng, lạ, của Sự kiện khác) → `404 NOT_FOUND`;
 * 5. audit `checker.revoked` / `checker.restored` (`changedFields: ['status']`).
 * Không đẩy realtime: Màn quét đang mở của CTV đổi ở request kế tiếp (quyền đọc lại ở mỗi request).
 */
export async function setCheckerStatus(
  db: Database,
  ctx: AccessContext,
  eventId: string,
  checkerId: string,
  action: CheckerAction,
): Promise<void> {
  const rule = ACTION_RULES[action];
  await db.transaction(async (tx) => {
    const event = await lockEventForCheckerInvite(tx, ctx, eventId);
    if (action === CheckerAction.RESTORE && event.ended) {
      throw new AppError(ErrorCode.EVENT_ALREADY_ENDED, 'Sự kiện đã kết thúc, không khôi phục được CTV.');
    }
    if (!UUID.test(checkerId)) throw checkerNotFound();

    const target = and(orgScope(ctx)(checkers), eq(checkers.eventId, event.id), eq(checkers.id, checkerId));
    const [changed] = await tx
      .update(checkers)
      .set(
        rule.status === 'revoked'
          ? { status: 'revoked', revokedBy: ctx.userId, revokedAt: sql`now()` }
          : { status: 'active', revokedBy: null, revokedAt: null },
      )
      .where(and(target, ne(checkers.status, rule.status)))
      .returning({ id: checkers.id });
    if (!changed) {
      const [existing] = await tx.select({ id: checkers.id }).from(checkers).where(target);
      if (!existing) throw checkerNotFound();
      return;
    }
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: rule.audit,
      target: { type: 'checker', id: changed.id },
      changedFields: ['status'],
    });
  });
}

/**
 * Admin `userId` vừa bị xóa khỏi BTC (Story 6.6, gộp phần "removeMember thu hồi dòng checkers trong BTC" của E5-1), trong
 * `tx` của `flows.removeMember`: mọi dòng `checkers` còn `active` của người đó trong các Sự kiện của BTC `ctx` chuyển
 * `revoked`, người thu hồi là người xóa (`ctx.userId`), lúc thu hồi `now()`; mỗi dòng đổi một audit `checker.revoked`
 * (`changedFields: ['status']`), như "Thu hồi" (`setCheckerStatus`). Dòng đã `revoked` giữ người và lúc thu hồi cũ. Không
 * đẩy realtime: quyền CTV đọc lại ở mỗi request. Trả id các dòng vừa thu hồi.
 */
export async function revokeCheckersOfMember(tx: Tx, ctx: AccessContext, userId: string): Promise<string[]> {
  const rule = ACTION_RULES[CheckerAction.REVOKE];
  const revoked = await tx
    .update(checkers)
    .set({ status: rule.status, revokedBy: ctx.userId, revokedAt: sql`now()` })
    .where(and(orgScope(ctx)(checkers), eq(checkers.userId, userId), eq(checkers.status, 'active')))
    .returning({ id: checkers.id });
  for (const { id } of revoked) {
    await audit.record(tx, {
      actorUserId: ctx.userId,
      organizationId: ctx.organizationId,
      action: rule.audit,
      target: { type: 'checker', id },
      changedFields: ['status'],
    });
  }
  return revoked.map((row) => row.id);
}
