import { Body, Controller, Header, Headers, HttpCode, Inject, Param, Post } from '@nestjs/common';
import {
  DismissReviewItemRequest,
  ErrorCode,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  Permission,
  ReviewAction,
  type ReviewActionResult,
} from '@tickee/contracts';
import { Access, RequirePermission, type AccessContext } from '../../platform/access/index.js';
import { AppError, parseRequest } from '../../platform/http/index.js';
import { ReviewActionsService } from './review-actions.js';

/**
 * `Idempotency-Key` thiếu hoặc không phải uuid → `400 VALIDATION_FAILED` (cùng dạng với `parseRequest`). Thao tác là
 * chuyển trạng thái có CAS nên gửi lại tự trả `200`; khóa vẫn bắt buộc để giữ hợp đồng AD-31 nếu sau này cần lưu khóa.
 */
function assertIdempotencyKey(raw: unknown): void {
  if (IdempotencyKey.safeParse(raw).success) return;
  const issue = { path: `headers.${IDEMPOTENCY_KEY_HEADER}`, code: raw === undefined ? 'invalid_type' : 'invalid_format' };
  throw new AppError(ErrorCode.VALIDATION_FAILED, 'Yêu cầu không hợp lệ.', { details: { issues: [issue] } });
}

/**
 * Thao tác trên mục Cần xử lý (Story 4.4-a, FR-21): `POST /v1/orgs/:orgId/review-items/:itemId/{approve,reject,refund,
 * dismiss}`. Chỉ Owner và Admin (`review_queue.handle`); không phải thành viên (kể cả CTV) → `403 NOT_A_MEMBER` (guard).
 * Thứ tự kiểm: header `Idempotency-Key` (uuid) → body (`dismiss`) → mục (`404 REVIEW_ITEM_NOT_FOUND`) → bảng thao tác
 * (`409 REVIEW_ACTION_NOT_ALLOWED`; gửi lại thao tác đã thắng → `200`). `200` `ReviewActionResult`, `no-store`.
 * "Duyệt tay" còn trả `409 EVENT_CANCELLED` / `EVENT_ALREADY_ENDED` / `EVENT_LOCKED` (không đổi gì) và `409
 * TICKET_TYPE_SOLD_OUT` (Đơn giữ `review`, nhật ký có dòng "không thành").
 */
@Controller('orgs/:orgId/review-items/:itemId')
export class ReviewActionsController {
  constructor(@Inject(ReviewActionsService) private readonly reviewActions: ReviewActionsService) {}

  /** "Duyệt tay phát Vé": Đơn `review` → `paid` (nguồn `manual`), Vé, email Vé; mục `approved`. */
  @Post('approve')
  @HttpCode(200)
  @RequirePermission(Permission.REVIEW_QUEUE_HANDLE)
  @Header('cache-control', 'no-store')
  approve(
    @Access() ctx: AccessContext,
    @Param('itemId') itemId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<ReviewActionResult> {
    assertIdempotencyKey(key);
    return this.reviewActions.perform(ctx, itemId, { action: ReviewAction.APPROVE });
  }

  /** "Từ chối": Đơn `review` → `cancelled` (`rejected`), email báo Người mua; mục vẫn `open`. */
  @Post('reject')
  @HttpCode(200)
  @RequirePermission(Permission.REVIEW_QUEUE_HANDLE)
  @Header('cache-control', 'no-store')
  reject(
    @Access() ctx: AccessContext,
    @Param('itemId') itemId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<ReviewActionResult> {
    assertIdempotencyKey(key);
    return this.reviewActions.perform(ctx, itemId, { action: ReviewAction.REJECT });
  }

  /** "Đã hoàn tay": mục `refunded`; Đơn đã từ chối → `refunded`, mục chỉ hoàn → Đơn giữ nguyên. */
  @Post('refund')
  @HttpCode(200)
  @RequirePermission(Permission.REVIEW_QUEUE_HANDLE)
  @Header('cache-control', 'no-store')
  refund(
    @Access() ctx: AccessContext,
    @Param('itemId') itemId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<ReviewActionResult> {
    assertIdempotencyKey(key);
    return this.reviewActions.perform(ctx, itemId, { action: ReviewAction.REFUND });
  }

  /** "Bỏ qua" (chỉ mục chỉ hoàn): body `{ reason }` 1–300 ký tự sau trim; mục `dismissed`. */
  @Post('dismiss')
  @HttpCode(200)
  @RequirePermission(Permission.REVIEW_QUEUE_HANDLE)
  @Header('cache-control', 'no-store')
  dismiss(
    @Access() ctx: AccessContext,
    @Param('itemId') itemId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
    @Body() body: unknown,
  ): Promise<ReviewActionResult> {
    assertIdempotencyKey(key);
    const { reason } = parseRequest(DismissReviewItemRequest, body);
    return this.reviewActions.perform(ctx, itemId, { action: ReviewAction.DISMISS, reason });
  }
}
