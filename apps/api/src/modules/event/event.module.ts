import { Module } from '@nestjs/common';
import { EventImagePresignLimiter } from './event-image-rate-limit.js';
import { EventImagesController } from './event-images.controller.js';
import { EventStatusService } from './event-status.service.js';
import { EVENT_SLUG_SUFFIX, EventService, randomSlugSuffix } from './event.service.js';
import { EventsController } from './events.controller.js';
import { FormController } from './form.controller.js';
import { FormService } from './form.service.js';
import { PublicEventsController } from './public-events.controller.js';
import { PublicPageQueues } from './public-page-jobs.js';
import { PublishService } from './publish.service.js';

/**
 * Sự kiện (FR-6), mở bán (FR-8, Story 2.10), Ẩn / Kết thúc sớm (Story 2.12), form mua vé (FR-9) và presign ảnh Sự kiện
 * (Story 4.8-a; giới hạn theo BTC và tài khoản ở Story 4.7-d). Cần `DbModule`, `JobsModule` (enqueue revalidate trang
 * Sự kiện công khai, Story 2.11-c) và `StorageModule` (URL upload và URL công khai của ảnh) ở gốc DI. Không đăng ký
 * `PermissionGuard`: guard đó đã là guard toàn cục của `OrganizerModule`. Xuất `PublicPageQueues` cho flows (Hạng vé)
 * dùng chung một lần tạo queue.
 */
@Module({
  controllers: [EventsController, EventImagesController, FormController, PublicEventsController],
  providers: [
    EventImagePresignLimiter,
    EventService,
    EventStatusService,
    FormService,
    PublishService,
    PublicPageQueues,
    { provide: EVENT_SLUG_SUFFIX, useValue: randomSlugSuffix },
  ],
  exports: [PublicPageQueues],
})
export class EventModule {}
