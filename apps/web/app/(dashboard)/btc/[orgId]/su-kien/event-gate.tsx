'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorCode, organizationDashboardPath, type EventDetail } from '@tickee/contracts';
import { CalendarX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { eventQueryKey, fetchEvent } from '@/lib/event/api';

import { handledElsewhere } from './handled-elsewhere';

function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-section pt-2">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-14 w-2/3 animate-pulse rounded-md bg-muted" />
      <div aria-hidden="true" className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/**
 * Tải một Sự kiện của BTC đang mở rồi render `children(event)`. Đang tải → skeleton; id lạ hoặc của BTC khác
 * (`EVENT_NOT_FOUND`) → `empty-state` kèm link về danh sách; lỗi khác → banner "Thử lại".
 */
export function EventGate({ eventId, children }: { eventId: string; children: (event: EventDetail) => ReactNode }) {
  const organization = useCurrentOrganization();
  const event = useQuery({
    queryKey: eventQueryKey(organization.id, eventId),
    queryFn: ({ signal }) => fetchEvent(organization.id, eventId, signal),
  });

  if (event.data) return children(event.data);
  if (!event.isError || handledElsewhere(event.error)) return <PageSkeleton />;
  if (hasErrorCode(event.error, ErrorCode.EVENT_NOT_FOUND)) {
    return (
      <div className="flex flex-col gap-section pt-2">
        <PageHeading eyebrow={organization.name} title="Sự kiện" />
        <EmptyState
          icon={CalendarX}
          title="Không tìm thấy Sự kiện này."
          description="Sự kiện không tồn tại hoặc không thuộc BTC này."
          className="rounded-lg bg-card px-card-padding shadow-card"
          action={
            <Button asChild variant="primary-on-light">
              <Link href={organizationDashboardPath(organization.id)}>Về danh sách Sự kiện</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow={organization.name} title="Sự kiện" />
      <StatusBanner
        tone="danger"
        title="Chưa tải được Sự kiện"
        description={event.error instanceof ApiError ? event.error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.'}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void event.refetch()}>
            Thử lại
          </Button>
        }
      />
    </div>
  );
}
