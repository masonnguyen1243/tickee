import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import { EventDetail } from '../src/event.js';
import {
  EventOrderLimitInput,
  exceedsFreeEventCap,
  FREE_EVENT_TICKET_CAP,
  MIN_PAID_PRICE,
  PaidTicketTypeNotAllowedDetails,
  TicketTypeInput,
} from '../src/ticket-type.js';

const base = { name: 'Đơn nam', price: 300_000, capacity: 32 };
const paths = (value: unknown) => {
  const parsed = TicketTypeInput.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
};

describe('TicketTypeInput', () => {
  it('hợp lệ tối thiểu: mô tả và giờ bán trống → null', () => {
    expect(TicketTypeInput.parse({ ...base, description: '  ' })).toEqual({
      ...base,
      description: null,
      saleStartsAt: null,
      saleEndsAt: null,
    });
  });

  it('sàn giá: 0 và 2.000 lưu được; 1.999 và 1.500 lỗi ở price', () => {
    expect(MIN_PAID_PRICE).toBe(2_000);
    expect(paths({ ...base, price: 0 })).toEqual([]);
    expect(paths({ ...base, price: 2_000 })).toEqual([]);
    expect(paths({ ...base, price: 1_999 })).toEqual(['price']);
    expect(paths({ ...base, price: 1_500 })).toEqual(['price']);
  });

  it('giá lẻ, âm, vượt trần; số suất 0 hoặc lẻ → lỗi tại trường', () => {
    expect(paths({ ...base, price: 2_000.5 })).toEqual(['price']);
    expect(paths({ ...base, price: -1 })).toEqual(['price']);
    expect(paths({ ...base, price: 100_000_001 })).toEqual(['price']);
    expect(paths({ ...base, capacity: 0 })).toEqual(['capacity']);
    expect(paths({ ...base, capacity: 1.5 })).toEqual(['capacity']);
    expect(paths({ ...base, capacity: 100_001 })).toEqual(['capacity']);
    expect(paths({ ...base, name: '  ' })).toEqual(['name']);
  });

  it('giờ đóng bán phải sau giờ mở bán khi có cả hai', () => {
    const start = '2026-11-01T08:00:00+07:00';
    expect(paths({ ...base, saleStartsAt: start, saleEndsAt: start })).toEqual(['saleEndsAt']);
    expect(paths({ ...base, saleStartsAt: start, saleEndsAt: '2026-11-01T07:00:00+07:00' })).toEqual(['saleEndsAt']);
    expect(paths({ ...base, saleStartsAt: start, saleEndsAt: '2026-11-01T09:00:00+07:00' })).toEqual([]);
    expect(paths({ ...base, saleStartsAt: start })).toEqual([]);
    expect(paths({ ...base, saleEndsAt: start })).toEqual([]);
    expect(paths({ ...base, saleStartsAt: '2026-11-01T08:00:00' })).toEqual(['saleStartsAt']);
  });
});

describe('EventOrderLimitInput', () => {
  it('khoảng 1–50, số nguyên', () => {
    expect(EventOrderLimitInput.safeParse({ maxTicketsPerOrder: 1 }).success).toBe(true);
    expect(EventOrderLimitInput.safeParse({ maxTicketsPerOrder: 50 }).success).toBe(true);
    expect(EventOrderLimitInput.safeParse({ maxTicketsPerOrder: 0 }).success).toBe(false);
    expect(EventOrderLimitInput.safeParse({ maxTicketsPerOrder: 51 }).success).toBe(false);
    expect(EventOrderLimitInput.safeParse({ maxTicketsPerOrder: 2.5 }).success).toBe(false);
  });

  it('EventDetail có maxTicketsPerOrder', () => {
    expect(EventDetail.shape.maxTicketsPerOrder).toBeDefined();
  });
});

describe('exceedsFreeEventCap', () => {
  it('cộng số suất các Hạng vé 0đ, vượt 200 thì true; không có Hạng vé 0đ → false', () => {
    expect(FREE_EVENT_TICKET_CAP).toBe(200);
    expect(exceedsFreeEventCap([])).toBe(false);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 200 }])).toBe(false);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 201 }])).toBe(true);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 120 }, { price: 0, capacity: 90 }])).toBe(true);
    expect(exceedsFreeEventCap([{ price: 300_000, capacity: 100_000 }])).toBe(false);
  });

  it('Sự kiện hỗn hợp: Hạng vé có phí không tính vào trần và không làm mất trần', () => {
    const paid = { price: 300_000, capacity: 100 };
    // 0đ 150 + có phí: thêm 0đ 60, nâng 0đ lên 210, hoặc đổi Hạng vé có phí 100 suất thành 0đ → vượt.
    expect(exceedsFreeEventCap([{ price: 0, capacity: 150 }, paid])).toBe(false);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 150 }, paid, { price: 0, capacity: 60 }])).toBe(true);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 210 }, paid])).toBe(true);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 150 }, { ...paid, price: 0 }])).toBe(true);
    // Đúng 200 suất 0đ, kèm Hạng vé có phí bao nhiêu suất cũng được.
    expect(
      exceedsFreeEventCap([{ price: 0, capacity: 120 }, { price: 0, capacity: 80 }, { ...paid, capacity: 100_000 }]),
    ).toBe(false);
  });
});

describe('PaidTicketTypeNotAllowedDetails', () => {
  it('unmet là mã điều kiện mở bán; mã lạ bị từ chối', () => {
    expect(ErrorCode.PAID_TICKET_TYPE_NOT_ALLOWED).toBe('PAID_TICKET_TYPE_NOT_ALLOWED');
    expect(ErrorCode.LAST_TICKET_TYPE).toBe('LAST_TICKET_TYPE');
    const unmet = ['CLOSED_BETA_APPROVED', 'PAYOUT_ACCOUNT_LINKED'];
    expect(PaidTicketTypeNotAllowedDetails.parse({ unmet })).toEqual({ unmet });
    expect(PaidTicketTypeNotAllowedDetails.safeParse({ unmet: ['LẠ'] }).success).toBe(false);
  });
});
