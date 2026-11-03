import { ErrorCode } from '@tickee/contracts';

/*
 * Bảng mã lỗi Tingee → mã lỗi miền (`@tickee/contracts`). Chỉ mô-đun `tingee` biết mã Tingee. Mã không có trong bảng
 * (kể cả 1001, 1102, 1131 và mã mới Tingee thêm sau) là `PAYMENT_PROVIDER_UNAVAILABLE`.
 */

/** Lỗi miền có thể đến từ Tingee. */
export type TingeeDomainError =
  | typeof ErrorCode.PAYOUT_ACCOUNT_INVALID
  | typeof ErrorCode.BANK_NOT_SUPPORTED
  | typeof ErrorCode.PAYOUT_ACCOUNT_IN_USE
  | typeof ErrorCode.BANK_OTP_INVALID
  | typeof ErrorCode.BANK_OTP_EXPIRED
  | typeof ErrorCode.MERCHANT_SUSPENDED
  | typeof ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE;

const TABLE: ReadonlyArray<readonly [TingeeDomainError, readonly string[]]> = [
  [ErrorCode.PAYOUT_ACCOUNT_INVALID, ['400', '1043', '1057', '1083', '1084', '1130', '1011']],
  [ErrorCode.BANK_NOT_SUPPORTED, ['1021', '1041', '1051', '1059', '1063']],
  [ErrorCode.PAYOUT_ACCOUNT_IN_USE, ['1022', '1048', '1049', '1081']],
  [ErrorCode.BANK_OTP_INVALID, ['1078', '1134']],
  [ErrorCode.BANK_OTP_EXPIRED, ['1065', '1080', '1098']],
  [ErrorCode.MERCHANT_SUSPENDED, ['1007', '1034']],
  [ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, ['500', '1001', '1102', '1131']],
];

export const TINGEE_ERROR_CODES: ReadonlyMap<string, TingeeDomainError> = new Map(
  TABLE.flatMap(([domain, codes]) => codes.map((code) => [code, domain] as const)),
);

/** Mã Tingee (`code` của phản hồi, khác `'00'`) → lỗi miền. */
export function domainErrorOf(tingeeCode: string): TingeeDomainError {
  return TINGEE_ERROR_CODES.get(tingeeCode) ?? ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE;
}

/** Thông điệp tiếng Việt nói người dùng làm được gì; `field` là trường form nghi sai (nếu biết). */
export const DOMAIN_ERROR_INFO: Readonly<Record<TingeeDomainError, { message: string; field?: string }>> = {
  PAYOUT_ACCOUNT_INVALID: {
    message: 'Ngân hàng chưa xác nhận được thông tin tài khoản. Kiểm tra số tài khoản, tên chủ tài khoản, CCCD và SĐT rồi thử lại.',
  },
  BANK_NOT_SUPPORTED: { message: 'Ngân hàng này chưa được hỗ trợ. Chọn ngân hàng khác.', field: 'bankBin' },
  PAYOUT_ACCOUNT_IN_USE: {
    message: 'Tài khoản này đã được liên kết ở nơi khác. Dùng tài khoản khác hoặc liên hệ Tingee.',
    field: 'accountNumber',
  },
  BANK_OTP_INVALID: { message: 'Mã OTP chưa đúng. Kiểm tra tin nhắn ngân hàng rồi nhập lại.', field: 'otp' },
  BANK_OTP_EXPIRED: { message: 'Mã OTP đã hết hạn. Bấm "Gửi lại" để nhận mã mới.', field: 'otp' },
  MERCHANT_SUSPENDED: { message: 'Tài khoản Tingee của BTC đang tạm khóa. Liên hệ Tingee để được hỗ trợ.' },
  PAYMENT_PROVIDER_UNAVAILABLE: { message: 'Tingee tạm lỗi, thử lại sau ít phút.' },
};
