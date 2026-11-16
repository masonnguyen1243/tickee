import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import {
  REVIEW_BADGE_MAX,
  REVIEW_QUEUE_EVENT_PARAM,
  ReviewItemDetail,
  ReviewQueue,
  ReviewQueueItem,
  ReviewQueueQuery,
  ReviewQueueSummary,
  reviewItemActionApiPath,
  reviewItemApiPath,
  reviewItemsApiPath,
  reviewItemsSummaryApiPath,
  reviewQueuePath,
} from '../src/reporting.js';

/* Story 4.3: hàng Cần xử lý của BTC — schema hàng, đếm, chi tiết, đường API và trang web. */

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';
const ITEM = '019a3b2c-0a01-7abc-8def-0123456789ab';

const item = (patch: Record<string, unknown> = {}) => ({
  id: ITEM,
  type: 'amount_mismatch',
  receivedAmount: 250_000,
  createdAt: '2026-11-16T01:12:00.000Z',
  order: { code: 'TK5R8W1CAB', buyerName: 'Phạm Thu Hà', totalAmount: 300_000 },
  event: { id: EVENT, name: 'Giải cầu lông Ba Đình 2026' },
  ...patch,
});

const detail = (patch: Record<string, unknown> = {}) => ({
  id: ITEM,
  type: 'orphan',
  reason: 'sold_out',
  status: 'open',
  resolution: null,
  createdAt: '2026-11-16T01:12:05.000Z',
  transaction: {
    receivedAmount: 300_000,
    transactionCode: 'FT26320ABCDE',
    paidAt: '2026-11-16T01:12:00.000Z',
    receivedAt: '2026-11-16T01:12:04.000Z',
    paymentMethod: 'qr',
    providerOrderId: null,
  },
  order: {
    code: 'TK5R8W1CAB',
    status: 'review',
    buyerName: 'Phạm Thu Hà',
    ticketCount: 2,
    totalAmount: 300_000,
    createdAt: '2026-11-16T00:58:00.000Z',
  },
  event: { id: EVENT, name: 'Giải cầu lông Ba Đình 2026' },
  log: [
    { kind: 'payment_received', at: '2026-11-16T01:12:00.000Z' },
    { kind: 'item_opened', at: '2026-11-16T01:12:05.000Z' },
  ],
  actions: ['approve', 'reject'],
  approveBlockedReason: null,
  ...patch,
});

describe('ReviewQueue', () => {
  it('hàng gộp: mục có Đơn và mục unmatched (không Đơn, không Sự kiện); không lọc → event null', () => {
    const parsed = ReviewQueue.parse({
      event: null,
      items: [item(), item({ type: 'unmatched', receivedAmount: 75_000, order: null, event: null })],
    });
    expect(parsed.items[1]).toMatchObject({ type: 'unmatched', order: null, event: null });
  });

  it('lọc theo Sự kiện: kèm Sự kiện đang lọc; hàng trống hợp lệ', () => {
    expect(ReviewQueue.parse({ event: { id: EVENT, name: 'Giải A' }, items: [] })).toEqual({
      event: { id: EVENT, name: 'Giải A' },
      items: [],
    });
  });

  it('từ chối: loại lạ, mã Đơn sai dạng, số tiền âm, id sai dạng', () => {
    expect(ReviewQueueItem.safeParse(item({ type: 'lost' })).success).toBe(false);
    expect(ReviewQueueItem.safeParse(item({ order: { code: 'TK1', buyerName: 'A', totalAmount: 1 } })).success).toBe(false);
    expect(ReviewQueueItem.safeParse(item({ receivedAmount: -1 })).success).toBe(false);
    expect(ReviewQueueItem.safeParse(item({ id: 'khong-phai-uuid' })).success).toBe(false);
  });

  it('không có email, SĐT hay id Đơn trong schema hàng', () => {
    expect(Object.keys(ReviewQueueItem.shape).sort()).toEqual(
      ['createdAt', 'event', 'id', 'order', 'receivedAmount', 'type'].sort(),
    );
    const order = ReviewQueueItem.shape.order.unwrap();
    expect(Object.keys(order.shape).sort()).toEqual(['buyerName', 'code', 'totalAmount']);
  });

  it('query: eventId tùy chọn; mảng → không nhận', () => {
    expect(ReviewQueueQuery.parse({})).toEqual({});
    expect(ReviewQueueQuery.parse({ eventId: EVENT })).toEqual({ eventId: EVENT });
    expect(ReviewQueueQuery.safeParse({ eventId: [EVENT, EVENT] }).success).toBe(false);
  });

  it('summary: openCount nguyên không âm; badge tối đa 99', () => {
    expect(ReviewQueueSummary.parse({ openCount: 120 })).toEqual({ openCount: 120 });
    expect(ReviewQueueSummary.safeParse({ openCount: -1 }).success).toBe(false);
    expect(REVIEW_BADGE_MAX).toBe(99);
  });
});

