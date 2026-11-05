import type { Tx } from '../db/index.js';
import { auditEvents } from './schema.js';

/** Hành động audit: `<đối tượng>.<động từ>`. Story sau thêm vào union này. */
export type AuditAction =
  | 'organization.created'
  /** Bật 2FA: xác nhận đăng ký TOTP (lần đầu hoặc bật lại). */
  | 'totp.enrolled'
  /** Sai TOTP/mã khôi phục đủ ngưỡng: khóa xác minh. */
  | 'totp.locked'
  /** Step-up bằng mã khôi phục: mã hết hiệu lực và TOTP bị gỡ. */
  | 'totp.recovery_code_used'
  /** Người dùng tự tắt 2FA (bằng TOTP hoặc mã khôi phục): secret và mã khôi phục bị xóa. */
  | 'totp.disabled'
  /** Owner mời một email làm Admin (đối tượng: lời mời; không ghi email). */
  | 'member.invited'
  /** Lời mời còn treo bị thu hồi: Owner bấm "Thu hồi" hoặc mời lại cùng email. */
  | 'member.invitation_revoked'
  /** Người được mời nhận lời mời và thành Admin (đối tượng: tài khoản). */
  | 'member.joined'
  /** Owner xóa một Admin khỏi BTC (đối tượng: tài khoản bị xóa). */
  | 'member.removed'
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
   * Owner kết nối API key Tingee của BTC (Tingee đã chấp nhận key): credential mới thành hiện hành; credential cũ (nếu
   * có, "Dùng key khác") chuyển `retired_at`. Không ghi Client ID hay Secret Token.
   */
  | 'tingee_credential.connected'
  /** Owner thêm một tài khoản nhận tiền từ danh sách tài khoản Tingee (tài khoản đầu tiên tự thành mặc định). */
  | 'payout_account.linked'
  /**
   * Owner hủy liên kết một tài khoản nhận tiền: dòng chuyển `retired_at` (không xóa, không gọi Tingee). Tickee chỉ
   * ngừng dùng tài khoản; VA trên Tingee giữ nguyên.
   */
  | 'payout_account.unlinked'
  /**
   * Tài khoản mặc định của BTC đổi (đối tượng: tài khoản thành mặc định): Owner bấm "Đặt làm mặc định", hoặc hủy tài
   * khoản mặc định khiến tài khoản liên kết sớm nhất còn lại thành mặc định.
   */
  | 'payout_account.default_changed'
  /** Owner/Admin tạo Sự kiện nháp (Story 2.7). */
  | 'event.created'
  /** Owner/Admin sửa Sự kiện (`changedFields`: tên trường trong `EVENT_DRAFT_FIELDS` đã đổi, hoặc
   * `['maxTicketsPerOrder']` khi đổi giới hạn Vé/Đơn; không ghi giá trị). */
  | 'event.updated'
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
  | 'event_form.reordered';

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
};
