import { ErrorCode, formatEventTimeRange, EventStatus, type PublicEvent } from '@tickee/contracts';
import { Building2 } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { hasErrorCode } from '@/lib/auth/api';
import { fetchPublicEvent } from '@/lib/event/public-api';

import { EventHero } from './event-hero';
import { SaleStatusBanner, TicketTiers } from './ticket-tiers';

type Props = { params: Promise<{ slug: string }> };

/**
 * Không dựng sẵn slug nào lúc build; mỗi slug dựng lần đầu khi có request rồi giữ như trang tĩnh (ISR), cũ tối đa
 * 30 giây theo `revalidate` của fetch phần tĩnh.
 */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

/** Nháp/slug sai (`EVENT_NOT_FOUND`) → `not-found.tsx` (HTTP 404); lỗi khác lên `error.tsx`. */
async function loadEvent(slug: string): Promise<PublicEvent> {
  try {
    return await fetchPublicEvent(slug);
  } catch (error) {
    if (hasErrorCode(error, ErrorCode.EVENT_NOT_FOUND)) notFound();
    throw error;
  }
}

/** Origin công khai của web (server-only, tùy chọn) để dựng URL tuyệt đối cho `og:image`. */
function metadataBase(): URL | undefined {
  const origin = process.env.WEB_ORIGIN;
  return origin ? new URL(origin) : undefined;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await loadEvent(slug);
  const title = `${event.name} · Tickee`;
  const when = formatEventTimeRange(event.startsAt, event.endsAt);
  const description = event.venue ? `${when} · ${event.venue}` : when;
  return {
    metadataBase: metadataBase(),
    title,
    description,
    // `og:image`/`twitter:image` do `opengraph-image.tsx` cùng thư mục sinh.
    openGraph: { type: 'website', title, description, url: `/e/${slug}`, siteName: 'Tickee', locale: 'vi_VN' },
    twitter: { card: 'summary_large_image', title, description },
    // Ẩn: vẫn mở được bằng link nhưng không cho máy tìm kiếm lập chỉ mục.
    ...(event.status === EventStatus.HIDDEN ? { robots: { index: false, follow: false } } : {}),
  };
}

function TextSection({ heading, text }: { heading: string; text: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-title">{heading}</h2>
      <p className="whitespace-pre-line text-body">{text}</p>
    </section>
  );
}

/**
 * Trang Sự kiện công khai `/e/{slug}` (Story 2.11-b). Phần tĩnh SSR, cache 30 giây; trạng thái bán và số vé tải ở
 * trình duyệt (`ticket-tiers.tsx`). Mobile: hero, BTC, banner, Hạng vé, mô tả. ≥ `lg`: 2 cột, Hạng vé dính bên phải.
 */
export default async function PublicEventPage({ params }: Props) {
  const { slug } = await params;
  const event = await loadEvent(slug);

  return (
    <div
      data-layout="wide"
      className="flex flex-col gap-section lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:grid-rows-[auto_1fr] lg:gap-x-8"
    >
      <div className="flex min-w-0 flex-col gap-section lg:col-start-1 lg:row-start-1">
        <EventHero
          name={event.name}
          startsAt={event.startsAt}
          endsAt={event.endsAt}
          venue={event.venue}
        />
        <p data-slot="event-organizer" className="flex min-w-0 items-center gap-2 text-label">
          <Building2 aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="text-muted-foreground">Tổ chức bởi </span>
            {event.organizationName}
          </span>
        </p>
        <SaleStatusBanner slug={slug} />
      </div>
      <aside aria-label="Hạng vé" className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <div className="lg:sticky lg:top-4">
          <TicketTiers slug={slug} ticketTypes={event.ticketTypes} />
        </div>
      </aside>
      {event.description || event.refundPolicy ? (
        <div className="flex min-w-0 flex-col gap-section lg:col-start-1 lg:row-start-2">
          {event.description ? <TextSection heading="Giới thiệu" text={event.description} /> : null}
          {event.refundPolicy ? <TextSection heading="Chính sách hoàn vé" text={event.refundPolicy} /> : null}
        </div>
      ) : null}
    </div>
  );
}
