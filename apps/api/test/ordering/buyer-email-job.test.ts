import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  BuyerEmailKind,
  formatVnDateTime,
  JobQueue,
  SharedTicketView,
  type SendBuyerEmailPayload,
} from '@tickee/contracts';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BUYER_EMAIL_QUEUE_OPTIONS,
  buyerEmailJobId,
  enqueueBuyerEmail,
  sendBuyerEmail,
  type BuyerEmailSender,
} from '../../src/modules/ordering/buyer-email-jobs.js';
import { buildOrphanSoldOutEmail, buildTicketsEmail } from '../../src/modules/ordering/buyer-email.js';
import { markExpired, OrderPayments } from '../../src/modules/ordering/index.js';
import { TicketsService } from '../../src/modules/ticketing/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { TEST_WEB_ORIGIN, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, signUp, type Harness } from '../identity/harness.js';
import { orderState } from '../payment/ipn-fixtures.js';
import {
  eventOnSale,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type User,
} from './order-fixtures.js';

/*
 * Story 3.8, FR-23: hàng đợi email Người mua `ordering.send-buyer-email`. `markPaid` enqueue đúng một job `tickets` trong
 * `tx` (rollback thì không có); nhánh `orphan` `sold_out` của IPN enqueue `orphan_sold_out`; id job cố định nên enqueue
 * lặp vẫn một job. Worker gửi một email có N link mở được; Đơn không còn `paid` / Sự kiện hủy → không gửi; SMTP lỗi →
 * retry rồi dead-letter, lỗi lưu không có email, Vé vẫn hợp lệ.
 */

const QUEUE = JobQueue.ORDERING_SEND_BUYER_EMAIL;
const DEAD_LETTER = JobQueue.ORDERING_SEND_BUYER_EMAIL_DEAD_LETTER;
const LINK = new RegExp(`${TEST_WEB_ORIGIN.replace(/[.]/g, '\\.')}/xem-ve#([A-Za-z0-9_-]{22})`, 'g');

let h: Harness;
let org: Org;
let boss: PgBoss;
let db: Database;
let payments: OrderPayments;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Chạy bộ <Sáng> & "Tối"' });
  boss = h.app.get<PgBoss>(BOSS);
  db = h.app.get<Database>(DATABASE);
  payments = h.app.get(OrderPayments);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

const jobsOf = (orderId: string, queue: string = QUEUE) =>
  boss.findJobs<SendBuyerEmailPayload>(queue, { data: { orderId } });

/**
 * Sự kiện mới có một Hạng vé (tên có ký tự HTML), địa điểm; `buyer` (mặc định Người mua mới) đặt `quantity` Vé.
 */
async function placeOrder(price: number, quantity: number, capacity = 10, buyer?: User) {
  buyer ??= await signUp(h);
  const sale = await eventOnSale(org, [{ name: 'Hạng <A>', price, capacity }]);
  await h.db.pool.query(`UPDATE events SET name = 'Giải <Mùa thu> & "Bạn"', venue = 'Sân A & B' WHERE id = $1`, [
    sale.event.id,
  ]);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  const { id } = await orderState(h, order.code);
  return { buyer, sale, order, orderId: id };
}

const freeOrder = (quantity = 2, buyer?: User) => placeOrder(0, quantity, 10, buyer);

