import {
  ORGANIZATION_SECTION_SEGMENTS,
  OrganizationSection,
  organizationDashboardPath,
  Permission,
  Role,
  roleHasPermission,
} from '@tickee/contracts';
import { CalendarDays, Coins, Inbox, Landmark, ScanLine, Settings, Users, type LucideIcon } from 'lucide-react';

/*
 * Một nguồn duy nhất cho các mục điều hướng cấp BTC (UX-DR34): `dashboard-sidebar`, `bottom-tab-bar` và Sheet "Thêm"
 * cùng đọc danh sách này. Mục hiện hay ẩn suy ra từ ma trận quyền FR-4 trong contracts (`roleHasPermission`),
 * không viết tay: ma trận đổi thì điều hướng đổi theo.
 */

/** `sidebar`: ≥ md. `tab`: `bottom-tab-bar` (< md). `sheet`: Sheet "Thêm" của tab bar. */
export type NavPlacement = 'sidebar' | 'tab' | 'sheet';

/** Mục có trong điều hướng (trang tạo Sự kiện là trang con của Sự kiện, không phải một mục). */
export type NavSectionKey = Exclude<OrganizationSection, 'create-event'>;

export type NavSection = {
  key: NavSectionKey;
  label: string;
  icon: LucideIcon;
  /** Quyền cần có để thấy mục và mở trang của mục. */
  permission: Permission;
  placements: readonly NavPlacement[];
};

/** Thứ tự hiển thị: sidebar theo thứ tự này; tab bar và Sheet lọc theo `placements`. */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    key: 'events',
    label: 'Sự kiện',
    icon: CalendarDays,
    permission: Permission.EVENTS_MANAGE,
    placements: ['sidebar', 'tab'],
  },
  {
    key: 'review-queue',
    label: 'Cần xử lý',
    icon: Inbox,
    permission: Permission.REVIEW_QUEUE_HANDLE,
    placements: ['sidebar', 'tab'],
  },
  { key: 'token', label: 'Token', icon: Coins, permission: Permission.TOKEN_VIEW, placements: ['sidebar', 'sheet'] },
  {
    key: 'members',
    label: 'Thành viên',
    icon: Users,
    permission: Permission.MEMBERS_MANAGE,
    placements: ['sidebar', 'sheet'],
  },
  {
    key: 'payout-account',
    label: 'Tài khoản nhận tiền',
    icon: Landmark,
    permission: Permission.PAYOUT_ACCOUNT_MANAGE,
    placements: ['sidebar', 'sheet'],
  },
  { key: 'settings', label: 'Cài đặt', icon: Settings, permission: Permission.ORG_READ, placements: ['sidebar', 'sheet'] },
  { key: 'scan', label: 'Quét vé', icon: ScanLine, permission: Permission.CHECKIN_SCAN, placements: ['tab'] },
];

export function navSection(key: NavSectionKey): NavSection {
  const section = NAV_SECTIONS.find((s) => s.key === key);
  if (!section) throw new Error(`Không có mục điều hướng "${key}"`);
  return section;
}

/** Mục chỉ dành cho Owner: Admin không có quyền của mục theo ma trận FR-4. */
export const isOwnerOnly = (section: NavSection): boolean => !roleHasPermission(Role.ADMIN, section.permission);

/** Các mục vai `role` được thấy ở `placement`, theo thứ tự khai báo. Mục không đủ quyền bị ẩn (không render). */
export function visibleSections(role: Role, placement: NavPlacement): NavSection[] {
  return NAV_SECTIONS.filter((s) => s.placements.includes(placement) && roleHasPermission(role, s.permission));
}

/** Mục đang chọn theo pathname. `/btc/{id}` và mọi trang dưới `/btc/{id}/su-kien` thuộc "Sự kiện". */
export function activeSection(organizationId: string, pathname: string): NavSectionKey | null {
  const base = organizationDashboardPath(organizationId);
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const rest = pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
  if (rest === '' || rest === 'su-kien' || rest.startsWith('su-kien/')) return 'events';
  const match = NAV_SECTIONS.find((s) => {
    const segment = ORGANIZATION_SECTION_SEGMENTS[s.key];
    return segment !== '' && (rest === segment || rest.startsWith(`${segment}/`));
  });
  return match?.key ?? null;
}

const ROLE_LABELS: Readonly<Record<Role, string>> = { owner: 'Owner', admin: 'Admin' };

export const roleLabel = (role: Role): string => ROLE_LABELS[role];

/** Chữ cái đầu của tên BTC cho avatar (giữ dấu tiếng Việt, vd. "Đ"). */
export function organizationInitial(name: string): string {
  const first = Array.from(name.trim().normalize('NFC'))[0];
  return first ? first.toLocaleUpperCase('vi') : '?';
}
