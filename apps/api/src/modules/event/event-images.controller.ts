import { randomUUID } from 'node:crypto';
import { Body, Controller, HttpCode, Inject, Logger, Post } from '@nestjs/common';
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
import { EVENT_IMAGE_PRESIGN_ISSUED, EventImagePresignLimiter } from './event-image-rate-limit.js';

/** Key mới cho một ảnh của BTC: `orgs/{orgId}/events/{uuid}.{jpg|png|webp}` (uuid ngẫu nhiên nên không đoán được). */
const newEventImageKey = (organizationId: string, contentType: EventImageType): string =>
  `${eventImageKeyPrefix(organizationId)}${randomUUID()}.${EVENT_IMAGE_EXTENSIONS[contentType]}`;

/**
 * Presign ảnh Sự kiện (Story 4.8-a, FR-7, AD-22): Owner và Admin (`events.manage`) xin URL PUT để trình duyệt upload
 * thẳng lên object storage. Cấp theo BTC, không theo Sự kiện (wizard upload trước khi Sự kiện có id); key đưa vào
 * `imageKey` khi tạo hoặc sửa Sự kiện. Chưa đổi dữ liệu nào nên không audit, không cần `Idempotency-Key`. Api không đọc
 * byte ảnh, không gọi mạng tới storage. Mang `@RequirePermission` nên tự rơi vào bộ test cách ly. Story 4.7-d: mỗi lần
 * cấp đi qua `EventImagePresignLimiter` (theo BTC và theo tài khoản) và ghi log `info` ai xin key nào.
 */
@Controller('orgs/:orgId/event-images')
export class EventImagesController {
  private readonly logger = new Logger('EventImagesController');

  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(EventImagePresignLimiter) private readonly limiter: EventImagePresignLimiter,
  ) {}

  /**
   * Body `{ contentType, contentLength }` (JPEG/PNG/WebP, 1 byte tới 5 MB; sai → `400 VALIDATION_FAILED`, không đếm).
   * Vượt `EVENT_IMAGE_PRESIGN_LIMITS` → `429 EVENT_IMAGE_RATE_LIMITED` kèm `retryAfterSeconds`. Trả
   * `200 { key, uploadUrl, expiresAt }`: URL ký `content-type` và `content-length` đã khai, hạn 5 phút. Log `info`
   * marker `EVENT_IMAGE_PRESIGN_ISSUED` kèm `userId`, `organizationId`, `key` (không có URL ký, IP hay email).
   */
  @Post()
  @HttpCode(200)
  @RequirePermission(Permission.EVENTS_MANAGE)
  async presign(@Access() ctx: AccessContext, @Body() body: unknown): Promise<EventImageUpload> {
    const { contentType, contentLength } = parseRequest(EventImageUploadInput, body);
    const { userId, organizationId } = ctx;
    const key = newEventImageKey(organizationId, contentType);
    const { url, expiresAt } = await this.limiter.issue(userId, organizationId, () =>
      this.storage.presignPut({ key, contentType, contentLength }),
    );
    this.logger.log({ marker: EVENT_IMAGE_PRESIGN_ISSUED, userId, organizationId, key }, 'Cấp URL upload ảnh Sự kiện');
    return { key, uploadUrl: url, expiresAt: expiresAt.toISOString() };
  }
}
