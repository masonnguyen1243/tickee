import { Module } from '@nestjs/common';
import { EVENT_SLUG_SUFFIX, EventService, randomSlugSuffix } from './event.service.js';
import { EventsController } from './events.controller.js';
import { FormController } from './form.controller.js';
import { FormService } from './form.service.js';
import { PublicEventsController } from './public-events.controller.js';
import { PublishService } from './publish.service.js';

/**
 * Sự kiện (FR-6), mở bán (FR-8, Story 2.10) và form mua vé (FR-9). Cần `DbModule` ở gốc DI. Không đăng ký `PermissionGuard`: guard đó đã là
 * guard toàn cục của `OrganizerModule`.
 */
@Module({
  controllers: [EventsController, FormController, PublicEventsController],
  providers: [EventService, FormService, PublishService, { provide: EVENT_SLUG_SUFFIX, useValue: randomSlugSuffix }],
})
export class EventModule {}
