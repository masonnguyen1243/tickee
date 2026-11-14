import {
  PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS,
  PaymentServiceCheckOutcome,
  type PaymentServiceCheckResult,
  type PaymentServiceReason,
} from '@tickee/contracts';

/*
 * Câu chữ của dịch vụ thanh toán bị ngắt (Story 4.2-b, Mason chốt 13/11/2026): khối "Dịch vụ thanh toán" ở trang Tài khoản
 * nhận tiền, toast của "Kiểm tra lại" và nhãn lý do ở tab "Tạm ngừng bán" của Quản trị Tingee. Hàm thuần, kiểm bằng
 * Vitest môi trường node.
 */

/** Câu lý do đầu khối "Dịch vụ thanh toán" (cùng ý với tiêu đề banner của mã tương ứng). */
export const PAYMENT_SERVICE_REASON_TEXT: Readonly<Record<PaymentServiceReason, string>> = {
  token: 'Tingee báo đã hết Token (gói dịch vụ hết hạn).',
  tingee_disabled: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC.',
  credential_invalid: 'Key Tingee không còn dùng được.',
  gateway_permission_missing: 'Key Tingee chưa được cấp quyền Cổng thanh toán.',
};

/** Hậu quả, chung cho mọi lý do. */
export const PAYMENT_SERVICE_CONSEQUENCE = 'Mọi Sự kiện có phí đang Tạm ngừng bán.';

/** Hướng dẫn theo lý do (khối "Dịch vụ thanh toán"); liên kết hay nút kèm theo do khối quyết. */
export const PAYMENT_SERVICE_GUIDE: Readonly<Record<PaymentServiceReason, string>> = {
  token: 'Mua thêm Token trên portal Tingee rồi bấm Kiểm tra lại.',
  tingee_disabled:
    'Liên hệ Tingee để mở lại dịch vụ. Tickee tự kiểm tra mỗi 5 phút; bạn cũng có thể bấm Kiểm tra lại.',
  credential_invalid: 'Key có thể đã bị thu hồi hoặc đổi trên Tingee. Đổi key Tingee để bán lại.',
  gateway_permission_missing:
    'Cấp quyền “Cổng thanh toán” cho key trên portal Tingee rồi bấm Kiểm tra lại. Tickee không tự kiểm tra được quyền này; nếu vẫn thiếu, lần bán vé kế tiếp sẽ tạm ngừng lại.',
};

/** Nhãn ngắn của lý do (cột "Lý do" ở tab "Tạm ngừng bán" của Quản trị Tingee). */
export const PAYMENT_SERVICE_REASON_LABEL: Readonly<Record<PaymentServiceReason, string>> = {
  token: 'Hết Token',
  tingee_disabled: 'Tingee ngắt dịch vụ',
  credential_invalid: 'Key không còn dùng được',
  gateway_permission_missing: 'Key thiếu quyền Cổng thanh toán',
};

export type CheckToast = { kind: 'success' | 'info' | 'warning'; message: string };

/** Toast của "Kiểm tra lại" theo `outcome` (`cooldown` kèm số giây còn chờ). */
export function paymentServiceCheckToast(
  result: Pick<PaymentServiceCheckResult, 'outcome' | 'retryAfterSeconds'>,
): CheckToast {
  switch (result.outcome) {
    case PaymentServiceCheckOutcome.RESUMED:
      return {
        kind: 'success',
        message: 'Dịch vụ thanh toán đã hoạt động lại. Sự kiện có phí bán lại bình thường.',
      };
    case PaymentServiceCheckOutcome.STILL_SUSPENDED:
      return { kind: 'warning', message: 'Tingee vẫn đang ngắt dịch vụ thanh toán.' };
    case PaymentServiceCheckOutcome.UNKNOWN:
      return { kind: 'warning', message: 'Chưa kiểm tra được với Tingee. Thử lại sau ít phút.' };
    case PaymentServiceCheckOutcome.NO_TARGET:
      return { kind: 'warning', message: 'BTC chưa có tài khoản nhận tiền mặc định.' };
    case PaymentServiceCheckOutcome.COOLDOWN:
      return {
        kind: 'info',
        message: `Vừa kiểm tra xong. Thử lại sau ${result.retryAfterSeconds ?? PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS} giây.`,
      };
    case PaymentServiceCheckOutcome.NOT_SUSPENDED:
      return { kind: 'info', message: 'Dịch vụ thanh toán đang hoạt động.' };
  }
}
