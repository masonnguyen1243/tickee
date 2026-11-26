'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  eventOverviewLiveApiPath,
  EVENT_ORDERS_SEARCH_MAX,
  formatVnd,
  localBuyerPhone,
  parseOrderSearch,
  type EventDetail,
  type EventOrderFilter,
  type EventOrderRow,
} from '@tickee/contracts';
import { Check, Copy, Inbox, SearchX, X } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { EmptyState } from '@/components/tickee/empty-state';
import { FieldError } from '@/components/tickee/field-error';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { copyWithToast } from '@/lib/clipboard';
import { useLiveResource } from '@/lib/realtime/use-live-resource';
import {
  eventOrdersQueryKey,
  eventOrdersQueryPrefix,
  fetchEventOrders,
  isFiltered,
  NO_ORDERS_FILTER,
  ORDER_FILTER_CHIPS,
  orderItemsLabel,
  ORDERS_EMPTY_DESCRIPTION,
  ORDERS_EMPTY_DRAFT_DESCRIPTION,
  ORDERS_EMPTY_TITLE,
  ORDERS_NO_MATCH_TITLE,
  ORDERS_SEARCH_INVALID,
  ORDERS_SEARCH_LABEL,
  ORDERS_SEARCH_PLACEHOLDER,
  ordersFilterFromParams,
  ordersFilterKey,
  ordersTabQuery,
  orderTimeLines,
  type OrdersFilter,
} from '@/lib/reporting/orders';
import { eventOverviewPollInterval, orderStatusBadge, reviewItemLine } from '@/lib/reporting/overview';
import { cn } from '@/lib/utils';

import { useOrigin } from '../public-event-link';

import { OrderSheet } from './order-sheet';

/** Mở `Sheet` của một Đơn; `opener` nhận lại focus khi `Sheet` đóng. */
type OpenOrder = (order: EventOrderRow, opener: HTMLElement | null) => void;

