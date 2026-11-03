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
  /** Owner gửi form liên kết tài khoản nhận tiền: một lần thử mới (`linking`), trước khi gọi Tingee. */
  | 'payout_account.link_started'
  /** Lần thử liên kết thành công: tài khoản nhận tiền hiện hành của BTC. */
  /** Tingee trả `confirmId`: lần thử chuyển sang chờ OTP ngân hàng. */
  | 'payout_account.otp_requested'
  | 'payout_account.linked'
  /** Lần thử liên kết thất bại (lỗi Tingee, OTP hết hạn, bị lần thử mới thay thế…). */
  | 'payout_account.failed';

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
