import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ErrorResponse,
  EventPendingPaymentCount,
  JobQueue,
  PAYMENT_LINK_GRACE_SECONDS,
  Role,
  type BuyerOrderView,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpireOrderPayload, expireOrder } from '../../src/modules/ordering/order-jobs.js';
import {
  HttpTingeeClient,
  parseTingeeTimestamp,
  TINGEE_CLIENT,
  type PaymentLinkInput,
  type TingeeClient,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { TEST_WEB_ORIGIN, workerConfig } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import { expectInvariants, postIpn } from '../payment/ipn-fixtures.js';
import {
  CREATE_LINK_PATH,
  fakeAccount,
  fakeIpnPayload,
  signIpn,
  startTingeeFake,
  type TingeeFake,
} from '../tingee-fake/server.js';
import {
  eventOnSale,
  eventsPath,
  inventory,
  ipnKeyOf,
  linkPayoutAccount,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  resetOrderRateLimit,
  type Org,
  type PayoutSpec,
  type User,
} from './order-fixtures.js';

/*
 * Story 3.4: tạo link thanh toán Gateway sau TX1 và thử lại cho cùng Đơn, trên Postgres thật và Tingee fake (server HTTP
 * thật, ký và kiểm chữ ký theo credential của từng BTC; timeout `create-link` thật 5 giây). Mọi dòng của I/O Matrix trừ
 * gọi song song (payment-link-concurrency.test.ts). Sau mỗi nhánh: tồn kho đúng (`held` = Vé của các Đơn `pending`).
 * E3-2: chốt link theo `sellability` (Kết thúc, Ẩn, khóa, hủy, mất điều kiện có phí), `checkoutUrl` sau Kết thúc và
 * `GET …/pending-payment-count`.
 */

/**
 * Chốt link (`paymentLinkBlock`, E3-2) ném lỗi như DB lỗi ở lần gọi kế tiếp khi bật `next`; mặc định chạy hàm thật.
 */
const gateFault = vi.hoisted(() => ({ next: false }));
vi.mock('../../src/modules/ordering/sellability.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/ordering/sellability.js')>();
  return {
    ...actual,
    paymentLinkBlock: (...args: Parameters<typeof actual.paymentLinkBlock>) => {
      if (gateFault.next) {
        gateFault.next = false;
        return Promise.reject(Object.assign(new Error('giả lập DB lỗi'), { name: 'DatabaseError' }));
      }
      return actual.paymentLinkBlock(...args);
    },
  };
});

const QUEUE = JobQueue.ORDERING_EXPIRE_ORDER;
const MAIN: TingeeCredential = { clientId: 'tg-link-main-7c1d', secretToken: 'tg-link-main-secret-Qw8Er7Ty6' };
const NEXT: TingeeCredential = { clientId: 'tg-link-next-9e2f', secretToken: 'tg-link-next-secret-Ui5Op4As3' };
const mainAccount = fakeAccount({ bankName: 'Vietcombank', bankBin: '970436', accountName: 'NGUYEN VAN TUAN' });
const nextAccount = fakeAccount({ bankName: 'MB Bank', bankBin: '970422', accountName: 'TRAN THI BINH' });
const MAIN_PAYOUT: PayoutSpec = {
  vaAccountNumber: String(mainAccount.vaAccountNumber),
  accountName: 'NGUYEN VAN TUAN',
  bankName: 'Vietcombank',
};
const NEXT_PAYOUT: PayoutSpec = {
  vaAccountNumber: String(nextAccount.vaAccountNumber),
  accountName: 'TRAN THI BINH',
  bankName: 'MB Bank',
};
/** Mã Tingee đi nhánh "tạm ngừng bán" (key, merchant, VA). */
const PAUSE_CODES = ['1007', '1033', '1034', '92', '97', '1009', '1133', '2023', '1023', '1045', '1024', '1072'];

let fake: TingeeFake;
let h: Harness;
let boss: PgBoss;
let org: Org;
/** Chạy một lần ngay sau lời gọi `create-link` kế tiếp (trước TX2): chen việc của job/BTC vào giữa. */
let afterNextLink: ((input: PaymentLinkInput) => Promise<void>) | null = null;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [mainAccount] },
      { ...NEXT, accounts: [nextAccount] },
    ],
  });
  // Client HTTP thật (timeout create-link mặc định 5 giây) trỏ vào fake, bọc thêm móc chạy sau lời gọi.
  const http = new HttpTingeeClient({ baseUrl: fake.url });
  const client: TingeeClient = {
    listAccounts: (credential) => http.listAccounts(credential),
    async createPaymentLink(credential, input) {
      try {
        return await http.createPaymentLink(credential, input);
      } finally {
        const hook = afterNextLink;
        afterNextLink = null;
        if (hook) await hook(input);
      }
    },
    getGatewayOrder: (credential, orderId) => http.getGatewayOrder(credential, orderId),
  };
  h = await createHarness({ TINGEE_BASE_URL: fake.url }, { overrides: [{ provide: TINGEE_CLIENT, useValue: client }] });
  boss = h.app.get<PgBoss>(BOSS);
  org = await paidReadyOrg(h, { name: 'CLB Pickleball Quận 3', credential: MAIN, payout: MAIN_PAYOUT });
});
beforeEach(async () => {
  fake.reset();
  for (const clientId of [MAIN.clientId, NEXT.clientId]) {
    fake.merchant(clientId).linkReplies = [];
    fake.merchant(clientId).linkDelayMs = 0;
  }
  afterNextLink = null;
  gateFault.next = false;
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
  await fake.close();
});

const errorOf = (body: unknown) => ErrorResponse.parse(body).error;
const linkCalls = () => fake.calls(CREATE_LINK_PATH);

interface Placed {
  buyer: User;
  eventId: string;
  slug: string;
  tierId: string;
  key: string;
  status: number;
  order: BuyerOrderView;
  elapsedMs: number;
}

/** Người mua mới gửi Đơn `quantity` Vé (300.000đ, 5 suất) ở Sự kiện mới của `owner`. */
async function place(quantity = 2, owner: Org = org): Promise<Placed> {
  const buyer = await signUp(h);
  const sale = await eventOnSale(owner, [{ name: 'Đơn nam', price: 300_000, capacity: 5 }]);
  const tier = sale.tiers[0]!;
  const key = randomUUID();
  const started = Date.now();
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tier.id, quantity }]), key);
  return {
    buyer,
    eventId: sale.event.id,
    slug: sale.event.slug,
    tierId: tier.id,
    key,
    status: res.status,
    order: parseOrder(res.body),
    elapsedMs: Date.now() - started,
  };
}

