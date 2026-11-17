import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobQueue, RealtimeTopic } from '@tickee/contracts';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markExpired, OrderPayments } from '../../src/modules/ordering/index.js';
import { expireOrder } from '../../src/modules/ordering/order-jobs.js';
import {
  checkInventory,
  INVENTORY_CHECK_CRON,
  inventoryDriftSubject,
  purgeOrderCreateAttempts,
  SAFETY_SWEEP_CRON,
  SAFETY_SWEEP_GRACE_SECONDS,
  SAFETY_SWEEP_LIMIT,
  sweepOverdueOrders,
  type InventoryDrift,
  type SafetyNet,
  type SweptOrder,
} from '../../src/modules/ordering/safety-net-jobs.js';
import {
  OPS_ALERT_KINDS,
  OpsAlertEmailWorker,
  OpsAlertKind,
  OpsAlertPayload,
  OpsAlertQueue,
  OpsAlerts,
} from '../../src/platform/alerts/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { databaseUrl, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, signUp, type Harness } from '../identity/harness.js';
import { expectInvariants, orderState } from '../payment/ipn-fixtures.js';
import {
  eventOnSale,
  inventory,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type SaleEvent,
} from './order-fixtures.js';

/*
 * Story 4.6-c: lưới an toàn định kỳ của `ordering` trên Postgres thật và pg-boss thật (vai api: producer, không worker
 * nền chen vào), mỗi dòng của I/O Matrix. Hàm quét, dọn và đối chiếu gọi thẳng; khối cuối chạy worker thật (lịch cron,
 * job cron payload `null`). Tingee từ chối tạo link (Đơn chưa có link); link giả bằng tay. Mốc hết hạn lùi bằng
 * `now() - interval` trên DB.
 *
 * DB dùng chung, không truncate: harness api không có worker, nên mọi Đơn `pending` mà test khác để lại đều đã quá hạn,
 * và tồn kho do test khác ghi tay có thể lệch sẵn. `beforeAll` xả hết Đơn tồn (quét không giới hạn) và ghi dấu cho mọi
 * Hạng vé đang lệch; mọi assert theo id, mã Đơn hay subject của chính test.
 */

/** Quét đủ lớn để xả mọi Đơn quá hạn còn trong DB dùng chung trong một lượt. */
const DRAIN = 100_000;
const PRICE = 100_000;
const OPS_RECIPIENTS = ['van-hanh@tickee.test'];
const MSG_EXPIRED =
  'Lưới an toàn: Đơn quá hạn hơn 2 phút mà job hết hạn chưa xử lý (không được enqueue, lỗi đang retry, hoặc worker ngừng); đã cho hết hạn và nhả chỗ';
const MSG_FAILED = 'Lưới an toàn: không cho hết hạn được Đơn quá hạn; lượt sau thử lại';
const MSG_DRIFT = 'Đối chiếu tồn kho: Hạng vé lệch với Đơn đang chờ hoặc Vé đã phát; không tự sửa';

let h: Harness;
let org: Org;
let db: Database;
let boss: PgBoss;
let payments: OrderPayments;
let net: SafetyNet;
/** Kết nối `LISTEN` riêng của test: thấy mọi `NOTIFY` của kênh realtime. */
let listener: pg.Client;
const notified: { id: string; type: string }[] = [];

const sweep = (limit = DRAIN) => sweepOverdueOrders(net, limit);

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Bóng bàn Gò Vấp' });
  db = h.app.get<Database>(DATABASE);
  boss = h.app.get<PgBoss>(BOSS);
  payments = h.app.get(OrderPayments);
  await payments.ready();
  net = { db, alerts: h.app.get(OpsAlerts) };
  listener = new pg.Client({ connectionString: databaseUrl() });
  await listener.connect();
  listener.on('notification', (message) => {
    const payload = JSON.parse(message.payload ?? '{}') as Record<string, unknown>;
    notified.push({ id: String(payload.id), type: String(payload.type) });
  });
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
  // Đơn quá hạn và tồn kho lệch mà test khác để lại: xả và ghi dấu trước, để lượt của từng test chỉ báo cái mới.
  await sweep();
  await checkInventory(net);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await listener?.end();
  await h?.close();
});

interface Placed {
  id: string;
  code: string;
  eventId: string;
  tierId: string;
  total: number;
}

/** Sự kiện mới đang bán một Hạng vé 100.000đ. */
const newSale = (capacity = 5): Promise<SaleEvent> => eventOnSale(org, [{ name: 'Hạng A', price: PRICE, capacity }]);

