'use client';

import { BuyerOrderStatus, formatEventDateTime, orderPath, type MyPendingOrder } from '@tickee/contracts';
import Link from 'next/link';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { priceLabel } from '@/lib/event/selection';
import { CANCELLED_BY_ORGANIZER, EVENT_CANCELLED, UNDER_REVIEW, UNKNOWN_STATUS } from '@/lib/order/status-copy';
import { useServerCountdown } from '@/lib/order/use-server-countdown';
import { cn } from '@/lib/utils';

import { CountdownChip } from './countdown-chip';
import { OrganizerContact } from './organizer-contact';
import { StatusBadge } from './status-badge';
import type { StatusTone } from './tone';

type OrderCardProps = {
  order: MyPendingOrder;
  /** Giờ máy chủ của danh sách (`MyTicketsView.serverNow`) và giờ máy lúc nhận nó: đếm ngược không theo đồng hồ máy. */
  serverNow: string;
  receivedAt: number;
};

/** Badge theo `buyerStatus` (DESIGN.md › status-badge: Chờ thanh toán → warning; Hết hạn, Đã hủy → neutral). */
function badgeOf(buyerStatus: string): { tone: StatusTone; label: string } {
  switch (buyerStatus) {
    case BuyerOrderStatus.AWAITING_PAYMENT:
    case BuyerOrderStatus.CONFIRMING:
      return { tone: 'warning', label: 'Chờ thanh toán' };
    case BuyerOrderStatus.UNDER_REVIEW:
      return { tone: 'warning', label: UNDER_REVIEW };
    case BuyerOrderStatus.CANCELLED_BY_ORGANIZER:
    case BuyerOrderStatus.EVENT_CANCELLED:
      return { tone: 'neutral', label: 'Đã hủy' };
    case BuyerOrderStatus.EXPIRED:
      return { tone: 'neutral', label: 'Hết hạn' };
    default:
      return { tone: 'neutral', label: 'Đang cập nhật' };
  }
}

/**
 * Hàng dưới của Đơn chờ tiền: `countdown-chip` trên nền sáng (không đọc mốc) đếm theo `serverNow` + "Tiếp tục thanh
 * toán" mở Trang Đơn của đúng Đơn này. Đồng hồ về 0 (hoặc máy chủ báo `confirming`) → "Đang xác nhận thanh toán", ẩn nút,
 * thẻ vẫn ở nhóm; không bao giờ tự hiện "Hết hạn".
 */
function AwaitingPayment({ order, serverNow, receivedAt }: OrderCardProps) {
  const seconds = useServerCountdown(order.expiresAt, serverNow, receivedAt);
  const confirming = seconds === 0 || order.buyerStatus === BuyerOrderStatus.CONFIRMING;
  return (
    <div className="flex flex-col items-start gap-stack">
      <CountdownChip seconds={seconds} confirming={confirming} surface="light" />
      {confirming ? null : (
        <Button asChild variant="primary-on-light" className="w-full">
          <Link href={orderPath(order.code)}>Tiếp tục thanh toán</Link>
        </Button>
      )}
    </div>
  );
}

/** Câu trạng thái nhỏ của hàng dưới. */
function Note({ children }: { children: string }) {
  return (
    <p data-slot="order-card-note" className="text-meta text-muted-foreground">
      {children}
    </p>
  );
}

