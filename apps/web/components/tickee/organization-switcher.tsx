'use client';

import {
  CREATE_ORGANIZATION_PATH,
  organizationDashboardPath,
  type Membership,
  type Organization,
} from '@tickee/contracts';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { organizationInitial, roleLabel } from '@/lib/organizer/nav';
import { cn } from '@/lib/utils';

export type MembershipsState = { data: readonly Membership[] | undefined; isError: boolean };

type OrganizationSwitcherProps = {
  /** BTC đang mở (`GET /v1/orgs/:orgId`): tên và vai ở nút lấy từ đây, không từ memberships. */
  organization: Organization;
  memberships: MembershipsState;
  /**
   * `sidebar` — trên nền stage; `md`–`lg` chỉ còn avatar, từ `lg` đủ avatar + tên + vai + chevron.
   * `sheet` — trong Sheet "Thêm" (nền card), luôn đủ.
   */
  variant: 'sidebar' | 'sheet';
  /** Gọi khi chọn một mục (vd. đóng Sheet chứa switcher). */
  onNavigate?: () => void;
};

export function OrganizationAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="organization-avatar"
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-bar text-label font-bold text-primary',
        className,
      )}
    >
      {organizationInitial(name)}
    </span>
  );
}

/** Danh sách memberships, BTC hiện tại luôn có mặt (memberships có thể cũ hơn) và lấy tên/vai từ `organization`. */
function switcherItems(organization: Organization, memberships: readonly Membership[] | undefined): Membership[] {
  const current: Membership = { organizationId: organization.id, name: organization.name, role: organization.role };
  const list = memberships ?? [];
  const hasCurrent = list.some((m) => m.organizationId === organization.id);
  return hasCurrent ? list.map((m) => (m.organizationId === organization.id ? current : m)) : [current, ...list];
}

/**
 * BTC switcher: liệt kê BTC của tài khoản (tên + vai), đánh dấu BTC hiện tại. Chọn một BTC → `/btc/{id}` (danh sách
 * Sự kiện của BTC đó); cuối danh sách là "Tạo BTC mới" → `/tao-btc`.
 */
export function OrganizationSwitcher({ organization, memberships, variant, onNavigate }: OrganizationSwitcherProps) {
  const role = roleLabel(organization.role);
  const items = switcherItems(organization, memberships.data);
  const onStage = variant === 'sidebar';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-slot="organization-switcher"
          aria-label={`${organization.name}, ${role}. Đổi BTC`}
          className={cn(
            'flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md text-left',
            onStage
              ? 'justify-center p-0.5 text-stage-foreground hover:bg-stage-line lg:justify-start lg:bg-stage-line lg:p-2'
              : 'bg-muted p-2 text-foreground hover:bg-accent',
          )}
        >
          <OrganizationAvatar name={organization.name} />
          <span className={cn('min-w-0 flex-1', onStage && 'hidden lg:block')}>
            <span data-slot="organization-switcher-name" className="block truncate text-label font-bold">
              {organization.name}
            </span>
            <span className={cn('block text-meta', onStage ? 'text-stage-muted' : 'text-muted-foreground')}>
              {role}
            </span>
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className={cn('size-4 shrink-0', onStage ? 'hidden text-stage-muted lg:block' : 'text-muted-foreground')}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>BTC của bạn</DropdownMenuLabel>
        {items.map((m) => {
          const current = m.organizationId === organization.id;
          return (
            <DropdownMenuItem key={m.organizationId} asChild onSelect={onNavigate}>
              <Link
                href={organizationDashboardPath(m.organizationId)}
                aria-current={current ? 'true' : undefined}
                className="py-1.5"
              >
                <OrganizationAvatar name={m.name} className="size-8 text-meta" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{m.name}</span>
                  <span className="block text-meta text-muted-foreground">{roleLabel(m.role)}</span>
                </span>
                {current ? (
                  <>
                    <Check aria-hidden="true" className="text-brand-text" />
                    <span className="sr-only">(đang chọn)</span>
                  </>
                ) : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
        {memberships.data === undefined ? (
          <DropdownMenuItem disabled className="text-meta text-muted-foreground">
            {memberships.isError ? 'Chưa tải được danh sách BTC.' : 'Đang tải danh sách BTC…'}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onSelect={onNavigate}>
          <Link href={CREATE_ORGANIZATION_PATH}>
            <Plus aria-hidden="true" />
            Tạo BTC mới
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
