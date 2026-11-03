import { ErrorCode } from '@tickee/contracts';

/*
 * Bảng mã lỗi Tingee → mã lỗi miền (`@tickee/contracts`, AD-9). Chỉ mô-đun `tingee` biết mã Tingee. Mã không có trong
 * bảng (kể cả 90/91 lệch giờ, 1001, mã mới Tingee thêm sau) là `PAYMENT_PROVIDER_UNAVAILABLE`.
 */

/** Lỗi miền có thể đến từ Tingee. */
export type TingeeDomainError =
  | typeof ErrorCode.TINGEE_CREDENTIAL_INVALID
  | typeof ErrorCode.MERCHANT_SUSPENDED
  | typeof ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE;

const TABLE: ReadonlyArray<readonly [TingeeDomainError, readonly string[]]> = [
  // 92: Client ID không tồn tại hoặc bị khóa · 97: sai chữ ký (Secret Token sai) · 1133: key chưa được cấp quyền.
  [ErrorCode.TINGEE_CREDENTIAL_INVALID, ['92', '97', '1133']],
  [ErrorCode.MERCHANT_SUSPENDED, ['1007', '1034']],
];

export const TINGEE_ERROR_CODES: ReadonlyMap<string, TingeeDomainError> = new Map(
  TABLE.flatMap(([domain, codes]) => codes.map((code) => [code, domain] as const)),
);

/** Mã Tingee (`code` của phản hồi, khác `'00'`) → lỗi miền. */
export function domainErrorOf(tingeeCode: string): TingeeDomainError {
  return TINGEE_ERROR_CODES.get(tingeeCode) ?? ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE;
}

/** Thông điệp tiếng Việt nói người dùng làm được gì. */
export const DOMAIN_ERROR_MESSAGES: Readonly<Record<TingeeDomainError, string>> = {
  TINGEE_CREDENTIAL_INVALID: 'Client ID hoặc Secret Token không đúng.',
  MERCHANT_SUSPENDED: 'Tài khoản Tingee của BTC đang tạm khóa. Liên hệ Tingee để được hỗ trợ.',
  PAYMENT_PROVIDER_UNAVAILABLE: 'Tingee tạm lỗi, thử lại sau ít phút.',
};
