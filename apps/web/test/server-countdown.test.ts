import { describe, expect, it } from 'vitest';

import {
  clockOffset,
  COUNTDOWN_MILESTONES,
  crossedMilestone,
  formatCountdown,
  remainingSeconds,
} from '@/lib/order/use-server-countdown';

/*
 * Đếm ngược Giữ chỗ theo đồng hồ máy chủ (Story 3.4): bù lệch `serverNow` − giờ máy lúc nhận, mm:ss, mốc đọc cho trình
 * đọc màn hình. Hook (`useServerCountdown`) và chip được kiểm trong Playwright (`page.clock`).
 */

const SERVER_NOW = '2026-11-10T01:00:00.000Z';
const EXPIRES_AT = '2026-11-10T01:15:00.000Z';

describe('remainingSeconds / clockOffset', () => {
  it('đồng hồ máy chậm hay nhanh hơn máy chủ vẫn đếm đúng theo máy chủ', () => {
    for (const skewMs of [0, -3 * 60_000, 7 * 60_000]) {
      const receivedAt = Date.parse(SERVER_NOW) + skewMs;
      const offset = clockOffset(SERVER_NOW, receivedAt);
      expect(remainingSeconds(EXPIRES_AT, receivedAt, offset)).toBe(900);
      expect(remainingSeconds(EXPIRES_AT, receivedAt + 61_500, offset)).toBe(839);
    }
  });

  it('làm tròn lên; quá hạn → 0, không âm', () => {
    const offset = 0;
    const deadline = Date.parse(EXPIRES_AT);
    expect(remainingSeconds(EXPIRES_AT, deadline - 1, offset)).toBe(1);
    expect(remainingSeconds(EXPIRES_AT, deadline, offset)).toBe(0);
    expect(remainingSeconds(EXPIRES_AT, deadline + 60_000, offset)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('mm:ss có số 0 đầu', () => {
    expect(formatCountdown(900)).toBe('15:00');
    expect(formatCountdown(872)).toBe('14:32');
    expect(formatCountdown(59)).toBe('00:59');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5)).toBe('00:00');
  });
});

describe('crossedMilestone', () => {
  it('chỉ báo khi vượt mốc 5 phút và 1 phút, mỗi mốc một lần', () => {
    expect(COUNTDOWN_MILESTONES).toEqual([300, 60]);
    expect(crossedMilestone(301, 300)).toBe(300);
    expect(crossedMilestone(300, 299)).toBeNull();
    expect(crossedMilestone(61, 60)).toBe(60);
    expect(crossedMilestone(500, 499)).toBeNull();
    // Máy ngủ dậy vượt cả hai mốc: báo mốc gần nhất với số giây hiện tại.
    expect(crossedMilestone(400, 30)).toBe(60);
    // Mở trang khi đã dưới mốc: không báo mốc đó; về 0 không báo (thay bằng "Đang xác nhận thanh toán").
    expect(crossedMilestone(250, 250)).toBeNull();
    expect(crossedMilestone(61, 0)).toBeNull();
    // Giá trị đầu tiên lúc gắn (kể cả gắn lại với dữ liệu cũ, đã dưới mốc 5 phút từ lâu): không báo gì.
    expect(crossedMilestone(null, 250)).toBeNull();
    expect(crossedMilestone(null, 299)).toBeNull();
    expect(crossedMilestone(null, 59)).toBeNull();
  });
});
