'use client';

import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHECKIN_LOOKUP_QUERY_MAX,
  ErrorCode,
  lookupQueryKey,
  parseLookupQuery,
  type CheckinLookupResult,
  type CheckinLookupTicket,
  type ScanResult,
} from '@tickee/contracts';
import { SearchX } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

import { EmptyState } from '@/components/tickee/empty-state';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/errors';
import { messageOf } from '@/lib/api/message-of';
import {
  checkInManually,
  checkinLookupQueryKey,
  checkinLookupQueryPrefix,
  lookupCheckinTickets,
} from '@/lib/checkin/api';
import {
  CHECK_IN_FAILED_TITLE,
  hasUncheckedTickets,
  isRetryableCheckInError,
  LOOKUP_DEBOUNCE_MS,
  LOOKUP_EMPTY_TEXT,
  LOOKUP_FAILED_TITLE,
  LOOKUP_INCOMPLETE_TEXT,
  LOOKUP_OFFLINE_TEXT,
  lookupCountText,
  lookupRateLimitedText,
  lookupTicketMeta,
  MANUAL_LOOKUP_LABEL,
  MANUAL_LOOKUP_TITLE,
  marksCheckedIn,
  withCheckedIn,
} from '@/lib/checkin/manual-lookup';
import { newFunnelId } from '@/lib/event/funnel';
import { useDebouncedValue } from '@/lib/use-debounced-value';

/** Biến của một lượt bấm "Check-in": Vé, khóa của lượt bấm, và khóa cache của kết quả tra đang hiện. */
type CheckInVars = { ticketId: string; key: string; lookupKey: ReturnType<typeof checkinLookupQueryKey> };

type ManualLookupProps = {
  eventId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chữ trong ô tìm, giữ ở Màn quét để Sheet mở lại (sau overlay) còn nguyên ô tìm và kết quả. */
  text: string;
  onTextChange: (text: string) => void;
  /** Trình duyệt có mạng (`onlineManager`): offline thì không tra, không check-in tay. */
  online: boolean;
  /**
   * Kết quả check-in tay (`ScanResult` như khi quét). `reopen`: kết quả tra còn Vé chưa check-in (khách đi nhóm), nên
   * đóng overlay thì mở lại Sheet.
   */
  onResult: (result: ScanResult, reopen: boolean) => void;
  /** Lỗi do Màn quét xử lý như khi quét: `401` (sang đăng nhập), `403` (màn hết quyền). */
  isHandledByScreen: (error: unknown) => boolean;
  onHandledError: (error: unknown) => void;
  /** Chạm "Check-in" (cử chỉ của người dùng): mở khóa âm thanh của overlay. */
  onCheckInTap: () => void;
  /** Sheet đóng vì overlay kết quả hiện: không trả focus về "Tra tay" (focus ở overlay). */
  returnFocus: boolean;
};

/** Một hàng kết quả: tên (cắt bớt khi dài), "Hạng vé · Vé k/N", `status-badge`, nút "Check-in" khi chưa check-in. */
function TicketRow({
  ticket,
  loading,
  disabled,
  describedBy,
  onCheckIn,
}: {
  ticket: CheckinLookupTicket;
  loading: boolean;
  disabled: boolean;
  describedBy: string | undefined;
  onCheckIn: () => void;
}) {
  return (
    <li data-slot="manual-lookup-row" data-checked-in={ticket.checkedIn} className="flex min-w-0 items-center gap-2.5 py-3">
      <div className="min-w-0 flex-1">
        <p data-slot="manual-lookup-name" className="truncate text-title">
          {ticket.holderName}
        </p>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span data-slot="manual-lookup-meta" className="min-w-0 text-meta wrap-break-word text-muted-foreground">
            {lookupTicketMeta(ticket)}
          </span>
          <StatusBadge tone={ticket.checkedIn ? 'neutral' : 'success'}>
            {ticket.checkedIn ? 'Đã check-in' : 'Hợp lệ'}
          </StatusBadge>
        </div>
      </div>
      {ticket.checkedIn ? null : (
        <Button
          type="button"
          variant="primary-on-light"
          size={null}
          className="h-11 shrink-0 px-4"
          loading={loading}
          disabled={disabled}
          aria-describedby={describedBy}
          onClick={onCheckIn}
        >
          Check-in
        </Button>
      )}
    </li>
  );
}

