import { ErrorCode, PaymentServiceReason } from '@tickee/contracts';

/*
 * Bảng mã lỗi Tingee → mã lỗi miền (`@tickee/contracts`, AD-9). Chỉ mô-đun `tingee` biết mã Tingee. Dùng chung cho mọi
 * API Tingee (đọc danh sách tài khoản lúc kết nối của Story 2.6, `create-link` của Story 3.4). Mã không có trong bảng
 * (kể cả 90/91 lệch giờ, 1001, mã mới Tingee thêm sau) là `PAYMENT_PROVIDER_UNAVAILABLE`.
 */

/** Lỗi miền có thể đến từ Tingee. */
export type TingeeDomainError =
  | typeof ErrorCode.TINGEE_CREDENTIAL_INVALID
  | typeof ErrorCode.MERCHANT_SUSPENDED
  | typeof ErrorCode.PAYMENT_ACCOUNT_NOT_ALLOWED
  | typeof ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE;

const TABLE: ReadonlyArray<readonly [TingeeDomainError, readonly string[]]> = [
  // 92: Client ID không tồn tại hoặc bị khóa · 97: sai chữ ký (Secret Token sai) · 1009: không tìm thấy Merchant ·
  // 1133: key chưa được cấp quyền nhóm dịch vụ (vd. "Cổng thanh toán").
  [ErrorCode.TINGEE_CREDENTIAL_INVALID, ['92', '97', '1009', '1133']],
  // 1007, 1034: merchant bị khóa · 1033: gói dịch vụ đã hết hạn.
  [ErrorCode.MERCHANT_SUSPENDED, ['1007', '1033', '1034']],
  // 2023: VA chưa được cho phép trên Cổng thanh toán · 1023, 1045, 1024, 1072: nhóm lỗi VA (Mason chốt 10/11: đi nhánh
  // tạm ngừng bán, không thử lại).
  [ErrorCode.PAYMENT_ACCOUNT_NOT_ALLOWED, ['2023', '1023', '1045', '1024', '1072']],
];

export const TINGEE_ERROR_CODES: ReadonlyMap<string, TingeeDomainError> = new Map(
  TABLE.flatMap(([domain, codes]) => codes.map((code) => [code, domain] as const)),
);

/**
 * Mã "không tìm thấy đơn" của API tra đơn Gateway (hợp đồng tạm, Story 4.1; chờ Tingee xác nhận). Không phải lỗi miền:
 * `getGatewayOrder` trả `null`.
 */
export const TINGEE_ORDER_NOT_FOUND_CODE = '2004';

/** Mã Tingee (`code` của phản hồi, khác `'00'`) → lỗi miền. */
export function domainErrorOf(tingeeCode: string): TingeeDomainError {
  return TINGEE_ERROR_CODES.get(tingeeCode) ?? ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE;
}

/**
 * Mã Tingee → lý do ngắt dịch vụ thanh toán của BTC theo key (Story 4.2, AD-32; Mason chốt 13/11/2026): 1033 ("gói dịch
 * vụ đã hết hạn") → `token`; 1007, 1034 (merchant bị khóa) → `tingee_disabled`; 1133 (key chưa được cấp quyền "Cổng
 * thanh toán") → `gateway_permission_missing`; mã còn lại của `TINGEE_CREDENTIAL_INVALID` (92, 97, 1009) →
 * `credential_invalid`. Mã khác (kể cả nhóm VA `PAYMENT_ACCOUNT_NOT_ALLOWED`, mã lạ) → `null`. Lần dò
 * (`getMerchantServiceStatus`) dùng thẳng hàm này: nhóm VA ở lần dò là "không biết". `create-link` dùng
 * `createLinkServiceReasonOf` (thêm nhóm VA). Mã Token (1033) chờ Tingee xác nhận (`deferred-work.md`).
 */
export function paymentServiceReasonOf(tingeeCode: string): PaymentServiceReason | null {
  if (tingeeCode === '1033') return PaymentServiceReason.TOKEN;
  if (tingeeCode === '1133') return PaymentServiceReason.GATEWAY_PERMISSION_MISSING;
  switch (domainErrorOf(tingeeCode)) {
    case ErrorCode.MERCHANT_SUSPENDED:
      return PaymentServiceReason.TINGEE_DISABLED;
    case ErrorCode.TINGEE_CREDENTIAL_INVALID:
      return PaymentServiceReason.CREDENTIAL_INVALID;
    default:
      return null;
  }
}

/**
 * Mã Tingee của `create-link` → lý do ngắt dịch vụ thanh toán của BTC: như `paymentServiceReasonOf`, thêm nhóm VA
 * (`PAYMENT_ACCOUNT_NOT_ALLOWED`: 2023 VA chưa được cho phép trên Cổng thanh toán; 1023, 1045, 1024, 1072 VA lỗi) →
 * `payout_account_not_allowed` (quyết định của Mason 14/11/2026, Story 4.2-d). Chỉ `create-link` (gọi bằng VA của tài
 * khoản mặc định) biết VA bị từ chối.
 */
export function createLinkServiceReasonOf(tingeeCode: string): PaymentServiceReason | null {
  if (domainErrorOf(tingeeCode) === ErrorCode.PAYMENT_ACCOUNT_NOT_ALLOWED) {
    return PaymentServiceReason.PAYOUT_ACCOUNT_NOT_ALLOWED;
  }
  return paymentServiceReasonOf(tingeeCode);
}

/** Thông điệp tiếng Việt nói người dùng làm được gì. */
export const DOMAIN_ERROR_MESSAGES: Readonly<Record<TingeeDomainError, string>> = {
  TINGEE_CREDENTIAL_INVALID: 'Client ID hoặc Secret Token không đúng.',
  MERCHANT_SUSPENDED: 'Tài khoản Tingee của BTC đang tạm khóa. Liên hệ Tingee để được hỗ trợ.',
  PAYMENT_ACCOUNT_NOT_ALLOWED:
    'Tài khoản nhận tiền chưa được phép nhận thanh toán qua Cổng thanh toán. Kiểm tra cấu hình trên portal Tingee.',
  PAYMENT_PROVIDER_UNAVAILABLE: 'Tingee tạm lỗi, thử lại sau ít phút.',
};
