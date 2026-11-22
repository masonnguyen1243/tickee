import { Module } from '@nestjs/common';
import { CheckerInviteController } from './checker-invite.controller.js';
import { CheckerInviteService } from './checker-invite.service.js';

/**
 * Check-in (Epic 5): link mời CTV của Sự kiện (Story 5.1). Cần `DbModule` ở gốc DI. Không đăng ký `PermissionGuard`:
 * guard đó đã là guard toàn cục của `OrganizerModule`.
 */
@Module({
  controllers: [CheckerInviteController],
  providers: [CheckerInviteService],
})
export class CheckinModule {}
