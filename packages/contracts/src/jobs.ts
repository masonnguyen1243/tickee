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
} as const;
export type JobQueue = (typeof JobQueue)[keyof typeof JobQueue];
