import { randomUUID } from 'node:crypto';
import {
  CheckoutForm,
  ErrorResponse,
  JobQueue,
  NotOnSaleDetails,
  OrderRateLimitedDetails,
  PendingOrderExistsDetails,
  TicketTypeSoldOutDetails,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORDER_CODE_GENERATOR } from '../../src/modules/ordering/index.js';
import { randomOrderCode } from '../../src/modules/ordering/order-code.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { TEST_WEB_ORIGIN } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  eventsPath,
  inventory,
  orderBody,
  orderRow,
  ordersOfEvent,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type User,
} from './order-fixtures.js';

/*
 * Story 3.2: Checkout và tạo Đơn trên Postgres thật — mọi dòng của I/O Matrix trừ đua chỗ (order-concurrency.test.ts)
 * và job hết hạn (order-expiry.test.ts). Mỗi test dùng Sự kiện mới và Người mua mới.
 */

let h: Harness;
let boss: PgBoss;
let org: Org;
/** Mã Đơn ép sẵn cho lần sinh tới (test trùng mã); hết thì sinh ngẫu nhiên. */
const forcedCodes: string[] = [];

beforeAll(async () => {
  h = await createHarness(
    {},
    {
      overrides: [
        {
          provide: ORDER_CODE_GENERATOR,
          useValue: () => forcedCodes.shift() ?? randomOrderCode(),
        },
        rejectingTingee,
      ],
    },
  );
  boss = h.app.get<PgBoss>(BOSS);
  org = await paidReadyOrg(h);
});
beforeEach(async () => {
  forcedCodes.length = 0;
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

const QUESTIONS = [
  { label: 'Size áo', kind: 'text' as const, required: true },
  { label: 'Trình độ', kind: 'choice' as const, required: true, options: ['Mới chơi', 'Khá'] },
  { label: 'Ghi chú', kind: 'text' as const, required: false },
];

/** Sự kiện có A (300.000đ, 5 suất) và B (0đ, 10 suất), form ba câu hỏi. */
async function standardEvent(extra: { maxTicketsPerOrder?: number } = {}) {
  const sale = await eventOnSale(
    org,
    [
      { name: 'Đơn nam', price: 300_000, capacity: 5 },
      { name: 'Vé cổ vũ', price: 0, capacity: 10 },
    ],
    { questions: QUESTIONS, ...extra },
  );
  const [a, b] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
  const [size, level] = sale.questions as [(typeof sale.questions)[0], (typeof sale.questions)[0]];
  const answers = { [size.id]: ' M ', [level.id]: level.options[1]!.id };
  return { ...sale, a, b, size, level, answers };
}

async function attempts(): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM order_create_attempts');
  return rows[0]!.n;
}

describe('POST /v1/events/:slug/orders — đặt thành công', () => {
  it('A=2, B=1, form hợp lệ, khóa mới → 201 BuyerOrder pending; held A+2, B+1; job hết hạn; order_created; bản chụp', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const funnelId = randomUUID();
    await h.http
      .post(`/v1/events/${s.event.slug}/funnel-events`)
      .send({ type: 'buy_clicked', funnelId, loginRequired: true })
      .expect(204);
    const items = [
      { ticketTypeId: s.a.id, quantity: 2 },
      { ticketTypeId: s.b.id, quantity: 1 },
    ];
    const res = await postOrder(h, buyer, s.event.slug, orderBody(items, { answers: s.answers, funnelId })).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const order = parseOrder(res.body);

    expect(order).toMatchObject({
      status: 'pending',
      event: { slug: s.event.slug, name: s.event.name },
      items: [
        { ticketTypeId: s.a.id, name: 'Đơn nam', unitPrice: 300_000, quantity: 2, amount: 600_000 },
        { ticketTypeId: s.b.id, name: 'Vé cổ vũ', unitPrice: 0, quantity: 1, amount: 0 },
      ],
      totalAmount: 600_000,
      buyer: { name: 'Nguyễn Văn An', phone: '+84912345678', email: buyer.email },
      answers: [
        { questionId: s.size.id, label: 'Size áo', answer: 'M' },
        { questionId: s.level.id, label: 'Trình độ', answer: 'Khá' },
      ],
      refundPolicy: 'Hoàn 100% trước 7 ngày.',
    });
    expect(order.code).toMatch(/^TK[0-9A-HJKMNP-TV-Z]{8}$/);
    const holdMs = Date.parse(order.expiresAt) - Date.parse(order.createdAt);
    expect(holdMs).toBeGreaterThanOrEqual(59_000);
    expect(holdMs).toBeLessThanOrEqual(61_000);
    expect(Math.abs(Date.parse(order.serverNow) - Date.now())).toBeLessThan(5_000);

    expect(await inventory(h, s.a.id)).toEqual({ capacity: 5, sold: 0, held: 2 });
    expect(await inventory(h, s.b.id)).toEqual({ capacity: 10, sold: 0, held: 1 });

    const row = (await orderRow(h, order.code))!;
    expect(row.funnel_id).toBe(funnelId);
    const jobs = await boss.findJobs(JobQueue.ORDERING_EXPIRE_ORDER, { data: { orderId: row.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.startAfter.getTime()).toBe(row.expires_at.getTime());

    const funnel = await h.db.pool.query<{ type: string; event_id: string }>(
      'SELECT type, event_id FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
      [funnelId],
    );
    expect(funnel.rows).toEqual([
      { type: 'buy_clicked', event_id: s.event.id },
      { type: 'order_created', event_id: s.event.id },
    ]);

    const answers = await h.db.pool.query(
      'SELECT question_id, position, label, kind, answer, option_id FROM order_answers WHERE order_id = $1 ORDER BY position',
      [row.id],
    );
    expect(answers.rows).toEqual([
      { question_id: s.size.id, position: 0, label: 'Size áo', kind: 'text', answer: 'M', option_id: null },
      {
        question_id: s.level.id,
        position: 1,
        label: 'Trình độ',
        kind: 'choice',
        answer: 'Khá',
        option_id: s.level.options[1]!.id,
      },
    ]);
    expect(await attempts()).toBe(1);
  });

  it('Đơn chỉ có Hạng vé 0đ (Story 3.3): bán ngay, paid; không gửi funnelId → không ghi order_created/paid', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé tham dự', price: 0, capacity: 3 }]);
    const tier = sale.tiers[0]!;
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity: 3 }])).expect(
      201,
    );
    const order = parseOrder(res.body);
    expect(order).toMatchObject({ status: 'paid', totalAmount: 0, answers: [] });
    expect(order.tickets).toHaveLength(3);
    expect(await inventory(h, tier.id)).toEqual({ capacity: 3, sold: 3, held: 0 });
    const funnel = await h.db.pool.query('SELECT 1 FROM checkout_funnel_events WHERE event_id = $1', [sale.event.id]);
    expect(funnel.rows).toEqual([]);
  });

  it('trình duyệt ở web origin gửi được header Idempotency-Key (CORS preflight)', async () => {
    const res = await h.http
      .options('/v1/events/bat-ky/orders')
      .set('origin', TEST_WEB_ORIGIN)
      .set('access-control-request-method', 'POST')
      .set('access-control-request-headers', 'content-type,idempotency-key')
      .expect(204);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('idempotency-key');
  });

  it('chưa đăng nhập → 401, không tạo Đơn', async () => {
    const s = await standardEvent();
    const res = await h.http
      .post(`/v1/events/${s.event.slug}/orders`)
      .set('idempotency-key', randomUUID())
      .send(orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers }))
      .expect(401);
    expect(errorOf(res.body).code).toBe('UNAUTHENTICATED');
    expect(await ordersOfEvent(h, s.event.id)).toEqual([]);
  });

  it('mã Đơn trùng → sinh lại (savepoint, không mất phần giữ chỗ)', async () => {
    const first = await signUp(h);
    const second = await signUp(h);
    const s = await standardEvent();
    const body = orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers });
    // Mã mới mỗi lần chạy: DB test giữ Đơn của các lần chạy trước.
    const taken = randomOrderCode();
    const fresh = randomOrderCode();
    forcedCodes.push(taken);
    expect(parseOrder((await postOrder(h, first, s.event.slug, body).expect(201)).body).code).toBe(taken);
    forcedCodes.push(taken, taken, fresh);
    const res = await postOrder(h, second, s.event.slug, body).expect(201);
    expect(parseOrder(res.body).code).toBe(fresh);
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 2 });
  });

  it('trùng mã cả 3 lần → 500, rollback cả TX1 (không giữ chỗ, không có Đơn)', async () => {
    const first = await signUp(h);
    const second = await signUp(h);
    const s = await standardEvent();
    const body = orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers });
    const taken = randomOrderCode();
    forcedCodes.push(taken);
    await postOrder(h, first, s.event.slug, body).expect(201);
    forcedCodes.push(taken, taken, taken);
    await postOrder(h, second, s.event.slug, body).expect(500);
    expect(await ordersOfEvent(h, s.event.id)).toHaveLength(1);
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 1 });
  });
});

