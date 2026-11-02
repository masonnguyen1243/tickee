import { audit } from '../audit/index.js';
import type { Tx } from '../db/index.js';
import type { PlatformAdminContext } from './require-platform-admin.js';

declare const PLATFORM_ADMIN_READ: unique symbol;

/**
 * `tx` đã đi qua `platformAdminScope`: read model đọc nhiều BTC (ngoại lệ của `orgScope`) chỉ nhận kiểu này, nên không
 * đọc chéo BTC nào mà không có dòng audit `platform_admin.read` trong cùng transaction.
 */
export type PlatformAdminReader = Tx & { readonly [PLATFORM_ADMIN_READ]: true };

/**
 * Cửa đọc có tên của Quản trị Tingee (AD-13, AD-26). Không phải mệnh đề `where` như `orgScope` — Quản trị Tingee thấy
 * mọi BTC — mà ghi audit `platform_admin.read` trước rồi trả quyền đọc trên chính `tx` đó: truy vấn rollback thì audit
 * cũng rollback, và mỗi request đọc gọi đúng một lần. `target` là thứ được đọc (vd. `{ type: 'closed_beta_queue',
 * id: 'pending' }`); `organizationId` chỉ đặt khi đọc một BTC cụ thể.
 */
export async function platformAdminScope(
  tx: Tx,
  ctx: PlatformAdminContext,
  target: { type: string; id: string },
  organizationId: string | null = null,
): Promise<PlatformAdminReader> {
  await audit.record(tx, {
    actorUserId: ctx.userId,
    organizationId,
    action: 'platform_admin.read',
    target,
  });
  return tx as PlatformAdminReader;
}
