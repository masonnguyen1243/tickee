'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  EventOrderFilter,
  eventOverviewLiveApiPath,
  formatVnd,
  type EventOverview,
  type EventOverviewTicketType,
  type RecentOrder,
} from '@tickee/contracts';
import Link from 'next/link';
import { useEffect, useId, useRef } from 'react';
import { toast } from 'sonner';

import { ProgressBar } from '@/components/tickee/progress-bar';
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
import {
  CHECKIN_PROGRESS_LABEL,
  CHECKIN_PROGRESS_TOTAL,
  progressLabel,
  progressValueText,
} from '@/lib/checkin/progress-view';
import { useLiveResource } from '@/lib/realtime/use-live-resource';
import { eventOverviewQueryKey, fetchEventOverview } from '@/lib/reporting/api';
import { ALL_ORDERS_LINK, eventOrdersTabPath } from '@/lib/reporting/orders';
import {
  checkinCardCaption,
  eventOverviewPollInterval,
  isSoldOut,
  orderStatusBadge,
  orderTimeLabel,
  OVERVIEW_OFFLINE_TOAST,
  OVERVIEW_OFFLINE_TOAST_ID,
  remainingLabel,
  revenueCaption,
  reviewLine,
  SOLD_OUT_LABEL,
  ticketCountLabel,
  TICKET_TYPES_TITLE,
  ticketTypePriceLabel,
  ticketTypesSoldSummary,
  ticketTypeStockLine,
  updatedAtLabel,
} from '@/lib/reporting/overview';
import { cn } from '@/lib/utils';
import { NEEDS_ACTION_LINK, needsActionValue } from '@/lib/reporting/review-queue';

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

/**
 * `recent-orders-block` (card sáng phẳng): 5 Đơn mới nhất; chưa có Đơn → "Chưa có Đơn nào.". Link "Xem tất cả Đơn" sang
 * tab Đơn (Story 6.1; chuyển tab ngay trong trang).
 */
