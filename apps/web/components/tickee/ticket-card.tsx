import { formatEventDateTime, SharedTicketStatus } from '@tickee/contracts';
import type * as React from 'react';

import { cn } from '@/lib/utils';

import { QrPlate } from './qr-plate';
import { StatusBadge } from './status-badge';

type TicketCardProps = {
  eventName: string;
  ticketTypeName: string;
  /** "Vé k/N": vị trí của Vé trong Đơn và số Vé của Đơn. */
  seq: number;
  count: number;
  /** Tên Người mua: chỉ trên thẻ của chủ Vé. Trang Vé được chia sẻ không có dòng này (không lộ tên). */
  holderName?: string;
  /** Giờ bắt đầu Sự kiện (ISO). */
  startsAt: string;
  /** Địa điểm Sự kiện; vắng hoặc `null` → không có dòng. */
  venue?: string | null;
  /** Trạng thái Vé (trang Vé được chia sẻ): badge "Hợp lệ" / "Đã check-in"; đã check-in thì QR mờ .25. */
  status?: SharedTicketStatus;
  /** Mã QR vé (`t<k>.<ticketId>.<sig>`). */
  qr: string;
  /** Nút dưới QR (vd. "Chia sẻ Vé", "Tạo lại link" của chủ Vé). */
  actions?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

const STATUS_LABEL: Record<SharedTicketStatus, { tone: 'success' | 'neutral'; label: string }> = {
  [SharedTicketStatus.VALID]: { tone: 'success', label: 'Hợp lệ' },
  [SharedTicketStatus.CHECKED_IN]: { tone: 'neutral', label: 'Đã check-in' },
};

function Row({ label, slot, children }: { label: string; slot?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd data-slot={slot} className="min-w-0 text-right font-bold wrap-break-word">
        {children}
      </dd>
    </div>
  );
}

/**
 * `ticket-card` (DESIGN.md › Thanh toán & Vé): thẻ sáng `card` dáng cuống vé — phần thông tin (tên Sự kiện, Hạng vé,
 * "Vé k/N", trạng thái nếu có, Người mua nếu là chủ Vé, ngày-giờ, địa điểm nếu có) và phần Mã QR vé ngăn bởi đường xé
 * nét đứt với hai khuyết bán nguyệt (màu nền trang: thẻ phải nằm thẳng trên `page`). QR đen trên tấm trắng 200×200 ở
 * mọi theme; Vé đã check-in thì QR mờ .25 kèm badge "Đã check-in". Khác hẳn `payment-summary` (stage tối, không QR) để
 * không ai nhầm.
 */
export function TicketCard({
  eventName,
  ticketTypeName,
  seq,
  count,
  holderName,
  startsAt,
  venue,
  status,
  qr,
  actions,
  className,
  style,
}: TicketCardProps) {
  const position = `Vé ${seq}/${count}`;
  const badge = status ? STATUS_LABEL[status] : null;
  const checkedIn = status === SharedTicketStatus.CHECKED_IN;
  return (
    <article
      data-slot="ticket-card"
      data-status={status}
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
        {badge ? (
          <p>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
          </p>
        ) : null}
        <dl className="flex flex-col text-label">
          {holderName !== undefined ? (
            <Row label="Người mua" slot="ticket-card-holder">
              {holderName}
            </Row>
          ) : null}
          <Row label="Thời gian">
            <span className="tabular-nums">{formatEventDateTime(startsAt)}</span>
          </Row>
          {venue ? (
            <Row label="Địa điểm" slot="ticket-card-venue">
              {venue}
            </Row>
          ) : null}
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
        <QrPlate
          value={qr}
          label={`Mã QR vé ${seq} trên ${count}, ${ticketTypeName}${checkedIn ? ', đã check-in' : ''}`}
          size={200}
          className={checkedIn ? 'opacity-25' : undefined}
        />
        {actions ? (
          <div data-slot="ticket-card-actions" className="flex w-full flex-col items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </article>
  );
}
