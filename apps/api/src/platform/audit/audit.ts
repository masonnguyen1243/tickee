import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor, Tx } from '../db/index.js';
import { auditEvents } from './schema.js';

/** Hành động audit: `<đối tượng>.<động từ>`. Story sau thêm vào union này. */
export type AuditAction =
  | 'organization.created'
  /** Bật 2FA: xác nhận đăng ký TOTP (lần đầu hoặc bật lại). */
  | 'totp.enrolled'
  /** Sai TOTP/mã khôi phục đủ ngưỡng: khóa xác minh. */
  | 'totp.locked'
  /** Step-up bằng mã khôi phục: mã hết hiệu lực, TOTP bị gỡ và mọi session khác của user bị đăng xuất. */
  | 'totp.recovery_code_used'
  /** Người dùng tự tắt 2FA (bằng TOTP hoặc mã khôi phục): secret và mã khôi phục bị xóa, mọi session khác bị đăng xuất. */
  | 'totp.disabled'
  /** Owner mời một email làm Admin (đối tượng: lời mời; không ghi email). */
  | 'member.invited'
  /** Lời mời còn treo bị thu hồi: Owner bấm "Thu hồi" hoặc mời lại cùng email. */
  | 'member.invitation_revoked'
  /** Người được mời nhận lời mời và thành Admin (đối tượng: tài khoản). */
  | 'member.joined'
  /** Owner xóa một Admin khỏi BTC (đối tượng: tài khoản bị xóa). */
  | 'member.removed'
  /**
   * Owner chuyển quyền Owner cho một Admin (Story 2.14): Owner cũ thành Admin, Admin được chọn thành Owner (đối tượng:
   * tài khoản Owner mới; actor: Owner cũ).
   */
  | 'member.ownership_transferred'
  /** CLI cấp cờ Quản trị Tingee (actor: tài khoản `--by`; đối tượng: tài khoản được cấp; không thuộc BTC nào). */
  | 'platform_admin.granted'
  /** CLI thu cờ Quản trị Tingee (actor: tài khoản `--by`; đối tượng: tài khoản bị thu). */
  | 'platform_admin.revoked'
  /** Quản trị Tingee đọc dữ liệu nhiều BTC qua `platformAdminScope` (một dòng mỗi request đọc). */
  | 'platform_admin.read'
  /** Quản trị Tingee duyệt BTC vào Closed Beta (kể cả duyệt lại BTC đã bị thu hồi). */
  | 'organization.closed_beta_approved'
  /** Quản trị Tingee thu hồi Closed Beta của BTC. */
  | 'organization.closed_beta_revoked'
  /**
   * Quản trị Tingee requeue một job dead-letter của pg-boss về queue gốc (Story 4.6-d, AD-12; không thuộc BTC nào):
   * pg-boss tạo job mới cùng payload ở queue gốc (lượt thử tính lại từ 0) và xóa dòng dead-letter, cùng transaction với
   * dòng audit này. Đối tượng: `{ type: 'dead_letter_job', id: '<queue dead-letter>:<id job dead-letter>' }`. Không ghi
   * payload hay lý do lỗi.
   */
  | 'dead_letter_job.requeued'
  /**
   * Dịch vụ thanh toán của BTC bị ngắt (Story 4.2, AD-32; actor: hệ thống): `create-link` bằng key hiện hành bị Tingee
   * từ chối vì hết Token, merchant bị khóa, key không còn dùng được, key chưa được cấp quyền "Cổng thanh toán", hoặc VA
   * của tài khoản mặc định chưa dùng được với Cổng thanh toán (Story 4.2-d). Đối tượng: lý do (`{ type:
   * 'payment_service_reason', id: 'token' | 'tingee_disabled' | 'credential_invalid' | 'gateway_permission_missing' |
   * 'payout_account_not_allowed' }`; BTC ở `organization_id`).
   */
  | 'organization.payment_service_suspended'
  /**
   * BTC đang bị ngắt và Tingee báo lý do khác ở một lần dò (actor: Owner khi bấm "Kiểm tra lại", `null` với job dò).
   * Đối tượng: lý do mới (như `organization.payment_service_suspended`); mốc bắt đầu ngắt giữ nguyên.
   */
  | 'organization.payment_service_reason_changed'
  /**
   * Dịch vụ thanh toán của BTC mở lại (Story 4.2). Đối tượng: đường mở lại (`{ type: 'payment_service_resume', id:
   * 'probe' | 'owner_check' | 'platform_admin' | 'new_key' | 'default_changed' }`; BTC ở `organization_id`); actor:
   * Owner bấm "Kiểm tra lại", lưu key mới hoặc đổi/hủy tài khoản nhận tiền mặc định (`default_changed`, Story 4.2-d),
   * Quản trị Tingee mở lại, `null` với job dò.
   */
  | 'organization.payment_service_resumed'
  /**
   * Owner đặt, đổi hoặc tắt ngưỡng cảnh báo Token (Story 4.5-b; actor: Owner; đối tượng: `{ type: 'organization', id }`).
   * `changedFields`: `['token_alert_threshold']`, thêm `token_below_threshold_since` khi tắt cảnh báo xóa mốc dưới
   * ngưỡng. Không ghi ngưỡng hay số Token.
   */
  | 'organization.token_alert_threshold_update'
  /**
   * Owner kết nối API key Tingee của BTC (Tingee đã chấp nhận key): credential mới thành hiện hành; credential cũ (nếu
   * có, "Dùng key khác") chuyển `retired_at`. Không ghi Client ID hay Secret Token.
   */
  | 'tingee_credential.connected'
  /**
   * Owner đổi key Tingee sau khi BTC đã từng liên kết tài khoản nhận tiền (Story 2.13-b, đã xác nhận lại; đối tượng:
   * credential mới): credential mới thành hiện hành, credential cũ chuyển `retired_at` (giữ ciphertext). Cùng
   * transaction có `payout_account.unlinked` cho từng tài khoản hiện hành cũ, `payout_account.linked` và
   * `payout_account.default_changed` cho tài khoản mới. Không ghi Client ID hay Secret Token.
   */
  | 'tingee_credential.replaced'
  /** Owner thêm một tài khoản nhận tiền từ danh sách tài khoản Tingee (tài khoản đầu tiên tự thành mặc định). */
  | 'payout_account.linked'
  /**
   * Owner hủy liên kết một tài khoản nhận tiền, hoặc đổi key Tingee (mọi tài khoản hiện hành): dòng chuyển `retired_at`
   * (không xóa, không gọi Tingee). Tickee chỉ ngừng dùng tài khoản; VA trên Tingee giữ nguyên.
   */
  | 'payout_account.unlinked'
  /**
   * Tài khoản mặc định của BTC đổi (đối tượng: tài khoản thành mặc định): Owner bấm "Đặt làm mặc định", hủy tài khoản
   * mặc định khiến tài khoản liên kết sớm nhất còn lại thành mặc định, hoặc đổi key Tingee (tài khoản đã chọn).
   */
  | 'payout_account.default_changed'
  /** Owner/Admin tạo Sự kiện nháp (Story 2.7). */
  | 'event.created'
  /** Owner/Admin sửa Sự kiện (`changedFields`: tên trường trong `EVENT_DRAFT_FIELDS` đã đổi, hoặc
   * `['maxTicketsPerOrder']` khi đổi giới hạn Vé/Đơn; không ghi giá trị). */
  | 'event.updated'
  /** Owner/Admin mở bán Sự kiện (Story 2.10): `draft` → `published` sau khi đủ điều kiện mở bán. */
  | 'event.published'
  /** Owner/Admin ẩn Sự kiện (Story 2.12): `published` → `hidden`; link vẫn mở được nhưng không nhận Đơn mới. */
  | 'event.hidden'
  /** Owner/Admin hiện lại Sự kiện đã ẩn (Story 2.12): `hidden` → `published`. */
  | 'event.unhidden'
  /** Owner/Admin bấm "Kết thúc" (Story 2.12): `ended_manually_at` = `effective_end_at` = lúc bấm; status giữ nguyên. */
  | 'event.ended'
  /** Owner/Admin thêm Hạng vé (kèm dòng tồn kho) cho Sự kiện (Story 2.8). */
  | 'ticket_type.created'
  /** Owner/Admin sửa Hạng vé (`changedFields`: tên trường trong `TICKET_TYPE_FIELDS` đã đổi, không ghi giá trị). */
  | 'ticket_type.updated'
  /** Owner/Admin xóa Hạng vé chưa bán và chưa giữ chỗ (kèm dòng tồn kho). */
  | 'ticket_type.deleted'
  /** Owner/Admin thêm câu hỏi riêng vào form mua của Sự kiện (Story 2.9; đối tượng: câu hỏi; không ghi nhãn). */
  | 'event_form.question_added'
  /**
   * Owner/Admin sửa câu hỏi riêng (`changedFields`: tên trường trong `FORM_QUESTION_FIELDS` đã đổi — `label`, `kind`,
   * `required`, `options`; không ghi nhãn hay phương án).
   */
  | 'event_form.question_updated'
  /** Owner/Admin xóa câu hỏi riêng (Đơn đã đặt vẫn giữ câu trả lời đã chụp). */
  | 'event_form.question_removed'
  /** Owner/Admin đổi thứ tự câu hỏi riêng (đối tượng: Sự kiện). */
  | 'event_form.reordered'
  /**
   * Đơn chuyển `paid` và Vé được phát (`ordering.markPaid`, Story 3.3; đối tượng: Đơn). Một dòng cho mỗi lần chuyển
   * thành công, cùng transaction với phát Vé. Actor: hệ thống (`null`), trừ nguồn `manual` (Story 4.4: thành viên BTC
   * bấm "Duyệt tay phát Vé").
   */
  | 'order.paid'
  /**
   * BTC "Từ chối" khoản tiền của Đơn trên mục Cần xử lý (Story 4.4; actor: thành viên BTC; đối tượng: Đơn): `review` →
   * `cancelled`, `cancel_reason` `rejected`.
   */
  | 'order.rejected'
  /**
   * BTC bấm "Đã hoàn tay" trên mục của Đơn đã từ chối (Story 4.4; actor: thành viên BTC; đối tượng: Đơn): `cancelled` →
   * `refunded`.
   */
  | 'order.refunded'
  /**
   * Thao tác trên mục Cần xử lý (Story 4.4; actor: thành viên BTC; đối tượng: `{ type: 'review_item', id }`), cùng
   * transaction với thay đổi; nhật ký của `Sheet` dựng từ các dòng này. Không ghi số tiền, lý do hay tên.
   * - `approve`: duyệt tay phát Vé (Đơn `paid`, mục `approved`);
   * - `approve_sold_out`: duyệt tay không thành vì hết chỗ (Đơn giữ `review`, mục vẫn `open`);
   * - `reject`: từ chối (Đơn `cancelled`, mục vẫn `open`);
   * - `refund`: đã hoàn tay (mục `refunded`; Đơn đã từ chối → `refunded`);
   * - `dismiss`: bỏ qua (mục `dismissed`, lý do lưu ở `review_items.dismiss_reason`).
   */
  | 'review_item.approve'
  | 'review_item.approve_sold_out'
  | 'review_item.reject'
  | 'review_item.refund'
  | 'review_item.dismiss'
  /**
   * "Ghép với Đơn" trên mục `unmatched` (Story 4.4-b; actor: thành viên BTC; đối tượng: mục), cùng transaction với thay
   * đổi; nhật ký của `Sheet` dựng từ các dòng này (mã Đơn đọc qua liên kết giao dịch → Đơn, không ghi trong audit):
   * - `match`: đã ghép (Đơn `paid`, mục `approved`; cùng `tx` có `order.paid` và `payment_event.match`);
   * - `match_sold_out`: ghép không thành vì hết chỗ (Đơn giữ nguyên trạng thái, mục vẫn `open`).
   */
  | 'review_item.match'
  | 'review_item.match_sold_out'
  /**
   * Khoản tiền chưa khớp được gắn vào Đơn khi "Ghép với Đơn" (Story 4.4-b; actor: thành viên BTC; đối tượng: `{ type:
   * 'payment_event', id }`; `changedFields` `['order_id']`). Không ghi mã Đơn hay số tiền.
   */
  | 'payment_event.match'
  /**
   * Chủ Vé bấm "Tạo lại link" chia sẻ Vé (Story 3.8, AD-29; actor: chủ Vé; đối tượng: Vé): link cũ chết ngay, Mã QR vé
   * không đổi. Không ghi token hay hash.
   */
  | 'ticket.share_link_regenerated'
  /**
   * Owner/Admin "Tạo link mới" mời CTV của Sự kiện (Story 5.1, AD-30; đối tượng: `{ type: 'checker_invite', id }`).
   * Không ghi token hay hash.
   */
  | 'checker_invite.created'
  /**
   * Link mời CTV bị thu hồi vì Owner/Admin tạo link mới cho cùng Sự kiện (Story 5.1; cùng transaction với
   * `checker_invite.created`; đối tượng: link cũ). CTV đã nhận lời mời vẫn giữ quyền.
   */
  | 'checker_invite.revoked'
  /**
   * Tài khoản nhận lời mời CTV lần đầu (Story 5.2, `flows.acceptCheckerInvite`; actor: chính tài khoản đó; đối tượng:
   * `{ type: 'checker', id }`; `organizationId`: BTC sở hữu Sự kiện). Nhận lại khi đã là CTV `active` không ghi. Không
   * ghi token hay hash.
   */
  | 'checker.joined';