describe('ReviewItemDetail', () => {
  it('giao dịch, Đơn liên quan, Sự kiện, nhật ký; mọi trạng thái của mục', () => {
    expect(ReviewItemDetail.parse(detail())).toEqual(detail());
    expect(ReviewItemDetail.parse(detail({ status: 'resolved', resolution: 'rejected' }))).toMatchObject({
      status: 'resolved',
      resolution: 'rejected',
    });
  });

  it('unmatched: không Đơn, không Sự kiện, có mã Đơn trong giao dịch', () => {
    const parsed = ReviewItemDetail.parse(
      detail({
        type: 'unmatched',
        reason: null,
        order: null,
        event: null,
        transaction: { ...detail().transaction, paidAt: null, providerOrderId: 'TK0000ZZZZ' },
      }),
    );
    expect(parsed.transaction.providerOrderId).toBe('TK0000ZZZZ');
  });

  it('không có trường thô của payment_events hay PII trong schema', () => {
    expect(Object.keys(ReviewItemDetail.shape.transaction.shape).sort()).toEqual(
      ['paidAt', 'paymentMethod', 'providerOrderId', 'receivedAmount', 'receivedAt', 'transactionCode'].sort(),
    );
    expect(Object.keys(ReviewItemDetail.shape.order.unwrap().shape).sort()).toEqual(
      ['buyerName', 'code', 'createdAt', 'status', 'ticketCount', 'totalAmount'].sort(),
    );
  });

  it('từ chối: lý do lạ, trạng thái lạ, dòng nhật ký lạ', () => {
    expect(ReviewItemDetail.safeParse(detail({ reason: 'expired' })).success).toBe(false);
    expect(ReviewItemDetail.safeParse(detail({ status: 'closed' })).success).toBe(false);
    const log = [{ kind: 'approved_by_magic', at: '2026-11-16T01:12:05Z' }];
    expect(ReviewItemDetail.safeParse(detail({ log })).success).toBe(false);
  });

  it('mã lỗi REVIEW_ITEM_NOT_FOUND', () => {
    expect(ErrorCode.REVIEW_ITEM_NOT_FOUND).toBe('REVIEW_ITEM_NOT_FOUND');
  });

  it('Story 4.4: thao tác được phép và lý do tắt "Duyệt tay"; mục đã xử lý → không thao tác', () => {
    const blocked = ReviewItemDetail.parse(detail({ approveBlockedReason: 'event_ended' }));
    expect(blocked).toMatchObject({ actions: ['approve', 'reject'], approveBlockedReason: 'event_ended' });
    expect(ReviewItemDetail.parse(detail({ status: 'resolved', resolution: 'approved', actions: [] })).actions).toEqual([]);
    expect(ReviewItemDetail.safeParse(detail({ actions: ['match'] })).success).toBe(false);
    expect(ReviewItemDetail.safeParse(detail({ approveBlockedReason: 'sold_out' })).success).toBe(false);
    expect(ReviewItemDetail.safeParse(detail({ actions: undefined })).success).toBe(false);
  });

  it('Story 4.4: dòng thao tác của nhật ký kèm tên người làm, dòng "Bỏ qua" kèm lý do', () => {
    const log = [
      { kind: 'payment_received', at: '2026-11-16T01:12:00.000Z' },
      { kind: 'item_opened', at: '2026-11-16T01:12:05.000Z' },
      { kind: 'approve_sold_out', at: '2026-11-16T02:00:00.000Z', actorName: 'Lê Minh' },
      { kind: 'rejected', at: '2026-11-16T02:01:00.000Z', actorName: '' },
      { kind: 'refunded', at: '2026-11-16T02:02:00.000Z', actorName: 'Lê Minh' },
    ];
    expect(ReviewItemDetail.parse(detail({ log })).log).toEqual(log);
    const dismissed = [{ kind: 'dismissed', at: '2026-11-16T02:02:00.000Z', actorName: 'An', note: 'Khách chuyển nhầm' }];
    expect(ReviewItemDetail.parse(detail({ log: dismissed })).log).toEqual(dismissed);
    expect(ReviewItemDetail.parse(detail({ log: [{ kind: 'approved', at: '2026-11-16T02:00:00Z' }] })).log).toHaveLength(1);
  });
});

describe('đường API và trang web', () => {
  it('REST dưới /orgs/:orgId/review-items; lọc bằng ?eventId=', () => {
    expect(reviewItemsApiPath(ORG)).toBe(`/orgs/${ORG}/review-items`);
    expect(reviewItemsApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/review-items?eventId=${EVENT}`);
    expect(reviewItemsSummaryApiPath(ORG)).toBe(`/orgs/${ORG}/review-items/summary`);
    expect(reviewItemApiPath(ORG, ITEM)).toBe(`/orgs/${ORG}/review-items/${ITEM}`);
    expect(reviewItemApiPath('a/b', 'c?d')).toBe('/orgs/a%2Fb/review-items/c%3Fd');
    expect(reviewItemsApiPath(ORG, 'a&b')).toBe(`/orgs/${ORG}/review-items?eventId=a%26b`);
  });

  it('Story 4.4: POST thao tác dưới đường của mục', () => {
    for (const action of ['approve', 'reject', 'refund', 'dismiss'] as const) {
      expect(reviewItemActionApiPath(ORG, ITEM, action)).toBe(`/orgs/${ORG}/review-items/${ITEM}/${action}`);
    }
    expect(reviewItemActionApiPath('a/b', 'c?d', 'approve')).toBe('/orgs/a%2Fb/review-items/c%3Fd/approve');
  });

  it('trang web: /btc/{id}/can-xu-ly, lọc bằng ?suKien=', () => {
    expect(REVIEW_QUEUE_EVENT_PARAM).toBe('suKien');
    expect(reviewQueuePath(ORG)).toBe(`/btc/${ORG}/can-xu-ly`);
    expect(reviewQueuePath(ORG, EVENT)).toBe(`/btc/${ORG}/can-xu-ly?suKien=${EVENT}`);
  });
});
