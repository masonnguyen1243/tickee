import type { Metadata } from 'next';

import { BuyerGate } from '../../buyer-gate';
import { OrderView } from './order-view';

export const metadata: Metadata = { title: 'Đơn của bạn · Tickee', robots: { index: false, follow: false } };

type OrderPageProps = { params: Promise<{ code: string }> };

/**
 * Trang Đơn `/orders/{code}` (Story 3.2, bản tối thiểu): cần đăng nhập (`BuyerGate`), Đơn tải ở trình duyệt (phiên ở
 * origin API). Story 3.4 thêm màn thanh toán, 3.7 tự chuyển trạng thái theo thời gian thực.
 */
export default async function OrderPage({ params }: OrderPageProps) {
  const { code } = await params;
  return (
    <BuyerGate>
      <OrderView code={code} />
    </BuyerGate>
  );
}
