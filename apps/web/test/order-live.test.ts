import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearOrderMoment,
  hasOrderMoment,
  INITIAL_MOMENT,
  isWaiting,
  LONG_WAIT_MS,
  markOrderMoment,
  nextMoment,
  ORDER_WAITING_POLL_MS,
  orderPollInterval,
} from '@/lib/order/live';

/*
 * Trang Đơn tự cập nhật (Story 3.7): polling theo `buyerStatus`, ngưỡng chờ lâu, "khoảnh khắc" Thành công chỉ khi thấy
 * Đơn chuyển `paid` hoặc có cờ một lần. Màn hình được kiểm bằng Playwright (`e2e/order-live.spec.ts`).
 */

describe('orderPollInterval', () => {
  it('2 giây khi awaiting_payment/confirming; trạng thái khác, lạ hay chưa có Đơn → không polling', () => {
    expect(ORDER_WAITING_POLL_MS).toBe(2_000);
    expect(orderPollInterval({ buyerStatus: 'awaiting_payment' })).toBe(2_000);
    expect(orderPollInterval({ buyerStatus: 'confirming' })).toBe(2_000);
    for (const buyerStatus of ['paid', 'expired', 'under_review', 'cancelled_by_organizer', 'event_cancelled', 'loai_moi']) {
      expect(orderPollInterval({ buyerStatus }), buyerStatus).toBe(false);
      expect(isWaiting(buyerStatus)).toBe(false);
    }
    expect(orderPollInterval(undefined)).toBe(false);
    expect(LONG_WAIT_MS).toBe(120_000);
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
