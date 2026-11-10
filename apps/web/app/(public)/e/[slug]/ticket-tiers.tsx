'use client';

import {
  checkoutPath,
  ErrorCode,
  FUNNEL_ID_PARAM,
  FunnelEventType,
  serializeSelection,
  SELECTION_PARAM,
  TierSaleStatus,
  type EventAvailability,
  type PublicTicketType,
} from '@tickee/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useId, useState, useTransition } from 'react';

import { PurchaseBar } from '@/components/tickee/purchase-bar';
import { QuantityStepper } from '@/components/tickee/quantity-stepper';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { fetchMe, hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { newFunnelId, sendFunnelEvent } from '@/lib/event/funnel';
import { availabilityQueryKey, fetchAvailability } from '@/lib/event/public-api';
import { REFUND_POLICY_ANCHOR, saleBanner, tierStatusText } from '@/lib/event/public-sale';
import {
  clampSelection,
  EMPTY_SELECTION,
  isFreeEvent,
  plusCeiling,
  priceLabel,
  purchaseBarState,
  sameSelection,
  selectionFromItems,
  selectionItems,
  setQuantity,
  type PurchaseBarState,
  type Selection,
} from '@/lib/event/selection';
import { cn } from '@/lib/utils';

/**
 * Trạng thái bán + số vé còn, tải ở trình duyệt lúc mở trang và mỗi lần tab hiện lại (`visibilitychange`, qua focus
 * manager của TanStack Query). Banner và danh sách Hạng vé dùng chung một query.
 */
function useAvailability(slug: string) {
  return useQuery({
    queryKey: availabilityQueryKey(slug),
    queryFn: ({ signal }) => fetchAvailability(slug, signal),
    // Mặc định toàn app `staleTime` 30 giây: ở đây số vé phải mới mỗi lần quay lại tab (API đã cache tối đa 2 giây).
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  });
}

/** Banner trạng thái cấp Sự kiện (không đóng được). Chưa có dữ liệu hoặc lỗi → không hiện gì. */
export function SaleStatusBanner({ slug }: { slug: string }) {
  const { data } = useAvailability(slug);
  const banner = data ? saleBanner(data) : null;
  if (!banner) return null;
  return <StatusBanner tone={banner.tone} title={banner.title} />;
}

function TierStatus({ tierId, availability }: { tierId: string; availability: EventAvailability | undefined }) {
  if (!availability) {
    return <span aria-hidden="true" data-slot="skeleton" className="block h-5 w-24 animate-pulse rounded-sm bg-muted" />;
  }
  const tier = availability.tiers.find((t) => t.ticketTypeId === tierId);
  // Hạng vé mới thêm sau bản HTML đang cache: chưa có trạng thái, chỉ hiện giá.
  if (!tier) return null;
  const status = tierStatusText(tier);
  return (
    <span
      data-slot="ticket-tier-status"
      className={cn('text-meta tabular-nums', status.lowStock ? 'font-bold text-brand-text' : 'text-muted-foreground')}
    >
      {status.text}
    </span>
  );
}

/**
 * "Mua"/"Đăng ký": ghi `buy_clicked` (không chờ), rồi tới URL Checkout kèm lựa chọn và luôn kèm `f=<funnelId>` (Checkout
 * giữ `funnelId` để gửi kèm Đơn, ghi `order_created`; Story 3.2): đã đăng nhập → thẳng Checkout; chưa → màn đăng nhập
 * với `returnTo` là URL đó. Chưa có `me` mới (đang tải hoặc lần tải gần nhất lỗi) thì hỏi lại `me`. Chỉ `401
 * UNAUTHENTICATED` là chưa đăng nhập; lỗi khác (`TOTP_REQUIRED`, 5xx, mạng) coi như đã đăng nhập: Checkout tự hiện lỗi
 * kèm "Thử lại". Spinner trong nút từ lúc bấm tới khi điều hướng xong (`useTransition`), kể cả khi Checkout redirect về
 * lại trang Sự kiện (lựa chọn hết hợp lệ): nút không bao giờ kẹt.
 */
function useBuy(slug: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  /** Đang hỏi lại `me` trước khi điều hướng. */
  const [checking, setChecking] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const pending = checking || navigating;

  const needsLogin = async (): Promise<boolean> => {
    // TanStack giữ `data` cũ khi lần tải lại lỗi (vd. 401 vì phiên hết hạn): chỉ tin `data` khi không có lỗi.
    if (me.data && !me.isError) return false;
    try {
      // `staleTime: 0`: không trả lại `data` cũ còn trong cache mà luôn hỏi lại.
      await queryClient.fetchQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal), staleTime: 0 });
      return false;
    } catch (error) {
      return hasErrorCode(error, ErrorCode.UNAUTHENTICATED);
    }
  };

  const buy = async (items: string) => {
    if (pending) return;
    setChecking(true);
    // Không bao giờ ném: lỗi khác 401 coi như đã đăng nhập.
    const loginRequired = await needsLogin();
    const funnelId = newFunnelId();
    sendFunnelEvent(slug, { type: FunnelEventType.BUY_CLICKED, funnelId, loginRequired });
    // Back từ màn đăng nhập hay Checkout về lại đúng lựa chọn: URL là nguồn duy nhất của lựa chọn (AD-19). Chỉ đặt
    // `items`, giữ tham số khác (utm_*) và hash.
    const here = new URL(window.location.href);
    here.searchParams.set(SELECTION_PARAM, items);
    window.history.replaceState(window.history.state, '', `${here.pathname}${here.search}${here.hash}`);
    const checkout = `${checkoutPath(slug)}?${SELECTION_PARAM}=${items}&${FUNNEL_ID_PARAM}=${funnelId}`;
    // `checking` về false cùng lúc điều hướng commit; `navigating` giữ spinner tới khi trang đích (hoặc trang redirect
    // về) render xong.
    startNavigation(() => {
      setChecking(false);
      router.push(loginRequired ? withReturnTo(LOGIN_PATH, checkout) : checkout);
    });
  };

  return { buy, pending };
}