/** Đơn `pending` chưa có link (Tingee từ chối tạo link) của một Người mua mới, giữ `quantity` chỗ. */
async function place(sale: SaleEvent, quantity: number): Promise<Placed> {
  const buyer = await signUp(h);
  const tierId = sale.tiers[0]!.id;
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity }])).expect(201);
  const order = parseOrder(res.body);
  expect(order.buyerStatus).toBe('awaiting_payment');
  const { id } = await orderState(h, order.code);
  return { id, code: order.code, eventId: sale.event.id, tierId, total: order.totalAmount };
}

/** Đơn `pending` giữ `quantity` chỗ của một Hạng vé 5 suất mới. */
const pendingOrder = async (quantity = 2) => place(await newSale(), quantity);

/** Lùi hạn của Đơn: `expires_at = now() - seconds` (đồng hồ DB). */
const expiredAgo = (orderId: string, seconds: number) =>
  h.db.pool.query('UPDATE orders SET expires_at = now() - make_interval(secs => $2) WHERE id = $1', [orderId, seconds]);

/** Giả TX2 bằng tay: link thanh toán và tài khoản nhận tiền mặc định của BTC. */
const withLink = (orderId: string) =>
  h.db.pool.query(
    `UPDATE orders SET payment_link = 'https://pay.tingee.test/safety-net',
            payout_account_id = (SELECT id FROM payout_accounts WHERE organization_id = $2 AND is_default)
      WHERE id = $1`,
    [orderId, org.orgId],
  );

const setInventory = (ticketTypeId: string, set: 'held' | 'sold', value: number) =>
  h.db.pool.query(`UPDATE ticket_type_inventory SET ${set} = $2 WHERE ticket_type_id = $1`, [ticketTypeId, value]);

const ipnPaid = (orderId: string, amount: number) =>
  db.transaction((tx) => payments.markPaid(tx, orderId, 'ipn', amount, { paidAt: null }));

const sweptOf = (swept: SweptOrder[], orderId: string) => swept.find((order) => order.orderId === orderId);
const expiredCount = (swept: SweptOrder[]) => swept.filter((order) => order.result === 'expired').length;

/** Job email cảnh báo vận hành có `data` chứa `filter`, theo thứ tự tạo. */
async function alertJobs(filter: Record<string, unknown>): Promise<OpsAlertPayload[]> {
  const jobs = await boss.findJobs(JobQueue.OPS_ALERT, { data: filter });
  return jobs.map((job) => OpsAlertPayload.parse(job.data));
}

/** Dấu chống lặp `inventory_drift` của một Hạng vé (mọi số liệu đã báo). */
async function driftMarksOf(ticketTypeId: string): Promise<string[]> {
  const { rows } = await h.db.pool.query<{ subject: string }>(
    "SELECT subject FROM ops_alert_marks WHERE kind = 'inventory_drift' AND subject LIKE $1 ORDER BY subject",
    [`${ticketTypeId}:%`],
  );
  return rows.map((row) => row.subject);
}

/** Email cảnh báo của job, gửi qua worker email thật với transport giả. */
async function emailOf(payload: OpsAlertPayload) {
  const email = new FakeEmailTransport();
  await new OpsAlertEmailWorker(boss, email, { recipients: OPS_RECIPIENTS }).deliver(payload);
  expect(email.sent).toHaveLength(1);
  return email.sent[0]!;
}

const safetyLogs = (match: (line: Record<string, unknown>) => boolean) =>
  h.logs.lines.filter((line) => line.context === 'OrderSafetyNet' && match(line));

