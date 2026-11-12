import type { Metadata } from 'next';

import { BuyerGate } from '../buyer-gate';
import { MyTickets } from './my-tickets';

export const metadata: Metadata = { title: 'Vé của tôi · Tickee', robots: { index: false, follow: false } };

/**
 * "Vé của tôi" `/tickets` (Story 3.9): cần đăng nhập (`BuyerGate`), dữ liệu tải ở trình duyệt (phiên ở origin API). Lối
 * vào: menu tài khoản, nút "Xem Vé của tôi" ở màn Thành công, link trong email Vé.
 */
export default function MyTicketsPage() {
  return (
    <BuyerGate>
      <MyTickets />
    </BuyerGate>
  );
}
