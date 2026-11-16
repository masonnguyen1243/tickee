'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  formatVnd,
  formatVnDateTime,
  reviewQueuePath,
  ReviewItemType,
  type ReviewItemDetail,
  type ReviewQueueItem,
} from '@tickee/contracts';
import { CircleCheck, SearchX } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { useOrganizationLiveConnected } from '@/components/tickee/organization-live';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { isNetworkError } from '@/lib/api/errors';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { navSection } from '@/lib/organizer/nav';
import {
  fetchReviewItem,
  fetchReviewQueue,
  REVIEW_QUEUE_POLL_MS,
  reviewItemQueryKey,
  reviewQueueQueryKey,
} from '@/lib/reporting/api';
import { orderStatusBadge, REVIEW_TYPE_LABEL, ticketCountLabel, updatedAtLabel } from '@/lib/reporting/overview';
import {
  amountSegments,
  EMPTY_VALUE,
  eventFilterLabel,
  paymentMethodLabel,
  REVIEW_QUEUE_EMPTY,
  REVIEW_QUEUE_OFFLINE_TOAST,
  REVIEW_QUEUE_OFFLINE_TOAST_ID,
  reviewLogLabel,
  reviewReasonLine,
  reviewTypeBadge,
  UNMATCHED_ORDER_LABEL,
} from '@/lib/reporting/review-queue';

const { label: PAGE_TITLE } = navSection('review-queue');

/** Mở `Sheet` của một mục; `opener` nhận lại focus khi `Sheet` đóng. */
type OpenItem = (item: ReviewQueueItem, opener: HTMLElement | null) => void;

/** "nhận 250.000đ / Đơn 300.000đ": phần chênh tô `danger-text` (chỉ khi hai số đều có và khác nhau). */
function AmountLine({ received, total }: { received: number | null; total: number | null }) {
  const segments = amountSegments(received, total);
  if (segments.length === 0) return <span>{EMPTY_VALUE}</span>;
  return (
    <span data-slot="review-amount" className="tabular-nums">
      {segments.map((segment, i) =>
        segment.danger ? (
          <span key={i} data-slot="review-amount-diff" className="text-danger-text">
            {segment.text}
          </span>
        ) : (
          <Fragment key={i}>{segment.text}</Fragment>
        ),
      )}
    </span>
  );
}

function TypeBadge({ type }: { type: ReviewQueueItem['type'] }) {
  const badge = reviewTypeBadge(type);
  return <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>;
}

