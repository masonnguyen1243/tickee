import { Module } from '@nestjs/common';
import { EventModule } from '../modules/event/index.js';
import { EventChangeEmailQueues } from '../modules/ordering/index.js';
import { CheckerInviteAcceptanceController } from './checker-invite.controller.js';
import { CheckinLookupController } from './checkin-lookup.controller.js';
import { CheckinScanController } from './checkin-scan.controller.js';
import { EventEditController } from './event-edit.controller.js';
import { TicketTypesController } from './ticket-types.controller.js';

/**
 * Tầng flows (AD-25): controller của luồng ghi chạm từ hai mô-đun trở lên. Cần `DbModule` và `JobsModule` (toàn cục) ở
 * gốc DI; guard quyền (`@RequirePermission`) là guard toàn cục của `OrganizerModule`. Import `EventModule` để dùng
 * chung `PublicPageQueues` (revalidate trang Sự kiện công khai khi Hạng vé hoặc thông tin Sự kiện đổi). `EventChangeEmailQueues`
 * tạo queue email báo Người mua đổi giờ/địa điểm (Story 3.10) mà lệnh sửa Sự kiện enqueue vào. Xem trước và nhận lời mời
 * CTV (Story 5.2) ghép `checkin`, `event` và `organizer`. Quét Mã QR vé (Story 5.3) ghép `ticketing` (check-in, khóa QR
 * toàn cục `TICKET_QR_KEYS`), `identity` và `organizer` (tên, vai người quét trước). Tra tay và check-in tay (Story 5.5)
 * ghép `ordering` (Đơn khớp SĐT/email), `ticketing` và bộ đếm tra tay của `checkin` (`CheckinLookupRateLimiter`, toàn
 * cục từ `CheckinLookupLimitModule`).
 */
@Module({
  imports: [EventModule],
  controllers: [
    TicketTypesController,
    EventEditController,
    CheckerInviteAcceptanceController,
    CheckinScanController,
    CheckinLookupController,
  ],
  providers: [EventChangeEmailQueues],
})
export class FlowsModule {}
