'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ErrorCode, eventOverviewLiveApiPath, formatVnd, type RecentOrder } from '@tickee/contracts';
import { useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';

import { StatCard } from '@/components/tickee/stat-card';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { useLiveResource } from '@/lib/realtime/use-live-resource';
import { eventOverviewQueryKey, fetchEventOverview } from '@/lib/reporting/api';
import {
  eventOverviewPollInterval,
  orderStatusBadge,
  orderTimeLabel,
  OVERVIEW_OFFLINE_TOAST,
  OVERVIEW_OFFLINE_TOAST_ID,
  revenueCaption,
  reviewLine,
  ticketCountLabel,
  updatedAtLabel,
} from '@/lib/reporting/overview';

/** Badge trạng thái kèm dòng loại Cần xử lý (nếu có). */
function OrderStatusCell({ order }: { order: RecentOrder }) {
  const badge = orderStatusBadge(order.status);
  const line = reviewLine(order);
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      {line ? (
        <span data-slot="review-line" className="text-meta whitespace-normal text-muted-foreground">
          {line}
        </span>
      ) : null}
    </div>
  );
}

/** Từ `md` trở lên: bảng Mã Đơn · Người mua · Vé · Số tiền · Trạng thái · Thời gian. */
function OrdersTable({ orders, now }: { orders: RecentOrder[]; now: number }) {
  return (
    <div className="hidden md:block" data-slot="recent-orders-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Mã Đơn</TableHead>
            <TableHead>Người mua</TableHead>
            <TableHead>Vé</TableHead>
            <TableHead className="text-right">Số tiền</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Thời gian</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.code} data-slot="recent-order-row" className="hover:bg-transparent">
              <TableCell className="align-top font-mono text-code">{order.code}</TableCell>
              <TableCell className="align-top whitespace-normal wrap-break-word">{order.buyerName}</TableCell>
              <TableCell className="align-top tabular-nums">{ticketCountLabel(order.ticketCount)}</TableCell>
              <TableCell className="text-right align-top tabular-nums">{formatVnd(order.totalAmount)}</TableCell>
              <TableCell className="align-top">
                <OrderStatusCell order={order} />
              </TableCell>
              <TableCell className="align-top text-muted-foreground tabular-nums">
                {orderTimeLabel(order.createdAt, now)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Dưới `md`: danh sách thẻ — tên, mã Đơn · số Vé · giờ, dòng loại; số tiền và badge bên phải. */
function OrdersList({ orders, now }: { orders: RecentOrder[]; now: number }) {
  return (
    <ul className="flex flex-col divide-y divide-border md:hidden" data-slot="recent-orders-list">
      {orders.map((order) => {
        const line = reviewLine(order);
        const badge = orderStatusBadge(order.status);
        return (
          <li key={order.code} data-slot="recent-order-card" className="flex items-start justify-between gap-stack py-stack">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-label wrap-break-word">{order.buyerName}</p>
              <p className="text-meta text-muted-foreground tabular-nums">
                <span className="font-mono">{order.code}</span> · {ticketCountLabel(order.ticketCount)} ·{' '}
                {orderTimeLabel(order.createdAt, now)}
              </p>
              {line ? (
                <p data-slot="review-line" className="text-meta text-muted-foreground">
                  {line}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="text-label tabular-nums">{formatVnd(order.totalAmount)}</p>
              <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** `recent-orders-block` (card sáng phẳng): 5 Đơn mới nhất; chưa có Đơn → "Chưa có Đơn nào.". */
function RecentOrdersBlock({ orders }: { orders: RecentOrder[] }) {
  const headingId = useId();
  const now = Date.now();
  return (
    <section
      aria-labelledby={headingId}
      data-slot="recent-orders-block"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h2 id={headingId} className="text-title">
        Đơn gần đây
      </h2>
      {orders.length === 0 ? (
        <p data-slot="recent-orders-empty" className="text-body text-muted-foreground">
          Chưa có Đơn nào.
        </p>
      ) : (
        <>
          <OrdersTable orders={orders} now={now} />
          <OrdersList orders={orders} now={now} />
        </>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="event-overview-skeleton" className="flex flex-col gap-section">
      <span className="sr-only">Đang tải số liệu Sự kiện</span>
      <div className="grid gap-stack md:grid-cols-2">
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

/**
 * Hai khối đầu tab Tổng quan (Story 3.11, FR-31, UX-DR35): `stat-card` doanh thu (chỉ Đơn Đã thanh toán) và
 * `recent-orders-block` 5 Đơn mới nhất. Tự cập nhật qua `useLiveResource` + `GET …/overview/live` (tín hiệu
 * `event_orders_changed` → tải lại REST); không có SSE thì polling 10 giây. Mất mạng → một toast mỗi lần mất mạng, số
 * liệu giữ giá trị cuối kèm "Cập nhật lúc HH:MM"; có mạng lại thì tải lại và ẩn nhãn. Lần tải lại lỗi khác (vd. 5xx)
 * khi đã có dữ liệu → cùng nhãn, không toast; tải lại được thì ẩn. Tải lần đầu lỗi → banner trong
 * khối kèm "Thử lại"; `401` → đăng nhập. Chỉ render cho Sự kiện không ở `draft` (nơi gọi quyết).
 */
export function EventOverviewLive({ orgId, eventId }: { orgId: string; eventId: string }) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const { query, offline } = useLiveResource({
    queryKey: eventOverviewQueryKey(orgId, eventId),
    queryFn: (signal) => fetchEventOverview(orgId, eventId, signal),
    livePath: eventOverviewLiveApiPath(orgId, eventId),
    pollInterval: eventOverviewPollInterval,
  });

  const unauthenticated = hasErrorCode(query.error, ErrorCode.UNAUTHENTICATED);
  const goToLoginRef = useRef(goToLogin);
  goToLoginRef.current = goToLogin;
  const redirected = useRef(false);
  useEffect(() => {
    if (!unauthenticated || redirected.current) return;
    redirected.current = true;
    // Bỏ khỏi cache: quay lại sau đăng nhập không mang theo lỗi 401 cũ (sẽ đẩy về đăng nhập lần nữa).
    queryClient.removeQueries({ queryKey: eventOverviewQueryKey(orgId, eventId) });
    goToLoginRef.current();
  }, [unauthenticated, queryClient, orgId, eventId]);

  // Một toast mỗi lần mất mạng (`id` cố định: hiệu ứng chạy lại cũng chỉ một toast); có mạng lại thì gỡ toast.
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline && !wasOffline.current) toast.warning(OVERVIEW_OFFLINE_TOAST, { id: OVERVIEW_OFFLINE_TOAST_ID });
    if (!offline && wasOffline.current) toast.dismiss(OVERVIEW_OFFLINE_TOAST_ID);
    wasOffline.current = offline;
  }, [offline]);
  useEffect(() => () => void toast.dismiss(OVERVIEW_OFFLINE_TOAST_ID), []);

  const data = query.data;
  // Số liệu đang hiện có thể đã cũ: mất mạng, hoặc lần tải lại gần nhất lỗi (vd. 5xx sau khi đã thử lại) mà vẫn còn dữ
  // liệu cũ. Lỗi do nơi khác xử lý (401, 2FA…) không tính. Chỉ hiện nhãn, không thêm toast.
  const stale = offline || (query.isError && data !== undefined && !handledElsewhere(query.error));
  if (!data) {
    if (!query.isError || handledElsewhere(query.error)) return <OverviewSkeleton />;
    return (
      <div data-slot="event-overview-error">
        <StatusBanner
          tone="danger"
          title="Chưa tải được số liệu Sự kiện"
          description={messageOf(query.error)}
          action={
            <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div data-slot="event-overview-live" className="flex min-w-0 flex-col gap-section">
      <div className="flex flex-col">
        {/* Vùng live luôn có trong DOM (rỗng thì không chiếm chỗ): nhãn hiện ra được đọc cho trình đọc màn hình. */}
        <div aria-live="polite" className="[&:not(:empty)]:mb-2">
          {stale ? (
            <p data-slot="overview-updated-at" className="text-meta text-muted-foreground tabular-nums">
              {updatedAtLabel(query.dataUpdatedAt)}
            </p>
          ) : null}
        </div>
        <div className="grid gap-stack md:grid-cols-2">
          <StatCard
            label="Doanh thu"
            value={formatVnd(data.revenue.amount)}
            caption={revenueCaption(data.revenue.paidOrders)}
          />
        </div>
      </div>
      <RecentOrdersBlock orders={data.recentOrders} />
    </div>
  );
}
