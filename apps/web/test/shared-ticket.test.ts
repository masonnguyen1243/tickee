import { SharedTicketView } from '@tickee/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { fetchSharedTicket, regenerateShareLink } from '@/lib/order/api';
import { sharedTicketTokenFromHash } from '@/lib/order/shared-ticket';

/* Story 3.8: token của link `/xem-ve#<token>` và lời gọi API của trang Vé được chia sẻ / "Tạo lại link". */

const TOKEN = 'Zx9_aB3-kLm0Qr7Tu1Vw2y';
const TICKET = '019a3b2c-0b00-7abc-8def-000000000001';
const VIEW: SharedTicketView = {
  eventName: 'Giải Pickleball mùa thu',
  eventStartsAt: '2099-11-16T07:00:00+07:00',
  venue: null,
  ticketTypeName: 'Đơn nam',
  seq: 1,
  count: 2,
  status: 'valid',
  qr: `t1.${TICKET}.${'q'.repeat(43)}`,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sharedTicketTokenFromHash', () => {
  it('lấy token 22 ký tự base64url sau #', () => {
    expect(sharedTicketTokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(sharedTicketTokenFromHash(TOKEN)).toBe(TOKEN);
    expect(sharedTicketTokenFromHash(`# ${TOKEN} `)).toBe(TOKEN);
  });

  it.each(['', '#', `#${TOKEN}A`, `#${TOKEN.slice(1)}`, `#${TOKEN.slice(1)}=`, '#abc?x=1'])('"%s" → null', (hash) => {
    expect(sharedTicketTokenFromHash(hash)).toBeNull();
  });
});

describe('API Vé được chia sẻ', () => {
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

  it('fetchSharedTicket: GET /v1/shared-tickets/:token không kèm cookie, không Referer', async () => {
    fetchMock.mockResolvedValue(json(200, VIEW));
    await expect(fetchSharedTicket(TOKEN)).resolves.toEqual(VIEW);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://api.test/v1/shared-tickets/${TOKEN}`);
    expect(init?.credentials).toBe('omit');
    expect(init?.referrerPolicy).toBe('no-referrer');
    expect(init?.method).toBeUndefined();
  });

  it('fetchSharedTicket: 404 → ApiError SHARED_TICKET_NOT_FOUND', async () => {
    fetchMock.mockResolvedValue(
      json(404, { error: { code: 'SHARED_TICKET_NOT_FOUND', message: 'Link không đúng hoặc không còn hiệu lực.', details: null } }),
    );
    await expect(fetchSharedTicket(TOKEN)).rejects.toMatchObject({ code: 'SHARED_TICKET_NOT_FOUND', status: 404 });
    await expect(fetchSharedTicket(TOKEN)).rejects.toBeInstanceOf(ApiError);
  });

  it('regenerateShareLink: POST /v1/me/tickets/:id/share-link kèm cookie, trả token mới', async () => {
    fetchMock.mockResolvedValue(json(200, { shareToken: TOKEN }));
    await expect(regenerateShareLink(TICKET)).resolves.toEqual({ shareToken: TOKEN });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://api.test/v1/me/tickets/${TICKET}/share-link`);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
  });
});
