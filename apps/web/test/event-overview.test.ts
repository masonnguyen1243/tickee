import { EventOverview, eventOverviewApiPath, OrderStatus, ReviewItemType, type RecentOrder } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { eventOverviewQueryKey } from '@/lib/reporting/api';
import {
  EVENT_OVERVIEW_POLL_MS,
  eventOverviewPollInterval,
  ORDER_STATUS_BADGE,
  orderStatusBadge,
  orderTimeLabel,
  REVIEW_TYPE_LABEL,
  revenueCaption,
  reviewLine,
  ticketCountLabel,
  updatedAtLabel,
} from '@/lib/reporting/overview';

/* Story 3.11: nhãn, tone và dòng phụ của Tổng quan Sự kiện (`stat-card` doanh thu, `recent-orders-block`). */

const order = (patch: Partial<RecentOrder> = {}): RecentOrder => ({
  code: 'TK5R8W1CAB',
  buyerName: 'Phạm Thu Hà',
  ticketCount: 2,
  totalAmount: 300_000,
  status: 'review',
  createdAt: '2026-11-12T07:58:00+07:00',
  review: { type: 'amount_mismatch', receivedAmount: 250_000 },
  ...patch,
});

describe('badge trạng thái Đơn (DESIGN.md › status-badge)', () => {
  it('mọi trạng thái có nhãn và tone; Cần xử lý là danger, không bao giờ coral', () => {
    expect(Object.keys(ORDER_STATUS_BADGE).sort()).toEqual(Object.values(OrderStatus).sort());
    expect(orderStatusBadge('pending')).toEqual({ label: 'Chờ thanh toán', tone: 'warning' });
    expect(orderStatusBadge('paid')).toEqual({ label: 'Đã thanh toán', tone: 'success' });
    expect(orderStatusBadge('expired')).toEqual({ label: 'Hết hạn', tone: 'neutral' });
    expect(orderStatusBadge('cancelled')).toEqual({ label: 'Đã hủy', tone: 'neutral' });
    expect(orderStatusBadge('refunded')).toEqual({ label: 'Đã hoàn tay', tone: 'neutral' });
    expect(orderStatusBadge('review')).toEqual({ label: 'Cần xử lý', tone: 'danger' });
  });
});

describe('dòng loại Cần xử lý', () => {
  it('lệch số tiền: "Lệch số tiền · nhận 250.000đ / Đơn 300.000đ"', () => {
    expect(reviewLine(order())).toBe('Lệch số tiền · nhận 250.000đ / Đơn 300.000đ');
  });

  it('loại khác chỉ ghi tên', () => {
    expect(Object.keys(REVIEW_TYPE_LABEL).sort()).toEqual(Object.values(ReviewItemType).sort());
    const cases: [ReviewItemType, string][] = [
      ['orphan', 'Thanh toán mồ côi'],
      ['unmatched', 'Giao dịch chưa khớp'],
      ['duplicate_payment', 'Thanh toán trùng'],
      ['event_cancelled', 'Sự kiện đã hủy'],
    ];
    for (const [type, label] of cases) {
      expect(reviewLine(order({ review: { type, receivedAmount: 300_000 } })), type).toBe(label);
    }
  });

  it('không rõ số tiền nhận → chỉ tên loại; Đơn không ở review hoặc không còn mục mở → không có dòng', () => {
    expect(reviewLine(order({ review: { type: 'amount_mismatch', receivedAmount: null } }))).toBe('Lệch số tiền');
    expect(reviewLine(order({ review: null }))).toBeNull();
    expect(reviewLine(order({ status: 'paid', review: null }))).toBeNull();
    // Dữ liệu lạ (review ở Đơn không còn review) cũng không hiện dòng.
    expect(reviewLine(order({ status: 'paid' }))).toBeNull();
  });
});

describe('nhãn giờ (giờ Việt Nam, không theo múi giờ máy)', () => {
  const now = Date.parse('2026-11-12T10:00:00+07:00');

  it('cùng ngày với hôm nay → HH:mm; khác ngày → dd/MM · HH:mm', () => {
    expect(orderTimeLabel('2026-11-12T08:12:00+07:00', now)).toBe('08:12');
    expect(orderTimeLabel('2026-11-12T00:00:00+07:00', now)).toBe('00:00');
    expect(orderTimeLabel('2026-11-11T22:10:00+07:00', now)).toBe('11/11 · 22:10');
    // 11/11 17:30 UTC = 12/11 00:30 giờ Việt Nam: cùng ngày dù UTC còn là hôm trước.
    expect(orderTimeLabel('2026-11-11T17:30:00Z', now)).toBe('00:30');
    // 11/11 16:59 UTC = 11/11 23:59 giờ Việt Nam: hôm qua.
    expect(orderTimeLabel('2026-11-11T16:59:00Z', now)).toBe('11/11 · 23:59');
  });

  it('"Cập nhật lúc HH:MM" theo lần tải thành công gần nhất', () => {
    expect(updatedAtLabel(Date.parse('2026-11-12T03:04:00Z'))).toBe('Cập nhật lúc 10:04');
  });
});

describe('stat-card doanh thu và cột Vé', () => {
  it('dòng phụ và số Vé', () => {
    expect(revenueCaption(0)).toBe('Chỉ tính Đơn Đã thanh toán · 0 Đơn');
    expect(revenueCaption(48)).toBe('Chỉ tính Đơn Đã thanh toán · 48 Đơn');
    expect(ticketCountLabel(1)).toBe('1 Vé');
    expect(ticketCountLabel(12)).toBe('12 Vé');
  });
});

describe('tải và tự cập nhật', () => {
  it('polling 10 giây khi không có SSE; khóa query riêng từng Sự kiện; schema của contracts', () => {
    expect(EVENT_OVERVIEW_POLL_MS).toBe(10_000);
    expect(eventOverviewPollInterval()).toBe(10_000);
    expect(eventOverviewQueryKey('o', 'e')).toEqual(['reporting', 'event-overview', 'o', 'e']);
    expect(eventOverviewQueryKey('o', 'e')).not.toEqual(eventOverviewQueryKey('o', 'f'));
    expect(eventOverviewApiPath('o', 'e')).toBe('/orgs/o/events/e/overview');
    expect(EventOverview.safeParse({ revenue: { amount: 0, paidOrders: 0 }, recentOrders: [order()] }).success).toBe(true);
  });
});
