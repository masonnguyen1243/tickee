'use client';

import { useQuery } from '@tanstack/react-query';
import { checkinScanPath, formatEventDateTime, OrganizationSection, organizationSectionPath } from '@tickee/contracts';
import { ChevronRight, ScanLine } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, type ReactNode } from 'react';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { eventsQueryKey, fetchEvents } from '@/lib/event/api';

import { scannableEvents } from './scannable-events';

function PickerSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      {[0, 1].map((n) => (
        <div key={n} aria-hidden="true" className="h-[72px] animate-pulse rounded-lg bg-muted" />
      ))}
    </div>
  );
}

/**
 * Tab "Quét vé" của dashboard (Story 5.3, Mason chốt 25/11/2026): chọn Sự kiện để mở Màn quét. Không còn Sự kiện nào
 * quét được → `empty-state` có link về "Sự kiện"; đúng một → chuyển thẳng tới Màn quét (`replace`, Back không quay lại
 * trang chọn); từ hai trở lên → danh sách để chọn. Lỗi tải → banner "Thử lại".
 */
export function ScanEventPicker({ title }: { title: string }) {
  const organization = useCurrentOrganization();
  const router = useRouter();
  const events = useQuery({
    queryKey: eventsQueryKey(organization.id),
    queryFn: ({ signal }) => fetchEvents(organization.id, signal),
  });
  const scannable = useMemo(() => (events.data ? scannableEvents(events.data) : undefined), [events.data]);
  const onlyEventId = scannable?.length === 1 ? scannable[0]!.id : null;

  useEffect(() => {
    if (onlyEventId) router.replace(checkinScanPath(onlyEventId));
  }, [onlyEventId, router]);

  let body: ReactNode;
  if (scannable && scannable.length > 1) {
    body = (
      <section aria-labelledby="scan-events" className="flex flex-col gap-stack">
        <h2 id="scan-events" className="text-title">
          Chọn Sự kiện để quét
        </h2>
        <ul className="flex flex-col gap-stack">
          {scannable.map((event) => (
            <li key={event.id}>
              <Link
                href={checkinScanPath(event.id)}
                data-slot="scan-event-card"
                className="flex min-w-0 items-center gap-3 rounded-lg bg-card p-card-padding shadow-card transition-[filter] active:brightness-95"
              >
                <ScanLine aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span data-slot="scan-event-name" className="truncate text-title">
                    {event.name}
                  </span>
                  <span className="text-meta text-muted-foreground tabular-nums">
                    {formatEventDateTime(event.startsAt)}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  } else if (scannable && scannable.length === 0) {
    body = (
      <EmptyState
        icon={ScanLine}
        title="Chưa có Sự kiện nào để quét."
        description="Sự kiện đã đăng và chưa kết thúc sẽ hiện ở đây."
        className="rounded-lg bg-card px-card-padding shadow-card"
        action={
          <Button asChild variant="primary-on-light">
            <Link href={organizationSectionPath(organization.id, OrganizationSection.EVENTS)}>Về danh sách Sự kiện</Link>
          </Button>
        }
      />
    );
  } else if (events.isError && !handledElsewhere(events.error)) {
    // Lỗi do nơi khác xử lý (2FA, đồng ý, 401, bị xóa khỏi BTC) giữ khung chờ, không báo lại ở đây.
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được danh sách Sự kiện"
        description={messageOf(events.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={events.isFetching} onClick={() => void events.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    // Đang tải, hoặc đúng một Sự kiện và đang chuyển sang Màn quét.
    body = <PickerSkeleton />;
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow={organization.name} title={title} />
      {body}
    </div>
  );
}
