import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  maskEmail,
  ORGANIZATION_INVITATION_DAILY_LIMIT,
  ORGANIZATION_INVITATION_TTL_DAYS,
  Role,
  type AcceptedInvitation,
  type InvitationEmailMismatchDetails,
  type InvitationPreview,
  type MemberList,
  type OrganizationInvitation,
} from '@tickee/contracts';
import { and, asc, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { findUserIdByEmail, userContacts } from '../identity/index.js';
import { AdminInvitationQueues, enqueueAdminInvitation } from './invitation-jobs.js';
import { hashInvitationToken } from './invitation-token.js';
import { members, organizationInvitations, organizations } from './schema.js';

const inv = organizationInvitations;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invitationNotFound = () => new AppError(ErrorCode.NOT_FOUND, 'Không tìm thấy lời mời.');
const memberNotFound = () => new AppError(ErrorCode.NOT_FOUND, 'Không tìm thấy thành viên.');
const alreadyMember = () =>
  new AppError(ErrorCode.ALREADY_A_MEMBER, 'Email này đã là thành viên của BTC.', { details: { field: 'email' } });
const invitationInvalid = () => new AppError(ErrorCode.INVITATION_INVALID, 'Link mời không hợp lệ.');
const invitationExpired = () => new AppError(ErrorCode.INVITATION_EXPIRED, 'Link mời đã hết hạn.');
const invitationUsed = () => new AppError(ErrorCode.INVITATION_USED, 'Link mời đã được dùng.');

/** Tài khoản đang đăng nhập (đã qua `SessionGuard`); email Better Auth luôn chữ thường. */
export interface SessionUser {
  id: string;
  email: string;
}

/** Cột chung của một lời mời đang chờ; `expired` tính bằng giờ của DB. */
const pendingInvitationColumns = {
  id: inv.id,
  email: inv.email,
  expiresAt: inv.expiresAt,
  createdAt: inv.createdAt,
  expired: sql<boolean>`${inv.expiresAt} <= now()`,
};

type PendingInvitationRow = { id: string; email: string; expiresAt: Date; createdAt: Date; expired: boolean };

const toInvitation = (row: PendingInvitationRow): OrganizationInvitation => ({
  id: row.id,
  email: row.email,
  expiresAt: row.expiresAt.toISOString(),
  expired: row.expired,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Thành viên BTC và lời mời Admin (FR-2, FR-4, Story 2.4). Thao tác trên một BTC đi qua `orgScope(ctx)`; xem trước và
 * nhận lời mời tra theo hash của token (token là năng lực của link, không có ngữ cảnh BTC). Mọi thay đổi ghi audit
 * trong cùng `tx`, không ghi email.
 */
@Injectable()
export class MembersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(AdminInvitationQueues) private readonly queues: AdminInvitationQueues,
  ) {}

  /** Thành viên (Owner trước, rồi Admin theo thời điểm tham gia) và lời mời đang chờ (mới nhất trước). */
  async list(ctx: AccessContext): Promise<MemberList> {
    const memberRows = await this.db.orm
      .select({ id: members.id, userId: members.userId, role: members.role, createdAt: members.createdAt })
      .from(members)
      .where(orgScope(ctx)(members))
      .orderBy(sql`CASE WHEN ${members.role} = ${Role.OWNER} THEN 0 ELSE 1 END`, asc(members.createdAt), asc(members.id));
    const contacts = await userContacts(
      this.db.orm,
      memberRows.map((m) => m.userId),
    );
    const invitationRows = await this.db.orm
      .select(pendingInvitationColumns)
      .from(inv)
      .where(and(orgScope(ctx)(inv), isNull(inv.acceptedAt), isNull(inv.revokedAt)))
      .orderBy(desc(inv.createdAt), desc(inv.id));
    return {
      members: memberRows.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        email: contacts.get(m.userId)?.email ?? '',
        name: contacts.get(m.userId)?.name ?? '',
        joinedAt: m.createdAt.toISOString(),
      })),
      invitations: invitationRows.map(toInvitation),
    };
  }

  /**
   * Mời `email` (đã chuẩn hóa) làm Admin: một transaction gồm kiểm giới hạn 24 giờ, kiểm "đã là thành viên", thu hồi
   * lời mời còn treo của cùng email, tạo lời mời (hạn 7 ngày, chưa có token), audit, và enqueue job gửi email.
   */
  async invite(ctx: AccessContext, email: string): Promise<OrganizationInvitation> {
    // pg-boss đã start và queue đã có (ngoài transaction): `boss.send` cần cả hai.
    await this.queues.ready();
    return this.db.transaction(async (tx) => {
      // Khóa dòng BTC: lời mời của cùng BTC chạy tuần tự, nên giới hạn 24 giờ và "mời lại thì thu hồi" không đua nhau.
      const [org] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(orgScope(ctx)({ organizationId: organizations.id }))
        .for('update');
      if (!org) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');

      const [recent] = await tx
        .select({ n: count() })
        .from(inv)
        .where(and(orgScope(ctx)(inv), gt(inv.createdAt, sql`now() - interval '24 hours'`)));
      if ((recent?.n ?? 0) >= ORGANIZATION_INVITATION_DAILY_LIMIT) {
        throw new AppError(
          ErrorCode.INVITATION_LIMIT_REACHED,
          `Mỗi BTC gửi tối đa ${ORGANIZATION_INVITATION_DAILY_LIMIT} lời mời trong 24 giờ. Vui lòng thử lại sau.`,
        );
      }

      const userId = await findUserIdByEmail(tx, email);
      if (userId && (await this.isMember(tx, ctx.organizationId, userId))) throw alreadyMember();

      const revoked = await tx
        .update(inv)
        .set({ revokedAt: sql`now()` })
        .where(and(orgScope(ctx)(inv), eq(inv.email, email), isNull(inv.acceptedAt), isNull(inv.revokedAt)))
        .returning({ id: inv.id });
      for (const { id } of revoked) {
        await audit.record(tx, {
          actorUserId: ctx.userId,
          organizationId: ctx.organizationId,
          action: 'member.invitation_revoked',
          target: { type: 'organization_invitation', id },
        });
      }

      const [created] = await tx
        .insert(inv)
        .values({
          organizationId: ctx.organizationId,
          email,
          expiresAt: sql`now() + make_interval(days => ${ORGANIZATION_INVITATION_TTL_DAYS})`,
          invitedBy: ctx.userId,
        })
        .returning(pendingInvitationColumns);
      if (!created) throw new Error('INSERT organization_invitations không trả về dòng nào');
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'member.invited',
        target: { type: 'organization_invitation', id: created.id },
      });
      await enqueueAdminInvitation(this.boss, tx, created.id);
      return toInvitation(created);
    });
  }

  /** Thu hồi lời mời còn treo của BTC. Id lạ, đã nhận hoặc đã thu hồi → 404. */
  async revokeInvitation(ctx: AccessContext, invitationId: string): Promise<void> {
    if (!UUID.test(invitationId)) throw invitationNotFound();
    await this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(inv)
        .set({ revokedAt: sql`now()` })
        .where(and(orgScope(ctx)(inv), eq(inv.id, invitationId), isNull(inv.acceptedAt), isNull(inv.revokedAt)))
        .returning({ id: inv.id });
      if (!revoked) throw invitationNotFound();
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'member.invitation_revoked',
        target: { type: 'organization_invitation', id: revoked.id },
      });
    });
  }

  /**
   * Xóa một Admin khỏi BTC (chỉ dòng `role='admin'`, không bao giờ Owner). `AccessResolver` không cache vai, nên request
   * kế tiếp của người bị xóa nhận `NOT_A_MEMBER`. Owner, id lạ hoặc id của BTC khác → 404.
   */
  async removeMember(ctx: AccessContext, memberId: string): Promise<void> {
    if (!UUID.test(memberId)) throw memberNotFound();
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(members)
        .where(and(orgScope(ctx)(members), eq(members.id, memberId), eq(members.role, Role.ADMIN)))
        .returning({ userId: members.userId });
      if (!removed) throw memberNotFound();
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: ctx.organizationId,
        action: 'member.removed',
        target: { type: 'user', id: removed.userId },
        changedFields: ['role'],
      });
    });
  }

  /** Xem trước lời mời (route công khai): còn dùng được thì trả tên BTC, không thì lỗi nêu lý do. */
  async preview(token: string): Promise<InvitationPreview> {
    const [row] = await this.db.orm
      .select({
        organizationName: organizations.name,
        acceptedAt: inv.acceptedAt,
        revokedAt: inv.revokedAt,
        expired: sql<boolean>`${inv.expiresAt} <= now()`,
      })
      .from(inv)
      .innerJoin(organizations, eq(organizations.id, inv.organizationId))
      .where(eq(inv.tokenHash, hashInvitationToken(token)));
    if (!row || row.revokedAt) throw invitationInvalid();
    if (row.acceptedAt) throw invitationUsed();
    if (row.expired) throw invitationExpired();
    return { organizationName: row.organizationName };
  }

  /**
   * Nhận lời mời bằng tài khoản đang đăng nhập: đánh dấu đã dùng bằng compare-and-set (còn treo, chưa hết hạn, đúng
   * email) và tạo thành viên `admin` trong cùng `tx`, kèm audit. Hai lần nhận cùng lúc chỉ một lần thắng CAS; lần kia
   * (và mọi lần nhận lại sau đó của cùng người, khi vẫn còn là thành viên) trả cùng kết quả thành công.
   */
  async accept(user: SessionUser, token: string): Promise<AcceptedInvitation> {
    const tokenHash = hashInvitationToken(token);
    const email = user.email.toLowerCase();
    return this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(inv)
        .set({ acceptedAt: sql`now()`, acceptedBy: user.id })
        .where(
          and(
            eq(inv.tokenHash, tokenHash),
            isNull(inv.acceptedAt),
            isNull(inv.revokedAt),
            gt(inv.expiresAt, sql`now()`),
            eq(inv.email, email),
          ),
        )
        .returning({ organizationId: inv.organizationId });

      if (claimed) {
        const joined = await tx
          .insert(members)
          .values({ organizationId: claimed.organizationId, userId: user.id, role: Role.ADMIN })
          .onConflictDoNothing()
          .returning({ id: members.id });
        // Đã là thành viên (vd. Owner nhận lời mời gửi tới chính mình): rollback, lời mời vẫn còn treo.
        if (joined.length === 0) throw new AppError(ErrorCode.ALREADY_A_MEMBER, 'Bạn đã là thành viên của BTC này.');
        await audit.record(tx, {
          actorUserId: user.id,
          organizationId: claimed.organizationId,
          action: 'member.joined',
          target: { type: 'user', id: user.id },
          changedFields: ['role'],
        });
        return this.accepted(tx, claimed.organizationId);
      }

      // CAS không khớp: tìm lý do. `FOR UPDATE` chờ một lần nhận song song (nếu có) commit rồi mới đọc.
      const [row] = await tx
        .select({
          organizationId: inv.organizationId,
          email: inv.email,
          acceptedBy: inv.acceptedBy,
          revokedAt: inv.revokedAt,
          expired: sql<boolean>`${inv.expiresAt} <= now()`,
        })
        .from(inv)
        .where(eq(inv.tokenHash, tokenHash))
        .for('update');
      if (!row || row.revokedAt) throw invitationInvalid();
      if (row.acceptedBy !== null) {
        if (row.acceptedBy === user.id && (await this.isMember(tx, row.organizationId, user.id))) {
          return this.accepted(tx, row.organizationId);
        }
        throw invitationUsed();
      }
      if (row.expired) throw invitationExpired();
      if (row.email !== email) {
        const details: InvitationEmailMismatchDetails = { maskedEmail: maskEmail(row.email) };
        throw new AppError(ErrorCode.INVITATION_EMAIL_MISMATCH, 'Lời mời này gửi tới một email khác.', { details });
      }
      throw invitationInvalid();
    });
  }

  private async isMember(tx: Tx, organizationId: string, userId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(orgScope({ organizationId })(members), eq(members.userId, userId)));
    return row !== undefined;
  }

  private async accepted(tx: Tx, organizationId: string): Promise<AcceptedInvitation> {
    const [org] = await tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    if (!org) throw invitationInvalid();
    return { organizationId, organizationName: org.name, role: Role.ADMIN };
  }
}