const retry = (buyer: User, code: string) =>
  h.http.post(`/v1/me/orders/${code}/payment-link`).set('cookie', buyer.cookie).send();

interface LinkRow {
  id: string;
  status: string;
  payment_link: string | null;
  payout_account_id: string | null;
  payment_link_attempt_at: Date | null;
  payment_link_error: string | null;
  expires_at: Date;
  /** `expires_at = payment_link_attempt_at + 15 phút` (đúng tới micro giây, tính trong DB). */
  deadline_from_attempt: boolean | null;
}

async function linkRow(code: string): Promise<LinkRow> {
  const { rows } = await h.db.pool.query<LinkRow>(
    `SELECT id, status, payment_link, payout_account_id, payment_link_attempt_at, payment_link_error, expires_at,
            expires_at = payment_link_attempt_at + interval '15 minutes' AS deadline_from_attempt
       FROM orders WHERE code = $1`,
    [code],
  );
  return rows[0]!;
}

/** AC: `sold + held ≤ capacity` và `held` của mỗi Hạng vé = tổng Vé của các Đơn `pending` của Hạng vé đó. */
async function expectInventoryConsistent(eventId: string): Promise<void> {
  const { rows } = await h.db.pool.query<{ ticket_type_id: string; capacity: number; sold: number; held: number; pending: number }>(
    `SELECT i.ticket_type_id, i.capacity, i.sold, i.held,
            COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE oi.ticket_type_id = i.ticket_type_id AND o.status = 'pending'), 0)::int AS pending
       FROM ticket_type_inventory i WHERE i.event_id = $1`,
    [eventId],
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.sold + row.held).toBeLessThanOrEqual(row.capacity);
    expect(row.held).toBe(row.pending);
  }
}

async function jobsOf(orderId: string) {
  return (await boss.findJobs(QUEUE, { data: { orderId } })).map((job) => ({
    data: ExpireOrderPayload.parse(job.data),
    startAfter: job.startAfter,
  }));
}

