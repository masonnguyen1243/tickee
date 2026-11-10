'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorCode, eventPagePath, OrderStatus, type BuyerOrder } from '@tickee/contracts';
import { SearchX } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/tickee/empty-state';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { priceLabel } from '@/lib/event/selection';
import { buyerOrderQueryKey, fetchBuyerOrder } from '@/lib/order/api';

import { BuyerSkeleton } from '../../buyer-gate';

/** Đơn đang chờ: hỏi lại máy chủ mỗi chừng này ms để thấy "Hết hạn" khi job chạy (Story 3.7 thay bằng realtime). */
const PENDING_REFETCH_MS = 5_000;

function StatusBlock({ order }: { order: BuyerOrder }) {
  if (order.status === OrderStatus.PENDING) {
    return <StatusBanner tone="neutral" title="Đang giữ chỗ cho Đơn của bạn." />;
  }
  if (order.status === OrderStatus.EXPIRED) {
    return (
      <div data-slot="order-expired" className="flex flex-col gap-stack">
        <StatusBanner tone="warning" title="Hết thời gian giữ chỗ. Chỗ đã được trả lại." />
        <Button asChild variant="primary-on-light">
          <Link href={eventPagePath(order.event.slug)}>Mua lại</Link>
        </Button>
        <p className="text-meta text-muted-foreground">
          Nếu bạn đã chuyển tiền, đừng chuyển lại — kiểm tra Vé của tôi hoặc email.
        </p>
      </div>
    );
  }
  // Trạng thái chưa có màn riêng ở story này: luôn hiện một câu an toàn, không bao giờ trống hay kẹt.
  return <StatusBanner tone="neutral" title="Đơn của bạn đang được xử lý." />;
}

/**
 * Tóm tắt, mã Đơn và trạng thái lấy từ máy chủ (`GET /v1/me/orders/:code`). Mã sai, Đơn của người khác hay không có →
 * thông báo riêng (`404 ORDER_NOT_FOUND`).
 */
export function OrderView({ code }: { code: string }) {
  const order = useQuery({
    queryKey: buyerOrderQueryKey(code),
    queryFn: ({ signal }) => fetchBuyerOrder(code, signal),
    refetchInterval: (query) => (query.state.data?.status === OrderStatus.PENDING ? PENDING_REFETCH_MS : false),
  });

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
  const count = data.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <div className="flex flex-col gap-section pt-2" data-slot="order-view" data-status={data.status}>
      <div className="flex flex-col gap-1">
        <p className="text-meta text-muted-foreground">{data.event.name}</p>
        <h1 className="text-headline">Đơn của bạn</h1>
        <p className="text-meta text-muted-foreground">
          Mã Đơn{' '}
          <span data-slot="order-code" className="font-bold text-foreground tabular-nums">
            {data.code}
          </span>
        </p>
      </div>
      <div aria-live="polite">
        <StatusBlock order={data} />
      </div>
      <section
        aria-labelledby="order-summary-heading"
        data-slot="order-summary"
        className="flex flex-col rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
      >
        <h2 id="order-summary-heading" className="text-title">
          Vé đã đặt
        </h2>
        <ul className="flex flex-col divide-y">
          {data.items.map((item) => (
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
            {priceLabel(data.totalAmount)}
          </span>
        </div>
      </section>
    </div>
  );
}
