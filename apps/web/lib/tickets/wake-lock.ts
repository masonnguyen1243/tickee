'use client';

import { useEffect } from 'react';

/*
 * Giữ màn hình không tối khi Chi tiết Vé đang hiện Mã QR vé (Story 3.9, Mason chốt 12/11): web không có API chỉnh độ sáng
 * màn hình, nên dùng Screen Wake Lock (`navigator.wakeLock.request('screen')`) để CTV quét được mà Người mua không phải
 * chạm màn hình. Nhả khi rời trang hoặc tab ẩn (trình duyệt cũng tự nhả), xin lại khi tab hiện lại. Trình duyệt không hỗ
 * trợ hoặc từ chối (chế độ tiết kiệm pin, chính sách quyền) thì bỏ qua, không báo lỗi. Phần điều khiển là hàm thuần trên
 * `navigator`/`document` truyền vào, kiểm bằng Vitest môi trường node.
 */

/** Phần của `WakeLockSentinel` cần dùng. */
export type WakeLockSentinelLike = {
  readonly released?: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
};

/** `navigator` và `document` mà bộ điều khiển dùng (thay được trong test). */
export type WakeLockEnv = {
  navigator: { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
  document: {
    readonly visibilityState: DocumentVisibilityState;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
};

export type WakeLockController = {
  /** Muốn giữ màn hình sáng: xin khóa ngay nếu tab đang hiện, và xin lại mỗi lần tab hiện lại. */
  start(): void;
  /** Thôi giữ: nhả khóa đang có, bỏ theo dõi `visibilitychange`. */
  stop(): void;
  /** Đang giữ khóa. */
  readonly held: boolean;
};

export function createWakeLockController({ navigator, document }: WakeLockEnv): WakeLockController {
  let wanted = false;
  let requesting = false;
  let sentinel: WakeLockSentinelLike | null = null;

  const releaseCurrent = () => {
    const current = sentinel;
    sentinel = null;
    if (current && !current.released) void current.release().catch(() => undefined);
  };

  const acquire = async () => {
    if (!wanted || requesting || sentinel !== null || document.visibilityState !== 'visible') return;
    const api = navigator.wakeLock;
    if (!api || typeof api.request !== 'function') return;
    requesting = true;
    try {
      const next = await api.request('screen');
      // Trong lúc chờ: đã rời trang hoặc tab đã ẩn → nhả ngay.
      if (!wanted || document.visibilityState !== 'visible') {
        void next.release().catch(() => undefined);
        return;
      }
      sentinel = next;
      // Trình duyệt tự nhả (tab ẩn, pin yếu): quên khóa, lần tab hiện lại xin lại.
      next.addEventListener?.('release', () => {
        if (sentinel === next) sentinel = null;
      });
    } catch {
      // Không được cấp (NotAllowedError…): bỏ qua, màn hình tối theo cài đặt máy.
    } finally {
      requesting = false;
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void acquire();
    else releaseCurrent();
  };

  return {
    start() {
      if (wanted) return;
      wanted = true;
      document.addEventListener('visibilitychange', onVisibilityChange);
      void acquire();
    },
    stop() {
      if (!wanted) return;
      wanted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      releaseCurrent();
    },
    get held() {
      return sentinel !== null;
    },
  };
}

/** Giữ màn hình sáng khi `active` (vd. Chi tiết Vé đang hiện Mã QR vé); nhả khi `active` thôi hoặc gỡ component. */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const controller = createWakeLockController({ navigator, document });
    controller.start();
    return () => controller.stop();
  }, [active]);
}
