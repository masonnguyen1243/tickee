'use client';

import type { BuyerOrder } from '@tickee/contracts';
import { Check } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { StageBlock } from '@/components/tickee/stage-block';
import { StatusBanner } from '@/components/tickee/status-banner';
import { TicketCard } from '@/components/tickee/ticket-card';
import { Wordmark } from '@/components/tickee/wordmark';

/** Mỗi thẻ sau trượt lên trễ hơn thẻ trước chừng này ms. */
const STAGGER_MS = 90;
/** "Rung nhẹ" khi Vé hiện (EXPERIENCE.md › Interaction Primitives). */
const VIBRATE_MS = 40;

/** Rung nhẹ một lần nếu thiết bị hỗ trợ; reduced motion thì không rung. */
function useSuccessVibration(): void {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof navigator.vibrate === 'function') navigator.vibrate(VIBRATE_MS);
  }, []);
}

/**
 * Màn "Thành công" của Trang Đơn khi Đơn `paid` (Story 3.3; 3.7 dùng lại khi Đơn có phí tự chuyển): stage có wordmark,
 * tên Sự kiện, "Vé của bạn đã sẵn sàng!" (`aria-live="polite"`; vùng live gắn cùng lúc với nội dung nên không được đọc,
 * và trình báo đổi trang của Next chỉ đọc tiêu đề trang: lúc gắn chuyển focus vào `h1` để trình đọc màn hình đọc câu
 * này ngay sau "Đăng ký"); mỗi Vé một `ticket-card`, thẻ đầu chồng mép dưới stage
 * ~30px, các thẻ trượt lên từ sân khấu và máy rung nhẹ. Reduced motion: hiện ngay, không trượt (quy tắc toàn cục trong
 * globals.css tắt animation), không rung. Chưa có email Vé (3.8), "Chia sẻ Vé" (3.8) hay "Xem Vé của tôi" (3.9).
 */
export function OrderSuccess({ order }: { order: BuyerOrder }) {
  useSuccessVibration();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="flex flex-col pt-2" data-slot="order-success">
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
                className="animate-ticket-rise"
                style={{ animationDelay: `${index * STAGGER_MS}ms` }}
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
    </div>
  );
}
