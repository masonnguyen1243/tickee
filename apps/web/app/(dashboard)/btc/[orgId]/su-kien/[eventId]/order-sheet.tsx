'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  eventOverviewLiveApiPath,
  formatVnDateTime,
  localBuyerPhone,
  reviewQueuePath,
  type EventOrderDetail,
  type EventOrderRow,
} from '@tickee/contracts';
import Link from 'next/link';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { useLiveResource } from '@/lib/realtime/use-live-resource';
import {
  eventOrderQueryKey,
  fetchEventOrder,
  ORDER_REVIEW_LINK,
  orderAmountLines,
  orderHistoryLabel,
  orderItemsLabel,
  ticketBadge,
  ticketSeqLabel,
} from '@/lib/reporting/orders';
import { eventOverviewPollInterval, orderStatusBadge, reviewItemLine } from '@/lib/reporting/overview';

/** Một dòng "nhãn — giá trị" của `Sheet` (theo mẫu `Sheet` của trang Cần xử lý). */
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

/**
 * Năm phần của `Sheet`: khối Cần xử lý (khi Đơn còn mục `open`: dòng loại và link sang trang Cần xử lý, không thao tác
 * ở đây), Người mua, câu trả lời form, Vé, Số tiền và lịch sử. Không bao giờ có Mã QR vé.
 */
