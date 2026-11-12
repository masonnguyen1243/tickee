import { Module } from '@nestjs/common';
import { EventModule } from '../modules/event/index.js';
import { EventChangeEmailQueues } from '../modules/ordering/index.js';
import { EventEditController } from './event-edit.controller.js';
import { TicketTypesController } from './ticket-types.controller.js';

/**
 * Tầng flows (AD-25): controller của luồng ghi chạm từ hai mô-đun trở lên. Cần `DbModule` và `JobsModule` (toàn cục) ở
 * gốc DI; guard quyền (`@RequirePermission`) là guard toàn cục của `OrganizerModule`. Import `EventModule` để dùng
 * chung `PublicPageQueues` (revalidate trang Sự kiện công khai khi Hạng vé hoặc thông tin Sự kiện đổi). `EventChangeEmailQueues`
 * tạo queue email báo Người mua đổi giờ/địa điểm (Story 3.10) mà lệnh sửa Sự kiện enqueue vào.
 */
@Module({
  imports: [EventModule],
  controllers: [TicketTypesController, EventEditController],
  providers: [EventChangeEmailQueues],
})
export class FlowsModule {}
