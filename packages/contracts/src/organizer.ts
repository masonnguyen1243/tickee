import { z } from 'zod';

/** Vai trò của thành viên trong một BTC (FR-4). CTV (`checkin`) không phải thành viên BTC. */
export const Role = {
  OWNER: 'owner',
  ADMIN: 'admin',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const roleSchema = z.enum(Role);

/**
 * Quyền trên một BTC (FR-4) — khai báo một lần ở đây; api gắn bằng `@RequirePermission(...)`.
 * Route BTC mới dùng một quyền trong danh sách này (thêm quyền mới thì cập nhật `ROLE_PERMISSIONS`).
 */
export const Permission = {
  ORG_READ: 'org.read',
  MEMBERS_MANAGE: 'members.manage',
  PAYOUT_ACCOUNT_MANAGE: 'payout_account.manage',
  TOKEN_VIEW: 'token.view',
  TOKEN_PURCHASE: 'token.purchase',
  EVENTS_MANAGE: 'events.manage',
  ORDERS_VIEW: 'orders.view',
  REVIEW_QUEUE_HANDLE: 'review_queue.handle',
  CHECKERS_MANAGE: 'checkers.manage',
  CHECKIN_SCAN: 'checkin.scan',
  CHECKIN_LOOKUP: 'checkin.lookup',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const permissionSchema = z.enum(Permission);

const ALL_PERMISSIONS = Object.values(Permission);

/** Chỉ Owner: liên kết/đổi tài khoản nhận tiền, mời/xóa thành viên, mua Token. */
const OWNER_ONLY: readonly Permission[] = [
  Permission.MEMBERS_MANAGE,
  Permission.PAYOUT_ACCOUNT_MANAGE,
  Permission.TOKEN_PURCHASE,
];

/** Ma trận quyền FR-4: vai → các quyền có. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p)),
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Tên BTC: bỏ khoảng trắng hai đầu, 1–100 ký tự. */
export const ORGANIZATION_NAME_MAX = 100;
export const OrganizationName = z.string().trim().min(1).max(ORGANIZATION_NAME_MAX);

/**
 * SĐT liên hệ BTC: bỏ khoảng trắng, dấu chấm, gạch ngang; `+84` đầu số đổi thành `0` (một dạng lưu duy nhất),
 * rồi khớp `0xxxxxxxxx`. `+84 901 234 567`, `0901.234.567`, `0901-234-567` → `0901234567`.
 */
export const CONTACT_PHONE_PATTERN = /^0\d{9}$/;
export const ContactPhone = z
  .string()
  .transform((s) => s.replace(/[\s.-]+/g, '').replace(/^\+84/, '0'))
  .pipe(z.string().regex(CONTACT_PHONE_PATTERN));

/** Email liên hệ BTC: bỏ khoảng trắng hai đầu, chữ thường. */
export const ContactEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Ô liên hệ tùy chọn: thiếu, `null` hoặc chuỗi trống (chỉ khoảng trắng) đều là "không có" → `null`. */
const optionalContact = <S extends z.ZodType<string, string>>(schema: S) =>
  z
    .union([z.string().regex(/^\s*$/).transform(() => null), schema])
    .nullish()
    .transform((v) => v ?? null);

/** `POST /v1/orgs` */
export const CreateOrganizationRequest = z.object({
  name: OrganizationName,
  contactPhone: optionalContact(ContactPhone),
  contactEmail: optionalContact(ContactEmail),
});
export type CreateOrganizationRequest = z.input<typeof CreateOrganizationRequest>;

/** Kết quả `POST /v1/orgs` (201): người tạo là Owner. */
export const CreatedOrganization = z.object({
  id: z.uuid(),
  name: z.string(),
  role: roleSchema,
});
export type CreatedOrganization = z.infer<typeof CreatedOrganization>;

/** `GET /v1/orgs/:orgId` — `role` là vai của người gọi ở BTC này. */
export const Organization = z.object({
  id: z.uuid(),
  name: z.string(),
  role: roleSchema,
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Organization = z.infer<typeof Organization>;

/** Một phần tử của `GET /v1/me/memberships` (không có kênh liên hệ). */
export const Membership = z.object({
  organizationId: z.uuid(),
  name: z.string(),
  role: roleSchema,
});
export type Membership = z.infer<typeof Membership>;

/** `GET /v1/me/memberships`: theo thời điểm tham gia tăng dần. */
export const MembershipList = z.array(Membership);
export type MembershipList = z.infer<typeof MembershipList>;

/** Màn tạo BTC của web. */
export const CREATE_ORGANIZATION_PATH = '/tao-btc';
/** Trang đích dashboard của một BTC. */
export const organizationDashboardPath = (organizationId: string): string => `/btc/${organizationId}`;