describe('quét Đơn quá hạn (I/O Matrix)', () => {
  it('mặc định tối đa 200 Đơn mỗi lượt; chừa thêm 120 giây sau mốc hết hạn', () => {
    expect(SAFETY_SWEEP_LIMIT).toBe(200);
    expect(SAFETY_SWEEP_GRACE_SECONDS).toBe(120);
  });

  it('limit: mỗi lượt chỉ tối đa `limit` Đơn, cũ nhất (theo expires_at) trước; phần còn lại để lượt sau', async () => {
    const older = await pendingOrder(1);
    const newer = await pendingOrder(1);
    // Cũ hơn mọi Đơn tồn có thể còn trong DB dùng chung, nên hai Đơn này đứng đầu hàng quét.
    await h.db.pool.query("UPDATE orders SET expires_at = now() - interval '10 years' WHERE id = $1", [older.id]);
    await h.db.pool.query("UPDATE orders SET expires_at = now() - interval '10 years' + interval '1 day' WHERE id = $1", [
      newer.id,
    ]);

    const first = await sweepOverdueOrders(net, 1);
    expect(first).toEqual([{ orderId: older.id, orderCode: older.code, kind: 'hold', result: 'expired' }]);
    expect((await orderState(h, older.code)).status).toBe('expired');
    expect((await orderState(h, newer.code)).status).toBe('pending');
    expect(await inventory(h, newer.tierId)).toMatchObject({ held: 1 });

    const second = await sweepOverdueOrders(net, 1);
    expect(second).toEqual([{ orderId: newer.id, orderCode: newer.code, kind: 'hold', result: 'expired' }]);
    expect((await orderState(h, newer.code)).status).toBe('expired');
    expect(await inventory(h, newer.tierId)).toMatchObject({ held: 0 });
  });

  it('job bỏ sót, chưa link (quá 3 phút) → expired, held -= n, order_changed, log warn kèm mã Đơn và loại, một email pending_order_overdue; lượt sau không gửi lại', async () => {
    const order = await pendingOrder(2);
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expiredAgo(order.id, 3 * 60);

    const swept = await sweep();
    expect(sweptOf(swept, order.id)).toEqual({
      orderId: order.id,
      orderCode: order.code,
      kind: 'hold',
      result: 'expired',
    });
    expect((await orderState(h, order.code)).status).toBe('expired');
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, order.eventId);
    await expect
      .poll(() => notified.filter((n) => n.id === order.id && n.type === RealtimeTopic.ORDER_CHANGED).length)
      .toBe(1);
    expect(safetyLogs((l) => l.orderCode === order.code)).toEqual([
      expect.objectContaining({
        level: 40,
        msg: MSG_EXPIRED,
        orderId: order.id,
        orderCode: order.code,
        organizationId: org.orgId,
        kind: 'hold',
      }),
    ]);

    const jobs = await alertJobs({ kind: OpsAlertKind.PENDING_ORDER_OVERDUE, subjects: [order.code] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: OpsAlertKind.PENDING_ORDER_OVERDUE,
      count: expiredCount(swept),
      details: { orders: expiredCount(swept) },
    });
    const message = await emailOf(jobs[0]!);
    expect(message.subject).toBe(`[Tickee vận hành] ${OPS_ALERT_KINDS.pending_order_overdue.title}`);
    expect(message.text).toContain(order.code);

    // Lượt sau: Đơn không còn `pending`, không chạm, không gửi lại.
    expect(sweptOf(await sweep(), order.id)).toBeUndefined();
    expect(await alertJobs({ kind: OpsAlertKind.PENDING_ORDER_OVERDUE, subjects: [order.code] })).toHaveLength(1);
    expect(safetyLogs((l) => l.orderCode === order.code)).toHaveLength(1);
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
  });

  it('vừa quá hạn: chưa link, quá 30 giây → không đụng (để job hoãn); quá 120 giây + ân hạn thêm thì lưới mới cho hết hạn', async () => {
    const order = await pendingOrder(1);
    await expiredAgo(order.id, 30);
    expect(sweptOf(await sweep(), order.id)).toBeUndefined();
    expect((await orderState(h, order.code)).status).toBe('pending');
    expect(await inventory(h, order.tierId)).toMatchObject({ held: 1 });

    await expiredAgo(order.id, SAFETY_SWEEP_GRACE_SECONDS + 5);
    expect(sweptOf(await sweep(), order.id)).toMatchObject({ kind: 'hold', result: 'expired' });
    expect(await inventory(h, order.tierId)).toMatchObject({ held: 0 });
  });

  it('có link, trong ân hạn: quá 6 phút → không đụng', async () => {
    const order = await pendingOrder(1);
    await withLink(order.id);
    await expiredAgo(order.id, 6 * 60);
    expect(sweptOf(await sweep(), order.id)).toBeUndefined();
    expect((await orderState(h, order.code)).status).toBe('pending');
    expect(await inventory(h, order.tierId)).toMatchObject({ held: 1 });
    // Dọn: job (c) của Đơn này vẫn cho hết hạn được (đã quá hạn link + 5 phút).
    expect(await expireOrder(db, order.id, 'link')).toBe('expired');
  });

  it('có link, quá ân hạn: quá 8 phút → expired (loại link), nhả chỗ', async () => {
    const order = await pendingOrder(2);
    await withLink(order.id);
    await expiredAgo(order.id, 8 * 60);
    expect(sweptOf(await sweep(), order.id)).toEqual({
      orderId: order.id,
      orderCode: order.code,
      kind: 'link',
      result: 'expired',
    });
    expect((await orderState(h, order.code)).status).toBe('expired');
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(safetyLogs((l) => l.orderCode === order.code)).toEqual([
      expect.objectContaining({ level: 40, msg: MSG_EXPIRED, kind: 'link' }),
    ]);
    expect(await alertJobs({ kind: OpsAlertKind.PENDING_ORDER_OVERDUE, subjects: [order.code] })).toHaveLength(1);
    await expectInvariants(h, order.eventId);
  });

  it('đua với IPN: IPN paid và lượt quét cùng lúc → một bên thắng (CAS), chỗ nhả hoặc bán đúng một lần', async () => {
    for (let i = 0; i < 3; i++) {
      const order = await pendingOrder(2);
      await withLink(order.id);
      await expiredAgo(order.id, 8 * 60);
      const [paid, swept] = await Promise.all([ipnPaid(order.id, order.total), sweep()]);
      // Lưới thắng trước: Đơn `expired` rồi tiền về muộn bán lại có điều kiện (còn chỗ). IPN thắng trước: lưới bỏ qua.
      expect(paid).toEqual({ outcome: 'paid' });
      expect([undefined, 'expired', 'skipped']).toContain(sweptOf(swept, order.id)?.result);
      expect(await orderState(h, order.code)).toMatchObject({ status: 'paid', tickets: 2 });
      expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 2, held: 0 });
      await expectInvariants(h, order.eventId);
    }
  });

  it('đua với IPN, lưới thắng trước: expired, nhả chỗ; IPN paid về sau → tiền về muộn bán lại, đủ 2 Vé, bán đúng một lần', async () => {
    const order = await pendingOrder(2);
    await withLink(order.id);
    await expiredAgo(order.id, 8 * 60);

    expect(sweptOf(await sweep(), order.id)).toMatchObject({ kind: 'link', result: 'expired' });
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });

    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'paid' });
    expect(await orderState(h, order.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 2, held: 0 });
    await expectInvariants(h, order.eventId);
  });

  it('đua với IPN, IPN thắng trước: paid; lượt quét sau không đụng Đơn, tồn kho giữ nguyên', async () => {
    const order = await pendingOrder(2);
    await withLink(order.id);
    await expiredAgo(order.id, 8 * 60);

    expect(await ipnPaid(order.id, order.total)).toEqual({ outcome: 'paid' });
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 2, held: 0 });

    expect(sweptOf(await sweep(), order.id)).toBeUndefined();
    expect(await orderState(h, order.code)).toMatchObject({ status: 'paid', tickets: 2 });
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 2, held: 0 });
    expect(safetyLogs((l) => l.orderCode === order.code)).toEqual([]);
    await expectInvariants(h, order.eventId);
  });

  it('một Đơn lỗi: expireOrder ném với Đơn A → log warn, Đơn B vẫn hết hạn; lượt sau thử lại A', async () => {
    const a = await pendingOrder(2);
    const b = await pendingOrder(1);
    await expiredAgo(a.id, 3 * 60);
    await expiredAgo(b.id, 3 * 60);
    // Nhả chỗ của A vi phạm CHECK `held >= 0`: transaction của A rollback, `expireOrder` ném.
    await setInventory(a.tierId, 'held', 0);

    const swept = await sweep();
    expect(sweptOf(swept, a.id)).toMatchObject({ result: 'error' });
    expect(sweptOf(swept, b.id)).toMatchObject({ result: 'expired' });
    expect((await orderState(h, a.code)).status).toBe('pending');
    expect((await orderState(h, b.code)).status).toBe('expired');
    expect(await inventory(h, b.tierId)).toMatchObject({ held: 0 });
    expect(safetyLogs((l) => l.orderCode === a.code)).toEqual([
      expect.objectContaining({
        level: 40,
        msg: MSG_FAILED,
        orderId: a.id,
        kind: 'hold',
        error: { type: expect.any(String), code: '23514' },
      }),
    ]);
    expect(await alertJobs({ kind: OpsAlertKind.PENDING_ORDER_OVERDUE, subjects: [a.code] })).toEqual([]);
    expect(await alertJobs({ kind: OpsAlertKind.PENDING_ORDER_OVERDUE, subjects: [b.code] })).toHaveLength(1);

    // Tồn kho được sửa: lượt sau cho A hết hạn.
    await setInventory(a.tierId, 'held', 2);
    expect(sweptOf(await sweep(), a.id)).toMatchObject({ result: 'expired' });
    expect(await inventory(h, a.tierId)).toMatchObject({ held: 0 });
    await expectInvariants(h, a.eventId);
  });

  it('bộ đếm cũ: dòng 11 phút trước bị xóa, dòng 5 phút trước còn', async () => {
    const userId = randomUUID();
    await h.db.pool.query(
      `INSERT INTO order_create_attempts (user_id, ip_hmac, created_at)
       VALUES ($1, 'test-old', now() - interval '11 minutes'), ($1, 'test-recent', now() - interval '5 minutes')`,
      [userId],
    );
    expect(await purgeOrderCreateAttempts(db)).toBeGreaterThanOrEqual(1);
    const { rows } = await h.db.pool.query<{ ip_hmac: string }>(
      'SELECT ip_hmac FROM order_create_attempts WHERE user_id = $1',
      [userId],
    );
    expect(rows.map((row) => row.ip_hmac)).toEqual(['test-recent']);
  });
});

