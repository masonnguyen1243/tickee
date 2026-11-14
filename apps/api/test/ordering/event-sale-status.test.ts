import { EventDetail, EventSaleStatusList, ErrorResponse, Role, TicketTypeDetail } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 4.2-c (retro Epic 2 C5): `GET /v1/orgs/:orgId/event-sale-status` trên Postgres thật — lý do bán cấp Sự kiện cho
 * nhãn dashboard, cùng luật `saleStatusOf` với trang công khai (AD-21), đồng hồ DB, đọc theo lô. Mỗi test một BTC mới.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let platformAdmin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let orgId: string;

const draft = {
  name: 'Giải chạy Hà Nội 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
  platformAdmin = await signUpPlatformAdmin(h);
});
beforeEach(async () => {
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201)).body
    .id as string;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const eventsPath = () => `/v1/orgs/${orgId}/events`;
const statusPath = (id = orgId) => `/v1/orgs/${id}/event-sale-status`;

async function newEvent(): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(eventsPath()).set('cookie', owner.cookie).send(draft).expect(201)).body);
}

async function addTicketType(eventId: string, price: number, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await h.http
    .post(`${eventsPath()}/${eventId}/ticket-types`)
    .set('cookie', owner.cookie)
    .send({ name: price > 0 ? 'Có phí' : 'Miễn phí', price, capacity: 50, ...extra })
    .expect(201);
  return TicketTypeDetail.parse(res.body).id;
}

async function publish(eventId: string): Promise<void> {
  await h.http.post(`${eventsPath()}/${eventId}/publish`).set('cookie', owner.cookie).expect(200);
}

/** BTC đủ điều kiện bán Vé có phí: duyệt Closed Beta và có tài khoản nhận tiền. */
async function allowPaidSales(): Promise<void> {
  await h.http
    .post(`/v1/admin/organizations/${orgId}/closed-beta/approve`)
    .set('cookie', platformAdmin.cookie)
    .expect(204);
  const credential = await h.db.orm.execute<{ id: string }>(sql`
    INSERT INTO tingee_credentials (organization_id, client_id, secret_token_ciphertext, created_by)
    VALUES (${orgId}, 'tg-client-test', 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA', ${owner.userId})
    RETURNING id`);
  await h.db.orm.execute(sql`
    INSERT INTO payout_accounts
      (organization_id, tingee_credential_id, va_account_number, bank_bin, bank_name, account_type, account_last4,
       account_name, created_by)
    VALUES (${orgId}, ${credential.rows[0]!.id}, '9600000001', '970422', 'MB Bank', 'personal-account', '0000',
      'NGUYEN VAN A', ${owner.userId})`);
}

/** Cờ dịch vụ thanh toán của Story 4.2-a: BTC bị ngắt (hết Token). */
async function suspendPaymentService(): Promise<void> {
  await h.db.orm.execute(sql`
    UPDATE organizations
       SET payment_service_status = 'suspended', payment_service_reason = 'token', payment_service_since = now()
     WHERE id = ${orgId}`);
}

/** Sự kiện đã mở bán với các Hạng vé theo giá `prices` (tạo theo thứ tự). */
async function eventOnSale(prices: readonly number[]): Promise<EventDetail> {
  const event = await newEvent();
  for (const price of prices) await addTicketType(event.id, price);
  await publish(event.id);
  return event;
}

async function saleStatus(cookie = owner.cookie): Promise<EventSaleStatusList> {
  return EventSaleStatusList.parse((await h.http.get(statusPath()).set('cookie', cookie).expect(200)).body);
}

const statusOf = async (eventId: string) => (await saleStatus()).events.find((e) => e.eventId === eventId);

