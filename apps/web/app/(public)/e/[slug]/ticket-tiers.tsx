'use client';

import { formatVnd, type EventAvailability, type PublicTicketType } from '@tickee/contracts';
import { useQuery } from '@tanstack/react-query';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { availabilityQueryKey, fetchAvailability } from '@/lib/event/public-api';
import { saleBanner, tierStatusText } from '@/lib/event/public-sale';
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
 * Danh sách Hạng vé: tên, mô tả, giá (từ phần tĩnh) + trạng thái bán (từ `/availability`). Đang tải → skeleton; lỗi →
 * "Chưa tải được số vé." + "Thử lại", giá vẫn hiện. Chưa có stepper và nút Mua (Story 3.1).
 */
export function TicketTiers({ slug, ticketTypes }: { slug: string; ticketTypes: PublicTicketType[] }) {
  const availability = useAvailability(slug);
  const loading = !availability.data && !availability.isError;
  // Lần tải lại (vd. quay lại tab) lỗi sau một lần thành công cũng tính là lỗi: không để "Còn N vé" cũ trên màn hình.
  const failed = availability.isError;

  return (
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
          const tier = failed ? undefined : availability.data?.tiers.find((t) => t.ticketTypeId === ticketType.id);
          const unavailable = tier ? !tierStatusText(tier).available : false;
          return (
            <li
              key={ticketType.id}
              data-slot={unavailable ? 'ticket-tier-row-unavailable' : 'ticket-tier-row'}
              className={cn(
                'flex min-w-0 flex-col gap-1 rounded-md border p-card-padding',
                unavailable && 'border-dashed border-muted-foreground/40',
              )}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <h3 className={cn('min-w-0 text-label', unavailable && 'text-muted-foreground')}>{ticketType.name}</h3>
                <span className="shrink-0 text-label font-bold tabular-nums">{formatVnd(ticketType.price)}</span>
              </div>
              {ticketType.description ? (
                <p className="whitespace-pre-line text-meta text-muted-foreground">{ticketType.description}</p>
              ) : null}
              {failed ? null : <TierStatus tierId={ticketType.id} availability={availability.data} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
