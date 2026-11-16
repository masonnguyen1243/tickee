import {
  Permission,
  roleHasPermission,
  toEventIso,
  TOKEN_ALERT_THRESHOLD_MAX,
  TOKEN_ALERT_THRESHOLD_MIN,
  TokenAlertThreshold,
  type Role,
} from '@tickee/contracts';

/*
 * Trang Token (Story 4.5-a, 4.5-b, FR-34): định dạng số, giờ đọc, ô ngưỡng cảnh báo và nội dung theo vai. Hàm thuần,
 * kiểm bằng Vitest môi trường node; giờ luôn theo giờ Việt Nam (không theo múi giờ máy).
 */

export const TOKEN_AVAILABLE_LABEL = 'Token khả dụng';
export const TOKEN_AVAILABLE_CAPTION = 'Số dư + Hạn mức trả sau';
export const TOKEN_BALANCE_LABEL = 'Số dư';
export const TOKEN_CREDIT_LIMIT_LABEL = 'Hạn mức trả sau';
export const TOKEN_INTRO =
  'Token của BTC trên Tingee, đọc trực tiếp mỗi lần mở trang. Hết Token thì mọi Sự kiện có phí Tạm ngừng bán.';

export const TOKEN_UNAVAILABLE_TITLE = 'Chưa đọc được số dư';
export const TOKEN_UNAVAILABLE_DESCRIPTION = 'Tickee chưa đọc được số dư Token từ Tingee.';

export const TOKEN_NO_PAYOUT_ACCOUNT_TITLE = 'Chưa có tài khoản nhận tiền mặc định';
/** Owner: kèm nút tới trang Tài khoản nhận tiền. */
export const TOKEN_NO_PAYOUT_ACCOUNT_OWNER = 'Liên kết tài khoản nhận tiền để Tickee đọc được Token của BTC.';
export const TOKEN_NO_PAYOUT_ACCOUNT_ACTION = 'Tới Tài khoản nhận tiền';
export const TOKEN_NO_PAYOUT_ACCOUNT_ADMIN = 'Nhờ Owner liên kết tài khoản nhận tiền.';

export const TOKEN_PURCHASE_LABEL = 'Mua thêm Token';
export const TOKEN_PURCHASE_ADMIN = 'Chỉ Owner mua thêm Token.';
export const TOKEN_PURCHASE_NOTE = 'Token mua trên portal Tingee; Tickee không bán Token.';

/**
 * Số Token theo kiểu `vi-VN`: dấu chấm phân cách nghìn, số âm có dấu trừ (`1700` → "1.700", `-200` → "-200"). Tự chèn
 * dấu chấm như `formatVnd`: không phụ thuộc dữ liệu ICU của runtime.
 */
export function formatTokenCount(value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError(`formatTokenCount: cần số nguyên, nhận ${String(value)}`);
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return value < 0 ? `-${digits}` : digits;
}

/** "Đọc lúc HH:mm:ss" theo giờ Việt Nam của lần api đọc Token (`readAt`, đồng hồ server). */
export function tokenReadAtLabel(readAt: string): string {
  // `toEventIso`: `YYYY-MM-DDTHH:mm:ss+07:00`.
  return `Đọc lúc ${toEventIso(new Date(readAt)).slice(11, 19)}`;
}

/**
 * Khối "Mua thêm Token" theo vai: người mua được Token (Owner, `token.purchase`) có link portal Tingee (`link`); vai
 * khác thấy câu "Chỉ Owner mua thêm Token." (`owner_only`). Owner mà api không trả link (không nên xảy ra) → `none`.
 */
export type TokenPurchase = { kind: 'link'; href: string } | { kind: 'owner_only' } | { kind: 'none' };

export function tokenPurchaseOf(role: Role, tingeePortalUrl: string | undefined): TokenPurchase {
  if (!roleHasPermission(role, Permission.TOKEN_PURCHASE)) return { kind: 'owner_only' };
  return tingeePortalUrl ? { kind: 'link', href: tingeePortalUrl } : { kind: 'none' };
}

/** BTC chưa có tài khoản nhận tiền mặc định: vai liên kết được tài khoản (Owner) có nút tới trang Tài khoản nhận tiền. */
export const canLinkPayoutAccount = (role: Role): boolean => roleHasPermission(role, Permission.PAYOUT_ACCOUNT_MANAGE);

// ---------------------------------------------------------------------------------------------------------------
// Ngưỡng cảnh báo (Story 4.5-b)
// ---------------------------------------------------------------------------------------------------------------

export const TOKEN_ALERT_TITLE = 'Ngưỡng cảnh báo';
export const TOKEN_ALERT_INPUT_LABEL = 'Báo khi Token khả dụng dưới';
export const TOKEN_ALERT_HINT = 'Token khả dụng xuống dưới ngưỡng thì Owner nhận email và banner trên dashboard.';
export const TOKEN_ALERT_SAVE = 'Lưu';
export const TOKEN_ALERT_DISABLE = 'Tắt cảnh báo';
export const TOKEN_ALERT_SAVED = 'Đã lưu ngưỡng cảnh báo.';
export const TOKEN_ALERT_DISABLED = 'Đã tắt cảnh báo Token.';
export const TOKEN_ALERT_NOT_SET = 'Chưa đặt ngưỡng cảnh báo.';
export const TOKEN_ALERT_OWNER_ONLY = 'Chỉ Owner đặt ngưỡng cảnh báo.';
/** Lỗi tại ô: "Nhập số Token nguyên từ 1 đến 1.000.000.000.000.". */
export const TOKEN_ALERT_INVALID = `Nhập số Token nguyên từ ${formatTokenCount(TOKEN_ALERT_THRESHOLD_MIN)} đến ${formatTokenCount(TOKEN_ALERT_THRESHOLD_MAX)}.`;
/** Warning trên số của trang Token (cả hai vai) khi Token khả dụng đang dưới ngưỡng. */
export const TOKEN_BELOW_THRESHOLD_TITLE = 'Token khả dụng dưới ngưỡng cảnh báo.';

/** Admin xem ngưỡng: "Ngưỡng cảnh báo: 1.000 Token". */
export const tokenAlertThresholdLabel = (threshold: number): string =>
  `Ngưỡng cảnh báo: ${formatTokenCount(threshold)} Token`;

/** Vai đặt được ngưỡng cảnh báo (Owner, `token_alert.manage`). */
export const canManageTokenAlert = (role: Role): boolean => roleHasPermission(role, Permission.TOKEN_ALERT_MANAGE);

/**
 * Ô ngưỡng cảnh báo → số Token, hoặc `null` khi không hợp lệ. Nhận số nguyên viết liền (`1000`) hoặc có dấu chấm phân
 * cách nghìn kiểu Việt Nam (`1.000`, `1.000.000`), bỏ khoảng trắng hai đầu; phải trong khoảng 1…10^12.
 */
export function parseTokenAlertThreshold(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed) && !/^\d{1,3}(?:\.\d{3})+$/.test(trimmed)) return null;
  const parsed = TokenAlertThreshold.safeParse(Number(trimmed.replaceAll('.', '')));
  return parsed.success ? parsed.data : null;
}

/** Giá trị đầu của ô ngưỡng: ngưỡng đã lưu có dấu chấm phân cách, hoặc trống khi chưa đặt. */
export const tokenAlertInputOf = (threshold: number | null): string =>
  threshold === null ? '' : formatTokenCount(threshold);