describe('tạo link khi gửi Đơn', () => {
  it('thành công → 201 pending có checkoutUrl; DB có link, tài khoản, hạn = lượt + 15 phút; job (c); body/ký đúng', async () => {
    const placed = await place(2);
    expect(placed.status).toBe(201);
    const { order } = placed;
    const [call] = linkCalls();
    expect(linkCalls()).toHaveLength(1);
    expect(order.buyerStatus).toBe('awaiting_payment');
    expect(order.payment).toEqual({
      checkoutUrl: `${fake.url}/checkout/${order.code}?r=${String(call!.body.requestId)}`,
      linkError: null,
      recipient: { organizationName: 'CLB Pickleball Quận 3', accountName: 'NGUYEN VAN TUAN', bankName: 'Vietcombank' },
    });

    // Request đúng tài liệu: body đủ trường, không merchantId/customerEmail; timestamp `yyyyMMddHHmmssSSS` giờ Việt Nam
    // (Tingee production trả 90 cho UNIX ms); chữ ký đúng.
    expect(call).toMatchObject({ clientId: MAIN.clientId, signatureValid: true });
    expect(call!.timestamp).toMatch(/^\d{17}$/);
    expect(Math.abs(parseTingeeTimestamp(call!.timestamp!)!.getTime() - Date.now())).toBeLessThan(30_000);
    expect(call!.body).toEqual({
      requestId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      orderId: order.code,
      amount: 600_000,
      vaAccountNumber: MAIN_PAYOUT.vaAccountNumber,
      expireInMinute: 15,
      returnUrl: `${TEST_WEB_ORIGIN}/orders/${order.code}`,
      description: `Thanh toán Đơn ${order.code}`,
    });

    const row = await linkRow(order.code);
    expect(row).toMatchObject({ status: 'pending', payment_link: order.payment!.checkoutUrl, payment_link_error: null });
    expect(row.payout_account_id).not.toBeNull();
    expect(row.deadline_from_attempt).toBe(true);
    expect(order.expiresAt).toBe(row.expires_at.toISOString());
    const holdMs = Date.parse(order.expiresAt) - Date.parse(order.createdAt);
    expect(holdMs).toBeGreaterThan(14 * 60_000);
    expect(holdMs).toBeLessThanOrEqual(15 * 60_000 + 5_000);

    // Job (a) của TX1 và job (c) của TX2 (chạy từ hạn link + 5 phút).
    const jobs = await jobsOf(row.id);
    expect(jobs.map((j) => j.data.linked).sort()).toEqual([false, true]);
    const linked = jobs.find((j) => j.data.linked)!;
    expect(linked.startAfter.getTime()).toBe(row.expires_at.getTime() + PAYMENT_LINK_GRACE_SECONDS * 1000);

    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInventoryConsistent(placed.eventId);
    // GET trả cùng link; không log checkout URL hay tên chủ tài khoản.
    const again = parseOrder((await h.http.get(`/v1/me/orders/${order.code}`).set('cookie', placed.buyer.cookie).expect(200)).body);
    expect(again.payment?.checkoutUrl).toBe(order.payment!.checkoutUrl);
    expect(h.logs.text).not.toContain(order.payment!.checkoutUrl!);
    expect(h.logs.text).not.toContain(MAIN.secretToken);
  });

  it('lỗi rõ ràng (1006) → 201 pending, chưa có link, provider_error, giữ chỗ; thử lại trong hạn → 200 có link', async () => {
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const placed = await place(2);
    expect(placed.status).toBe(201);
    expect(placed.order).toMatchObject({ buyerStatus: 'awaiting_payment' });
    expect(placed.order.payment).toMatchObject({ checkoutUrl: null, linkError: 'provider_error' });
    // Chưa chụp tài khoản: người nhận là tài khoản mặc định hiện tại.
    expect(placed.order.payment!.recipient).toEqual({
      organizationName: 'CLB Pickleball Quận 3',
      accountName: 'NGUYEN VAN TUAN',
      bankName: 'Vietcombank',
    });
    const row = await linkRow(placed.order.code);
    // Trả lượt: thử lại được; hạn Giữ chỗ vẫn của TX1.
    expect(row).toMatchObject({ status: 'pending', payment_link: null, payment_link_attempt_at: null });
    expect(Date.parse(placed.order.expiresAt) - Date.parse(placed.order.createdAt)).toBeLessThanOrEqual(61_000);
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 2 });
    await expectInventoryConsistent(placed.eventId);
    const warning = h.logs.lines.find((l) => l.orderCode === placed.order.code && l.tingeeCode === '1006');
    expect(warning).toMatchObject({ organizationId: org.orgId, domainCode: 'PAYMENT_PROVIDER_UNAVAILABLE' });

    const res = await retry(placed.buyer, placed.order.code).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const retried = parseOrder(res.body);
    expect(retried.buyerStatus).toBe('awaiting_payment');
    expect(retried.payment).toMatchObject({ checkoutUrl: expect.stringContaining(`/checkout/${placed.order.code}`), linkError: null });
    expect(linkCalls()).toHaveLength(2);
    expect((await linkRow(placed.order.code)).deadline_from_attempt).toBe(true);
    await expectInventoryConsistent(placed.eventId);
  });

  it('Tingee treo → trả trong ~6 giây: 201 expired, timeout, nhả chỗ; không transaction nào mở khi chờ; không gọi lại', async () => {
    fake.merchant(MAIN.clientId).linkReplies = ['hang'];
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Đơn nam', price: 300_000, capacity: 5 }]);
    const tierId = sale.tiers[0]!.id;
    const key = randomUUID();
    const started = Date.now();
    const pending = postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity: 2 }]), key).then(
      (res) => res,
    );

    // Trong lúc chờ Tingee: không kết nối nào của api đang ở trong transaction.
    await fake.waitFor(CREATE_LINK_PATH);
    for (let i = 0; i < 5; i++) {
      const { rows } = await h.db.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND application_name = 'tickee-api' AND state LIKE 'idle in transaction%'`,
      );
      expect(rows[0]!.n).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const res = await pending;
    const elapsed = Date.now() - started;
    expect(res.status).toBe(201);
    expect(elapsed).toBeGreaterThanOrEqual(4_500);
    expect(elapsed).toBeLessThan(6_500);
    const order = parseOrder(res.body);
    expect(order.buyerStatus).toBe('expired');
    expect(order.payment).toMatchObject({ checkoutUrl: null, linkError: 'timeout' });
    expect(await inventory(h, tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInventoryConsistent(sale.event.id);
    // Lượt không được trả: không bao giờ gọi lại cùng orderId.
    expect((await linkRow(order.code)).payment_link_attempt_at).not.toBeNull();
    const warning = h.logs.lines.find((l) => l.orderCode === order.code && l.reason === 'timeout');
    expect(warning).toMatchObject({ organizationId: org.orgId });

    expect(parseOrder((await retry(buyer, order.code).expect(200)).body).buyerStatus).toBe('expired');
    const replay = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity: 2 }]), key).expect(200);
    expect(parseOrder(replay.body)).toMatchObject({ code: order.code, buyerStatus: 'expired' });
    expect(linkCalls()).toHaveLength(1);
  });

  it('HTTP 500 hay 00 mà data không phải URL (mơ hồ) → expired, timeout, nhả chỗ; log kèm HTTP status và mã gốc', async () => {
    const cases = [
      { reply: { code: '500', httpStatus: 500 }, log: { reason: 'http_status', httpStatus: 500, tingeeCode: '500' } },
      { reply: { code: '00', data: 'khong-phai-url' }, log: { reason: 'invalid_response', httpStatus: 200, tingeeCode: '00' } },
    ];
    for (const { reply, log } of cases) {
      fake.merchant(MAIN.clientId).linkReplies = [reply];
      const placed = await place(1);
      expect(placed.order).toMatchObject({ buyerStatus: 'expired', payment: { checkoutUrl: null, linkError: 'timeout' } });
      expect(await inventory(h, placed.tierId)).toMatchObject({ held: 0 });
      await expectInventoryConsistent(placed.eventId);
      const warning = h.logs.lines.find((l) => l.orderCode === placed.order.code && l.reason === log.reason);
      expect(warning).toMatchObject({ organizationId: org.orgId, ...log });
      expect(JSON.stringify(warning)).not.toContain(MAIN_PAYOUT.vaAccountNumber);
    }
  });

  it('không giải mã được credential của BTC → 201 pending, provider_error, trả lượt, không gọi Tingee, giữ chỗ', async () => {
    const own = await paidReadyOrg(h, { name: 'CLB Bóng bàn', credential: MAIN, payout: MAIN_PAYOUT });
    // Ciphertext đúng dạng nhưng không mở được bằng khóa của api (vd. khóa đã bị gỡ khỏi env).
    const broken = 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA';
    await h.db.orm.execute(
      sql`UPDATE tingee_credentials SET secret_token_ciphertext = ${broken} WHERE organization_id = ${own.orgId}`,
    );
    const placed = await place(2, own);
    expect(placed.status).toBe(201);
    expect(placed.order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { checkoutUrl: null, linkError: 'provider_error' } });
    expect(await linkRow(placed.order.code)).toMatchObject({ status: 'pending', payment_link_attempt_at: null });
    expect(linkCalls()).toHaveLength(0);
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInventoryConsistent(placed.eventId);
    const error = h.logs.lines.find((l) => l.orderCode === placed.order.code);
    expect(error).toMatchObject({ organizationId: own.orgId, error: 'SecretBoxError' });
    expect(h.logs.text).not.toContain(MAIN.secretToken);
    expect(h.logs.text).not.toContain(broken);
  });

  it.each(PAUSE_CODES)('Tingee trả %s → 201 expired, sales_paused, nhả chỗ; không thử lại', async (code) => {
    fake.merchant(MAIN.clientId).linkReplies = [{ code }];
    const placed = await place(2);
    expect(placed.status).toBe(201);
    expect(placed.order.buyerStatus).toBe('expired');
    expect(placed.order.payment).toMatchObject({ checkoutUrl: null, linkError: 'sales_paused' });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInventoryConsistent(placed.eventId);
    const warning = h.logs.lines.find((l) => l.orderCode === placed.order.code && l.tingeeCode === code);
    expect(warning).toMatchObject({ organizationId: org.orgId });
    expect(parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body).buyerStatus).toBe('expired');
    expect(linkCalls()).toHaveLength(1);
  });

  it('Đơn 2 Hạng vé, Tingee trả 1007 → expired, sales_paused, nhả chỗ đủ ở cả hai Hạng vé', async () => {
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1007' }];
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [
      { name: 'Đơn nam', price: 300_000, capacity: 5 },
      { name: 'Đôi nam nữ', price: 500_000, capacity: 5 },
    ]);
    const [single, mixed] = sale.tiers;
    const res = await postOrder(
      h,
      buyer,
      sale.event.slug,
      orderBody([
        { ticketTypeId: single!.id, quantity: 2 },
        { ticketTypeId: mixed!.id, quantity: 1 },
      ]),
    );
    expect(res.status).toBe(201);
    const order = parseOrder(res.body);
    expect(order).toMatchObject({ buyerStatus: 'expired', totalAmount: 1_100_000 });
    expect(order.payment).toMatchObject({ checkoutUrl: null, linkError: 'sales_paused' });
    expect(await inventory(h, single!.id)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await inventory(h, mixed!.id)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInventoryConsistent(sale.event.id);
  });

  it('BTC vừa hủy liên kết hết tài khoản trước lần thử lại → expired, sales_paused, không gọi Tingee (chốt sellability)', async () => {
    const own = await paidReadyOrg(h, { name: 'CLB Cầu lông', credential: MAIN, payout: MAIN_PAYOUT });
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const placed = await place(1, own);
    expect(placed.order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { linkError: 'provider_error' } });
    await h.db.orm.execute(
      sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${own.orgId}`,
    );
    const order = parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body);
    expect(order.buyerStatus).toBe('expired');
    expect(order.payment).toEqual({
      checkoutUrl: null,
      linkError: 'sales_paused',
      recipient: { organizationName: 'CLB Cầu lông', accountName: null, bankName: null },
    });
    expect(linkCalls()).toHaveLength(1);
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 0 });
    await expectInventoryConsistent(placed.eventId);
    // E3-2: BTC không còn tài khoản nhận tiền nào = mất điều kiện bán Vé có phí, chốt `sellability` chặn trước khi đọc
    // nơi nhận tiền.
    const warning = h.logs.lines.find((l) => l.orderCode === placed.order.code && l.reason === 'paused');
    expect(warning).toMatchObject({ organizationId: own.orgId });
  });

  it('BTC còn tài khoản nhưng không có tài khoản mặc định trước lần thử lại → expired, sales_paused, không gọi Tingee', async () => {
    const own = await paidReadyOrg(h, { name: 'CLB Bóng chuyền', credential: MAIN, payout: MAIN_PAYOUT });
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const placed = await place(1, own);
    expect(placed.order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { linkError: 'provider_error' } });
    // Còn liên kết (`sellability` vẫn cho bán) nhưng không còn tài khoản mặc định: chặn ở bước đọc nơi nhận tiền.
    await h.db.orm.execute(sql`UPDATE payout_accounts SET is_default = false WHERE organization_id = ${own.orgId}`);
    const order = parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body);
    expect(order).toMatchObject({ buyerStatus: 'expired', payment: { checkoutUrl: null, linkError: 'sales_paused' } });
    expect(linkCalls()).toHaveLength(1);
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 0 });
    await expectInventoryConsistent(placed.eventId);
    const warning = h.logs.lines.find((l) => l.orderCode === placed.order.code && l.reason === 'no_default_payout_account');
    expect(warning).toMatchObject({ organizationId: own.orgId });
  });

  it('thua job (a): Đơn hết hạn trước TX2 → BuyerOrderView expired, không có URL, nhả chỗ đúng một lần, không có job (c)', async () => {
    afterNextLink = async (input) => {
      const { rows } = await h.db.pool.query<{ id: string }>(
        `UPDATE orders SET expires_at = now() - interval '1 second' WHERE code = $1 RETURNING id`,
        [input.orderId],
      );
      expect(await expireOrder(h.db, rows[0]!.id)).toBe('expired');
    };
    const placed = await place(2);
    expect(placed.status).toBe(201);
    expect(placed.order.buyerStatus).toBe('expired');
    expect(placed.order.payment).toMatchObject({ checkoutUrl: null, linkError: null });
    const row = await linkRow(placed.order.code);
    expect(row).toMatchObject({ status: 'expired', payment_link: null, payout_account_id: null });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInventoryConsistent(placed.eventId);
    expect((await jobsOf(row.id)).map((j) => j.data.linked)).toEqual([false]);
  });
});

