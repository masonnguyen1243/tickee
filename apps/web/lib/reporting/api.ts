import {
  EventOverview,
  eventOverviewApiPath,
  IDEMPOTENCY_KEY_HEADER,
  MatchCandidates,
  ReviewAction,
  ReviewActionResult,
  ReviewItemDetail,
  reviewItemActionApiPath,
  reviewItemApiPath,
  reviewItemMatchCandidatesApiPath,
  ReviewQueue,
  reviewItemsApiPath,
  reviewItemsSummaryApiPath,
  ReviewQueueSummary,
  StatusNotice,
  statusNoticesApiPath,
} from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

/** Khóa TanStack Query: thông báo trạng thái (`status-banner`) của một BTC. */
export const statusNoticesQueryKey = (orgId: string) => ['reporting', 'status-notices', orgId] as const;

/**
 * Danh sách thông báo, đọc dễ dãi từng phần tử: phần tử không hợp lệ (vd. mã mới khi api triển khai trước web) bị bỏ,
 * các thông báo còn lại vẫn hiện — một mã lạ không được làm mất banner chặn bán. Bản thân response vẫn phải là mảng.
 */
export const StatusNoticesResponse = z
  .array(z.unknown())
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = StatusNotice.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  );

/** `GET /v1/orgs/:orgId/notices`: đã lọc theo vai người xem và sắp theo ưu tiên ở api. */
export const fetchStatusNotices = (orgId: string, signal?: AbortSignal) =>
  apiRequest(statusNoticesApiPath(orgId), { schema: StatusNoticesResponse, init: { signal } });

/** Polling dải banner khi stream cấp BTC chưa kết nối (AD-17: 10 giây ở dashboard). */
export const STATUS_NOTICES_POLL_MS = 10_000;

/**
 * Khóa TanStack Query: Tổng quan (doanh thu, Đơn gần đây, số mục Cần xử lý, check-in và Vé theo Hạng vé) của một Sự
 * kiện (Story 3.11, 6.2).
 */
export const eventOverviewQueryKey = (orgId: string, eventId: string) =>
  ['reporting', 'event-overview', orgId, eventId] as const;

/**
 * `GET /v1/orgs/:orgId/events/:eventId/overview`: doanh thu (tổng `paid_amount` của Đơn `paid`), 5 Đơn mới nhất ở mọi
 * trạng thái, số mục Cần xử lý, số check-in và Vé theo Hạng vé (Story 6.2).
 */
export const fetchEventOverview = (orgId: string, eventId: string, signal?: AbortSignal) =>
  apiRequest(eventOverviewApiPath(orgId, eventId), { schema: EventOverview, init: { signal } });

/**
 * Gốc khóa TanStack Query của hàng Cần xử lý một BTC (Story 4.3): số mục (badge), hàng (theo bộ lọc Sự kiện) và chi
 * tiết mục đều nằm dưới khóa này, nên tín hiệu `org_review_items_changed` của stream cấp BTC làm mới cả ba bằng một lệnh
 * invalidate không `exact`.
 */
export const reviewQueueQueryPrefix = (orgId: string) => ['reporting', 'review-queue', orgId] as const;

/** Số mục `open` của BTC (badge ở sidebar và tab bar). */
export const reviewQueueSummaryQueryKey = (orgId: string) => [...reviewQueueQueryPrefix(orgId), 'summary'] as const;

/** Hàng Cần xử lý; `eventId` `null` = không lọc. */
export const reviewQueueQueryKey = (orgId: string, eventId: string | null) =>
  [...reviewQueueQueryPrefix(orgId), 'list', eventId] as const;

/** Chi tiết một mục (`Sheet`). */
export const reviewItemQueryKey = (orgId: string, itemId: string) =>
  [...reviewQueueQueryPrefix(orgId), 'item', itemId] as const;

/**
 * Đơn ứng viên của "Ghép với Đơn" cho mục `itemId` (Story 4.4-b); `eventId` `null` = mọi Sự kiện. Nằm dưới gốc khóa của
 * hàng nên tín hiệu `org_review_items_changed` (vd. thành viên khác vừa ghép một Đơn) cũng tải lại danh sách đang mở.
 */
