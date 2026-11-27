import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewItemLine, reviewLine } from '@/lib/reporting/overview';
import {
  csvFilenameOf,
  downloadEventOrdersCsv,
  eventOrderQueryKey,
  eventOrdersQueryKey,
  eventOrdersExportPath,
  eventOrdersQueryPrefix,
  eventOrdersTabPath,
  EXPORT_CSV_ERROR,
  EXPORT_CSV_LABEL,
  isFiltered,
  NO_ORDERS_FILTER,
  ORDER_FILTER_CHIPS,
  ORDER_FILTER_SLUG,
  orderAmountLines,
  orderHistoryLabel,
  orderItemsLabel,
  ordersFilterFromParams,
  ordersFilterKey,
  ordersTabQuery,
  orderTimeLines,
  ticketBadge,
  ticketSeqLabel,
} from '@/lib/reporting/orders';
import { NEEDS_ACTION_LINK } from '@/lib/reporting/review-queue';

/*
 * Story 6.1: tab Đơn — bộ lọc trên URL, nhãn chip, nhãn lịch sử, "Vé theo Hạng vé", khóa query. Story 6.3: đường xuất
 * CSV theo bộ lọc, tên file, tải `Blob`.
 */

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';

const params = (query: string) => new URLSearchParams(query);

describe('bộ lọc ↔ URL', () => {
  it('chip theo thứ tự UX, mỗi chip một slug riêng', () => {
    expect(ORDER_FILTER_CHIPS.map((c) => c.label)).toEqual([
      'Tất cả',
      'Đã thanh toán',
      'Chờ thanh toán',
      'Cần xử lý',
      'Đã hủy',
      'Đã hoàn tay',
    ]);
    expect(ORDER_FILTER_SLUG).toEqual({
      paid: 'da-thanh-toan',
      pending: 'cho-thanh-toan',
      needs_action: 'can-xu-ly',
      cancelled: 'da-huy',
      refunded: 'da-hoan-tay',
    });
  });

  it('đọc trangThai/tim; giá trị lạ bị bỏ qua (chip không có, chữ tìm không nhận ra)', () => {
    expect(ordersFilterFromParams(params('tab=don&trangThai=can-xu-ly&tim=0912345678'))).toEqual({
      status: 'needs_action',
      search: '0912345678',
    });
    expect(ordersFilterFromParams(params('tab=don&tim=%20Minh%40X.vn%20'))).toEqual({ status: null, search: 'Minh@X.vn' });
    expect(ordersFilterFromParams(params('tab=don&trangThai=het-han&tim=0912'))).toEqual(NO_ORDERS_FILTER);
    expect(ordersFilterFromParams(params('trangThai=needs_action&tim='))).toEqual(NO_ORDERS_FILTER);
    expect(ordersFilterFromParams(params(''))).toEqual(NO_ORDERS_FILTER);
  });

  it('ghi URL: tab=don, rồi trangThai, tim khi có; đọc lại ra cùng bộ lọc', () => {
    expect(ordersTabQuery()).toBe('tab=don');
    const filter = { status: 'paid', search: 'tk1234abcd' } as const;
    expect(ordersTabQuery(filter)).toBe('tab=don&trangThai=da-thanh-toan&tim=tk1234abcd');
    expect(ordersFilterFromParams(params(ordersTabQuery(filter)))).toEqual(filter);
    expect(ordersFilterKey(filter)).not.toBe(ordersFilterKey(NO_ORDERS_FILTER));
    expect(isFiltered(NO_ORDERS_FILTER)).toBe(false);
    expect(isFiltered({ status: null, search: 'minh@x.vn' })).toBe(true);
  });

  it('link sang tab Đơn từ Tổng quan: "Xem tất cả Đơn" và needs-action-card lọc Cần xử lý', () => {
    expect(eventOrdersTabPath(ORG, EVENT)).toBe(`/btc/${ORG}/su-kien/${EVENT}?tab=don`);
    expect(eventOrdersTabPath(ORG, EVENT, { status: 'needs_action', search: null })).toBe(
      `/btc/${ORG}/su-kien/${EVENT}?tab=don&trangThai=can-xu-ly`,
    );
    expect(NEEDS_ACTION_LINK).toBe('Mở tab Đơn, lọc Cần xử lý');
  });
});

