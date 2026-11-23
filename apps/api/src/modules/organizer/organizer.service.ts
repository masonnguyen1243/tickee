import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  Role,
  type CreatedOrganization,
  type CreateOrganizationRequest,
  type Membership,
  type Organization,
} from '@tickee/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database, type DbExecutor } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { userContacts } from '../identity/index.js';
import { members, organizations } from './schema.js';

/** Read model cho mô-đun khác (vd. trang Sự kiện công khai): tên BTC trong `scope`; `null` nếu BTC không còn. */
export async function organizationNameOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<string | null> {
  const [row] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(orgScope(scope)({ organizationId: organizations.id }));
  return row?.name ?? null;
}

/**
 * Read model cho Trang Đơn của Người mua (Story 3.7): tên và kênh liên hệ BTC (SĐT, email đã nhập khi tạo BTC; `null`
 * khi không nhập) trong `scope`; BTC không còn → `null`. Kênh liên hệ là PII của BTC: chỉ trả cho Người mua của Đơn,
 * không log.
 */
export async function organizerContactOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
): Promise<{ name: string; contactPhone: string | null; contactEmail: string | null } | null> {
  const [row] = await db
    .select({ name: organizations.name, contactPhone: organizations.contactPhone, contactEmail: organizations.contactEmail })
    .from(organizations)
    .where(orgScope(scope)({ organizationId: organizations.id }));
  return row ?? null;
}

/**
 * Read model cho nhật ký thao tác (Story 4.4, `reporting`): tên hiển thị của các thành viên *hiện tại* của BTC trong
 * `scope` theo lô id tài khoản, chỉ tên (không email). Tài khoản không có tên (đăng nhập OTP) → chuỗi rỗng; id không
 * phải thành viên BTC này (kể cả thành viên đã bị xóa) không có trong kết quả — bên gọi hiện tên chung. Danh sách rỗng →
 * không chạm DB.
 */
export async function memberNamesOf(
  db: DbExecutor,
  scope: Pick<AccessContext, 'organizationId'>,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ userId: members.userId })
    .from(members)
    .where(and(orgScope(scope)(members), inArray(members.userId, ids)));
  const contacts = await userContacts(
    db,
    rows.map((r) => r.userId),
  );
  return new Map(rows.map((r) => [r.userId, contacts.get(r.userId)?.name ?? '']));
}

/**
 * Read model vai của `userId` ở BTC `organizationId`; `null` khi không là thành viên (kể cả BTC không tồn tại). Cổng
 * `AccessResolver` (`PermissionGuard`) và luồng không qua guard (nhận lời mời CTV, Story 5.2: Owner/Admin quét không
 * cần lời mời) cùng đọc ở đây; nhận `tx` để đọc trong transaction của bên gọi.
 */
export async function memberRoleOf(db: DbExecutor, userId: string, organizationId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: members.role })
    .from(members)
    .where(and(orgScope({ organizationId })(members), eq(members.userId, userId)));
  return row?.role ?? null;
}

/** Body `POST /v1/orgs` sau khi qua schema (tên đã trim, liên hệ trống → `null`). */
export type CreateOrganizationInput = z.output<typeof CreateOrganizationRequest>;

@Injectable()
export class OrganizerService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Tạo BTC, người tạo thành Owner, ghi audit — một transaction. Người đã thuộc BTC khác vẫn tạo được.
   * Audit chỉ ghi tên trường `name` (không giá trị; kênh liên hệ không bao giờ vào audit).
   */
  async createOrganization(userId: string, input: CreateOrganizationInput): Promise<CreatedOrganization> {
    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({ name: input.name, contactPhone: input.contactPhone, contactEmail: input.contactEmail })
        .returning({ id: organizations.id, name: organizations.name });
      if (!org) throw new Error('INSERT organizations không trả về dòng nào');
      await tx.insert(members).values({ organizationId: org.id, userId, role: Role.OWNER });
      await audit.record(tx, {
        actorUserId: userId,
        organizationId: org.id,
        action: 'organization.created',
        target: { type: 'organization', id: org.id },
        changedFields: ['name'],
      });
      return { id: org.id, name: org.name, role: Role.OWNER };
    });
  }

  async getOrganization(ctx: AccessContext): Promise<Organization> {
    const [org] = await this.db.orm
      .select({
        id: organizations.id,
        name: organizations.name,
        contactPhone: organizations.contactPhone,
        contactEmail: organizations.contactEmail,
        createdAt: organizations.createdAt,
      })
      .from(organizations)
      .where(orgScope(ctx)({ organizationId: organizations.id }));
    // Guard đã xác nhận thành viên; BTC biến mất giữa chừng thì coi như không còn là thành viên.
    if (!org) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
    return { ...org, role: ctx.role, createdAt: org.createdAt.toISOString() };
  }

  /** BTC mà tài khoản là thành viên, theo thời điểm tham gia tăng dần. Không có kênh liên hệ. */
  listMemberships(userId: string): Promise<Membership[]> {
    return this.db.orm
      .select({ organizationId: members.organizationId, name: organizations.name, role: members.role })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(eq(members.userId, userId))
      .orderBy(asc(members.createdAt), asc(members.id));
  }

  /** Vai của `userId` ở BTC; `null` khi không là thành viên (kể cả BTC không tồn tại). */
  async roleOf(userId: string, organizationId: string): Promise<{ role: Role } | null> {
    const role = await memberRoleOf(this.db.orm, userId, organizationId);
    return role ? { role } : null;
  }
}
