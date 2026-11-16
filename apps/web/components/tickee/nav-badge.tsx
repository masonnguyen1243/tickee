import { navBadgeLabel } from '@/lib/organizer/nav';
import { cn } from '@/lib/utils';

/**
 * Badge số của mục điều hướng (Story 4.3, DESIGN.md › bottom-tab-bar: nền `brand`, chữ `on-brand`; chỉ trên nền tối của
 * sidebar và tab bar). 0 hoặc chưa tải → không render; trên 99 → "99+". `aria-hidden`: số đã nằm trong tên truy cập của
 * mục (`navAccessibleName`).
 */
export function NavBadge({ count, className }: { count: number | undefined; className?: string }) {
  const label = navBadgeLabel(count);
  if (label === null) return null;
  return (
    <span
      aria-hidden="true"
      data-slot="nav-badge"
      className={cn(
        'inline-flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-none font-bold text-primary-foreground tabular-nums',
        className,
      )}
    >
      {label}
    </span>
  );
}
