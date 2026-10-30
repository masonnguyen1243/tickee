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
  | 'totp.disabled';

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
