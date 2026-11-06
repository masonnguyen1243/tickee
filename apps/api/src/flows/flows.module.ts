import { Module } from '@nestjs/common';
import { EventModule } from '../modules/event/index.js';
import { TicketTypesController } from './ticket-types.controller.js';

/**
 * Tầng flows (AD-25): controller của luồng ghi chạm từ hai mô-đun trở lên. Cần `DbModule` và `JobsModule` (toàn cục) ở
 * gốc DI; guard quyền (`@RequirePermission`) là guard toàn cục của `OrganizerModule`. Import `EventModule` để dùng
 * chung `PublicPageQueues` (revalidate trang Sự kiện công khai khi Hạng vé đổi).
 */
@Module({ imports: [EventModule], controllers: [TicketTypesController] })
export class FlowsModule {}
