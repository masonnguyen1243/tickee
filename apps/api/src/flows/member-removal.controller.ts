import { Controller, Delete, HttpCode, Inject, Param } from '@nestjs/common';
import { Permission } from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { SheetRevocationQueues } from '../modules/integration/index.js';
import { Access, RequirePermission, type AccessContext } from '../platform/access/index.js';
import { DATABASE, type Database } from '../platform/db/index.js';
import { BOSS } from '../platform/jobs/index.js';
import { removeMember } from './member-removal.flow.js';

/**
 * Xóa Admin khỏi BTC (Story 2.4), chuyển từ `organizer/members.controller.ts` sang flows ở Story 6.6 (tiền lệ 3.10): cùng
 * method, đường dẫn, quyền (`members.manage`, chỉ Owner; Admin → `403 FORBIDDEN_ROLE`), `204` và `404`, nên web, test HTTP
 * và bộ test cách ly không đổi. Chờ queue email mất quyền Google Sheets sẵn sàng (ngoài transaction) rồi mới chạy flow.
 */
@Controller('orgs/:orgId')
export class MemberRemovalController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(SheetRevocationQueues) private readonly queues: SheetRevocationQueues,
  ) {}

  @Delete('members/:memberId')
  @HttpCode(204)
  @RequirePermission(Permission.MEMBERS_MANAGE)
  async remove(@Access() ctx: AccessContext, @Param('memberId') memberId: string): Promise<void> {
    await this.queues.ready();
    await removeMember(this.db, this.boss, ctx, memberId);
  }
}
