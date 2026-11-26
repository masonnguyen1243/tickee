import { describe, expect, it } from 'vitest';
import {
  decodeEventOrderCursor,
  encodeEventOrderCursor,
  EVENT_ORDERS_PAGE_LIMIT,
  EVENT_ORDERS_PAGE_LIMIT_MAX,
  EVENT_ORDERS_SEARCH_MAX,
  EventOrderDetail,
  EventOrderHistoryEntry,
  EventOrderListQuery,
  EventOrderPage,
  EventOrderRow,
  eventOrderApiPath,
  eventOrdersApiPath,
  parseOrderSearch,
} from '../src/event-orders.js';

/* Story 6.1: tab Đơn — phân loại ô tìm, cursor keyset, query, schema response và đường API. */

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';

describe('parseOrderSearch', () => {
  it('mã Đơn: trim rồi viết hoa, khớp ORDER_CODE_PATTERN', () => {
    expect(parseOrderSearch('tk1234abcd')).toEqual({ kind: 'code', code: 'TK1234ABCD' });
    expect(parseOrderSearch('  TK8F3Q2AXM ')).toEqual({ kind: 'code', code: 'TK8F3Q2AXM' });
  });

  it('email: chữ thường; SĐT: E.164 (cùng luật tra tay)', () => {
    expect(parseOrderSearch('Minh@X.vn')).toEqual({ kind: 'email', email: 'minh@x.vn' });
    expect(parseOrderSearch(' minh@gmail.com ')).toEqual({ kind: 'email', email: 'minh@gmail.com' });
    for (const phone of ['0912 345 678', '0912345678', '0912.345.678', '+84 912 345 678']) {
      expect(parseOrderSearch(phone), phone).toEqual({ kind: 'phone', phone: '+84912345678' });
    }
  });

  it('không nhận ra → null: không khớp một phần, không theo tên', () => {
    for (const raw of [
      '',
      '   ',
      '0912',
      '091234567',
      'minh@',
      '@x.vn',
      'TK1234',
      'TK1234ABCDE',
      // Chữ ngoài bảng Crockford (I, L, O, U).
      'TK1234ABCI',
      'Nguyễn Văn Minh',
      `${'a'.repeat(EVENT_ORDERS_SEARCH_MAX)}@x.vn`,
    ]) {
      expect(parseOrderSearch(raw), raw).toBeNull();
    }
  });
});

describe('cursor', () => {
  const value = { createdAt: '2026-11-26T03:04:05.123456Z', code: 'TK8F3Q2AXM' };

  it('mã hóa base64url mờ (không đệm, không id nội bộ), giải mã lại đúng', () => {
    const cursor = encodeEventOrderCursor(value);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain('TK8F3Q2AXM');
    expect(decodeEventOrderCursor(cursor)).toEqual(value);
  });

  it('hỏng → null: không phải base64url, thiếu micro giây, ngày không có thật, mã lạ, thừa phần', () => {
    const encode = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    for (const cursor of [
      'abc',
      '',
      '!!!',
      'a'.repeat(300),
      encode('2026-11-26T03:04:05.123Z|TK8F3Q2AXM'),
      encode('2026-02-30T03:04:05.123456Z|TK8F3Q2AXM'),
      // Năm 0: `Date` của JS nhận, Postgres từ chối (500 thay vì 400).
      encode('0000-01-01T00:00:00.000000Z|TK8F3Q2AXM'),
      encode('2026-11-26T25:04:05.123456Z|TK8F3Q2AXM'),
      encode('2026-11-26T03:04:05.123456Z|TK123'),
      encode('2026-11-26T03:04:05.123456Z|TK8F3Q2AXM|x'),
      encode('2026-11-26T03:04:05.123456+07:00|TK8F3Q2AXM'),
    ]) {
      expect(decodeEventOrderCursor(cursor), cursor).toBeNull();
    }
  });
});

