import { describe, expect, it } from 'vitest';
import type { EventOrderListRow } from '../../src/modules/ordering/index.js';
import { cellBlocks, columnPositions } from '../../src/modules/integration/sheet-layout.js';
import {
  GOOGLE_SHEET_ORDER_COLUMNS,
  sheetColumnsOf,
  sheetHeaderRow,
  sheetOrderRow,
  sheetOrderValues,
} from '../../src/modules/integration/sheet-rows.js';

/*
 * Story 6.4, Quyết định 2: dòng Sheet danh sách Đơn — cột như CSV 6.3 bỏ "Cần xử lý", giá trị định dạng như CSV, câu trả
 * lời form nguyên văn (không `'`), ô trống là `''` để ghi lại cùng vùng thì xóa giá trị cũ. Story 6.5: mỗi cột có mã ổn
 * định (metadata `tickee.column`), cột "Check-in tay" sau "Đã check-in", ô dựng theo mã cột; vùng ghi chỉ gồm cột Tickee.
 * Hàm thuần.
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

const HEADERS = [
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
  'Check-in tay',
  'Số Vé',
];

describe('hàng tiêu đề', () => {
  it('13 cột cố định (không "Cần xử lý", "Check-in tay" ngay sau "Đã check-in"), rồi nhãn câu hỏi form theo thứ tự', () => {
    expect(GOOGLE_SHEET_ORDER_COLUMNS.map((column) => column.header)).toEqual(HEADERS);
    expect(sheetHeaderRow([])).toEqual(HEADERS);
    // Nhãn nguyên văn: RAW giữ chữ, không cần thoát như CSV.
    expect(sheetHeaderRow(columns)).toEqual([...HEADERS, 'CCCD', 'Cỡ áo', '=Ghi chú']);
  });

  it('mỗi cột có mã ổn định (giá trị metadata): mã cố định, câu hỏi là question:<id>; mã không trùng', () => {
    expect(GOOGLE_SHEET_ORDER_COLUMNS.map((column) => column.key)).toEqual([
      'order_code',
      'buyer_name',
      'buyer_email',
      'buyer_phone',
      'items',
      'total_amount',
      'paid_amount',
      'status',
      'created_at',
      'paid_at',
      'checked_in',
      'manual_checked_in',
      'ticket_count',
    ]);
    const keys = sheetColumnsOf(columns).map((column) => column.key);
    expect(keys.slice(13)).toEqual(['question:q-cccd', 'question:q-size', 'question:q-note']);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('dòng của một Đơn', () => {
  it('Đơn đã thanh toán, 3 Vé valid, 2 đã check-in: số tiền là số, SĐT nhóm 4-3-3, giờ Việt Nam, câu trả lời nguyên văn', () => {
    const answers = new Map([
      ['q-cccd', '001203004567'],
      ['q-note', '-1'],
    ]);
    expect(
      sheetOrderRow(order(), { checkin: { checkedInCount: 2, validTicketCount: 3, manualCheckedInCount: 1 }, answers }, columns),
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
      1,
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
    expect(row.slice(5, 13)).toEqual([300000, '', 'Cần xử lý', '2026-11-26 23:59:59', '', '', '', '']);
    expect(row.slice(13)).toEqual(['', '', '']);
  });

  it('Đơn đã hủy / đã hoàn tay: nhãn như badge; Vé đã hủy hết (0 Vé valid) → check-in trống; Đơn 0đ: 0 và 0', () => {
    expect(sheetOrderRow(order({ status: 'cancelled' }), { checkin: undefined, answers: undefined }, [])[7]).toBe('Đã hủy');
    const refunded = sheetOrderRow(
      order({ status: 'refunded' }),
      { checkin: { checkedInCount: 0, validTicketCount: 0, manualCheckedInCount: 0 }, answers: undefined },
      [],
    );
    expect(refunded[7]).toBe('Đã hoàn tay');
    expect(refunded.slice(10)).toEqual(['', '', '']);
    const free = sheetOrderRow(
      order({ totalAmount: 0, paidAmount: 0 }),
      { checkin: { checkedInCount: 0, validTicketCount: 1, manualCheckedInCount: 0 }, answers: undefined },
      [],
    );
    expect(free.slice(5, 7)).toEqual([0, 0]);
    expect(free.slice(10)).toEqual([0, 0, 1]);
    expect(free).toHaveLength(GOOGLE_SHEET_ORDER_COLUMNS.length);
  });

  it('không có id nội bộ nào trong dòng', () => {
    const row = sheetOrderRow(order(), { checkin: undefined, answers: undefined }, columns);
    expect(JSON.stringify(row)).not.toContain(order().id);
  });
});

describe('giá trị theo mã cột', () => {
  it('ô theo mã cột: cột cố định, câu trả lời theo question:<id> (cả câu không có cột); câu không trả lời không có', () => {
    const values = sheetOrderValues(order(), {
      checkin: { checkedInCount: 3, validTicketCount: 3, manualCheckedInCount: 2 },
      answers: new Map([
        ['q-cccd', '001203004567'],
        ['q-moi', 'Câu hỏi mới'],
      ]),
    });
    expect(values.get('order_code')).toBe('TK8F3Q2AXM');
    expect(values.get('checked_in')).toBe(3);
    expect(values.get('manual_checked_in')).toBe(2);
    expect(values.get('ticket_count')).toBe(3);
    expect(values.get('question:q-cccd')).toBe('001203004567');
    expect(values.get('question:q-moi')).toBe('Câu hỏi mới');
    expect(values.has('question:q-size')).toBe(false);
  });
});

describe('vùng ghi theo cột Tickee', () => {
  const metadata = (value: string, columnIndex: number, sheetId = 0) => ({ value, sheetId, columnIndex });

  it('vị trí cột theo metadata của đúng tab; cùng mã ở nhiều cột → cột trái nhất', () => {
    const positions = columnPositions(
      [metadata('order_code', 3), metadata('status', 1), metadata('order_code', 0), metadata('order_code', 9, 7)],
      0,
    );
    expect([...positions]).toEqual([
      ['order_code', 0],
      ['status', 1],
    ]);
  });

  it('cột Tickee không liền nhau → mỗi đoạn một vùng; dòng liền nhau gộp, dòng cách quãng tách; giá trị thiếu → ""', () => {
    // Cột BTC ở C (2): Tickee ở A, B rồi D.
    const positions = new Map([
      ['order_code', 0],
      ['status', 1],
      ['question:q', 3],
    ]);
    const row = (code: string, answer?: string) =>
      new Map<string, string | number>([
        ['order_code', code],
        ['status', 'Đã thanh toán'],
        ...(answer === undefined ? [] : ([['question:q', answer]] as [string, string][])),
      ]);
    const blocks = cellBlocks(5, positions, [
      { row: 8, values: row('TK3') },
      { row: 1, values: row('TK1', 'a') },
      { row: 2, values: row('TK2', 'b') },
    ]);
    expect(blocks).toEqual([
      { sheetId: 5, row: 1, column: 0, values: [['TK1', 'Đã thanh toán'], ['TK2', 'Đã thanh toán']] },
      { sheetId: 5, row: 1, column: 3, values: [['a'], ['b']] },
      { sheetId: 5, row: 8, column: 0, values: [['TK3', 'Đã thanh toán']] },
      { sheetId: 5, row: 8, column: 3, values: [['']] },
    ]);
    expect(cellBlocks(0, positions, [])).toEqual([]);
  });
});