describe('job (a) hết hạn Đơn trong lúc chờ Tingee', () => {
  it.each([
    ['1007 (tạm ngừng)', { code: '1007' }],
    ['HTTP 500 (mơ hồ)', { code: '500', httpStatus: 500 }],
    ['1006 (từ chối thường)', { code: '1006' }],
  ])('%s tới sau khi job (a) đã hết hạn Đơn → giữ expired, nhả chỗ đúng một lần, không ghi đè lý do', async (_name, reply) => {
    const sale = await eventOnSale(org, [{ name: 'Đơn nam', price: 300_000, capacity: 5 }]);
    const tierId = sale.tiers[0]!.id;
    // Một Đơn chờ khác trên cùng Hạng vé: `held` phải còn đúng phần của Đơn này.
    const other = await signUp(h);
    await postOrder(h, other, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity: 1 }])).expect(201);
    const buyer = await signUp(h);
    fake.merchant(MAIN.clientId).linkReplies = [reply];
    afterNextLink = async (input) => {
      const { rows } = await h.db.pool.query<{ id: string }>(
        `UPDATE orders SET expires_at = now() - interval '1 second' WHERE code = $1 RETURNING id`,
        [input.orderId],
      );
      expect(await expireOrder(h.db, rows[0]!.id)).toBe('expired');
    };
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity: 2 }])).expect(201);
    const order = parseOrder(res.body);
    expect(order).toMatchObject({ buyerStatus: 'expired', payment: { checkoutUrl: null, linkError: null } });
    expect(await linkRow(order.code)).toMatchObject({ status: 'expired', payment_link: null, payment_link_error: null });
    expect(await inventory(h, tierId)).toEqual({ capacity: 5, sold: 0, held: 1 });
    await expectInventoryConsistent(sale.event.id);
  });
});