describe('EventOrderListQuery', () => {
  it('mặc định limit 50; nhận status, q (đã chuẩn hóa), cursor (đã giải mã), limit dạng chuỗi', () => {
    expect(EventOrderListQuery.parse({})).toEqual({ limit: EVENT_ORDERS_PAGE_LIMIT });
    const cursor = encodeEventOrderCursor({ createdAt: '2026-11-26T03:04:05.000001Z', code: 'TK8F3Q2AXM' });
    expect(EventOrderListQuery.parse({ status: 'needs_action', q: '0912 345 678', cursor, limit: '20' })).toEqual({
      status: 'needs_action',
      q: { kind: 'phone', phone: '+84912345678' },
      cursor: { createdAt: '2026-11-26T03:04:05.000001Z', code: 'TK8F3Q2AXM' },
      limit: 20,
    });
  });

  it('từ chối: status lạ (kể cả expired), q không nhận ra, cursor hỏng, limit ngoài 1–100, tham số lặp', () => {
    for (const query of [
      { status: 'expired' },
      { status: 'review' },
      { q: '0912' },
      { q: 'minh@' },
      { q: '' },
      { cursor: 'abc' },
      { limit: '0' },
      { limit: String(EVENT_ORDERS_PAGE_LIMIT_MAX + 1) },
      { limit: '1.5' },
      { limit: 'abc' },
      { q: ['0912345678', 'minh@x.vn'] },
    ]) {
      expect(EventOrderListQuery.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
    expect(EventOrderListQuery.parse({ limit: String(EVENT_ORDERS_PAGE_LIMIT_MAX) }).limit).toBe(EVENT_ORDERS_PAGE_LIMIT_MAX);
  });
});

const row = (patch: Record<string, unknown> = {}) => ({
  code: 'TK8F3Q2AXM',
  buyerName: 'Nguyễn Văn Minh',
  buyerEmail: 'minh@x.vn',
  buyerPhone: '+84912345678',
  items: [
    { ticketTypeName: 'VIP', quantity: 2 },
    { ticketTypeName: 'Thường', quantity: 1 },
  ],
  totalAmount: 300_000,
  paidAmount: 250_000,
  status: 'paid',
  createdAt: '2026-11-26T03:04:05.123Z',
  paidAt: '2026-11-26T03:10:00.000Z',
  review: null,
  ...patch,
});

describe('schema response', () => {
  it('dòng: đủ trường, không id nội bộ', () => {
    expect(Object.keys(EventOrderRow.shape).sort()).toEqual(
      [
        'buyerEmail',
        'buyerName',
        'buyerPhone',
        'code',
        'createdAt',
        'items',
        'paidAmount',
        'paidAt',
        'review',
        'status',
        'totalAmount',
      ].sort(),
    );
    expect(EventOrderPage.parse({ orders: [row()], nextCursor: null }).orders).toHaveLength(1);
    expect(EventOrderRow.safeParse(row({ code: 'TK123' })).success).toBe(false);
    expect(EventOrderRow.safeParse(row({ review: { type: 'duplicate_payment', receivedAmount: 300_000 } })).success).toBe(true);
  });

  it('chi tiết: Vé không có QR, token hay id; lịch sử theo loại', () => {
    const detail = EventOrderDetail.parse({
      ...row(),
      paidSource: 'manual',
      cancelReason: null,
      answers: [{ label: 'Size áo', answer: 'L' }],
      tickets: [
        {
          seq: 1,
          orderTicketCount: 3,
          ticketTypeName: 'VIP',
          holderName: 'Nguyễn Văn Minh',
          status: 'valid',
          cancelReason: null,
          checkedInAt: null,
        },
      ],
      history: [
        { kind: 'created', at: '2026-11-26T03:04:05.123Z' },
        { kind: 'review_opened', at: '2026-11-26T03:05:00.000Z', reviewType: 'amount_mismatch' },
        { kind: 'paid', at: '2026-11-26T03:10:00.000Z', paidSource: 'manual' },
      ],
    });
    expect(Object.keys(detail.tickets[0]!).sort()).toEqual(
      ['cancelReason', 'checkedInAt', 'holderName', 'orderTicketCount', 'seq', 'status', 'ticketTypeName'].sort(),
    );
    expect(EventOrderHistoryEntry.safeParse({ kind: 'paid', at: '2026-11-26T03:10:00.000Z' }).success).toBe(false);
    expect(EventOrderHistoryEntry.safeParse({ kind: 'review_opened', at: '2026-11-26T03:10:00.000Z' }).success).toBe(false);
  });
});

describe('đường API', () => {
  it('danh sách kèm query (bỏ tham số không có), chi tiết theo mã Đơn', () => {
    const base = `/orgs/${ORG}/events/${EVENT}/orders`;
    expect(eventOrdersApiPath(ORG, EVENT)).toBe(base);
    expect(eventOrdersApiPath(ORG, EVENT, { status: 'paid', q: 'Minh@X.vn', cursor: 'abc_-', limit: 20 })).toBe(
      `${base}?status=paid&q=Minh%40X.vn&cursor=abc_-&limit=20`,
    );
    expect(eventOrdersApiPath(ORG, EVENT, { q: '0912 345 678' })).toBe(`${base}?q=0912+345+678`);
    expect(eventOrderApiPath(ORG, EVENT, 'TK8F3Q2AXM')).toBe(`${base}/TK8F3Q2AXM`);
  });
});