describe('POST /v1/events/:slug/orders — không bán quá số suất', () => {
  it('A còn đủ, B thiếu → 409 TICKET_TYPE_SOLD_OUT với B; held của A không đổi, không có Đơn', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [
      { name: 'Đơn nam', price: 300_000, capacity: 5 },
      { name: 'Đôi nam', price: 500_000, capacity: 2 },
    ]);
    const [a, b] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const res = await postOrder(
      h,
      buyer,
      sale.event.slug,
      orderBody([
        { ticketTypeId: b.id, quantity: 3 },
        { ticketTypeId: a.id, quantity: 2 },
      ]),
    ).expect(409);
    const error = errorOf(res.body);
    expect(error.code).toBe('TICKET_TYPE_SOLD_OUT');
    expect(TicketTypeSoldOutDetails.parse(error.details)).toEqual({ ticketTypeId: b.id, ticketTypeName: 'Đôi nam' });
    expect(await inventory(h, a.id)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await inventory(h, b.id)).toEqual({ capacity: 2, sold: 0, held: 0 });
    expect(await ordersOfEvent(h, sale.event.id)).toEqual([]);
    // Lần thử tới được TX1 vẫn tính vào giới hạn tốc độ.
    expect(await attempts()).toBe(1);
  });

  it('Hạng vé đã hết (sold + held = capacity) → 409 TICKET_TYPE_SOLD_OUT', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Đơn nam', price: 300_000, capacity: 2 }]);
    const tier = sale.tiers[0]!;
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = 1, held = 1 WHERE ticket_type_id = ${tier.id}`);
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity: 1 }])).expect(
      409,
    );
    expect(errorOf(res.body)).toMatchObject({
      code: 'TICKET_TYPE_SOLD_OUT',
      details: { ticketTypeId: tier.id, ticketTypeName: 'Đơn nam' },
    });
  });
});

describe('POST /v1/events/:slug/orders — Hạng vé hoặc Sự kiện không bán', () => {
  it.each([
    ['chưa mở bán', { saleStartsAt: '2099-01-01T08:00:00+07:00' }, 'not_started'],
    ['đã đóng bán', { saleEndsAt: '2026-01-01T08:00:00+07:00' }, 'closed'],
  ])('Hạng vé %s → 409 NOT_ON_SALE {ticketTypeId, reason}', async (_label, window, reason) => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [
      { name: 'Đang bán', price: 0, capacity: 5 },
      { name: 'Không bán', price: 0, capacity: 5, ...window },
    ]);
    const [open, closed] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const res = await postOrder(
      h,
      buyer,
      sale.event.slug,
      orderBody([
        { ticketTypeId: open.id, quantity: 1 },
        { ticketTypeId: closed.id, quantity: 1 },
      ]),
    ).expect(409);
    const error = errorOf(res.body);
    expect(error.code).toBe('NOT_ON_SALE');
    expect(NotOnSaleDetails.parse(error.details)).toEqual({ ticketTypeId: closed.id, reason });
    expect(await inventory(h, open.id)).toMatchObject({ held: 0 });
  });

  it('Hạng vé có phí tạm ngừng bán (Closed Beta bị thu hồi) → paused; Hạng vé 0đ vẫn mua được', async () => {
    const own = await paidReadyOrg(h);
    const sale = await eventOnSale(own, [
      { name: 'Có phí', price: 100_000, capacity: 5 },
      { name: 'Miễn phí', price: 0, capacity: 5 },
    ]);
    const [paid, free] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    await h.db.orm.execute(sql`UPDATE payout_accounts SET retired_at = now() WHERE organization_id = ${own.orgId}`);
    const buyer = await signUp(h);
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: paid.id, quantity: 1 }])).expect(
      409,
    );
    expect(errorOf(res.body)).toMatchObject({ code: 'NOT_ON_SALE', details: { ticketTypeId: paid.id, reason: 'paused' } });
    await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: free.id, quantity: 1 }])).expect(201);
  });

  it('Hạng vé của Sự kiện khác → 409 NOT_ON_SALE closed', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const other = await eventOnSale(org, [{ name: 'Khác', price: 0, capacity: 5 }]);
    const res = await postOrder(
      h,
      buyer,
      s.event.slug,
      orderBody([{ ticketTypeId: other.tiers[0]!.id, quantity: 1 }], { answers: s.answers }),
    ).expect(409);
    expect(errorOf(res.body)).toMatchObject({
      code: 'NOT_ON_SALE',
      details: { ticketTypeId: other.tiers[0]!.id, reason: 'closed' },
    });
  });

  it.each([
    ['ẩn', sql`status = 'hidden'`, 'hidden'],
    ['bị khóa', sql`locked_at = now()`, 'locked'],
    ['đã hủy', sql`status = 'cancelled'`, 'cancelled'],
    ['đã kết thúc', sql`effective_end_at = now() - interval '1 second'`, 'ended'],
  ])('Sự kiện %s → 409 NOT_ON_SALE {reason} (không có ticketTypeId), không giữ chỗ', async (_label, set, reason) => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    await h.db.orm.execute(sql`UPDATE events SET ${set} WHERE id = ${s.event.id}`);
    const res = await postOrder(
      h,
      buyer,
      s.event.slug,
      orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers }),
    ).expect(409);
    const error = errorOf(res.body);
    expect(error.code).toBe('NOT_ON_SALE');
    expect(NotOnSaleDetails.parse(error.details)).toEqual({ reason });
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 0 });
  });

  it('slug lạ hoặc Sự kiện nháp → 404 EVENT_NOT_FOUND', async () => {
    const buyer = await signUp(h);
    const draft = await h.http
      .post(eventsPath(org))
      .set('cookie', org.owner.cookie)
      .send({ name: 'Nháp', startsAt: '2099-11-16T07:00:00+07:00', endsAt: '2099-11-16T17:00:00+07:00' })
      .expect(201);
    for (const slug of ['khong-co-su-kien-nay', draft.body.slug as string]) {
      const res = await postOrder(h, buyer, slug, orderBody([{ ticketTypeId: randomUUID(), quantity: 1 }])).expect(404);
      expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
    }
  });
});

describe('POST /v1/events/:slug/orders — payload sai', () => {
  let s: Awaited<ReturnType<typeof standardEvent>>;
  let buyer: User;

  beforeAll(async () => {
    s = await standardEvent({ maxTicketsPerOrder: 4 });
    buyer = await signUp(h);
  });

  const valid = () => orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers });

  it.each([
    ['0 dòng', () => ({ ...valid(), items: [] }), 'items'],
    ['số lượng 0', () => ({ ...valid(), items: [{ ticketTypeId: s.a.id, quantity: 0 }] }), 'items.0.quantity'],
    ['số lượng 1.5', () => ({ ...valid(), items: [{ ticketTypeId: s.a.id, quantity: 1.5 }] }), 'items.0.quantity'],
    [
      'tổng > giới hạn Vé/Đơn (4)',
      () => ({
        ...valid(),
        items: [
          { ticketTypeId: s.a.id, quantity: 3 },
          { ticketTypeId: s.b.id, quantity: 2 },
        ],
      }),
      'items',
    ],
    ['thiếu câu bắt buộc', () => ({ ...valid(), answers: { [s.level.id]: s.level.options[0]!.id } }), 'answers.<size>'],
    ['phương án lạ', () => ({ ...valid(), answers: { ...s.answers, [s.level.id]: randomUUID() } }), 'answers.<level>'],
    ['SĐT sai', () => ({ ...valid(), buyer: { name: 'An', phone: '12345' } }), 'buyer.phone'],
    ['tên rỗng', () => ({ ...valid(), buyer: { name: '  ', phone: '0912345678' } }), 'buyer.name'],
    ['có email (lấy từ tài khoản, không nhận)', () => ({ ...valid(), email: 'khac@vidu.vn' }), ''],
  ])('%s → 400 VALIDATION_FAILED tại đúng trường, không tạo Đơn, không tính lần thử', async (_label, make, path) => {
    const res = await postOrder(h, buyer, s.event.slug, make()).expect(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    const expected = path.replace('<size>', s.size.id).replace('<level>', s.level.id);
    expect((error.details as { issues: { path: string }[] }).issues.map((i) => i.path)).toContain(expected);
    expect(await ordersOfEvent(h, s.event.id)).toEqual([]);
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 0 });
    expect(await attempts()).toBe(0);
  });

  it.each([
    ['thiếu Idempotency-Key', null],
    ['Idempotency-Key không phải uuid', 'khoa-1'],
  ])('%s → 400 VALIDATION_FAILED tại headers.idempotency-key', async (_label, key) => {
    const res = await postOrder(h, buyer, s.event.slug, valid(), key).expect(400);
    const error = errorOf(res.body);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect((error.details as { issues: { path: string }[] }).issues.map((i) => i.path)).toEqual([
      'headers.idempotency-key',
    ]);
    expect(await ordersOfEvent(h, s.event.id)).toEqual([]);
  });
});

describe('POST /v1/events/:slug/orders — chống trùng và Đơn chờ', () => {
  it('gửi lại cùng khóa → 200 Đơn cũ (trạng thái hiện tại), không giữ thêm chỗ; chỉ tính lần thử khi thử tạo link', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const key = randomUUID();
    const body = orderBody([{ ticketTypeId: s.a.id, quantity: 2 }], { answers: s.answers });
    const first = parseOrder((await postOrder(h, buyer, s.event.slug, body, key).expect(201)).body);
    const replay = await postOrder(h, buyer, s.event.slug, body, key).expect(200);
    expect(replay.headers['cache-control']).toBe('no-store');
    const again = parseOrder(replay.body);
    expect(again.code).toBe(first.code);
    expect(again.status).toBe('pending');
    // Thân request khác (vd. sửa form sau khi mất mạng) vẫn trả Đơn đã tạo.
    const changed = orderBody([{ ticketTypeId: s.b.id, quantity: 1 }], { answers: s.answers });
    expect(parseOrder((await postOrder(h, buyer, s.event.slug, changed, key).expect(200)).body).code).toBe(first.code);
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 2 });
    expect(await inventory(h, s.b.id)).toMatchObject({ held: 0 });
    expect(await ordersOfEvent(h, s.event.id)).toHaveLength(1);
    // Story 3.4: Đơn chưa có link (Tingee từ chối) mà còn lượt → mỗi lần gửi lại thử tạo link, tính một lần thử.
    expect(await attempts()).toBe(3);

    // Đơn đã hết hạn: gửi lại cùng khóa trả trạng thái hiện tại, không thử tạo link nên không tính lần thử.
    await h.db.orm.execute(sql`UPDATE orders SET status = 'expired' WHERE code = ${first.code}`);
    expect(parseOrder((await postOrder(h, buyer, s.event.slug, body, key).expect(200)).body).status).toBe('expired');
    expect(await attempts()).toBe(3);
  });

  it('hai request song song cùng khóa → đúng một Đơn, một 201 và một 200 cùng mã, giữ chỗ một lần', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const key = randomUUID();
    const body = orderBody([{ ticketTypeId: s.a.id, quantity: 2 }], { answers: s.answers });
    const results = await Promise.all([
      postOrder(h, buyer, s.event.slug, body, key),
      postOrder(h, buyer, s.event.slug, body, key),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(new Set(results.map((r) => parseOrder(r.body).code)).size).toBe(1);
    expect(await ordersOfEvent(h, s.event.id)).toHaveLength(1);
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 2 });
  });

  it('đã có Đơn chờ khác cho Sự kiện → 409 PENDING_ORDER_EXISTS {code}; Sự kiện khác vẫn đặt được', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const body = orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers });
    const first = parseOrder((await postOrder(h, buyer, s.event.slug, body).expect(201)).body);
    const res = await postOrder(h, buyer, s.event.slug, body).expect(409);
    const error = errorOf(res.body);
    expect(error.code).toBe('PENDING_ORDER_EXISTS');
    expect(PendingOrderExistsDetails.parse(error.details)).toEqual({ code: first.code });
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 1 });
    // 409 chặn trước TX1: không tính vào giới hạn tốc độ.
    expect(await attempts()).toBe(1);

    const other = await eventOnSale(org, [{ name: 'Khác', price: 0, capacity: 5 }]);
    await postOrder(h, buyer, other.event.slug, orderBody([{ ticketTypeId: other.tiers[0]!.id, quantity: 1 }])).expect(
      201,
    );
  });

  it('Đơn chờ cũ chưa có link đã quá hạn, job chưa chạy → hết hạn Đơn cũ (nhả chỗ) rồi tạo Đơn mới', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const first = parseOrder(
      (
        await postOrder(h, buyer, s.event.slug, orderBody([{ ticketTypeId: s.a.id, quantity: 3 }], { answers: s.answers }))
      ).body,
    );
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '1 second' WHERE code = ${first.code}`);
    const res = await postOrder(
      h,
      buyer,
      s.event.slug,
      orderBody([{ ticketTypeId: s.a.id, quantity: 2 }], { answers: s.answers }),
    ).expect(201);
    expect(parseOrder(res.body).code).not.toBe(first.code);
    expect((await orderRow(h, first.code))!.status).toBe('expired');
    expect(await inventory(h, s.a.id)).toMatchObject({ held: 2 });
  });
});

