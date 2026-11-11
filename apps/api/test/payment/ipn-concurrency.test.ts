import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TingeeCredential } from '../../src/modules/tingee/index.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  inventory,
  ipnKeyOf,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
} from '../ordering/order-fixtures.js';
import { fakeAccount, fakeIpnPayload, signIpn, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';
import { ACK_TEXT, expectInvariants, orderState, paymentEventsOf, postIpn, reviewItemsOf } from './ipn-fixtures.js';

/*
 * Story 3.5, 3.6, AC: IPN gửi đồng thời cho một Đơn (lẫn cùng mã giao dịch và khác mã) → Vé chỉ phát một lần; mỗi khoản
 * tiền khác mã không thành Vé là đúng một mục `duplicate_payment`. Để chắc các transaction chồng nhau, test giữ khóa `FOR
 * UPDATE` dòng `events` (như BTC đang sửa Sự kiện) cho tới khi mọi IPN đang chờ khóa (IPN cùng mã chờ ở unique index của
 * `payment_events`, IPN khác mã chờ ở `markPaid`), rồi mới nhả.
 */

const MAIN: TingeeCredential = { clientId: 'tg-ipn-race-1b7c', secretToken: 'tg-ipn-race-secret-Hj6Kl5Zx4' };
const account = fakeAccount({ accountName: 'PHAM VAN DUNG' });
const PRICE = 200_000;

let fake: TingeeFake;
let h: Harness;
let org: Org;
let ipnKey: string;

beforeAll(async () => {
  fake = await startTingeeFake({ merchants: [{ ...MAIN, accounts: [account] }] });
  h = await createHarness({ TINGEE_BASE_URL: fake.url });
  org = await paidReadyOrg(h, {
    name: 'CLB Chạy bộ',
    credential: MAIN,
    payout: { vaAccountNumber: String(account.vaAccountNumber), accountName: 'PHAM VAN DUNG', bankName: 'MB Bank' },
  });
  ipnKey = await ipnKeyOf(h, org.orgId);
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

async function place(quantity: number) {
  const buyer = await signUp(h);
  const sale = await eventOnSale(org, [{ name: 'Cự ly 10km', price: PRICE, capacity: 20 }]);
  const tierId = sale.tiers[0]!.id;
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity }])).expect(201);
  const order = parseOrder(res.body);
  const { id } = await orderState(h, order.code);
  return { code: order.code, orderId: id, eventId: sale.event.id, tierId, total: quantity * PRICE };
}