/** Chip trạng thái: nút bật/tắt (`aria-pressed`), chip đang bật có dấu tích (không chỉ dựa vào màu). */
function FilterChips({
  status,
  onSelect,
}: {
  status: EventOrderFilter | null;
  onSelect: (status: EventOrderFilter | null) => void;
}) {
  return (
    <div role="group" aria-label="Lọc theo trạng thái" data-slot="order-filter-chips" className="flex flex-wrap gap-2">
      {ORDER_FILTER_CHIPS.map((chip) => {
        const active = chip.status === status;
        return (
          <button
            key={chip.label}
            type="button"
            aria-pressed={active}
            data-slot="order-filter-chip"
            onClick={() => onSelect(chip.status)}
            className={cn(
              'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-label transition-colors',
              active
                ? 'border-transparent bg-secondary font-bold text-secondary-foreground'
                : 'border-border bg-card text-foreground hover:bg-accent',
            )}
          >
            {active ? <Check aria-hidden="true" className="size-4" /> : null}
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Ô tìm: chỉ gửi khi bấm Enter hoặc "Tìm"; chữ không nhận ra (mã Đơn, email, SĐT chưa đầy đủ) → báo ngay dưới ô, không
 * gọi API. Có chữ thì có nút xóa. Chữ trống mà gửi → bỏ tìm.
 */
function SearchForm({ search, onSearch }: { search: string | null; onSearch: (search: string | null) => void }) {
  const ids = useId();
  const inputId = `${ids}-q`;
  const errorId = `${ids}-error`;
  const [text, setText] = useState(search ?? '');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // URL đổi từ nơi khác ("Bỏ lọc", quay lại trang trước): ô theo giá trị mới, giữ focus (không remount).
  const [shown, setShown] = useState(search);
  if (search !== shown) {
    setShown(search);
    setText(search ?? '');
    setError(null);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = text.trim();
    if (raw === '') {
      setError(null);
      if (search !== null) onSearch(null);
      return;
    }
    if (parseOrderSearch(raw) === null) {
      setError(ORDERS_SEARCH_INVALID);
      return;
    }
    setError(null);
    onSearch(raw);
  };

  const clear = () => {
    setText('');
    setError(null);
    inputRef.current?.focus();
    if (search !== null) onSearch(null);
  };

  return (
    <form role="search" onSubmit={submit} data-slot="order-search" className="flex min-w-0 flex-col gap-1.5" noValidate>
      <Label htmlFor={inputId}>{ORDERS_SEARCH_LABEL}</Label>
      <div className="flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={EVENT_ORDERS_SEARCH_MAX}
            placeholder={ORDERS_SEARCH_PLACEHOLDER}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={text ? 'pr-11' : undefined}
          />
          {text ? (
            <button
              type="button"
              aria-label="Xóa ô tìm"
              data-slot="order-search-clear"
              onClick={clear}
              className="absolute inset-y-0 right-0 inline-flex w-11 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          ) : null}
        </div>
        <Button type="submit" variant="secondary">
          Tìm
        </Button>
      </div>
      <FieldError id={errorId} message={error} />
    </form>
  );
}

/** Người mua: tên, email, SĐT dạng quen nhập (`0912345678`). */
function BuyerLines({ order }: { order: EventOrderRow }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-label wrap-break-word">{order.buyerName}</span>
      <span className="text-meta break-all text-muted-foreground">{order.buyerEmail}</span>
      <span className="text-meta text-muted-foreground tabular-nums">{localBuyerPhone(order.buyerPhone)}</span>
    </span>
  );
}

/** Badge trạng thái kèm dòng loại Cần xử lý khi Đơn còn mục `open` (mọi trạng thái Đơn). */
function OrderStatusLines({ order }: { order: EventOrderRow }) {
  const badge = orderStatusBadge(order.status);
  const line = reviewItemLine(order);
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      {line ? (
        <span data-slot="review-line" className="text-meta whitespace-normal text-muted-foreground">
          {line}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Từ `md`: bảng Mã Đơn · Người mua · Vé · Số tiền · Trạng thái · Thời gian. Chỉ nút Mã Đơn mở `Sheet` (hàng không bấm được,
 * nên bôi đen email hay SĐT để chép không mở `Sheet`).
 */
function OrdersTable({ orders, now, onOpen }: { orders: EventOrderRow[]; now: number; onOpen: OpenOrder }) {
  return (
    <div className="hidden md:block" data-slot="event-orders-table">
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
            <TableRow key={order.code} data-slot="event-order-row" className="hover:bg-transparent">
              <TableCell className="align-top">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  data-slot="event-order-open"
                  data-order-code={order.code}
                  onClick={(event) => onOpen(order, event.currentTarget)}
                  className="cursor-pointer text-left font-mono text-code underline-offset-4 hover:underline"
                >
                  {order.code}
                </button>
              </TableCell>
              <TableCell className="max-w-64 align-top whitespace-normal">
                <BuyerLines order={order} />
              </TableCell>
              <TableCell className="align-top whitespace-normal">{orderItemsLabel(order.items)}</TableCell>
              <TableCell className="text-right align-top tabular-nums">{formatVnd(order.totalAmount)}</TableCell>
              <TableCell className="align-top">
                <OrderStatusLines order={order} />
              </TableCell>
              <TableCell className="align-top text-muted-foreground tabular-nums">
                {orderTimeLines(order, now).map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Dưới `md`: danh sách thẻ (khuôn của `recent-orders-block`); mỗi thẻ là một nút mở `Sheet`. */
function OrdersList({ orders, now, onOpen }: { orders: EventOrderRow[]; now: number; onOpen: OpenOrder }) {
  return (
    <ul className="flex flex-col divide-y divide-border md:hidden" data-slot="event-orders-list">
      {orders.map((order) => {
        const line = reviewItemLine(order);
        const badge = orderStatusBadge(order.status);
        return (
          <li key={order.code}>
            <button
              type="button"
              aria-haspopup="dialog"
              data-slot="event-order-card"
              data-order-code={order.code}
              onClick={(event) => onOpen(order, event.currentTarget)}
              className="flex w-full cursor-pointer items-start justify-between gap-stack py-stack text-left"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-label wrap-break-word">{order.buyerName}</span>
                <span className="text-meta wrap-break-word text-muted-foreground tabular-nums">
                  <span className="font-mono">{order.code}</span> · {orderItemsLabel(order.items)}
                </span>
                <span className="text-meta break-all text-muted-foreground">{order.buyerEmail}</span>
                <span className="text-meta text-muted-foreground tabular-nums">
                  {localBuyerPhone(order.buyerPhone)} · {orderTimeLines(order, now).join(' · ')}
                </span>
                {line ? (
                  <span data-slot="review-line" className="text-meta text-muted-foreground">
                    {line}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-label tabular-nums">{formatVnd(order.totalAmount)}</span>
                <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function OrdersSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="event-orders-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải danh sách Đơn</span>
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}

/**
 * Danh sách Đơn của một bộ lọc: phân trang bằng ngăn xếp cursor giữ trong state ("Trang trước"/"Trang sau", không đếm
 * tổng, không cuộn vô hạn). Nơi gọi đặt `key` theo bộ lọc nên đổi bộ lọc là về trang đầu. Tự cập nhật bằng
 * `useLiveResource` qua stream Tổng quan (`event_orders_changed`, `event_checkins_changed` từ Story 6.2,
 * `org_review_items_changed`): mỗi check-in cũng làm danh sách tải lại; polling 10 giây khi chưa kết nối.
 */
function OrdersResults({
  orgId,
  event,
  filter,
  onClearFilter,
}: {
  orgId: string;
  event: EventDetail;
  filter: OrdersFilter;
  onClearFilter: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const origin = useOrigin();
  /** Cursor của các trang sau trang đầu đã mở, theo thứ tự; trang đang xem dùng phần tử cuối. */
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1) ?? null;
  const { query } = useLiveResource({
    queryKey: eventOrdersQueryKey(orgId, event.id, filter, cursor),
    queryFn: (signal) => fetchEventOrders(orgId, event.id, filter, cursor, signal),
    livePath: eventOverviewLiveApiPath(orgId, event.id),
    pollInterval: eventOverviewPollInterval,
  });

  const [selected, setSelected] = useState<EventOrderRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const regionRef = useRef<HTMLElement>(null);
  /** Vừa đổi trang: khi trang mới hiện thì đưa focus về đầu danh sách. */
  const pageChanged = useRef(false);

  const openOrder: OpenOrder = (order, element) => {
    opener.current = element;
    setSelected(order);
    setSheetOpen(true);
  };
  const returnFocus = () => {
    if (opener.current?.isConnected) {
      opener.current.focus();
      return;
    }
    // Hàng đã mở `Sheet` không còn trên trang (danh sách vừa tải lại): về đầu danh sách.
    regionRef.current?.focus();
  };

  const unauthenticated = hasErrorCode(query.error, ErrorCode.UNAUTHENTICATED);
  const goToLoginRef = useRef(goToLogin);
  goToLoginRef.current = goToLogin;
  const redirected = useRef(false);
  useEffect(() => {
    if (!unauthenticated || redirected.current) return;
    redirected.current = true;
    // Bỏ khỏi cache: quay lại sau đăng nhập không mang theo lỗi 401 cũ.
    queryClient.removeQueries({ queryKey: eventOrdersQueryPrefix(orgId, event.id) });
    goToLoginRef.current();
  }, [unauthenticated, queryClient, orgId, event.id]);

  const data = query.data;
  useEffect(() => {
    if (!data || !pageChanged.current) return;
    pageChanged.current = false;
    regionRef.current?.focus();
    regionRef.current?.scrollIntoView({ block: 'nearest' });
  }, [data]);

  const goTo = (next: string[]) => {
    pageChanged.current = true;
    setCursors(next);
  };

  if (!data) {
    if (!query.isError || handledElsewhere(query.error)) return <OrdersSkeleton />;
    return (
      <div data-slot="event-orders-error">
        <StatusBanner
          tone="danger"
          title="Chưa tải được danh sách Đơn"
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

  const pager =
    cursors.length > 0 || data.nextCursor !== null ? (
      <nav aria-label="Phân trang Đơn" data-slot="event-orders-pager" className="flex flex-wrap items-center gap-2">
        {cursors.length > 0 ? (
          <Button type="button" variant="secondary" onClick={() => goTo(cursors.slice(0, -1))}>
            Trang trước
          </Button>
        ) : null}
        <span className="text-meta text-muted-foreground tabular-nums">Trang {cursors.length + 1}</span>
        {data.nextCursor !== null ? (
          <Button type="button" variant="secondary" onClick={() => goTo([...cursors, data.nextCursor!])}>
            Trang sau
          </Button>
        ) : null}
      </nav>
    ) : null;

  const sheet = (
    <OrderSheet
      orgId={orgId}
      eventId={event.id}
      order={selected}
      open={sheetOpen}
      onOpenChange={setSheetOpen}
      returnFocus={returnFocus}
    />
  );

  let content: ReactNode;
  if (data.orders.length === 0) {
    if (cursors.length === 0 && !isFiltered(filter)) {
      const draft = event.status === 'draft';
      content = (
        <EmptyState
          icon={Inbox}
          title={ORDERS_EMPTY_TITLE}
          description={draft ? ORDERS_EMPTY_DRAFT_DESCRIPTION : ORDERS_EMPTY_DESCRIPTION}
          className="rounded-lg bg-card px-card-padding shadow-card"
          action={
            draft ? undefined : (
              <Button type="button" variant="secondary" onClick={() => void copyWithToast(`${origin}/e/${event.slug}`)}>
                <Copy aria-hidden="true" />
                Sao chép link
              </Button>
            )
          }
        />
      );
    } else {
      content = (
        <EmptyState
          icon={SearchX}
          title={ORDERS_NO_MATCH_TITLE}
          className="rounded-lg bg-card px-card-padding shadow-card"
          action={
            isFiltered(filter) ? (
              <Button type="button" variant="secondary" onClick={onClearFilter}>
                Bỏ lọc
              </Button>
            ) : undefined
          }
        />
      );
    }
  } else {
    const now = Date.now();
    content = (
      <section
        ref={regionRef}
        tabIndex={-1}
        aria-label="Danh sách Đơn"
        data-slot="event-orders"
        className="flex min-w-0 flex-col rounded-lg bg-card px-card-padding py-2 shadow-card"
      >
        <OrdersTable orders={data.orders} now={now} onOpen={openOrder} />
        <OrdersList orders={data.orders} now={now} onOpen={openOrder} />
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-stack">
      {content}
      {pager}
      {sheet}
    </div>
  );
}

/**
 * Tab Đơn của Sự kiện (Story 6.1, FR-31, UX-DR37): chip trạng thái, ô tìm (mã Đơn, email, SĐT đầy đủ), danh sách lọc ở
 * server — từ `md` là `Table` trên `card` sáng, dưới `md` là danh sách thẻ — phân trang "Trang trước"/"Trang sau" và
 * `Sheet` chi tiết. Bộ lọc nằm trên URL (`?tab=don&trangThai=…&tim=…`, F5 vẫn giữ; giá trị lạ bị bỏ qua), đổi bằng
 * `history.replaceState` (không tải lại trang); cursor không lên URL, đổi bộ lọc thì về trang đầu. Không có thao tác
 * Cần xử lý ở đây: `Sheet` dẫn sang trang Cần xử lý.
 */
export function OrdersTab({ orgId, event }: { orgId: string; event: EventDetail }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = ordersFilterFromParams(searchParams);
  const setFilter = (next: OrdersFilter) => window.history.replaceState(null, '', `${pathname}?${ordersTabQuery(next)}`);

  return (
    <div data-slot="orders-tab" className="flex min-w-0 flex-col gap-section">
      <div className="flex min-w-0 flex-col gap-stack">
        <FilterChips status={filter.status} onSelect={(status) => setFilter({ ...filter, status })} />
        <SearchForm search={filter.search} onSearch={(search) => setFilter({ ...filter, search })} />
      </div>
      <OrdersResults
        key={ordersFilterKey(filter)}
        orgId={orgId}
        event={event}
        filter={filter}
        onClearFilter={() => setFilter(NO_ORDERS_FILTER)}
      />
    </div>
  );
}
