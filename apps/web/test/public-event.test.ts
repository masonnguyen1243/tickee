import type { EventAvailability, TierAvailability } from '@tickee/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAvailability, fetchPublicEvent } from '@/lib/event/public-api';
import { saleBanner, tierStatusText } from '@/lib/event/public-sale';

const TIER_ID = '019a3b2c-0700-7abc-8def-0123456789ab';
const tier = (patch: Partial<TierAvailability>): TierAvailability => ({
  ticketTypeId: TIER_ID,
  status: 'on_sale',
  remaining: 50,
  saleStartsAt: null,
  ...patch,
});
const availability = (eventReason: EventAvailability['eventReason'], tiers: TierAvailability[] = []) => ({
  eventReason,
  tiers,
});

const publicEvent = {
  slug: 'giai-chay-ab12',
  name: 'Giải chạy',
  status: 'published',
  startsAt: '2026-11-15T07:00:00+07:00',
  endsAt: '2026-11-15T17:00:00+07:00',
  venue: null,
  description: null,
  refundPolicy: 'Không hoàn vé.',
  organizationName: 'CLB Chạy',
  ticketTypes: [],
};

describe('fetchPublicEvent / fetchAvailability', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('phần tĩnh: không cookie, cache 30 giây, tag event:{slug}', async () => {
    fetchMock.mockResolvedValue(ok(publicEvent));

    await expect(fetchPublicEvent('giai-chay-ab12')).resolves.toMatchObject({ name: 'Giải chạy' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/events/giai-chay-ab12');
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
    expect((init as RequestInit & { next?: unknown }).next).toEqual({ revalidate: 30, tags: ['event:giai-chay-ab12'] });
  });

  it('ở server có API_INTERNAL_URL → gọi qua địa chỉ nội bộ', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api.internal:3001/');
    fetchMock.mockResolvedValue(ok(publicEvent));

    await fetchPublicEvent('giai-chay-ab12');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.internal:3001/v1/events/giai-chay-ab12');
  });

  it('slug được mã hóa; availability gọi /availability', async () => {
    fetchMock.mockResolvedValue(ok(availability(null, [tier({})])));

    await fetchAvailability('a/b');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.test/v1/events/a%2Fb/availability');
  });
});

describe('saleBanner', () => {
  it('bán bình thường → không banner', () => {
    expect(saleBanner(availability(null, [tier({})]))).toBeNull();
  });

  it.each([
    ['cancelled', 'danger', 'Sự kiện đã hủy'],
    ['locked', 'danger', 'Sự kiện tạm thời không nhận Đơn.'],
    ['hidden', 'warning', 'Sự kiện tạm dừng nhận Đơn'],
    ['ended', 'neutral', 'Sự kiện đã kết thúc'],
  ] as const)('%s → %s "%s"', (reason, tone, title) => {
    expect(saleBanner(availability(reason, [tier({ status: 'unavailable' })]))).toEqual({ tone, title });
  });

  it('paused, còn Hạng vé đang bán → "Một số Hạng vé đang tạm ngừng bán."', () => {
    expect(saleBanner(availability('paused', [tier({ status: 'paused' }), tier({})]))).toEqual({
      tone: 'warning',
      title: 'Một số Hạng vé đang tạm ngừng bán.',
    });
  });

  it('paused, không còn Hạng vé đang bán → "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé."', () => {
    expect(saleBanner(availability('paused', [tier({ status: 'paused' }), tier({ status: 'sold_out' })]))).toEqual({
      tone: 'warning',
      title: 'Sự kiện tạm ngừng bán. Bạn thử lại sau nhé.',
    });
  });
});

describe('tierStatusText', () => {
  it('đang bán: "Còn N vé", ≤ 10 là sắp hết', () => {
    expect(tierStatusText(tier({ remaining: 50 }))).toEqual({ text: 'Còn 50 vé', available: true, lowStock: false });
    expect(tierStatusText(tier({ remaining: 11 })).lowStock).toBe(false);
    expect(tierStatusText(tier({ remaining: 10 })).lowStock).toBe(true);
    expect(tierStatusText(tier({ remaining: 7 }))).toEqual({ text: 'Còn 7 vé', available: true, lowStock: true });
  });

  it('chưa mở bán kèm giờ mở theo giờ Việt Nam', () => {
    expect(tierStatusText(tier({ status: 'not_started', saleStartsAt: '2026-11-14T01:00:00Z' })).text).toBe(
      'Chưa mở bán · mở Thứ bảy, 14/11/2026 · 08:00',
    );
    expect(tierStatusText(tier({ status: 'not_started' })).text).toBe('Chưa mở bán');
  });

  it.each([
    ['sold_out', 'Hết vé'],
    ['closed', 'Đã đóng bán'],
    ['paused', 'Tạm ngừng bán'],
    ['unavailable', 'Không nhận Đơn'],
  ] as const)('%s → "%s", không bán được', (status, text) => {
    expect(tierStatusText(tier({ status }))).toEqual({ text, available: false, lowStock: false });
  });
});
