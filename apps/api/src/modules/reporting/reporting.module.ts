import { Module } from '@nestjs/common';
import { EventOverviewController } from './event-overview.controller.js';
import { EventOverviewService } from './event-overview.service.js';
import { NoticesController } from './notices.controller.js';
import { NoticesService } from './notices.service.js';

/**
 * Báo cáo, thông báo trạng thái (AD-34) và Tổng quan Sự kiện — chỉ đọc qua read model của mô-đun khác (AD-33). Cần
 * `DbModule` và `RealtimeModule` (toàn cục) ở gốc DI.
 */
@Module({
  controllers: [NoticesController, EventOverviewController],
  providers: [NoticesService, EventOverviewService],
})
export class ReportingModule {}
