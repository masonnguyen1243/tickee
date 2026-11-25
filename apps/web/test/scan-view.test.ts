import type { ScanInvalidReason, ScanResult } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { checkedByText, SCAN_AUTO_CLOSE_MS, scanView } from '@/lib/checkin/scan-view';

/*
 * Nội dung overlay kết quả quét (Story 5.3): mọi `outcome`, mọi lý do "Vé không hợp lệ", mọi nhánh "bởi {người}", giờ
 * HH:MM theo giờ Việt Nam bất kể offset api trả.
 */

const already = (checkedInAt: string, checkedBy: Extract<ScanResult, { outcome: 'already' }>['checkedBy']): ScanResult => ({
  outcome: 'already',
  checkedInAt,
  checkedBy,
});

describe('scanView', () => {
  it('ok: xanh, "Thành công", "{tên} · Vé k/N · {Hạng vé}", bíp nhẹ, tự đóng 1,5 giây', () => {
    expect(
      scanView({ outcome: 'ok', holderName: 'Nguyễn Văn Minh', seq: 2, count: 3, ticketTypeName: 'Đôi nam' }),
    ).toEqual({
      tone: 'success',
      title: 'Thành công',
      detail: 'Nguyễn Văn Minh · Vé 2/3 · Đôi nam',
      sound: 'success',
      autoCloseMs: 1500,
    });
    expect(SCAN_AUTO_CLOSE_MS).toBe(1500);
  });

  it('ok mà tên hay Hạng vé rỗng: bỏ phần rỗng, không ra dấu "·" thừa', () => {
    expect(scanView({ outcome: 'ok', holderName: '  ', seq: 1, count: 1, ticketTypeName: 'Vé thường' }).detail).toBe(
      'Vé 1/1 · Vé thường',
    );
    expect(scanView({ outcome: 'ok', holderName: 'An', seq: 1, count: 2, ticketTypeName: '' }).detail).toBe('An · Vé 1/2');
  });

  it('recent: trung tính, "Bạn vừa check-in Vé này", im lặng, tự đóng 1,5 giây', () => {
    expect(scanView({ outcome: 'recent' })).toEqual({
      tone: 'neutral',
      title: 'Bạn vừa check-in Vé này',
      detail: null,
      sound: null,
      autoCloseMs: 1500,
    });
  });

  it('already: đỏ, "Đã check-in", "lúc HH:MM · bởi {người}", cảnh báo, giữ tới khi chạm', () => {
    expect(scanView(already('2026-11-25T07:42:10+07:00', { kind: 'name', name: 'Trần Hùng' }))).toEqual({
      tone: 'danger',
      title: 'Đã check-in',
      detail: 'lúc 07:42 · bởi Trần Hùng',
      sound: 'warning',
      autoCloseMs: null,
    });
  });

  it('already: giờ theo Việt Nam dù api trả offset khác (UTC, qua nửa đêm)', () => {
    expect(scanView(already('2026-11-25T00:42:00.000Z', { kind: 'self' })).detail).toBe('lúc 07:42 · bởi bạn');
    expect(scanView(already('2026-11-25T17:05:00Z', { kind: 'self' })).detail).toBe('lúc 00:05 · bởi bạn');
    expect(scanView(already('2026-11-25T09:30:00+09:00', { kind: 'self' })).detail).toBe('lúc 07:30 · bởi bạn');
  });

  const REASONS: [ScanInvalidReason, string][] = [
    ['BAD_SIGNATURE', 'Mã QR vé không đúng'],
    ['CANCELLED', 'Vé đã hủy'],
    ['VOIDED', 'Vé bị vô hiệu'],
    ['OTHER_EVENT', 'Vé của Sự kiện khác'],
    ['EVENT_ENDED', 'Sự kiện đã kết thúc'],
  ];
  for (const [reason, text] of REASONS) {
    it(`invalid ${reason}: đỏ, "Vé không hợp lệ" · "${text}", cảnh báo, giữ tới khi chạm`, () => {
      expect(scanView({ outcome: 'invalid', reason })).toEqual({
        tone: 'danger',
        title: 'Vé không hợp lệ',
        detail: text,
        sound: 'warning',
        autoCloseMs: null,
      });
    });
  }
});

describe('checkedByText', () => {
  it('self → "bạn"; name → tên; role → Owner / Admin / CTV khác', () => {
    expect(checkedByText({ kind: 'self' })).toBe('bạn');
    expect(checkedByText({ kind: 'name', name: 'Lê Lan' })).toBe('Lê Lan');
    expect(checkedByText({ kind: 'role', role: 'owner' })).toBe('Owner');
    expect(checkedByText({ kind: 'role', role: 'admin' })).toBe('Admin');
    expect(checkedByText({ kind: 'role', role: 'checker' })).toBe('CTV khác');
  });
});
