import { describe, expect, it } from 'vitest';
import { EventDetail } from '../src/event.js';
import {
  EventOrderLimitInput,
  exceedsFreeEventCap,
  FREE_EVENT_TICKET_CAP,
  MIN_PAID_PRICE,
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
  it('chỉ khi mọi Hạng vé 0đ và tổng > 200', () => {
    expect(FREE_EVENT_TICKET_CAP).toBe(200);
    expect(exceedsFreeEventCap([])).toBe(false);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 200 }])).toBe(false);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 120 }, { price: 0, capacity: 90 }])).toBe(true);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 150 }, { price: 300_000, capacity: 100 }])).toBe(false);
    expect(exceedsFreeEventCap([{ price: 0, capacity: 250 }])).toBe(true);
  });
});
