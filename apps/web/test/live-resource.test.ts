import { ErrorCode } from '@tickee/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, invalidResponseError, isNetworkError, serviceUnavailableError } from '@/lib/api/errors';
import {
  createSignalCoalescer,
  effectivePollInterval,
  reopenDelay,
  SIGNAL_WINDOW_MS,
} from '@/lib/realtime/live-signal';

/*
 * Phần thuần của `useLiveResource` (Story 3.7, AD-17): gom lời nhắc tải lại trong 1 giây, chọn polling khi chưa có SSE,
 * độ trễ mở lại SSE. Hook và luồng SSE thật được kiểm bằng Playwright (`e2e/order-live.spec.ts`).
 */

describe('createSignalCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cửa sổ 1 giây', () => {
    expect(SIGNAL_WINDOW_MS).toBe(1_000);
  });

  it('tải ngay ở lời nhắc đầu; các lời nhắc trong 1 giây sau gộp thành đúng một lần tải lúc cửa sổ đóng', () => {
    const run = vi.fn();
    const c = createSignalCoalescer(run);
    c.signal();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    c.signal();
    vi.advanceTimersByTime(300);
    c.signal();
    c.signal();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(499);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(2);
    // Lần tải gộp mở cửa sổ mới: không lời nhắc nào nữa → không tải thêm.
    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('lời nhắc tới trong cửa sổ của lần tải gộp → thêm một lần ở cuối cửa sổ đó; hết cửa sổ thì lời nhắc sau lại tải ngay', () => {
    const run = vi.fn();
    const c = createSignalCoalescer(run);
    c.signal();
    c.signal();
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    c.signal();
    vi.advanceTimersByTime(999);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(3);
    c.signal();
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('một chuỗi tín hiệu dày (mỗi 100ms trong 3 giây) → tối đa một lần tải mỗi giây', () => {
    const run = vi.fn();
    const c = createSignalCoalescer(run);
    for (let i = 0; i < 30; i++) {
      c.signal();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(2_000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('dispose → bỏ lần tải đang chờ', () => {
    const run = vi.fn();
    const c = createSignalCoalescer(run);
    c.signal();
    c.signal();
    c.dispose();
    vi.advanceTimersByTime(5_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cửa sổ và bộ hẹn giờ thay được', () => {
    const run = vi.fn();
    const c = createSignalCoalescer(run, { windowMs: 50 });
    c.signal();
    c.signal();
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('effectivePollInterval / reopenDelay', () => {
  it('SSE đang kết nối → không polling; chưa kết nối → chu kỳ trang chọn', () => {
    expect(effectivePollInterval(true, 2_000)).toBe(false);
    expect(effectivePollInterval(false, 2_000)).toBe(2_000);
    expect(effectivePollInterval(false, false)).toBe(false);
    expect(effectivePollInterval(true, false)).toBe(false);
  });

  it('mở lại SSE sau 1, 2, 4… giây, tối đa 30 giây', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((n) => reopenDelay(n))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
    expect(reopenDelay(-1)).toBe(1_000);
  });
});

describe('isNetworkError (dòng mất mạng)', () => {
  it('chỉ lỗi không nhận được phản hồi; 503 của máy chủ, 5xx, 4xx hay lỗi khác thì không', () => {
    expect(isNetworkError(serviceUnavailableError(new TypeError('Failed to fetch')))).toBe(true);
    expect(isNetworkError(new ApiError(ErrorCode.SERVICE_UNAVAILABLE, 'Đang bảo trì', null, 503))).toBe(false);
    expect(isNetworkError(invalidResponseError(502))).toBe(false);
    expect(isNetworkError(new ApiError(ErrorCode.ORDER_NOT_FOUND, 'x', null, 404))).toBe(false);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});
