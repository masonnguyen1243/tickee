import { z } from 'zod';

/** Tên queue pg-boss (vai `worker`). Tên chỉ gồm chữ, số, `_`, `-`, `.`, `/` (luật của pg-boss). */
export const JobQueue = {
  /** Dọn rác hết hạn của `identity` (bộ đếm giới hạn, verification, session), chạy định kỳ. */
  IDENTITY_PURGE_EXPIRED: 'identity.purge-expired',
  /**
   * Gửi email mời Admin (`organizer`, Story 2.4). Payload chỉ `{ invitationId }`; worker sinh token, lưu hash rồi gửi.
   * Enqueue cùng `tx` tạo lời mời.
   */
  ORGANIZER_SEND_ADMIN_INVITATION: 'organizer.send-admin-invitation',
  /** Dead-letter của `ORGANIZER_SEND_ADMIN_INVITATION`: job hết lượt retry được chép sang đây. */
  ORGANIZER_SEND_ADMIN_INVITATION_DEAD_LETTER: 'organizer.send-admin-invitation.dead-letter',
  /**
   * Revalidate ngay trang Sự kiện công khai `/e/{slug}` khi BTC sửa phần tĩnh (`event`, Story 2.11-c). Payload chỉ
   * `{ slug }`; worker gọi `POST {WEB_ORIGIN}/api/revalidate` với tag `publicEventTag(slug)`. Enqueue cùng `tx` của thay
   * đổi. Không có dead-letter: hết lượt retry thì cache tự hết hạn sau 30 giây.
   */
  EVENT_REVALIDATE_PUBLIC_PAGE: 'event.revalidate-public-page',
  /**
   * Email cảnh báo tài khoản nhận tiền mặc định của BTC vừa đổi, gửi Owner và mọi Admin (`organizer`, Story 2.13-a).
   * Payload chỉ id và mốc giờ (`{ organizationId, previousAccountId, nextAccountId | null, actorUserId, changedAt }`);
   * worker đọc 4 số cuối và email người nhận lúc gửi. Enqueue cùng `tx` của thay đổi.
   */
  ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED: 'organizer.notify-default-payout-changed',
  /** Dead-letter của `ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED`: job hết lượt retry được chép sang đây. */
  ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED_DEAD_LETTER: 'organizer.notify-default-payout-changed.dead-letter',
  /**
   * Email báo quyền Owner của BTC vừa chuyển, gửi Owner cũ, Owner mới và mọi Admin khác (`organizer`, Story 2.14).
   * Payload chỉ id (`{ organizationId, previousOwnerUserId, newOwnerUserId }`); worker đọc tên và email lúc gửi.
   * Enqueue cùng `tx` của thay đổi.
   */
  ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED: 'organizer.notify-ownership-transferred',
  /** Dead-letter của `ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED`: job hết lượt retry được chép sang đây. */
  ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED_DEAD_LETTER: 'organizer.notify-ownership-transferred.dead-letter',
  /**
   * Hết hạn Giữ chỗ (`ordering`, AD-4). Payload `{ orderId, linked? }`: (a) Đơn chưa có link thanh toán (Story 3.2,
   * `linked` vắng hoặc `false`) — enqueue bằng chính `tx` tạo Đơn (TX1) với `startAfter = expires_at`; (c) Đơn đã có
   * link (Story 3.4, `linked: true`) — enqueue bằng `tx` gắn link (TX2) với `startAfter = expires_at +
   * PAYMENT_LINK_GRACE_SECONDS`. Đơn không đúng loại hoặc không còn `pending` → bỏ qua; chạy sớm → retry.
   */
  ORDERING_EXPIRE_ORDER: 'ordering.expire-order',
  /** Dead-letter của `ORDERING_EXPIRE_ORDER`: job hết lượt retry được chép sang đây. */
  ORDERING_EXPIRE_ORDER_DEAD_LETTER: 'ordering.expire-order.dead-letter',
  /**
   * Email cho Người mua của một Đơn (`ordering`, Story 3.8), payload `SendBuyerEmailPayload` (`{ kind, orderId }`, không
   * email, tên hay token). `tickets`: email Vé, enqueue trong `markPaid` khi Đơn chuyển `paid` (mọi nguồn); `orphan_sold_out`:
   * tiền về muộn mà Hạng vé đã hết, enqueue ở nhánh `sold_out` của IPN. Enqueue bằng chính `tx` của thay đổi; id job suy
   * cố định từ (`kind`, `orderId`) nên enqueue lặp không tạo job thứ hai trong khi dòng job cũ còn trong bảng của pg-boss
   * (job đã xong bị xóa sau `deleteAfterSeconds` của queue, mặc định 7 ngày; sau đó enqueue lại sẽ tạo job mới).
   */
  ORDERING_SEND_BUYER_EMAIL: 'ordering.send-buyer-email',
  /** Dead-letter của `ORDERING_SEND_BUYER_EMAIL`: job hết lượt retry được chép sang đây. */
  ORDERING_SEND_BUYER_EMAIL_DEAD_LETTER: 'ordering.send-buyer-email.dead-letter',
  /**
   * Email báo Người mua khi Sự kiện đổi giờ hoặc địa điểm (`ordering`, Story 3.10), payload `SendEventChangeEmailPayload`
   * (`{ eventId, version, userId? }`, chỉ id). Lệnh sửa Sự kiện (`flows`) enqueue job gốc (không `userId`) bằng chính `tx`
   * của thay đổi, id cố định theo (`eventId`, `version`). Worker chốt danh sách Người mua lúc chạy job gốc rồi tạo mỗi
   * người một job con (`userId`, id suy từ id job gốc); job con gửi đúng một email với giờ và địa điểm lúc gửi.
   */
  ORDERING_SEND_EVENT_CHANGE_EMAIL: 'ordering.send-event-change-email',
  /** Dead-letter của `ORDERING_SEND_EVENT_CHANGE_EMAIL`: job hết lượt retry được chép sang đây. */
  ORDERING_SEND_EVENT_CHANGE_EMAIL_DEAD_LETTER: 'ordering.send-event-change-email.dead-letter',
  /**
   * Đối soát bù (`payment`, Story 4.1, FR-20, AD-8): tra trạng thái đơn Gateway của một Đơn theo `orderId` (mã Đơn) bằng
   * credential chụp ở `orders.payout_account_id`, rồi đưa kết quả vào cùng đường xử lý IPN (nguồn `reconciliation`).
   * Payload `{ orderId, failures }` (id Đơn, số lần tra lỗi liên tiếp; không credential, không PII). TX2 gắn link enqueue
   * job đầu bằng chính `tx` (queue khai báo ở `ordering` để TX2 enqueue mà không import `payment`); mỗi job xong enqueue
   * mốc kế hoặc dừng. Id job cố định theo (Đơn, mốc, số lần lỗi).
   */
  PAYMENT_RECONCILE_ORDER: 'payment.reconcile-order',
  /** Dead-letter của `PAYMENT_RECONCILE_ORDER`: job hết lượt retry (lỗi DB) được chép sang đây. */
  PAYMENT_RECONCILE_ORDER_DEAD_LETTER: 'payment.reconcile-order.dead-letter',
  /**
   * Dò dịch vụ thanh toán của các BTC đang `suspended` (`organizer`, Story 4.2, AD-32): job cron mỗi
   * `PAYMENT_SERVICE_PROBE_INTERVAL_MINUTES` phút, chỉ vai worker lên lịch. Không payload; tuần tự qua các BTC
   * `suspended`. Không dead-letter: lần lỗi được lần chạy kế tiếp làm lại.
   */
  ORGANIZER_PROBE_PAYMENT_SERVICE: 'organizer.probe-payment-service',
  /**
   * Dịch vụ thanh toán của một BTC vừa mở lại (Story 4.2, AD-32): `organizer` enqueue bằng chính `tx` tắt cờ (mọi đường:
   * dò, "Kiểm tra lại", Quản trị Tingee, lưu key mới); `payment` nhận job và enqueue job tra của Đối soát bù
   * (`PAYMENT_RECONCILE_ORDER`) tại đồng hồ DB cho mọi Đơn còn mở của BTC. Payload `PaymentServiceResumedPayload` (chỉ id).
   */
  PAYMENT_SERVICE_RESUMED: 'payment.service-resumed',
  /** Dead-letter của `PAYMENT_SERVICE_RESUMED`: job hết lượt retry (lỗi DB) được chép sang đây. */
  PAYMENT_SERVICE_RESUMED_DEAD_LETTER: 'payment.service-resumed.dead-letter',
} as const;
export type JobQueue = (typeof JobQueue)[keyof typeof JobQueue];