describe('enqueue trong markPaid', () => {
  it('Đơn 0đ → paid: đúng một job tickets, id cố định theo (kind, orderId), payload chỉ { kind, orderId }', async () => {
    const { buyer, order, orderId } = await freeOrder(2);
    const jobs = await jobsOf(orderId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe(buyerEmailJobId(BuyerEmailKind.TICKETS, orderId));
    expect(jobs[0]!.data).toEqual({ kind: 'tickets', orderId });
    const raw = JSON.stringify(jobs[0]!.data);
    for (const secret of [buyer.email, order.buyer.name, order.buyer.phone, ...order.tickets.map((t) => t.shareToken)]) {
      expect(raw).not.toContain(secret);
    }
  });

  it('IPN đúng tiền (markPaid nguồn ipn) → paid + đúng một job tickets', async () => {
    const { orderId, order } = await placeOrder(100_000, 1);
    expect(await jobsOf(orderId)).toEqual([]);
    expect(await db.transaction((tx) => payments.markPaid(tx, orderId, 'ipn', order.totalAmount))).toEqual({
      outcome: 'paid',
    });
    expect((await jobsOf(orderId)).map((j) => j.data)).toEqual([{ kind: 'tickets', orderId }]);
  });

  it('tx rollback sau khi phát Vé → không Vé, không job; Đơn vẫn pending', async () => {
    const { orderId, order } = await placeOrder(100_000, 2);
    await expect(
      db.transaction(async (tx) => {
        expect(await payments.markPaid(tx, orderId, 'ipn', order.totalAmount)).toEqual({ outcome: 'paid' });
        throw new Error('lỗi của bên gọi sau khi phát Vé');
      }),
    ).rejects.toThrow('lỗi của bên gọi sau khi phát Vé');
    expect(await orderState(h, order.code)).toMatchObject({ status: 'pending', tickets: 0 });
    expect(await jobsOf(orderId)).toEqual([]);
  });

  it('enqueue lặp cùng (kind, orderId) — cùng tx hay tx khác → vẫn một job; kind khác → job khác', async () => {
    const { orderId } = await freeOrder(1);
    await payments.ready();
    await db.transaction(async (tx) => {
      await enqueueBuyerEmail(boss, tx, BuyerEmailKind.TICKETS, orderId);
      await enqueueBuyerEmail(boss, tx, BuyerEmailKind.TICKETS, orderId);
    });
    await db.transaction((tx) => enqueueBuyerEmail(boss, tx, BuyerEmailKind.TICKETS, orderId));
    expect(await jobsOf(orderId)).toHaveLength(1);
    await db.transaction((tx) => enqueueBuyerEmail(boss, tx, BuyerEmailKind.ORPHAN_SOLD_OUT, orderId));
    expect((await jobsOf(orderId)).map((j) => j.data.kind).sort()).toEqual(['orphan_sold_out', 'tickets']);
  });

  it('tiền về muộn cho Đơn expired mà Hạng vé đã hết → orphan sold_out + đúng một job orphan_sold_out, không job tickets', async () => {
    const { orderId, order, sale } = await placeOrder(100_000, 2, 2);
    expect(await db.transaction((tx) => markExpired(tx, orderId))).toBe('expired');
    // Người mua khác giữ hết chỗ.
    const rival = await signUp(h);
    await postOrder(h, rival, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 2 }])).expect(201);
    expect(await db.transaction((tx) => payments.markPaid(tx, orderId, 'ipn', order.totalAmount))).toEqual({
      outcome: 'orphan',
      reason: 'sold_out',
    });
    const jobs = await jobsOf(orderId);
    expect(jobs.map((j) => [j.id, j.data])).toEqual([
      [buyerEmailJobId(BuyerEmailKind.ORPHAN_SOLD_OUT, orderId), { kind: 'orphan_sold_out', orderId }],
    ]);
  });

  it('orphan khác sold_out (đã kết thúc, bị khóa) và lệch tiền → không job email', async () => {
    for (const set of ["effective_end_at = now() - interval '1 minute'", "locked_at = now(), lock_reason = 'test'"]) {
      const { orderId, order, sale } = await placeOrder(100_000, 1);
      expect(await db.transaction((tx) => markExpired(tx, orderId))).toBe('expired');
      await h.db.pool.query(`UPDATE events SET ${set} WHERE id = $1`, [sale.event.id]);
      expect((await db.transaction((tx) => payments.markPaid(tx, orderId, 'ipn', order.totalAmount))).outcome).toBe(
        'orphan',
      );
      expect(await jobsOf(orderId)).toEqual([]);
    }
    const mismatch = await placeOrder(100_000, 1);
    expect(
      await db.transaction((tx) => payments.markPaid(tx, mismatch.orderId, 'ipn', mismatch.order.totalAmount - 1)),
    ).toEqual({ outcome: 'mismatch' });
    expect(await jobsOf(mismatch.orderId)).toEqual([]);
  });
});