describe('nhãn', () => {
  it('Vé theo Hạng vé: "2 × VIP, 1 × Thường"; không có dòng → "—"', () => {
    expect(
      orderItemsLabel([
        { ticketTypeName: 'VIP', quantity: 2 },
        { ticketTypeName: 'Thường', quantity: 1 },
      ]),
    ).toBe('2 × VIP, 1 × Thường');
    expect(orderItemsLabel([])).toBe('—');
  });

  it('thời gian theo giờ Việt Nam: lúc tạo, thêm lúc thanh toán nếu có', () => {
    const now = Date.parse('2026-11-12T10:00:00+07:00');
    expect(orderTimeLines({ createdAt: '2026-11-12T01:12:00Z', paidAt: null }, now)).toEqual(['Tạo 08:12']);
    expect(orderTimeLines({ createdAt: '2026-11-11T15:10:00Z', paidAt: '2026-11-12T01:13:00Z' }, now)).toEqual([
      'Tạo 11/11 · 22:10',
      'Thanh toán 08:13',
    ]);
  });

  it('số tiền: tổng, kèm "đã nhận" khi khác tổng', () => {
    expect(orderAmountLines({ totalAmount: 300_000, paidAmount: 250_000 })).toEqual({
      total: '300.000đ',
      received: 'đã nhận 250.000đ',
    });
    expect(orderAmountLines({ totalAmount: 300_000, paidAmount: 300_000 })).toEqual({ total: '300.000đ', received: null });
    expect(orderAmountLines({ totalAmount: 300_000, paidAmount: null })).toEqual({ total: '300.000đ', received: null });
  });

  it('lịch sử: mỗi loại một nhãn, kèm loại Cần xử lý hoặc nguồn thanh toán', () => {
    const at = '2026-11-12T01:12:00Z';
    expect(orderHistoryLabel({ kind: 'created', at })).toBe('Tạo Đơn');
    expect(orderHistoryLabel({ kind: 'review_opened', at, reviewType: 'amount_mismatch' })).toBe('Cần xử lý · Lệch số tiền');
    expect(orderHistoryLabel({ kind: 'paid', at, paidSource: 'manual' })).toBe('Đã thanh toán · Duyệt tay');
    expect(orderHistoryLabel({ kind: 'paid', at, paidSource: 'ipn' })).toBe('Đã thanh toán · Cổng thanh toán');
    expect(orderHistoryLabel({ kind: 'paid', at, paidSource: 'reconciliation' })).toBe('Đã thanh toán · Đối soát bù');
    expect(orderHistoryLabel({ kind: 'paid', at, paidSource: 'free' })).toBe('Đã thanh toán · Miễn phí');
    expect(orderHistoryLabel({ kind: 'expired', at })).toBe('Hết hạn');
    expect(orderHistoryLabel({ kind: 'cancelled', at })).toBe('Đã hủy');
    expect(orderHistoryLabel({ kind: 'refunded', at })).toBe('Đã hoàn tay');
  });

  it('Vé: "Vé k/N"; badge Hợp lệ (success), Đã check-in (neutral), Đã hủy (danger)', () => {
    expect(ticketSeqLabel({ seq: 2, orderTicketCount: 3 })).toBe('Vé 2/3');
    expect(ticketBadge({ status: 'valid', checkedInAt: null })).toEqual({ label: 'Hợp lệ', tone: 'success' });
    expect(ticketBadge({ status: 'valid', checkedInAt: '2026-11-12T01:12:00Z' })).toEqual({
      label: 'Đã check-in',
      tone: 'neutral',
    });
    expect(ticketBadge({ status: 'cancelled', checkedInAt: null })).toEqual({ label: 'Đã hủy', tone: 'danger' });
  });

  it('dòng Cần xử lý ở mọi trạng thái Đơn (tab Đơn); "Đơn gần đây" vẫn chỉ cho Đơn review', () => {
    const paidDuplicate = {
      status: 'paid',
      totalAmount: 300_000,
      review: { type: 'duplicate_payment', receivedAmount: 300_000 },
    } as const;
    expect(reviewItemLine(paidDuplicate)).toBe('Thanh toán trùng');
    expect(reviewLine(paidDuplicate)).toBeNull();
    expect(reviewItemLine({ totalAmount: 300_000, review: { type: 'amount_mismatch', receivedAmount: 250_000 } })).toBe(
      'Lệch số tiền · nhận 250.000đ / Đơn 300.000đ',
    );
    expect(reviewItemLine({ totalAmount: 300_000, review: null })).toBeNull();
  });
});