describe('gửi lại cùng khóa', () => {
  it('Đơn đã có link → 200 cùng Đơn, cùng URL; không gọi Tingee', async () => {
    const placed = await place(1);
    const body = orderBody([{ ticketTypeId: placed.tierId, quantity: 1 }]);
    const replay = parseOrder((await postOrder(h, placed.buyer, placed.slug, body, placed.key).expect(200)).body);
    expect(replay.code).toBe(placed.order.code);
    expect(replay.payment?.checkoutUrl).toBe(placed.order.payment!.checkoutUrl);
    expect(linkCalls()).toHaveLength(1);
    await expectInventoryConsistent(placed.eventId);
  });

  it('Đơn chưa có link mà còn lượt → thử tạo link, 200 có URL', async () => {
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const placed = await place(1);
    expect(placed.order.payment?.checkoutUrl).toBeNull();
    const body = orderBody([{ ticketTypeId: placed.tierId, quantity: 1 }]);
    const replay = parseOrder((await postOrder(h, placed.buyer, placed.slug, body, placed.key).expect(200)).body);
    expect(replay).toMatchObject({ code: placed.order.code, buyerStatus: 'awaiting_payment' });
    expect(replay.payment?.checkoutUrl).toContain(`/checkout/${placed.order.code}`);
    expect(linkCalls()).toHaveLength(2);
  });
});

