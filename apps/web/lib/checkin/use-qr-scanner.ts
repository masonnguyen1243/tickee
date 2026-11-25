'use client';

import type jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { useScreenWakeLock } from '@/lib/tickets/wake-lock';

/*
 * Camera và vòng giải mã của Màn quét (Story 5.3, UX-DR29):
 * - `start()` (trong lần chạm "Bật camera" hoặc "Thử lại") xin camera sau, không xin micro;
 * - camera chạy thì mỗi ~150ms cắt vùng vuông giữa khung hình, thu về tối đa 480px, giải mã bằng jsQR (chỉ tải khi mở
 *   Màn quét);
 * - đọc được mã thì khóa quét và gọi `onCode`; nơi gọi mở khóa bằng `release()` khi overlay kết quả đóng (hoặc gửi lỗi).
 *   Cùng mã đọc lại trong 2 giây sau khi mở khóa thì bỏ qua;
 * - `paused` (mất kết nối, Story 5.4): không giải mã mã mới nhưng track camera vẫn chạy, để có mạng lại là quét tiếp ngay;
 * - tab ẩn hoặc rời trang thì dừng mọi track camera, tab hiện lại thì bật lại; giữ màn hình sáng khi camera chạy.
 * Không bao giờ log chuỗi đọc được.
 */

/** `idle`: chưa bấm "Bật camera"; `denied`: bị từ chối quyền; `unavailable`: không có camera / `mediaDevices`. */
export type CameraStatus = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable' | 'stopped';

/** Giải mã mỗi chừng này mili giây. */
export const SCAN_DECODE_INTERVAL_MS = 150;
/** Cạnh lớn nhất của ảnh vuông đưa vào jsQR. */
export const SCAN_DECODE_MAX_SIZE = 480;
/** Cùng mã đọc lại trong chừng này mili giây sau khi mở khóa thì bỏ qua. */
export const SCAN_REPEAT_IGNORE_MS = 2000;

const CAMERA_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };

export type ScanGate = {
  /** Mã vừa đọc có được nhận không; nhận thì khóa quét. */
  accept(code: string, now: number): boolean;
  /** Mở khóa (overlay đóng / gửi lỗi): mã vừa nhận bị bỏ qua thêm `SCAN_REPEAT_IGNORE_MS` tính từ `now`. */
  release(now: number): void;
  readonly locked: boolean;
};

/** Khóa quét và bỏ qua mã lặp. Hàm thuần (thời gian truyền vào), kiểm bằng Vitest. */
export function createScanGate(repeatIgnoreMs: number = SCAN_REPEAT_IGNORE_MS): ScanGate {
  let locked = false;
  let current: string | null = null;
  let lastCode: string | null = null;
  let lastReleasedAt = Number.NEGATIVE_INFINITY;
  return {
    accept(code, now) {
      if (locked || code === '') return false;
      if (code === lastCode && now - lastReleasedAt < repeatIgnoreMs) return false;
      locked = true;
      current = code;
      return true;
    },
    release(now) {
      if (!locked) return;
      locked = false;
      lastCode = current;
      current = null;
      lastReleasedAt = now;
    },
    get locked() {
      return locked;
    },
  };
}

type Decoder = typeof jsQR;
let decoderPromise: Promise<Decoder> | null = null;

/** Tải jsQR một lần (dynamic import: chỉ khi mở Màn quét); lỗi tải thì lần sau thử lại. */
function loadDecoder(): Promise<Decoder> {
  decoderPromise ??= import('jsqr').then(
    (mod) => mod.default,
    (error: unknown) => {
      decoderPromise = null;
      throw error;
    },
  );
  return decoderPromise;
}

const stopStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

/** Bị từ chối quyền camera (Safari cũ và Chrome cũ còn dùng `PermissionDeniedError`). */
const isPermissionDenied = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');

export type QrScanner = {
  /** Gắn vào `<video playsInline muted>` của `scanner-viewport`. */
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  /** Camera đang chạy (có track sống). */
  cameraRunning: boolean;
  /** Bật camera (lần đầu hoặc "Thử lại"). */
  start(): void;
  /** Tắt hẳn camera (vd. hết quyền): không tự bật lại khi tab hiện lại. */
  stop(): void;
  /** Mở khóa quét sau khi overlay kết quả đóng hoặc gửi lỗi. */
  release(): void;
};

export type QrScannerOptions = {
  onCode: (code: string) => void;
  /** `true`: không giải mã (camera vẫn chạy), vd. khi `offline-banner` hiện. */
  paused?: boolean;
};