function OrderDetailView({ orgId, eventId, detail }: { orgId: string; eventId: string; detail: EventOrderDetail }) {
  const badge = orderStatusBadge(detail.status);
  const review = reviewItemLine(detail);
  const amount = orderAmountLines(detail);
  return (
    <div className="flex flex-col gap-section text-label">
      {review ? (
        <div data-slot="order-review">
          <StatusBanner
            tone="danger"
            title="Cần xử lý"
            description={review}
            action={
              <Link
                href={reviewQueuePath(orgId, eventId)}
                className="text-label font-bold underline underline-offset-4"
              >
                {ORDER_REVIEW_LINK}
              </Link>
            }
          />
        </div>
      ) : null}
      <SheetSection title="Người mua" slot="order-buyer">
        <dl className="flex flex-col gap-1.5">
          <Field label="Tên">{detail.buyerName}</Field>
          <Field label="Email">
            <span className="break-all">{detail.buyerEmail}</span>
          </Field>
          <Field label="SĐT">
            <span className="tabular-nums">{localBuyerPhone(detail.buyerPhone)}</span>
          </Field>
          <Field label="Trạng thái">
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
          </Field>
        </dl>
      </SheetSection>
      <SheetSection title="Câu trả lời form" slot="order-answers">
        {detail.answers.length === 0 ? (
          <p className="text-muted-foreground">Đơn không có câu trả lời form.</p>
        ) : (
          <dl className="flex flex-col gap-2">
            {detail.answers.map((answer, i) => (
              <div key={i} data-slot="order-answer" className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground wrap-break-word">{answer.label}</dt>
                <dd className="wrap-break-word whitespace-pre-line">{answer.answer}</dd>
              </div>
            ))}
          </dl>
        )}
      </SheetSection>
      <SheetSection title="Vé" slot="order-tickets">
        {detail.tickets.length === 0 ? (
          <p className="text-muted-foreground">Đơn chưa có Vé.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {detail.tickets.map((ticket) => {
              const tBadge = ticketBadge(ticket);
              return (
                <li key={ticket.seq} data-slot="order-ticket" className="flex min-w-0 flex-col gap-1 py-2 first:pt-0">
                  <span data-slot="order-ticket-line" className="wrap-break-word">
                    <span className="tabular-nums">{ticketSeqLabel(ticket)}</span> · {ticket.ticketTypeName} ·{' '}
                    {ticket.holderName}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge tone={tBadge.tone}>{tBadge.label}</StatusBadge>
                    {ticket.checkedInAt !== null && ticket.status === 'valid' ? (
                      <time dateTime={ticket.checkedInAt} className="text-meta text-muted-foreground tabular-nums">
                        lúc {formatVnDateTime(ticket.checkedInAt)}
                      </time>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </SheetSection>
      <SheetSection title="Số tiền" slot="order-amount">
        <dl className="flex flex-col gap-1.5">
          <Field label="Vé">{orderItemsLabel(detail.items)}</Field>
          <Field label="Tổng">
            <span className="tabular-nums">
              <span data-slot="order-amount-total">{amount.total}</span>
              {amount.received ? (
                <span data-slot="order-amount-received" className="block text-meta text-muted-foreground">
                  {amount.received}
                </span>
              ) : null}
            </span>
          </Field>
        </dl>
      </SheetSection>
      <SheetSection title="Lịch sử" slot="order-history">
        <ol className="flex flex-col gap-1.5">
          {detail.history.map((entry, i) => (
            <li key={i} data-slot="order-history-entry" className="flex min-w-0 flex-wrap gap-x-3">
              <time dateTime={entry.at} className="text-muted-foreground tabular-nums">
                {formatVnDateTime(entry.at)}
              </time>
              <span className="min-w-0 wrap-break-word">{orderHistoryLabel(entry)}</span>
            </li>
          ))}
        </ol>
      </SheetSection>
    </div>
  );
}

/**
 * Chi tiết Đơn `code`: tải `GET …/orders/:code` khi `Sheet` mở, tự cập nhật như danh sách (`useLiveResource` qua stream
 * Tổng quan, polling 10 giây khi chưa kết nối). Lỗi → banner kèm "Thử lại"; Đơn không còn → "Không tìm thấy Đơn này.";
 * `401` → đăng nhập.
 */
function OrderDetailBody({ orgId, eventId, code }: { orgId: string; eventId: string; code: string }) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const { query } = useLiveResource({
    queryKey: eventOrderQueryKey(orgId, eventId, code),
    queryFn: (signal) => fetchEventOrder(orgId, eventId, code, signal),
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
    queryClient.removeQueries({ queryKey: eventOrderQueryKey(orgId, eventId, code) });
    goToLoginRef.current();
  }, [unauthenticated, queryClient, orgId, eventId, code]);

  if (query.data) return <OrderDetailView orgId={orgId} eventId={eventId} detail={query.data} />;
  if (query.isError && !handledElsewhere(query.error)) {
    const notFound = hasErrorCode(query.error, ErrorCode.ORDER_NOT_FOUND);
    return (
      <StatusBanner
        tone="danger"
        title={notFound ? 'Không tìm thấy Đơn này.' : 'Chưa tải được chi tiết Đơn'}
        description={notFound ? undefined : messageOf(query.error)}
        action={
          notFound ? undefined : (
            <Button type="button" variant="link" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              Thử lại
            </Button>
          )
        }
      />
    );
  }
  return (
    <div role="status" aria-busy="true" data-slot="order-sheet-skeleton" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải chi tiết Đơn</span>
      <Skeleton className="h-28" />
      <Skeleton className="h-36" />
    </div>
  );
}

/**
 * `Sheet` chi tiết Đơn (từ phải) của tab Đơn (Story 6.1). Không có `SheetTrigger`: đóng thì trả focus về nút đã mở
 * (`returnFocus`). Nội dung chỉ dựng khi mở (Radix bỏ nội dung khi đóng), nên chi tiết chỉ tải và tự cập nhật khi mở.
 */
export function OrderSheet({
  orgId,
  eventId,
  order,
  open,
  onOpenChange,
  returnFocus,
}: {
  orgId: string;
  eventId: string;
  order: EventOrderRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-slot="event-order-sheet"
        className="w-full max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        <SheetHeader>
          <SheetTitle>
            Đơn <span className="font-mono">{order?.code}</span>
          </SheetTitle>
          <SheetDescription className="wrap-break-word">{order?.buyerName ?? ''}</SheetDescription>
        </SheetHeader>
        {order ? <OrderDetailBody orgId={orgId} eventId={eventId} code={order.code} /> : null}
      </SheetContent>
    </Sheet>
  );
}
