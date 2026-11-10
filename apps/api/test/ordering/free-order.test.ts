import { randomUUID } from 'node:crypto';
import { ErrorResponse, JobQueue, TICKET_QR_PATTERN, type BuyerOrder } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketQrKeys,
  TicketsService,
  verifyTicketQr,
  type IssueTicketsInput,
  type IssuedTicket,
} from '../../src/modules/ticketing/index.js';
import { audit } from '../../src/platform/audit/index.js';
import type { Tx } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { TEST_TICKET_QR_KEYS } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
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
 * Story 3.3: Đơn tổng 0đ bán ngay trong TX1, `markPaid` nguồn `free` phát Vé có bản chụp và Mã QR vé ký số; trần Vé
 * miễn phí của Người mua; trang Đơn trả Vé. Mọi dòng của I/O Matrix trừ đua (free-order-concurrency.test.ts) và kiểm
 * QR thuần (ticketing/qr.test.ts). `TicketsService` bọc lại để giả lỗi phát Vé (rollback cả TX1).
 */

class ToggleTicketsService extends TicketsService {
  failIssue = false;

  override async issueTickets(tx: Tx, input: IssueTicketsInput): Promise<IssuedTicket[]> {
    if (this.failIssue) throw new Error('Lỗi phát Vé giả lập (test)');
    return super.issueTickets(tx, input);
  }
}

const qrKeys = TicketQrKeys.parse(TEST_TICKET_QR_KEYS);
const tickets = new ToggleTicketsService(qrKeys);

let h: Harness;
let boss: PgBoss;
let org: Org;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [{ provide: TicketsService, useValue: tickets }, rejectingTingee] });
  boss = h.app.get<PgBoss>(BOSS);
  org = await paidReadyOrg(h);
});
beforeEach(async () => {
  tickets.failIssue = false;
  await resetOrderRateLimit(h);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await h.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

type TicketRow = {
  id: string;
  order_id: string;
  event_id: string;
  organization_id: string;
  user_id: string;
  ticket_type_id: string;
  seq: number;
  order_ticket_count: number;
  holder_name: string;
  ticket_type_name: string;
  order_code: string;
  issued_at: Date;
  qr_key_version: number;
  status: string;
  cancel_reason: string | null;
  checked_in_at: Date | null;
};

async function ticketRows(orderCode: string): Promise<TicketRow[]> {
  const { rows } = await h.db.pool.query<TicketRow>(
    `SELECT id, order_id, event_id, organization_id, user_id, ticket_type_id, seq, order_ticket_count, holder_name,
            ticket_type_name, order_code, issued_at, qr_key_version, status, cancel_reason, checked_in_at
     FROM tickets WHERE order_code = $1 ORDER BY seq`,
    [orderCode],
  );
  return rows;
}

async function ticketsOfEvent(eventId: string): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM tickets WHERE event_id = $1', [
    eventId,
  ]);
  return rows[0]!.n;
}

async function paidRow(code: string) {
  const { rows } = await h.db.pool.query<{
    paid_at: Date | null;
    paid_amount: string | null;
    paid_source: string | null;
    expires_at: Date;
    created_at: Date;
  }>('SELECT paid_at, paid_amount, paid_source, expires_at, created_at FROM orders WHERE code = $1', [code]);
  return rows[0]!;
}

/** Sự kiện miễn phí đang bán: Hạng vé 0đ theo `capacities` (tạo theo thứ tự), giới hạn Vé/Đơn tùy chọn. */
async function freeEvent(capacities: number[], maxTicketsPerOrder?: number) {
  return eventOnSale(
    org,
    capacities.map((capacity, i) => ({ name: `Vé miễn phí ${i + 1}`, price: 0, capacity })),
    maxTicketsPerOrder === undefined ? {} : { maxTicketsPerOrder },
  );
}

function register(
  buyer: User,
  slug: string,
  items: { ticketTypeId: string; quantity: number }[],
  extra: Record<string, unknown> = {},
  key = randomUUID(),
) {
  return postOrder(h, buyer, slug, orderBody(items, extra), key);
}