describe('mẫu email', () => {
  it('email Vé: text + HTML (escape), giờ formatVnDateTime, địa điểm, mã Đơn, mỗi Vé một dòng "Vé k/N · Hạng" kèm link, link Trang Đơn', () => {
    const startsAt = new Date('2099-11-16T00:00:00.000Z');
    const message = buildTicketsEmail({
      eventName: 'Giải <Mùa thu>',
      startsAt,
      venue: 'Sân A & B',
      orderCode: 'TK8F3Q2AXM',
      tickets: [
        { seq: 1, count: 2, ticketTypeName: 'Hạng <A>', link: `${TEST_WEB_ORIGIN}/xem-ve#tok1` },
        { seq: 2, count: 2, ticketTypeName: 'Hạng <A>', link: `${TEST_WEB_ORIGIN}/xem-ve#tok2` },
      ],
      orderLink: `${TEST_WEB_ORIGIN}/orders/TK8F3Q2AXM`,
    });
    expect(message.subject).toBe('Vé của bạn · Giải <Mùa thu>');
    for (const part of [
      'Giải <Mùa thu>',
      `Thời gian: ${formatVnDateTime(startsAt)} (giờ Việt Nam)`,
      'Địa điểm: Sân A & B',
      'Mã Đơn: TK8F3Q2AXM',
      `Vé 1/2 · Hạng <A>\n${TEST_WEB_ORIGIN}/xem-ve#tok1`,
      `Vé 2/2 · Hạng <A>\n${TEST_WEB_ORIGIN}/xem-ve#tok2`,
      `${TEST_WEB_ORIGIN}/orders/TK8F3Q2AXM`,
    ]) {
      expect(message.text).toContain(part);
    }
    expect(message.text).toContain('07:00 16/11/2099 (giờ Việt Nam)');
    expect(message.html).toContain('Giải &lt;Mùa thu&gt;');
    expect(message.html).toContain('Sân A &amp; B');
    expect(message.html).toContain('Vé 1/2 · Hạng &lt;A&gt;');
    expect(message.html).toContain(`href="${TEST_WEB_ORIGIN}/xem-ve#tok2"`);
    expect(message.html).not.toMatch(/<Mùa thu>|<A>/);
    // Không đính QR.
    expect(message.html).not.toMatch(/<img|data:image/);

    const noVenue = buildTicketsEmail({
      eventName: 'X',
      startsAt,
      venue: null,
      orderCode: 'TK8F3Q2AXM',
      tickets: [],
      orderLink: `${TEST_WEB_ORIGIN}/orders/TK8F3Q2AXM`,
    });
    expect(noVenue.text).not.toContain('Địa điểm');
  });

  it('email orphan_sold_out: câu báo hoàn tiền, mã Đơn, Sự kiện, kênh liên hệ BTC (escape trong HTML)', () => {
    const message = buildOrphanSoldOutEmail({
      eventName: 'Giải <Mùa thu>',
      orderCode: 'TK8F3Q2AXM',
      organizer: { name: 'CLB <X>', contactPhone: '0912345678', contactEmail: 'btc@vidu.vn' },
    });
    expect(message.subject).toContain('TK8F3Q2AXM');
    for (const part of [
      'BTC đã nhận tiền nhưng Hạng vé đã hết, BTC sẽ liên hệ hoàn tiền.',
      'Sự kiện: Giải <Mùa thu>',
      'Mã Đơn: TK8F3Q2AXM',
      'Liên hệ BTC: CLB <X>',
      'SĐT: 0912345678',
      'Email: btc@vidu.vn',
    ]) {
      expect(message.text).toContain(part);
    }
    expect(message.html).toContain('CLB &lt;X&gt;');
    expect(message.html).not.toContain('<X>');
    const noContact = buildOrphanSoldOutEmail({
      eventName: 'X',
      orderCode: 'TK8F3Q2AXM',
      organizer: { name: 'CLB', contactPhone: null, contactEmail: null },
    });
    expect(noContact.text).not.toMatch(/SĐT|Email:/);
  });
});

