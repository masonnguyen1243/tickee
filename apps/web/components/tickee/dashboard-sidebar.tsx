'use client';

import { organizationSectionPath, type Organization } from '@tickee/contracts';
import Link from 'next/link';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { visibleSections, type NavSectionKey } from '@/lib/organizer/nav';
import { cn } from '@/lib/utils';

import { OrganizationSwitcher, type MembershipsState } from './organization-switcher';

type DashboardSidebarProps = {
  organization: Organization;
  memberships: MembershipsState;
  active: NavSectionKey | null;
};

/**
 * `dashboard-sidebar` (DESIGN.md › Dashboard): nền stage, BTC switcher ở đầu, các mục cấp BTC. Từ `lg` rộng
 * `sidebar-width` có nhãn; `md`–`lg` chỉ còn icon (mỗi mục có `aria-label` + tooltip là tên mục). Ẩn dưới `md`
 * (thay bằng `bottom-tab-bar`). Khung là `div` (không `aside`): đây là điều hướng chính, landmark là `nav` bên trong.
 */
export function DashboardSidebar({ organization, memberships, active }: DashboardSidebarProps) {
  const sections = visibleSections(organization.role, 'sidebar');

  return (
    <div
      data-slot="dashboard-sidebar"
      className="sticky top-0 hidden h-dvh w-16 shrink-0 flex-col gap-3.5 overflow-y-auto bg-stage px-3 py-3.5 text-stage-foreground md:flex lg:w-sidebar-width"
    >
      <OrganizationSwitcher organization={organization} memberships={memberships} variant="sidebar" />
      <nav aria-label="Điều hướng BTC">
        <ul className="flex flex-col gap-0.5">
          {sections.map(({ key, label, icon: Icon }) => {
            const current = key === active;
            return (
              <li key={key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={organizationSectionPath(organization.id, key)}
                      aria-label={label}
                      aria-current={current ? 'page' : undefined}
                      data-active={current || undefined}
                      className={cn(
                        'relative flex h-10 items-center justify-center gap-2.5 rounded-sm text-label lg:justify-start lg:px-2.5',
                        current
                          ? 'font-bold text-stage-foreground before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-0.75 before:rounded-r-[3px] before:bg-primary'
                          : 'text-stage-muted hover:bg-stage-line',
                      )}
                    >
                      <Icon aria-hidden="true" className={cn('size-5 shrink-0', current && 'text-primary')} />
                      <span className="hidden truncate lg:inline">{label}</span>
                    </Link>
                  </TooltipTrigger>
                  {/* Từ `lg` nhãn đã hiện cạnh icon nên không cần tooltip. */}
                  <TooltipContent side="right" className="lg:hidden">
                    {label}
                  </TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
