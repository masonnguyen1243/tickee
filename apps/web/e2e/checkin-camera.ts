import type { Page } from '@playwright/test';
import QRCode from 'qrcode';

/*
 * Camera giả cho Màn quét (Story 5.3): Playwright chưa có camera giả cho cả WebKit lẫn Chromium, nên `addInitScript`
 * thay `navigator.mediaDevices.getUserMedia` bằng `canvas.captureStream()` của một canvas nền trắng (mặc định 640×480,
 * đổi được để kiểm khung ngang lớn và khung dọc). `show(code)` sinh Mã QR bằng `qrcode` trong Node rồi vẽ ma trận vào
 * giữa canvas (vẽ lại liên tục để stream luôn có khung hình mới), nên vòng giải mã thật (cắt vùng vuông, thu nhỏ, jsQR)
 * được kiểm mà không cần cờ trình duyệt. Ghi lại các lần gọi `getUserMedia` (ràng buộc) và số track đã mở / đã dừng.
 *
 * Chế độ: `grant` (cho phép), `deny` (`NotAllowedError`), `not-found` (`NotFoundError`: máy không có camera),
 * `missing` (không có `navigator.mediaDevices`).
 */

export type CameraMode = 'grant' | 'deny' | 'not-found' | 'missing';

export type CameraState = {
  /** Ràng buộc của từng lần gọi `getUserMedia`. */
  calls: MediaStreamConstraints[];
  /** Số track video đã mở. */
  started: number;
  /** Số track đã `stop()`. */
  stopped: number;
};

export type FakeCamera = {
  /** Vẽ Mã QR của `code` vào khung hình; `null`: khung trắng (không có mã). */
  show(code: string | null): Promise<void>;
  state(): Promise<CameraState & { live: number }>;
};

type CameraWindow = {
  __camera: CameraState & { modules: { size: number; bits: number[] } | null };
};

/** Kích thước khung hình của camera giả. */
export type CameraSize = { width: number; height: number };

export async function fakeCamera(
  page: Page,
  mode: CameraMode = 'grant',
  size: CameraSize = { width: 640, height: 480 },
): Promise<FakeCamera> {
  await page.addInitScript(({ m, width: WIDTH, height: HEIGHT }) => {
    const state: CameraWindow['__camera'] = { calls: [], started: 0, stopped: 0, modules: null };
    (window as unknown as CameraWindow).__camera = state;

    /** Vùng lề trắng quanh mã (module), như chuẩn QR. */
    const QUIET = 4;
    let canvas: HTMLCanvasElement | null = null;
    const draw = () => {
      if (!canvas) return;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, WIDTH, HEIGHT);
      const qr = state.modules;
      if (!qr) return;
      const total = qr.size + 2 * QUIET;
      const cell = Math.floor(320 / total);
      const left = Math.floor((WIDTH - cell * total) / 2);
      const top = Math.floor((HEIGHT - cell * total) / 2);
      context.fillStyle = '#000000';
      for (let row = 0; row < qr.size; row++) {
        for (let col = 0; col < qr.size; col++) {
          if (qr.bits[row * qr.size + col]) context.fillRect(left + (col + QUIET) * cell, top + (row + QUIET) * cell, cell, cell);
        }
      }
    };
    const ensureCanvas = () => {
      if (canvas) return canvas;
      canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      draw();
      // Vẽ lại đều đặn: `captureStream` chỉ ra khung hình mới khi canvas được vẽ.
      setInterval(draw, 100);
      return canvas;
    };

    // Đếm `stop()` theo `track.id` trên prototype: WebKit có thể đổi wrapper JS của track (mất thuộc tính gán thêm).
    const liveTrackIds = new Set<string>();
    const nativeStop = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function stop(this: MediaStreamTrack) {
      if (liveTrackIds.delete(this.id)) state.stopped += 1;
      return nativeStop.call(this);
    };

    const getUserMedia = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      state.calls.push(JSON.parse(JSON.stringify(constraints)) as MediaStreamConstraints);
      if (m === 'deny') throw new DOMException('Permission denied', 'NotAllowedError');
      if (m === 'not-found') throw new DOMException('Requested device not found', 'NotFoundError');
      const stream = ensureCanvas().captureStream(15);
      for (const track of stream.getTracks()) {
        state.started += 1;
        liveTrackIds.add(track.id);
      }
      return stream;
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: m === 'missing' ? undefined : { getUserMedia },
    });
  }, { m: mode, ...size });

  return {
    async show(code) {
      const qr = code ? QRCode.create(code, { errorCorrectionLevel: 'M' }) : null;
      const modules = qr ? { size: qr.modules.size, bits: Array.from(qr.modules.data, (bit) => (bit ? 1 : 0)) } : null;
      await page.evaluate((next) => {
        (window as unknown as CameraWindow).__camera.modules = next;
      }, modules);
    },
    state: () =>
      page.evaluate(() => {
        const { calls, started, stopped } = (window as unknown as CameraWindow).__camera;
        return { calls, started, stopped, live: started - stopped };
      }),
  };
}

export type SoundLog = {
  /** Số lần phát mẫu im lặng để mở khóa âm thanh (trong lần chạm "Bật camera"). */
  unlocks: number;
  /** Kiểu sóng của từng nốt đã phát: `sine` = bíp xanh, `square` = cảnh báo đỏ. */
  tones: OscillatorType[];
};

/** Thay `AudioContext` bằng bản ghi lại các nốt đã phát (Web Audio thật không kiểm được trong trình duyệt headless). */
export async function recordScanSound(page: Page): Promise<() => Promise<SoundLog>> {
  await page.addInitScript(() => {
    const log: SoundLog = { unlocks: 0, tones: [] };
    (window as unknown as { __sound: SoundLog }).__sound = log;
    class FakeParam {
      value = 0;
      setValueAtTime() {
        return this;
      }
      exponentialRampToValueAtTime() {
        return this;
      }
    }
    class FakeNode {
      connect<T>(node: T): T {
        return node;
      }
      disconnect() {}
    }
    class FakeOscillator extends FakeNode {
      type: OscillatorType = 'sine';
      frequency = new FakeParam();
      start() {
        log.tones.push(this.type);
      }
      stop() {}
    }
    class FakeGain extends FakeNode {
      gain = new FakeParam();
    }
    class FakeBufferSource extends FakeNode {
      buffer: unknown = null;
      start() {
        log.unlocks += 1;
      }
    }
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = new FakeNode();
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      createOscillator() {
        return new FakeOscillator();
      }
      createGain() {
        return new FakeGain();
      }
      createBuffer() {
        return {};
      }
      createBufferSource() {
        return new FakeBufferSource();
      }
    }
    for (const name of ['AudioContext', 'webkitAudioContext']) {
      Object.defineProperty(window, name, { configurable: true, writable: true, value: FakeAudioContext });
    }
  });
  return () => page.evaluate(() => (window as unknown as { __sound: SoundLog }).__sound);
}
