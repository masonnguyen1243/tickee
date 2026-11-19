import { request, type APIResponse } from '@playwright/test';
import type { EventDetail, Membership, TicketTypeDetail, VerifyOtpResponse } from '@tickee/contracts';

import { API_ORIGIN, ORGANIZER_EMAIL, saveTestEvent, type TestEvent } from './env';
import { Mailbox } from './mailpit';

/*
 * Chạy sau khi stack và web đã lên (Playwright dựng `webServer` trước global setup). BTC demo của `db:seed` tạo Sự kiện
 * có phí qua API thật, đúng các bước của BTC: đăng nhập OTP (mã đọc ở Mailpit), tạo Sự kiện nháp, đặt chính sách hoàn
 * vé, thêm Hạng vé có phí, rồi "Mở bán". Không tạo gì bằng SQL. DB `tickee_e2e` tạo lại mỗi lượt nên mọi tên cố định.
 */

const DEMO_ORGANIZATION_NAME = 'BTC Demo';
const EVENT_NAME = 'Đêm nhạc E2E full-stack';
const TIER_NAME = 'Vé thường';
const TIER_PRICE = 50_000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function body<T>(res: APIResponse, step: string): Promise<T> {
  if (!res.ok()) throw new Error(`${step}: HTTP ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Giờ Sự kiện như `EventInputDateTime`: giờ Việt Nam, đủ giây, không phần lẻ của giây. */
function vnIso(time: number): string {
  return `${new Date(time + 7 * 60 * 60 * 1000).toISOString().slice(0, 19)}+07:00`;
}

export default async function globalSetup(): Promise<void> {
  const api = await request.newContext({ baseURL: API_ORIGIN });
  try {
    const mailbox = await Mailbox.open(ORGANIZER_EMAIL);
    await body(await api.post('/v1/identity/otp', { data: { email: ORGANIZER_EMAIL } }), 'Gửi mã OTP cho BTC demo');
    const otp = await mailbox.otp();
    const verified = await body<VerifyOtpResponse>(
      await api.post('/v1/identity/otp/verify', { data: { email: ORGANIZER_EMAIL, otp } }),
      'Xác minh mã OTP của BTC demo',
    );
    if (verified.consentRequired) throw new Error('BTC demo chưa đồng ý NĐ 13: db:seed của stack không chạy?');

    const memberships = await body<Membership[]>(await api.get('/v1/me/memberships'), 'Đọc BTC của BTC demo');
    const organization = memberships.find((m) => m.name === DEMO_ORGANIZATION_NAME && m.role === 'owner');
    if (!organization) throw new Error(`BTC demo không là Owner của "${DEMO_ORGANIZATION_NAME}"`);
    const events = `/v1/orgs/${organization.organizationId}/events`;

    const startsAt = Date.now() + 30 * DAY_MS;
    const draft = {
      name: EVENT_NAME,
      startsAt: vnIso(startsAt),
      endsAt: vnIso(startsAt + 3 * 60 * 60 * 1000),
      venue: 'Nhà hát E2E, Quận 1',
      description: 'Sự kiện do bộ Playwright full-stack tạo.',
    };
    const event = await body<EventDetail>(await api.post(events, { data: draft }), 'Tạo Sự kiện nháp');
    await body<EventDetail>(
      await api.patch(`${events}/${event.id}`, {
        data: { ...draft, refundPolicy: 'Hoàn 100% nếu hủy trước Sự kiện 7 ngày.', imageKey: null },
      }),
      'Đặt chính sách hoàn vé',
    );
    await body<TicketTypeDetail>(
      await api.post(`${events}/${event.id}/ticket-types`, {
        data: {
          name: TIER_NAME,
          description: null,
          price: TIER_PRICE,
          capacity: 100,
          saleStartsAt: null,
          saleEndsAt: null,
        },
      }),
      'Thêm Hạng vé có phí',
    );
    const published = await body<EventDetail>(await api.post(`${events}/${event.id}/publish`), 'Mở bán');
    if (published.status !== 'published') throw new Error(`Mở bán: Sự kiện ở trạng thái ${published.status}`);

    const testEvent: TestEvent = { slug: published.slug, name: published.name, tierName: TIER_NAME };
    saveTestEvent(testEvent);
  } finally {
    await api.dispose();
  }
}