/** Dòng chữ của `purchase-bar`: "Hết vé" thay cả thanh; chưa chọn → lời nhắc cạnh nút tắt; đã chọn → "Tổng · N vé". */
function barCaption(bar: Exclude<PurchaseBarState, { kind: 'hidden' }>): string {
  if (bar.kind === 'sold-out') return 'Hết vé';
  if (bar.kind === 'empty') return 'Chọn vé để tiếp tục';
  return `Tổng · ${bar.count} vé`;
}

type TicketTiersProps = {
  slug: string;
  ticketTypes: PublicTicketType[];
  /** Giới hạn Vé/Đơn của Sự kiện: trần tổng số Vé chọn được. */
  maxTicketsPerOrder: number;
  /** Trang có khối "Chính sách hoàn vé" (`REFUND_POLICY_ANCHOR`). */
  hasRefundPolicy: boolean;
};

/**
 * Danh sách Hạng vé + `quantity-stepper` cho Hạng vé đang bán + `purchase-bar`. Lựa chọn điền sẵn từ `?items=` (vd.
 * "Sửa lựa chọn" ở Checkout): đọc `useSearchParams` nên bọc `Suspense` (trang dựng tĩnh; bản dựng sẵn chưa có lựa
 * chọn).
 */
export function TicketTiers(props: TicketTiersProps) {
  return (
    <Suspense fallback={<TicketPicker {...props} initialItems={null} />}>
      <TicketPickerFromUrl {...props} />
    </Suspense>
  );
}

function TicketPickerFromUrl(props: TicketTiersProps) {
  const items = useSearchParams().get(SELECTION_PARAM);
  return <TicketPicker {...props} initialItems={items} />;
}

/**
 * Tên, mô tả, giá (từ phần tĩnh) + trạng thái bán (từ `/availability`). Đang tải → skeleton; lỗi → "Chưa tải được số
 * vé." + "Thử lại", giá vẫn hiện, không có stepper hay thanh mua. Mỗi lần có số vé mới, lựa chọn bị kẹp xuống theo số
 * còn lại và giới hạn Vé/Đơn (không bao giờ vượt).
 */