function RecentOrdersBlock({ orgId, eventId, orders }: { orgId: string; eventId: string; orders: RecentOrder[] }) {
  const headingId = useId();
  const now = Date.now();
  return (
    <section
      aria-labelledby={headingId}
      data-slot="recent-orders-block"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-stack gap-y-1">
        <h2 id={headingId} className="text-title">
          Đơn gần đây
        </h2>
        <Link
          href={eventOrdersTabPath(orgId, eventId)}
          data-slot="all-orders-link"
          className="text-label font-bold text-brand-text underline-offset-4 hover:underline"
        >
          {ALL_ORDERS_LINK}
        </Link>
      </div>
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

/**
 * `needs-action-card` (card sáng phẳng cạnh `stat-card`, Story 4.3): số mục Cần xử lý `open` của Sự kiện. Có mục →
 * "{n} mục Cần xử lý" kèm liên kết sang tab Đơn đã lọc Cần xử lý (Story 6.1; `?tab=don&trangThai=can-xu-ly`, chuyển tab
 * ngay trong trang). 0 mục → "Không có gì cần xử lý.", không liên kết.
 */
function NeedsActionCard({
  orgId,
  eventId,
  count,
  className,
}: {
  orgId: string;
  eventId: string;
  count: number;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-slot="needs-action-card"
      className={cn('flex min-w-0 flex-col gap-1 rounded-lg bg-card p-card-padding shadow-card', className)}
    >
      <h2 id={headingId} className="text-label text-muted-foreground">
        Cần xử lý
      </h2>
      <p data-slot="needs-action-value" className="text-title tabular-nums">
        {needsActionValue(count)}
      </p>
      {count > 0 ? (
        <Link
          href={eventOrdersTabPath(orgId, eventId, { status: EventOrderFilter.NEEDS_ACTION, search: null })}
          className="self-start text-label font-bold text-brand-text underline-offset-4 hover:underline"
        >
          {NEEDS_ACTION_LINK}
        </Link>
      ) : null}
    </section>
  );
}

/**
 * `stat-card` check-in (Story 6.2, UX-DR35): cùng khuôn với thẻ tổng của tab Check-in (`checkin-progress`): "k/N" Vé
 * hợp lệ đã check-in, thanh tiến độ nền `stage-line` phần đầy `brand`. Dòng phụ "Cập nhật liên tục" khi SSE đang nối;
 * số liệu có thể đã cũ → không có dòng phụ (nhãn "Cập nhật lúc…" ở đầu khối đã báo).
 */
function CheckinStatCard({ checkin, caption }: { checkin: EventOverview['checkin']; caption: string | null }) {
  const { checkedInCount, validTicketCount } = checkin;
  return (
    <StatCard
      label={CHECKIN_PROGRESS_LABEL}
      value={progressLabel(checkedInCount, validTicketCount)}
      meter={
        <ProgressBar
          tone="stage"
          value={checkedInCount}
          max={validTicketCount}
          label={CHECKIN_PROGRESS_TOTAL}
          valueText={progressValueText(checkedInCount, validTicketCount)}
        />
      }
      caption={caption}
    />
  );
}

/** Hạng vé hết suất: " · Hết vé" (chữ, không chỉ dựa vào màu; không ngắt dòng giữa chữ). Còn suất → không có gì. */
function SoldOutSuffix({ type }: { type: EventOverviewTicketType }) {
  if (!isSoldOut(type)) return null;
  return (
    <>
      {' · '}
      <span data-slot="sold-out" className="whitespace-nowrap text-muted-foreground">
        {SOLD_OUT_LABEL}
      </span>
    </>
  );
}

/** Từ `md` trở lên: bảng phẳng Hạng vé (tên, giá) · Đã bán · Đang giữ chỗ · Còn lại; số tabular căn phải. */
function TicketTypesTable({ types }: { types: EventOverviewTicketType[] }) {
  return (
    <div className="hidden md:block" data-slot="ticket-types-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Hạng vé</TableHead>
            <TableHead className="text-right">Đã bán</TableHead>
            <TableHead className="text-right">Đang giữ chỗ</TableHead>
            <TableHead className="text-right">Còn lại</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {types.map((type, index) => (
            // api không trả id; thứ tự Hạng vé cố định (tạo trước đứng trước).
            <TableRow key={index} data-slot="ticket-type-row" className="hover:bg-transparent">
              <TableCell className="align-top whitespace-normal">
                <span className="block wrap-break-word">{type.name}</span>{' '}
                <span className="block text-meta text-muted-foreground tabular-nums">{ticketTypePriceLabel(type)}</span>
              </TableCell>
              <TableCell className="text-right align-top tabular-nums">{type.sold}</TableCell>
              <TableCell className="text-right align-top tabular-nums">{type.held}</TableCell>
              <TableCell className="text-right align-top tabular-nums">
                {remainingLabel(type)}
                <SoldOutSuffix type={type} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Dưới `md`: mỗi Hạng vé hai dòng — "tên · giá", rồi "Đã bán 30 · Đang giữ 0 · Còn 2 / 32" (hết thì "· Hết vé"). */
function TicketTypesList({ types }: { types: EventOverviewTicketType[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border md:hidden" data-slot="ticket-types-list">
      {types.map((type, index) => (
        <li key={index} data-slot="ticket-type-item" className="flex min-w-0 flex-col gap-0.5 py-stack">
          <p data-slot="ticket-type-name" className="text-label wrap-break-word">
            {type.name} <span className="text-muted-foreground tabular-nums">· {ticketTypePriceLabel(type)}</span>
          </p>
          <p data-slot="ticket-type-stock" className="text-meta text-muted-foreground tabular-nums">
            {ticketTypeStockLine(type)}
            <SoldOutSuffix type={type} />
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Khối "Vé theo Hạng vé" (Story 6.2, FR-31; `card` sáng, không stage): tổng "đã bán/sức chứa Vé đã bán" bên phải tiêu
 * đề; bảng từ `md`, danh sách dưới `md`. Không có cột doanh thu theo Hạng vé (lệch có chủ đích so với mockup:
 * `paid_amount` là của cả Đơn). Nơi gọi không render khi Sự kiện chưa có Hạng vé nào.
 */
function TicketTypesBlock({ types }: { types: EventOverviewTicketType[] }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-slot="ticket-types-block"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-stack gap-y-1">
        <h2 id={headingId} className="text-title">
          {TICKET_TYPES_TITLE}
        </h2>
        <p data-slot="ticket-types-summary" className="text-meta text-muted-foreground tabular-nums">
          {ticketTypesSoldSummary(types)}
        </p>
      </div>
      <TicketTypesTable types={types} />
      <TicketTypesList types={types} />
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="event-overview-skeleton" className="flex flex-col gap-section">
      <span className="sr-only">Đang tải số liệu Sự kiện</span>
      <div className="grid gap-stack md:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28 md:col-span-2 lg:col-span-1" />
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-48" />
    </div>
  );
}

/**
 * Các khối đầu tab Tổng quan (Story 3.11, FR-31, UX-DR35): hàng số liệu `stat-card` doanh thu (chỉ Đơn Đã thanh toán,
 * tiền đã nhận) · `stat-card` check-in (Story 6.2) · `needs-action-card` (số mục Cần xử lý, Story 4.3) — một cột dưới
 * `md`, ba cột từ `lg`; khối "Vé theo Hạng vé" (Story 6.2) và `recent-orders-block` 5 Đơn mới nhất. Tự cập nhật qua
 * `useLiveResource` + `GET …/overview/live` (tín hiệu `event_orders_changed`, `event_checkins_changed` hoặc
 * `org_review_items_changed` → tải lại REST); không có SSE thì polling 10 giây. Mất mạng → một toast mỗi lần mất mạng,
 * số liệu giữ giá trị cuối kèm "Cập nhật lúc HH:MM"; có mạng lại thì tải lại và ẩn nhãn. Lần tải lại lỗi khác (vd. 5xx)
 * khi đã có dữ liệu → cùng nhãn, không toast; tải lại được thì ẩn. Tải lần đầu lỗi → banner trong khối kèm "Thử lại";
 * `401` → đăng nhập. Chỉ render cho Sự kiện không ở `draft` (nơi gọi quyết).
 */
export function EventOverviewLive({ orgId, eventId }: { orgId: string; eventId: string }) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const { query, offline, connected } = useLiveResource({
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
        <div data-slot="overview-stats" className="grid gap-stack md:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Doanh thu"
            value={formatVnd(data.revenue.amount)}
            caption={revenueCaption(data.revenue.paidOrders)}
          />
          <CheckinStatCard checkin={data.checkin} caption={checkinCardCaption({ connected, stale })} />
          <NeedsActionCard
            orgId={orgId}
            eventId={eventId}
            count={data.openReviewCount}
            className="md:col-span-2 lg:col-span-1"
          />
        </div>
      </div>
      {data.ticketTypes.length > 0 ? <TicketTypesBlock types={data.ticketTypes} /> : null}
      <RecentOrdersBlock orgId={orgId} eventId={eventId} orders={data.recentOrders} />
    </div>
  );
}
