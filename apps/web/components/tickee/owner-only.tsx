'use client';

import { organizationDashboardPath, roleHasPermission } from '@tickee/contracts';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { navSection, type NavSectionKey } from '@/lib/organizer/nav';

import { useCurrentOrganization } from './current-organization';
import { EmptyState } from './empty-state';
import { PageHeading } from './page-heading';

/**
 * Chặn trang của mục mà vai hiện tại không có quyền (theo `permission` của mục trong `NAV_SECTIONS`). Admin mở thẳng
 * URL của mục chỉ dành cho Owner thấy `empty-state` kèm nút về danh sách Sự kiện. Api vẫn tự chặn bằng
 * `FORBIDDEN_ROLE`; đây chỉ là giao diện.
 */
export function OwnerOnly({ section, children }: { section: NavSectionKey; children: ReactNode }) {
  const organization = useCurrentOrganization();
  const { label, permission } = navSection(section);
  if (roleHasPermission(organization.role, permission)) return children;

  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow={organization.name} title={label} />
      <EmptyState
        icon={Lock}
        title="Chỉ Owner xem được mục này."
        description="Liên hệ Owner của BTC nếu bạn cần thay đổi mục này."
        className="rounded-lg bg-card px-card-padding shadow-card"
        action={
          <Button asChild variant="secondary">
            <Link href={organizationDashboardPath(organization.id)}>Về danh sách Sự kiện</Link>
          </Button>
        }
      />
    </div>
  );
}
