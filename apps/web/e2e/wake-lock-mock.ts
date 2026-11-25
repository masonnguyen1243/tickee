import type { Page } from '@playwright/test';

/*
 * Screen Wake Lock giả (Story 3.9, dùng lại ở `/xem-ve` và Màn quét, Story 5.3): thay `navigator.wakeLock` bằng bản ghi
 * lại số lần xin và số lần nhả, trước khi trang chạy.
 */

export type WakeLockCalls = { requests: number; released: number };

/** Ghi lại `navigator.wakeLock.request` (thay API thật): số lần xin, số lần nhả. `deny`: luôn từ chối. */
export async function recordWakeLock(page: Page, mode: 'grant' | 'deny' = 'grant'): Promise<() => Promise<WakeLockCalls>> {
  await page.addInitScript((m) => {
    const calls = { requests: 0, released: 0 };
    (window as unknown as { __wakeLock: typeof calls }).__wakeLock = calls;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: (type: string) => {
          calls.requests += 1;
          if (m === 'deny') return Promise.reject(new DOMException('Không cho phép', 'NotAllowedError'));
          const sentinel = Object.assign(new EventTarget(), {
            type,
            released: false,
            release() {
              if (sentinel.released) return Promise.resolve();
              sentinel.released = true;
              calls.released += 1;
              sentinel.dispatchEvent(new Event('release'));
              return Promise.resolve();
            },
          });
          return Promise.resolve(sentinel);
        },
      },
    });
  }, mode);
  return () => page.evaluate(() => (window as unknown as { __wakeLock: WakeLockCalls }).__wakeLock);
}