describe('POST /v1/me/orders/:code/payment-link', () => {
  it('Đơn của người khác hoặc mã sai → 404 ORDER_NOT_FOUND; không gọi Tingee', async () => {
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const placed = await place(1);
    const stranger = await signUp(h);
    const res = await retry(stranger, placed.order.code).expect(404);
    expect(errorOf(res.body).code).toBe('ORDER_NOT_FOUND');
    expect(errorOf((await retry(stranger, 'TKKHNGC0XX').expect(404)).body).code).toBe('ORDER_NOT_FOUND');
    expect(errorOf((await retry(stranger, 'abc').expect(404)).body).code).toBe('ORDER_NOT_FOUND');
    expect(linkCalls()).toHaveLength(1);
    expect(parseOrder((await h.http.get(`/v1/me/orders/${placed.order.code}`).set('cookie', placed.buyer.cookie)).body).payment?.checkoutUrl).toBeNull();
  });

  it('Đơn không đủ điều kiện (đã có link; quá hạn Giữ chỗ) → 200 Đơn hiện tại, không gọi Tingee', async () => {
    const linked = await place(1);
    expect(parseOrder((await retry(linked.buyer, linked.order.code).expect(200)).body).payment?.checkoutUrl).toBe(
      linked.order.payment!.checkoutUrl,
    );
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const late = await place(1);
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '1 second' WHERE code = ${late.order.code}`);
    expect(parseOrder((await retry(late.buyer, late.order.code).expect(200)).body)).toMatchObject({
      buyerStatus: 'confirming',
      payment: { checkoutUrl: null },
    });
    expect(linkCalls()).toHaveLength(2);
  });

  it('chưa đăng nhập → 401', async () => {
    await h.http.post('/v1/me/orders/TK8F3Q2AXM/payment-link').send().expect(401);
  });

  it('thử lại liên tục sau 1006 → tính vào giới hạn tốc độ tạo Đơn; quá giới hạn → 429, không gọi Tingee thêm', async () => {
    fake.merchant(MAIN.clientId).linkReplies = Array.from({ length: 30 }, () => ({ code: '1006' }));
    const placed = await place(1);
    expect(placed.order.payment?.linkError).toBe('provider_error');
    let limited: Awaited<ReturnType<typeof retry>> | null = null;
    for (let i = 0; i < 20 && !limited; i++) {
      const res = await retry(placed.buyer, placed.order.code);
      if (res.status === 429) limited = res;
      else expect(res.status).toBe(200);
    }
    expect(limited).not.toBeNull();
    expect(errorOf(limited!.body).code).toBe('ORDER_RATE_LIMITED');
    const calls = linkCalls().length;
    // Lần tạo Đơn + các lần thử lại trong giới hạn (10 lần mỗi tài khoản mỗi 10 phút).
    expect(calls).toBe(10);
    expect((await retry(placed.buyer, placed.order.code)).status).toBe(429);
    expect(linkCalls()).toHaveLength(calls);
    // Lượt vẫn còn (chưa giành): Đơn chờ, chưa có link.
    expect(await linkRow(placed.order.code)).toMatchObject({ status: 'pending', payment_link_attempt_at: null });
    await expectInventoryConsistent(placed.eventId);
  });
});

describe('chốt link theo sellability (E3-2)', () => {
  /** Đơn 2 Vé chưa có link (Tingee từ chối thường lần đầu): `pending`, `provider_error`, còn lượt; một lời gọi Tingee. */
  async function placeWithoutLink(owner: Org = org): Promise<Placed> {
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const placed = await place(2, owner);
    expect(placed.order).toMatchObject({
      buyerStatus: 'awaiting_payment',
      payment: { checkoutUrl: null, linkError: 'provider_error' },
    });
    expect(linkCalls()).toHaveLength(1);
    return placed;
  }

  /** BTC bấm "Kết thúc" thật (`POST …/end`): lệnh này chỉ nhận Sự kiện đã bắt đầu, nên dời giờ bắt đầu về trước. */
  async function endEvent(eventId: string, owner: Org = org): Promise<void> {
    await h.db.pool.query("UPDATE events SET starts_at = now() - interval '1 hour' WHERE id = $1", [eventId]);
    await h.http.post(`${eventsPath(owner, eventId)}/end`).set('cookie', owner.owner.cookie).expect(200);
  }

  /**
   * Đơn bị chốt chặn: 200 `expired`, `sales_paused`, không thêm lời gọi Tingee nào, lượt không trả, chỗ đã nhả (bất biến
   * tồn kho đúng), log cảnh báo kèm BTC, mã Đơn và lý do.
   */
  async function expectBlocked(placed: Placed, body: unknown, saleReason: string, owner: Org = org): Promise<void> {
    const order = parseOrder(body);
    expect(order).toMatchObject({
      code: placed.order.code,
      buyerStatus: 'expired',
      payment: { checkoutUrl: null, linkError: 'sales_paused' },
    });
    expect(linkCalls()).toHaveLength(1);
    const row = await linkRow(placed.order.code);
    expect(row).toMatchObject({ status: 'expired', payment_link: null, payment_link_error: 'sales_paused' });
    expect(row.payment_link_attempt_at).not.toBeNull();
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    await expectInvariants(h, placed.eventId);
    const warning = h.logs.lines.find((l) => l.orderCode === placed.order.code && l.reason === saleReason);
    expect(warning).toMatchObject({ organizationId: owner.orgId, level: 40 });
  }

  it('"Thử lại" sau Kết thúc → 200 expired, sales_paused, nhả chỗ; không request nào tới Tingee', async () => {
    const placed = await placeWithoutLink();
    await endEvent(placed.eventId);
    const res = await retry(placed.buyer, placed.order.code).expect(200);
    await expectBlocked(placed, res.body, 'ended');
    // Đơn đã hết hạn: thử lại lần nữa không gọi Tingee, không đổi gì.
    expect(parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body).buyerStatus).toBe('expired');
    expect(linkCalls()).toHaveLength(1);
  });

  it('gửi lại cùng khóa sau Kết thúc → 200 cùng Đơn, expired, sales_paused; không gọi Tingee', async () => {
    const placed = await placeWithoutLink();
    await endEvent(placed.eventId);
    const body = orderBody([{ ticketTypeId: placed.tierId, quantity: 2 }]);
    const res = await postOrder(h, placed.buyer, placed.slug, body, placed.key).expect(200);
    await expectBlocked(placed, res.body, 'ended');
  });

  it.each([
    ['Ẩn (POST …/hide)', 'hidden', null],
    ['Sự kiện bị khóa', 'locked', sql`locked_at = now()`],
    ['Sự kiện hủy', 'cancelled', sql`status = 'cancelled'`],
  ])('"Thử lại" sau %s → 200 expired, sales_paused, nhả chỗ; không gọi Tingee', async (_name, saleReason, set) => {
    const placed = await placeWithoutLink();
    if (set) await h.db.orm.execute(sql`UPDATE events SET ${set} WHERE id = ${placed.eventId}`);
    else await h.http.post(`${eventsPath(org, placed.eventId)}/hide`).set('cookie', org.owner.cookie).expect(200);
    const res = await retry(placed.buyer, placed.order.code).expect(200);
    await expectBlocked(placed, res.body, saleReason);
  });

  it('"Thử lại" sau khi Closed Beta bị thu hồi (mất điều kiện bán Vé có phí) → 200 expired, sales_paused; không gọi Tingee', async () => {
    const own = await paidReadyOrg(h, { name: 'CLB Quần vợt', credential: MAIN, payout: MAIN_PAYOUT });
    const placed = await placeWithoutLink(own);
    const platformAdmin = await signUpPlatformAdmin(h);
    await h.http
      .post(`/v1/admin/organizations/${own.orgId}/closed-beta/revoke`)
      .set('cookie', platformAdmin.cookie)
      .expect(204);
    const res = await retry(placed.buyer, placed.order.code).expect(200);
    await expectBlocked(placed, res.body, 'paused', own);
  });

  it('chốt link lỗi (DB) khi "Thử lại" → 200 Đơn vẫn chờ, provider_error, trả lượt, không gọi Tingee; thử lại sau tạo được link', async () => {
    const placed = await placeWithoutLink();
    gateFault.next = true;
    const order = parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body);
    expect(order).toMatchObject({
      buyerStatus: 'awaiting_payment',
      payment: { checkoutUrl: null, linkError: 'provider_error' },
    });
    expect(linkCalls()).toHaveLength(1);
    expect(await linkRow(placed.order.code)).toMatchObject({
      status: 'pending',
      payment_link: null,
      payment_link_attempt_at: null,
      payment_link_error: 'provider_error',
    });
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInvariants(h, placed.eventId);
    const error = h.logs.lines.find((l) => l.orderCode === placed.order.code && l.error === 'DatabaseError');
    expect(error).toMatchObject({ organizationId: org.orgId, level: 50 });

    // Lượt đã trả: lần thử kế tiếp qua chốt và gọi Tingee.
    const next = parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body);
    expect(next.payment?.checkoutUrl).toContain(`/checkout/${placed.order.code}`);
    expect(linkCalls()).toHaveLength(2);
  });

  it('"Thử lại" khi Sự kiện còn bán mà Hạng vé vừa qua giờ đóng bán → gọi Tingee như cũ (Đơn đã giữ chỗ)', async () => {
    const placed = await placeWithoutLink();
    await h.db.orm.execute(
      sql`UPDATE ticket_types SET sale_ends_at = now() - interval '1 second' WHERE id = ${placed.tierId}`,
    );
    const order = parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body);
    expect(order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { linkError: null } });
    expect(order.payment?.checkoutUrl).toContain(`/checkout/${placed.order.code}`);
    expect(linkCalls()).toHaveLength(2);
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 2 });
    await expectInvariants(h, placed.eventId);
  });

  it('Trang Đơn sau Kết thúc: Đơn pending có link → checkoutUrl null (link vẫn trong DB, giữ chỗ); thử lại không gọi Tingee', async () => {
    const placed = await place(2);
    expect(placed.order.payment?.checkoutUrl).not.toBeNull();
    await endEvent(placed.eventId);
    const get = () => h.http.get(`/v1/me/orders/${placed.order.code}`).set('cookie', placed.buyer.cookie).expect(200);
    const order = parseOrder((await get()).body);
    expect(order).toMatchObject({
      buyerStatus: 'awaiting_payment',
      event: { ended: true },
      payment: { checkoutUrl: null, linkError: null },
    });
    // Không đổi Đơn: link tự hết hạn theo job (c); tiền về sau Kết thúc đi nhánh `orphan` `event_ended`.
    expect(await linkRow(placed.order.code)).toMatchObject({
      status: 'pending',
      payment_link: placed.order.payment!.checkoutUrl,
    });
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 2 });
    const retried = parseOrder((await retry(placed.buyer, placed.order.code).expect(200)).body);
    expect(retried.payment?.checkoutUrl).toBeNull();
    const replay = await postOrder(
      h,
      placed.buyer,
      placed.slug,
      orderBody([{ ticketTypeId: placed.tierId, quantity: 2 }]),
      placed.key,
    ).expect(200);
    expect(parseOrder(replay.body).payment?.checkoutUrl).toBeNull();
    expect(linkCalls()).toHaveLength(1);
    // Hết hạn sau đó: vẫn không có URL.
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '1 second' WHERE code = ${placed.order.code}`);
    expect(parseOrder((await get()).body)).toMatchObject({ buyerStatus: 'confirming', payment: { checkoutUrl: null } });
    await expectInvariants(h, placed.eventId);
  });

  it('Trang Đơn khi Ẩn: Đơn pending có link → checkoutUrl vẫn có (AC 3.6: tiền về cho Đơn pending vẫn phát Vé)', async () => {
    const placed = await place(2);
    await h.http.post(`${eventsPath(org, placed.eventId)}/hide`).set('cookie', org.owner.cookie).expect(200);
    const order = parseOrder(
      (await h.http.get(`/v1/me/orders/${placed.order.code}`).set('cookie', placed.buyer.cookie).expect(200)).body,
    );
    expect(order).toMatchObject({ buyerStatus: 'awaiting_payment', event: { ended: false } });
    expect(order.payment?.checkoutUrl).toBe(placed.order.payment!.checkoutUrl);
    expect(linkCalls()).toHaveLength(1);
  });
});

