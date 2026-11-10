import { formatEventDateTime } from '@tickee/contracts';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { QrPlate } from './qr-plate';

type TicketCardProps = {
  eventName: string;
  ticketTypeName: string;
  /** "Vé k/N": vị trí của Vé trong Đơn và số Vé của Đơn. */
  seq: number;
  count: number;
  holderName: string;
  /** Giờ bắt đầu Sự kiện (ISO). */
  startsAt: string;
  /** Mã QR vé (`t<k>.<ticketId>.<sig>`). */
  qr: string;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * `ticket-card` (DESIGN.md › Thanh toán & Vé): thẻ sáng `card` dáng cuống vé — phần thông tin (tên Sự kiện, Hạng vé,
 * "Vé k/N", Người mua, ngày-giờ) và phần Mã QR vé ngăn bởi đường xé nét đứt với hai khuyết bán nguyệt (màu nền trang:
 * thẻ phải nằm thẳng trên `page`). QR đen trên tấm trắng 200×200 ở mọi theme. Khác hẳn `payment-summary` (stage tối,
 * không QR) để không ai nhầm.
 */
export function TicketCard({
  eventName,
  ticketTypeName,
  seq,
  count,
  holderName,
  startsAt,
  qr,
  className,
  style,
}: TicketCardProps) {
  const position = `Vé ${seq}/${count}`;
  return (
    <article
      data-slot="ticket-card"
      aria-label={`${position} · ${ticketTypeName}`}
      className={cn('relative rounded-lg bg-card text-card-foreground shadow-card', className)}
      style={style}
    >
      <div className="flex flex-col gap-1.5 p-card-padding">
        <p className="text-title wrap-break-word">{eventName}</p>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span data-slot="ticket-card-tier" className="text-title wrap-break-word">
            {ticketTypeName}
          </span>
          <span data-slot="ticket-card-position" className="text-label text-muted-foreground tabular-nums">
            · {position}
          </span>
        </p>
        <dl className="flex flex-col text-label">
          <div className="flex items-baseline justify-between gap-3 py-1">
            <dt className="shrink-0 text-muted-foreground">Người mua</dt>
            <dd data-slot="ticket-card-holder" className="min-w-0 text-right font-bold wrap-break-word">
              {holderName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1">
            <dt className="shrink-0 text-muted-foreground">Thời gian</dt>
            <dd className="min-w-0 text-right font-bold tabular-nums">{formatEventDateTime(startsAt)}</dd>
          </div>
        </dl>
      </div>
      {/* Đường xé + hai khuyết: trang trí, không mang thông tin. */}
      <div aria-hidden="true" data-slot="ticket-card-tear" className="relative mx-card-padding border-t-2 border-dashed">
        <span className="absolute -top-[11px] -left-[25px] size-5 rounded-full bg-background" />
        <span className="absolute -top-[11px] -right-[25px] size-5 rounded-full bg-background" />
      </div>
      <div className="flex flex-col items-center gap-stack p-card-padding">
        <p data-slot="ticket-card-qr-label" className="text-label text-muted-foreground">
          Mã QR vé · đưa cho CTV ở cổng
        </p>
        <QrPlate value={qr} label={`Mã QR vé ${seq} trên ${count}, ${ticketTypeName}`} size={200} />
      </div>
    </article>
  );
}