function TicketPicker({
  slug,
  ticketTypes,
  maxTicketsPerOrder,
  hasRefundPolicy,
  initialItems,
}: TicketTiersProps & { initialItems: string | null }) {
  const availability = useAvailability(slug);
  const loading = !availability.data && !availability.isError;
  // Lần tải lại (vd. quay lại tab) lỗi sau một lần thành công cũng tính là lỗi: không để "Còn N vé" cũ trên màn hình.
  const failed = availability.isError;
  const known = failed ? undefined : availability.data;

  const [selection, setSelection] = useState<Selection>(
    () => selectionFromItems(initialItems, { ticketTypes, maxTicketsPerOrder }) ?? EMPTY_SELECTION,
  );
  // Kẹp ngay trong lúc render mỗi khi số vé đổi (TanStack Query giữ nguyên tham chiếu khi dữ liệu không đổi).
  const [clampedFor, setClampedFor] = useState<EventAvailability | undefined>(undefined);
  if (known && known !== clampedFor) {
    setClampedFor(known);
    const clamped = clampSelection(selection, ticketTypes, known, maxTicketsPerOrder);
    if (!sameSelection(clamped, selection)) setSelection(clamped);
  }

  const { buy, pending } = useBuy(slug);
  const free = isFreeEvent(ticketTypes);
  const bar = purchaseBarState(ticketTypes, known, selection);
  const tierOf = (id: string) => known?.tiers.find((t) => t.ticketTypeId === id);
  const anyOnSale = ticketTypes.some((t) => tierOf(t.id)?.status === TierSaleStatus.ON_SALE);
  const actionLabel = free ? 'Đăng ký' : 'Mua';
  // Dòng "Tối đa N vé mỗi Đơn": lý do nút "+" tắt, đọc kèm nút qua `aria-describedby`.
  const orderLimitNoteId = useId();

  return (
    <div className="flex flex-col gap-stack">
      <section
        aria-labelledby="ticket-tiers-heading"
        aria-busy={loading}
        className="flex flex-col gap-stack rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
      >
        <h2 id="ticket-tiers-heading" className="text-title">
          Hạng vé
        </h2>
        {loading ? <span className="sr-only">Đang tải số vé</span> : null}
        {failed ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-meta text-muted-foreground">Chưa tải được số vé.</p>
            <Button
              type="button"
              variant="link"
              size="sm"
              loading={availability.isFetching}
              onClick={() => {
                void availability.refetch();
              }}
            >
              Thử lại
            </Button>
          </div>
        ) : null}
        {ticketTypes.length === 0 ? <p className="text-meta text-muted-foreground">Chưa có Hạng vé.</p> : null}
        <ul className="flex flex-col gap-stack">
          {ticketTypes.map((ticketType) => {
            const tier = tierOf(ticketType.id);
            const unavailable = tier ? !tierStatusText(tier).available : false;
            const onSale = tier?.status === TierSaleStatus.ON_SALE;
            // Đang tải: skeleton; lỗi hoặc Hạng vé chưa có trong số vé (thêm sau bản HTML đang cache): chỉ hiện giá.
            const showStatus = !failed && (!known || tier !== undefined);
            return (
              <li
                key={ticketType.id}
                data-slot={unavailable ? 'ticket-tier-row-unavailable' : 'ticket-tier-row'}
                className={cn(
                  'flex min-w-0 items-center justify-between gap-3 rounded-md border p-card-padding',
                  unavailable && 'border-dashed border-muted-foreground/40',
                )}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 className={cn('min-w-0 text-label font-bold', unavailable && 'text-muted-foreground')}>
                    {ticketType.name}
                  </h3>
                  {ticketType.description ? (
                    <p className="whitespace-pre-line text-meta text-muted-foreground">{ticketType.description}</p>
                  ) : null}
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-label">
                    <span
                      data-slot="ticket-tier-price"
                      className={cn('font-bold tabular-nums', unavailable && 'text-muted-foreground')}
                    >
                      {priceLabel(ticketType.price)}
                    </span>
                    {showStatus ? (
                      <>
                        <span aria-hidden="true" className="text-muted-foreground">
                          ·
                        </span>
                        <TierStatus tierId={ticketType.id} availability={known} />
                      </>
                    ) : null}
                  </p>
                </div>
                {onSale ? (
                  <QuantityStepper
                    label={ticketType.name}
                    value={selection.get(ticketType.id) ?? 0}
                    max={plusCeiling(ticketType.id, selection, tier, maxTicketsPerOrder)}
                    incrementDescribedBy={orderLimitNoteId}
                    onChange={(quantity) => setSelection(setQuantity(selection, ticketType.id, quantity))}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        {anyOnSale ? (
          <p id={orderLimitNoteId} data-slot="order-limit-note" className="text-meta text-muted-foreground">
            Tối đa {maxTicketsPerOrder} vé mỗi Đơn
            {hasRefundPolicy ? (
              <>
                {' · '}
                <a
                  href={`#${REFUND_POLICY_ANCHOR}`}
                  className="font-bold text-brand-text underline-offset-4 hover:underline"
                >
                  Chính sách hoàn vé
                </a>
              </>
            ) : null}
          </p>
        ) : null}
      </section>
      {bar.kind === 'hidden' ? null : (
        <PurchaseBar
          caption={barCaption(bar)}
          total={bar.kind === 'ready' ? priceLabel(bar.amount) : undefined}
          action={
            bar.kind === 'sold-out' ? undefined : (
              <Button
                type="button"
                variant="primary"
                disabled={bar.kind === 'empty'}
                loading={pending}
                className="w-35 shrink"
                onClick={() => {
                  void buy(serializeSelection(selectionItems(selection, ticketTypes)));
                }}
              >
                {actionLabel}
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
