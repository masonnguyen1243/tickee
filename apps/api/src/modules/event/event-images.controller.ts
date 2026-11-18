import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import {
  EVENT_IMAGE_EXTENSIONS,
  EventImageUploadInput,
  eventImageKeyPrefix,
  Permission,
  type EventImageType,
  type EventImageUpload,
} from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../../platform/storage/index.js';

/** Key mới cho một ảnh của BTC: `orgs/{orgId}/events/{uuid}.{jpg|png|webp}` (uuid ngẫu nhiên nên không đoán được). */
const newEventImageKey = (organizationId: string, contentType: EventImageType): string =>
  `${eventImageKeyPrefix(organizationId)}${randomUUID()}.${EVENT_IMAGE_EXTENSIONS[contentType]}`;

/**
 * Presign ảnh Sự kiện (Story 4.8-a, FR-7, AD-22): Owner và Admin (`events.manage`) xin URL PUT để trình duyệt upload
 * thẳng lên object storage. Cấp theo BTC, không theo Sự kiện (wizard upload trước khi Sự kiện có id); key đưa vào
 * `imageKey` khi tạo hoặc sửa Sự kiện. Chưa đổi dữ liệu nào nên không audit, không cần `Idempotency-Key`. Api không đọc
 * byte ảnh, không gọi mạng tới storage. Mang `@RequirePermission` nên tự rơi vào bộ test cách ly.
 */
@Controller('orgs/:orgId/event-images')
export class EventImagesController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  /**
   * Body `{ contentType, contentLength }` (JPEG/PNG/WebP, 1 byte tới 5 MB; sai → `400 VALIDATION_FAILED`). Trả
   * `200 { key, uploadUrl, expiresAt }`: URL ký `content-type` và `content-length` đã khai, hạn 5 phút.
   */
  @Post()
  @HttpCode(200)
  @RequirePermission(Permission.EVENTS_MANAGE)
  async presign(@Access() ctx: AccessContext, @Body() body: unknown): Promise<EventImageUpload> {
    const { contentType, contentLength } = parseRequest(EventImageUploadInput, body);
    const key = newEventImageKey(ctx.organizationId, contentType);
    const { url, expiresAt } = await this.storage.presignPut({ key, contentType, contentLength });
    return { key, uploadUrl: url, expiresAt: expiresAt.toISOString() };
  }
}
