import {
  CLOSED_BETA_TRANSITIONS,
  ErrorCode,
  Role,
  type ClosedBetaAction,
  type ClosedBetaOrganization,
  type ClosedBetaStatus,
  type ClosedBetaTransitionInvalidDetails,
} from '@tickee/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  orgScope,
  type AccessContext,
  type PlatformAdminContext,
  type PlatformAdminReader,
} from '../../platform/access/index.js';
import { audit, type AuditAction } from '../../platform/audit/index.js';
import type { Database, DbExecutor } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { userContacts } from '../identity/index.js';
import { members, organizations } from './schema.js';

/*
 * Closed Beta (FR-37, Story 2.5): `organizer` sở hữu `organizations.closed_beta_status`. Quản trị Tingee đổi trạng thái
 * (`changeClosedBetaStatus`) và đọc hàng duyệt (`listOrganizationsByClosedBeta`, chỉ qua `platformAdminScope`);
 * `reporting` đọc trạng thái của một BTC (`closedBetaStatusOf`, qua `orgScope`) để dựng banner.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const organizationNotFound = () => new AppError(ErrorCode.NOT_FOUND, 'Không tìm thấy BTC.');

const AUDIT_ACTION: Readonly<Record<ClosedBetaAction, AuditAction>> = {
  approve: 'organization.closed_beta_approved',
  revoke: 'organization.closed_beta_revoked',
};

/** `changed`: đã chuyển (có audit); `unchanged`: BTC đã ở trạng thái đích từ trước (không audit). */
export type ClosedBetaChange = 'changed' | 'unchanged';

/**
 * Duyệt (`pending|revoked → approved`) hoặc thu hồi (`approved → revoked`) Closed Beta của một BTC: compare-and-set
 * kèm audit `organization.closed_beta_approved|revoked` (`changedFields: ['closed_beta_status']`) trong một `tx`.
 * Hai Quản trị Tingee bấm cùng lúc: lần sau chờ khóa dòng rồi thấy trạng thái đích → `unchanged`, nên đúng một dòng
 * audit. Đã ở trạng thái đích → `unchanged`; trạng thái nguồn không hợp lệ → 409 `CLOSED_BETA_TRANSITION_INVALID`;
 * id lạ hoặc sai dạng → 404.
 */
export async function changeClosedBetaStatus(
  db: Database,
  ctx: PlatformAdminContext,
  organizationId: string,
  action: ClosedBetaAction,
): Promise<ClosedBetaChange> {
  if (!UUID.test(organizationId)) throw organizationNotFound();
  const id = organizationId.toLowerCase();
  const { from, to } = CLOSED_BETA_TRANSITIONS[action];
  return db.transaction(async (tx) => {
    const [changed] = await tx
      .update(organizations)
      .set({ closedBetaStatus: to, closedBetaChangedAt: sql`now()` })
      .where(and(eq(organizations.id, id), inArray(organizations.closedBetaStatus, [...from])))
      .returning({ id: organizations.id });
    if (changed) {
      await audit.record(tx, {
        actorUserId: ctx.userId,
        organizationId: id,
        action: AUDIT_ACTION[action],
        target: { type: 'organization', id },
        changedFields: ['closed_beta_status'],
      });
      return 'changed';
    }

    // CAS không khớp: tìm lý do (đọc sau khi lần đổi song song, nếu có, đã commit — READ COMMITTED).
    const [row] = await tx
      .select({ status: organizations.closedBetaStatus })
      .from(organizations)
      .where(eq(organizations.id, id));
    if (!row) throw organizationNotFound();
    if (row.status === to) return 'unchanged';
    const details: ClosedBetaTransitionInvalidDetails = { closedBetaStatus: row.status };
    throw new AppError(
      ErrorCode.CLOSED_BETA_TRANSITION_INVALID,
      action === 'revoke' ? 'Chỉ thu hồi được BTC đã được duyệt.' : 'Không duyệt được BTC ở trạng thái này.',
      { details },
    );
  });
}

/**
 * Hàng duyệt Closed Beta theo trạng thái, BTC tạo trước đứng trước, kèm email Owner (qua read model của `identity`)
 * và kênh liên hệ BTC. Đọc chéo mọi BTC nên chỉ nhận `tx` đã qua `platformAdminScope` (đã có audit).
 */
export async function listOrganizationsByClosedBeta(
  reader: PlatformAdminReader,
  status: ClosedBetaStatus,
): Promise<ClosedBetaOrganization[]> {
  const rows = await reader
    .select({
      id: organizations.id,
      name: organizations.name,
      contactPhone: organizations.contactPhone,
      contactEmail: organizations.contactEmail,
      closedBetaStatus: organizations.closedBetaStatus,
      createdAt: organizations.createdAt,
      ownerUserId: members.userId,
    })
    .from(organizations)
    .leftJoin(members, and(eq(members.organizationId, organizations.id), eq(members.role, Role.OWNER)))
    .where(eq(organizations.closedBetaStatus, status))
    .orderBy(asc(organizations.createdAt), asc(organizations.id));
  const contacts = await userContacts(
    reader,
    rows.flatMap((r) => (r.ownerUserId ? [r.ownerUserId] : [])),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    ownerEmail: r.ownerUserId ? (contacts.get(r.ownerUserId)?.email ?? null) : null,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    closedBetaStatus: r.closedBetaStatus,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Trạng thái Closed Beta của một BTC và mốc đổi gần nhất (để dựng `version` của banner). */
export interface ClosedBetaState {
  status: ClosedBetaStatus;
  /** `null` khi chưa từng đổi (vẫn `pending` từ lúc tạo). */
  changedAt: Date | null;
  createdAt: Date;
}

/** Read model cho mô-đun khác (vd. `reporting`): trạng thái Closed Beta của BTC trong `ctx`; `null` nếu BTC không còn. */
export async function closedBetaStatusOf(
  db: DbExecutor,
  ctx: Pick<AccessContext, 'organizationId'>,
): Promise<ClosedBetaState | null> {
  const [row] = await db
    .select({
      status: organizations.closedBetaStatus,
      changedAt: organizations.closedBetaChangedAt,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .where(orgScope(ctx)({ organizationId: organizations.id }));
  return row ?? null;
}
