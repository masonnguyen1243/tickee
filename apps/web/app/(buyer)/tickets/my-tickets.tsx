'use client';

import { Ticket } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { EmptyState } from '@/components/tickee/empty-state';
import { OrderCard } from '@/components/tickee/order-card';
import { StatusBanner } from '@/components/tickee/status-banner';
import { TicketRow } from '@/components/tickee/ticket-row';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messageOf } from '@/lib/api/message-of';
import { useLiveResource } from '@/lib/realtime/use-live-resource';
import { fetchMyTickets, myTicketsQueryKey } from '@/lib/tickets/api';
import { myTicketsLivePath, myTicketsPollInterval } from '@/lib/tickets/live';

/** Tải lần đầu: `Skeleton` gồm 2 thẻ (EXPERIENCE › Vé của tôi & Chi tiết Vé). */
function MyTicketsSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="my-tickets-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải Vé của bạn</span>
      <Skeleton className="h-28" />
      <Skeleton className="h-28" />
    </div>
  );
}

/** Một nhóm của trang: tiêu đề `h2` + danh sách. Nhóm rỗng thì nơi gọi không render. */
function Group({ slot, title, children }: { slot: string; title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-slot={slot} className="flex flex-col gap-stack">
      <h2 id={headingId} className="text-title">
        {title}
      </h2>
      <ul className="flex flex-col gap-stack">{children}</ul>
    </section>
  );
}

/**
 * "Vé của tôi" (Story 3.9, FR-22, FR-24): một nơi gom mọi Vé và Đơn đang chờ của chính Người mua, theo đúng thứ tự
 * Vé còn hiệu lực · Đơn đang chờ · Lịch sử (nhóm rỗng thì ẩn; không có gì → `empty-state` không nút). Dòng Vé mở Chi
 * tiết Vé; `order-card` không bao giờ có QR. Tự cập nhật qua `useLiveResource` + `GET /v1/me/tickets/live` (Đơn được
 * trả → thẻ rời nhóm, Vé hiện mà không cần tải lại); stream mở lại khi tập mã Đơn trong danh sách đổi; không có SSE thì
 * polling 2 giây khi có Đơn chờ tiền.
 */
export function MyTickets() {
  const { query } = useLiveResource({
    queryKey: myTicketsQueryKey,
    queryFn: (signal) => fetchMyTickets(signal),
    livePath: myTicketsLivePath,
    pollInterval: myTicketsPollInterval,
  });

  let body: ReactNode;
  if (query.isError && !query.data) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được Vé của bạn"
        description={messageOf(query.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else if (!query.data) {
    body = <MyTicketsSkeleton />;
  } else {
    const { active, pending, history, serverNow } = query.data;
    body =
      active.length + pending.length + history.length === 0 ? (
        <EmptyState icon={Ticket} title="Bạn chưa có vé nào." description="Vé bạn mua sẽ hiện ở đây." />
      ) : (
        <>
          {active.length > 0 ? (
            <Group slot="my-tickets-active" title="Vé còn hiệu lực">
              {active.map((t) => (
                <li key={t.id}>
                  <TicketRow
                    ticketId={t.id}
                    eventName={t.event.name}
                    startsAt={t.event.startsAt}
                    venue={t.event.venue}
                    ticketTypeName={t.ticketTypeName}
                    seq={t.seq}
                    count={t.count}
                    status={t.status}
                  />
                </li>
              ))}
            </Group>
          ) : null}
          {pending.length > 0 ? (
            <Group slot="my-tickets-pending" title="Đơn đang chờ">
              {pending.map((order) => (
                <li key={order.code}>
                  <OrderCard order={order} serverNow={serverNow} receivedAt={query.dataUpdatedAt} />
                </li>
              ))}
            </Group>
          ) : null}
          {history.length > 0 ? (
            <Group slot="my-tickets-history" title="Lịch sử">
              {history.map((t) => (
                <li key={t.id}>
                  <TicketRow
                    ticketId={t.id}
                    eventName={t.eventName}
                    startsAt={t.eventStartsAt}
                    ticketTypeName={t.ticketTypeName}
                    seq={t.seq}
                    count={t.count}
                    attended={t.attended}
                  />
                </li>
              ))}
            </Group>
          ) : null}
        </>
      );
  }

  return (
    <div data-slot="my-tickets" className="flex flex-col gap-section pt-2">
      <h1 className="text-headline">Vé của tôi</h1>
      {body}
    </div>
  );
}
