'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MY_TICKETS_PATH, type BuyerOrderView, type MyTicketDetail } from '@tickee/contracts';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { StageBlock } from '@/components/tickee/stage-block';
import { StatusBanner } from '@/components/tickee/status-banner';
import { TicketCard } from '@/components/tickee/ticket-card';
import { TicketShareActions } from '@/components/tickee/ticket-share-actions';
import { Wordmark } from '@/components/tickee/wordmark';
import { Button } from '@/components/ui/button';
import { buyerOrderQueryKey } from '@/lib/order/api';
import { myTicketQueryKey } from '@/lib/tickets/api';

/** Mỗi thẻ sau trượt lên trễ hơn thẻ trước chừng này ms. */
const STAGGER_MS = 90;
/** "Rung nhẹ" khi Vé hiện (EXPERIENCE.md › Interaction Primitives). */
const VIBRATE_MS = 40;

/** Rung nhẹ một lần nếu thiết bị hỗ trợ và đang là "khoảnh khắc"; reduced motion thì không rung. */
function useSuccessVibration(celebrate: boolean): void {
  useEffect(() => {
    if (!celebrate) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof navigator.vibrate === 'function') navigator.vibrate(VIBRATE_MS);
  }, [celebrate]);
}

type OrderSuccessProps = {
  order: BuyerOrderView;
  /**
   * "Khoảnh khắc" (Story 3.7): thẻ trượt lên từ sân khấu và máy rung nhẹ, chỉ khi trang đang mở thấy Đơn chuyển `paid`
   * hoặc vừa từ Checkout / nút "Thanh toán" sang. Mở lại hay tải lại sau đó: hiện ngay, không trượt, không rung.
   */
  celebrate: boolean;
};

/**
 * Màn "Thành công" của Trang Đơn khi `buyerStatus = paid` (Story 3.3; 3.7 dùng lại khi Đơn có phí tự chuyển): stage có
 * wordmark, tên Sự kiện, "Vé của bạn đã sẵn sàng!" (`aria-live="polite"`; vùng live gắn cùng lúc với nội dung nên không
 * được đọc, và trình báo đổi trang của Next chỉ đọc tiêu đề trang: lúc gắn chuyển focus vào `h1` để trình đọc màn hình
 * đọc câu này ngay) và "Đã gửi Vé tới {email}" (Story 3.8: email Vé đi qua hàng đợi, lỗi email không bao giờ hiện ở
 * đây); mỗi Vé một `ticket-card` kèm "Chia sẻ Vé" / "Tạo lại link" (Story 3.8), thẻ đầu chồng mép dưới stage ~30px;
 * `celebrate` thì các thẻ trượt lên từ sân khấu và máy rung nhẹ. Reduced motion: hiện ngay, không trượt (quy tắc toàn cục
 * trong globals.css tắt animation), không rung. Cuối màn: nút chính "Xem Vé của tôi" → `/tickets` (Story 3.9, UX-DR18);
 * biên nhận nằm ở Chi tiết Vé (3.9), không ở đây.
 */
export function OrderSuccess({ order, celebrate }: OrderSuccessProps) {
  useSuccessVibration(celebrate);
  const queryClient = useQueryClient();
  // Tạo lại link xong: ghi token mới vào Đơn và vào Chi tiết Vé đó (nếu đã có trong cache) rồi tải lại cả hai, để không
  // trang nào còn chia sẻ link đã chết.
  const shareLinkChanged = (ticketId: string) => (next: string) => {
    const queryKey = buyerOrderQueryKey(order.code);
    queryClient.setQueryData<BuyerOrderView>(queryKey, (current) =>
      current
        ? { ...current, tickets: current.tickets.map((t) => (t.id === ticketId ? { ...t, shareToken: next } : t)) }
        : current,
    );
    const ticketKey = myTicketQueryKey(ticketId);
    queryClient.setQueryData<MyTicketDetail>(ticketKey, (current) => (current ? { ...current, shareToken: next } : current));
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ticketKey });
  };
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="flex flex-col pt-2" data-slot="order-success" data-celebrate={celebrate ? 'true' : 'false'}>
      <StageBlock
        aria-live="polite"
        className="flex flex-col items-center gap-1 pt-5 pb-[46px] text-center"
      >
        <Wordmark tone="stage" />
        <span
          aria-hidden="true"
          className="mt-3 mb-1 inline-flex size-12 items-center justify-center rounded-full bg-stage-line text-primary"
        >
          <Check className="size-6" strokeWidth={2.4} />
        </span>
        <p className="text-meta text-stage-muted wrap-break-word">{order.event.name}</p>
        <h1 ref={heading} tabIndex={-1} className="text-headline">
          Vé của bạn đã sẵn sàng!
        </h1>
        <p data-slot="order-success-email" className="mt-1 max-w-full text-meta text-stage-muted wrap-break-word">
          Đã gửi Vé tới {order.buyer.email}
        </p>
      </StageBlock>
      {order.tickets.length > 0 ? (
        <ol aria-label="Vé của bạn" className="relative z-10 -mt-[30px] flex flex-col gap-stack">
          {order.tickets.map((ticket, index) => (
            <li key={ticket.id}>
              <TicketCard
                eventName={order.event.name}
                ticketTypeName={ticket.ticketTypeName}
                seq={ticket.seq}
                count={ticket.count}
                holderName={ticket.holderName}
                startsAt={order.event.startsAt}
                qr={ticket.qr}
                actions={
                  <TicketShareActions
                    ticketId={ticket.id}
                    shareToken={ticket.shareToken}
                    eventName={order.event.name}
                    seq={ticket.seq}
                    count={ticket.count}
                    onRegenerated={shareLinkChanged(ticket.id)}
                  />
                }
                className={celebrate ? 'animate-ticket-rise' : undefined}
                style={celebrate ? { animationDelay: `${index * STAGGER_MS}ms` } : undefined}
              />
            </li>
          ))}
        </ol>
      ) : (
        // Không bao giờ để trống: Đơn đã trả mà chưa đọc được Vé thì báo an toàn.
        <div className="mt-section">
          <StatusBanner tone="neutral" title="Vé của bạn đang được chuẩn bị. Tải lại trang sau ít phút." />
        </div>
      )}
      <p className="mt-section text-meta text-muted-foreground">
        Mã Đơn{' '}
        <span data-slot="order-code" className="font-bold text-foreground tabular-nums">
          {order.code}
        </span>
      </p>
      <Button asChild variant="primary-on-light" className="mt-stack w-full">
        <Link href={MY_TICKETS_PATH} data-slot="order-success-my-tickets">
          Xem Vé của tôi
        </Link>
      </Button>
    </div>
  );
}