describe('GET …/events/:eventId/pending-payment-count (E3-2)', () => {
  const countOf = (eventId: string, user: User = org.owner, orgId = org.orgId) =>
    h.http.get(`/v1/orgs/${orgId}/events/${eventId}/pending-payment-count`).set('cookie', user.cookie);

  it('đếm Đơn pending có link còn hạn: 2 tính; chưa có link, link quá expires_at, paid, Sự kiện khác cùng BTC không tính; Owner và Admin', async () => {
    const sale = await eventOnSale(org, [{ name: 'Đơn nam', price: 300_000, capacity: 10 }]);
    expect(EventPendingPaymentCount.parse((await countOf(sale.event.id).expect(200)).body)).toEqual({ orders: 0 });
    const buy = async (target = sale) => {
      const body = orderBody([{ ticketTypeId: target.tiers[0]!.id, quantity: 1 }]);
      const res = await postOrder(h, await signUp(h), target.event.slug, body);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return parseOrder(res.body);
    };
    await buy();
    await buy();
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    expect((await buy()).payment?.checkoutUrl).toBeNull();
    const late = await buy();
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '1 second' WHERE code = ${late.code}`);
    const paid = await buy();
    const ipnKey = await ipnKeyOf(h, org.orgId);
    await postIpn(h, ipnKey, signIpn(MAIN.secretToken, fakeIpnPayload(paid.code, paid.totalAmount))).expect(200);
    expect((await linkRow(paid.code)).status).toBe('paid');
    await expectInvariants(h, sale.event.id);
    // Sự kiện khác của cùng BTC: Đơn chờ có link còn hạn ở đó không tính vào Sự kiện này.
    const otherSale = await eventOnSale(org, [{ name: 'Đơn nữ', price: 300_000, capacity: 10 }]);
    expect((await buy(otherSale)).payment?.checkoutUrl).not.toBeNull();

    expect((await countOf(sale.event.id).expect(200)).body).toEqual({ orders: 2 });
    expect((await countOf(otherSale.event.id).expect(200)).body).toEqual({ orders: 1 });
    const admin = await signUp(h);
    await h.db.orm.execute(
      sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
    );
    expect((await countOf(sale.event.id, admin).expect(200)).body).toEqual({ orders: 2 });
    // Không phải thành viên của chính BTC này (như CTV) → 403 NOT_A_MEMBER.
    const outsider = await signUp(h);
    expect(errorOf((await countOf(sale.event.id, outsider).expect(403)).body).code).toBe('NOT_A_MEMBER');
  });

  // BTC chỉ có hai vai Owner và Admin (`Role`, `members_role_check`); CTV không phải thành viên BTC: người không phải
  // thành viên (như CTV) → 403 NOT_A_MEMBER.
  it('Sự kiện lạ, sai dạng hoặc của BTC khác → 404 EVENT_NOT_FOUND; không phải thành viên → 403; chưa đăng nhập → 401', async () => {
    const other = await paidReadyOrg(h, { name: 'BTC khác', credential: NEXT, payout: NEXT_PAYOUT });
    const theirs = await eventOnSale(other, [{ name: 'Vé', price: 300_000, capacity: 5 }]);
    for (const id of [randomUUID(), 'khong-phai-uuid', theirs.event.id]) {
      const res = await countOf(id).expect(404);
      expect(errorOf(res.body).code).toBe('EVENT_NOT_FOUND');
    }
    const stranger = await signUp(h);
    const res = await countOf(theirs.event.id, stranger, other.orgId).expect(403);
    expect(errorOf(res.body).code).toBe('NOT_A_MEMBER');
    expect(errorOf((await countOf(theirs.event.id, org.owner, other.orgId).expect(403)).body).code).toBe('NOT_A_MEMBER');
    await h.http.get(`/v1/orgs/${other.orgId}/events/${theirs.event.id}/pending-payment-count`).expect(401);
  });
});

describe('hết hạn (c): Đơn đã có link', () => {
  it('chạy sớm → not_yet (cả trong 5 phút chừa); quá hạn + 5 phút → expired, held -= n; gọi lại → skipped', async () => {
    const placed = await place(2);
    const { id } = await linkRow(placed.order.code);
    expect(await expireOrder(h.db, id, 'link')).toBe('not_yet');
    // Job (a) không chạm Đơn đã có link.
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '4 minutes' WHERE id = ${id}`);
    expect(await expireOrder(h.db, id)).toBe('skipped');
    expect(await expireOrder(h.db, id, 'link')).toBe('not_yet');
    expect(await inventory(h, placed.tierId)).toMatchObject({ held: 2 });

    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '6 minutes' WHERE id = ${id}`);
    expect(await expireOrder(h.db, id, 'link')).toBe('expired');
    expect((await linkRow(placed.order.code)).status).toBe('expired');
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
    expect(await expireOrder(h.db, id, 'link')).toBe('skipped');
    await expectInventoryConsistent(placed.eventId);
    // Đơn hết hạn không còn trả checkout URL.
    const order = parseOrder((await h.http.get(`/v1/me/orders/${placed.order.code}`).set('cookie', placed.buyer.cookie)).body);
    expect(order).toMatchObject({ buyerStatus: 'expired', payment: { checkoutUrl: null } });
  });

  it('Đơn chưa có link → (c) bỏ qua; payload cũ không có cờ là (a)', async () => {
    fake.merchant(MAIN.clientId).linkReplies = [{ code: '1006' }];
    const placed = await place(1);
    const { id } = await linkRow(placed.order.code);
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '10 minutes' WHERE id = ${id}`);
    expect(await expireOrder(h.db, id, 'link')).toBe('skipped');
    expect(ExpireOrderPayload.parse({ orderId: id })).toEqual({ orderId: id, linked: false });
  });

  it('tạo Đơn mới: Đơn có link cũ quá hạn + 5 phút được hết hạn trước TX1; còn trong 5 phút → 409 PENDING_ORDER_EXISTS', async () => {
    const placed = await place(2);
    const body = orderBody([{ ticketTypeId: placed.tierId, quantity: 1 }]);
    await h.db.orm.execute(
      sql`UPDATE orders SET expires_at = now() - interval '1 minute' WHERE code = ${placed.order.code}`,
    );
    const blocked = await postOrder(h, placed.buyer, placed.slug, body).expect(409);
    expect(errorOf(blocked.body).code).toBe('PENDING_ORDER_EXISTS');

    await h.db.orm.execute(
      sql`UPDATE orders SET expires_at = now() - interval '6 minutes' WHERE code = ${placed.order.code}`,
    );
    const next = parseOrder((await postOrder(h, placed.buyer, placed.slug, body).expect(201)).body);
    expect(next.code).not.toBe(placed.order.code);
    expect((await linkRow(placed.order.code)).status).toBe('expired');
    expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 1 });
    await expectInventoryConsistent(placed.eventId);
  });

  describe('worker thật', () => {
    let worker: INestApplicationContext;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [WorkerModule.forRoot(workerConfig())] }).compile();
      worker = await moduleRef.init();
    });
    afterAll(async () => {
      await worker.close();
    });

    it('job (c) tới hạn → worker (Tingee là cổng 1, không gọi) chuyển expired và nhả chỗ', async () => {
      const placed = await place(2);
      const { id } = await linkRow(placed.order.code);
      await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '10 minutes' WHERE id = ${id}`);
      const workerBoss = worker.get<PgBoss>(BOSS);
      // Job (c) của TX2 chạy sau 20 phút: enqueue thêm một job (c) chạy ngay để kiểm handler.
      await workerBoss.send(QUEUE, { orderId: id, linked: true });
      await expect
        .poll(async () => (await linkRow(placed.order.code)).status, { timeout: 20_000, interval: 200 })
        .toBe('expired');
      expect(await inventory(h, placed.tierId)).toEqual({ capacity: 5, sold: 0, held: 0 });
      await expectInventoryConsistent(placed.eventId);
    });
  });
});

describe('đổi tài khoản nhận tiền giữa hai Đơn', () => {
  it('B ký bằng credential của tài khoản mới với VA mới; A giữ tài khoản cũ (cả người nhận hiển thị)', async () => {
    const own = await paidReadyOrg(h, { name: 'CLB Bơi lội', credential: MAIN, payout: MAIN_PAYOUT });
    const sale = await eventOnSale(own, [{ name: 'Vé bơi', price: 150_000, capacity: 10 }]);
    const tierId = sale.tiers[0]!.id;
    const buyerA = await signUp(h);
    const a = parseOrder(
      (await postOrder(h, buyerA, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity: 1 }])).expect(201)).body,
    );
    const rowA = await linkRow(a.code);
    expect(a.payment?.checkoutUrl).not.toBeNull();

    // "Đổi key Tingee" (Story 2.13-b): credential cũ và mọi tài khoản cũ bị gỡ mềm, tài khoản mới là mặc định.
    await h.db.orm.execute(sql`UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = ${own.orgId}`);
    await h.db.orm.execute(
      sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${own.orgId}`,
    );
    const { payoutAccountId } = await linkPayoutAccount(own, NEXT, NEXT_PAYOUT);

    const buyerB = await signUp(h);
    const b = parseOrder(
      (await postOrder(h, buyerB, sale.event.slug, orderBody([{ ticketTypeId: tierId, quantity: 2 }])).expect(201)).body,
    );
    expect(b.buyerStatus).toBe('awaiting_payment');
    const [callA, callB] = linkCalls();
    expect(callA).toMatchObject({ clientId: MAIN.clientId, signatureValid: true, body: { vaAccountNumber: MAIN_PAYOUT.vaAccountNumber } });
    expect(callB).toMatchObject({
      clientId: NEXT.clientId,
      signatureValid: true,
      body: { orderId: b.code, amount: 300_000, vaAccountNumber: NEXT_PAYOUT.vaAccountNumber },
    });
    expect((await linkRow(b.code)).payout_account_id).toBe(payoutAccountId);
    expect((await linkRow(a.code)).payout_account_id).toBe(rowA.payout_account_id);
    expect(b.payment?.recipient).toMatchObject({ accountName: 'TRAN THI BINH', bankName: 'MB Bank' });
    const againA = parseOrder((await h.http.get(`/v1/me/orders/${a.code}`).set('cookie', buyerA.cookie).expect(200)).body);
    expect(againA.payment?.recipient).toEqual({
      organizationName: 'CLB Bơi lội',
      accountName: 'NGUYEN VAN TUAN',
      bankName: 'Vietcombank',
    });
    expect(againA.payment?.checkoutUrl).toBe(a.payment!.checkoutUrl);
    await expectInventoryConsistent(sale.event.id);
  });
});

describe('Đơn 0đ (Story 3.3 không đổi)', () => {
  it('không gọi Tingee, payment null; thử lại → 200 paid, không gọi Tingee', async () => {
    const buyer = await signUp(h);
    const sale = await eventOnSale(org, [{ name: 'Vé cổ vũ', price: 0, capacity: 5 }]);
    const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity: 1 }])).expect(201);
    const order = parseOrder(res.body);
    expect(order).toMatchObject({ buyerStatus: 'paid', payment: null });
    expect(parseOrder((await retry(buyer, order.code).expect(200)).body)).toMatchObject({ buyerStatus: 'paid', payment: null });
    expect(linkCalls()).toHaveLength(0);
  });
});
