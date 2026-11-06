import { EventAvailability, EventDetail, ErrorResponse, PublicEvent, TicketTypeDetail } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AVAILABILITY_CLOCK, sellability } from '../../src/modules/ordering/index.js';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 2.11-a: `ordering.sellability` qua `GET /v1/events/:slug/availability` trên Postgres thật. Mỗi test dùng một
 * BTC và Sự kiện mới (slug mới) nên memo 2 giây không lẫn giữa các test. Đồng hồ tiêm được để kiểm hạn memo.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let platformAdmin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
let orgId: string;
/** Độ lệch (ms) của đồng hồ API so với giờ thật. */
let clockOffset = 0;

const draft = {
  name: 'Giải chạy Hà Nội 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

beforeAll(async () => {
  h = await createHarness({}, { overrides: [{ provide: AVAILABILITY_CLOCK, useValue: () => Date.now() + clockOffset }] });
  owner = await signUp(h);
  platformAdmin = await signUpPlatformAdmin(h);
});
beforeEach(async () => {
  clockOffset = 0;
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201)).body
    .id as string;
});
afterAll(async () => {
  await h.close();
});

const eventsPath = () => `/v1/orgs/${orgId}/events`;

async function newEvent(body: Record<string, unknown> = draft): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(eventsPath()).set('cookie', owner.cookie).send(body).expect(201)).body);
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