/** Từ `md`: bảng Loại · Mã Đơn · Người mua · Số tiền · Sự kiện. Mã Đơn là nút mở `Sheet`; bấm cả hàng cũng mở. */
function ReviewTable({ items, onOpen }: { items: ReviewQueueItem[]; onOpen: OpenItem }) {
  return (
    <div className="hidden md:block" data-slot="review-queue-table">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Loại</TableHead>
            <TableHead>Mã Đơn</TableHead>
            <TableHead>Người mua</TableHead>
            <TableHead>Số tiền</TableHead>
            <TableHead>Sự kiện</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.id}
              data-slot="needs-action-row"
              className="cursor-pointer"
              onClick={(event) => {
                // Bôi đen chữ (vd. để chép mã Đơn) không mở `Sheet`.
                if (window.getSelection()?.toString()) return;
                onOpen(item, event.currentTarget.querySelector('button'));
              }}
            >
              <TableCell className="align-top">
                <TypeBadge type={item.type} />
              </TableCell>
              <TableCell className="align-top">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  data-slot="needs-action-open"
                  className={
                    item.order
                      ? 'cursor-pointer text-left font-mono text-code underline-offset-4 hover:underline'
                      : 'cursor-pointer text-left underline-offset-4 hover:underline'
                  }
                >
                  {item.order?.code ?? UNMATCHED_ORDER_LABEL}
                </button>
              </TableCell>
              <TableCell className="align-top whitespace-normal wrap-break-word">
                {item.order?.buyerName ?? EMPTY_VALUE}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                <AmountLine received={item.receivedAmount} total={item.order?.totalAmount ?? null} />
              </TableCell>
              <TableCell className="align-top whitespace-normal wrap-break-word">{item.event?.name ?? EMPTY_VALUE}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Dưới `md`: danh sách thẻ; mỗi thẻ là một nút mở `Sheet`. */
function ReviewList({ items, onOpen }: { items: ReviewQueueItem[]; onOpen: OpenItem }) {
  return (
    <ul className="flex flex-col divide-y divide-border md:hidden" data-slot="review-queue-list">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            aria-haspopup="dialog"
            data-slot="needs-action-row"
            onClick={(event) => onOpen(item, event.currentTarget)}
            className="flex w-full cursor-pointer flex-col items-start gap-1 py-stack text-left"
          >
            <TypeBadge type={item.type} />
            <span className="text-label wrap-break-word">{item.order?.buyerName ?? EMPTY_VALUE}</span>
            <span className="max-w-full text-meta wrap-break-word text-muted-foreground">
              {item.order ? <span className="font-mono">{item.order.code}</span> : UNMATCHED_ORDER_LABEL} ·{' '}
              {item.event?.name ?? EMPTY_VALUE}
            </span>
            <span className="text-meta">
              <AmountLine received={item.receivedAmount} total={item.order?.totalAmount ?? null} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function QueueSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="review-queue-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải hàng Cần xử lý</span>
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
      <Skeleton className="h-20" />
    </div>
  );
}

/** Một dòng "nhãn — giá trị" của `Sheet`. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right wrap-break-word">{children}</dd>
    </div>
  );
}

function SheetSection({ title, slot, children }: { title: string; slot: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-slot={slot} className="flex flex-col gap-2">
      <h3 id={id} className="text-label font-bold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Ba phần của `Sheet`: Giao dịch, Đơn liên quan, Nhật ký (dựng từ dữ liệu sẵn có; Story 4.4 thêm dòng thao tác). */
function ItemDetail({ detail }: { detail: ReviewItemDetail }) {
  const { transaction, order } = detail;
  const orderBadge = order ? orderStatusBadge(order.status) : null;
  return (
    <div className="flex flex-col gap-section text-label">
      {detail.reason ? (
        <p data-slot="review-reason" className="text-body">
          {reviewReasonLine(detail.reason)}
        </p>
      ) : null}
      <SheetSection title="Giao dịch" slot="review-transaction">
        <dl className="flex flex-col gap-1.5">
          <Field label="Số tiền nhận">
            <span className="tabular-nums">
              {transaction.receivedAmount === null ? EMPTY_VALUE : formatVnd(transaction.receivedAmount)}
            </span>
          </Field>
          <Field label="Mã giao dịch">
            <span className="font-mono break-all">{transaction.transactionCode ?? EMPTY_VALUE}</span>
          </Field>
          <Field label="Thời điểm trả">
            <span className="tabular-nums">
              {transaction.paidAt === null ? EMPTY_VALUE : formatVnDateTime(transaction.paidAt)}
            </span>
          </Field>
          <Field label="Phương thức">{paymentMethodLabel(transaction.paymentMethod)}</Field>
          {detail.type === ReviewItemType.UNMATCHED ? (
            <Field label="Mã Đơn trong giao dịch">
              <span className="font-mono break-all">{transaction.providerOrderId ?? EMPTY_VALUE}</span>
            </Field>
          ) : null}
        </dl>
      </SheetSection>
      <SheetSection title="Đơn liên quan" slot="review-order">
        {order && orderBadge ? (
          <dl className="flex flex-col gap-1.5">
            <Field label="Mã Đơn">
              <span className="font-mono">{order.code}</span>
            </Field>
            <Field label="Trạng thái">
              <StatusBadge tone={orderBadge.tone}>{orderBadge.label}</StatusBadge>
            </Field>
            <Field label="Người mua">{order.buyerName}</Field>
            <Field label="Số Vé">
              <span className="tabular-nums">{ticketCountLabel(order.ticketCount)}</span>
            </Field>
            <Field label="Tổng tiền">
              <span className="tabular-nums">{formatVnd(order.totalAmount)}</span>
            </Field>
            <Field label="Lúc tạo">
              <span className="tabular-nums">{formatVnDateTime(order.createdAt)}</span>
            </Field>
            {detail.event ? <Field label="Sự kiện">{detail.event.name}</Field> : null}
          </dl>
        ) : (
          <p className="text-muted-foreground">{UNMATCHED_ORDER_LABEL}</p>
        )}
      </SheetSection>
      <SheetSection title="Nhật ký" slot="review-log">
        <ol className="flex flex-col gap-1.5">
          {detail.log.map((entry, i) => (
            <li key={i} data-slot="review-log-entry" className="flex flex-wrap gap-x-3">
              <time dateTime={entry.at} className="text-muted-foreground tabular-nums">
                {formatVnDateTime(entry.at)}
              </time>
              <span>{reviewLogLabel(entry, detail.type)}</span>
            </li>
          ))}
        </ol>
      </SheetSection>
    </div>
  );
}

/** `Sheet` chi tiết của mục `item`: tải `GET …/review-items/:itemId` khi mở (mọi trạng thái của mục). */
function ItemSheet({
  orgId,
  item,
  open,
  onOpenChange,
  returnFocus,
}: {
  orgId: string;
  item: ReviewQueueItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const detail = useQuery({
    queryKey: reviewItemQueryKey(orgId, item?.id ?? ''),
    queryFn: ({ signal }) => fetchReviewItem(orgId, item!.id, signal),
    enabled: open && item !== null,
  });

  // 401 khi tải chi tiết (lỗi `handledElsewhere`: không báo trong `Sheet`) → đăng nhập, một lần.
  const unauthenticated = hasErrorCode(detail.error, ErrorCode.UNAUTHENTICATED);
  const goToLoginRef = useRef(goToLogin);
  goToLoginRef.current = goToLogin;
  const redirected = useRef(false);
  useEffect(() => {
    if (!unauthenticated || redirected.current) return;
    redirected.current = true;
    queryClient.removeQueries({ queryKey: reviewItemQueryKey(orgId, item?.id ?? '') });
    goToLoginRef.current();
  }, [unauthenticated, queryClient, orgId, item?.id]);
  const description = item
    ? [item.order?.code ?? UNMATCHED_ORDER_LABEL, item.event?.name].filter(Boolean).join(' · ')
    : '';

  let body: ReactNode;
  if (detail.data) {
    body = <ItemDetail detail={detail.data} />;
  } else if (detail.isError && !handledElsewhere(detail.error)) {
    const notFound = hasErrorCode(detail.error, ErrorCode.REVIEW_ITEM_NOT_FOUND);
    body = (
      <StatusBanner
        tone="danger"
        title={notFound ? 'Không tìm thấy mục này.' : 'Chưa tải được chi tiết mục'}
        description={notFound ? undefined : messageOf(detail.error)}
        action={
          notFound ? undefined : (
            <Button type="button" variant="link" size="sm" loading={detail.isFetching} onClick={() => void detail.refetch()}>
              Thử lại
            </Button>
          )
        }
      />
    );
  } else {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-stack">
        <span className="sr-only">Đang tải chi tiết mục</span>
        <Skeleton className="h-28" />
        <Skeleton className="h-36" />
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-slot="review-item-sheet"
        className="w-full max-w-md"
        onCloseAutoFocus={(event) => {
          // Không có `SheetTrigger`: tự trả focus về hàng đã mở `Sheet`.
          event.preventDefault();
          returnFocus();
        }}
      >
        <SheetHeader>
          <SheetTitle>{item ? REVIEW_TYPE_LABEL[item.type] : PAGE_TITLE}</SheetTitle>
          <SheetDescription className="wrap-break-word">{description}</SheetDescription>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}

/** Chip "Sự kiện: {tên} · Bỏ lọc" khi trang đang lọc theo một Sự kiện. */
function EventFilterChip({ orgId, name }: { orgId: string; name: string }) {
  return (
    <p
      data-slot="review-filter-chip"
      className="flex max-w-full flex-wrap items-center gap-x-2 self-start rounded-full bg-secondary px-3 py-1.5 text-label text-secondary-foreground"
    >
      <span className="min-w-0 wrap-break-word">{eventFilterLabel(name)}</span>
      <span aria-hidden="true">·</span>
      <Link href={reviewQueuePath(orgId)} className="font-bold text-brand-text underline-offset-4 hover:underline">
        Bỏ lọc
      </Link>
    </p>
  );
}

/** `navigator.onLine` theo dõi sự kiện `online`/`offline`. */
function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * Trang Cần xử lý (Story 4.3, FR-21, EXPERIENCE › needs-action-row): mục `open` của BTC gộp mọi Sự kiện, cũ nhất trước;
 * từ `md` là bảng, dưới `md` là danh sách thẻ; mở một mục → `Sheet` chi tiết. `eventId` (`?suKien=`) lọc theo Sự kiện,
 * kèm chip "Bỏ lọc". Tự cập nhật theo tín hiệu `org_review_items_changed` của stream cấp BTC mà khung dashboard giữ
 * (`StatusBannerStack` invalidate khóa của trang này); stream chưa kết nối thì polling 10 giây. Mất mạng → một toast
 * mỗi lần mất mạng, hàng giữ dữ liệu cũ kèm "Cập nhật lúc HH:MM". Tải lần đầu lỗi → banner kèm "Thử lại"; Sự kiện lọc
 * không tồn tại → `empty-state` kèm "Xem mọi mục"; `401` → đăng nhập. Chỉ đọc: thao tác xử lý là Story 4.4.
 */
export function ReviewQueueView({ orgId, eventId }: { orgId: string; eventId: string | null }) {
  const organization = useCurrentOrganization();
  const live = useOrganizationLiveConnected();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const online = useBrowserOnline();
  const query = useQuery({
    queryKey: reviewQueueQueryKey(orgId, eventId),
    queryFn: ({ signal }) => fetchReviewQueue(orgId, eventId, signal),
    refetchInterval: live ? false : REVIEW_QUEUE_POLL_MS,
  });

  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const openItem: OpenItem = (item, element) => {
    opener.current = element;
    setSelected(item);
    setSheetOpen(true);
  };

  const unauthenticated = hasErrorCode(query.error, ErrorCode.UNAUTHENTICATED);
  const goToLoginRef = useRef(goToLogin);
  goToLoginRef.current = goToLogin;
  const redirected = useRef(false);
  useEffect(() => {
    if (!unauthenticated || redirected.current) return;
    redirected.current = true;
    // Bỏ khỏi cache: quay lại sau đăng nhập không mang theo lỗi 401 cũ.
    queryClient.removeQueries({ queryKey: reviewQueueQueryKey(orgId, eventId) });
    goToLoginRef.current();
  }, [unauthenticated, queryClient, orgId, eventId]);

  const offline = !online || isNetworkError(query.failureReason);
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline && !wasOffline.current) toast.warning(REVIEW_QUEUE_OFFLINE_TOAST, { id: REVIEW_QUEUE_OFFLINE_TOAST_ID });
    if (!offline && wasOffline.current) toast.dismiss(REVIEW_QUEUE_OFFLINE_TOAST_ID);
    wasOffline.current = offline;
  }, [offline]);
  useEffect(() => () => void toast.dismiss(REVIEW_QUEUE_OFFLINE_TOAST_ID), []);

  const data = query.data;
  const stale = offline || (query.isError && data !== undefined && !handledElsewhere(query.error));

  let content: ReactNode;
  if (!data) {
    if (!query.isError || handledElsewhere(query.error)) {
      content = <QueueSkeleton />;
    } else if (
      hasErrorCode(query.error, ErrorCode.EVENT_NOT_FOUND) ||
      // `?suKien=` quá dài hay sai dạng mà api từ chối bằng 400: thử lại cũng không được, coi như Sự kiện không có.
      (eventId !== null && hasErrorCode(query.error, ErrorCode.VALIDATION_FAILED))
    ) {
      content = (
        <EmptyState
          icon={SearchX}
          title="Không tìm thấy Sự kiện này."
          description="Sự kiện không tồn tại hoặc không thuộc BTC này."
          className="rounded-lg bg-card px-card-padding shadow-card"
          action={
            <Button asChild variant="secondary">
              <Link href={reviewQueuePath(orgId)}>Xem mọi mục Cần xử lý</Link>
            </Button>
          }
        />
      );
    } else {
      content = (
        <div data-slot="review-queue-error">
          <StatusBanner
            tone="danger"
            title="Chưa tải được hàng Cần xử lý"
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
  } else if (data.items.length === 0) {
    content = (
      <EmptyState
        icon={CircleCheck}
        title={REVIEW_QUEUE_EMPTY}
        className="rounded-lg bg-card px-card-padding shadow-card"
      />
    );
  } else {
    content = (
      <section
        aria-label={PAGE_TITLE}
        data-slot="review-queue"
        className="flex min-w-0 flex-col rounded-lg bg-card px-card-padding py-2 shadow-card"
      >
        <ReviewTable items={data.items} onOpen={openItem} />
        <ReviewList items={data.items} onOpen={openItem} />
      </section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-section pt-2">
      <PageHeading eyebrow={organization.name} title={PAGE_TITLE} />
      {eventId && data?.event ? <EventFilterChip orgId={orgId} name={data.event.name} /> : null}
      <div className="flex min-w-0 flex-col">
        {/* Vùng live luôn có trong DOM (rỗng thì không chiếm chỗ): nhãn hiện ra được đọc cho trình đọc màn hình. */}
        <div aria-live="polite" className="[&:not(:empty)]:mb-2">
          {stale && data ? (
            <p data-slot="review-queue-updated-at" className="text-meta text-muted-foreground tabular-nums">
              {updatedAtLabel(query.dataUpdatedAt)}
            </p>
          ) : null}
        </div>
        {content}
      </div>
      <ItemSheet
        orgId={orgId}
        item={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        returnFocus={() => opener.current?.focus()}
      />
    </div>
  );
}
