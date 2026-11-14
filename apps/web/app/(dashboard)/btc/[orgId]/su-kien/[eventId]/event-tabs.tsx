'use client';

import { eventPath, formatEventDateTime, type EventDetail } from '@tickee/contracts';
import { Construction } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBadge } from '@/components/tickee/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEventSaleStatus } from '@/lib/event/sale-status';

import { EventGate } from '../event-gate';
import { eventSaleBadge } from '../event-status';
import { PublicEventLink } from '../public-event-link';
import { PurchaseFormEditor } from '../purchase-form-editor';
import { TicketTypesEditor } from '../ticket-types-editor';

import { EventOverviewLive } from './event-overview';
import { EventSettings } from './event-settings';
import { DEFAULT_EVENT_TAB, EVENT_TABS, isEventTab, type EventTab } from './event-tab-list';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="text-body wrap-break-word whitespace-pre-line">{children}</dd>
    </div>
  );
}

/**
 * Tab Tổng quan: Sự kiện đã rời nháp → `stat-card` doanh thu và "Đơn gần đây" tự cập nhật (Story 3.11) nằm trên thẻ
 * "Thông tin"; nháp → chỉ thẻ "Thông tin" (không gọi API Tổng quan). Thẻ "Thông tin": nháp → "Tiếp tục thiết lập"; đã mở
 * bán (kể cả Ẩn, Đã hủy: link vẫn mở được) → link trang Sự kiện công khai kèm "Sao chép link".
 */
function Overview({ orgId, event }: { orgId: string; event: EventDetail }) {
  return (
    <div className="flex min-w-0 flex-col gap-section">
      {event.status !== 'draft' ? <EventOverviewLive orgId={orgId} eventId={event.id} /> : null}
      <EventInfo orgId={orgId} event={event} />
    </div>
  );
}

/**
 * Thẻ "Thông tin" của tab Tổng quan. Badge trạng thái bán dùng chung query với thẻ Sự kiện ở trang chủ BTC (Story 4.2-c);
 * nháp không cần api.
 */
function EventInfo({ orgId, event }: { orgId: string; event: EventDetail }) {
  const saleStatus = useEventSaleStatus(orgId, event.status !== 'draft');
  const badge = eventSaleBadge(event, saleStatus?.get(event.id));
  return (
    <section
      aria-label="Tóm tắt Sự kiện"
      data-slot="event-overview"
      className="flex flex-col gap-section rounded-lg bg-card p-card-padding shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-stack">
        <h2 className="text-title">Thông tin</h2>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>
      <dl className="flex flex-col gap-stack">
        {event.status !== 'draft' ? (
          <Row label="Link cho Người mua">
            <PublicEventLink slug={event.slug} />
          </Row>
        ) : null}
        <Row label="Thời gian">
          <span className="tabular-nums">
            {formatEventDateTime(event.startsAt)} – {formatEventDateTime(event.endsAt)}
          </span>
        </Row>
        <Row label="Địa điểm">{event.venue ?? 'Chưa có'}</Row>
        <Row label="Mô tả">{event.description ?? 'Chưa có'}</Row>
        <Row label="Chính sách hoàn vé">{event.refundPolicy ?? 'Chưa có — cần có để mở bán.'}</Row>
      </dl>
      {event.status === 'draft' ? (
        <div>
          <Button asChild variant="primary-on-light">
            <Link href={eventPath(orgId, event.id, 'thiet-lap')}>Tiếp tục thiết lập</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Khung tab của một Sự kiện; tab đổi thì cập nhật `?tab=` (Tổng quan là mặc định, không ghi vào URL). */
export function EventTabs({ eventId, initialTab }: { eventId: string; initialTab: EventTab }) {
  const organization = useCurrentOrganization();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<EventTab>(initialTab);

  const select = (value: string) => {
    if (!isEventTab(value)) return;
    setTab(value);
    router.replace(value === DEFAULT_EVENT_TAB ? pathname : `${pathname}?tab=${value}`, { scroll: false });
  };

  return (
    <EventGate eventId={eventId}>
      {(event) => (
        <div className="flex min-w-0 flex-col gap-section pt-2">
          <PageHeading eyebrow={organization.name} title={event.name} />
          <Tabs value={tab} onValueChange={select} className="min-w-0">
            <TabsList aria-label="Mục của Sự kiện">
              {EVENT_TABS.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {EVENT_TABS.map((t) => (
              <TabsContent key={t.key} value={t.key}>
                {'soon' in t ? (
                  <EmptyState
                    icon={Construction}
                    title="Sắp có"
                    description={t.soon}
                    className="rounded-lg bg-card px-card-padding shadow-card"
                  />
                ) : t.key === 'hang-ve' ? (
                  <TicketTypesEditor orgId={organization.id} event={event} />
                ) : t.key === 'form-mua' ? (
                  <PurchaseFormEditor orgId={organization.id} eventId={event.id} />
                ) : t.key === 'cai-dat' ? (
                  <EventSettings orgId={organization.id} event={event} />
                ) : (
                  <Overview orgId={organization.id} event={event} />
                )}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}
    </EventGate>
  );
}
