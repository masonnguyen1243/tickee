import { Global, Module } from '@nestjs/common';
import { CHECKER_ACCESS_RESOLVER } from '../../platform/access/index.js';
import { CheckinAccessResolver } from './checker-access-resolver.impl.js';
import { CheckerInviteController } from './checker-invite.controller.js';
import { CheckerInviteService } from './checker-invite.service.js';
import { CheckinEventController } from './checkin-event.controller.js';

/**
 * Check-in (Epic 5): link mời CTV của Sự kiện (Story 5.1), quyền CTV và Sự kiện của Màn quét (Story 5.2). Cần `DbModule`
 * ở gốc DI. Không đăng ký `PermissionGuard` (guard toàn cục của `OrganizerModule`), nhưng cài cổng
 * `CHECKER_ACCESS_RESOLVER` mà guard đó dùng ở route `/v1/checkin/events/:eventId/…`. Toàn cục vì guard lấy DI trong
 * scope của `OrganizerModule`; guard inject cổng bằng `@Optional()`, nên app không nạp module này vẫn chạy route BTC.
 */
@Global()
@Module({
  controllers: [CheckerInviteController, CheckinEventController],
  providers: [CheckerInviteService, { provide: CHECKER_ACCESS_RESOLVER, useClass: CheckinAccessResolver }],
  exports: [CHECKER_ACCESS_RESOLVER],
})
export class CheckinModule {}
