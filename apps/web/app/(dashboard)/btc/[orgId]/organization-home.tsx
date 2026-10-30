'use client';

import { OrganizationSection, organizationSectionPath } from '@tickee/contracts';
import { CalendarDays } from 'lucide-react';
import Link from 'next/link';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { Button } from '@/components/ui/button';

/** Tên BTC + danh sách Sự kiện (Story 2.7 mới có Sự kiện: hiện trống). */
export function OrganizationHome() {
  const organization = useCurrentOrganization();
  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow="Dashboard BTC" title={organization.name} />
      <section aria-labelledby="org-events" className="flex flex-col gap-stack">
        <h2 id="org-events" className="text-title">
          Sự kiện
        </h2>
        <EmptyState
          icon={CalendarDays}
          title="Chưa có Sự kiện nào."
          description="Sự kiện bạn tạo sẽ hiện ở đây."
          className="rounded-lg bg-card px-card-padding shadow-card"
          action={
            <Button asChild variant="primary-on-light">
              <Link href={organizationSectionPath(organization.id, OrganizationSection.CREATE_EVENT)}>Tạo Sự kiện</Link>
            </Button>
          }
        />
      </section>
    </div>
  );
}
