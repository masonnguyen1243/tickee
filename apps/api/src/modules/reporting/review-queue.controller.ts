import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import {
  Permission,
  ReviewQueueQuery,
  type ReviewItemDetail,
  type ReviewQueue,
  type ReviewQueueSummary,
} from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { parseRequest } from '../../platform/http/index.js';
import { ReviewQueueService } from './review-queue.service.js';

/**
 * Hàng Cần xử lý của BTC (Story 4.3, FR-21): danh sách mục `open` gộp mọi Sự kiện, số mục cho badge, chi tiết một mục.
 * Chỉ Owner và Admin (`review_queue.handle`); không phải thành viên (kể cả CTV) → `403 NOT_A_MEMBER` (guard). Dữ liệu
 * thanh toán nên `no-store`. `summary` khai báo trước `:itemId` để không bị nuốt. Badge, hàng và `needs-action-card` tải
 * lại theo `org_review_items_changed` của stream `GET …/live` cấp BTC.
 */
@Controller('orgs/:orgId/review-items')
export class ReviewQueueController {
  constructor(@Inject(ReviewQueueService) private readonly reviewQueue: ReviewQueueService) {}

  /** `GET /v1/orgs/:orgId/review-items[?eventId=]`: `ReviewQueue` (cũ nhất trước). */
  @Get()
  @RequirePermission(Permission.REVIEW_QUEUE_HANDLE)
  @Header('cache-control', 'no-store')
  list(@Access() ctx: AccessContext, @Query() query: unknown): Promise<ReviewQueue> {
    const { eventId } = parseRequest(ReviewQueueQuery, query);
    return this.reviewQueue.queue(ctx, eventId);
  }

  /** `GET /v1/orgs/:orgId/review-items/summary`: `{ openCount }`. */
  @Get('summary')
  @RequirePermission(Permission.REVIEW_QUEUE_HANDLE)
  @Header('cache-control', 'no-store')
  summary(@Access() ctx: AccessContext): Promise<ReviewQueueSummary> {
    return this.reviewQueue.summary(ctx);
  }

  /** `GET /v1/orgs/:orgId/review-items/:itemId`: `ReviewItemDetail` (mọi trạng thái của mục). */
  @Get(':itemId')
  @RequirePermission(Permission.REVIEW_QUEUE_HANDLE)
  @Header('cache-control', 'no-store')
  detail(@Access() ctx: AccessContext, @Param('itemId') itemId: string): Promise<ReviewItemDetail> {
    return this.reviewQueue.detail(ctx, itemId);
  }
}
