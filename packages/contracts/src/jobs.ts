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
} as const;
export type JobQueue = (typeof JobQueue)[keyof typeof JobQueue];