describe('GET /v1/orgs/:orgId/event-sale-status', () => {
  it('BTC chưa có Sự kiện nào → events rỗng', async () => {
    expect(await saleStatus()).toEqual({ events: [] });
  });

  it('đang bán → reason null; nháp không có trong danh sách; mới tạo trước', async () => {
    const first = await eventOnSale([0]);
    const draftEvent = await newEvent();
    const second = await eventOnSale([0]);
    expect(await saleStatus()).toEqual({
      events: [
        { eventId: second.id, reason: null, partial: false },
        { eventId: first.id, reason: null, partial: false },
      ],
    });
    expect((await saleStatus()).events.map((e) => e.eventId)).not.toContain(draftEvent.id);
  });

  it('BTC bị ngắt dịch vụ thanh toán (cờ suspended của 4.2-a), chỉ Hạng vé có phí → paused, partial false', async () => {
    await allowPaidSales();
    const event = await eventOnSale([100_000]);
    expect(await statusOf(event.id)).toEqual({ eventId: event.id, reason: null, partial: false });
    await suspendPaymentService();
    expect(await statusOf(event.id)).toEqual({ eventId: event.id, reason: 'paused', partial: false });
  });

  it('ngắt một phần: Hạng vé 0đ và có phí, cờ suspended → paused, partial true; Sự kiện miễn phí vẫn đang bán', async () => {
    await allowPaidSales();
    const mixed = await eventOnSale([100_000, 0]);
    const free = await eventOnSale([0]);
    await suspendPaymentService();
    const { events } = await saleStatus();
    expect(events).toEqual([
      { eventId: free.id, reason: null, partial: false },
      { eventId: mixed.id, reason: 'paused', partial: true },
    ]);
  });

  it.each([
    ['hết vé (sold_out)', {}, true],
    ['chưa mở bán (not_started)', { saleStartsAt: '2099-01-01T08:00:00+07:00' }, false],
    ['đã đóng bán (closed)', { saleEndsAt: '2026-01-01T08:00:00+07:00' }, false],
  ] as const)(
    'ngắt, Hạng vé 0đ %s → paused, partial false (khớp trang công khai: không còn Hạng vé on_sale)',
    async (_label, window, soldOut) => {
      await allowPaidSales();
      const event = await newEvent();
      await addTicketType(event.id, 100_000);
      const free = await addTicketType(event.id, 0, window);
      await publish(event.id);
      if (soldOut) await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = capacity WHERE ticket_type_id = ${free}`);
      await suspendPaymentService();
      expect(await statusOf(event.id)).toEqual({ eventId: event.id, reason: 'paused', partial: false });
    },
  );

  it('Closed Beta bị thu hồi (thiếu điều kiện bán Vé có phí): chỉ có phí → paused, partial false; có 0đ → partial true', async () => {
    await allowPaidSales();
    const paidOnly = await eventOnSale([100_000]);
    const mixed = await eventOnSale([100_000, 0]);
    await h.http
      .post(`/v1/admin/organizations/${orgId}/closed-beta/revoke`)
      .set('cookie', platformAdmin.cookie)
      .expect(204);
    const { events } = await saleStatus();
    expect(events).toEqual([
      { eventId: mixed.id, reason: 'paused', partial: true },
      { eventId: paidOnly.id, reason: 'paused', partial: false },
    ]);
  });

  it('hủy hết tài khoản nhận tiền (thiếu điều kiện bán Vé có phí): chỉ có phí → paused, partial false', async () => {
    await allowPaidSales();
    const event = await eventOnSale([100_000]);
    expect(await statusOf(event.id)).toEqual({ eventId: event.id, reason: null, partial: false });
    await h.db.orm.execute(sql`UPDATE payout_accounts SET retired_at = now() WHERE organization_id = ${orgId}`);
    expect(await statusOf(event.id)).toEqual({ eventId: event.id, reason: 'paused', partial: false });
  });

  it('thiếu chính sách hoàn vé: mọi Hạng vé paused kể cả 0đ → partial false', async () => {
    await allowPaidSales();
    const event = await eventOnSale([100_000, 0]);
    await h.db.orm.execute(sql`UPDATE events SET refund_policy = '  ' WHERE id = ${event.id}`);
    expect(await statusOf(event.id)).toEqual({ eventId: event.id, reason: 'paused', partial: false });
  });

  it.each([
    ['hidden', sql`status = 'hidden'`],
    ['cancelled', sql`status = 'cancelled'`],
    ['locked', sql`locked_at = now()`],
    ['ended', sql`effective_end_at = now() - interval '1 second'`],
    // "Đã kết thúc" thắng "Ẩn" (Story 2.12), như trang công khai.
    ['ended', sql`status = 'hidden', effective_end_at = now() - interval '1 second'`],
  ])('%s → reason tương ứng, partial false (kể cả khi BTC bị ngắt)', async (reason, set) => {
    await allowPaidSales();
    const event = await eventOnSale([100_000, 0]);
    await suspendPaymentService();
    await h.db.orm.execute(sql`UPDATE events SET ${set} WHERE id = ${event.id}`);
    expect(await statusOf(event.id)).toEqual({ eventId: event.id, reason, partial: false });
  });

  it('đồng hồ DB: đồng hồ app chậm 1 giờ vẫn thấy Sự kiện đã quá effective_end_at; app nhanh 1 giờ không làm kết thúc sớm', async () => {
    const ended = await eventOnSale([0]);
    const onSale = await eventOnSale([0]);
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() - interval '1 minute' WHERE id = ${ended.id}`);
    await h.db.orm.execute(sql`UPDATE events SET effective_end_at = now() + interval '1 minute' WHERE id = ${onSale.id}`);
    const expected = {
      events: [
        { eventId: onSale.id, reason: null, partial: false },
        { eventId: ended.id, reason: 'ended', partial: false },
      ],
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() - 60 * 60_000);
      expect(await saleStatus()).toEqual(expected);
      vi.setSystemTime(Date.now() + 2 * 60 * 60_000);
      expect(await saleStatus()).toEqual(expected);
    } finally {
      vi.useRealTimers();
    }
  });

  it('đọc theo lô: số truy vấn DB của một request không tăng theo số Sự kiện', async () => {
    await allowPaidSales();
    await eventOnSale([100_000, 0]);
    const countQueries = async (): Promise<number> => {
      const spy = vi.spyOn(pg.Client.prototype, 'query');
      try {
        await saleStatus();
        return spy.mock.calls.length;
      } finally {
        spy.mockRestore();
      }
    };
    await countQueries();
    const one = await countQueries();
    expect(one).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) await eventOnSale([100_000, 0, 50_000]);
    const four = await countQueries();
    expect((await saleStatus()).events).toHaveLength(4);
    expect(four).toBe(one);
  });

  it('cách ly: Owner BTC B gọi trên BTC A (BTC của test) → 403 NOT_A_MEMBER; Admin của BTC A → 200', async () => {
    const event = await eventOnSale([0]);
    const ownerB = await signUp(h);
    // Người gọi là Owner của một BTC khác, không phải thành viên BTC A.
    await h.http.post('/v1/orgs').set('cookie', ownerB.cookie).send({ name: 'BTC B' }).expect(201);
    const res = await h.http.get(statusPath()).set('cookie', ownerB.cookie).expect(403);
    expect(ErrorResponse.parse(res.body).error.code).toBe('NOT_A_MEMBER');

    const admin = await signUp(h);
    await h.db.orm.execute(
      sql`INSERT INTO members (organization_id, user_id, role) VALUES (${orgId}, ${admin.userId}, ${Role.ADMIN})`,
    );
    expect(await saleStatus(admin.cookie)).toEqual({ events: [{ eventId: event.id, reason: null, partial: false }] });
  });

  it('không lẫn Sự kiện của BTC khác', async () => {
    const mine = await eventOnSale([0]);
    const otherOrg = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'BTC khác' }).expect(201))
      .body.id as string;
    const otherEvent = EventDetail.parse(
      (await h.http.post(`/v1/orgs/${otherOrg}/events`).set('cookie', owner.cookie).send(draft).expect(201)).body,
    );
    await h.http
      .post(`/v1/orgs/${otherOrg}/events/${otherEvent.id}/ticket-types`)
      .set('cookie', owner.cookie)
      .send({ name: 'Miễn phí', price: 0, capacity: 50 })
      .expect(201);
    await h.http.post(`/v1/orgs/${otherOrg}/events/${otherEvent.id}/publish`).set('cookie', owner.cookie).expect(200);
    expect((await saleStatus()).events.map((e) => e.eventId)).toEqual([mine.id]);
    const theirs = EventSaleStatusList.parse(
      (await h.http.get(statusPath(otherOrg)).set('cookie', owner.cookie).expect(200)).body,
    );
    expect(theirs.events.map((e) => e.eventId)).toEqual([otherEvent.id]);
  });
});