describe('sendBuyerEmail (handler)', () => {
  let email: FakeEmailTransport;
  const sender = (): BuyerEmailSender => ({
    db: h.db,
    email,
    tickets: h.app.get(TicketsService),
    webOrigin: TEST_WEB_ORIGIN,
  });
  const send = (payload: SendBuyerEmailPayload) => sendBuyerEmail(sender(), payload);
  beforeEach(() => {
    email = new FakeEmailTransport();
  });

  it('Đơn chưa paid / không có / Sự kiện hủy → skipped, không gửi; orphan khi Đơn không còn review → skipped', async () => {
    const pending = await placeOrder(100_000, 1);
    expect(await send({ kind: 'tickets', orderId: pending.orderId })).toBe('skipped');
    expect(await send({ kind: 'tickets', orderId: randomUUID() })).toBe('skipped');
    const cancelled = await freeOrder(1);
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [cancelled.sale.event.id]);
    expect(await send({ kind: 'tickets', orderId: cancelled.orderId })).toBe('skipped');
    const paid = await freeOrder(1);
    expect(await send({ kind: 'orphan_sold_out', orderId: paid.orderId })).toBe('skipped');
    expect(email.sent).toEqual([]);
  });

  it('Sự kiện đã quá effective_end_at lúc gửi (retry kéo dài) → skipped: mọi link trong email đã 404', async () => {
    const ended = await freeOrder(1);
    await h.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = $1", [
      ended.sale.event.id,
    ]);
    expect(await send({ kind: 'tickets', orderId: ended.orderId })).toBe('skipped');
    expect(email.sent).toEqual([]);
  });

  it('loại email lạ (payload không qua schema) → ném lỗi, không gửi gì (không rơi vào email hoàn tiền)', async () => {
    const { orderId } = await placeOrder(100_000, 1);
    await h.db.pool.query("UPDATE orders SET status = 'review' WHERE id = $1", [orderId]);
    const payload = { kind: 'event_rescheduled', orderId } as unknown as SendBuyerEmailPayload;
    await expect(send(payload)).rejects.toThrow(/event_rescheduled/);
    expect(email.sent).toEqual([]);
  });

  it('orphan_sold_out cho Đơn review → một email tới buyer_email, kèm tên BTC', async () => {
    const { orderId, buyer, order } = await placeOrder(100_000, 1);
    await h.db.pool.query("UPDATE orders SET status = 'review' WHERE id = $1", [orderId]);
    expect(await send({ kind: 'orphan_sold_out', orderId })).toBe('sent');
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: buyer.email });
    expect(email.sent[0]!.text).toContain(order.code);
    expect(email.sent[0]!.text).toContain('CLB Chạy bộ <Sáng> & "Tối"');
  });

  it('SMTP lỗi → ném lỗi chỉ có tên lớp (không email), không gửi', async () => {
    const { orderId, buyer } = await freeOrder(1);
    class SmtpRejected extends Error {}
    email.failWith = new SmtpRejected(`550 hộp thư ${buyer.email} không tồn tại`);
    const failure = await send({ kind: 'tickets', orderId }).catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Không gửi được email Người mua (SmtpRejected)');
    expect((failure as Error).message).not.toContain(buyer.email);
  });
});