async function insertPayoutAccount(): Promise<void> {
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

const closedBeta = (action: 'approve' | 'revoke') =>
  h.http.post(`/v1/admin/organizations/${orgId}/closed-beta/${action}`).set('cookie', platformAdmin.cookie).expect(204);

/** Sự kiện đã mở bán, Hạng vé 0đ (capacity 50). */
async function freeEventOnSale(): Promise<{ event: EventDetail; free: string }> {
  const event = await newEvent();
  const free = await addTicketType(event.id, 0);
  await publish(event.id);
  return { event, free };
}

/** Sự kiện đã mở bán có Hạng vé 100.000đ rồi 0đ; BTC đã duyệt Closed Beta và có tài khoản nhận tiền. */
async function paidEventOnSale(): Promise<{ event: EventDetail; paid: string; free: string }> {
  await closedBeta('approve');
  await insertPayoutAccount();
  const event = await newEvent();
  const paid = await addTicketType(event.id, 100_000);
  const free = await addTicketType(event.id, 0);
  await publish(event.id);
  return { event, paid, free };
}

const availabilityRes = (slug: string) => h.http.get(`/v1/events/${slug}/availability`);

async function availability(slug: string): Promise<EventAvailability> {
  const res = await availabilityRes(slug).expect(200);
  return EventAvailability.parse(res.body);
}

const statuses = (a: EventAvailability) => Object.fromEntries(a.tiers.map((t) => [t.ticketTypeId, t.status]));

describe('GET /v1/events/:slug/availability', () => {
  it('đang bán: 0đ, capacity 50 → on_sale, còn 50, eventReason null; Cache-Control public 2 giây; không lộ số thô', async () => {
    const { event, free } = await freeEventOnSale();
    const res = await availabilityRes(event.slug).expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=2');
    expect(res.body).toEqual({
      eventReason: null,
      tiers: [{ ticketTypeId: free, status: 'on_sale', remaining: 50, saleStartsAt: null }],
    });
  });

  it('hết vé: sold + held = capacity → sold_out, còn 0', async () => {
    const { event, free } = await freeEventOnSale();
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = 30, held = 20 WHERE ticket_type_id = ${free}`);
    expect((await availability(event.slug)).tiers).toEqual([
      { ticketTypeId: free, status: 'sold_out', remaining: 0, saleStartsAt: null },
    ]);
  });

  it('chưa mở bán (có saleStartsAt) và đã đóng bán; Hạng vé xếp theo thứ tự tạo', async () => {
    const event = await newEvent();
    const later = await addTicketType(event.id, 0, { saleStartsAt: '2099-01-01T08:00:00+07:00' });
    const ended = await addTicketType(event.id, 0, { saleEndsAt: '2026-01-01T08:00:00+07:00' });
    await publish(event.id);
    const result = await availability(event.slug);
    expect(result).toEqual({
      eventReason: null,
      tiers: [
        { ticketTypeId: later, status: 'not_started', remaining: 50, saleStartsAt: '2099-01-01T08:00:00+07:00' },
        { ticketTypeId: ended, status: 'closed', remaining: 50, saleStartsAt: null },
      ],
    });
  });

  it('chưa mở bán đứng trước hết vé; đã đóng bán đứng trước hết vé', async () => {
    const event = await newEvent();
    const later = await addTicketType(event.id, 0, { saleStartsAt: '2099-01-01T08:00:00+07:00' });
    const ended = await addTicketType(event.id, 0, { saleEndsAt: '2026-01-01T08:00:00+07:00' });
    await publish(event.id);
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = capacity WHERE event_id = ${event.id}`);
    expect(statuses(await availability(event.slug))).toEqual({ [later]: 'not_started', [ended]: 'closed' });
  });

  it('paused đứng trước not_started, closed và sold_out', async () => {
    const event = await newEvent();
    const later = await addTicketType(event.id, 0, { saleStartsAt: '2099-01-01T08:00:00+07:00' });
    const ended = await addTicketType(event.id, 0, { saleEndsAt: '2026-01-01T08:00:00+07:00' });
    const soldOut = await addTicketType(event.id, 0);
    await publish(event.id);
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = capacity WHERE ticket_type_id = ${soldOut}`);
    await h.db.orm.execute(sql`UPDATE events SET refund_policy = '  ' WHERE id = ${event.id}`);
    const result = await availability(event.slug);
    expect(result.eventReason).toBe('paused');
    expect(statuses(result)).toEqual({ [later]: 'paused', [ended]: 'paused', [soldOut]: 'paused' });
  });

  it('Closed Beta bị thu hồi: Hạng vé có phí paused, 0đ vẫn on_sale, eventReason paused', async () => {
    const { event, paid, free } = await paidEventOnSale();
    expect(await availability(event.slug)).toMatchObject({ eventReason: null });
    expect(statuses(await availability(event.slug))).toEqual({ [paid]: 'on_sale', [free]: 'on_sale' });
    await closedBeta('revoke');
    clockOffset += 2_001;
    const result = await availability(event.slug);
    expect(result.eventReason).toBe('paused');
    expect(statuses(result)).toEqual({ [paid]: 'paused', [free]: 'on_sale' });
  });

  it('hủy hết tài khoản nhận tiền: Hạng vé có phí paused', async () => {
    const { event, paid, free } = await paidEventOnSale();
    await h.db.orm.execute(sql`UPDATE payout_accounts SET retired_at = now() WHERE organization_id = ${orgId}`);
    const result = await availability(event.slug);
    expect(result.eventReason).toBe('paused');
    expect(statuses(result)).toEqual({ [paid]: 'paused', [free]: 'on_sale' });
  });

  it('thiếu chính sách hoàn vé sau khi mở bán: mọi Hạng vé paused, kể cả 0đ', async () => {
    const { event, paid, free } = await paidEventOnSale();
    await h.db.orm.execute(sql`UPDATE events SET refund_policy = '  ' WHERE id = ${event.id}`);
    const result = await availability(event.slug);
    expect(result.eventReason).toBe('paused');
    expect(statuses(result)).toEqual({ [paid]: 'paused', [free]: 'paused' });
  });

  it.each([
    ['hidden', sql`status = 'hidden'`],
    ['cancelled', sql`status = 'cancelled'`],
    ['locked', sql`locked_at = now()`],
    ['ended', sql`effective_end_at = now() - interval '1 second'`],
  ])('%s → eventReason tương ứng, mọi Hạng vé unavailable; GET /:slug vẫn 200', async (reason, set) => {
    const { event, paid, free } = await paidEventOnSale();
    await h.db.orm.execute(sql`UPDATE events SET ${set} WHERE id = ${event.id}`);
    const result = await availability(event.slug);
    expect(result.eventReason).toBe(reason);
    expect(statuses(result)).toEqual({ [paid]: 'unavailable', [free]: 'unavailable' });
    expect(result.tiers.map((t) => t.remaining)).toEqual([50, 50]);
    await h.http.get(`/v1/events/${event.slug}`).expect(200);
  });

  it('nhiều lý do cùng lúc: cancelled > locked > hidden > ended > paused', async () => {
    const cases: [string, ReturnType<typeof sql>][] = [
      ['cancelled', sql`status = 'cancelled', locked_at = now(), effective_end_at = now() - interval '1 second'`],
      ['locked', sql`status = 'hidden', locked_at = now(), refund_policy = NULL`],
      ['hidden', sql`status = 'hidden', effective_end_at = now() - interval '1 second'`],
      ['ended', sql`effective_end_at = now() - interval '1 second', refund_policy = NULL`],
    ];
    for (const [reason, set] of cases) {
      const { event } = await freeEventOnSale();
      await h.db.orm.execute(sql`UPDATE events SET ${set} WHERE id = ${event.id}`);
      expect((await availability(event.slug)).eventReason).toBe(reason);
    }
  });

  it('memo 2 giây: bán thêm vé, trong 2 giây vẫn số cũ, sau hơn 2 giây remaining giảm đúng', async () => {
    const { event, free } = await freeEventOnSale();
    expect((await availability(event.slug)).tiers[0]!.remaining).toBe(50);
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = sold + 3 WHERE ticket_type_id = ${free}`);
    clockOffset += 1_000;
    expect((await availability(event.slug)).tiers[0]!.remaining).toBe(50);
    clockOffset += 1_001;
    expect((await availability(event.slug)).tiers[0]!.remaining).toBe(47);
  });

  it('Sự kiện nháp, slug không tồn tại, sai dạng hoặc quá dài → cùng 404 EVENT_NOT_FOUND', async () => {
    const event = await newEvent();
    await addTicketType(event.id, 0);
    const responses = [
      await availabilityRes(event.slug).expect(404),
      await availabilityRes('khong-ton-tai-zz99').expect(404),
      await availabilityRes('KHONG%20HOP%20LE').expect(404),
      await availabilityRes('a'.repeat(101)).expect(404),
    ];
    for (const res of responses) expect(ErrorResponse.parse(res.body).error.code).toBe('EVENT_NOT_FOUND');
    // 404 không được memo: mở bán xong gọi lại ngay thì thấy Sự kiện.
    await publish(event.id);
    expect((await availability(event.slug)).eventReason).toBeNull();
  });
});

describe('sellability(db, eventId)', () => {
  it('trả cùng kết quả với API theo slug; Sự kiện nháp hoặc id lạ → EVENT_NOT_FOUND', async () => {
    const { event, free } = await freeEventOnSale();
    expect(await sellability(h.db.orm, event.id)).toEqual({
      eventReason: null,
      tiers: [{ ticketTypeId: free, status: 'on_sale', remaining: 50, saleStartsAt: null }],
    });
    expect(
      (await sellability(h.db.orm, event.id, new Date('2100-01-01T00:00:00+07:00'))).eventReason,
    ).toBe('ended');
    const other = await newEvent();
    await expect(sellability(h.db.orm, other.id)).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
    await expect(sellability(h.db.orm, 'khong-phai-uuid')).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });
});

describe('GET /v1/events/:slug — phần tĩnh', () => {
  it('có tên BTC và Hạng vé (theo thứ tự tạo, không có số vé)', async () => {
    const { event, paid, free } = await paidEventOnSale();
    const body = PublicEvent.parse((await h.http.get(`/v1/events/${event.slug}`).expect(200)).body);
    expect(body.organizationName).toBe('CLB Chạy Bộ');
    expect(body.ticketTypes.map((t) => t.id)).toEqual([paid, free]);
  });
});