describe('đối chiếu tồn kho (I/O Matrix)', () => {
  it('tồn kho khớp: Vé cancelled của Đơn refunded vẫn tính vào sold, Đơn pending tính vào held, Đơn expired không tính → không báo', async () => {
    const sale = await newSale(10);
    const tierId = sale.tiers[0]!.id;
    const refunded = await place(sale, 2);
    expect(await ipnPaid(refunded.id, refunded.total)).toEqual({ outcome: 'paid' });
    // AD-2: `paid` → hủy/hoàn không trả chỗ.
    await h.db.pool.query("UPDATE tickets SET status = 'cancelled', cancel_reason = 'refunded' WHERE order_id = $1", [
      refunded.id,
    ]);
    await h.db.pool.query("UPDATE orders SET status = 'refunded', cancel_reason = 'event_cancelled' WHERE id = $1", [
      refunded.id,
    ]);
    await place(sale, 1);
    const expired = await place(sale, 3);
    expect(await db.transaction((tx) => markExpired(tx, expired.id))).toBe('expired');
    expect(await inventory(h, tierId)).toEqual({ capacity: 10, sold: 2, held: 1 });

    const drifts = await checkInventory(net);
    expect(drifts.filter((d) => d.ticketTypeId === tierId)).toEqual([]);
    expect(await driftMarksOf(tierId)).toEqual([]);
    expect(safetyLogs((l) => l.ticketTypeId === tierId)).toEqual([]);
  });

  it('held lệch (3, Đơn pending tổng 2) → log error, một email nêu …:held=3/2:sold=0/0; lượt sau cùng số liệu không gửi; số đổi thì báo lại', async () => {
    const order = await pendingOrder(2);
    await setInventory(order.tierId, 'held', 3);

    const drifts = await checkInventory(net);
    const drift: InventoryDrift = {
      ticketTypeId: order.tierId,
      eventId: order.eventId,
      held: 3,
      pending: 2,
      sold: 0,
      issued: 0,
    };
    expect(drifts.filter((d) => d.ticketTypeId === order.tierId)).toEqual([drift]);
    const subject = `${order.tierId}:held=3/2:sold=0/0`;
    expect(inventoryDriftSubject(drift)).toBe(subject);
    expect(safetyLogs((l) => l.ticketTypeId === order.tierId)).toEqual([
      expect.objectContaining({ level: 50, msg: MSG_DRIFT, ...drift }),
    ]);
    const jobs = await alertJobs({ kind: OpsAlertKind.INVENTORY_DRIFT, subjects: [subject] });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.details).toEqual({ driftingTicketTypes: drifts.length });
    const message = await emailOf(jobs[0]!);
    expect(message.subject).toBe(`[Tickee vận hành] ${OPS_ALERT_KINDS.inventory_drift.title}`);
    expect(message.text).toContain(subject);

    // Lượt sau, cùng số liệu: vẫn log error, không gửi lại. Dấu lùi quá cooldown và instance mới (bộ nhớ chống lặp rỗng):
    // chỉ chống lặp `once` mới chặn được lần báo này.
    await h.db.pool.query(
      "UPDATE ops_alert_marks SET raised_at = raised_at - interval '31 minutes' WHERE kind = 'inventory_drift' AND subject = $1",
      [subject],
    );
    const freshAlerts = new OpsAlerts(db, boss, h.app.get(OpsAlertQueue), { cooldownMinutes: 30 });
    expect(
      (await checkInventory({ db, alerts: freshAlerts })).filter((d) => d.ticketTypeId === order.tierId),
    ).toEqual([drift]);
    expect(safetyLogs((l) => l.ticketTypeId === order.tierId)).toHaveLength(2);
    expect(await alertJobs({ kind: OpsAlertKind.INVENTORY_DRIFT, subjects: [subject] })).toHaveLength(1);

    // Số liệu đổi (held đúng lại, sold lệch) → subject mới, báo lại.
    await setInventory(order.tierId, 'held', 2);
    await setInventory(order.tierId, 'sold', 1);
    const soldSubject = `${order.tierId}:held=2/2:sold=1/0`;
    expect((await checkInventory(net)).filter((d) => d.ticketTypeId === order.tierId)).toEqual([
      { ...drift, held: 2, sold: 1 },
    ]);
    expect(await alertJobs({ kind: OpsAlertKind.INVENTORY_DRIFT, subjects: [soldSubject] })).toHaveLength(1);
    expect(await driftMarksOf(order.tierId)).toEqual([soldSubject, subject].sort());

    // Không bao giờ tự sửa tồn kho.
    expect(await inventory(h, order.tierId)).toEqual({ capacity: 5, sold: 1, held: 2 });
    await setInventory(order.tierId, 'sold', 0);
    expect((await checkInventory(net)).filter((d) => d.ticketTypeId === order.tierId)).toEqual([]);
  });
});

