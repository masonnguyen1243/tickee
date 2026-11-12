import { describe, expect, it, vi } from 'vitest';

import { createWakeLockController, type WakeLockEnv, type WakeLockSentinelLike } from '@/lib/tickets/wake-lock';

/*
 * Giữ màn hình sáng khi Chi tiết Vé hiện Mã QR vé (Story 3.9): Screen Wake Lock, nhả khi tab ẩn hoặc rời trang, xin lại
 * khi tab hiện lại; không hỗ trợ hay bị từ chối thì bỏ qua, không lỗi. `navigator`/`document` giả, môi trường node.
 */

/** `document` giả: đổi `visibilityState` rồi phát `visibilitychange`. */
function fakeDocument(initial: DocumentVisibilityState = 'visible') {
  const listeners = new Set<() => void>();
  const doc = {
    visibilityState: initial,
    addEventListener: vi.fn((_type: 'visibilitychange', listener: () => void) => void listeners.add(listener)),
    removeEventListener: vi.fn((_type: 'visibilitychange', listener: () => void) => void listeners.delete(listener)),
    set(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
  return doc;
}

/** Khóa giả: `release()` đánh dấu đã nhả và gọi các listener `release` (như trình duyệt). */
function fakeSentinel() {
  const onRelease: (() => void)[] = [];
  const sentinel = {
    released: false,
    release: vi.fn(async () => {
      if (sentinel.released) return;
      sentinel.released = true;
      for (const listener of onRelease) listener();
    }),
    addEventListener: (_type: 'release', listener: () => void) => void onRelease.push(listener),
    /** Trình duyệt tự nhả (vd. tab ẩn). */
    systemRelease() {
      sentinel.released = true;
      for (const listener of onRelease) listener();
    },
  };
  return sentinel;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(request?: (type: 'screen') => Promise<WakeLockSentinelLike>, visibility: DocumentVisibilityState = 'visible') {
  const document = fakeDocument(visibility);
  const navigator: WakeLockEnv['navigator'] = request ? { wakeLock: { request: vi.fn(request) } } : {};
  const controller = createWakeLockController({ navigator, document });
  return { document, navigator, controller };
}

describe('createWakeLockController', () => {
  it('trình duyệt không hỗ trợ (không có navigator.wakeLock) → bỏ qua, không lỗi', async () => {
    const { controller, document } = setup();
    expect(() => controller.start()).not.toThrow();
    await flush();
    expect(controller.held).toBe(false);
    document.set('hidden');
    document.set('visible');
    await flush();
    expect(controller.held).toBe(false);
    expect(() => controller.stop()).not.toThrow();
  });

  it('bị từ chối (NotAllowedError) → bỏ qua, không ném, không giữ khóa; tab hiện lại thì thử lại', async () => {
    const request = vi.fn(() => Promise.reject(new DOMException('Pin yếu', 'NotAllowedError')));
    const { controller, document } = setup(request);
    controller.start();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.held).toBe(false);
    document.set('hidden');
    document.set('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.held).toBe(false);
    controller.stop();
  });

  it('được cấp → giữ khóa "screen"; tab ẩn → nhả; tab hiện lại → xin lại; rời trang → nhả và thôi theo dõi', async () => {
    const sentinels: ReturnType<typeof fakeSentinel>[] = [];
    const request = vi.fn(async (type: 'screen') => {
      expect(type).toBe('screen');
      const s = fakeSentinel();
      sentinels.push(s);
      return s;
    });
    const { controller, document } = setup(request);
    controller.start();
    await flush();
    expect(controller.held).toBe(true);
    expect(document.listenerCount()).toBe(1);

    document.set('hidden');
    expect(sentinels[0]!.release).toHaveBeenCalledTimes(1);
    expect(controller.held).toBe(false);

    document.set('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.held).toBe(true);

    controller.stop();
    expect(sentinels[1]!.release).toHaveBeenCalledTimes(1);
    expect(controller.held).toBe(false);
    expect(document.listenerCount()).toBe(0);
    // Sau khi rời trang: tab ẩn/hiện không xin lại.
    document.set('hidden');
    document.set('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('trình duyệt tự nhả khóa → quên khóa; lần tab hiện lại xin khóa mới', async () => {
    const sentinels: ReturnType<typeof fakeSentinel>[] = [];
    const request = vi.fn(async () => {
      const s = fakeSentinel();
      sentinels.push(s);
      return s;
    });
    const { controller, document } = setup(request);
    controller.start();
    await flush();
    sentinels[0]!.systemRelease();
    expect(controller.held).toBe(false);
    document.set('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.held).toBe(true);
    controller.stop();
  });

  it('mở khi tab đang ẩn → chưa xin; tab hiện → xin', async () => {
    const request = vi.fn(async () => fakeSentinel());
    const { controller, document } = setup(request, 'hidden');
    controller.start();
    await flush();
    expect(request).not.toHaveBeenCalled();
    document.set('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(controller.held).toBe(true);
    controller.stop();
  });

  it('rời trang (hoặc tab ẩn) trong lúc chờ cấp khóa → khóa vừa cấp được nhả ngay', async () => {
    let grant: (s: WakeLockSentinelLike) => void = () => undefined;
    const request = vi.fn(() => new Promise<WakeLockSentinelLike>((resolve) => (grant = resolve)));
    const { controller } = setup(request);
    controller.start();
    controller.stop();
    const late = fakeSentinel();
    grant(late);
    await flush();
    expect(late.release).toHaveBeenCalledTimes(1);
    expect(controller.held).toBe(false);

    const hidden = setup(request);
    hidden.controller.start();
    hidden.document.set('hidden');
    const late2 = fakeSentinel();
    grant(late2);
    await flush();
    expect(late2.release).toHaveBeenCalledTimes(1);
    expect(hidden.controller.held).toBe(false);
    hidden.controller.stop();
  });
});