async function waitingOnLocks(): Promise<number> {
  const { rows } = await h.db.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = 'tickee-api' AND wait_event_type = 'Lock'`,
  );
  return rows[0]!.n;
}

/** Gửi các request trong lúc giữ khóa dòng `events`; nhả khi cả `n` đang chờ khóa. */
async function whileEventLocked<T>(eventId: string, n: number, send: () => Promise<T>[]): Promise<T[]> {
  const client: pg.PoolClient = await h.db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventId]);
    const pending = Promise.all(send());
    await expect.poll(waitingOnLocks, { timeout: 15_000, interval: 50 }).toBe(n);
    await client.query('COMMIT');
    return await pending;
  } finally {
    client.release();
  }
}

describe('IPN đồng thời cho một Đơn', () => {
  it('10 IPN success hợp lệ (5 cùng mã giao dịch, 5 khác mã) → mọi IPN 200 00; đúng N Vé phát một lần', async () => {
    const placed = await place(3);
    const same = fakeIpnPayload(placed.code, placed.total);
    const signedSame = signIpn(MAIN.secretToken, same);
    const distinct = Array.from({ length: 5 }, () => signIpn(MAIN.secretToken, fakeIpnPayload(placed.code, placed.total)));
    const all = [...Array.from({ length: 5 }, () => signedSame), ...distinct];

    const responses = await whileEventLocked(placed.eventId, 10, () =>
      all.map((ipn) => postIpn(h, ipnKey, ipn).then((res) => res)),
    );
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.text).toBe(ACK_TEXT);
    }

    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 3 });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 3, held: 0 });
    // 1 mã chung + 5 mã khác: 6 event, đều gắn Đơn; IPN cùng mã chỉ lưu một lần.
    const events = await paymentEventsOf(h, org.orgId, placed.code);
    expect(events).toHaveLength(6);
    expect(new Set(events.map((e) => e.provider_transaction_code)).size).toBe(6);
    expect(events.every((e) => e.order_id === placed.orderId)).toBe(true);
    const audits = await h.db.pool.query("SELECT 1 FROM audit_events WHERE action = 'order.paid' AND target_id = $1", [
      placed.orderId,
    ]);
    expect(audits.rows).toHaveLength(1);

    // Một `paid`; 5 IPN khác mã đọc Đơn đã `paid` dưới khóa (`duplicate_payment`, mỗi khoản một mục, log warn); 4 IPN
    // cùng mã là `duplicate` (không mục).
    const branches = h.logs.lines.filter((l) => l.orderCode === placed.code).map((l) => l.branch);
    expect(branches.filter((b) => b === 'paid')).toHaveLength(1);
    expect(branches.filter((b) => b === 'duplicate_payment')).toHaveLength(5);
    expect(branches.filter((b) => b === 'duplicate')).toHaveLength(4);
    const items = await reviewItemsOf(h, { orderId: placed.orderId });
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.type === 'duplicate_payment' && i.organization_id === org.orgId)).toBe(true);
    const paidEvent = events.find((e) => !items.some((i) => i.payment_event_id === e.id));
    expect(new Set(items.map((i) => i.payment_event_id)).size).toBe(5);
    expect(paidEvent).toBeDefined();
    await expectInvariants(h, placed.eventId);
  });

  it('Matrix 3.6: 10 IPN success khác mã cho một Đơn pending → đúng N Vé; 9 mục duplicate_payment, mỗi khoản một mục', async () => {
    const placed = await place(2);
    const all = Array.from({ length: 10 }, () => signIpn(MAIN.secretToken, fakeIpnPayload(placed.code, placed.total)));
    const responses = await whileEventLocked(placed.eventId, 10, () => all.map((ipn) => postIpn(h, ipnKey, ipn)));
    for (const res of responses) expect(res.text).toBe(ACK_TEXT);

    expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', paid_source: 'ipn', tickets: 2 });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 2, held: 0 });
    const events = await paymentEventsOf(h, org.orgId, placed.code);
    expect(events).toHaveLength(10);
    const items = await reviewItemsOf(h, { orderId: placed.orderId });
    expect(items).toHaveLength(9);
    expect(items.every((i) => i.type === 'duplicate_payment' && i.status === 'open')).toBe(true);
    // Mọi khoản tiền: hoặc là khoản đã phát Vé, hoặc có đúng một mục.
    const covered = new Set(items.map((i) => i.payment_event_id));
    expect(covered.size).toBe(9);
    expect(events.filter((e) => !covered.has(e.id))).toHaveLength(1);
    await expectInvariants(h, placed.eventId);
  });

  it('success và expired cùng lúc cho một Đơn → Đơn luôn paid (hết hạn trước thì tiền về muộn bán lại, còn chỗ), không mục; bất biến tồn kho – Vé giữ', async () => {
    for (let i = 0; i < 3; i++) {
      const placed = await place(2);
      const success = signIpn(MAIN.secretToken, fakeIpnPayload(placed.code, placed.total));
      const expired = signIpn(
        MAIN.secretToken,
        fakeIpnPayload(placed.code, placed.total, {
          status: 'expired',
          statusCode: '01',
          paidAmount: null,
          paidAt: null,
          providerTransactionCode: null,
        }),
      );
      const [a, b] = await Promise.all([postIpn(h, ipnKey, success), postIpn(h, ipnKey, expired)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(await orderState(h, placed.code)).toMatchObject({ status: 'paid', tickets: 2 });
      expect(await inventory(h, placed.tierId)).toEqual({ capacity: 20, sold: 2, held: 0 });
      expect(await paymentEventsOf(h, org.orgId, placed.code)).toHaveLength(2);
      expect(await reviewItemsOf(h, { orderId: placed.orderId })).toEqual([]);
      await expectInvariants(h, placed.eventId);
    }
  });
});