/** Loại email cho Người mua của job `ordering.send-buyer-email`. */
export const BuyerEmailKind = {
  /** Email Vé: mỗi Vé một link chia sẻ, kèm link về Trang Đơn. */
  TICKETS: 'tickets',
  /** Tiền về muộn cho Đơn đã hết hạn mà Hạng vé đã hết (mục `orphan` lý do `sold_out`): BTC sẽ liên hệ hoàn tiền. */
  ORPHAN_SOLD_OUT: 'orphan_sold_out',
} as const;
export type BuyerEmailKind = (typeof BuyerEmailKind)[keyof typeof BuyerEmailKind];
export const buyerEmailKindSchema = z.enum(BuyerEmailKind);

/** Payload của job `ordering.send-buyer-email`: chỉ loại email và id Đơn (không PII, không token). */
export const SendBuyerEmailPayload = z.object({ kind: buyerEmailKindSchema, orderId: z.uuid() });
export type SendBuyerEmailPayload = z.infer<typeof SendBuyerEmailPayload>;

/** Payload của job `ordering.send-event-change-email` (Story 3.10): chỉ id và phiên bản, không email hay tên. */
export const SendEventChangeEmailPayload = z.object({
  eventId: z.uuid(),
  /** `events.time_venue_version` ngay sau lệnh sửa: mỗi lệnh đổi giờ/địa điểm là một phiên bản, một lượt email. */
  version: z.number().int().positive(),
  /** Có: job con, gửi đúng một email cho Người mua này. Thiếu: job gốc, tạo job con cho mọi Người mua. */
  userId: z.uuid().optional(),
});
export type SendEventChangeEmailPayload = z.infer<typeof SendEventChangeEmailPayload>;

/** Payload của job `payment.service-resumed` (Story 4.2): chỉ id BTC vừa được mở lại dịch vụ thanh toán. */
export const PaymentServiceResumedPayload = z.object({ organizationId: z.uuid() });
export type PaymentServiceResumedPayload = z.infer<typeof PaymentServiceResumedPayload>;
