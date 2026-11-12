import { describe, expect, it } from 'vitest';
import {
  EventOverview,
  eventOverviewApiPath,
  eventOverviewLiveApiPath,
  RECENT_ORDERS_LIMIT,
  RecentOrder,
} from '../src/reporting.js';

/* Story 3.11: Tổng quan Sự kiện — `EventOverview` (doanh thu + Đơn gần đây) và đường API/SSE. */

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';

const order = (patch: Record<string, unknown> = {}) => ({
  code: 'TK8F3Q2AXM',
  buyerName: 'Nguyễn Văn Minh',
  ticketCount: 2,
  totalAmount: 450_000,
  status: 'paid',
  createdAt: '2026-11-12T01:12:00.000Z',
  review: null,
  ...patch,
});

describe('EventOverview', () => {
  it('doanh thu + tối đa 5 Đơn, mọi trạng thái; Đơn review kèm loại và số tiền nhận', () => {
    const parsed = EventOverview.parse({
      revenue: { amount: 450_000, paidOrders: 2 },
      recentOrders: [
        order(),
        order({ code: 'TK5R8W1CAB', status: 'review', review: { type: 'amount_mismatch', receivedAmount: 250_000 } }),
        order({ code: 'TK3J6N4DAB', status: 'pending' }),
        order({ code: 'TK1Q4Z8HAB', status: 'expired', createdAt: '2026-11-11T22:10:00+07:00' }),
        order({ code: 'TK9B2X7EAB', status: 'paid', totalAmount: 0 }),
      ],
    });
    expect(parsed.recentOrders).toHaveLength(RECENT_ORDERS_LIMIT);
    expect(parsed.recentOrders[1]!.review).toEqual({ type: 'amount_mismatch', receivedAmount: 250_000 });
  });

  it('chưa có Đơn: 0đ, 0 Đơn, danh sách rỗng', () => {
    expect(EventOverview.parse({ revenue: { amount: 0, paidOrders: 0 }, recentOrders: [] })).toEqual({
      revenue: { amount: 0, paidOrders: 0 },
      recentOrders: [],
    });
  });

  it('từ chối: quá 5 Đơn, mã Đơn sai dạng, trạng thái hay loại lạ, số âm', () => {
    const six = Array.from({ length: RECENT_ORDERS_LIMIT + 1 }, () => order());
    expect(EventOverview.safeParse({ revenue: { amount: 0, paidOrders: 0 }, recentOrders: six }).success).toBe(false);
    expect(RecentOrder.safeParse(order({ code: 'TK123' })).success).toBe(false);
    expect(RecentOrder.safeParse(order({ status: 'confirming' })).success).toBe(false);
    expect(RecentOrder.safeParse(order({ review: { type: 'lost', receivedAmount: 1 } })).success).toBe(false);
    expect(RecentOrder.safeParse(order({ totalAmount: -1 })).success).toBe(false);
    expect(RecentOrder.safeParse(order({ createdAt: '12/11/2026' })).success).toBe(false);
  });

  it('không có id nội bộ, email hay SĐT trong schema', () => {
    expect(Object.keys(RecentOrder.shape).sort()).toEqual(
      ['buyerName', 'code', 'createdAt', 'review', 'status', 'ticketCount', 'totalAmount'].sort(),
    );
  });
});

describe('đường API Tổng quan', () => {
  it('REST và SSE dưới /orgs/:orgId/events/:eventId/overview', () => {
    expect(eventOverviewApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/overview`);
    expect(eventOverviewLiveApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/overview/live`);
    expect(eventOverviewApiPath('a/b', 'c?d')).toBe('/orgs/a%2Fb/events/c%3Fd/overview');
  });
});
