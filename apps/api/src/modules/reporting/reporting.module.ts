import { Module, type DynamicModule } from '@nestjs/common';
import type { ApiConfig } from '../../platform/config/index.js';
import { tingeePortalUrl } from '../organizer/index.js';
import { EventOverviewController } from './event-overview.controller.js';
import { EventOverviewService } from './event-overview.service.js';
import { NoticesController } from './notices.controller.js';
import { NOTICES_SETTINGS, NoticesService, type NoticesSettings } from './notices.service.js';

/** Cấu hình của `reporting` (env vai api): môi trường Tingee, cho link portal trong banner hết Token (Story 4.2). */
export type ReportingConfig = Pick<ApiConfig, 'TINGEE_BASE_URL'>;

/**
 * Báo cáo, thông báo trạng thái (AD-34) và Tổng quan Sự kiện — chỉ đọc qua read model của mô-đun khác (AD-33). Cần
 * `DbModule` và `RealtimeModule` (toàn cục) ở gốc DI.
 */
@Module({})
export class ReportingModule {
  static forRoot(config: ReportingConfig): DynamicModule {
    return {
      module: ReportingModule,
      controllers: [NoticesController, EventOverviewController],
      providers: [
        NoticesService,
        EventOverviewService,
        {
          provide: NOTICES_SETTINGS,
          useValue: { tingeePortalUrl: tingeePortalUrl(config.TINGEE_BASE_URL) } satisfies NoticesSettings,
        },
      ],
    };
  }
}
