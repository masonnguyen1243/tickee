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
} as const;
export type JobQueue = (typeof JobQueue)[keyof typeof JobQueue];