export function useQrScanner({ onCode, paused = false }: QrScannerOptions): QrScanner {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  /** Người dùng đã bật camera và chưa tắt hẳn. */
  const [wanted, setWanted] = useState(false);
  /** Tăng mỗi lần "Thử lại" để xin camera lại dù `wanted` không đổi. */
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  /** Stream đang dùng, để dừng ngay trong handler `visibilitychange`/`pagehide` (không chờ React render). */
  const streamRef = useRef<MediaStream | null>(null);
  const gateRef = useRef<ScanGate>(createScanGate());
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);
  /** Đọc trong vòng giải mã (không dựng lại vòng khi đổi). */
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Mở Màn quét là bắt đầu tải thư viện giải mã, để camera vừa chạy là giải mã được ngay.
  useEffect(() => {
    void loadDecoder().catch(() => undefined);
  }, []);

  // Tab ẩn / rời trang: dừng track ngay; tab hiện lại (kể cả quay lại từ bfcache): bật lại.
  useEffect(() => {
    const stopNow = () => {
      if (streamRef.current) stopStream(streamRef.current);
    };
    // Ẩn rồi hiện lại trước khi React kịp áp `visible=false` (Safari iOS đóng băng JS ngay sau khi ẩn; `pagehide` rồi
    // `pageshow` từ bfcache): effect không chạy lại, stream đã dừng vẫn được coi là đang chạy → xin camera lại.
    const showAgain = () => {
      const isVisible = document.visibilityState === 'visible';
      if (isVisible && streamRef.current?.getTracks().some((track) => track.readyState === 'ended')) {
        setAttempt((n) => n + 1);
      }
      setVisible(isVisible);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        showAgain();
        return;
      }
      stopNow();
      setVisible(false);
    };
    const onPageHide = () => {
      stopNow();
      setVisible(false);
    };
    const onPageShow = showAgain;
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // Xin camera khi đã bật và tab đang hiện; dọn (dừng mọi track) khi tab ẩn, tắt hẳn hoặc rời Màn quét.
  useEffect(() => {
    if (!wanted || !visible) return;
    const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
      setStatus('unavailable');
      setWanted(false);
      return;
    }
    let cancelled = false;
    let acquired: MediaStream | null = null;
    const onTrackEnded = () => {
      if (!cancelled) setAttempt((n) => n + 1);
    };
    setStatus('starting');
    media.getUserMedia(CAMERA_CONSTRAINTS).then(
      (next) => {
        if (cancelled) {
          stopStream(next);
          return;
        }
        acquired = next;
        streamRef.current = next;
        // Hệ điều hành tự dừng track (ứng dụng khác chiếm camera…) khi tab vẫn hiện: xin camera lại. `stop()` của chính
        // mình không phát `ended`.
        for (const track of next.getVideoTracks()) track.addEventListener('ended', onTrackEnded);
        setStream(next);
        setStatus('running');
      },
      (error: unknown) => {
        if (cancelled) return;
        setStatus(isPermissionDenied(error) ? 'denied' : 'unavailable');
        setWanted(false);
      },
    );
    return () => {
      cancelled = true;
      if (acquired) {
        for (const track of acquired.getVideoTracks()) track.removeEventListener('ended', onTrackEnded);
        stopStream(acquired);
        if (streamRef.current === acquired) streamRef.current = null;
      }
      setStream(null);
    };
  }, [wanted, visible, attempt]);

  // Camera chạy: gắn stream vào `<video>` và giải mã mỗi ~150ms (chuỗi `setTimeout`, không chồng lượt).
  useEffect(() => {
    const video = videoRef.current;
    if (!stream || !video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let decode: Decoder | null = null;
    let loading = false;
    /** Tải jsQR nếu chưa có; tải lỗi (mạng chập chờn, chunk đổi sau deploy) thì lượt sau tải lại. */
    const ensureDecoder = () => {
      if (decode || loading) return;
      loading = true;
      void loadDecoder()
        .then(
          (decoder) => {
            decode = decoder;
          },
          () => undefined,
        )
        .finally(() => {
          loading = false;
        });
    };
    ensureDecoder();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (stopped) return;
      ensureDecoder();
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const decoding = !gateRef.current.locked && !pausedRef.current;
        if (decode && context && decoding && video.readyState >= 2 && width > 0 && height > 0) {
          const side = Math.min(width, height);
          const size = Math.min(side, SCAN_DECODE_MAX_SIZE);
          if (canvas.width !== size) canvas.width = size;
          if (canvas.height !== size) canvas.height = size;
          context.drawImage(video, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
          const { data } = context.getImageData(0, 0, size, size);
          const found = decode(data, size, size, { inversionAttempts: 'dontInvert' });
          if (found && gateRef.current.accept(found.data, Date.now())) onCodeRef.current(found.data);
        }
      } catch {
        // Khung hình chưa sẵn sàng hay lỗi vẽ: bỏ qua lượt này.
      }
      timer = setTimeout(tick, SCAN_DECODE_INTERVAL_MS);
    };
    timer = setTimeout(tick, SCAN_DECODE_INTERVAL_MS);

    return () => {
      stopped = true;
      clearTimeout(timer);
      video.srcObject = null;
    };
  }, [stream]);

  const cameraRunning = stream !== null;
  useScreenWakeLock(cameraRunning);

  const start = useCallback(() => {
    setStatus('starting');
    setWanted(true);
    setAttempt((n) => n + 1);
  }, []);

  const stop = useCallback(() => {
    if (streamRef.current) stopStream(streamRef.current);
    setWanted(false);
    setStatus('stopped');
  }, []);

  const release = useCallback(() => gateRef.current.release(Date.now()), []);

  return { videoRef, status, cameraRunning, start, stop, release };
}
