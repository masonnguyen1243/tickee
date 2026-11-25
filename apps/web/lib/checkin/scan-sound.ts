'use client';

import type { ScanSoundKind } from './scan-view';

/*
 * Âm thanh kết quả quét (Story 5.3, UX-DR30) bằng Web Audio, không dùng file âm thanh: bíp nhẹ cho xanh, hai nốt trầm
 * cho đỏ. Safari iOS chỉ cho phát sau một cử chỉ của người dùng, nên `AudioContext` được tạo hoặc resume trong lần chạm
 * "Bật camera" (`unlock()`). Trình duyệt không có Web Audio, chưa mở khóa hay phát lỗi thì im lặng: kết quả vẫn hiện bình
 * thường.
 */

export type ScanSound = {
  /** Gọi trong handler của một lần chạm (vd. "Bật camera"): tạo hoặc resume `AudioContext`. */
  unlock(): void;
  play(kind: ScanSoundKind): void;
  /** Đóng `AudioContext` (rời Màn quét). `unlock()` sau đó tạo lại. */
  dispose(): void;
};

type Tone = { frequency: number; start: number; duration: number };

/** Một nốt cao, ngắn và nhỏ. */
const SUCCESS_TONES: readonly Tone[] = [{ frequency: 1046, start: 0, duration: 0.12 }];
/** Hai nốt trầm, dài và to hơn: nghe khác hẳn bíp xanh. */
const WARNING_TONES: readonly Tone[] = [
  { frequency: 440, start: 0, duration: 0.18 },
  { frequency: 294, start: 0.24, duration: 0.32 },
];

const SOUNDS: Readonly<Record<ScanSoundKind, { tones: readonly Tone[]; type: OscillatorType; volume: number }>> = {
  success: { tones: SUCCESS_TONES, type: 'sine', volume: 0.25 },
  warning: { tones: WARNING_TONES, type: 'square', volume: 0.35 },
};

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | undefined {
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return g.AudioContext ?? g.webkitAudioContext;
}

export function createScanSound(): ScanSound {
  let context: AudioContext | null = null;

  const resume = (ctx: AudioContext) => {
    if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  };

  return {
    unlock() {
      try {
        if (!context) {
          const Ctor = audioContextConstructor();
          if (!Ctor) return;
          context = new Ctor();
        }
        resume(context);
        // Safari iOS cũ chỉ mở khóa hẳn khi có âm thanh phát ngay trong cử chỉ: một mẫu im lặng.
        const source = context.createBufferSource();
        source.buffer = context.createBuffer(1, 1, 22_050);
        source.connect(context.destination);
        source.start(0);
      } catch {
        // Không mở khóa được: quét vẫn chạy, chỉ không có âm thanh.
      }
    },
    play(kind) {
      const ctx = context;
      if (!ctx) return;
      try {
        resume(ctx);
        const { tones, type, volume } = SOUNDS[kind];
        const now = ctx.currentTime;
        for (const tone of tones) {
          const start = now + tone.start;
          const end = start + tone.duration;
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = type;
          oscillator.frequency.value = tone.frequency;
          // Vào và ra nhanh để không kêu "tách".
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, end);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(start);
          oscillator.stop(end + 0.02);
        }
      } catch {
        // Phát lỗi: bỏ qua, overlay vẫn hiện.
      }
    },
    dispose() {
      const ctx = context;
      context = null;
      if (ctx) void ctx.close().catch(() => undefined);
    },
  };
}
