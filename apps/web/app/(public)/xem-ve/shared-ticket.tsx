'use client';

import { useQuery } from '@tanstack/react-query';
import { TicketX } from 'lucide-react';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/tickee/empty-state';
import { TicketCard } from '@/components/tickee/ticket-card';
import { fetchSharedTicket, sharedTicketQueryKey } from '@/lib/order/api';
import { sharedTicketTokenFromHash } from '@/lib/order/shared-ticket';

/** Token trong `#` của URL, đọc sau khi hydrate và theo dõi `hashchange`. `undefined`: chưa đọc; `null`: thiếu/sai dạng. */
function useHashToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setToken(sharedTicketTokenFromHash(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return token;
}

function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack pt-2">
      <span className="sr-only">Đang tải Vé</span>
      <div aria-hidden="true" className="h-40 animate-pulse rounded-lg bg-muted" />
      <div aria-hidden="true" className="h-64 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/**
 * Vé được chia sẻ (Story 3.8): đọc `#token`, gọi `GET /v1/shared-tickets/:token` không kèm cookie, hiện `ticket-card`
 * không có dòng Người mua (QR, Sự kiện, Hạng vé, "Vé k/N", địa điểm, trạng thái; đã check-in → QR mờ + "Đã check-in").
 * Thiếu token, token sai dạng, `404` hay lỗi bất kỳ → cùng một `empty-state`, không nút (không lộ lý do).
 */
export function SharedTicket() {
  const token = useHashToken();
  const ticket = useQuery({
    queryKey: sharedTicketQueryKey(token ?? ''),
    queryFn: ({ signal }) => fetchSharedTicket(token!, signal),
    enabled: Boolean(token),
  });

  if (token === undefined || (token !== null && ticket.isPending)) return <Loading />;
  if (token === null || !ticket.data) {
    return (
      <EmptyState
        icon={TicketX}
        title="Không tìm thấy Vé"
        description="Link không đúng hoặc không còn hiệu lực."
      />
    );
  }
  const view = ticket.data;
  return (
    <div data-slot="shared-ticket" className="flex flex-col gap-stack pt-2">
      <h1 className="sr-only">
        Vé {view.seq}/{view.count} · {view.eventName}
      </h1>
      <TicketCard
        eventName={view.eventName}
        ticketTypeName={view.ticketTypeName}
        seq={view.seq}
        count={view.count}
        startsAt={view.eventStartsAt}
        venue={view.venue}
        status={view.status}
        qr={view.qr}
      />
    </div>
  );
}
