import { Module } from '@nestjs/common';
import { EVENT_SLUG_SUFFIX, EventService, randomSlugSuffix } from './event.service.js';
import { EventsController } from './events.controller.js';
import { FormController } from './form.controller.js';
import { FormService } from './form.service.js';
import { PublicEventsController } from './public-events.controller.js';
import { PublicPageQueues } from './public-page-jobs.js';
import { PublishService } from './publish.service.js';

/**
 * Sự kiện (FR-6), mở bán (FR-8, Story 2.10) và form mua vé (FR-9). Cần `DbModule` và `JobsModule` (enqueue revalidate
 * trang Sự kiện công khai, Story 2.11-c) ở gốc DI. Không đăng ký `PermissionGuard`: guard đó đã là guard toàn cục của
 * `OrganizerModule`. Xuất `PublicPageQueues` cho flows (Hạng vé) dùng chung một lần tạo queue.
 */
@Module({
  controllers: [EventsController, FormController, PublicEventsController],
  providers: [
    EventService,
    FormService,
    PublishService,
    PublicPageQueues,
    { provide: EVENT_SLUG_SUFFIX, useValue: randomSlugSuffix },
  ],
  exports: [PublicPageQueues],
})
export class EventModule {}
