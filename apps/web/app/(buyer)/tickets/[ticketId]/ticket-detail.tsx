'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  formatVnDate,
  formatVnDateTime,
  MY_TICKETS_PATH,
  MyTicketStatus,
  type BuyerOrderView,
  type MyTicketDetail,
} from '@tickee/contracts';
import { ChevronLeft, TicketX } from 'lucide-react';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';

import { EmptyState } from '@/components/tickee/empty-state';
import { OrganizerContact } from '@/components/tickee/organizer-contact';
import { StatusBanner } from '@/components/tickee/status-banner';
import { TicketCard } from '@/components/tickee/ticket-card';
import { TicketShareActions } from '@/components/tickee/ticket-share-actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { priceLabel } from '@/lib/event/selection';
import { buyerOrderQueryKey } from '@/lib/order/api';
import { fetchMyTicket, myTicketQueryKey } from '@/lib/tickets/api';
import { useScreenWakeLock } from '@/lib/tickets/wake-lock';

/** Câu của Vé hủy vì Sự kiện hủy (EXPERIENCE › Vé của tôi & Chi tiết Vé, FR-33). */
const TICKET_EVENT_CANCELLED = 'Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền.';

/** Tải lần đầu: `ticket-card` với ô QR xám (EXPERIENCE › Vé của tôi & Chi tiết Vé). */
function TicketSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      data-slot="ticket-detail-skeleton"
      className="flex flex-col gap-2 rounded-lg bg-card p-card-padding shadow-card"
    >
      <span className="sr-only">Đang tải Vé</span>
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-14" />
      <Skeleton className="mx-auto mt-stack size-[224px]" />
    </div>
  );
}

/** Vé đã sang lịch sử (Sự kiện đã quá `effective_end_at`): tên Sự kiện, ngày, đã check-in hay chưa. Không QR, không chia sẻ. */
function HistoryRow({ ticket }: { ticket: MyTicketDetail }) {
  return (
    <section
      data-slot="ticket-history"
      className="flex flex-col gap-1 rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
    >
      <p className="text-title wrap-break-word">{ticket.event.name}</p>
      <p data-slot="ticket-history-when" className="text-meta text-muted-foreground tabular-nums">
        {formatVnDate(ticket.event.startsAt)} · {ticket.attended ? 'Đã tham dự' : 'Chưa check-in'}
      </p>
      <p className="text-meta wrap-break-word">
        {ticket.ticketTypeName} · Vé {ticket.seq}/{ticket.count}
      </p>
    </section>
  );
}

/**
 * Khối "Biên nhận" (Mason chốt 12/11): mã Đơn; mỗi dòng "Hạng vé × SL · thành tiền"; tổng đã trả (Đơn 0đ: "Miễn phí");
 * thời điểm thanh toán; "Tiền đã chuyển thẳng cho {BTC}" (chỉ Đơn có phí). Hiện cả khi Vé đã sang lịch sử.
 */