describe('worker thật', () => {
  let worker: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig())] }).compile();
    worker = await moduleRef.init();
  });
  afterAll(async () => {
    await worker?.close();
  });

  const jobState = (name: string, id: string) => async () => (await boss.getJobById(name, id))?.state;

  it('lịch ordering.safety-sweep mỗi phút và ordering.inventory-check mỗi 10 phút; không retry', async () => {
    const schedules = await boss.getSchedules();
    expect(schedules.find((s) => s.name === JobQueue.ORDERING_SAFETY_SWEEP)).toMatchObject({ cron: SAFETY_SWEEP_CRON });
    expect(schedules.find((s) => s.name === JobQueue.ORDERING_INVENTORY_CHECK)).toMatchObject({
      cron: INVENTORY_CHECK_CRON,
    });
    expect(SAFETY_SWEEP_CRON).toBe('* * * * *');
    expect(INVENTORY_CHECK_CRON).toBe('*/10 * * * *');
    expect(await boss.getQueue(JobQueue.ORDERING_SAFETY_SWEEP)).toMatchObject({ retryLimit: 0 });
    expect(await boss.getQueue(JobQueue.ORDERING_INVENTORY_CHECK)).toMatchObject({ retryLimit: 0 });
  });

  it('job ordering.safety-sweep (payload null) → Đơn bỏ sót hết hạn và bộ đếm cũ bị xóa trong cùng lượt; job completed', async () => {
    const order = await pendingOrder(1);
    await expiredAgo(order.id, 3 * 60);
    const userId = randomUUID();
    await h.db.pool.query(
      `INSERT INTO order_create_attempts (user_id, ip_hmac, created_at)
       VALUES ($1, 'test-old', now() - interval '11 minutes')`,
      [userId],
    );

    const jobId = await boss.send(JobQueue.ORDERING_SAFETY_SWEEP, null);
    await expect
      .poll(jobState(JobQueue.ORDERING_SAFETY_SWEEP, jobId!), { timeout: 20_000, interval: 200 })
      .toBe('completed');
    expect((await orderState(h, order.code)).status).toBe('expired');
    expect(await inventory(h, order.tierId)).toMatchObject({ held: 0 });
    const { rows } = await h.db.pool.query('SELECT 1 FROM order_create_attempts WHERE user_id = $1', [userId]);
    expect(rows).toEqual([]);
  });

  it('job ordering.inventory-check (payload null) → báo Hạng vé lệch; job completed', async () => {
    const order = await pendingOrder(1);
    await setInventory(order.tierId, 'held', 2);
    const jobId = await boss.send(JobQueue.ORDERING_INVENTORY_CHECK, null);
    await expect
      .poll(jobState(JobQueue.ORDERING_INVENTORY_CHECK, jobId!), { timeout: 20_000, interval: 200 })
      .toBe('completed');
    expect(await driftMarksOf(order.tierId)).toEqual([`${order.tierId}:held=2/1:sold=0/0`]);
    await setInventory(order.tierId, 'held', 1);
  });
});