describe('khóa query', () => {
  it('danh sách theo bộ lọc và cursor, chi tiết theo mã; cùng gốc của Sự kiện', () => {
    const prefix = eventOrdersQueryPrefix(ORG, EVENT);
    const first = eventOrdersQueryKey(ORG, EVENT, NO_ORDERS_FILTER, null);
    const next = eventOrdersQueryKey(ORG, EVENT, NO_ORDERS_FILTER, 'abc');
    const filtered = eventOrdersQueryKey(ORG, EVENT, { status: 'paid', search: null }, null);
    expect(first.slice(0, prefix.length)).toEqual([...prefix]);
    expect(first).not.toEqual(next);
    expect(first).not.toEqual(filtered);
    expect(eventOrderQueryKey(ORG, EVENT, 'TK8F3Q2AXM').slice(0, prefix.length)).toEqual([...prefix]);
  });
});

describe('xuất CSV (Story 6.3)', () => {
  it('nút và toast lỗi', () => {
    expect(EXPORT_CSV_LABEL).toBe('Xuất CSV');
    expect(EXPORT_CSV_ERROR).toBe('Chưa xuất được CSV. Vui lòng thử lại.');
  });

  it('đường xuất theo bộ lọc đang áp dụng: chip → status, chữ tìm đã gửi → q; không lọc → không query', () => {
    const base = `/orgs/${ORG}/events/${EVENT}/orders/export`;
    expect(eventOrdersExportPath(ORG, EVENT, NO_ORDERS_FILTER)).toBe(base);
    expect(eventOrdersExportPath(ORG, EVENT, { status: 'paid', search: 'Minh@X.vn' })).toBe(`${base}?status=paid&q=Minh%40X.vn`);
    expect(eventOrdersExportPath(ORG, EVENT, { status: null, search: '0912 345 678' })).toBe(`${base}?q=0912+345+678`);
    // Cùng bộ lọc đọc từ URL tab Đơn.
    const filter = ordersFilterFromParams(params('tab=don&trangThai=can-xu-ly&tim=tk1234abcd'));
    expect(eventOrdersExportPath(ORG, EVENT, filter)).toBe(`${base}?status=needs_action&q=tk1234abcd`);
  });

  it('tên file từ Content-Disposition; thiếu hoặc lạ → don.csv', () => {
    expect(csvFilenameOf('attachment; filename="don-giai-chay-a1b2-20261127-0005.csv"')).toBe(
      'don-giai-chay-a1b2-20261127-0005.csv',
    );
    expect(csvFilenameOf('attachment; filename=don-x.csv')).toBe('don-x.csv');
    expect(csvFilenameOf('attachment; filename="../../etc/x.csv"')).toBe('x.csv');
    expect(csvFilenameOf('attachment')).toBe('don.csv');
    expect(csvFilenameOf('attachment; filename=""')).toBe('don.csv');
    expect(csvFilenameOf(null)).toBe('don.csv');
  });

  describe('downloadEventOrdersCsv', () => {
    const fetchMock = vi.fn<typeof fetch>();
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      fetchMock.mockReset();
    });

    it('fetch kèm cookie theo bộ lọc, trả Blob và tên file của api', async () => {
      fetchMock.mockResolvedValue(
        new Response('\uFEFFMã Đơn\r\n', {
          status: 200,
          headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="don-x-20261127-0005.csv"' },
        }),
      );
      const { blob, filename } = await downloadEventOrdersCsv(ORG, EVENT, { status: 'paid', search: 'minh@x.vn' });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`http://api.test/v1/orgs/${ORG}/events/${EVENT}/orders/export?status=paid&q=minh%40x.vn`);
      expect(init?.credentials).toBe('include');
      expect(filename).toBe('don-x-20261127-0005.csv');
      expect([...new Uint8Array(await blob.arrayBuffer())].slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
    });

    it('thiếu Content-Disposition (CORS chưa mở header) → don.csv', async () => {
      fetchMock.mockResolvedValue(new Response('x', { status: 200, headers: { 'content-type': 'text/csv' } }));
      expect((await downloadEventOrdersCsv(ORG, EVENT, NO_ORDERS_FILTER)).filename).toBe('don.csv');
    });
  });
});
