import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearOrderMoment,
  hasOrderMoment,
  INITIAL_MOMENT,
  isWaiting,
  LONG_WAIT_MS,
  markOrderMoment,
  nextMoment,
  ORDER_LATE_PAYMENT_POLL_MS,
  ORDER_LATE_PAYMENT_WINDOW_MS,
  ORDER_WAITING_POLL_MS,
  orderPollInterval,
} from '@/lib/order/live';

/*
 * Trang Đơn tự cập nhật (Story 3.7): polling theo `buyerStatus`, ngưỡng chờ lâu, "khoảnh khắc" Thành công chỉ khi thấy
 * Đơn chuyển `paid` hoặc có cờ một lần. Màn hình được kiểm bằng Playwright (`e2e/order-live.spec.ts`).
 */

describe('orderPollInterval', () => {
  const expiresAt = '2026-11-13T03:15:00.000Z';
  const order = (buyerStatus: string, serverNow = '2026-11-13T03:10:00.000Z') => ({ buyerStatus, expiresAt, serverNow });
  /** Giờ máy chủ lệch `ms` so với `expiresAt`. */
  const afterExpiry = (ms: number) => new Date(Date.parse(expiresAt) + ms).toISOString();

  it('2 giây khi awaiting_payment/confirming; trạng thái khác (trừ expired), lạ hay chưa có Đơn → không polling', () => {
    expect(ORDER_WAITING_POLL_MS).toBe(2_000);
    expect(orderPollInterval(order('awaiting_payment'))).toBe(2_000);
    expect(orderPollInterval(order('confirming'))).toBe(2_000);
    for (const buyerStatus of ['paid', 'under_review', 'cancelled_by_organizer', 'event_cancelled', 'loai_moi']) {
      expect(orderPollInterval(order(buyerStatus)), buyerStatus).toBe(false);
      expect(isWaiting(buyerStatus)).toBe(false);
    }
    expect(isWaiting('expired')).toBe(false);
    expect(orderPollInterval(undefined)).toBe(false);
    expect(LONG_WAIT_MS).toBe(120_000);
  });

  it('Story 4.1: expired mà giờ máy chủ còn trước expiresAt + 24 giờ 15 phút → 30 giây (tiền về muộn qua Đối soát bù, kể cả lần tra lại của mốc cuối); từ mốc đó → không polling', () => {
    expect(ORDER_LATE_PAYMENT_POLL_MS).toBe(30_000);
    expect(ORDER_LATE_PAYMENT_WINDOW_MS).toBe((24 * 60 + 15) * 60 * 1000);
    // Mốc tra cuối (+ 24 giờ) và các lần tra lại của nó (tới + 7 phút) vẫn trong cửa sổ.
    expect(orderPollInterval(order('expired', afterExpiry(24 * 60 * 60 * 1000 + 7 * 60_000)))).toBe(30_000);
    // Hết hạn sớm (IPN expired trước expiresAt), vừa hết hạn, sát mốc cuối.
    expect(orderPollInterval(order('expired', afterExpiry(-5 * 60_000)))).toBe(30_000);
    expect(orderPollInterval(order('expired', afterExpiry(0)))).toBe(30_000);
    expect(orderPollInterval(order('expired', afterExpiry(ORDER_LATE_PAYMENT_WINDOW_MS - 1)))).toBe(30_000);
    expect(orderPollInterval(order('expired', afterExpiry(ORDER_LATE_PAYMENT_WINDOW_MS)))).toBe(false);
    expect(orderPollInterval(order('expired', afterExpiry(2 * ORDER_LATE_PAYMENT_WINDOW_MS)))).toBe(false);
  });
});

describe('nextMoment', () => {
  const after = (statuses: string[], flagged = false) =>
    statuses.reduce((state, status) => nextMoment(state, status, flagged), INITIAL_MOMENT);

  it('trang đang mở thấy Đơn chuyển sang paid → chạy', () => {
    expect(after(['awaiting_payment', 'paid']).moment).toBe(true);
    expect(after(['confirming', 'paid']).moment).toBe(true);
    expect(after(['under_review', 'paid']).moment).toBe(true);
  });

  it('vào trang lần đầu đã paid: chỉ chạy khi có cờ một lần', () => {
    expect(after(['paid']).moment).toBe(false);
    expect(after(['paid'], true).moment).toBe(true);
    expect(after(['awaiting_payment'], true).moment).toBe(false);
  });

  it('tải lại cùng trạng thái giữ nguyên state (cùng object); chưa paid thì không chạy', () => {
    const state = after(['awaiting_payment']);
    expect(nextMoment(state, 'awaiting_payment', false)).toBe(state);
    expect(after(['awaiting_payment', 'confirming', 'expired']).moment).toBe(false);
  });
});

describe('cờ một lần trong sessionStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đặt → đọc → xóa; theo từng mã Đơn', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });
    expect(hasOrderMoment('TK8F3Q2AXM')).toBe(false);
    markOrderMoment('TK8F3Q2AXM');
    expect(hasOrderMoment('TK8F3Q2AXM')).toBe(true);
    expect(hasOrderMoment('TKFREE2345')).toBe(false);
    clearOrderMoment('TK8F3Q2AXM');
    expect(hasOrderMoment('TK8F3Q2AXM')).toBe(false);
  });

  it('sessionStorage bị chặn (ném lỗi) → không ném, coi như không có cờ', () => {
    const blocked = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('window', { sessionStorage: { getItem: blocked, setItem: blocked, removeItem: blocked } });
    expect(() => markOrderMoment('TK8F3Q2AXM')).not.toThrow();
    expect(hasOrderMoment('TK8F3Q2AXM')).toBe(false);
    expect(() => clearOrderMoment('TK8F3Q2AXM')).not.toThrow();
  });
});
