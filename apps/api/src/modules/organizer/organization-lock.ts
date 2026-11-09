import { ErrorCode } from '@tickee/contracts';
import { orgScope, type AccessContext } from '../../platform/access/index.js';
import type { Tx } from '../../platform/db/index.js';
import { AppError } from '../../platform/http/index.js';
import { organizations } from './schema.js';

/**
 * Khóa dòng `organizations` của BTC tới hết transaction (`FOR UPDATE`): các lần ghi cần chạy lần lượt trong một BTC
 * (tài khoản nhận tiền, chuyển quyền Owner) gọi hàm này đầu tiên. BTC không còn → `NOT_A_MEMBER`. Chỉ dùng trong
 * mô-đun `organizer` (không export qua `index.ts`).
 */
export async function lockOrganization(tx: Tx, ctx: AccessContext): Promise<void> {
  const [org] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(orgScope(ctx)({ organizationId: organizations.id }))
    .for('update');
  if (!org) throw new AppError(ErrorCode.NOT_A_MEMBER, 'Bạn không phải thành viên của BTC này.');
}
