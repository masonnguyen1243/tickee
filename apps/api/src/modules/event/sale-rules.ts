import type { AccessContext } from '../../platform/access/index.js';
import type { DbExecutor } from '../../platform/db/index.js';
import { closedBetaStatusOf, payoutAccountStatusOf } from '../organizer/index.js';

/*
 * Luật bán dùng chung (AD-21, AD-34): `publishReadiness` (có được mở bán không, Story 2.10) và `ordering.sellability`
 * (Hạng vé có đang bán không, Story 2.11-a) cùng hỏi các câu dưới đây. Mỗi câu chỉ có một hàm; kết luận (mã điều kiện
 * mở bán hay trạng thái Hạng vé) để ở từng nơi gọi.
 */

type OrganizationScope = Pick<AccessContext, 'organizationId'>;

/** Chính sách hoàn vé đã có (không rỗng sau khi bỏ khoảng trắng). Bắt buộc với mọi Sự kiện. */
export const refundPolicySet = (refundPolicy: string | null): boolean => (refundPolicy ?? '').trim() !== '';

/**
 * BTC có đang bị khóa không. Chưa có khóa BTC (Epic 7) nên luôn `false`; Epic 7 thay phần thân hàm này bằng truy vấn
 * trục khóa của BTC (qua read model của `organizer`).
 */
export async function organizationLocked(_db: DbExecutor, _scope: OrganizationScope): Promise<boolean> {
  return false;
}

/** Điều kiện riêng của Hạng vé > 0đ, theo BTC. */
export interface PaidSalesRules {
  /** BTC đã được duyệt vào Closed Beta (`approved`). */
  closedBetaApproved: boolean;
  /** BTC còn ít nhất một tài khoản nhận tiền chưa hủy liên kết (`retired_at` rỗng). */
  payoutLinked: boolean;
}

/** Closed Beta và tài khoản nhận tiền của BTC (chỉ áp cho Hạng vé > 0đ; Sự kiện miễn phí không cần). */
export async function paidSalesAllowed(db: DbExecutor, scope: OrganizationScope): Promise<PaidSalesRules> {
  const closedBeta = await closedBetaStatusOf(db, scope);
  const payout = await payoutAccountStatusOf(db, scope);
  return { closedBetaApproved: closedBeta?.status === 'approved', payoutLinked: payout.status === 'linked' };
}
