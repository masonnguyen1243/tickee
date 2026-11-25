import { describe, expect, it } from 'vitest';

import { createScanGate, SCAN_REPEAT_IGNORE_MS } from '@/lib/checkin/use-qr-scanner';

/*
 * Khóa quét của Màn quét (Story 5.3): đọc được mã thì khóa tới khi overlay đóng; cùng mã đọc lại trong 2 giây sau khi
 * mở khóa thì bỏ qua, mã khác thì nhận ngay.
 */

describe('createScanGate', () => {
  it('nhận mã đầu tiên rồi khóa: mọi mã (cùng hay khác) bị bỏ qua tới khi mở khóa', () => {
    const gate = createScanGate();
    expect(gate.accept('A', 0)).toBe(true);
    expect(gate.locked).toBe(true);
    expect(gate.accept('A', 100)).toBe(false);
    expect(gate.accept('B', 100)).toBe(false);
  });

  it('cùng mã trong 2 giây sau khi mở khóa: bỏ qua; đủ 2 giây: nhận lại', () => {
    expect(SCAN_REPEAT_IGNORE_MS).toBe(2000);
    const gate = createScanGate();
    gate.accept('A', 0);
    gate.release(5000);
    expect(gate.locked).toBe(false);
    expect(gate.accept('A', 5000)).toBe(false);
    expect(gate.accept('A', 6999)).toBe(false);
    expect(gate.locked).toBe(false);
    expect(gate.accept('A', 7000)).toBe(true);
  });

  it('mã khác ngay sau khi mở khóa: nhận ngay; mã cũ hơn một lượt không còn bị chặn', () => {
    const gate = createScanGate();
    gate.accept('A', 0);
    gate.release(1000);
    expect(gate.accept('B', 1001)).toBe(true);
    gate.release(1500);
    expect(gate.accept('A', 1600)).toBe(true);
  });

  it('mở khóa khi chưa khóa: không đổi gì; chuỗi rỗng không bao giờ được nhận', () => {
    const gate = createScanGate();
    gate.release(0);
    expect(gate.accept('', 10)).toBe(false);
    expect(gate.accept('A', 10)).toBe(true);
  });
});
