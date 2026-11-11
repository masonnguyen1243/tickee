'use client';

import {
  BuyerOrderStatus,
  buyerOrderLiveApiPath,
  ErrorCode,
  eventPagePath,
  PaymentLinkError,
  type BuyerOrderView,
} from '@tickee/contracts';
import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/tickee/empty-state';
import { OrganizerContact } from '@/components/tickee/organizer-contact';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { priceLabel } from '@/lib/event/selection';
import { buyerOrderQueryKey, fetchBuyerOrder } from '@/lib/order/api';
import {
  clearOrderMoment,
  hasOrderMoment,
  INITIAL_MOMENT,
  isWaiting,
  LONG_WAIT_MS,
  nextMoment,
  orderPollInterval,
} from '@/lib/order/live';
import { useLiveResource } from '@/lib/realtime/use-live-resource';

import { BuyerSkeleton } from '../../buyer-gate';
import { OrderPayment } from './order-payment';
import { OrderSuccess } from './order-success';

const SALES_PAUSED = 'Sự kiện tạm ngừng bán. Bạn thử lại sau nhé.';
const HOLD_EXPIRED = 'Hết thời gian giữ chỗ. Chỗ đã được trả lại.';
const UNDER_REVIEW = 'BTC đang kiểm tra thanh toán';
const CANCELLED_BY_ORGANIZER = 'BTC đã hủy Đơn này. Liên hệ BTC để được hoàn tiền nếu bạn đã chuyển.';
const EVENT_CANCELLED = 'Sự kiện đã hủy — BTC sẽ liên hệ hoàn tiền.';
const UNKNOWN_STATUS = 'Chúng tôi đang cập nhật trạng thái Đơn.';

/** Đơn đã hết hạn vì dịch vụ thanh toán của BTC tạm ngừng (Tingee từ chối tạo link). */
const salesPaused = (order: BuyerOrderView) => order.payment?.linkError === PaymentLinkError.SALES_PAUSED;

/**
 * Khối trạng thái của mọi `buyerStatus` không có màn riêng (màn thanh toán và Thành công có màn riêng). Mỗi trạng thái
 * Người mua cần liên hệ BTC thì kèm kênh liên hệ BTC; không bao giờ có Mã QR vé. `buyerStatus` lạ (máy chủ mới hơn bản
 * web) → câu an toàn + liên hệ BTC, không bao giờ trống hay kẹt.
 */
function StatusBlock({ order }: { order: BuyerOrderView }) {
  switch (order.buyerStatus) {
    case BuyerOrderStatus.AWAITING_PAYMENT:
    case BuyerOrderStatus.CONFIRMING:
      // Đơn chờ không có phần thanh toán (Đơn 0đ không bao giờ ở đây quá TX1).
      return <StatusBanner tone="neutral" title="Đang giữ chỗ cho Đơn của bạn." />;
    case BuyerOrderStatus.EXPIRED:
      if (salesPaused(order)) {
        // Dịch vụ thanh toán của BTC đang tạm ngừng (Tingee từ chối tạo link): Đơn đã hết hạn, chỗ đã trả lại.
        return (
          <div data-slot="order-sales-paused" className="flex flex-col gap-stack">
            <StatusBanner tone="warning" title={SALES_PAUSED} />
            <Button asChild variant="primary-on-light">
              <Link href={eventPagePath(order.event.slug)}>Về trang Sự kiện</Link>
            </Button>
          </div>
        );
      }
      return (
        <div data-slot="order-expired" className="flex flex-col gap-stack">
          <StatusBanner tone="warning" title={HOLD_EXPIRED} />
          <Button asChild variant="primary-on-light">
            <Link href={eventPagePath(order.event.slug)}>Mua lại</Link>
          </Button>
          <p className="text-meta text-muted-foreground">
            Nếu bạn đã chuyển tiền, đừng chuyển lại — kiểm tra Vé của tôi hoặc email.
          </p>
        </div>
      );
    case BuyerOrderStatus.UNDER_REVIEW:
      return (
        <div data-slot="order-under-review" className="flex flex-col gap-stack">
          <StatusBanner tone="warning" title={UNDER_REVIEW} />
          <OrganizerContact organizer={order.organizer} />
        </div>
      );
    case BuyerOrderStatus.CANCELLED_BY_ORGANIZER:
      return (
        <div data-slot="order-cancelled" className="flex flex-col gap-stack">
          <StatusBanner tone="neutral" title={CANCELLED_BY_ORGANIZER} />
          <OrganizerContact organizer={order.organizer} />
        </div>
      );
    case BuyerOrderStatus.EVENT_CANCELLED:
      return (
        <div data-slot="order-event-cancelled" className="flex flex-col gap-stack">
          <StatusBanner tone="warning" title={EVENT_CANCELLED} />
          <OrganizerContact organizer={order.organizer} />
        </div>
      );
    default:
      return (
        <div data-slot="order-unknown-status" className="flex flex-col gap-stack">
          <StatusBanner tone="neutral" title={UNKNOWN_STATUS} />
          <OrganizerContact organizer={order.organizer} />
        </div>
      );
  }
}

