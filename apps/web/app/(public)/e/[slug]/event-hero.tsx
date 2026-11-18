'use client';

import { formatEventTimeRange } from '@tickee/contracts';
import { CalendarDays, MapPin, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { StageBlock } from '@/components/tickee/stage-block';
import { Button } from '@/components/ui/button';
import { shareLink } from '@/lib/share';

type EventHeroProps = {
  name: string;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  /** Ảnh Sự kiện (Story 4.8-b); `null` → gradient coral. */
  imageUrl: string | null;
};

const mapsUrl = (venue: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`;

/** Chia sẻ link trang (không query, không `#`): Web Share API, không có thì sao chép kèm toast (`shareLink`). */
const shareEvent = (name: string): Promise<void> =>
  shareLink({ title: name, url: `${window.location.origin}${window.location.pathname}` });

/**
 * Ảnh Sự kiện trong khung 16:9 (≥ lg 2:1) `object-cover`; không có ảnh hoặc tải lỗi → gradient coral trên
 * `stage-fallback`. Ảnh dựng sẵn ở server có thể lỗi trước khi React gắn `onError`, nên lúc mount kiểm thêm ảnh đã tải
 * xong mà không có kích thước.
 */
function HeroImage({ imageUrl }: { imageUrl: string | null }) {
  const ref = useRef<HTMLImageElement>(null);
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const shown = imageUrl && imageUrl !== brokenUrl ? imageUrl : null;

  useEffect(() => {
    const img = ref.current;
    if (shown && img && img.complete && img.naturalWidth === 0) setBrokenUrl(shown);
  }, [shown]);

  if (shown) {
    return (
      <img
        ref={ref}
        src={shown}
        // Tên Sự kiện đã ở `h1` ngay dưới.
        alt=""
        // Ảnh lớn đầu trang (LCP).
        fetchPriority="high"
        data-slot="event-hero-image"
        className="aspect-[16/9] w-full rounded-md bg-stage-fallback object-cover lg:aspect-[2/1]"
        onError={() => setBrokenUrl(shown)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      data-slot="event-hero-fallback"
      className="aspect-[16/9] w-full rounded-md bg-stage-fallback bg-[radial-gradient(120%_90%_at_15%_10%,color-mix(in_srgb,var(--primary)_55%,transparent),transparent_60%),linear-gradient(135deg,color-mix(in_srgb,var(--primary)_22%,transparent),transparent_70%)] lg:aspect-[2/1]"
    />
  );
}

/**
 * `event-hero` dạng stage: ảnh Sự kiện (Story 4.8-b; không có thì gradient coral trên `stage-fallback`), eyebrow, tên
 * (`h1`), khoảng ngày-giờ, địa điểm mở Google Maps, nút chia sẻ.
 */
export function EventHero({ name, startsAt, endsAt, venue, imageUrl }: EventHeroProps) {
  return (
    <StageBlock data-slot="event-hero" className="flex flex-col gap-4">
      <HeroImage imageUrl={imageUrl} />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-eyebrow uppercase tracking-wide text-primary">Sự kiện</p>
        <h1 className="text-headline">{name}</h1>
      </div>
      <ul className="flex flex-col gap-2 text-body">
        <li className="flex items-start gap-2">
          <CalendarDays aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-stage-muted" />
          <span data-slot="event-hero-time" className="min-w-0 tabular-nums">
            {formatEventTimeRange(startsAt, endsAt)}
          </span>
        </li>
        {venue ? (
          <li className="flex items-start gap-2">
            <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-stage-muted" />
            <a
              href={mapsUrl(venue)}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 underline decoration-stage-muted underline-offset-4"
            >
              {venue}
              <span className="sr-only"> (mở bản đồ trong thẻ mới)</span>
            </a>
          </li>
        ) : null}
      </ul>
      <div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => {
            void shareEvent(name);
          }}
        >
          <Share2 aria-hidden="true" />
          Chia sẻ
        </Button>
      </div>
    </StageBlock>
  );
}
