import type { Metadata } from 'next';

import { BuyerGate } from '../../buyer-gate';
import { TicketDetail } from './ticket-detail';

export const metadata: Metadata = { title: 'Vé của bạn · Tickee', robots: { index: false, follow: false } };

type TicketPageProps = { params: Promise<{ ticketId: string }> };

/**
 * Chi tiết Vé `/tickets/{ticketId}` (Story 3.9): cần đăng nhập (`BuyerGate`), Vé tải ở trình duyệt (phiên ở origin API).
 * Không lưu để xem offline.
 */
export default async function TicketPage({ params }: TicketPageProps) {
  const { ticketId } = await params;
  return (
    <BuyerGate>
      <TicketDetail ticketId={ticketId} />
    </BuyerGate>
  );
}