/**
 * Câu cho vùng `aria-live` luôn gắn của Trang Đơn: Đơn chờ thì rỗng (màn thanh toán có vùng riêng cho "Đang xác nhận…");
 * Đơn rời màn chờ thì đổi chữ nên trình đọc màn hình đọc trạng thái mới (banner vừa gắn kèm sẵn chữ thì không được đọc).
 */
function statusAnnouncement(order: BuyerOrderView): string {
  switch (order.buyerStatus) {
    case BuyerOrderStatus.AWAITING_PAYMENT:
    case BuyerOrderStatus.CONFIRMING:
      return '';
    case BuyerOrderStatus.EXPIRED:
      return salesPaused(order) ? SALES_PAUSED : HOLD_EXPIRED;
    case BuyerOrderStatus.UNDER_REVIEW:
      return UNDER_REVIEW;
    case BuyerOrderStatus.CANCELLED_BY_ORGANIZER:
      return CANCELLED_BY_ORGANIZER;
    case BuyerOrderStatus.EVENT_CANCELLED:
      return EVENT_CANCELLED;
    default:
      return UNKNOWN_STATUS;
  }
}

/** Tóm tắt Đơn (bản chụp lúc đặt): từng dòng Hạng vé và tổng. */
function OrderSummary({ order }: { order: BuyerOrderView }) {
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <section
      aria-labelledby="order-summary-heading"
      data-slot="order-summary"
      className="flex flex-col rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
    >
      <h2 id="order-summary-heading" className="text-title">
        Vé đã đặt
      </h2>
      <ul className="flex flex-col divide-y">
        {order.items.map((item) => (
          <li key={item.ticketTypeId} data-slot="order-summary-line" className="flex items-start justify-between gap-3 py-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-label font-bold">{item.name}</p>
              <p className="text-meta text-muted-foreground tabular-nums">
                {item.quantity} × {priceLabel(item.unitPrice)}
              </p>
            </div>
            <span className="shrink-0 text-label font-bold tabular-nums">{priceLabel(item.amount)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t pt-3">
        <span className="text-meta text-muted-foreground tabular-nums">Tổng · {count} vé</span>
        <span data-slot="order-summary-total" className="text-total tabular-nums">
          {priceLabel(order.totalAmount)}
        </span>
      </div>
    </section>
  );
}

/**
 * "Khoảnh khắc" Thành công của lần mở trang này: trang thấy Đơn chuyển sang `paid`, hoặc lần đầu thấy Đơn đã `paid` mà
 * có cờ một lần do Checkout / nút "Thanh toán" đặt. Cờ đọc một lần lúc gắn rồi xóa: mở lại hay tải lại thì hiện ngay.
 * Tính ngay trong lúc render (không qua effect) để thẻ Vé không vẽ một khung không có chuyển cảnh.
 */
function useSuccessMoment(code: string, buyerStatus: string | undefined): boolean {
  const [flagged] = useState(() => hasOrderMoment(code));
  useEffect(() => clearOrderMoment(code), [code]);
  const [moment, setMoment] = useState(INITIAL_MOMENT);
  const next = buyerStatus === undefined ? moment : nextMoment(moment, buyerStatus, flagged);
  if (next !== moment) setMoment(next);
  return next.moment;
}

/** Đã ở màn chờ (`awaiting_payment`/`confirming`) chừng `LONG_WAIT_MS` trong lần mở trang này. */
function useLongWait(waiting: boolean): boolean {
  const [since, setSince] = useState<number | null>(null);
  const [long, setLong] = useState(false);
  useEffect(() => {
    if (!waiting || long) return;
    const start = since ?? Date.now();
    if (since === null) setSince(start);
    const timer = window.setTimeout(() => setLong(true), Math.max(0, start + LONG_WAIT_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [waiting, since, long]);
  return waiting && long;
}

/**
 * Trang Đơn (Story 3.2–3.4, 3.7): Đơn lấy từ máy chủ (`GET /v1/me/orders/:code`) và tự cập nhật qua `useLiveResource`
 * (SSE `…/live` + tải lại khi visible, có mạng lại; polling 2 giây khi chưa có SSE mà Đơn đang chờ tiền). Hiển thị theo
 * `buyerStatus`, không bao giờ theo tham số trên URL: chờ tiền → màn thanh toán (Story 3.4) rồi tóm tắt Đơn; `paid` →
 * Thành công với từng Vé; trạng thái khác → khối trạng thái (kèm liên hệ BTC khi cần) rồi tóm tắt. Mã sai, Đơn của
 * người khác hay không có → thông báo riêng (`404 ORDER_NOT_FOUND`).
 */
export function OrderView({ code }: { code: string }) {
  const { query: order, offline } = useLiveResource({
    queryKey: buyerOrderQueryKey(code),
    queryFn: (signal) => fetchBuyerOrder(code, signal),
    livePath: buyerOrderLiveApiPath(code),
    pollInterval: orderPollInterval,
  });
  const buyerStatus = order.data?.buyerStatus;
  const celebrate = useSuccessMoment(code, buyerStatus);
  const waiting = buyerStatus !== undefined && isWaiting(buyerStatus);
  const longWait = useLongWait(waiting);

  if (hasErrorCode(order.error, ErrorCode.ORDER_NOT_FOUND)) {
    return (
      <EmptyState
        icon={SearchX}
        title="Không tìm thấy Đơn này."
        description="Kiểm tra lại link, hoặc đăng nhập đúng tài khoản đã đặt Đơn."
      />
    );
  }
  if (order.isError && !order.data) {
    return (
      <div className="flex flex-col gap-section pt-2">
        <StatusBanner
          tone="danger"
          title="Chưa tải được Đơn"
          description={messageOf(order.error)}
          action={
            <Button type="button" variant="link" size="sm" loading={order.isFetching} onClick={() => void order.refetch()}>
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }
  if (!order.data) return <BuyerSkeleton />;

  const data = order.data;
  if (data.buyerStatus === BuyerOrderStatus.PAID) return <OrderSuccess order={data} celebrate={celebrate} />;
  const payment = waiting ? data.payment : null;
  // Cùng một gốc và cùng vùng `aria-live` (con đầu, `sr-only` nên không chiếm chỗ trong flex) cho mọi trạng thái chưa
  // trả: Đơn đổi trạng thái thì vùng này vẫn gắn, chỉ đổi chữ, nên được đọc.
  return (
    <div className="flex flex-col gap-section pt-2" data-slot="order-view" data-status={data.buyerStatus}>
      <p aria-live="polite" data-slot="order-status-announcement" className="sr-only">
        {statusAnnouncement(data)}
      </p>
      {payment ? (
        <>
          <OrderPayment
            order={data}
            payment={payment}
            receivedAt={order.dataUpdatedAt}
            longWait={longWait}
            offline={offline}
          />
          <OrderSummary order={data} />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-meta text-muted-foreground">{data.event.name}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="text-headline">Đơn của bạn</h1>
              {data.buyerStatus === BuyerOrderStatus.CANCELLED_BY_ORGANIZER ? (
                <StatusBadge tone="neutral">Đã hủy</StatusBadge>
              ) : null}
            </div>
            <p className="text-meta text-muted-foreground">
              Mã Đơn{' '}
              <span data-slot="order-code" className="font-bold text-foreground tabular-nums">
                {data.code}
              </span>
            </p>
          </div>
          <StatusBlock order={data} />
          <OrderSummary order={data} />
        </>
      )}
    </div>
  );
}
