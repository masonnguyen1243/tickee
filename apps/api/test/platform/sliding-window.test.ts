import { describe, expect, it } from 'vitest';
import { SLIDING_WINDOW_MAX_SAMPLES, SlidingWindow } from '../../src/platform/alerts/index.js';

/*
 * Story 4.6-e: cửa sổ trượt trong bộ nhớ (nền của luật `ipn_failures` và `payment_link_slow`). Đồng hồ tiêm, không DB.
 */

const MIN = 60_000;

/** Cửa sổ 5 phút với đồng hồ test (`clock.now` tiến tay). */
function windowOf(maxSamples?: number) {
  const clock = { now: 1_000_000 };
  const window = new SlidingWindow<'a' | 'b'>({ windowMs: 5 * MIN, maxSamples, now: () => clock.now });
  return { clock, window };
}

describe('SlidingWindow', () => {
  it('đếm tổng và theo nhãn các mẫu trong 5 phút gần nhất; mẫu đúng 5 phút tuổi đã ra khỏi cửa sổ', () => {
    const { clock, window } = windowOf();
    expect(window.count()).toBe(0);
    expect(window.countBy()).toEqual(new Map());
    window.add('a');
    clock.now += 2 * MIN;
    window.add('b');
    window.add('a');
    expect(window.count()).toBe(3);
    expect(window.countBy()).toEqual(new Map([['a', 2], ['b', 1]]));

    // Mẫu đầu vừa tròn 5 phút: ra khỏi cửa sổ (khoảng (now − 5 phút, now]).
    clock.now += 3 * MIN;
    expect(window.count()).toBe(2);
    expect(window.countBy()).toEqual(new Map([['a', 1], ['b', 1]]));
    clock.now += 2 * MIN;
    expect(window.count()).toBe(0);
    expect(window.countBy()).toEqual(new Map());
  });

  it('percentile nearest-rank: giá trị thứ ⌈p·n/100⌉ theo thứ tự tăng dần; rỗng → null; p ngoài (0, 100] → lỗi', () => {
    const { clock, window } = windowOf();
    expect(window.percentile(95)).toBeNull();
    // 18 lần nhanh, 2 lần chậm: hạng ⌈0,95·20⌉ = 19 → lần chậm đầu tiên.
    for (let i = 0; i < 18; i++) window.add('a', 100 + i);
    window.add('b', 3_000);
    window.add('b', 2_500);
    expect(window.percentile(95)).toBe(2_500);
    expect(window.percentile(100)).toBe(3_000);
    expect(window.percentile(50)).toBe(109);
    // 21 mẫu: hạng ⌈19,95⌉ = 20.
    window.add('a', 1);
    expect(window.percentile(95)).toBe(2_500);
    // Một mẫu: mọi percentile là chính nó.
    clock.now += 5 * MIN;
    window.add('a', 42);
    expect(window.percentile(1)).toBe(42);
    expect(window.percentile(95)).toBe(42);
    expect(() => window.percentile(0)).toThrow(RangeError);
    expect(() => window.percentile(101)).toThrow(RangeError);
  });

  it('giữ tối đa maxSamples mẫu: đầy thì bỏ mẫu cũ nhất; mặc định 5.000; dồn mảng không làm sai số đếm', () => {
    expect(SLIDING_WINDOW_MAX_SAMPLES).toBe(5_000);
    const { window } = windowOf(3);
    window.add('a', 1);
    window.add('a', 2);
    window.add('b', 3);
    window.add('b', 4);
    expect(window.count()).toBe(3);
    expect(window.countBy()).toEqual(new Map([['a', 1], ['b', 2]]));
    expect(window.percentile(1)).toBe(2);

    const big = windowOf(2_000);
    for (let i = 0; i < 10_000; i++) big.window.add(i % 2 === 0 ? 'a' : 'b', i);
    expect(big.window.count()).toBe(2_000);
    expect(big.window.countBy()).toEqual(new Map([['a', 1_000], ['b', 1_000]]));
    expect(big.window.percentile(100)).toBe(9_999);
    expect(big.window.percentile(0.05)).toBe(8_000);
  });
});
