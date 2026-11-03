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
// Tài khoản nhận tiền (FR-5, AD-5, AD-6, Story 2.6)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Ngân hàng nhận liên kết tài khoản nhận tiền ở MVP (quyết định 03/11/2026): chỉ tài khoản cá nhân, chỉ 5 ngân hàng
 * dùng luồng form + OTP của Tingee. `bin` là mã BIN Napas 6 số; `name` là tên hiển thị trên dashboard.
 */
export const SUPPORTED_PAYOUT_BANKS = [
  { bin: '970418', name: 'BIDV' },
  { bin: '970422', name: 'MB' },
  { bin: '970416', name: 'ACB' },
  { bin: '970432', name: 'VPBank' },
  { bin: '970448', name: 'OCB' },
] as const satisfies readonly { bin: string; name: string }[];
export type PayoutBankBin = (typeof SUPPORTED_PAYOUT_BANKS)[number]['bin'];

/** Ngân hàng bị chặn ngay ở server (không gọi Tingee): VietinBank không trả nội dung chuyển khoản. */
export const BLOCKED_BANK_BINS = ['970415'] as const;

/** Ngân hàng của tài khoản nhận tiền được hỗ trợ (không bị chặn, có trong `SUPPORTED_PAYOUT_BANKS`). */
export function isSupportedPayoutBank(bin: string): bin is PayoutBankBin {
  return (
    !(BLOCKED_BANK_BINS as readonly string[]).includes(bin) && SUPPORTED_PAYOUT_BANKS.some((bank) => bank.bin === bin)
  );
}

/** Tên ngân hàng theo BIN; BIN lạ thì trả lại chính BIN. */
export function payoutBankName(bin: string): string {
  return SUPPORTED_PAYOUT_BANKS.find((bank) => bank.bin === bin)?.name ?? bin;
}

/** Loại tài khoản nhận tiền. MVP chỉ nhận tài khoản cá nhân. */
export const PayoutAccountType = { PERSONAL: 'personal-account' } as const;
export type PayoutAccountType = (typeof PayoutAccountType)[keyof typeof PayoutAccountType];

/**
 * Trạng thái một lần thử liên kết: `linking → awaiting_otp → linked` hoặc `failed`. Mỗi BTC có tối đa một dòng
 * `linked`. Dòng `linking` quá 5 phút (api dừng giữa chừng) được đọc như `failed`.
 */
export const PayoutAccountStatus = {
  LINKING: 'linking',
  AWAITING_OTP: 'awaiting_otp',
  LINKED: 'linked',
  FAILED: 'failed',
} as const;
export type PayoutAccountStatus = (typeof PayoutAccountStatus)[keyof typeof PayoutAccountStatus];

/** Số tài khoản: bỏ khoảng trắng, dấu chấm, gạch ngang; 6–20 chữ số. */
export const PayoutAccountNumber = z
  .string()
  .transform((s) => s.replace(/[\s.-]+/g, ''))
  .pipe(z.string().regex(/^\d{6,20}$/));

/**
 * Tên chủ tài khoản: in hoa, không dấu, như ngân hàng in. Bỏ dấu tiếng Việt (`Đ` → `D`), viết hoa, gộp khoảng trắng;
 * sau đó chỉ còn chữ A–Z và khoảng trắng, tối đa 100 ký tự. `Nguyễn Văn An` → `NGUYEN VAN AN`.
 */
export const PayoutAccountName = z
  .string()
  .transform((s) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'D')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim(),
  )
  .pipe(z.string().regex(/^[A-Z]+( [A-Z]+)*$/).max(100));

/** Số CCCD: 12 chữ số (bỏ khoảng trắng). Chỉ gửi Tingee, không bao giờ lưu. */
export const IdentityCardNumber = z
  .string()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{12}$/));

/** `POST /v1/orgs/:orgId/payout-account` (chỉ Owner): liên kết tài khoản cá nhân. */
export const LinkPayoutAccountRequest = z.object({
  /** BIN 6 số; BIN bị chặn hoặc không hỗ trợ → `BANK_NOT_SUPPORTED` (không phải `VALIDATION_FAILED`). */
  bankBin: z.string().regex(/^\d{6}$/),
  accountNumber: PayoutAccountNumber,
  accountName: PayoutAccountName,
  identityNumber: IdentityCardNumber,
  /** SĐT đăng ký Merchant con với Tingee: 10 số, bắt đầu bằng 0 (cùng chuẩn hóa với SĐT liên hệ BTC). */
  phone: ContactPhone,
});
export type LinkPayoutAccountRequest = z.input<typeof LinkPayoutAccountRequest>;

/** Mã OTP ngân hàng gửi qua SMS: 4–8 chữ số. */
export const BANK_OTP_PATTERN = /^\d{4,8}$/;

/** `POST /v1/orgs/:orgId/payout-account/otp` (chỉ Owner): xác nhận lần thử đang chờ OTP. */
export const ConfirmPayoutOtpRequest = z.object({
  attemptId: z.uuid(),
  otp: z
    .string()
    .transform((s) => s.replace(/\s+/g, ''))
    .pipe(z.string().regex(BANK_OTP_PATTERN)),
});
export type ConfirmPayoutOtpRequest = z.input<typeof ConfirmPayoutOtpRequest>;

/**
 * Một lần thử liên kết (hoặc tài khoản đang dùng khi `linked`). Không bao giờ có số tài khoản đầy đủ hay CCCD:
 * chỉ 4 số cuối. `vaAccountNumber` là số VA nhận tiền Tingee cấp khi đã liên kết. `failureCode` là mã lỗi miền.
 */
export const PayoutAccount = z.object({
  id: z.uuid(),
  status: z.enum(PayoutAccountStatus),
  bankBin: z.string(),
  accountType: z.enum(PayoutAccountType),
  accountLast4: z.string(),
  accountName: z.string(),
  vaAccountNumber: z.string().nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  linkedAt: z.iso.datetime().nullable(),
});
export type PayoutAccount = z.infer<typeof PayoutAccount>;

/**
 * `GET /v1/orgs/:orgId/payout-account` (chỉ Owner): tài khoản đang dùng nếu đã liên kết; chưa thì lần thử gần nhất
 * (đang chờ OTP, đang liên kết hoặc thất bại); chưa thử lần nào thì `null`.
 */
export const PayoutAccountOverview = z.object({ current: PayoutAccount.nullable() });
export type PayoutAccountOverview = z.infer<typeof PayoutAccountOverview>;