describe('worker', () => {
  let worker: INestApplicationContext;
  let workerEmail: FakeEmailTransport;
  let workerBoss: PgBoss;
  /**
   * Log của worker: nối Nest `Logger` vào pino như `roles/worker.ts`. nestjs-pino giữ một logger gốc cho cả process
   * (`LoggerModule` tạo trước thắng), nên trong file này log của worker đi vào cùng capture với api (`h.logs`). Các test
   * dưới kiểm có dòng của `BuyerEmailWorker` trước khi kiểm vắng email/token, để phép kiểm không rỗng.
   */
  const workerLines = () => h.logs.lines.filter((l) => l.context === 'BuyerEmailWorker');

  beforeAll(async () => {
    workerEmail = new FakeEmailTransport();
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig())] })
      .overrideProvider(EMAIL_TRANSPORT)
      .useValue(workerEmail)
      .compile();
    moduleRef.useLogger(moduleRef.get(PinoNestLogger));
    worker = await moduleRef.init();
    workerBoss = worker.get<PgBoss>(BOSS);
  });
  afterAll(async () => {
    await worker.close();
  });

  const sentTo = (to: string) => workerEmail.sent.filter((m) => m.to === to);

  it('cấu hình queue: retry có backoff và dead-letter', async () => {
    const queue = await workerBoss.getQueue(QUEUE);
    expect(queue).toMatchObject({
      name: QUEUE,
      deadLetter: DEAD_LETTER,
      retryLimit: BUYER_EMAIL_QUEUE_OPTIONS.retryLimit,
      retryBackoff: true,
    });
    expect(queue?.retryLimit).toBeGreaterThan(0);
    expect((await workerBoss.getQueue(DEAD_LETTER))?.name).toBe(DEAD_LETTER);
  });

  it('Đơn 0đ 2 Vé → đúng một email tới buyer_email có 2 link; mỗi link GET ra đúng Vé đó; job completed', async () => {
    const { buyer, order, orderId } = await freeOrder(2);
    await expect.poll(() => sentTo(buyer.email).length, { timeout: 15_000, interval: 100 }).toBe(1);
    const message = sentTo(buyer.email)[0]!;
    expect(message.subject).toBe('Vé của bạn · Giải <Mùa thu> & "Bạn"');
    expect(message.text).toContain(order.code);
    expect(message.text).toContain('Địa điểm: Sân A & B');
    expect(message.text).toContain(`${TEST_WEB_ORIGIN}/orders/${order.code}`);
    expect(message.text).toContain(`Vé 1/2 · Hạng <A>`);
    const tokens = [...message.text.matchAll(LINK)].map((m) => m[1]!);
    expect(tokens).toEqual(order.tickets.map((t) => t.shareToken));
    for (const [i, token] of tokens.entries()) {
      const view = SharedTicketView.parse((await h.http.get(`/v1/shared-tickets/${token}`).expect(200)).body);
      expect(view).toMatchObject({ seq: i + 1, count: 2, qr: order.tickets[i]!.qr });
    }
    const jobId = buyerEmailJobId(BuyerEmailKind.TICKETS, orderId);
    await expect.poll(async () => (await workerBoss.getJobById(QUEUE, jobId))?.state, { timeout: 10_000 }).toBe('completed');
    // Log của worker có dòng xử lý job (chỉ loại, id) nhưng không có email hay token nào, ở mọi dòng log.
    await expect
      .poll(() => workerLines().some((l) => l.orderId === orderId && l.kind === 'tickets' && l.result === 'sent'))
      .toBe(true);
    expect(h.logs.text).not.toContain(buyer.email);
    for (const token of tokens) expect(h.logs.text).not.toContain(token);
  });

  it('SMTP lỗi hết lượt → job vào dead-letter, lỗi lưu không có email; GET /v1/me/orders/:code vẫn trả Vé', async () => {
    // Đặt lỗi trước khi có Đơn: worker đang poll, job `tickets` có ngay khi TX1 commit.
    const buyer = await signUp(h);
    workerEmail.failFor.set(buyer.email, new Error(`SMTP từ chối ${buyer.email}`));
    try {
      const { order, orderId } = await freeOrder(1, buyer);
      // Job thật (8 lượt) sang retry; một job cùng việc với 0 lượt retry đi thẳng dead-letter khi lỗi.
      const jobId = buyerEmailJobId(BuyerEmailKind.TICKETS, orderId);
      await expect.poll(async () => (await workerBoss.getJobById(QUEUE, jobId))?.state, { timeout: 15_000, interval: 100 }).toBe(
        'retry',
      );
      const exhausted = await workerBoss.send(QUEUE, { kind: 'tickets', orderId }, { retryLimit: 0 });
      await expect
        .poll(async () => (await workerBoss.getJobById(QUEUE, exhausted!))?.state, { timeout: 15_000, interval: 100 })
        .toBe('failed');
      const failed = await workerBoss.getJobById(QUEUE, exhausted!);
      expect(JSON.stringify(failed?.output)).toContain('Không gửi được email Người mua (Error)');
      expect(JSON.stringify(failed?.output)).not.toContain(buyer.email);
      await expect.poll(async () => (await jobsOf(orderId, DEAD_LETTER)).length, { timeout: 10_000, interval: 100 }).toBe(1);
      expect(sentTo(buyer.email)).toEqual([]);

      const view = parseOrder((await h.http.get(`/v1/me/orders/${order.code}`).set('cookie', buyer.cookie).expect(200)).body);
      expect(view.buyerStatus).toBe('paid');
      expect(view.tickets.map((t) => t.id)).toEqual(order.tickets.map((t) => t.id));
      await h.http.get(`/v1/shared-tickets/${order.tickets[0]!.shareToken}`).expect(200);
      // Worker log warn mỗi lần gửi lỗi (kèm lỗi đã lọc), không bao giờ có email trong lỗi SMTP.
      expect(workerLines().filter((l) => l.orderId === orderId).length).toBeGreaterThan(0);
      expect(h.logs.text).not.toContain(buyer.email);
    } finally {
      workerEmail.failFor.delete(buyer.email);
    }
  });

  it('job gửi lúc Đơn không còn paid → completed, không gửi', async () => {
    const { buyer, orderId } = await placeOrder(100_000, 1);
    const jobId = await workerBoss.send(QUEUE, { kind: 'tickets', orderId });
    await expect.poll(async () => (await workerBoss.getJobById(QUEUE, jobId!))?.state, { timeout: 15_000, interval: 100 }).toBe(
      'completed',
    );
    expect(sentTo(buyer.email)).toEqual([]);
  });
});
