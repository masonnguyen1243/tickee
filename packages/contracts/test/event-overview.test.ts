import { describe, expect, it } from 'vitest';
import {
  EventOverview,
  eventOverviewApiPath,
  eventOverviewLiveApiPath,
  EventOverviewTicketType,
  RECENT_ORDERS_LIMIT,
  RecentOrder,
} from '../src/reporting.js';

/*
 * Story 3.11: Tổng quan Sự kiện — `EventOverview` (doanh thu + Đơn gần đây) và đường API/SSE. Story 6.2: số check-in và
 * Vé theo Hạng vé.
 */

const ORG = '019a3b2c-5678-7abc-8def-0123456789ab';
const EVENT = '019a3b2c-0712-7abc-8def-0123456789ab';

/** Phần Story 6.2 của một Tổng quan chưa có Vé, Hạng vé nào. */
const NO_TICKETS = { checkin: { checkedInCount: 0, validTicketCount: 0 }, ticketTypes: [] };

const ticketType = (patch: Record<string, unknown> = {}) => ({
  name: 'Đơn nam',
  price: 150_000,
  capacity: 32,
  sold: 30,
  held: 0,
  remaining: 2,
  ...patch,
});

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
      ...NO_TICKETS,
      revenue: { amount: 450_000, paidOrders: 2 },
      openReviewCount: 2,
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

  it('chưa có Đơn: 0đ, 0 Đơn, danh sách rỗng, 0 mục Cần xử lý, check-in 0/0, không Hạng vé', () => {
    const empty = { revenue: { amount: 0, paidOrders: 0 }, recentOrders: [], openReviewCount: 0, ...NO_TICKETS };
    expect(EventOverview.parse(empty)).toEqual(empty);
  });

  it('openReviewCount (Story 4.3) bắt buộc, số nguyên không âm', () => {
    const base = { revenue: { amount: 0, paidOrders: 0 }, recentOrders: [], ...NO_TICKETS };
    expect(EventOverview.safeParse(base).success).toBe(false);
    expect(EventOverview.safeParse({ ...base, openReviewCount: -1 }).success).toBe(false);
    expect(EventOverview.safeParse({ ...base, openReviewCount: 1.5 }).success).toBe(false);
  });

  it('từ chối: quá 5 Đơn, mã Đơn sai dạng, trạng thái hay loại lạ, số âm', () => {
    const six = Array.from({ length: RECENT_ORDERS_LIMIT + 1 }, () => order());
    const tooMany = { revenue: { amount: 0, paidOrders: 0 }, recentOrders: six, openReviewCount: 0, ...NO_TICKETS };
    expect(EventOverview.safeParse(tooMany).success).toBe(false);
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
    expect(Object.keys(EventOverviewTicketType.shape).sort()).toEqual(
      ['capacity', 'held', 'name', 'price', 'remaining', 'sold'].sort(),
    );
  });

  it('Story 6.2: checkin và ticketTypes bắt buộc; số nguyên không âm; Hạng vé giữ thứ tự api', () => {
    const base = { revenue: { amount: 0, paidOrders: 0 }, recentOrders: [], openReviewCount: 0 };
    const types = [ticketType(), ticketType({ name: 'Đơn nữ', price: 0, capacity: 16, sold: 16, remaining: 0 })];
    const checkin = { checkedInCount: 41, validTicketCount: 66 };
    const parsed = EventOverview.parse({ ...base, checkin, ticketTypes: types });
    expect(parsed.checkin).toEqual({ checkedInCount: 41, validTicketCount: 66 });
    expect(parsed.ticketTypes.map((t) => t.name)).toEqual(['Đơn nam', 'Đơn nữ']);

    expect(EventOverview.safeParse({ ...base, ticketTypes: [] }).success).toBe(false);
    expect(EventOverview.safeParse({ ...base, checkin: NO_TICKETS.checkin }).success).toBe(false);
    expect(
      EventOverview.safeParse({ ...base, ...NO_TICKETS, checkin: { checkedInCount: -1, validTicketCount: 0 } }).success,
    ).toBe(false);
    for (const field of ['price', 'capacity', 'sold', 'held', 'remaining']) {
      expect(EventOverviewTicketType.safeParse(ticketType({ [field]: -1 })).success, field).toBe(false);
      expect(EventOverviewTicketType.safeParse(ticketType({ [field]: 1.5 })).success, field).toBe(false);
    }
  });
});

describe('đường API Tổng quan', () => {
  it('REST và SSE dưới /orgs/:orgId/events/:eventId/overview', () => {
    expect(eventOverviewApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/overview`);
    expect(eventOverviewLiveApiPath(ORG, EVENT)).toBe(`/orgs/${ORG}/events/${EVENT}/overview/live`);
    expect(eventOverviewApiPath('a/b', 'c?d')).toBe('/orgs/a%2Fb/events/c%3Fd/overview');
  });
});
