import type { Page } from '@playwright/test';

/*
 * Giả lập realtime dùng chung cho các spec tự cập nhật (Trang Đơn — Story 3.7, Vé của tôi — Story 3.9): `EventSource`
 * điều khiển được từ test và tab ẩn/hiện.
 */

/**
 * `EventSource` giả điều khiển được (`page.route` không giữ được một stream mở rồi đẩy tin sau): mỗi lần trang mở stream
 * là một phần tử của `window.__sse`; test gọi `open()` (kết nối xong), `message(data)` (một tin `data:` trên chính kết
 * nối đó), `drop()` (mất kết nối tạm thời: trình duyệt sẽ tự nối lại, `readyState` CONNECTING).
 *
 * `url`: chỉ điều khiển (và đếm) các stream có URL khớp. Dashboard luôn mở stream cấp BTC của khung (Story 4.2-b) bên
 * cạnh stream của trang, nên spec dashboard chọn đúng stream của mình. Gọi nhiều lần trên cùng `page` (mỗi lần một `url`)
 * vẫn chỉ cài một `EventSource` giả.
 */
export async function fakeEventSource(page: Page, { url }: { url?: RegExp } = {}) {
  await page.addInitScript(() => {
    if ((window as unknown as { __sse?: unknown[] }).__sse) return;
    class FakeEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      url: string;
      withCredentials: boolean;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(url: string, init?: { withCredentials?: boolean }) {
        super();
        this.url = url;
        this.withCredentials = Boolean(init?.withCredentials);
        (window as unknown as { __sse: FakeEventSource[] }).__sse.push(this);
      }
      close() {
        this.readyState = 2;
      }
      open() {
        this.readyState = 1;
        this.onopen?.(new Event('open'));
      }
      message(data: string) {
        this.onmessage?.(new MessageEvent('message', { data }));
      }
      drop() {
        this.readyState = 0;
        this.onerror?.(new Event('error'));
      }
    }
    (window as unknown as { __sse: unknown[] }).__sse = [];
    Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: FakeEventSource });
  });
  const pattern = url ? JSON.stringify({ source: url.source, flags: url.flags }) : 'null';
  const streams = `((p) => (p ? window.__sse.filter((s) => new RegExp(p.source, p.flags).test(s.url)) : window.__sse))(${pattern})`;
  const last = `${streams}.at(-1)`;
  return {
    count: () => page.evaluate<number>(`${streams}.length`),
    info: () =>
      page.evaluate<{ url: string; withCredentials: boolean; readyState: number }>(
        `({ url: ${last}.url, withCredentials: ${last}.withCredentials, readyState: ${last}.readyState })`,
      ),
    open: () => page.evaluate(`${last}.open()`),
    message: (type: string) => page.evaluate(`${last}.message(${JSON.stringify(JSON.stringify({ type }))})`),
    drop: () => page.evaluate(`${last}.drop()`),
    /** Mọi stream trang đã mở (cũ trước): đường dẫn và `readyState` (2 = đã đóng). */
    all: () =>
      page.evaluate<{ url: string; readyState: number }[]>(
        `${streams}.map((s) => ({ url: s.url, readyState: s.readyState }))`,
      ),
  };
}

/** Giả lập tab ẩn / hiện lại (Safari cắt kết nối khi tab ở nền; polling của TanStack cũng dừng khi tab ẩn). */
export const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { value: next, configurable: true });
    Object.defineProperty(document, 'hidden', { value: next === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  }, state);
