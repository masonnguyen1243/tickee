'use client';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { PageHeading } from '@/components/tickee/page-heading';

import { EventWizard } from '../event-wizard';

/** Tạo Sự kiện mới: wizard bước 1 trống; lưu lần đầu xong chuyển sang `su-kien/{id}/thiet-lap`. */
export function CreateEvent() {
  const organization = useCurrentOrganization();
  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow={organization.name} title="Tạo Sự kiện" />
      <EventWizard orgId={organization.id} />
    </div>
  );
}