export interface AuditEvent {
  /** `null` = hệ thống. */
  actorUserId: string | null;
  /** `null` = thao tác nền tảng (không thuộc BTC nào). */
  organizationId: string | null;
  action: AuditAction;
  target: { type: string; id: string };
  /** Tên trường đổi — không bao giờ là giá trị. */
  changedFields?: readonly string[];
}

/** Một dòng audit đã ghi, đọc lại theo đối tượng (`audit.trailOf`). */
export interface AuditTrailEntry {
  action: AuditAction;
  actorUserId: string | null;
  /** Lúc ghi (`now()` của transaction đã ghi). */
  at: Date;
}

/**
 * Ghi audit trong cùng transaction với thay đổi (`tx`): thay đổi rollback thì audit cũng rollback.
 */
export const audit = {
  async record(tx: Tx, event: AuditEvent): Promise<void> {
    await tx.insert(auditEvents).values({
      actorUserId: event.actorUserId,
      organizationId: event.organizationId,
      action: event.action,
      targetType: event.target.type,
      targetId: event.target.id,
      changedFields: [...(event.changedFields ?? [])],
    });
  },

  /**
   * Các dòng audit của đối tượng `target` thuộc BTC `organizationId`, chỉ các `actions` cho trước, cũ trước (lúc ghi rồi
   * id; index `audit_events_target_idx`). Dùng cho nhật ký thao tác hiện cho thành viên BTC (Story 4.4): chỉ hành động,
   * người làm và lúc làm — audit không bao giờ chứa giá trị.
   */
  async trailOf(
    db: DbExecutor,
    query: { organizationId: string; target: { type: string; id: string }; actions: readonly AuditAction[] },
  ): Promise<AuditTrailEntry[]> {
    if (query.actions.length === 0) return [];
    const rows = await db
      .select({ action: auditEvents.action, actorUserId: auditEvents.actorUserId, at: auditEvents.createdAt })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.targetType, query.target.type),
          eq(auditEvents.targetId, query.target.id),
          eq(auditEvents.organizationId, query.organizationId),
          inArray(auditEvents.action, [...query.actions]),
        ),
      )
      .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
    return rows.map((row) => ({ ...row, action: row.action as AuditAction }));
  },
};
