/*
 * Phần thuần của `useLiveResource` (AD-17, Story 3.7): gom tín hiệu, chọn chu kỳ polling, độ trễ mở lại SSE. Không React,
 * không DOM, để kiểm bằng Vitest môi trường node.
 */

/** Cửa sổ gom tín hiệu (ms): tải ngay ở tín hiệu đầu, các tín hiệu tới trong cửa sổ sau đó gộp thành một lần tải. */
export const SIGNAL_WINDOW_MS = 1_000;

/** Hẹn giờ thay được trong test (mặc định `setTimeout`/`clearTimeout` toàn cục). */
export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SignalCoalescer = {
  /** Một lời nhắc tải lại (SSE mở, tín hiệu SSE, tab visible, có mạng lại). */
  signal: () => void;
  /** Hủy cửa sổ đang mở và lần tải đang chờ (gỡ hook). */
  dispose: () => void;
};

/**
 * Gom lời nhắc tải lại: lời nhắc đầu tiên chạy `run` ngay và mở cửa sổ `windowMs`; mọi lời nhắc trong cửa sổ gộp thành
 * đúng một lần `run` lúc cửa sổ đóng (lần đó mở cửa sổ mới). Không lời nhắc nào trong cửa sổ → không chạy thêm.
 */
export function createSignalCoalescer(
  run: () => void,
  { windowMs = SIGNAL_WINDOW_MS, timers = defaultTimers }: { windowMs?: number; timers?: Timers } = {},
): SignalCoalescer {
  let timer: unknown = null;
  let pending = false;
  const open = () => {
    timer = timers.set(() => {
      timer = null;
      if (!pending) return;
      pending = false;
      run();
      open();
    }, windowMs);
  };
  return {
    signal() {
      if (timer !== null) {
        pending = true;
        return;
      }
      run();
      open();
    },
    dispose() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      pending = false;
    },
  };
}

/**
 * Việc của một lần tải lại do lời nhắc (Story 4.2-b): tải lại tài nguyên chính (`refetch`), rồi `onSignal` nếu có — vd.
 * tài nguyên khác cùng dùng tín hiệu của stream này. Cả hai đi cùng nhịp gom của `createSignalCoalescer`; polling chỉ tải
 * lại tài nguyên chính.
 */
export function signalReload(refetch: () => void, onSignal?: () => void): () => void {
  return () => {
    refetch();
    onSignal?.();
  };
}

/** Chu kỳ polling hiệu lực: SSE đang kết nối → không polling; chưa (hoặc mất) → chu kỳ trang chọn. */
export function effectivePollInterval(connected: boolean, chosen: number | false): number | false {
  return connected ? false : chosen;
}

/** Chờ trước lần mở lại SSE thứ `attempt` (0, 1, 2…) sau khi stream bị đóng hẳn: 1, 2, 4… giây, tối đa 30 giây. */
export function reopenDelay(attempt: number, initialMs = 1_000, maxMs = 30_000): number {
  return Math.min(initialMs * 2 ** Math.max(0, attempt), maxMs);
}