describe('POST /v1/events/:slug/orders — Đơn tổng 0đ', () => {
  it('đăng ký thành công: 201 paid + 2 Vé (seq 1,2, count 2, QR ký số); sold +2, held không đổi; phễu, audit, không job', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([5]);
    const tier = sale.tiers[0]!;
    const funnelId = randomUUID();
    await h.http
      .post(`/v1/events/${sale.event.slug}/funnel-events`)
      .send({ type: 'buy_clicked', funnelId, loginRequired: false })
      .expect(204);

    const res = await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 2 }], { funnelId }).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const order = parseOrder(res.body);
    expect(order).toMatchObject({
      status: 'paid',
      totalAmount: 0,
      event: { slug: sale.event.slug, name: sale.event.name, startsAt: '2099-11-16T07:00:00+07:00' },
      buyer: { name: 'Nguyễn Văn An', phone: '+84912345678', email: buyer.email },
    });
    expect(order.tickets.map(({ seq, count, ticketTypeName, holderName }) => ({ seq, count, ticketTypeName, holderName }))).toEqual([
      { seq: 1, count: 2, ticketTypeName: 'Vé miễn phí 1', holderName: 'Nguyễn Văn An' },
      { seq: 2, count: 2, ticketTypeName: 'Vé miễn phí 1', holderName: 'Nguyễn Văn An' },
    ]);
    for (const ticket of order.tickets) {
      expect(ticket.qr).toMatch(TICKET_QR_PATTERN);
      expect(verifyTicketQr(qrKeys, ticket.qr)).toEqual({ ticketId: ticket.id, keyVersion: 1 });
    }
    expect(new Set(order.tickets.map((t) => t.qr)).size).toBe(2);

    expect(await inventory(h, tier.id)).toEqual({ capacity: 5, sold: 2, held: 0 });

    const row = (await orderRow(h, order.code))!;
    expect(row.status).toBe('paid');
    const paid = await paidRow(order.code);
    expect(paid.paid_source).toBe('free');
    expect(Number(paid.paid_amount)).toBe(0);
    expect(paid.paid_at).not.toBeNull();
    // Không Giữ chỗ: hạn = lúc tạo (cột NOT NULL).
    expect(Math.abs(paid.expires_at.getTime() - paid.created_at.getTime())).toBeLessThan(5_000);

    const rows = await ticketRows(order.code);
    expect(rows).toHaveLength(2);
    for (const [i, t] of rows.entries()) {
      expect(t).toMatchObject({
        id: order.tickets[i]!.id,
        order_id: row.id,
        event_id: sale.event.id,
        organization_id: org.orgId,
        user_id: buyer.userId,
        ticket_type_id: tier.id,
        seq: i + 1,
        order_ticket_count: 2,
        holder_name: 'Nguyễn Văn An',
        ticket_type_name: 'Vé miễn phí 1',
        order_code: order.code,
        qr_key_version: 1,
        status: 'valid',
        cancel_reason: null,
        checked_in_at: null,
      });
      expect(t.issued_at.getTime()).toBe(paid.paid_at!.getTime());
    }

    const funnel = await h.db.pool.query<{ type: string }>(
      'SELECT type FROM checkout_funnel_events WHERE funnel_id = $1 ORDER BY id',
      [funnelId],
    );
    expect(funnel.rows.map((r) => r.type)).toEqual(['buy_clicked', 'order_created', 'paid']);

    const audits = await h.db.pool.query(
      `SELECT action, actor_user_id, organization_id, target_type FROM audit_events WHERE target_id = $1`,
      [row.id],
    );
    expect(audits.rows).toEqual([
      { action: 'order.paid', actor_user_id: null, organization_id: org.orgId, target_type: 'order' },
    ]);
    expect(await boss.findJobs(JobQueue.ORDERING_EXPIRE_ORDER, { data: { orderId: row.id } })).toEqual([]);
  });

  it('nhiều Hạng vé 0đ (A=1, B=2) → 3 Vé, seq 1..3 theo ticket_type_id tăng dần', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([5, 5]);
    const [first, second] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const res = await register(buyer, sale.event.slug, [
      { ticketTypeId: second.id, quantity: 2 },
      { ticketTypeId: first.id, quantity: 1 },
    ]).expect(201);
    const order = parseOrder(res.body);
    const quantities = new Map([
      [first.id, 1],
      [second.id, 2],
    ]);
    const ordered = [first, second].sort((a, b) => (a.id < b.id ? -1 : 1));
    const expectedTypes = ordered.flatMap((t) => Array<string>(quantities.get(t.id)!).fill(t.id));
    const rows = await ticketRows(order.code);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.ticket_type_id)).toEqual(expectedTypes);
    expect(rows.every((r) => r.order_ticket_count === 3)).toBe(true);
    expect(order.tickets.map((t) => [t.seq, t.count, t.ticketTypeName])).toEqual(
      rows.map((r) => [r.seq, 3, r.ticket_type_name]),
    );
    expect(await inventory(h, first.id)).toMatchObject({ sold: 1, held: 0 });
    expect(await inventory(h, second.id)).toMatchObject({ sold: 2, held: 0 });
  });

  it('hết vé: B thiếu chỗ → 409 TICKET_TYPE_SOLD_OUT, không có Đơn, sold của A không đổi, không Vé', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([5, 1]);
    const [a, b] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const res = await register(buyer, sale.event.slug, [
      { ticketTypeId: a.id, quantity: 2 },
      { ticketTypeId: b.id, quantity: 2 },
    ]).expect(409);
    expect(errorOf(res.body)).toMatchObject({
      code: 'TICKET_TYPE_SOLD_OUT',
      details: { ticketTypeId: b.id, ticketTypeName: 'Vé miễn phí 2' },
    });
    expect(await inventory(h, a.id)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await inventory(h, b.id)).toEqual({ capacity: 1, sold: 0, held: 0 });
    expect(await ordersOfEvent(h, sale.event.id)).toEqual([]);
    expect(await ticketsOfEvent(sale.event.id)).toBe(0);
  });

  it('vượt trần Người mua: đã có 8 Vé 0đ, giới hạn 10, xin thêm 3 → 409 FREE_TICKET_LIMIT_REACHED; xin 2 thì được', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([50]);
    const tier = sale.tiers[0]!;
    await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 5 }]).expect(201);
    await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 3 }]).expect(201);
    expect(await inventory(h, tier.id)).toMatchObject({ sold: 8, held: 0 });

    const res = await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 3 }]).expect(409);
    expect(errorOf(res.body)).toEqual({
      code: 'FREE_TICKET_LIMIT_REACHED',
      message: 'Bạn đã nhận đủ số Vé tối đa cho Sự kiện này.',
      details: null,
    });
    expect(await inventory(h, tier.id)).toMatchObject({ sold: 8, held: 0 });
    expect(await ordersOfEvent(h, sale.event.id)).toHaveLength(2);
    expect(await ticketsOfEvent(sale.event.id)).toBe(8);

    // Người mua khác không bị ảnh hưởng; Người mua này còn đúng 2.
    await register(await signUp(h), sale.event.slug, [{ ticketTypeId: tier.id, quantity: 10 }]).expect(201);
    await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 2 }]).expect(201);
    const again = await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 1 }]).expect(409);
    expect(errorOf(again.body).code).toBe('FREE_TICKET_LIMIT_REACHED');
  });

  it('trần theo giới hạn Vé/Đơn hiện tại của Sự kiện (4); Đơn không còn paid (đã hủy) không tính', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([50], 4);
    const tier = sale.tiers[0]!;
    const first = parseOrder((await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 3 }])).body);
    const capped = await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 2 }]).expect(409);
    expect(errorOf(capped.body).code).toBe('FREE_TICKET_LIMIT_REACHED');
    // Đơn đã hủy (vd. Story 4.4) không còn tính vào trần.
    await h.db.orm.execute(sql`UPDATE orders SET status = 'cancelled' WHERE code = ${first.code}`);
    await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 4 }]).expect(201);
  });

  it('Sự kiện hỗn hợp: 10 Vé có phí đã paid không tính vào trần → xin 2 Vé 0đ được 201 paid', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [
      { name: 'Có phí', price: 100_000, capacity: 20 },
      { name: 'Miễn phí', price: 0, capacity: 20 },
    ]);
    const [paidTier, freeTier] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const paidOrder = parseOrder(
      (await register(buyer, sale.event.slug, [{ ticketTypeId: paidTier.id, quantity: 10 }]).expect(201)).body,
    );
    expect(paidOrder.status).toBe('pending');
    // Thanh toán có phí là Story 3.5: giả lập Đơn đã trả.
    await h.db.orm.execute(sql`
      UPDATE orders SET status = 'paid', paid_at = now(), paid_amount = total_amount, paid_source = 'ipn'
      WHERE code = ${paidOrder.code}`);

    const res = await register(buyer, sale.event.slug, [{ ticketTypeId: freeTier.id, quantity: 2 }]).expect(201);
    const order = parseOrder(res.body);
    expect(order.status).toBe('paid');
    expect(order.tickets).toHaveLength(2);
  });

  it('Đơn tổng > 0 có cả dòng 0đ và dòng có phí → giữ đường 3.2 (pending, held), không Vé', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [
      { name: 'Có phí', price: 100_000, capacity: 5 },
      { name: 'Miễn phí', price: 0, capacity: 5 },
    ]);
    const [paidTier, freeTier] = sale.tiers as [(typeof sale.tiers)[0], (typeof sale.tiers)[0]];
    const res = await register(buyer, sale.event.slug, [
      { ticketTypeId: paidTier.id, quantity: 1 },
      { ticketTypeId: freeTier.id, quantity: 2 },
    ]).expect(201);
    const order = parseOrder(res.body);
    expect(order).toMatchObject({ status: 'pending', totalAmount: 100_000, tickets: [] });
    expect(await inventory(h, paidTier.id)).toMatchObject({ sold: 0, held: 1 });
    expect(await inventory(h, freeTier.id)).toMatchObject({ sold: 0, held: 2 });
    expect(await ticketsOfEvent(sale.event.id)).toBe(0);
    const paid = await paidRow(order.code);
    expect(paid).toMatchObject({ paid_at: null, paid_amount: null, paid_source: null });
    const row = (await orderRow(h, order.code))!;
    expect(await boss.findJobs(JobQueue.ORDERING_EXPIRE_ORDER, { data: { orderId: row.id } })).toHaveLength(1);
  });

  it('gửi lại cùng khóa → 200 đúng Đơn paid và đúng các Vé cũ, không phát thêm, không bán thêm', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([5]);
    const tier = sale.tiers[0]!;
    const key = randomUUID();
    const items = [{ ticketTypeId: tier.id, quantity: 2 }];
    const first = parseOrder((await register(buyer, sale.event.slug, items, {}, key).expect(201)).body);
    const replay = await register(buyer, sale.event.slug, items, {}, key).expect(200);
    const again = parseOrder(replay.body);
    expect(again.code).toBe(first.code);
    expect(again.status).toBe('paid');
    expect(again.tickets).toEqual(first.tickets);
    expect(await ticketsOfEvent(sale.event.id)).toBe(2);
    expect(await inventory(h, tier.id)).toMatchObject({ sold: 2, held: 0 });
    expect(await ordersOfEvent(h, sale.event.id)).toHaveLength(1);
  });
});

