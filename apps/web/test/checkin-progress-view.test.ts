import { describe, expect, it } from 'vitest';

import {
  CHECKIN_PROGRESS_LABEL,
  CHECKIN_PROGRESS_LIVE,
  CHECKIN_PROGRESS_POLL_MS,
  checkinProgressCaption,
  checkinProgressPollInterval,
  checkinUpdatedAtLabel,
  progressLabel,
  progressValueText,
} from '@/lib/checkin/progress-view';
import { progressRatio } from '@/lib/progress';

/*
 * Khối `checkin-progress` của tab Check-in (Story 5.7): nhãn "k/N", tỉ lệ của thanh (`lib/progress.ts`, N = 0 → 0),
 * dòng phụ "Cập nhật liên tục" / "Cập nhật lúc HH:MM:SS" (giờ Việt Nam), nhịp polling 10 giây.
 */

describe('nhãn và giá trị đọc', () => {
  it('"k/N" và câu đọc cho trình đọc màn hình', () => {
    expect(CHECKIN_PROGRESS_LABEL).toBe('Check-in');
    expect(progressLabel(41, 66)).toBe('41/66');
    expect(progressLabel(0, 0)).toBe('0/0');
    expect(progressValueText(41, 66)).toBe('41 trên 66 Vé đã check-in');
    expect(progressValueText(0, 0)).toBe('0 trên 0 Vé đã check-in');
  });
});

describe('progressRatio', () => {
  it('k/N trong [0, 1]', () => {
    expect(progressRatio(41, 66)).toBeCloseTo(41 / 66);
    expect(progressRatio(0, 10)).toBe(0);
    expect(progressRatio(10, 10)).toBe(1);
  });

  it('N = 0 (Hạng vé chưa có Vé hợp lệ) → 0, không chia cho 0', () => {
    expect(progressRatio(0, 0)).toBe(0);
    expect(Number.isFinite(progressRatio(0, 0))).toBe(true);
  });

  it('số lạ không làm tràn thanh: k > N → 1, âm hay NaN → 0', () => {
    expect(progressRatio(12, 10)).toBe(1);
    expect(progressRatio(-1, 10)).toBe(0);
    expect(progressRatio(3, -1)).toBe(0);
    expect(progressRatio(Number.NaN, 10)).toBe(0);
    expect(progressRatio(3, Number.NaN)).toBe(0);
  });
});

describe('dòng phụ', () => {
  // 10:04:07 giờ Việt Nam.
  const at = Date.parse('2026-11-25T03:04:07.000Z');

  it('đang tự cập nhật → "Cập nhật liên tục"', () => {
    expect(CHECKIN_PROGRESS_LIVE).toBe('Cập nhật liên tục');
    expect(checkinProgressCaption({ stale: false, updatedAt: at })).toBe('Cập nhật liên tục');
  });

  it('số đã cũ → "Cập nhật lúc HH:MM:SS" giờ Việt Nam (không theo múi giờ máy), giây có số 0 đứng đầu', () => {
    expect(checkinUpdatedAtLabel(at)).toBe('Cập nhật lúc 10:04:07');
    expect(checkinProgressCaption({ stale: true, updatedAt: at })).toBe('Cập nhật lúc 10:04:07');
    // 23:59:59 UTC = 06:59:59 hôm sau giờ Việt Nam.
    expect(checkinUpdatedAtLabel(Date.parse('2026-11-25T23:59:59.000Z'))).toBe('Cập nhật lúc 06:59:59');
    expect(checkinUpdatedAtLabel(Date.parse('2026-11-25T17:00:00.000Z'))).toBe('Cập nhật lúc 00:00:00');
  });
});

describe('polling', () => {
  it('10 giây khi SSE chưa kết nối', () => {
    expect(CHECKIN_PROGRESS_POLL_MS).toBe(10_000);
    expect(checkinProgressPollInterval()).toBe(10_000);
  });
});