/** Hàng dưới theo `buyerStatus`; trạng thái cần liên hệ BTC thì kèm kênh liên hệ BTC. */
function Footer(props: OrderCardProps) {
  const { order } = props;
  const contact = <OrganizerContact organizer={order.organizer} headingLevel={4} variant="inline" />;
  switch (order.buyerStatus) {
    case BuyerOrderStatus.AWAITING_PAYMENT:
    case BuyerOrderStatus.CONFIRMING:
      return <AwaitingPayment {...props} />;
    case BuyerOrderStatus.UNDER_REVIEW:
      return contact;
    case BuyerOrderStatus.CANCELLED_BY_ORGANIZER:
      return (
        <>
          <Note>{CANCELLED_BY_ORGANIZER}</Note>
          {contact}
        </>
      );
    case BuyerOrderStatus.EVENT_CANCELLED:
      return (
        <>
          <Note>{EVENT_CANCELLED}</Note>
          {contact}
        </>
      );
    case BuyerOrderStatus.EXPIRED:
      // Chỉ badge "Hết hạn": Đơn có thể hết hạn vì hết giờ Giữ chỗ hoặc vì dịch vụ thanh toán của BTC tạm ngừng, mà
      // danh sách không mang lý do (Trang Đơn ghi đúng câu).
      return null;
    default:
      return (
        <>
          <Note>{UNKNOWN_STATUS}</Note>
          {contact}
        </>
      );
  }
}

const DIMMED: readonly string[] = [BuyerOrderStatus.CANCELLED_BY_ORGANIZER, BuyerOrderStatus.EVENT_CANCELLED];

/**
 * `order-card` (DESIGN.md › order-card, Story 3.9): thẻ cho Đơn chưa thành Vé trong nhóm "Đơn đang chờ" của Vé của tôi —
 * **không bao giờ có QR nào**. Hàng trên: tên Sự kiện + `status-badge`; hàng giữa: ngày-giờ · Hạng vé × số lượng · số
 * tiền · mã Đơn; hàng dưới theo `buyerStatus`:
 * - Chờ thanh toán: đếm ngược + "Tiếp tục thanh toán"; về 0 → "Đang xác nhận thanh toán".
 * - `under_review`: badge warning "BTC đang kiểm tra thanh toán" + liên hệ BTC, không có nút chính.
 * - Đã hủy (BTC hủy Đơn, Sự kiện hủy): badge neutral "Đã hủy" + liên hệ BTC, thẻ mờ nhẹ (tên Sự kiện chữ muted).
 * - `expired` (máy chủ báo, trong 30 phút sau hạn): chỉ badge neutral "Hết hạn", không câu, không nút.
 * - `buyerStatus` lạ: câu an toàn + liên hệ BTC.
 */
export function OrderCard(props: OrderCardProps) {
  const { order } = props;
  const titleId = useId();
  const badge = badgeOf(order.buyerStatus);
  const dimmed = DIMMED.includes(order.buyerStatus);
  return (
    <article
      aria-labelledby={titleId}
      data-slot="order-card"
      data-status={order.buyerStatus}
      data-dimmed={dimmed ? 'true' : undefined}
      className="flex flex-col gap-2 rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
    >
      {/* Badge dài ("BTC đang kiểm tra thanh toán") xuống dòng dưới tên khi màn hẹp (320px) thay vì ép tên. */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3
          id={titleId}
          className={cn('min-w-0 flex-[1_1_10rem] text-title wrap-break-word', dimmed && 'text-muted-foreground')}
        >
          {order.event.name}
        </h3>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>
      <div className="flex flex-col gap-0.5 text-meta text-muted-foreground">
        <p className="tabular-nums">{formatEventDateTime(order.event.startsAt)}</p>
        <p data-slot="order-card-items">{order.items.map((item) => `${item.name} × ${item.quantity}`).join(' · ')}</p>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span data-slot="order-card-total" className="text-label font-bold text-foreground tabular-nums">
            {priceLabel(order.totalAmount)}
          </span>
          <span>
            · Mã Đơn{' '}
            <span data-slot="order-code" className="font-mono text-code text-foreground tabular-nums">
              {order.code}
            </span>
          </span>
        </p>
      </div>
      {order.buyerStatus === BuyerOrderStatus.EXPIRED ? null : (
        <div className="flex flex-col gap-2 border-t pt-2">
          <Footer {...props} />
        </div>
      )}
    </article>
  );
}
