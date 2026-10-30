'use client';

import { Construction } from 'lucide-react';

import { useCurrentOrganization } from './current-organization';
import { EmptyState } from './empty-state';
import { PageHeading } from './page-heading';

type ComingSoonProps = {
  /** Tên mục (tiêu đề trang). */
  title: string;
  /** Một câu ngắn nêu mục sẽ làm gì. */
  description: string;
};

/** Trang tạm của một mục chưa làm: story sau thay bằng trang thật. */
export function ComingSoon({ title, description }: ComingSoonProps) {
  const organization = useCurrentOrganization();
  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow={organization.name} title={title} />
      <EmptyState
        icon={Construction}
        title="Sắp có"
        description={description}
        className="rounded-lg bg-card px-card-padding shadow-card"
      />
    </div>
  );
}
