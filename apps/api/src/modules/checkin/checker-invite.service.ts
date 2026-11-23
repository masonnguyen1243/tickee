import { Inject, Injectable } from '@nestjs/common';
import {
  CHECKER_INVITE_TTL_DAYS,
  ErrorCode,
  EventStatus,
  toEventIso,
  type CheckerInvite,
  type CheckerInviteResponse,
  type CreatedCheckerInvite,
  type EventStatusConflictDetails,
} from '@tickee/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { checkinEventOf, lockEventForCheckerInvite, type LockedCheckinEventRef } from '../event/index.js';
import { effectiveExpiresAt, inviteActiveSql, timestamptzParam } from './invite-rule.js';
import { generateCheckerInviteToken, hashCheckerInviteToken } from './invite-token.js';
import { checkerInvites } from './schema.js';

/*
 * Link mời CTV chung của Sự kiện (Story 5.1, FR-26, AD-30). Owner và Admin (`checkers.manage`) đọc link mới nhất và
 * "Tạo link mới". Không có lệnh thu hồi riêng: tạo link mới là cách duy nhất thu hồi link cũ. Mọi mốc so với đồng hồ DB.
 * Token chỉ có trong kết quả `create`; audit chỉ ghi id link.
 */

const ci = checkerInvites;

type InviteRow = { id: string; createdAt: Date; expiresAt: Date; active: boolean };

const toInvite = (row: InviteRow): CheckerInvite => ({
  id: row.id,
  createdAt: toEventIso(row.createdAt),
  expiresAt: toEventIso(row.expiresAt),
  active: row.active,
});

/** Trạng thái chặn "Tạo link mới": đã hủy, chưa đăng (nháp), đã kết thúc (kể cả "Kết thúc" sớm). */
function assertCanInvite(event: LockedCheckinEventRef): void {
  if (event.status === EventStatus.CANCELLED) {
    throw new AppError(ErrorCode.EVENT_CANCELLED, 'Sự kiện đã hủy, không tạo được link mời CTV.');
  }
  if (event.status !== EventStatus.PUBLISHED && event.status !== EventStatus.HIDDEN) {
    const details: EventStatusConflictDetails = { status: event.status };
    throw new AppError(ErrorCode.EVENT_STATUS_CONFLICT, 'Đăng Sự kiện trước khi mời CTV.', { details });
  }
  if (event.ended) {
    throw new AppError(ErrorCode.EVENT_ALREADY_ENDED, 'Sự kiện đã kết thúc, không tạo được link mời CTV.');
  }
}

@Injectable()
export class CheckerInviteService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Link mới nhất của Sự kiện, chưa có thì `null`. Link chưa thu hồi (tối đa một) đứng trước; còn lại theo id (UUIDv7,
   * theo thứ tự INSERT, kể cả khi hai lần tạo song song có `created_at` = lúc bắt đầu transaction đảo nhau).
   * `active`: luật "link còn hiệu lực" dùng chung với nhận lời mời (`inviteActiveSql`).
   */
  async latest(ctx: AccessContext, eventId: string): Promise<CheckerInviteResponse> {
    const event = await checkinEventOf(this.db.orm, ctx, eventId);
    const [row] = await this.db.orm
      .select({
        id: ci.id,
        createdAt: ci.createdAt,
        expiresAt: effectiveExpiresAt(event.effectiveEndAt).mapWith(ci.expiresAt),
        active: inviteActiveSql(event),
      })
      .from(ci)
      .where(and(orgScope(ctx)(ci), eq(ci.eventId, event.id)))
      .orderBy(desc(sql`${ci.revokedAt} IS NULL`), desc(ci.id))
      .limit(1);
    return { invite: row ? toInvite(row) : null };
  }

  /**
   * "Tạo link mới" (`201`): khóa Sự kiện → kiểm trạng thái → thu hồi mọi link chưa thu hồi → INSERT link mới hạn
   * min(now + 7 ngày, `effective_end_at`), audit từng bước, tất cả trong một transaction. Hai lần tạo song song xếp hàng
   * trên khóa Sự kiện: lần sau thu hồi link của lần trước, nên luôn còn đúng một link chưa thu hồi.
   */
  async create(ctx: AccessContext, eventId: string): Promise<CreatedCheckerInvite> {
    return this.db.transaction(async (tx) => {
      const event = await lockEventForCheckerInvite(tx, ctx, eventId);
      assertCanInvite(event);

      const revoked = await tx
        .update(ci)
        .set({ revokedAt: sql`now()` })
        .where(and(orgScope(ctx)(ci), eq(ci.eventId, event.id), isNull(ci.revokedAt)))
        .returning({ id: ci.id });
      for (const { id } of revoked) {
        await audit.record(tx, {
          actorUserId: ctx.userId,
          organizationId: ctx.organizationId,
          action: 'checker_invite.revoked',
          target: { type: 'checker_invite', id },
        });
      }

      const token = generateCheckerInviteToken();
      const [created] = await tx
        .insert(ci)
        .values({
          organizationId: ctx.organizationId,
          eventId: event.id,
          tokenHash: hashCheckerInviteToken(token),
          expiresAt: sql`LEAST(now() + make_interval(days => ${CHECKER_INVITE_TTL_DAYS}), ${timestamptzParam(event.effectiveEndAt)})`,
        })
        .returning({
          id: ci.id,
          createdAt: ci.createdAt,
          expiresAt: ci.expiresAt,
          active: inviteActiveSql(event),
        });
      if (!created) throw new Error('INSERT checker_invites không trả về dòng nào');
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'checker_invite.created',
        target: { type: 'checker_invite', id: created.id },
      });
      return { invite: toInvite(created), token };
    });
  }
}