function Receipt({ ticket }: { ticket: MyTicketDetail }) {
  const headingId = useId();
  const { receipt } = ticket;
  const paid = receipt.totalAmount > 0;
  return (
    <section
      aria-labelledby={headingId}
      data-slot="ticket-receipt"
      className="flex flex-col rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
    >
      <h2 id={headingId} className="text-title">
        Biên nhận
      </h2>
      <p className="mt-1 text-meta text-muted-foreground">
        Mã Đơn{' '}
        <span data-slot="receipt-order-code" className="font-mono text-code text-foreground tabular-nums">
          {receipt.orderCode}
        </span>
      </p>
      <ul className="mt-2 flex flex-col divide-y">
        {receipt.items.map((item, index) => (
          // Tên Hạng vé không unique trong một Sự kiện: khóa theo vị trí dòng.
          <li key={index} data-slot="receipt-line" className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0 text-label wrap-break-word">
              {item.name} × {item.quantity}
            </span>
            <span className="shrink-0 text-label font-bold tabular-nums">{priceLabel(item.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t pt-2">
        <span className="text-meta text-muted-foreground">Tổng đã trả</span>
        <span data-slot="receipt-total" className="text-total tabular-nums">
          {priceLabel(receipt.totalAmount)}
        </span>
      </div>
      {receipt.paidAt ? (
        <p data-slot="receipt-paid-at" className="mt-2 text-meta text-muted-foreground tabular-nums">
          {paid ? 'Thanh toán lúc' : 'Đăng ký lúc'} {formatVnDateTime(receipt.paidAt)} (giờ Việt Nam)
        </p>
      ) : null}
      {paid ? (
        <p data-slot="receipt-recipient" className="mt-1 text-meta text-muted-foreground wrap-break-word">
          Tiền đã chuyển thẳng cho {ticket.organizer.name}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Chi tiết Vé (Story 3.9, `GET /v1/me/tickets/:ticketId`):
 * - Vé dùng được: `ticket-card` + Mã QR vé đầy đủ + "Chia sẻ Vé" / "Tạo lại link" (Story 3.8); đã check-in → QR mờ .25 +
 *   badge "Đã check-in". Đang hiện QR thì giữ màn hình không tối (Screen Wake Lock; không hỗ trợ / từ chối → bỏ qua).
 * - Đã hủy: badge "Đã hủy", không QR; Sự kiện hủy → "Sự kiện đã hủy. BTC sẽ liên hệ hoàn tiền.", còn lại kênh liên hệ
 *   BTC.
 * - Sau mốc kết thúc: hàng lịch sử ("Đã tham dự" / "Chưa check-in"), không QR, không chia sẻ.
 * - Luôn có khối "Biên nhận". Vé không thuộc người xem hay id sai → `empty-state` "Không tìm thấy Vé".
 */
export function TicketDetail({ ticketId }: { ticketId: string }) {
  const queryClient = useQueryClient();
  const queryKey = myTicketQueryKey(ticketId);
  // Mỗi lần mở trang đều tải lại (bỏ qua `staleTime` toàn cục): Vé vừa hủy hay vừa qua mốc kết thúc không còn QR.
  const ticket = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchMyTicket(ticketId, signal),
    refetchOnMount: 'always',
  });
  const data = ticket.data;
  const showsQr = Boolean(data && !data.ended && data.qr);
  useScreenWakeLock(showsQr);

  // Tạo lại link xong: ghi token mới vào Vé và vào Đơn của Vé (Trang Đơn) trong cache rồi tải lại cả hai, để không trang
  // nào còn chia sẻ link đã chết.
  const shareLinkChanged = (orderCode: string) => (next: string) => {
    queryClient.setQueryData<MyTicketDetail>(queryKey, (current) => (current ? { ...current, shareToken: next } : current));
    const orderKey = buyerOrderQueryKey(orderCode);
    queryClient.setQueryData<BuyerOrderView>(orderKey, (order) =>
      order
        ? { ...order, tickets: order.tickets.map((t) => (t.id === ticketId ? { ...t, shareToken: next } : t)) }
        : order,
    );
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: orderKey });
  };

  let body: ReactNode;
  if (hasErrorCode(ticket.error, ErrorCode.TICKET_NOT_FOUND)) {
    body = (
      <EmptyState
        icon={TicketX}
        title="Không tìm thấy Vé"
        description="Kiểm tra lại link, hoặc đăng nhập đúng tài khoản đã mua Vé."
      />
    );
  } else if (ticket.isError && !data) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được Vé"
        description={messageOf(ticket.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={ticket.isFetching} onClick={() => void ticket.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else if (!data) {
    body = <TicketSkeleton />;
  } else {
    const cancelled = data.status === MyTicketStatus.CANCELLED;
    body = (
      <>
        <h1 className="sr-only">
          Vé {data.seq}/{data.count} · {data.event.name}
        </h1>
        {data.ended ? (
          <HistoryRow ticket={data} />
        ) : (
          <>
            <TicketCard
              eventName={data.event.name}
              ticketTypeName={data.ticketTypeName}
              seq={data.seq}
              count={data.count}
              holderName={data.holderName}
              startsAt={data.event.startsAt}
              venue={data.event.venue}
              status={data.status}
              qr={data.qr}
              actions={
                data.qr && data.shareToken ? (
                  <TicketShareActions
                    ticketId={data.id}
                    shareToken={data.shareToken}
                    eventName={data.event.name}
                    seq={data.seq}
                    count={data.count}
                    onRegenerated={shareLinkChanged(data.receipt.orderCode)}
                  />
                ) : undefined
              }
            />
            {cancelled && data.eventCancelled ? <StatusBanner tone="warning" title={TICKET_EVENT_CANCELLED} /> : null}
            {cancelled && !data.eventCancelled ? <OrganizerContact organizer={data.organizer} /> : null}
          </>
        )}
        <Receipt ticket={data} />
      </>
    );
  }

  return (
    <div data-slot="ticket-detail" data-status={data?.status} className="flex flex-col gap-stack pt-2">
      <Link
        href={MY_TICKETS_PATH}
        className="inline-flex min-h-6 items-center gap-1 self-start text-label text-muted-foreground underline-offset-4 hover:underline"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Vé của tôi
      </Link>
      {body}
    </div>
  );
}
