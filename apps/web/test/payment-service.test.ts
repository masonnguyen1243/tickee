import { PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS, PaymentServiceCheckOutcome, PaymentServiceReason } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import {
  PAYMENT_SERVICE_GUIDE,
  PAYMENT_SERVICE_REASON_LABEL,
  PAYMENT_SERVICE_REASON_TEXT,
  paymentServiceCheckToast,
} from '@/lib/organizer/payment-service';

/*
 * Câu chữ dịch vụ thanh toán bị ngắt (Story 4.2-b, Mason chốt 13/11/2026): toast "Kiểm tra lại" theo `outcome`, hướng dẫn
 * và nhãn theo lý do. Khối và tab Quản trị được kiểm bằng Playwright.
 */

describe('toast "Kiểm tra lại" theo outcome', () => {
  it('đúng câu cho mỗi outcome; cooldown kèm số giây còn chờ', () => {
    const toast = (outcome: string, retryAfterSeconds: number | null = null) =>
      paymentServiceCheckToast({ outcome: outcome as PaymentServiceCheckOutcome, retryAfterSeconds });
    expect(toast('resumed')).toEqual({
      kind: 'success',
      message: 'Dịch vụ thanh toán đã hoạt động lại. Sự kiện có phí bán lại bình thường.',
    });
    expect(toast('still_suspended')).toEqual({ kind: 'warning', message: 'Tingee vẫn đang ngắt dịch vụ thanh toán.' });
    expect(toast('unknown')).toEqual({ kind: 'warning', message: 'Chưa kiểm tra được với Tingee. Thử lại sau ít phút.' });
    expect(toast('no_target')).toEqual({ kind: 'warning', message: 'BTC chưa có tài khoản nhận tiền mặc định.' });
    expect(toast('cooldown', 12)).toEqual({ kind: 'info', message: 'Vừa kiểm tra xong. Thử lại sau 12 giây.' });
    expect(toast('not_suspended')).toEqual({ kind: 'info', message: 'Dịch vụ thanh toán đang hoạt động.' });
    // Phòng hờ api không gửi số giây: dùng cả thời gian chờ.
    expect(toast('cooldown').message).toBe(`Vừa kiểm tra xong. Thử lại sau ${PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS} giây.`);
    // Mọi outcome đều có câu (thiếu nhánh thì lỗi typecheck và test này).
    for (const outcome of Object.values(PaymentServiceCheckOutcome)) {
      expect(toast(outcome, 5).message.length, outcome).toBeGreaterThan(0);
    }
  });
});

describe('câu theo lý do', () => {
  it('mỗi lý do có câu lý do, hướng dẫn và nhãn Quản trị', () => {
    for (const reason of Object.values(PaymentServiceReason)) {
      expect(PAYMENT_SERVICE_REASON_TEXT[reason].length, reason).toBeGreaterThan(0);
      expect(PAYMENT_SERVICE_GUIDE[reason].length, reason).toBeGreaterThan(0);
      expect(PAYMENT_SERVICE_REASON_LABEL[reason].length, reason).toBeGreaterThan(0);
    }
    expect(PAYMENT_SERVICE_REASON_LABEL).toEqual({
      token: 'Hết Token',
      tingee_disabled: 'Tingee ngắt dịch vụ',
      credential_invalid: 'Key không còn dùng được',
      gateway_permission_missing: 'Key thiếu quyền Cổng thanh toán',
    });
    expect(PAYMENT_SERVICE_GUIDE.token).toBe('Mua thêm Token trên portal Tingee rồi bấm Kiểm tra lại.');
    expect(PAYMENT_SERVICE_GUIDE.tingee_disabled).toBe(
      'Liên hệ Tingee để mở lại dịch vụ. Tickee tự kiểm tra mỗi 5 phút; bạn cũng có thể bấm Kiểm tra lại.',
    );
    expect(PAYMENT_SERVICE_GUIDE.credential_invalid).toBe(
      'Key có thể đã bị thu hồi hoặc đổi trên Tingee. Đổi key Tingee để bán lại.',
    );
    expect(PAYMENT_SERVICE_GUIDE.gateway_permission_missing).toContain('Tickee không tự kiểm tra được quyền này');
  });
});
