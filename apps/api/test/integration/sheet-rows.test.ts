import { describe, expect, it } from 'vitest';
import type { EventOrderListRow } from '../../src/modules/ordering/index.js';
import {
  GOOGLE_SHEET_ORDER_COLUMNS,
  sheetColumnName,
  sheetHeaderRow,
  sheetOrderRow,
  sheetRange,
} from '../../src/modules/integration/sheet-rows.js';

/*
 * Story 6.4, Quyết định 2: dòng Sheet danh sách Đơn — cột như CSV 6.3 bỏ "Cần xử lý", giá trị định dạng như CSV, câu trả
 * lời form nguyên văn (không `'`), ô trống là `''` để ghi lại cùng vùng thì xóa giá trị cũ. Hàm thuần.
 */

const columns = [
  { questionId: 'q-cccd', label: 'CCCD' },
  { questionId: 'q-size', label: 'Cỡ áo' },
  { questionId: 'q-note', label: '=Ghi chú' },
];

const order = (overrides: Partial<EventOrderListRow> = {}): EventOrderListRow => ({
  id: '019a3b2c-0000-7abc-8def-0123456789ab',
  code: 'TK8F3Q2AXM',
  buyerName: 'Nguyễn Văn Minh',
  buyerEmail: 'minh@vidu.vn',
  buyerPhone: '+84912345678',
  totalAmount: 300_000,
  paidAmount: 250_000,
  status: 'paid',
  createdAt: '2026-11-26T16:59:59.123456Z',
  paidAt: new Date('2026-11-26T17:05:06.000Z'),
  items: [
    { ticketTypeName: 'VIP', quantity: 2 },
    { ticketTypeName: 'Thường', quantity: 1 },
  ],
  ...overrides,
});

describe('hàng tiêu đề', () => {
  it('12 cột cố định theo Quyết định 2 (không "Cần xử lý"), rồi nhãn câu hỏi form theo thứ tự', () => {
    expect(GOOGLE_SHEET_ORDER_COLUMNS).toEqual([
      'Mã Đơn',
      'Tên người mua',
      'Email',
      'SĐT',
      'Vé',
      'Số tiền',
      'Đã nhận',
      'Trạng thái',
      'Thời gian tạo',
      'Thời gian thanh toán',
      'Đã check-in',
      'Số Vé',
    ]);
    expect(sheetHeaderRow([])).toEqual([...GOOGLE_SHEET_ORDER_COLUMNS]);
    // Nhãn nguyên văn: RAW giữ chữ, không cần thoát như CSV.
    expect(sheetHeaderRow(columns)).toEqual([...GOOGLE_SHEET_ORDER_COLUMNS, 'CCCD', 'Cỡ áo', '=Ghi chú']);
  });
});

describe('dòng của một Đơn', () => {
  it('Đơn đã thanh toán, 3 Vé valid, 2 đã check-in: số tiền là số, SĐT nhóm 4-3-3, giờ Việt Nam, câu trả lời nguyên văn', () => {
    const answers = new Map([
      ['q-cccd', '001203004567'],
      ['q-note', '-1'],
    ]);
    expect(
      sheetOrderRow(order(), { checkin: { checkedInCount: 2, validTicketCount: 3 }, answers }, columns),
    ).toEqual([
      'TK8F3Q2AXM',
      'Nguyễn Văn Minh',
      'minh@vidu.vn',
      '0912 345 678',
      '2 × VIP, 1 × Thường',
      300000,
      250000,
      'Đã thanh toán',
      '2026-11-26 23:59:59',
      '2026-11-27 00:05:06',
      2,
      3,
      // Không thêm `'` (mẹo riêng cho Excel của CSV); câu không trả lời → ''.
      '001203004567',
      '',
      '-1',
    ]);
  });

  it('Đơn Cần xử lý: cột Trạng thái "Cần xử lý"; chưa nhận tiền, chưa có Vé → các ô đó trống', () => {
    const row = sheetOrderRow(
      order({ status: 'review', paidAmount: null, paidAt: null }),
      { checkin: undefined, answers: undefined },
      columns,
    );
    expect(row.slice(5, 12)).toEqual([300000, '', 'Cần xử lý', '2026-11-26 23:59:59', '', '', '']);
    expect(row.slice(12)).toEqual(['', '', '']);
  });

  it('Đơn đã hủy / đã hoàn tay: nhãn như badge; Vé đã hủy hết (0 Vé valid) → check-in trống; Đơn 0đ: 0 và 0', () => {
    expect(sheetOrderRow(order({ status: 'cancelled' }), { checkin: undefined, answers: undefined }, [])[7]).toBe('Đã hủy');
    const refunded = sheetOrderRow(
      order({ status: 'refunded' }),
      { checkin: { checkedInCount: 0, validTicketCount: 0 }, answers: undefined },
      [],
    );
    expect(refunded[7]).toBe('Đã hoàn tay');
    expect(refunded.slice(10)).toEqual(['', '']);
    const free = sheetOrderRow(
      order({ totalAmount: 0, paidAmount: 0 }),
      { checkin: { checkedInCount: 0, validTicketCount: 1 }, answers: undefined },
      [],
    );
    expect(free.slice(5, 7)).toEqual([0, 0]);
    expect(free.slice(10)).toEqual([0, 1]);
    expect(free).toHaveLength(GOOGLE_SHEET_ORDER_COLUMNS.length);
  });

  it('không có id nội bộ nào trong dòng', () => {
    const row = sheetOrderRow(order(), { checkin: undefined, answers: undefined }, columns);
    expect(JSON.stringify(row)).not.toContain(order().id);
  });
});

describe('vùng A1', () => {
  it('tên cột: 1 → A, 26 → Z, 27 → AA, 52 → AZ, 703 → AAA', () => {
    expect([1, 12, 26, 27, 52, 53, 702, 703].map(sheetColumnName)).toEqual(['A', 'L', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
    expect(() => sheetColumnName(0)).toThrow(RangeError);
  });

  it("tên tab luôn bọc '…', dấu ' bên trong nhân đôi", () => {
    expect(sheetRange('Đơn', 1, 1, 12)).toBe("'Đơn'!A1:L1");
    expect(sheetRange('Đơn', 2, 501, 15)).toBe("'Đơn'!A2:O501");
    expect(sheetRange("Đơn's", 1, 2, 27)).toBe("'Đơn''s'!A1:AA2");
  });
});