describe('TX1 Đơn 0đ rollback trọn gói', () => {
  async function expectNothingWritten(eventId: string, tierId: string): Promise<void> {
    expect(await ordersOfEvent(h, eventId)).toEqual([]);
    expect(await inventory(h, tierId)).toMatchObject({ sold: 0, held: 0 });
    expect(await ticketsOfEvent(eventId)).toBe(0);
  }

  it('lỗi khi phát Vé → 500, không Đơn, sold không đổi, không Vé, không dòng phễu', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([5]);
    const tier = sale.tiers[0]!;
    const funnelId = randomUUID();
    tickets.failIssue = true;
    await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 2 }], { funnelId }).expect(500);
    await expectNothingWritten(sale.event.id, tier.id);
    const funnel = await h.db.pool.query('SELECT 1 FROM checkout_funnel_events WHERE funnel_id = $1', [funnelId]);
    expect(funnel.rows).toEqual([]);
  });

  it('lỗi khi ghi audit order.paid → 500, không Đơn, sold không đổi, không Vé', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([5]);
    const tier = sale.tiers[0]!;
    const record = audit.record.bind(audit);
    vi.spyOn(audit, 'record').mockImplementation(async (tx, event) => {
      if (event.action === 'order.paid') throw new Error('Lỗi audit giả lập (test)');
      return record(tx, event);
    });
    await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 2 }]).expect(500);
    await expectNothingWritten(sale.event.id, tier.id);
  });

  it('vượt trần sau khi đã bán có điều kiện → rollback cả phần bán', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([20], 2);
    const tier = sale.tiers[0]!;
    await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 2 }]).expect(201);
    const capped = await register(buyer, sale.event.slug, [{ ticketTypeId: tier.id, quantity: 1 }]).expect(409);
    expect(errorOf(capped.body).code).toBe('FREE_TICKET_LIMIT_REACHED');
    expect(await inventory(h, tier.id)).toMatchObject({ sold: 2, held: 0 });
    expect(await ordersOfEvent(h, sale.event.id)).toHaveLength(1);
    expect(await ticketsOfEvent(sale.event.id)).toBe(2);
  });
});

