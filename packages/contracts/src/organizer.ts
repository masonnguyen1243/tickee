import { z } from 'zod';

import { EmailAddress } from './identity.js';

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

/**
 * Ma trận quyền FR-4: vai → các quyền có. Owner có mọi quyền. Admin liệt kê tường minh (thiếu liên kết/đổi tài khoản
 * nhận tiền, mời/xóa thành viên, mua Token), để quyền mới thêm sau không tự thuộc về Admin.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  owner: Object.values(Permission),
  admin: [
    Permission.ORG_READ,
    Permission.TOKEN_VIEW,
    Permission.EVENTS_MANAGE,
    Permission.ORDERS_VIEW,
    Permission.REVIEW_QUEUE_HANDLE,
    Permission.CHECKERS_MANAGE,
    Permission.CHECKIN_SCAN,
    Permission.CHECKIN_LOOKUP,
  ],
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

/** Các mục cấp BTC của dashboard (khóa ổn định; nhãn và icon do web khai báo). */
export const OrganizationSection = {
  EVENTS: 'events',
  CREATE_EVENT: 'create-event',
  REVIEW_QUEUE: 'review-queue',
  TOKEN: 'token',
  MEMBERS: 'members',
  PAYOUT_ACCOUNT: 'payout-account',
  SETTINGS: 'settings',
  SCAN: 'scan',
} as const;
export type OrganizationSection = (typeof OrganizationSection)[keyof typeof OrganizationSection];

/** Đoạn đường dẫn của từng mục, sau `/btc/{id}`. Danh sách Sự kiện là chính trang đích. */
export const ORGANIZATION_SECTION_SEGMENTS: Readonly<Record<OrganizationSection, string>> = {
  events: '',
  'create-event': 'su-kien/tao',
  'review-queue': 'can-xu-ly',
  token: 'token',
  members: 'thanh-vien',
  'payout-account': 'tai-khoan-nhan-tien',
  settings: 'cai-dat',
  scan: 'quet-ve',
};

