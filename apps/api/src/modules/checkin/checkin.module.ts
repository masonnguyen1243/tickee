import { Global, Module, type DynamicModule } from '@nestjs/common';
import { CHECKER_ACCESS_RESOLVER } from '../../platform/access/index.js';
import { CheckinAccessResolver } from './checker-access-resolver.impl.js';
import { CheckerInviteController } from './checker-invite.controller.js';
import { CheckerInviteService } from './checker-invite.service.js';
import { CheckersController } from './checkers.controller.js';
import { CheckinEventController } from './checkin-event.controller.js';
import { CHECKIN_CONFIG, CheckinLookupRateLimiter, type CheckinConfig } from './lookup-rate-limit.js';

/**
 * Check-in (Epic 5): link mời CTV của Sự kiện (Story 5.1), quyền CTV và Sự kiện của Màn quét (Story 5.2), thu hồi và
 * khôi phục CTV (Story 5.6). Cần `DbModule` ở gốc DI. Không đăng ký `PermissionGuard` (guard toàn cục của
 * `OrganizerModule`), nhưng cài cổng `CHECKER_ACCESS_RESOLVER` mà guard đó dùng ở route `/v1/checkin/events/:eventId/…`.
 * Toàn cục vì guard lấy DI trong scope của `OrganizerModule`; guard inject cổng bằng `@Optional()`, nên app không nạp
 * module này vẫn chạy route BTC.
 */
@Global()
@Module({
  controllers: [CheckerInviteController, CheckersController, CheckinEventController],
  providers: [CheckerInviteService, { provide: CHECKER_ACCESS_RESOLVER, useClass: CheckinAccessResolver }],
  exports: [CHECKER_ACCESS_RESOLVER],
})
export class CheckinModule {}

/**
 * Bộ đếm giới hạn tốc độ tra tay (Story 5.5, AD-31) cho vai api: `CheckinLookupRateLimiter`, toàn cục để route tra tay ở
 * `flows` dùng. Tách khỏi `CheckinModule` (tĩnh) vì cần `config` (khóa HMAC IP), mà test thay hẳn `CheckinModule` theo
 * định danh lớp để kiểm guard khi không có cổng CTV. Cần `DbModule` ở gốc DI.
 */
@Global()
@Module({})
export class CheckinLookupLimitModule {
  static forRoot(config: CheckinConfig): DynamicModule {
    return {
      module: CheckinLookupLimitModule,
      providers: [
        { provide: CHECKIN_CONFIG, useValue: { BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET } satisfies CheckinConfig },
        CheckinLookupRateLimiter,
      ],
      exports: [CheckinLookupRateLimiter],
    };
  }
}
