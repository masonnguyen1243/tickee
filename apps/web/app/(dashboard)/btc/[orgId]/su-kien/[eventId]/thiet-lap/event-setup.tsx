'use client';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { PageHeading } from '@/components/tickee/page-heading';

import { EventGate } from '../../event-gate';
import { EventWizard } from '../../event-wizard';

/** Wizard của Sự kiện đã có: mở với dữ liệu đã lưu; mọi lần lưu là PATCH. */
export function EventSetup({ eventId, initialStep }: { eventId: string; initialStep: number }) {
  const organization = useCurrentOrganization();
  return (
    <EventGate eventId={eventId}>
      {(event) => (
        <div className="flex flex-col gap-section pt-2">
          <PageHeading eyebrow={organization.name} title={event.name} />
          {/* `key`: chỉ khởi tạo ô nhập một lần theo Sự kiện; tải lại nền không ghi đè dữ liệu đang nhập. */}
          <EventWizard key={event.id} orgId={organization.id} event={event} initialStep={initialStep} />
        </div>
      )}
    </EventGate>
  );
}