/** `/btc/{id}` (Sự kiện) hoặc `/btc/{id}/{đoạn của mục}`. */
export function organizationSectionPath(organizationId: string, section: OrganizationSection): string {
  const segment = ORGANIZATION_SECTION_SEGMENTS[section];
  const base = organizationDashboardPath(organizationId);
  return segment === '' ? base : `${base}/${segment}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Thành viên và lời mời Admin (FR-2, FR-4, Story 2.4)
// ---------------------------------------------------------------------------------------------------------------

/** Màn nhận lời mời của web; link trong email là `{WEB_ORIGIN}/loi-moi-btc#{token}` (token sau `#`, không tới server). */
export const ORGANIZATION_INVITATION_PATH = '/loi-moi-btc';
/** Lời mời hết hạn sau chừng này ngày kể từ lúc mời (như link CTV, AD-30). */
export const ORGANIZATION_INVITATION_TTL_DAYS = 7;
/** Mỗi BTC tạo tối đa chừng này lời mời mới trong 24 giờ trượt (kể cả lời mời đã thu hồi). */
export const ORGANIZATION_INVITATION_DAILY_LIMIT = 20;

/** `POST /v1/orgs/:orgId/invitations`: mời một email làm Admin. Email chuẩn hóa (trim, chữ thường). */
export const InviteAdminRequest = z.object({ email: EmailAddress });
export type InviteAdminRequest = z.input<typeof InviteAdminRequest>;

/**
 * Lời mời đang chờ (chưa nhận, chưa thu hồi), cũng là kết quả `POST /v1/orgs/:orgId/invitations` (201).
 * `expired` do api tính theo giờ server: lời mời quá hạn vẫn nằm trong danh sách chờ (hiện "Đã hết hạn") tới khi bị
 * thu hồi hoặc mời lại.
 */
export const OrganizationInvitation = z.object({
  id: z.uuid(),
  email: z.string(),
  expiresAt: z.iso.datetime(),
  expired: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type OrganizationInvitation = z.infer<typeof OrganizationInvitation>;

/** Một thành viên BTC. `id` là id dòng thành viên (dùng để xóa), không phải id tài khoản. */
export const OrganizationMember = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  role: roleSchema,
  email: z.string(),
  /** Tên hiển thị (Google); rỗng với tài khoản đăng nhập OTP. */
  name: z.string(),
  joinedAt: z.iso.datetime(),
});
export type OrganizationMember = z.infer<typeof OrganizationMember>;

/** `GET /v1/orgs/:orgId/members` (chỉ Owner): Owner trước, rồi Admin theo thời điểm tham gia; lời mời mới nhất trước. */
export const MemberList = z.object({
  members: z.array(OrganizationMember),
  invitations: z.array(OrganizationInvitation),
});
export type MemberList = z.infer<typeof MemberList>;

/**
 * Body `POST /v1/org-invitations/preview` và `POST /v1/org-invitations/accept`: token lấy từ `#` của link. Token không
 * bao giờ nằm trong đường dẫn hay query của request.
 */
export const InvitationTokenRequest = z.object({ token: z.string().min(1).max(256) });
export type InvitationTokenRequest = z.input<typeof InvitationTokenRequest>;

/** `POST /v1/org-invitations/preview` (công khai): lời mời còn dùng được thì trả tên BTC. */
export const InvitationPreview = z.object({ organizationName: z.string() });
export type InvitationPreview = z.infer<typeof InvitationPreview>;

/** `POST /v1/org-invitations/accept`: tài khoản đang đăng nhập đã là Admin của BTC. Nhận lại lần nữa vẫn trả kết quả này. */
export const AcceptedInvitation = z.object({
  organizationId: z.uuid(),
  organizationName: z.string(),
  role: z.literal(Role.ADMIN),
});
export type AcceptedInvitation = z.infer<typeof AcceptedInvitation>;

/** `details` của lỗi `INVITATION_EMAIL_MISMATCH`: email lời mời đã che (vd. `a***@vidu.vn`). */
export const InvitationEmailMismatchDetails = z.object({ maskedEmail: z.string() });
export type InvitationEmailMismatchDetails = z.infer<typeof InvitationEmailMismatchDetails>;

/** Che email để hiện cho người mở link: giữ ký tự đầu của phần trước `@` và nguyên tên miền (`an@vidu.vn` → `a***@vidu.vn`). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${Array.from(email)[0]}***${email.slice(at)}`;
}

// ---------------------------------------------------------------------------------------------------------------
// Tài khoản nhận tiền (FR-5, AD-6, AD-7, AD-9, Story 2.6): BTC dùng tài khoản merchant Tingee của chính mình
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ngân hàng không được chọn làm tài khoản nhận tiền (AD-6): VietinBank không trả nội dung chuyển khoản. Tài khoản của
 * các ngân hàng này vẫn hiện trong danh sách (mờ, "Chưa hỗ trợ VietinBank"); server từ chối với `BANK_NOT_SUPPORTED`.
 */
export const BLOCKED_BANK_BINS = ['970415'] as const;

export function isBlockedBankBin(bin: string): boolean {
  return (BLOCKED_BANK_BINS as readonly string[]).includes(bin);
}

/**
 * Đường dẫn nhận IPN của Tingee trên api (AD-7, Story 3.5). URL IPN của một BTC là
 * `{API_PUBLIC_URL}{TINGEE_IPN_PATH}/{ipnKey}`; `ipnKey` ngẫu nhiên 128 bit (base64url), không phải secret.
 */
export const TINGEE_IPN_PATH = '/v1/payments/tingee/ipn';

/** URL IPN riêng của BTC để dán vào "Đường dẫn IPN" trên portal Tingee. */
export function tingeeIpnUrl(apiPublicUrl: string, ipnKey: string): string {
  return `${apiPublicUrl}${TINGEE_IPN_PATH}/${encodeURIComponent(ipnKey)}`;
}

/** Client ID ngắn hơn chừng này ký tự thì không lộ ký tự nào. */
const CLIENT_ID_MASK_MIN_LENGTH = 8;

/** Client ID hiển thị dạng che: `••••` + 4 ký tự cuối (`••••` khi Client ID quá ngắn để che). */
export function maskTingeeClientId(clientId: string): string {
  const chars = Array.from(clientId);
  return chars.length >= CLIENT_ID_MASK_MIN_LENGTH ? `••••${chars.slice(-4).join('')}` : '••••';
}

/** Độ dài tối đa của Client ID và Secret Token nhận từ form (sau khi bỏ khoảng trắng hai đầu). */
export const TINGEE_KEY_MAX_LENGTH = 512;

/**
 * `POST /v1/orgs/:orgId/payout-account/credential` (chỉ Owner): kết nối tài khoản merchant Tingee của BTC bằng API key
 * lấy trên portal Tingee. Bỏ khoảng trắng hai đầu (hay dính khi dán).
 */
export const ConnectTingeeRequest = z.object({
  clientId: z.string().trim().min(1).max(TINGEE_KEY_MAX_LENGTH),
  secretToken: z.string().trim().min(1).max(TINGEE_KEY_MAX_LENGTH),
});
export type ConnectTingeeRequest = z.input<typeof ConnectTingeeRequest>;

/**
 * `POST /v1/orgs/:orgId/payout-account` (chỉ Owner): thêm một tài khoản trong danh sách làm tài khoản nhận tiền. Tài
 * khoản đầu tiên của BTC tự thành mặc định. VA đang liên kết rồi → `PAYOUT_ACCOUNT_ALREADY_LINKED`.
 */
export const SelectPayoutAccountRequest = z.object({
  vaAccountNumber: z.string().trim().min(1).max(64),
});
export type SelectPayoutAccountRequest = z.input<typeof SelectPayoutAccountRequest>;

/** Credential Tingee hiện hành của BTC. Không bao giờ có Client ID đầy đủ hay Secret Token. */
export const TingeeCredentialSummary = z.object({
  id: z.uuid(),
  /** `maskTingeeClientId(clientId)`. */
  clientIdMasked: z.string(),
  connectedAt: z.iso.datetime(),
});
export type TingeeCredentialSummary = z.infer<typeof TingeeCredentialSummary>;

/**
 * Một tài khoản `active` (không phải chỉ-chi) của BTC trên Tingee. Không có số tài khoản đầy đủ: chỉ 4 số cuối.
 * `vaAccountNumber` là số Tingee dùng để nhận tiền (gửi lại khi chọn).
 */
export const PayoutAccountOption = z.object({
  vaAccountNumber: z.string(),
  bankBin: z.string(),
  bankName: z.string(),
  accountType: z.string(),
  accountLast4: z.string(),
  accountName: z.string(),
  /** `false` với ngân hàng trong `BLOCKED_BANK_BINS` (hiện mờ, không chọn được). */
  selectable: z.boolean(),
  /** VA này đang là tài khoản nhận tiền hiện hành của BTC (web hiện "Đã liên kết" thay cho nút). */
  linked: z.boolean(),
});
export type PayoutAccountOption = z.infer<typeof PayoutAccountOption>;

/**
 * Kết quả `POST …/payout-account/credential` và `GET …/payout-account/options`: danh sách tài khoản đọc từ Tingee bằng
 * credential hiện hành (rỗng khi BTC chưa liên kết tài khoản ngân hàng nào trên Tingee).
 */
export const PayoutAccountOptions = z.object({
  credential: TingeeCredentialSummary,
  accounts: z.array(PayoutAccountOption),
});
export type PayoutAccountOptions = z.infer<typeof PayoutAccountOptions>;

/**
 * Một tài khoản nhận tiền hiện hành của BTC (một VA trong tài khoản Tingee của BTC). Chỉ 4 số cuối số tài khoản. BTC
 * còn ít nhất một tài khoản thì có đúng một tài khoản `isDefault`: Đơn mới nhận tiền vào VA của tài khoản này (AD-6).
 */
export const PayoutAccount = z.object({
  id: z.uuid(),
  vaAccountNumber: z.string(),
  bankBin: z.string(),
  bankName: z.string(),
  accountType: z.string(),
  accountLast4: z.string(),
  accountName: z.string(),
  isDefault: z.boolean(),
  linkedAt: z.iso.datetime(),
});
export type PayoutAccount = z.infer<typeof PayoutAccount>;

/**
 * `GET /v1/orgs/:orgId/payout-account` (chỉ Owner, không gọi Tingee); cũng là kết quả của hủy liên kết và đặt mặc định.
 * Chưa kết nối → `credential` `null`; đã kết nối chưa chọn (hoặc đã hủy hết) → `accounts` rỗng; đã liên kết → cả hai.
 */
export const PayoutAccountOverview = z.object({
  credential: TingeeCredentialSummary.nullable(),
  /** Tài khoản nhận tiền hiện hành, theo thứ tự liên kết (sớm nhất trước). */
  accounts: z.array(PayoutAccount),
  /**
   * Gửi key Tingee (lần đầu hoặc "Dùng key khác") còn được nhận: chỉ khi BTC chưa từng liên kết tài khoản nào, kể cả
   * tài khoản đã hủy. Từ đó về sau đổi key là thao tác riêng (Story 2.13).
   */
  canReplaceKey: z.boolean(),
  /** URL IPN riêng của BTC (`tingeeIpnUrl`); `null` khi BTC chưa từng kết nối Tingee. */
  ipnUrl: z.string().nullable(),
  /** Portal Tingee ứng với môi trường Tingee mà api đang gọi (UAT hoặc thật). */
  tingeePortalUrl: z.string(),
});
export type PayoutAccountOverview = z.infer<typeof PayoutAccountOverview>;
