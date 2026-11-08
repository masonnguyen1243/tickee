import { describe, expect, it } from 'vitest';
import {
  EVENT_SALE_REASON_ORDER,
  EVENT_UNAVAILABLE_REASONS,
  EventAvailability,
  PublicEvent,
} from '../src/sellability.js';

const TIER_ID = '0192f0a0-0000-7000-8000-000000000001';

describe('trạng thái bán', () => {
  it('thứ tự ưu tiên của eventReason; bốn lý do đầu làm mọi Hạng vé unavailable', () => {
    expect(EVENT_SALE_REASON_ORDER).toEqual(['cancelled', 'locked', 'ended', 'hidden', 'paused']);
    expect(EVENT_UNAVAILABLE_REASONS).toEqual(['cancelled', 'locked', 'ended', 'hidden']);
  });

  it('EventAvailability nhận eventReason null, từ chối status lạ và remaining âm', () => {
    const tier = { ticketTypeId: TIER_ID, status: 'on_sale', remaining: 50, saleStartsAt: null };
    expect(EventAvailability.parse({ eventReason: null, tiers: [tier] })).toEqual({ eventReason: null, tiers: [tier] });
    expect(EventAvailability.safeParse({ eventReason: 'lạ', tiers: [] }).success).toBe(false);
    expect(EventAvailability.safeParse({ eventReason: null, tiers: [{ ...tier, status: 'lạ' }] }).success).toBe(false);
    expect(EventAvailability.safeParse({ eventReason: null, tiers: [{ ...tier, remaining: -1 }] }).success).toBe(false);
  });

  it('PublicEvent có tên BTC và Hạng vé tĩnh, bỏ các trường số vé', () => {
    const event = PublicEvent.parse({
      slug: 'giai-chay-abcd',
      name: 'Giải chạy',
      status: 'published',
      startsAt: '2026-11-16T07:00:00+07:00',
      endsAt: '2026-11-16T17:00:00+07:00',
      venue: null,
      description: null,
      refundPolicy: 'Hoàn 100%.',
      organizationName: 'CLB Chạy Bộ',
      ticketTypes: [
        {
          id: TIER_ID,
          name: 'Phổ thông',
          description: null,
          price: 100_000,
          saleStartsAt: null,
          saleEndsAt: null,
          capacity: 50,
          sold: 3,
        },
      ],
    });
    expect(event.ticketTypes[0]).toEqual({
      id: TIER_ID,
      name: 'Phổ thông',
      description: null,
      price: 100_000,
      saleStartsAt: null,
      saleEndsAt: null,
    });
  });
});