/**
 * `manual-lookup` (Story 5.5, UX-DR32, FR-29): `Sheet` từ dưới lên, tiêu đề "Tra tay", nhãn luôn hiện "SĐT hoặc email
 * Người mua", ô tìm tự focus. Tra khi gõ dừng ~200ms và `parseLookupQuery` nhận ra SĐT/email đầy đủ (chưa đủ thì dòng
 * nhắc, không gửi). Kết quả lưu theo giá trị đã chuẩn hóa, không tự thử lại, không tải lại khi focus. Mỗi hàng có nút
 * "Check-in" (khi chưa check-in): spinner trên nút được bấm, các nút khác tắt trong lúc chờ; mỗi lượt bấm một
 * `Idempotency-Key`, lỗi mạng hay 5xx thì bấm lại dùng cùng khóa. Kết quả `ok`/`recent`/`already` đổi hàng thành "Đã
 * check-in" ngay trong cache (không tra lại); Màn quét hiện kết quả bằng `scan-result-overlay`. Offline: dòng "Tra tay
 * cần mạng.", không tra, không check-in (không có hàng đợi). Kết quả không bao giờ có Mã QR vé, SĐT hay email.
 */
export function ManualLookup({
  eventId,
  open,
  onOpenChange,
  text,
  onTextChange,
  online,
  onResult,
  isHandledByScreen,
  onHandledError,
  onCheckInTap,
  returnFocus,
}: ManualLookupProps) {
  const ids = useId();
  const inputId = `${ids}-query`;
  const hintId = `${ids}-hint`;
  const offlineId = `${ids}-offline`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  // Chỉ tra giá trị đã đứng yên: giá trị hiện tại và giá trị sau debounce cùng chuẩn hóa ra một SĐT/email. Ô vừa xóa
  // (mở lại Sheet) không bao giờ hiện kết quả của giá trị cũ trong lúc chờ debounce.
  const debounced = useDebouncedValue(text, LOOKUP_DEBOUNCE_MS);
  const current = parseLookupQuery(text);
  const settled = parseLookupQuery(debounced);
  const query = current && settled && lookupQueryKey(current) === lookupQueryKey(settled) ? current : null;
  const lookupKey = query ? checkinLookupQueryKey(eventId, query) : null;
  const incomplete = text.trim() !== '' && current === null;

  const lookup = useQuery({
    queryKey: lookupKey ?? [...checkinLookupQueryPrefix(eventId), null],
    queryFn: query && open && online ? ({ signal }) => lookupCheckinTickets(eventId, query, signal) : skipToken,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  // 401/403 khi tra: Màn quét xử lý như khi quét (một lần cho mỗi lỗi).
  const lookupError = lookup.error;
  const handledRef = useRef<unknown>(null);
  useEffect(() => {
    if (!lookupError || handledRef.current === lookupError || !isHandledByScreen(lookupError)) return;
    handledRef.current = lookupError;
    onHandledError(lookupError);
  }, [lookupError, isHandledByScreen, onHandledError]);

  /** Khóa của lượt bấm trước bị lỗi mạng / 5xx, theo Vé: bấm lại dùng đúng khóa đó (api phát lại kết quả lần đầu). */
  const retryKeys = useRef(new Map<string, string>());
  const checkIn = useMutation({
    mutationFn: ({ ticketId, key }: CheckInVars) => checkInManually(eventId, ticketId, key),
    // Không chờ mạng rồi tự gửi (không có hàng đợi): offline thì nút đã tắt; lỗi mạng thì báo, người dùng bấm lại.
    networkMode: 'always',
    retry: false,
    onSuccess: (result, { ticketId, lookupKey: key }) => {
      retryKeys.current.delete(ticketId);
      if (marksCheckedIn(result)) {
        queryClient.setQueryData<CheckinLookupResult>(key, (data) => (data ? withCheckedIn(data, ticketId) : data));
      }
      onResult(result, hasUncheckedTickets(queryClient.getQueryData<CheckinLookupResult>(key)));
    },
    onError: (error, { ticketId, key }) => {
      if (isRetryableCheckInError(error)) retryKeys.current.set(ticketId, key);
      else retryKeys.current.delete(ticketId);
      if (isHandledByScreen(error)) onHandledError(error);
    },
  });

  const submit = (ticketId: string) => {
    if (!lookupKey) return;
    onCheckInTap();
    const key = retryKeys.current.get(ticketId) ?? newFunnelId();
    checkIn.mutate({ ticketId, key, lookupKey });
  };

  const changeText = (next: string) => {
    onTextChange(next);
    // Lỗi check-in của kết quả trước không còn đúng với giá trị mới.
    if (checkIn.isError) checkIn.reset();
  };

  // Sheet mở mới (ô tìm trống, khách kế): bỏ dải "Chưa check-in được…" của lượt trước.
  const freshOpen = open && text === '';
  const { reset: resetCheckIn } = checkIn;
  useEffect(() => {
    if (freshOpen) resetCheckIn();
  }, [freshOpen, resetCheckIn]);

  const pendingTicket = checkIn.isPending ? checkIn.variables?.ticketId : undefined;
  const checkInError = checkIn.error && !isHandledByScreen(checkIn.error) ? checkIn.error : null;

  let results: ReactNode = null;
  const data = lookupKey ? lookup.data : undefined;
  if (data) {
    results =
      data.tickets.length === 0 ? (
        <EmptyState icon={SearchX} title={LOOKUP_EMPTY_TEXT} className="py-6" />
      ) : (
        <>
          <p data-slot="manual-lookup-count" className="text-meta text-muted-foreground">
            {lookupCountText(data.tickets.length)}
          </p>
          <ul data-slot="manual-lookup-results" className="flex min-w-0 flex-col divide-y divide-border">
            {data.tickets.map((ticket) => (
              <TicketRow
                key={ticket.ticketId}
                ticket={ticket}
                loading={pendingTicket === ticket.ticketId}
                disabled={!online || (pendingTicket !== undefined && pendingTicket !== ticket.ticketId)}
                describedBy={online ? undefined : offlineId}
                onCheckIn={() => submit(ticket.ticketId)}
              />
            ))}
          </ul>
        </>
      );
  } else if (lookupKey && lookup.error && !isHandledByScreen(lookup.error)) {
    const error = lookup.error;
    results =
      error instanceof ApiError && error.code === ErrorCode.CHECKIN_LOOKUP_RATE_LIMITED ? (
        <StatusBanner tone="warning" title={lookupRateLimitedText(error)} />
      ) : (
        <StatusBanner
          tone="danger"
          title={LOOKUP_FAILED_TITLE}
          description={messageOf(error)}
          action={
            online ? (
              <Button type="button" variant="link" size="sm" loading={lookup.isFetching} onClick={() => void lookup.refetch()}>
                Thử lại
              </Button>
            ) : undefined
          }
        />
      );
  } else if (lookupKey && lookup.isFetching) {
    results = (
      <div role="status" aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Đang tra</span>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-slot="manual-lookup"
        // Cao cố định gần trọn màn: ô tìm và hàng đầu nằm ở nửa trên, bàn phím ảo không che.
        className="mx-auto h-[85dvh] w-full max-w-content-max-buyer"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        onPointerDownOutside={(event) => {
          // Lượt chạm đóng overlay kết quả không đóng luôn Sheet vừa mở lại: WebKit có thể giao `pointerdown` của chính
          // lượt chạm đó (trên nút đã rời DOM) sau khi Sheet đã mở.
          const target = event.detail.originalEvent.target;
          if (target instanceof Element && target.closest('[data-slot="scan-result-overlay"]')) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus) event.preventDefault();
        }}
      >
        <SheetHeader>
          <SheetTitle>{MANUAL_LOOKUP_TITLE}</SheetTitle>
          <SheetDescription className="sr-only">Tìm Vé của Sự kiện theo SĐT hoặc email của Người mua.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>{MANUAL_LOOKUP_LABEL}</Label>
          <Input
            ref={inputRef}
            id={inputId}
            name="lookup"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={CHECKIN_LOOKUP_QUERY_MAX}
            value={text}
            aria-describedby={incomplete ? hintId : !online ? offlineId : undefined}
            onChange={(event) => changeText(event.target.value)}
            // "Tìm" / Enter trên bàn phím ảo: đóng bàn phím để thấy kết quả (không gửi thêm request; vẫn tra theo debounce).
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              event.currentTarget.blur();
            }}
          />
          {incomplete ? (
            <p id={hintId} data-slot="manual-lookup-hint" className="text-meta text-muted-foreground">
              {LOOKUP_INCOMPLETE_TEXT}
            </p>
          ) : null}
          {online ? null : (
            <p id={offlineId} role="status" data-slot="manual-lookup-offline" className="text-meta text-warning-text">
              {LOOKUP_OFFLINE_TEXT}
            </p>
          )}
        </div>
        {checkInError ? (
          <StatusBanner tone="danger" title={CHECK_IN_FAILED_TITLE} description={messageOf(checkInError)} />
        ) : null}
        {results}
      </SheetContent>
    </Sheet>
  );
}