describe('GET /v1/me/orders/:code — Đơn đã trả', () => {
  it('tickets[] có QR và event.startsAt; Đơn của người khác → 404', async () => {
    const buyer = await signUp(h);
    const stranger = await signUp(h);
    const sale = await freeEvent([5]);
    const created = parseOrder(
      (await register(buyer, sale.event.slug, [{ ticketTypeId: sale.tiers[0]!.id, quantity: 3 }]).expect(201)).body,
    );
    const res = await h.http.get(`/v1/me/orders/${created.code}`).set('cookie', buyer.cookie).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const order: BuyerOrder = parseOrder(res.body);
    expect({ ...order, serverNow: '' }).toEqual({ ...created, serverNow: '' });
    expect(order.event.startsAt).toBe('2099-11-16T07:00:00+07:00');
    expect(order.tickets.map((t) => `Vé ${t.seq}/${t.count}`)).toEqual(['Vé 1/3', 'Vé 2/3', 'Vé 3/3']);
    for (const t of order.tickets) expect(verifyTicketQr(qrKeys, t.qr)?.ticketId).toBe(t.id);

    const miss = await h.http.get(`/v1/me/orders/${created.code}`).set('cookie', stranger.cookie).expect(404);
    expect(errorOf(miss.body).code).toBe('ORDER_NOT_FOUND');
  });
});