export const reviewMatchCandidatesQueryKey = (orgId: string, itemId: string, eventId: string | null) =>
  [...reviewQueueQueryPrefix(orgId), 'match-candidates', itemId, eventId] as const;

/** Polling badge và hàng Cần xử lý khi stream cấp BTC chưa kết nối (AD-17: 10 giây ở dashboard, như `notices`). */
export const REVIEW_QUEUE_POLL_MS = 10_000;

/** `GET /v1/orgs/:orgId/review-items/summary`: `{ openCount }`. */
export const fetchReviewQueueSummary = (orgId: string, signal?: AbortSignal) =>
  apiRequest(reviewItemsSummaryApiPath(orgId), { schema: ReviewQueueSummary, init: { signal } });

/** `GET /v1/orgs/:orgId/review-items[?eventId=]`: mục `open`, cũ nhất trước; lọc thì kèm Sự kiện đang lọc. */
export const fetchReviewQueue = (orgId: string, eventId: string | null, signal?: AbortSignal) =>
  apiRequest(reviewItemsApiPath(orgId, eventId ?? undefined), { schema: ReviewQueue, init: { signal } });

/** `GET /v1/orgs/:orgId/review-items/:itemId`: chi tiết một mục ở mọi trạng thái. */
export const fetchReviewItem = (orgId: string, itemId: string, signal?: AbortSignal) =>
  apiRequest(reviewItemApiPath(orgId, itemId), { schema: ReviewItemDetail, init: { signal } });

/**
 * `GET /v1/orgs/:orgId/review-items/:itemId/match-candidates[?eventId=]` (Story 4.4-b): Đơn `expired`/`review` của BTC
 * cùng số tiền nhận, mới nhất trước, tối đa 100 (`truncated` khi còn nữa).
 */
export const fetchMatchCandidates = (orgId: string, itemId: string, eventId: string | null, signal?: AbortSignal) =>
  apiRequest(reviewItemMatchCandidatesApiPath(orgId, itemId, eventId ?? undefined), {
    schema: MatchCandidates,
    init: { signal },
  });

/** Thao tác trên mục (Story 4.4) và phần thân của nó: "Bỏ qua" có lý do, "Ghép với Đơn" có mã Đơn. */
export type ReviewActionInput =
  | { action: typeof ReviewAction.APPROVE | typeof ReviewAction.REJECT | typeof ReviewAction.REFUND }
  | { action: typeof ReviewAction.DISMISS; reason: string }
  | { action: typeof ReviewAction.MATCH; orderCode: string };

/** Thân JSON của thao tác: `{ reason }` ("Bỏ qua"), `{ orderCode }` ("Ghép với Đơn"); thao tác khác không có thân. */
export function reviewActionBody(input: ReviewActionInput): string | undefined {
  switch (input.action) {
    case ReviewAction.DISMISS:
      return JSON.stringify({ reason: input.reason });
    case ReviewAction.MATCH:
      return JSON.stringify({ orderCode: input.orderCode });
    default:
      return undefined;
  }
}

/**
 * `POST /v1/orgs/:orgId/review-items/:itemId/{approve,reject,refund,dismiss,match}` (Story 4.4) với header
 * `Idempotency-Key`: nơi gọi sinh một khóa mỗi lần mở thao tác và giữ nguyên khi thử lại. Máy chủ xử lý theo trạng thái:
 * gửi lại sau khi đã thắng trả `200` trạng thái hiện tại, không làm lại. Thân theo `reviewActionBody`.
 */
export function postReviewAction(
  orgId: string,
  itemId: string,
  idempotencyKey: string,
  input: ReviewActionInput,
): Promise<ReviewActionResult> {
  const body = reviewActionBody(input);
  return apiRequest(reviewItemActionApiPath(orgId, itemId, input.action), {
    schema: ReviewActionResult,
    init: {
      method: 'POST',
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      ...(body === undefined ? {} : { body }),
    },
  });
}
