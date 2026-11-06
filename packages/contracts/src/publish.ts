import { z } from 'zod';

// ---------------------------------------------------------------------------------------------------------------
// Điều kiện mở bán và mở bán Sự kiện (FR-8, Story 2.10, AD-34)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Mã điều kiện mở bán, theo thứ tự trả về. Bốn mã đầu luôn có; ba mã sau chỉ có khi Sự kiện có ít nhất một Hạng vé giá
 * > 0 (Sự kiện miễn phí không cần Closed Beta, tài khoản nhận tiền hay sàn giá). Web chỉ ánh xạ mã sang câu và lối
 * sửa; luật nằm ở server (`event.publishReadiness`).
 */
export const PublishConditionCode = {
  /** Chính sách hoàn vé không rỗng (sau khi bỏ khoảng trắng). */
  REFUND_POLICY: 'REFUND_POLICY',
  /** Có ít nhất một Hạng vé. */
  HAS_TICKET_TYPE: 'HAS_TICKET_TYPE',
  /** `effective_end_at` còn ở tương lai. */
  EVENT_NOT_ENDED: 'EVENT_NOT_ENDED',
  /** BTC không bị khóa (Epic 7; trước đó luôn đạt). */
  ORGANIZATION_NOT_LOCKED: 'ORGANIZATION_NOT_LOCKED',
  /** Chỉ Sự kiện có phí: BTC đã được duyệt vào Closed Beta. */
  CLOSED_BETA_APPROVED: 'CLOSED_BETA_APPROVED',
  /** Chỉ Sự kiện có phí: BTC còn ít nhất một tài khoản nhận tiền chưa hủy liên kết. */
  PAYOUT_ACCOUNT_LINKED: 'PAYOUT_ACCOUNT_LINKED',
  /** Chỉ Sự kiện có phí: mọi giá > 0 đều ≥ `MIN_PAID_PRICE`. */
  PAID_PRICE_MINIMUM: 'PAID_PRICE_MINIMUM',
} as const;
export type PublishConditionCode = (typeof PublishConditionCode)[keyof typeof PublishConditionCode];
export const publishConditionCodeSchema = z.enum(PublishConditionCode);

/** Thứ tự các mã trong `PublishReadiness.conditions`. */
export const PUBLISH_CONDITION_ORDER: readonly PublishConditionCode[] = Object.values(PublishConditionCode);

export const PublishCondition = z.object({ code: publishConditionCodeSchema, satisfied: z.boolean() });
export type PublishCondition = z.infer<typeof PublishCondition>;

/** `GET /v1/orgs/:orgId/events/:eventId/publish-readiness`: chỉ các mã áp dụng cho Sự kiện, theo thứ tự trên. */
export const PublishReadiness = z.object({ conditions: z.array(PublishCondition) });
export type PublishReadiness = z.infer<typeof PublishReadiness>;

/** Mã các điều kiện chưa đạt, giữ thứ tự. */
export const unmetConditions = (readiness: PublishReadiness): PublishConditionCode[] =>
  readiness.conditions.filter((c) => !c.satisfied).map((c) => c.code);

/** `details` của `409 EVENT_NOT_READY`: mã các điều kiện chưa đạt lúc server kiểm lại. */
export const EventNotReadyDetails = z.object({ unmet: z.array(publishConditionCodeSchema) });
export type EventNotReadyDetails = z.infer<typeof EventNotReadyDetails>;
