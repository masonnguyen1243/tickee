'use client';

import { organizationSectionPath, type Organization } from '@tickee/contracts';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { visibleSections, type NavSectionKey } from '@/lib/organizer/nav';
import { cn } from '@/lib/utils';

import { OrganizationSwitcher, type MembershipsState } from './organization-switcher';

type BottomTabBarProps = {
  organization: Organization;
  memberships: MembershipsState;
  active: NavSectionKey | null;
};

/** Ô của tab bar: icon 24px + nhãn meta; đang chọn màu brand + vạch coral 2px phía trên. */
const tabClass = (current: boolean) =>
  cn(
    'relative flex h-full w-full min-w-0 cursor-pointer flex-col items-center justify-center gap-1 px-1 text-meta',
    current
      ? 'text-primary before:absolute before:inset-x-[22%] before:top-0 before:h-0.5 before:rounded-b-[2px] before:bg-primary'
      : 'text-stage-muted',
  );

function TabLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <>
      <Icon aria-hidden="true" className="size-6 shrink-0" />
      <span className="max-w-full truncate">{label}</span>
    </>
  );
}

/**
 * `bottom-tab-bar` (< `md`): cố định ở đáy, nền `bar`, cao `tab-bar-height` + safe-area. Sự kiện · Cần xử lý ·
 * Quét vé · Thêm; "Thêm" mở Sheet gồm các mục còn lại (đã lọc theo quyền) và BTC switcher.
 */
export function BottomTabBar({ organization, memberships, active }: BottomTabBarProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // Đổi trang mà không bấm trong Sheet (Back của trình duyệt/Android) cũng đóng Sheet. Chỉnh state ngay lúc render
  // (không dùng effect) để Sheet không kịp hiện trên trang mới.
  const [openPathname, setOpenPathname] = useState(pathname);
  if (openPathname !== pathname) {
    setOpenPathname(pathname);
    setMoreOpen(false);
  }
  const tabs = visibleSections(organization.role, 'tab');
  const more = visibleSections(organization.role, 'sheet');
  const activeInMore = more.some((s) => s.key === active);
  const close = () => setMoreOpen(false);

  return (
    <nav
      aria-label="Điều hướng BTC"
      data-slot="bottom-tab-bar"
      className="fixed inset-x-0 bottom-0 z-40 bg-bar pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="grid h-tab-bar-height auto-cols-fr grid-flow-col">
        {tabs.map(({ key, label, icon }) => {
          const current = key === active;
          return (
            <li key={key} className="min-w-0">
              <Link
                href={organizationSectionPath(organization.id, key)}
                aria-current={current ? 'page' : undefined}
                className={tabClass(current)}
              >
                <TabLabel icon={icon} label={label} />
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger aria-current={activeInMore ? 'page' : undefined} className={tabClass(activeInMore)}>
              <TabLabel icon={Ellipsis} label="Thêm" />
            </SheetTrigger>
            <SheetContent side="bottom" data-slot="bottom-tab-bar-sheet">
              <SheetHeader>
                <SheetTitle>Thêm</SheetTitle>
                <SheetDescription className="sr-only">Các mục khác của BTC và đổi BTC.</SheetDescription>
              </SheetHeader>
              <ul className="flex flex-col gap-0.5">
                {more.map(({ key, label, icon: Icon }) => {
                  const current = key === active;
                  return (
                    <li key={key}>
                      <Link
                        href={organizationSectionPath(organization.id, key)}
                        aria-current={current ? 'page' : undefined}
                        onClick={close}
                        className={cn(
                          'flex min-h-12 items-center gap-3 rounded-md px-3 text-label hover:bg-accent',
                          current && 'bg-accent font-bold',
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn('size-5 shrink-0', current ? 'text-brand-text' : 'text-muted-foreground')}
                        />
                        <span className="min-w-0 truncate">{label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <OrganizationSwitcher
                organization={organization}
                memberships={memberships}
                variant="sheet"
                onNavigate={close}
              />
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}
