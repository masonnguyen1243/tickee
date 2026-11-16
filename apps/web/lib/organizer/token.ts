import { Permission, roleHasPermission, toEventIso, type Role } from '@tickee/contracts';

/*
 * Trang Token (Story 4.5-a, FR-34): định dạng số, giờ đọc và nội dung theo vai. Hàm thuần, kiểm bằng Vitest môi trường
 * node; giờ luôn theo giờ Việt Nam (không theo múi giờ máy).
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
