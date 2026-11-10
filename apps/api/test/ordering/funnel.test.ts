import { randomUUID } from 'node:crypto';
import { EventDetail, ErrorResponse, PublicEvent } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';

/*
 * Story 3.1: phễu mua `POST /v1/events/:slug/funnel-events` trên Postgres thật, và `maxTicketsPerOrder` trong phần tĩnh
 * `GET /v1/events/:slug`. Mỗi lần bấm "Mua" dùng `funnelId` mới nên các test không lẫn dòng của nhau.
 */

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let orgId: string;
/** Sự kiện miễn phí đã mở bán, dùng chung cho các test phễu. */
let onSale: EventDetail;

const draft = {
  name: 'Giải chạy Hà Nội 2026',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

const eventsPath = () => `/v1/orgs/${orgId}/events`;

async function newEvent(): Promise<EventDetail> {
  return EventDetail.parse((await h.http.post(eventsPath()).set('cookie', owner.cookie).send(draft).expect(201)).body);
}

/** Sự kiện đã mở bán, một Hạng vé 0đ (không cần Closed Beta hay tài khoản nhận tiền). */
async function publishedEvent(): Promise<EventDetail> {
  const event = await newEvent();
  await h.http
    .post(`${eventsPath()}/${event.id}/ticket-types`)
    .set('cookie', owner.cookie)
    .send({ name: 'Miễn phí', price: 0, capacity: 50 })
    .expect(201);
  await h.http.post(`${eventsPath()}/${event.id}/publish`).set('cookie', owner.cookie).expect(200);
  return event;
}

beforeAll(async () => {
  h = await createHarness();
  owner = await signUp(h);
  orgId = (await h.http.post('/v1/orgs').set('cookie', owner.cookie).send({ name: 'CLB Chạy Bộ' }).expect(201)).body
    .id as string;
  onSale = await publishedEvent();
});
afterAll(async () => {
  await h.close();
});

const funnelPath = (slug: string) => `/v1/events/${slug}/funnel-events`;
const send = (slug: string, body: unknown) => h.http.post(funnelPath(slug)).send(body as object);
const buyClicked = (funnelId: string, loginRequired = true) => ({ type: 'buy_clicked', funnelId, loginRequired });
const loginCompleted = (funnelId: string) => ({ type: 'login_completed', funnelId });

interface FunnelRow {
  event_id: string;
  type: string;
  login_required: boolean | null;
}

async function rowsOf(funnelId: string): Promise<FunnelRow[]> {
  const { rows } = await h.db.pool.query<FunnelRow>(
    'SELECT event_id, type, login_required FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
    [funnelId],
  );
  return rows;
}

describe('POST /v1/events/:slug/funnel-events', () => {
  it('buy_clicked → 204, ghi một dòng (không cần đăng nhập); gửi trùng → 204, không thêm dòng', async () => {
    const funnelId = randomUUID();
    const res = await send(onSale.slug, buyClicked(funnelId, true)).expect(204);
    expect(res.text).toBe('');
    await send(onSale.slug, buyClicked(funnelId, true)).expect(204);
    expect(await rowsOf(funnelId)).toEqual([{ event_id: onSale.id, type: 'buy_clicked', login_required: true }]);
  });

  it('đã đăng nhập sẵn: loginRequired false được ghi; cookie gửi kèm không làm đổi gì (không có user_id)', async () => {
    const funnelId = randomUUID();
    await send(onSale.slug, buyClicked(funnelId, false)).set('cookie', owner.cookie).expect(204);
    expect(await rowsOf(funnelId)).toEqual([{ event_id: onSale.id, type: 'buy_clicked', login_required: false }]);
  });

  it('login_completed sau buy_clicked cùng funnelId → ghi (login_required null); gửi trùng → không thêm dòng', async () => {
    const funnelId = randomUUID();
    await send(onSale.slug, buyClicked(funnelId)).expect(204);
    await send(onSale.slug, loginCompleted(funnelId)).expect(204);
    await send(onSale.slug, loginCompleted(funnelId)).expect(204);
    expect(await rowsOf(funnelId)).toEqual([
      { event_id: onSale.id, type: 'buy_clicked', login_required: true },
      { event_id: onSale.id, type: 'login_completed', login_required: null },
    ]);
  });

  it('login_completed sau buy_clicked đã đăng nhập sẵn (loginRequired false) → 204, bỏ qua', async () => {
    const funnelId = randomUUID();
    await send(onSale.slug, buyClicked(funnelId, false)).expect(204);
    await send(onSale.slug, loginCompleted(funnelId)).expect(204);
    expect(await rowsOf(funnelId)).toEqual([{ event_id: onSale.id, type: 'buy_clicked', login_required: false }]);
  });

  it('login_completed không có buy_clicked cùng funnelId → 204, bỏ qua', async () => {
    const funnelId = randomUUID();
    await send(onSale.slug, loginCompleted(funnelId)).expect(204);
    expect(await rowsOf(funnelId)).toEqual([]);
  });

  it('login_completed mà buy_clicked thuộc Sự kiện khác → 204, bỏ qua', async () => {
    const other = await publishedEvent();
    const funnelId = randomUUID();
    await send(other.slug, buyClicked(funnelId)).expect(204);
    await send(onSale.slug, loginCompleted(funnelId)).expect(204);
    expect(await rowsOf(funnelId)).toEqual([{ event_id: other.id, type: 'buy_clicked', login_required: true }]);
  });

  it('slug lạ, sai dạng hoặc Sự kiện nháp → 404 EVENT_NOT_FOUND, không ghi', async () => {
    const nhap = await newEvent();
    const funnelId = randomUUID();
    for (const slug of ['khong-co-su-kien-nay', 'Sai_Dang', nhap.slug]) {
      const res = await send(slug, buyClicked(funnelId)).expect(404);
      expect(ErrorResponse.parse(res.body).error.code).toBe('EVENT_NOT_FOUND');
    }
    expect(await rowsOf(funnelId)).toEqual([]);
  });

  it.each([
    ['thiếu body', undefined],
    ['type lạ', { type: 'paid', funnelId: randomUUID() }],
    ['order_created (chỉ API ghi lúc tạo Đơn)', { type: 'order_created', funnelId: randomUUID() }],
    ['funnelId không phải uuid', { type: 'buy_clicked', funnelId: 'abc', loginRequired: true }],
    ['buy_clicked thiếu loginRequired', { type: 'buy_clicked', funnelId: randomUUID() }],
    ['có trường lạ (PII)', { type: 'login_completed', funnelId: randomUUID(), email: 'a@vidu.vn' }],
  ])('body sai (%s) → 400 VALIDATION_FAILED', async (_label, body) => {
    const res = await (body === undefined ? h.http.post(funnelPath(onSale.slug)) : send(onSale.slug, body)).expect(400);
    expect(ErrorResponse.parse(res.body).error.code).toBe('VALIDATION_FAILED');
  });

  it('trình duyệt ở web origin gọi được (CORS preflight cho POST JSON)', async () => {
    const res = await h.http
      .options(funnelPath(onSale.slug))
      .set('origin', TEST_WEB_ORIGIN)
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
  });
});

describe('bảng checkout_funnel_events', () => {
  it('chỉ có cột không PII: không user_id, email, SĐT hay IP', async () => {
    const { rows } = await h.db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'checkout_funnel_events' ORDER BY ordinal_position`,
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      'id',
      'event_id',
      'type',
      'funnel_id',
      'login_required',
      'created_at',
    ]);
  });

  it('tickee_app chỉ INSERT/SELECT (append-only); CHECK login_required chỉ có ở buy_clicked', async () => {
    const funnelId = randomUUID();
    await send(onSale.slug, buyClicked(funnelId)).expect(204);
    const pgCode = (err: unknown) => (err as { code?: string }).code;
    await expect(
      h.db.pool.query('UPDATE checkout_funnel_events SET login_required = false WHERE funnel_id = $1', [funnelId]),
    ).rejects.toSatisfy((err) => pgCode(err) === '42501');
    await expect(
      h.db.pool.query('DELETE FROM checkout_funnel_events WHERE funnel_id = $1', [funnelId]),
    ).rejects.toSatisfy((err) => pgCode(err) === '42501');
    await expect(
      h.db.orm.execute(sql`
        INSERT INTO checkout_funnel_events (event_id, type, funnel_id, login_required)
        VALUES (${onSale.id}, 'login_completed', ${randomUUID()}, true)`),
    ).rejects.toSatisfy((err) => pgCode((err as { cause?: unknown }).cause ?? err) === '23514');
    expect(await rowsOf(funnelId)).toHaveLength(1);
  });

  it('CHECK type nhận order_created (login_required null), không nhận loại lạ', async () => {
    const pgCode = (err: unknown) => (err as { code?: string }).code;
    const funnelId = randomUUID();
    await h.db.orm.execute(sql`
      INSERT INTO checkout_funnel_events (event_id, type, funnel_id) VALUES (${onSale.id}, 'order_created', ${funnelId})`);
    expect(await rowsOf(funnelId)).toEqual([{ event_id: onSale.id, type: 'order_created', login_required: null }]);
    await expect(
      h.db.orm.execute(sql`
        INSERT INTO checkout_funnel_events (event_id, type, funnel_id) VALUES (${onSale.id}, 'paid', ${randomUUID()})`),
    ).rejects.toSatisfy((err) => pgCode((err as { cause?: unknown }).cause ?? err) === '23514');
  });
});

describe('GET /v1/events/:slug — giới hạn Vé/Đơn', () => {
  it('có maxTicketsPerOrder (mặc định 10), đổi giới hạn thì phần tĩnh đổi theo', async () => {
    const event = await publishedEvent();
    const read = async () => PublicEvent.parse((await h.http.get(`/v1/events/${event.slug}`).expect(200)).body);
    expect((await read()).maxTicketsPerOrder).toBe(10);
    await h.http
      .patch(`${eventsPath()}/${event.id}/order-limit`)
      .set('cookie', owner.cookie)
      .send({ maxTicketsPerOrder: 4 })
      .expect(200);
    expect((await read()).maxTicketsPerOrder).toBe(4);
  });
});