describe('POST /v1/events/:slug/orders — giới hạn tốc độ', () => {
  it('quá 10 lần/10 phút theo tài khoản → 429 ORDER_RATE_LIMITED {retryAfterSeconds}', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Hết', price: 0, capacity: 1 }]);
    const tier = sale.tiers[0]!;
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = 1 WHERE ticket_type_id = ${tier.id}`);
    const body = orderBody([{ ticketTypeId: tier.id, quantity: 1 }]);
    for (let i = 0; i < 10; i++) await postOrder(h, buyer, sale.event.slug, body).expect(409);
    const res = await postOrder(h, buyer, sale.event.slug, body).expect(429);
    const error = errorOf(res.body);
    expect(error.code).toBe('ORDER_RATE_LIMITED');
    const { retryAfterSeconds } = OrderRateLimitedDetails.parse(error.details);
    expect(retryAfterSeconds).toBeGreaterThan(590);
    expect(retryAfterSeconds).toBeLessThanOrEqual(600);
    // Người mua khác cùng IP vẫn thử được.
    await postOrder(h, await signUp(h), sale.event.slug, body).expect(409);
  });

  it('quá 600 lần/10 phút theo IP (lưới chặn cuối, CGNAT) → 429 cho cả tài khoản mới; 599 thì vẫn qua', async () => {
    const sale = await eventOnSale(org, [{ name: 'Vé', price: 0, capacity: 5 }]);
    const tier = sale.tiers[0]!;
    await h.db.orm.execute(sql`UPDATE ticket_type_inventory SET sold = 5 WHERE ticket_type_id = ${tier.id}`);
    const body = orderBody([{ ticketTypeId: tier.id, quantity: 1 }]);
    await postOrder(h, await signUp(h), sale.event.slug, body).expect(409);
    const { rows } = await h.db.pool.query<{ ip_hmac: string }>('SELECT ip_hmac FROM order_create_attempts LIMIT 1');
    const ipHmac = rows[0]!.ip_hmac;
    expect(ipHmac).toMatch(/^[0-9a-f]{64}$/);
    // 1 lần thật + 598 dòng = 599 < 600: tài khoản mới vẫn thử được (lần thứ 600).
    await h.db.orm.execute(sql`
      INSERT INTO order_create_attempts (user_id, ip_hmac)
      SELECT uuidv7(), ${ipHmac} FROM generate_series(1, 598)`);
    await postOrder(h, await signUp(h), sale.event.slug, body).expect(409);
    const res = await postOrder(h, await signUp(h), sale.event.slug, body).expect(429);
    expect(errorOf(res.body).code).toBe('ORDER_RATE_LIMITED');
  });
});

describe('GET /v1/me/orders/:code', () => {
  it('Đơn của mình → BuyerOrder + serverNow; mã sai dạng, Đơn của người khác, không có → 404 ORDER_NOT_FOUND', async () => {
    const buyer = await signUp(h);
    const stranger = await signUp(h);
    const s = await standardEvent();
    const created = parseOrder(
      (
        await postOrder(h, buyer, s.event.slug, orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers }))
      ).body,
    );
    const res = await h.http.get(`/v1/me/orders/${created.code}`).set('cookie', buyer.cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const order = parseOrder(res.body);
    expect({ ...order, serverNow: '' }).toEqual({ ...created, serverNow: '' });

    for (const [cookie, code] of [
      [stranger.cookie, created.code],
      [buyer.cookie, 'TK00000000'],
      [buyer.cookie, 'tk-sai-dang'],
      [buyer.cookie, created.code.toLowerCase()],
    ] as const) {
      const miss = await h.http.get(`/v1/me/orders/${code}`).set('cookie', cookie).expect(404);
      expect(errorOf(miss.body).code).toBe('ORDER_NOT_FOUND');
    }
    await h.http.get(`/v1/me/orders/${created.code}`).expect(401);
  });

  it('bản chụp không đổi khi BTC sửa giá, tên Hạng vé, chính sách hoàn vé hay câu hỏi form', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const created = parseOrder(
      (
        await postOrder(h, buyer, s.event.slug, orderBody([{ ticketTypeId: s.a.id, quantity: 2 }], { answers: s.answers }))
      ).body,
    );
    const { owner } = org;
    await h.http
      .patch(`${eventsPath(org, s.event.id)}/ticket-types/${s.a.id}`)
      .set('cookie', owner.cookie)
      .send({ name: 'Đơn nam (mới)', price: 450_000, capacity: 5 })
      .expect(200);
    await h.http
      .patch(eventsPath(org, s.event.id))
      .set('cookie', owner.cookie)
      .send({
        name: s.event.name,
        startsAt: s.event.startsAt,
        endsAt: s.event.endsAt,
        refundPolicy: 'Không hoàn vé.',
      })
      .expect(200);
    await h.http
      .patch(`${eventsPath(org, s.event.id)}/form/questions/${s.size.id}`)
      .set('cookie', owner.cookie)
      .send({ label: 'Cỡ áo thun', kind: 'text', required: true })
      .expect(200);
    await h.http
      .delete(`${eventsPath(org, s.event.id)}/form/questions/${s.level.id}`)
      .set('cookie', owner.cookie)
      .expect(204);

    const order = parseOrder((await h.http.get(`/v1/me/orders/${created.code}`).set('cookie', buyer.cookie)).body);
    expect(order.items).toEqual(created.items);
    expect(order.totalAmount).toBe(600_000);
    expect(order.refundPolicy).toBe('Hoàn 100% trước 7 ngày.');
    expect(order.answers).toEqual(created.answers);
  });

  it('bản chụp bất biến ở DB: tickee_app không sửa được cột bản chụp của Đơn, dòng Đơn, câu trả lời', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const created = parseOrder(
      (
        await postOrder(h, buyer, s.event.slug, orderBody([{ ticketTypeId: s.a.id, quantity: 1 }], { answers: s.answers }))
      ).body,
    );
    const pgCode = (err: unknown) => (err as { code?: string }).code;
    for (const statement of [
      "UPDATE orders SET buyer_name = 'Khác' WHERE code = $1",
      'UPDATE orders SET total_amount = 1 WHERE code = $1',
      "UPDATE orders SET refund_policy = 'Khác' WHERE code = $1",
      "UPDATE order_items SET unit_price = 1 WHERE order_id = (SELECT id FROM orders WHERE code = $1)",
      "UPDATE order_answers SET answer = 'Khác' WHERE order_id = (SELECT id FROM orders WHERE code = $1)",
      'DELETE FROM order_items WHERE order_id = (SELECT id FROM orders WHERE code = $1)',
    ]) {
      await expect(h.db.pool.query(statement, [created.code])).rejects.toSatisfy((err) => pgCode(err) === '42501');
    }
    // Cột trạng thái vẫn ghi được (máy trạng thái).
    await h.db.pool.query("UPDATE orders SET status = 'expired' WHERE code = $1", [created.code]);
  });
});

describe('GET /v1/events/:slug/checkout', () => {
  it('câu hỏi theo thứ tự; chưa có Đơn: tên của tài khoản (rỗng với OTP), SĐT null, email tài khoản', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    const res = await h.http.get(`/v1/events/${s.event.slug}/checkout`).set('cookie', buyer.cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const form = CheckoutForm.parse(res.body);
    expect(form.questions.map((q) => q.label)).toEqual(['Size áo', 'Trình độ', 'Ghi chú']);
    expect(form.buyer).toEqual({ name: '', phone: null, email: buyer.email });
  });

  it('đã có Đơn (ở Sự kiện bất kỳ): tên và SĐT của Đơn gần nhất', async () => {
    const buyer = await signUp(h);
    const first = await standardEvent();
    await postOrder(
      h,
      buyer,
      first.event.slug,
      orderBody([{ ticketTypeId: first.a.id, quantity: 1 }], {
        answers: first.answers,
        buyer: { name: 'Trần Thị Bình', phone: '0987.654.321' },
      }),
    ).expect(201);
    const second = await standardEvent();
    await postOrder(
      h,
      buyer,
      second.event.slug,
      orderBody([{ ticketTypeId: second.a.id, quantity: 1 }], {
        answers: second.answers,
        buyer: { name: 'Lê Văn Cường', phone: '0901 222 333' },
      }),
    ).expect(201);
    const other = await standardEvent();
    const res = await h.http.get(`/v1/events/${other.event.slug}/checkout`).set('cookie', buyer.cookie).expect(200);
    expect(CheckoutForm.parse(res.body).buyer).toEqual({
      name: 'Lê Văn Cường',
      phone: '+84901222333',
      email: buyer.email,
    });
  });

  it('chưa đăng nhập → 401; slug lạ → 404 EVENT_NOT_FOUND', async () => {
    const buyer = await signUp(h);
    const s = await standardEvent();
    await h.http.get(`/v1/events/${s.event.slug}/checkout`).expect(401);
    const res = await h.http.get('/v1/events/khong-co-su-kien-nay/checkout').set('cookie', buyer.cookie).expect(404);
    expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
  });
});
