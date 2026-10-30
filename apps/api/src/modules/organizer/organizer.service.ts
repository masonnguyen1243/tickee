import { Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  Role,
  type CreatedOrganization,
  type CreateOrganizationRequest,
  type Membership,
  type Organization,
} from '@tickee/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import { audit } from '../../platform/audit/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { members, organizations } from './schema.js';

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
    const [row] = await this.db.orm
      .select({ role: members.role })
      .from(members)
      .where(and(orgScope({ organizationId })(members), eq(members.userId, userId)));
    return row ?? null;
  }
}