describe('bảng tickets', () => {
  it('không lưu Mã QR hay chữ ký: chỉ id + qr_key_version', async () => {
    const { rows } = await h.db.pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tickets' ORDER BY ordinal_position`,
    );
    const columns = rows.map((r) => r.column_name);
    expect(columns).toContain('qr_key_version');
    expect(columns.filter((c) => /qr|sig/.test(c))).toEqual(['qr_key_version']);
  });

  it('bản chụp bất biến ở DB: tickee_app không sửa được; trạng thái vẫn ghi được; seq trùng trong Đơn bị chặn', async () => {
    const buyer = await signUp(h);
    const sale = await freeEvent([5]);
    const order = parseOrder(
      (await register(buyer, sale.event.slug, [{ ticketTypeId: sale.tiers[0]!.id, quantity: 1 }]).expect(201)).body,
    );
    const pgCode = (err: unknown) => (err as { code?: string }).code;
    for (const statement of [
      "UPDATE tickets SET holder_name = 'Khác' WHERE order_code = $1",
      'UPDATE tickets SET seq = 2 WHERE order_code = $1',
      "UPDATE tickets SET ticket_type_name = 'Khác' WHERE order_code = $1",
      'UPDATE tickets SET order_ticket_count = 5 WHERE order_code = $1',
      'UPDATE tickets SET issued_at = now() WHERE order_code = $1',
      'UPDATE tickets SET user_id = gen_random_uuid() WHERE order_code = $1',
    ]) {
      await expect(h.db.pool.query(statement, [order.code])).rejects.toSatisfy((err) => pgCode(err) === '42501');
    }
    await h.db.pool.query('UPDATE tickets SET checked_in_at = now() WHERE order_code = $1', [order.code]);
    // Phát lần hai cho cùng Đơn (cùng seq) → unique.
    await expect(
      h.db.pool.query(
        `INSERT INTO tickets (order_id, event_id, organization_id, user_id, ticket_type_id, seq, order_ticket_count,
           holder_name, ticket_type_name, order_code, issued_at, qr_key_version)
         SELECT order_id, event_id, organization_id, user_id, ticket_type_id, seq, order_ticket_count, holder_name,
           ticket_type_name, order_code, issued_at, qr_key_version FROM tickets WHERE order_code = $1`,
        [order.code],
      ),
    ).rejects.toSatisfy((err) => pgCode(err) === '23505');
  });

  it('Đơn paid luôn có paid_at/paid_amount/paid_source (CHECK)', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Có phí', price: 100_000, capacity: 5 }]);
    const order = parseOrder(
      (await register(buyer, sale.event.slug, [{ ticketTypeId: sale.tiers[0]!.id, quantity: 1 }]).expect(201)).body,
    );
    await expect(
      h.db.orm.execute(sql`UPDATE orders SET status = 'paid' WHERE code = ${order.code}`),
    ).rejects.toSatisfy((err) => ((err as { cause?: { code?: string } }).cause ?? (err as { code?: string })).code === '23514');
  });
});
