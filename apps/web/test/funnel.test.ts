import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newFunnelId, sendFunnelEvent } from '@/lib/event/funnel';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FUNNEL = '5f0c6b8e-2a4d-4c1e-9b7a-3d2f1e0a9c8b';

describe('newFunnelId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uuid v4, mỗi lần một giá trị', () => {
    const a = newFunnelId();
    expect(a).toMatch(UUID_V4);
    expect(newFunnelId()).not.toBe(a);
  });

  it('không có crypto.randomUUID (không phải secure context) → vẫn ra uuid v4', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const a = newFunnelId();
    expect(a).toMatch(UUID_V4);
    expect(newFunnelId()).not.toBe(a);
  });
});

describe('sendFunnelEvent', () => {
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

  it('POST JSON tới /v1/events/:slug/funnel-events, keepalive, không gửi cookie, không chờ', () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const result = sendFunnelEvent('giai-chay-ab12', { type: 'buy_clicked', funnelId: FUNNEL, loginRequired: true });
    expect(result).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/events/giai-chay-ab12/funnel-events');
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ type: 'buy_clicked', funnelId: FUNNEL, loginRequired: true });
  });

  it('bản keepalive lỗi → thử lại một lần bản thường; lỗi nữa thì nuốt', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    sendFunnelEvent('giai-chay-ab12', { type: 'login_completed', funnelId: FUNNEL });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ keepalive: false, credentials: 'omit' });
  });

  it('thiếu biến môi trường hoặc fetch ném đồng bộ → không ném ra ngoài', () => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
    expect(() => sendFunnelEvent('a', { type: 'login_completed', funnelId: FUNNEL })).not.toThrow();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    fetchMock.mockImplementation(() => {
      throw new TypeError('đồng bộ');
    });
    expect(() => sendFunnelEvent('a', { type: 'login_completed', funnelId: FUNNEL })).not.toThrow();
  });
});
