import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ErrorResponse,
  EventAvailability,
  EventSaleStatusList,
  JobQueue,
  PaymentServiceCheckResult,
  PaymentServiceReason,
  PaymentServiceStatus,
  PayoutAccountOverview,
  REAUTH_HEADER,
  Role,
  StatusNoticeList,
  SuspendedPaymentServiceOrganizationList,
  type BuyerOrderView,
} from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import type { Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { reconcileJobId } from '../../src/modules/ordering/reconciliation-jobs.js';
import {
  PAYMENT_SERVICE_PROBE_CRON,
  PAYMENT_SERVICE_RESUMED_QUEUE,
  PaymentServiceProbeWorker,
  PaymentServiceProber,
  PaymentServiceQueues,
  resumePaymentService,
} from '../../src/modules/organizer/payment-service.js';
import { organizations } from '../../src/modules/organizer/schema.js';
import { PaymentServiceResumedWorker } from '../../src/modules/payment/index.js';
import {
  HttpTingeeClient,
  TINGEE_CLIENT,
  type PaymentLinkInput,
  type TingeeClient,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { DATABASE, type Database } from '../../src/platform/db/index.js';
import { BOSS } from '../../src/platform/jobs/index.js';
import { REALTIME_CHANNEL } from '../../src/platform/realtime/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { databaseUrl, workerConfig } from '../helpers.js';
import { createHarness, reauthToken, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  ipnKeyOf,
  linkPayoutAccount,
  orderBody,
  paidReadyOrg,
  parseOrder,
  paymentServiceOf,
  postOrder,
  resetOrderRateLimit,
  resetPaymentService,
  type Org,
  type PayoutSpec,
  type User,
} from '../ordering/order-fixtures.js';
import { expectInvariants, orderState, postIpn } from '../payment/ipn-fixtures.js';
import {
  ACCOUNTS_PATH,
  CREATE_LINK_PATH,
  fakeAccount,
  fakeStatusIpnPayload,
  signIpn,
  startTingeeFake,
  type FakeAccount,
  type FakeLinkReply,
  type TingeeFake,
} from '../tingee-fake/server.js';

/*
 * Story 4.2-a: cờ dịch vụ thanh toán của BTC trên Postgres thật và Tingee fake (server HTTP thật; `create-link` và
 * `get-va-paging` cài trước mã ngắt). Mỗi dòng của I/O Matrix: bật cờ khi tạo link bị từ chối (theo mã), không bật với
 * key vừa bị thay, bán khi đang ngắt (TX1, chốt link, trang công khai), dò (job, "Kiểm tra lại"), Quản trị Tingee, lưu
 * key mới, hai đường mở lại cùng lúc, `notices`, tổng quan Tài khoản nhận tiền; job "đã mở lại" Đối soát bù mọi Đơn còn
 * mở. Story 4.2-d: nhóm VA (fake tự trả 2023 khi VA không thuộc merchant) bật lý do `payout_account_not_allowed` khi
 * tài khoản đã gọi vẫn là mặc định; job dò bỏ qua, "Kiểm tra lại" tắt không gọi Tingee, đổi/hủy tài khoản mặc định tắt
 * (`default_changed`). Mỗi test một BTC mới. Sau mỗi nhánh có Đơn: bất biến tồn kho – Vé (`expectInvariants`). Khối
 * "worker thật" chạy lịch cron và hai job qua pg-boss.
 */

const MAIN: TingeeCredential = { clientId: 'tg-svc-main-5e7b', secretToken: 'tg-svc-main-secret-Rt4Ye3Wq2' };
const NEXT: TingeeCredential = { clientId: 'tg-svc-next-6f8c', secretToken: 'tg-svc-next-secret-Mn1Bv0Cx9' };
const mainAccount = fakeAccount({ accountName: 'VO VAN DUNG' });
const nextAccount = fakeAccount({ accountName: 'VO VAN DUNG' });
const payoutOf = (account: FakeAccount): PayoutSpec => ({
  vaAccountNumber: String(account.vaAccountNumber),
  accountName: String(account.accountName),
  bankName: String(account.bankName),
});
const PRICE = 300_000;
const PORTAL = 'https://baas.tingee.vn';

let fake: TingeeFake;
let h: Harness;
let boss: PgBoss;
let prober: PaymentServiceProber;
let probeWorker: PaymentServiceProbeWorker;
let resumedWorker: PaymentServiceResumedWorker;
let platformAdmin: Awaited<ReturnType<typeof signUpPlatformAdmin>>;
/** Kết nối `LISTEN` riêng: thấy mọi `NOTIFY` của kênh realtime. */
let listener: pg.Client;
const notified: Record<string, unknown>[] = [];
/** BTC tạo trong file này: đặt lại cờ khi xong để job dò của file khác (hay lần chạy sau) không phải dò chúng. */
const created: string[] = [];
/** Chạy một lần ngay sau lời gọi `create-link` kế tiếp (trước transaction bù). */
let afterNextLink: ((input: PaymentLinkInput) => Promise<void>) | null = null;
/** Chạy một lần ngay sau lời gọi dò kế tiếp (trước khi ghi kết quả): chen thao tác của bên khác vào giữa. */
let afterNextProbe: (() => Promise<void>) | null = null;

beforeAll(async () => {
  fake = await startTingeeFake({
    merchants: [
      { ...MAIN, accounts: [mainAccount] },
      { ...NEXT, accounts: [nextAccount] },
    ],
  });
  // Client HTTP thật trỏ vào fake (timeout dò 1 giây), bọc thêm móc chạy sau `create-link`.
  const http = new HttpTingeeClient({ baseUrl: fake.url, serviceStatusTimeoutMs: 1_000 });
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
    async getMerchantServiceStatus(credential) {
      const status = await http.getMerchantServiceStatus(credential);
      const hook = afterNextProbe;
      afterNextProbe = null;
      if (hook) await hook();
      return status;
    },
  };
  h = await createHarness({ TINGEE_BASE_URL: fake.url }, { overrides: [{ provide: TINGEE_CLIENT, useValue: client }] });
  boss = h.app.get<PgBoss>(BOSS);
  const db = h.app.get<Database>(DATABASE);
  prober = h.app.get(PaymentServiceProber);
  probeWorker = new PaymentServiceProbeWorker(db, boss, prober);
  resumedWorker = new PaymentServiceResumedWorker(db, boss);
  platformAdmin = await signUpPlatformAdmin(h);
  listener = new pg.Client({ connectionString: databaseUrl() });
  await listener.connect();
  listener.on('notification', (message) => notified.push(JSON.parse(message.payload ?? '{}') as Record<string, unknown>));
  await listener.query(`LISTEN ${REALTIME_CHANNEL}`);
});
beforeEach(async () => {
  fake.reset();
  for (const { clientId } of [MAIN, NEXT]) {
    fake.merchant(clientId).linkReplies = [];
    fake.merchant(clientId).accountReplies = [];
  }
  afterNextLink = null;
  afterNextProbe = null;
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  for (const orgId of created) await resetPaymentService(h, orgId);
  await listener.end();
  await h.close();
  await fake.close();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const errorOf = (res: Response) => ErrorResponse.parse(res.body).error;

async function newOrg(name: string, credential: TingeeCredential = MAIN, account: FakeAccount = mainAccount): Promise<Org> {
  const org = await paidReadyOrg(h, { name, credential, payout: payoutOf(account) });
  created.push(org.orgId);
  return org;
}

interface Sale {
  eventId: string;
  slug: string;
  paidTier: string;
  freeTier: string;
}

/** Sự kiện đã mở bán: Hạng vé 300.000đ và Hạng vé 0đ, mỗi Hạng 5 suất. */
async function newSale(org: Org): Promise<Sale> {
  const sale = await eventOnSale(org, [
    { name: 'Đơn nam', price: PRICE, capacity: 5 },
    { name: 'Khán giả', price: 0, capacity: 5 },
  ]);
  return { eventId: sale.event.id, slug: sale.event.slug, paidTier: sale.tiers[0]!.id, freeTier: sale.tiers[1]!.id };
}

interface Placed {
  buyer: User;
  code: string;
  orderId: string;
  order: BuyerOrderView;
}

/** Người mua mới đặt 1 Vé có phí; `code`: mã Tingee trả cho `create-link` (mặc định tạo link như Tingee). */
async function placePaid(sale: Sale, code?: string): Promise<Placed> {
  const buyer = await signUp(h);
  if (code) fake.merchant(MAIN.clientId).linkReplies = [{ code }];
  const res = await postOrder(h, buyer, sale.slug, orderBody([{ ticketTypeId: sale.paidTier, quantity: 1 }])).expect(201);
  const order = parseOrder(res.body);
  return { buyer, code: order.code, orderId: (await orderState(h, order.code)).id, order };
}

/** Bật cờ đúng đường thật: `create-link` của một Đơn mới bị Tingee từ chối bằng `code`. */
async function suspendVia(org: Org, code: string): Promise<{ sale: Sale; placed: Placed }> {
  const sale = await newSale(org);
  const placed = await placePaid(sale, code);
  expect(placed.order).toMatchObject({ buyerStatus: 'expired', payment: { checkoutUrl: null, linkError: 'sales_paused' } });
  return { sale, placed };
}

async function auditRows(orgId: string, action: string) {
  const { rows } = await h.db.pool.query<{ actor_user_id: string | null; target_type: string; target_id: string; changed_fields: string[] }>(
    `SELECT actor_user_id, target_type, target_id, changed_fields FROM audit_events
      WHERE organization_id = $1 AND action = $2 ORDER BY created_at, id`,
    [orgId, action],
  );
  return rows;
}

const statusSignalsOf = (orgId: string) =>
  notified.filter((n) => n.type === 'org_status_changed' && n.organizationId === orgId);

const resumedJobsOf = async (orgId: string) =>
  boss.findJobs(JobQueue.PAYMENT_SERVICE_RESUMED, { data: { organizationId: orgId } });

async function availability(slug: string): Promise<EventAvailability> {
  return EventAvailability.parse((await h.http.get(`/v1/events/${slug}/availability`).expect(200)).body);
}

async function noticeCodes(cookie: string, orgId: string): Promise<string[]> {
  const res = await h.http.get(`/v1/orgs/${orgId}/notices`).set('cookie', cookie).expect(200);
  return StatusNoticeList.parse(res.body).map((n) => n.code);
}

const check = (org: Org, cookie = org.owner.cookie) =>
  h.http.post(`/v1/orgs/${org.orgId}/payment-service/check`).set('cookie', cookie).send();

/** "Kiểm tra lại" của Owner: 200 và `PaymentServiceCheckResult` (trạng thái, kết quả, số giây còn chờ). */
const checkResult = async (org: Org): Promise<PaymentServiceCheckResult> =>
  PaymentServiceCheckResult.parse((await check(org).expect(200)).body);

/** Lần dò trước lùi về quá thời gian chờ 30 giây. */
const ageLastCheck = (orgId: string) =>
  h.db.orm.execute(sql`
    UPDATE organizations SET payment_service_checked_at = payment_service_checked_at - interval '31 seconds'
     WHERE id = ${orgId}`);

async function addAdmin(org: Org): Promise<User> {
  const admin = await signUp(h);
  await h.db.orm.execute(
    sql`INSERT INTO members (organization_id, user_id, role) VALUES (${org.orgId}, ${admin.userId}, ${Role.ADMIN})`,
  );
  return admin;
}

/** Thêm một tài khoản nhận tiền (không mặc định) đọc bằng credential hiện hành của BTC; trả id. */
async function addAccount(org: Org, account: FakeAccount): Promise<string> {
  const va = String(account.vaAccountNumber);
  const { rows } = await h.db.pool.query<{ id: string }>(
    `INSERT INTO payout_accounts
       (organization_id, tingee_credential_id, va_account_number, bank_bin, bank_name, account_type, account_last4,
        account_name, created_by, is_default)
     SELECT $1, c.id, $2, '970436', $3, 'personal-account', $4, $5, $6, false
       FROM tingee_credentials c WHERE c.organization_id = $1 AND c.retired_at IS NULL
     RETURNING id`,
    [org.orgId, va, String(account.bankName), va.slice(-4), String(account.accountName), org.owner.userId],
  );
  return rows[0]!.id;
}

/** Id tài khoản nhận tiền mặc định hiện hành của BTC. */
async function defaultAccountId(orgId: string): Promise<string> {
  const { rows } = await h.db.pool.query<{ id: string }>(
    'SELECT id FROM payout_accounts WHERE organization_id = $1 AND is_default AND retired_at IS NULL',
    [orgId],
  );
  return rows[0]!.id;
}

/** "Đặt làm mặc định" của Owner (đã xác nhận lại; `token` bỏ trống thì xác nhận lại ngay trước lời gọi). */
async function setDefault(org: Org, accountId: string, token?: string): Promise<PayoutAccountOverview> {
  const proof = token ?? (await reauthToken(h, org.owner));
  const res = await h.http
    .post(`/v1/orgs/${org.orgId}/payout-account/${accountId}/default`)
    .set('cookie', org.owner.cookie)
    .set(REAUTH_HEADER, proof);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return PayoutAccountOverview.parse(res.body);
}

/** Hủy liên kết một tài khoản nhận tiền (Owner, đã xác nhận lại). */
async function unlink(org: Org, accountId: string): Promise<PayoutAccountOverview> {
  const token = await reauthToken(h, org.owner);
  const res = await h.http
    .delete(`/v1/orgs/${org.orgId}/payout-account/${accountId}`)
    .set('cookie', org.owner.cookie)
    .set(REAUTH_HEADER, token);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return PayoutAccountOverview.parse(res.body);
}

/** Nhãn trạng thái bán của Sự kiện ở trang chủ BTC (Story 4.2-c). */
async function saleStatusOf(org: Org, eventId: string) {
  const res = await h.http.get(`/v1/orgs/${org.orgId}/event-sale-status`).set('cookie', org.owner.cookie).expect(200);
  return EventSaleStatusList.parse(res.body).events.find((e) => e.eventId === eventId);
}

/**
 * BTC có tài khoản mặc định là VA của merchant khác (`nextAccount`) trên key MAIN: `create-link` bị fake từ chối thật
 * bằng 2023 (VA không phải tài khoản active của merchant). `extra`: thêm tài khoản `mainAccount` (VA hợp lệ) không mặc
 * định.
 */
async function newRejectedVaOrg(
  name: string,
  extra = false,
): Promise<{ org: Org; rejectedId: string; validId: string | null }> {
  const org = await newOrg(name, MAIN, nextAccount);
  const rejectedId = await defaultAccountId(org.orgId);
  const validId = extra ? await addAccount(org, mainAccount) : null;
  return { org, rejectedId, validId };
}

/** Bật cờ `payout_account_not_allowed` bằng đường thật: một Đơn có phí mà fake trả 2023 cho VA mặc định. */
async function suspendViaRejectedVa(org: Org): Promise<{ sale: Sale; placed: Placed }> {
  const sale = await newSale(org);
  const placed = await placePaid(sale);
  expect(placed.order).toMatchObject({
    buyerStatus: 'expired',
    payment: { checkoutUrl: null, linkError: 'sales_paused' },
  });
  return { sale, placed };
}

describe('bật cờ khi create-link bị Tingee từ chối', () => {
  it('Hết Token (1033) → Đơn expired sales_paused; cờ suspended token; audit hệ thống; org_status_changed cấp BTC; Hạng vé > 0đ paused, 0đ on_sale', async () => {
    const org = await newOrg('CLB Tennis Quận 7');
    const { sale, placed } = await suspendVia(org, '1033');

    const flag = await paymentServiceOf(h, org.orgId);
    expect(flag).toMatchObject({ status: 'suspended', reason: 'token', checked_at: null });
    expect(flag.since).toBeInstanceOf(Date);
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toEqual([
      {
        actor_user_id: null,
        target_type: 'payment_service_reason',
        target_id: 'token',
        changed_fields: ['payment_service_status', 'payment_service_reason', 'payment_service_since'],
      },
    ]);
    // Tín hiệu cấp BTC: id là BTC, không có Sự kiện (stream của Sự kiện không khớp).
    await expect.poll(() => statusSignalsOf(org.orgId)).toEqual([
      { type: 'org_status_changed', id: org.orgId, organizationId: org.orgId },
    ]);

    expect(await availability(sale.slug)).toEqual({
      eventReason: 'paused',
      tiers: [
        { ticketTypeId: sale.paidTier, status: 'paused', remaining: 5, saleStartsAt: null },
        { ticketTypeId: sale.freeTier, status: 'on_sale', remaining: 5, saleStartsAt: null },
      ],
    });
    expect((await orderState(h, placed.code)).status).toBe('expired');
    const warning = h.logs.lines.find((l) => l.organizationId === org.orgId && l.result === 'suspended');
    expect(warning).toMatchObject({ reason: 'token' });
    expect(h.logs.text).not.toContain(MAIN.secretToken);
    await expectInvariants(h, sale.eventId);
  });

  it.each([
    ['Merchant bị khóa (1007)', '1007', 'tingee_disabled'],
    ['Merchant bị khóa (1034)', '1034', 'tingee_disabled'],
    ['Key hỏng (97 sai chữ ký)', '97', 'credential_invalid'],
    ['Key thiếu quyền Cổng thanh toán (1133)', '1133', 'gateway_permission_missing'],
    ['VA lỗi (1023)', '1023', 'payout_account_not_allowed'],
    ['VA lỗi (1045)', '1045', 'payout_account_not_allowed'],
    ['VA lỗi (1024)', '1024', 'payout_account_not_allowed'],
    ['VA lỗi (1072)', '1072', 'payout_account_not_allowed'],
  ])('%s → Đơn sales_paused; cờ suspended lý do %s', async (_label, code, reason) => {
    const org = await newOrg(`CLB ${code}`);
    const { sale } = await suspendVia(org, code);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason });
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toMatchObject([
      { actor_user_id: null, target_id: reason },
    ]);
    await expectInvariants(h, sale.eventId);
  });

  it('VA chưa được cho phép (2023, fake: VA không thuộc merchant; Story 4.2-d) → Đơn sales_paused; cờ suspended payout_account_not_allowed; audit hệ thống; org_status_changed; Hạng vé > 0đ paused, 0đ on_sale; nhãn Sự kiện Tạm ngừng bán', async () => {
    const { org } = await newRejectedVaOrg('CLB Bóng rổ');
    const { sale, placed } = await suspendViaRejectedVa(org);
    expect(h.logs.lines.find((l) => l.orderCode === placed.code && l.tingeeCode === '2023')).toMatchObject({
      organizationId: org.orgId,
      domainCode: 'PAYMENT_ACCOUNT_NOT_ALLOWED',
    });

    const flag = await paymentServiceOf(h, org.orgId);
    expect(flag).toMatchObject({ status: 'suspended', reason: 'payout_account_not_allowed', checked_at: null });
    expect(flag.since).toBeInstanceOf(Date);
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toEqual([
      {
        actor_user_id: null,
        target_type: 'payment_service_reason',
        target_id: 'payout_account_not_allowed',
        changed_fields: ['payment_service_status', 'payment_service_reason', 'payment_service_since'],
      },
    ]);
    await expect.poll(() => statusSignalsOf(org.orgId)).toEqual([
      { type: 'org_status_changed', id: org.orgId, organizationId: org.orgId },
    ]);
    // AC: trang công khai (Hạng vé có phí "Tạm ngừng bán") và trang chủ BTC (nhãn Sự kiện "Tạm ngừng bán").
    expect(await availability(sale.slug)).toEqual({
      eventReason: 'paused',
      tiers: [
        { ticketTypeId: sale.paidTier, status: 'paused', remaining: 5, saleStartsAt: null },
        { ticketTypeId: sale.freeTier, status: 'on_sale', remaining: 5, saleStartsAt: null },
      ],
    });
    expect(await saleStatusOf(org, sale.eventId)).toEqual({ eventId: sale.eventId, reason: 'paused', partial: true });
    expect(await noticeCodes(org.owner.cookie, org.orgId)).toEqual([
      'PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED',
    ]);
    expect((await orderState(h, placed.code)).status).toBe('expired');
    expect(h.logs.lines.find((l) => l.organizationId === org.orgId && l.result === 'suspended')).toMatchObject({
      reason: 'payout_account_not_allowed',
    });
    expect(h.logs.text).not.toContain(MAIN.secretToken);
    await expectInvariants(h, sale.eventId);
  });

  it('Owner đặt tài khoản khác làm mặc định trong lúc create-link bằng VA cũ đang chờ (VA cũ trả 2023) → Đơn sales_paused, cờ không đổi; Đơn kế tiếp tạo link bằng VA mới', async () => {
    const { org, validId } = await newRejectedVaOrg('CLB Bóng đá mini', true);
    const sale = await newSale(org);
    const token = await reauthToken(h, org.owner);
    afterNextLink = async (input) => {
      expect(input.vaAccountNumber).toBe(String(nextAccount.vaAccountNumber));
      // `setDefault` commit trước transaction bù: VA vừa bị từ chối không còn là mặc định.
      await setDefault(org, validId!, token);
    };
    const placed = await placePaid(sale);
    expect(placed.order).toMatchObject({ buyerStatus: 'expired', payment: { linkError: 'sales_paused' } });
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'active', reason: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toEqual([]);
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);
    expect(h.logs.lines.find((l) => l.organizationId === org.orgId && l.result === 'stale_account')).toMatchObject({
      reason: 'payout_account_not_allowed',
    });

    const next = await placePaid(sale);
    expect(next.order.payment?.checkoutUrl).toEqual(expect.any(String));
    expect(fake.calls(CREATE_LINK_PATH).at(-1)?.body).toMatchObject({
      vaAccountNumber: String(mainAccount.vaAccountNumber),
    });
    await expectInvariants(h, sale.eventId);
  });

  it('lý do khác (1033) mà Owner đổi tài khoản mặc định trong lúc create-link → vẫn bật cờ token (chỉ lý do VA kiểm tài khoản mặc định)', async () => {
    const org = await newOrg('CLB Bóng đá trong nhà');
    const otherId = await addAccount(org, nextAccount);
    const sale = await newSale(org);
    const token = await reauthToken(h, org.owner);
    afterNextLink = async () => {
      await setDefault(org, otherId, token);
    };
    const placed = await placePaid(sale, '1033');
    expect(placed.order).toMatchObject({ buyerStatus: 'expired', payment: { linkError: 'sales_paused' } });
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason: 'token' });
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toHaveLength(1);
    await expectInvariants(h, sale.eventId);
  });

  it('Owner đổi key trong lúc create-link bằng key cũ đang chờ (key cũ trả 97) → Đơn sales_paused, cờ không đổi', async () => {
    const org = await newOrg('CLB Bơi');
    const sale = await newSale(org);
    afterNextLink = async () => {
      // Như `replaceKey` (2.13-b) commit trước transaction bù: credential và tài khoản cũ gỡ mềm, key mới hiện hành.
      await h.db.orm.execute(
        sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${org.orgId}`,
      );
      await h.db.orm.execute(sql`UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = ${org.orgId}`);
      await linkPayoutAccount(org, NEXT, payoutOf(nextAccount));
    };
    const placed = await placePaid(sale, '97');
    expect(placed.order).toMatchObject({ buyerStatus: 'expired', payment: { linkError: 'sales_paused' } });
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'active' });
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toEqual([]);
    expect(h.logs.lines.find((l) => l.organizationId === org.orgId && l.result === 'stale_credential')).toBeDefined();
    await expectInvariants(h, sale.eventId);
  });
});

describe('BTC đang bị ngắt', () => {
  it('TX1 từ chối Hạng vé có phí như "Tạm ngừng bán", Hạng vé 0đ vẫn đặt được; "Thử lại" Đơn đang chờ → expired sales_paused, không gọi Tingee', async () => {
    const org = await newOrg('CLB Cầu lông Quận 10');
    const sale = await newSale(org);
    // Đơn chờ thử lại (Tingee từ chối bằng mã thường) từ trước khi BTC bị ngắt.
    const waiting = await placePaid(sale, '1006');
    expect(waiting.order).toMatchObject({ buyerStatus: 'awaiting_payment', payment: { linkError: 'provider_error' } });
    await suspendVia(org, '1034');
    const linkCalls = fake.calls(CREATE_LINK_PATH).length;

    const buyer = await signUp(h);
    const paid = await postOrder(h, buyer, sale.slug, orderBody([{ ticketTypeId: sale.paidTier, quantity: 1 }]));
    expect(paid.status).toBe(409);
    expect(errorOf(paid)).toMatchObject({ code: 'NOT_ON_SALE', details: { ticketTypeId: sale.paidTier, reason: 'paused' } });
    const free = await postOrder(h, buyer, sale.slug, orderBody([{ ticketTypeId: sale.freeTier, quantity: 2 }])).expect(201);
    expect(parseOrder(free.body).buyerStatus).toBe('paid');

    // AC: chốt E3-2 (`sellability`) hết hạn Đơn, không gọi Tingee.
    const retried = await h.http.post(`/v1/me/orders/${waiting.code}/payment-link`).set('cookie', waiting.buyer.cookie).send();
    expect(retried.status).toBe(200);
    expect(parseOrder(retried.body)).toMatchObject({
      buyerStatus: 'expired',
      payment: { checkoutUrl: null, linkError: 'sales_paused' },
    });
    expect(fake.calls(CREATE_LINK_PATH)).toHaveLength(linkCalls);
    await expectInvariants(h, sale.eventId);
  });

  it('tổng quan Tài khoản nhận tiền kèm PaymentServiceState', async () => {
    const org = await newOrg('CLB Bóng chuyền');
    const res = await h.http.get(`/v1/orgs/${org.orgId}/payout-account`).set('cookie', org.owner.cookie).expect(200);
    expect(PayoutAccountOverview.parse(res.body).paymentService).toEqual({
      status: 'active',
      reason: null,
      since: null,
      checkedAt: null,
    });
    await suspendVia(org, '1033');
    const flag = await paymentServiceOf(h, org.orgId);
    const after = await h.http.get(`/v1/orgs/${org.orgId}/payout-account`).set('cookie', org.owner.cookie).expect(200);
    expect(PayoutAccountOverview.parse(after.body).paymentService).toEqual({
      status: 'suspended',
      reason: 'token',
      since: flag.since!.toISOString(),
      checkedAt: null,
    });
  });
});

describe('dò dịch vụ', () => {
  it('job dò: get-va-paging thành công → cờ active; job "đã mở lại"; Đối soát bù tại giờ DB cho Đơn có link pending và expired trong 24 giờ; notices hết mã', async () => {
    const org = await newOrg('CLB Pickleball Thủ Đức');
    const ipnKey = await ipnKeyOf(h, org.orgId);
    const sale = await newSale(org);
    const pending = await placePaid(sale);
    expect(pending.order.payment?.checkoutUrl).toEqual(expect.any(String));
    const expiredRecent = await placePaid(sale);
    const expiredHoursAgo = await placePaid(sale);
    const expiredOld = await placePaid(sale);
    for (const placed of [expiredRecent, expiredHoursAgo, expiredOld]) {
      const ipn = signIpn(MAIN.secretToken, fakeStatusIpnPayload(placed.code, PRICE, 'expired'));
      await postIpn(h, ipnKey, ipn).expect(200);
      expect((await orderState(h, placed.code)).status).toBe('expired');
    }
    // Trong cửa sổ 24 giờ (đã quá hạn link) và ngoài cửa sổ.
    await h.db.orm.execute(
      sql`UPDATE orders SET expires_at = now() - interval '3 hours' WHERE id = ${expiredHoursAgo.orderId}`,
    );
    await h.db.orm.execute(sql`UPDATE orders SET expires_at = now() - interval '25 hours' WHERE id = ${expiredOld.orderId}`);
    const noLink = await placePaid(sale, '1006');
    const { placed: suspendedOrder } = await suspendVia(org, '1033');

    const outcomes = await probeWorker.probeSuspended();
    expect(outcomes.get(org.orgId)).toBe('resumed');
    const flag = await paymentServiceOf(h, org.orgId);
    expect(flag).toMatchObject({ status: 'active', reason: null, since: null });
    expect(flag.checked_at).toBeInstanceOf(Date);
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([
      {
        actor_user_id: null,
        target_type: 'payment_service_resume',
        target_id: 'probe',
        changed_fields: ['payment_service_status', 'payment_service_reason', 'payment_service_since'],
      },
    ]);
    await expect.poll(() => statusSignalsOf(org.orgId).length).toBe(2);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
    expect(await noticeCodes(org.owner.cookie, org.orgId)).toEqual([]);
    expect((await availability(sale.slug)).tiers.map((t) => t.status)).toEqual(['on_sale', 'on_sale']);

    // Worker của `payment` nhận job "đã mở lại".
    const { checkAt, orderIds } = await resumedWorker.reconcileOpenOrders(org.orgId);
    expect(orderIds).toEqual([pending.orderId, expiredRecent.orderId, expiredHoursAgo.orderId]);
    expect(Math.abs(checkAt.getTime() - Date.now())).toBeLessThan(30_000);
    for (const orderId of orderIds) {
      const jobs = await boss.findJobs(JobQueue.PAYMENT_RECONCILE_ORDER, { data: { orderId } });
      expect(jobs.find((job) => job.id === reconcileJobId(orderId, checkAt))).toMatchObject({
        data: { orderId, failures: 0 },
        startAfter: checkAt,
      });
    }
    for (const placed of [expiredOld, noLink, suspendedOrder]) {
      const jobs = await boss.findJobs(JobQueue.PAYMENT_RECONCILE_ORDER, { data: { orderId: placed.orderId } });
      expect(jobs.find((job) => job.id === reconcileJobId(placed.orderId, checkAt))).toBeUndefined();
    }
    await expectInvariants(h, sale.eventId);
  });

  it('Tingee nhận key nhưng lý do vừa đổi sang payout_account_not_allowed trong lúc dò → không mở lại (CAS kèm lý do lúc giành lượt), skipped', async () => {
    const org = await newOrg('CLB Bóng đá bãi biển');
    await suspendVia(org, '1033');
    afterNextProbe = async () => {
      // Như create-link của một Đơn đang bay bị Tingee từ chối VA (đổi lý do của BTC đang `suspended`).
      await h.db.orm.execute(
        sql`UPDATE organizations SET payment_service_reason = 'payout_account_not_allowed' WHERE id = ${org.orgId}`,
      );
    };
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('skipped');
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({
      status: 'suspended',
      reason: 'payout_account_not_allowed',
    });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);
    expect(await resumedJobsOf(org.orgId)).toEqual([]);
  });

  it('vẫn ngắt mã khác → đổi lý do (giữ since); cùng mã → giữ; timeout / HTTP 500 → giữ cờ; checked_at cập nhật; trong 30 giây không dò lại', async () => {
    const org = await newOrg('CLB Đua xe đạp');
    await suspendVia(org, '1033');
    const before = await paymentServiceOf(h, org.orgId);

    fake.merchant(MAIN.clientId).accountReplies = [{ code: '1034' }];
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('reason_changed');
    const changed = await paymentServiceOf(h, org.orgId);
    expect(changed).toMatchObject({ status: 'suspended', reason: 'tingee_disabled', since: before.since });
    expect(changed.checked_at).toBeInstanceOf(Date);
    expect(await auditRows(org.orgId, 'organization.payment_service_reason_changed')).toEqual([
      { actor_user_id: null, target_type: 'payment_service_reason', target_id: 'tingee_disabled', changed_fields: ['payment_service_reason'] },
    ]);
    expect(await noticeCodes(org.owner.cookie, org.orgId)).toEqual(['PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED']);

    // Trong 30 giây: không gọi Tingee.
    fake.merchant(MAIN.clientId).accountReplies = [];
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('skipped');
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(1);

    const cases: [string, FakeLinkReply, string][] = [
      ['cùng mã', { code: '1007' }, 'still_suspended'],
      ['HTTP 500', { code: '500', httpStatus: 500 }, 'unknown'],
      ['treo quá timeout', 'hang', 'unknown'],
    ];
    let last = changed.checked_at!;
    for (const [label, reply, outcome] of cases) {
      await ageLastCheck(org.orgId);
      fake.merchant(MAIN.clientId).accountReplies = [reply];
      expect(await prober.probe(org.orgId, 'probe', null), label).toBe(outcome);
      const flag = await paymentServiceOf(h, org.orgId);
      expect(flag, label).toMatchObject({ status: 'suspended', reason: 'tingee_disabled', since: before.since });
      expect(flag.checked_at!.getTime(), label).toBeGreaterThan(last.getTime() - 31_000);
      last = flag.checked_at!;
    }
    expect(await auditRows(org.orgId, 'organization.payment_service_reason_changed')).toHaveLength(1);
    expect(await resumedJobsOf(org.orgId)).toEqual([]);
    expect(h.logs.text).not.toContain(MAIN.secretToken);
  });

  it('BTC không còn tài khoản mặc định → giữ cờ, chỉ log, không gọi Tingee', async () => {
    const org = await newOrg('CLB Leo núi');
    await suspendVia(org, '97');
    await h.db.orm.execute(sql`UPDATE payout_accounts SET is_default = false WHERE organization_id = ${org.orgId}`);
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('no_target');
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason: 'credential_invalid' });
    expect(fake.calls(ACCOUNTS_PATH)).toEqual([]);
  });

  it('không giải mã được key → unknown, giữ cờ, không gọi Tingee; "Kiểm tra lại" vẫn 200 với trạng thái hiện tại', async () => {
    const org = await newOrg('CLB Lặn');
    await suspendVia(org, '1033');
    const broken = 'v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA';
    await h.db.orm.execute(
      sql`UPDATE tingee_credentials SET secret_token_ciphertext = ${broken} WHERE organization_id = ${org.orgId}`,
    );
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('unknown');
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason: 'token' });
    expect(h.logs.lines.find((l) => l.organizationId === org.orgId && l.error === 'SecretBoxError')).toBeDefined();

    await ageLastCheck(org.orgId);
    expect(await checkResult(org)).toMatchObject({
      state: { status: 'suspended', reason: 'token' },
      outcome: 'unknown',
      retryAfterSeconds: null,
    });
    expect(fake.calls(ACCOUNTS_PATH)).toEqual([]);
    expect(h.logs.text).not.toContain(broken);
  });

  it('job dò: lỗi ở một BTC chỉ log, BTC kế vẫn được dò và mở lại', async () => {
    const failing = await newOrg('CLB Lỗi dò');
    const healthy = await newOrg('CLB Dò được');
    await suspendVia(failing, '1033');
    await suspendVia(healthy, '1033');
    const stub = {
      probe: (organizationId: string, path: 'probe', actorUserId: null) =>
        organizationId === failing.orgId
          ? Promise.reject(Object.assign(new Error('giả lập DB lỗi'), { name: 'DatabaseError' }))
          : prober.probe(organizationId, path, actorUserId),
    } as unknown as PaymentServiceProber;
    const worker = new PaymentServiceProbeWorker(h.app.get<Database>(DATABASE), boss, stub);
    const outcomes = await worker.probeSuspended();
    expect(outcomes.get(failing.orgId)).toBe('error');
    expect(outcomes.get(healthy.orgId)).toBe('resumed');
    expect(await paymentServiceOf(h, failing.orgId)).toMatchObject({ status: 'suspended' });
    expect(await paymentServiceOf(h, healthy.orgId)).toMatchObject({ status: 'active' });
    expect(
      h.logs.lines.find(
        (l) => l.organizationId === failing.orgId && l.msg === 'Dò dịch vụ thanh toán lỗi; lần chạy sau dò lại',
      ),
    ).toMatchObject({ level: 40, error: 'Error' });
  });

  it('dò không bao giờ bật cờ: Quản trị mở lại trong lúc dò, Tingee vẫn báo ngắt → skipped, cờ giữ active; lần ngắt mới xóa checked_at cũ', async () => {
    const org = await newOrg('CLB Thể dục dụng cụ');
    await suspendVia(org, '1033');
    fake.merchant(MAIN.clientId).accountReplies = [{ code: '1034' }];
    afterNextProbe = async () => {
      await h.http
        .post(`/v1/admin/organizations/${org.orgId}/payment-service/resume`)
        .set('cookie', platformAdmin.cookie)
        .expect(204);
    };
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('skipped');
    const flag = await paymentServiceOf(h, org.orgId);
    expect(flag).toMatchObject({ status: 'active', reason: null, since: null });
    expect(flag.checked_at).toBeInstanceOf(Date);
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toHaveLength(1);
    expect(await auditRows(org.orgId, 'organization.payment_service_reason_changed')).toEqual([]);

    // Lần ngắt mới không mang thời gian chờ của lần dò trước: "Kiểm tra lại" đầu tiên gọi Tingee ngay.
    await suspendVia(org, '1033');
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', checked_at: null });
    fake.merchant(MAIN.clientId).accountReplies = [{ code: '1033' }];
    const before = fake.calls(ACCOUNTS_PATH).length;
    expect(await checkResult(org)).toMatchObject({ state: { status: 'suspended' }, outcome: 'still_suspended' });
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(before + 1);
  });

  it('Key thiếu quyền Cổng thanh toán (1133): cờ gateway_permission_missing; job dò bỏ qua BTC này (không gọi Tingee, cờ giữ)', async () => {
    const org = await newOrg('CLB Bóng ném');
    const { sale } = await suspendVia(org, '1133');
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({
      status: 'suspended',
      reason: 'gateway_permission_missing',
      checked_at: null,
    });
    expect(await noticeCodes(org.owner.cookie, org.orgId)).toEqual(['PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING']);

    const outcomes = await probeWorker.probeSuspended();
    expect(outcomes.has(org.orgId)).toBe(false);
    const calls = fake.calls(ACCOUNTS_PATH).length;
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('skipped');
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(calls);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({
      status: 'suspended',
      reason: 'gateway_permission_missing',
      checked_at: null,
    });
    await expectInvariants(h, sale.eventId);
  });

  it('Owner báo đã cấp quyền (gateway_permission_missing): "Kiểm tra lại" → active (owner_check), không gọi Tingee, Đối soát bù; trong 30 giây sau lần trước → trạng thái hiện tại', async () => {
    const org = await newOrg('CLB Bóng bầu dục');
    await suspendVia(org, '1133');
    // Lần trước vừa xong (vd. Owner bấm hai lần liên tiếp).
    await h.db.orm.execute(sql`UPDATE organizations SET payment_service_checked_at = now() WHERE id = ${org.orgId}`);
    const calls = fake.calls(ACCOUNTS_PATH).length;

    // Trong 30 giây: trả trạng thái hiện tại, không mở lại.
    expect(await checkResult(org)).toMatchObject({
      state: { status: 'suspended', reason: 'gateway_permission_missing', checkedAt: expect.any(String) },
      outcome: 'cooldown',
      retryAfterSeconds: expect.any(Number),
    });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);

    await ageLastCheck(org.orgId);
    const resumed = await checkResult(org);
    expect(resumed).toMatchObject({ state: { status: 'active', reason: null, since: null }, outcome: 'resumed' });
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(calls);
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'owner_check' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
  });

  it('gateway_permission_missing: lý do đổi sau lúc giành lượt → không mở lại (CAS kèm lý do), skipped', async () => {
    const org = await newOrg('CLB Cầu mây');
    await suspendVia(org, '1133');
    const ready = PaymentServiceQueues.prototype.ready;
    // Chen giữa lúc giành lượt và lúc tắt cờ (ngay trước transaction): lý do vừa đổi sang hết Token.
    const spy = vi.spyOn(PaymentServiceQueues.prototype, 'ready');
    spy.mockImplementationOnce(async function (this: PaymentServiceQueues) {
      await h.db.orm.execute(sql`UPDATE organizations SET payment_service_reason = 'token' WHERE id = ${org.orgId}`);
      return ready.call(this);
    });
    try {
      expect(await prober.probe(org.orgId, 'owner_check', org.owner.userId)).toBe('skipped');
    } finally {
      spy.mockRestore();
    }
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason: 'token' });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);
    expect(await resumedJobsOf(org.orgId)).toEqual([]);
    expect(fake.calls(ACCOUNTS_PATH)).toEqual([]);
  });

  it('Owner đổi key trong lúc dò (Tingee vẫn báo ngắt bằng key cũ) → skipped, lý do giữ, không audit', async () => {
    const org = await newOrg('CLB Bơi nghệ thuật');
    await suspendVia(org, '1033');
    fake.merchant(MAIN.clientId).accountReplies = [{ code: '1034' }];
    afterNextProbe = async () => {
      await h.db.orm.execute(
        sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${org.orgId}`,
      );
      await h.db.orm.execute(sql`UPDATE tingee_credentials SET retired_at = now() WHERE organization_id = ${org.orgId}`);
      await linkPayoutAccount(org, NEXT, payoutOf(nextAccount));
    };
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('skipped');
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason: 'token' });
    expect(await auditRows(org.orgId, 'organization.payment_service_reason_changed')).toEqual([]);
    expect(h.logs.lines.find((l) => l.organizationId === org.orgId && l.result === 'stale_credential')).toBeDefined();
  });

  it('"Kiểm tra lại": BTC active → trả trạng thái, không gọi Tingee; Admin → 403; Owner gọi 2 lần trong 30 giây → lần 2 không gọi Tingee; dịch vụ về → active', async () => {
    const org = await newOrg('CLB Golf');
    const admin = await addAdmin(org);
    expect(await checkResult(org)).toEqual({
      state: { status: 'active', reason: null, since: null, checkedAt: null },
      outcome: 'not_suspended',
      retryAfterSeconds: null,
    });
    const forbidden = await check(org, admin.cookie);
    expect(forbidden.status).toBe(403);
    expect(errorOf(forbidden).code).toBe('FORBIDDEN_ROLE');
    expect(fake.calls(ACCOUNTS_PATH)).toEqual([]);

    await suspendVia(org, '1033');
    // Lần dò thấy 1133: dò bằng `get-va-paging` coi mọi mã key sai là `credential_invalid` (không phải
    // `gateway_permission_missing`, lý do mà job dò bỏ qua); đổi lý do do Owner bấm → audit ghi Owner.
    fake.merchant(MAIN.clientId).accountReplies = [{ code: '1133' }, { code: '1133' }];
    const first = await checkResult(org);
    // Đổi lý do gộp vào `still_suspended`.
    expect(first).toMatchObject({
      state: { status: 'suspended', reason: 'credential_invalid', checkedAt: expect.any(String) },
      outcome: 'still_suspended',
      retryAfterSeconds: null,
    });
    expect(await auditRows(org.orgId, 'organization.payment_service_reason_changed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'credential_invalid' },
    ]);
    const second = await checkResult(org);
    expect(second.state).toEqual(first.state);
    expect(second.outcome).toBe('cooldown');
    expect(second.retryAfterSeconds).toBeGreaterThanOrEqual(25);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(1);

    await ageLastCheck(org.orgId);
    fake.merchant(MAIN.clientId).accountReplies = [];
    const resumed = await checkResult(org);
    expect(resumed).toMatchObject({
      state: { status: 'active', reason: null, since: null, checkedAt: expect.any(String) },
      outcome: 'resumed',
      retryAfterSeconds: null,
    });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'owner_check' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
  });

  it('"Kiểm tra lại" trả outcome theo từng nhánh (Story 4.2-b): still_suspended, cooldown kèm số giây còn chờ theo đồng hồ DB, unknown, no_target, resumed, rồi not_suspended', async () => {
    const org = await newOrg('CLB Khúc côn cầu');
    await suspendVia(org, '1033');

    fake.merchant(MAIN.clientId).accountReplies = [{ code: '1033' }];
    expect(await checkResult(org)).toEqual({
      state: expect.objectContaining({ status: 'suspended', reason: 'token' }),
      outcome: 'still_suspended',
      retryAfterSeconds: null,
    });

    // Lần trước cách đây 18 giây → còn 12 giây (11 nếu lần chạy chậm); không gọi Tingee.
    await h.db.orm.execute(
      sql`UPDATE organizations SET payment_service_checked_at = now() - interval '18 seconds' WHERE id = ${org.orgId}`,
    );
    const calls = fake.calls(ACCOUNTS_PATH).length;
    const cooling = await checkResult(org);
    expect(cooling).toMatchObject({ state: { status: 'suspended' }, outcome: 'cooldown' });
    expect([11, 12]).toContain(cooling.retryAfterSeconds);
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(calls);

    await ageLastCheck(org.orgId);
    fake.merchant(MAIN.clientId).accountReplies = [{ code: '500', httpStatus: 500 }];
    expect(await checkResult(org)).toMatchObject({ state: { status: 'suspended' }, outcome: 'unknown', retryAfterSeconds: null });

    await ageLastCheck(org.orgId);
    await h.db.orm.execute(sql`UPDATE payout_accounts SET is_default = false WHERE organization_id = ${org.orgId}`);
    expect(await checkResult(org)).toMatchObject({ state: { status: 'suspended' }, outcome: 'no_target', retryAfterSeconds: null });
    await h.db.orm.execute(sql`UPDATE payout_accounts SET is_default = true WHERE organization_id = ${org.orgId}`);

    await ageLastCheck(org.orgId);
    fake.merchant(MAIN.clientId).accountReplies = [];
    expect(await checkResult(org)).toMatchObject({ state: { status: 'active' }, outcome: 'resumed', retryAfterSeconds: null });
    expect(await checkResult(org)).toMatchObject({ state: { status: 'active' }, outcome: 'not_suspended', retryAfterSeconds: null });
  });

  it('"Kiểm tra lại" khi lần dò trả skipped mà BTC vẫn ngắt: checked_at NULL (vừa bị ngắt lại) → unknown; đã có lần dò mà hết chờ ngay mốc 30 giây → cooldown 1 giây', async () => {
    const org = await newOrg('CLB Bóng gậy');
    const spy = vi.spyOn(prober, 'probe');
    try {
      spy.mockImplementationOnce(async () => {
        await h.db.orm.execute(sql`
          UPDATE organizations
             SET payment_service_status = 'suspended', payment_service_reason = 'token', payment_service_since = now(),
                 payment_service_checked_at = NULL
           WHERE id = ${org.orgId}`);
        return 'skipped';
      });
      expect(await checkResult(org)).toEqual({
        state: expect.objectContaining({ status: 'suspended', checkedAt: null }),
        outcome: 'unknown',
        retryAfterSeconds: null,
      });

      // Giành lượt thất bại vì còn chờ, nhưng lúc đọc lại thì thời gian chờ vừa hết.
      spy.mockImplementationOnce(async () => {
        await h.db.orm.execute(
          sql`UPDATE organizations SET payment_service_checked_at = now() - interval '31 seconds' WHERE id = ${org.orgId}`,
        );
        return 'skipped';
      });
      expect(await checkResult(org)).toEqual({
        state: expect.objectContaining({ status: 'suspended', checkedAt: expect.any(String) }),
        outcome: 'cooldown',
        retryAfterSeconds: 1,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('"Kiểm tra lại": Quản trị mở lại trong lúc gọi Tingee (Tingee vẫn báo ngắt) → not_suspended với trạng thái active', async () => {
    const org = await newOrg('CLB Đấu kiếm');
    await suspendVia(org, '1033');
    fake.merchant(MAIN.clientId).accountReplies = [{ code: '1033' }];
    afterNextProbe = async () => {
      await h.http
        .post(`/v1/admin/organizations/${org.orgId}/payment-service/resume`)
        .set('cookie', platformAdmin.cookie)
        .expect(204);
    };
    expect(await checkResult(org)).toEqual({
      state: expect.objectContaining({ status: 'active', reason: null }),
      outcome: 'not_suspended',
      retryAfterSeconds: null,
    });
  });
});

describe('Tingee từ chối VA của tài khoản mặc định (Story 4.2-d)', () => {
  it('job dò bỏ qua BTC có lý do payout_account_not_allowed: không gọi Tingee, cờ giữ, checked_at không đổi', async () => {
    const { org } = await newRejectedVaOrg('CLB Bóng chày');
    const { sale } = await suspendViaRejectedVa(org);

    // BTC bị ngắt của test khác vẫn được dò: chỉ kiểm BTC này không có trong lượt và lần dò lẻ không gọi Tingee.
    const outcomes = await probeWorker.probeSuspended();
    expect(outcomes.has(org.orgId)).toBe(false);
    const calls = fake.calls(ACCOUNTS_PATH).length;
    expect(await prober.probe(org.orgId, 'probe', null)).toBe('skipped');
    expect(fake.calls(ACCOUNTS_PATH)).toHaveLength(calls);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({
      status: 'suspended',
      reason: 'payout_account_not_allowed',
      checked_at: null,
    });
    await expectInvariants(h, sale.eventId);
  });

  it('"Kiểm tra lại" của Owner: trong 30 giây → cooldown; quá 30 giây → active (owner_check), không gọi Tingee, Đối soát bù; VA vẫn bị từ chối → Đơn kế tiếp bật cờ lại', async () => {
    const { org } = await newRejectedVaOrg('CLB Bóng bàn');
    const { sale } = await suspendViaRejectedVa(org);
    await h.db.orm.execute(sql`UPDATE organizations SET payment_service_checked_at = now() WHERE id = ${org.orgId}`);

    expect(await checkResult(org)).toMatchObject({
      state: { status: 'suspended', reason: 'payout_account_not_allowed', checkedAt: expect.any(String) },
      outcome: 'cooldown',
      retryAfterSeconds: expect.any(Number),
    });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);

    await ageLastCheck(org.orgId);
    expect(await checkResult(org)).toMatchObject({
      state: { status: 'active', reason: null, since: null },
      outcome: 'resumed',
    });
    expect(fake.calls(ACCOUNTS_PATH)).toEqual([]);
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_type: 'payment_service_resume', target_id: 'owner_check' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
    expect(await noticeCodes(org.owner.cookie, org.orgId)).toEqual([]);

    // Owner chưa cho phép VA thật: lần bán kế tiếp bị từ chối lại và bật cờ mới (không mang lần kiểm tra cũ).
    await suspendViaRejectedVa(org);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({
      status: 'suspended',
      reason: 'payout_account_not_allowed',
      checked_at: null,
    });
    expect(await auditRows(org.orgId, 'organization.payment_service_suspended')).toHaveLength(2);
    await expectInvariants(h, sale.eventId);
  });

  it('"Kiểm tra lại": lý do đổi sau lúc giành lượt → không mở lại (CAS kèm lý do), skipped', async () => {
    const { org } = await newRejectedVaOrg('CLB Đá cầu');
    await suspendViaRejectedVa(org);
    const ready = PaymentServiceQueues.prototype.ready;
    const spy = vi.spyOn(PaymentServiceQueues.prototype, 'ready');
    spy.mockImplementationOnce(async function (this: PaymentServiceQueues) {
      await h.db.orm.execute(sql`UPDATE organizations SET payment_service_reason = 'token' WHERE id = ${org.orgId}`);
      return ready.call(this);
    });
    try {
      expect(await prober.probe(org.orgId, 'owner_check', org.owner.userId)).toBe('skipped');
    } finally {
      spy.mockRestore();
    }
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason: 'token' });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);
    expect(await resumedJobsOf(org.orgId)).toEqual([]);
  });

  it('đặt tài khoản đang là mặc định → cờ giữ; đặt tài khoản khác làm mặc định → active (default_changed, actor Owner) cùng transaction, Đối soát bù; Đơn kế tiếp tạo link bằng VA mới', async () => {
    const { org, rejectedId, validId } = await newRejectedVaOrg('CLB Quần vợt', true);
    const { sale } = await suspendViaRejectedVa(org);

    // Đã là mặc định: không đổi gì.
    const same = await setDefault(org, rejectedId);
    expect(same.paymentService).toMatchObject({ status: 'suspended', reason: 'payout_account_not_allowed' });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);

    const overview = await setDefault(org, validId!);
    expect(overview.paymentService).toEqual({ status: 'active', reason: null, since: null, checkedAt: null });
    expect(overview.accounts.find((a) => a.id === validId)?.isDefault).toBe(true);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'active', reason: null, since: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([
      {
        actor_user_id: org.owner.userId,
        target_type: 'payment_service_resume',
        target_id: 'default_changed',
        changed_fields: ['payment_service_status', 'payment_service_reason', 'payment_service_since'],
      },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
    await expect.poll(() => statusSignalsOf(org.orgId).length).toBe(2);
    expect(await noticeCodes(org.owner.cookie, org.orgId)).toEqual([]);
    expect((await availability(sale.slug)).tiers.map((t) => t.status)).toEqual(['on_sale', 'on_sale']);
    // Không gọi Tingee khi đổi mặc định.
    expect(fake.calls(ACCOUNTS_PATH)).toEqual([]);

    const next = await placePaid(sale);
    expect(next.order.payment?.checkoutUrl).toEqual(expect.any(String));
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'active' });
    await expectInvariants(h, sale.eventId);
  });

  it('hủy tài khoản mặc định (còn tài khoản khác) → tài khoản còn lại thành mặc định, cờ active (default_changed)', async () => {
    const { org, rejectedId, validId } = await newRejectedVaOrg('CLB Bơi thuyền', true);
    const { sale } = await suspendViaRejectedVa(org);
    const overview = await unlink(org, rejectedId);
    expect(overview.accounts.map((a) => [a.id, a.isDefault])).toEqual([[validId, true]]);
    expect(overview.paymentService).toMatchObject({ status: 'active', reason: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'default_changed' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
    await expectInvariants(h, sale.eventId);
  });

  it('hủy tài khoản mặc định cuối cùng → cờ active (default_changed); "Chưa liên kết tài khoản nhận tiền" chặn bán thay', async () => {
    const { org, rejectedId } = await newRejectedVaOrg('CLB Chèo thuyền');
    const { sale } = await suspendViaRejectedVa(org);
    const overview = await unlink(org, rejectedId);
    expect(overview.accounts).toEqual([]);
    expect(overview.paymentService).toMatchObject({ status: 'active', reason: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'default_changed' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
    expect(await noticeCodes(org.owner.cookie, org.orgId)).toEqual(['PAYOUT_ACCOUNT_NOT_LINKED']);
    expect((await availability(sale.slug)).tiers.map((t) => t.status)).toEqual(['paused', 'on_sale']);
    await expectInvariants(h, sale.eventId);
  });

  it('hủy tài khoản không phải mặc định → cờ giữ', async () => {
    const { org, validId } = await newRejectedVaOrg('CLB Lướt sóng', true);
    await suspendViaRejectedVa(org);
    await unlink(org, validId!);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({
      status: 'suspended',
      reason: 'payout_account_not_allowed',
    });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);
    expect(await resumedJobsOf(org.orgId)).toEqual([]);
  });

  it.each([
    ['token', '1033'],
    ['gateway_permission_missing', '1133'],
    ['credential_invalid', '97'],
  ])('lý do khác (%s): đặt tài khoản khác làm mặc định, rồi hủy tài khoản mặc định → cờ giữ', async (reason, code) => {
    const org = await newOrg(`CLB Đổi mặc định ${code}`);
    const otherId = await addAccount(org, nextAccount);
    await suspendVia(org, code);
    await setDefault(org, otherId);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason });
    await unlink(org, otherId);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended', reason });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);
    expect(await resumedJobsOf(org.orgId)).toEqual([]);
  });
});

describe('Quản trị Tingee', () => {
  const list = (cookie = platformAdmin.cookie) =>
    h.http.get('/v1/admin/organizations/payment-service/suspended').set('cookie', cookie);
  const resume = (id: string, cookie = platformAdmin.cookie) =>
    h.http.post(`/v1/admin/organizations/${id}/payment-service/resume`).set('cookie', cookie);

  it('danh sách BTC suspended (id, tên, lý do, since, checkedAt; no-store; audit đọc); mở lại → 204, cờ active, job "đã mở lại"; lần nữa → 409', async () => {
    const org = await newOrg('CLB Bắn cung');
    await suspendVia(org, '1007');
    const flag = await paymentServiceOf(h, org.orgId);

    const res = await list().expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = SuspendedPaymentServiceOrganizationList.parse(res.body);
    expect(rows.find((r) => r.id === org.orgId)).toEqual({
      id: org.orgId,
      name: 'CLB Bắn cung',
      reason: 'tingee_disabled',
      since: flag.since!.toISOString(),
      checkedAt: null,
    });
    expect(rows.every((r) => Object.keys(r).sort().join() === 'checkedAt,id,name,reason,since')).toBe(true);
    const { rows: reads } = await h.db.pool.query(
      `SELECT 1 FROM audit_events WHERE action = 'platform_admin.read' AND actor_user_id = $1
          AND target_type = 'payment_service_suspended'`,
      [platformAdmin.userId],
    );
    expect(reads.length).toBeGreaterThan(0);

    await resume(org.orgId).expect(204);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'active', reason: null, since: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: platformAdmin.userId, target_id: 'platform_admin' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
    expect(SuspendedPaymentServiceOrganizationList.parse((await list().expect(200)).body).map((r) => r.id)).not.toContain(
      org.orgId,
    );

    // Ngắt lâu nhất trước.
    const older = await newOrg('CLB Ngắt trước');
    const newer = await newOrg('CLB Ngắt sau');
    await suspendVia(newer, '1033');
    await suspendVia(older, '1033');
    await h.db.orm.execute(
      sql`UPDATE organizations SET payment_service_since = now() - interval '2 hours' WHERE id = ${older.orgId}`,
    );
    await h.db.orm.execute(
      sql`UPDATE organizations SET payment_service_since = now() - interval '1 hour' WHERE id = ${newer.orgId}`,
    );
    const ordered = SuspendedPaymentServiceOrganizationList.parse((await list().expect(200)).body).map((r) => r.id);
    expect(ordered.indexOf(older.orgId)).toBeGreaterThanOrEqual(0);
    expect(ordered.indexOf(older.orgId)).toBeLessThan(ordered.indexOf(newer.orgId));

    const again = await resume(org.orgId);
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('PAYMENT_SERVICE_NOT_SUSPENDED');
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
  });

  it('id lạ hoặc sai dạng → 404; tài khoản thường (kể cả Owner) → 403 FORBIDDEN_ROLE', async () => {
    for (const id of [randomUUID(), 'khong-phai-uuid']) {
      const res = await resume(id);
      expect(res.status, id).toBe(404);
      expect(errorOf(res).code).toBe('NOT_FOUND');
    }
    const org = await newOrg('CLB Đấu kiếm');
    await suspendVia(org, '1033');
    for (const res of [await list(org.owner.cookie), await resume(org.orgId, org.owner.cookie)]) {
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('FORBIDDEN_ROLE');
    }
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'suspended' });
  });
});

describe('lưu key mới (2.13-b)', () => {
  async function replace(org: Org, key: TingeeCredential, account: FakeAccount): Promise<Response> {
    const token = await reauthToken(h, org.owner);
    return h.http
      .post(`/v1/orgs/${org.orgId}/payout-account/credential/replacement`)
      .set('cookie', org.owner.cookie)
      .set(REAUTH_HEADER, token)
      .send({ ...key, vaAccountNumber: String(account.vaAccountNumber) });
  }

  it('lý do credential_invalid → key mới hợp lệ tắt cờ cùng transaction thay key (audit new_key, job "đã mở lại")', async () => {
    const org = await newOrg('CLB Karate');
    await suspendVia(org, '97');
    const res = await replace(org, NEXT, nextAccount);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(PayoutAccountOverview.parse(res.body).paymentService).toMatchObject({ status: 'active', reason: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'new_key' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
  });

  it('lý do gateway_permission_missing → key mới hợp lệ cũng tắt cờ (new_key)', async () => {
    const org = await newOrg('CLB Aikido');
    await suspendVia(org, '1133');
    const res = await replace(org, NEXT, nextAccount);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(PayoutAccountOverview.parse(res.body).paymentService).toMatchObject({ status: 'active', reason: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'new_key' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
  });

  it('lý do payout_account_not_allowed (Story 4.2-d) → key mới hợp lệ cũng tắt cờ (new_key)', async () => {
    const { org } = await newRejectedVaOrg('CLB Kendo');
    await suspendViaRejectedVa(org);
    const res = await replace(org, NEXT, nextAccount);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(PayoutAccountOverview.parse(res.body).paymentService).toMatchObject({ status: 'active', reason: null });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([
      { actor_user_id: org.owner.userId, target_id: 'new_key' },
    ]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
  });

  it('lý do token → key mới không chữa được: cờ giữ', async () => {
    const org = await newOrg('CLB Judo');
    await suspendVia(org, '1033');
    const res = await replace(org, NEXT, nextAccount);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(PayoutAccountOverview.parse(res.body).paymentService).toMatchObject({ status: 'suspended', reason: 'token' });
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toEqual([]);
    expect(await resumedJobsOf(org.orgId)).toEqual([]);
  });
});

describe('hai đường mở lại cùng lúc', () => {
  it('dò và Quản trị cùng tắt → một lần đổi cờ, một audit, một job "đã mở lại"; bên thua CAS không làm gì', async () => {
    const org = await newOrg('CLB Vovinam');
    await suspendVia(org, '1034');
    await h.app.get(PaymentServiceQueues).ready();

    let started!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = h.db.transaction(async (tx) => {
      const changed = await resumePaymentService(boss, tx, { organizationId: org.orgId, path: 'probe', actorUserId: null });
      started();
      await gate;
      return changed;
    });
    await holding;
    // Bên thứ hai chờ khóa dòng BTC tới khi bên thứ nhất commit, rồi thấy BTC đã `active`.
    const second = h.db.transaction((tx) =>
      resumePaymentService(boss, tx, { organizationId: org.orgId, path: 'platform_admin', actorUserId: platformAdmin.userId }),
    );
    await sleep(200);
    release();
    expect(await Promise.all([first, second])).toEqual([true, false]);
    expect(await auditRows(org.orgId, 'organization.payment_service_resumed')).toMatchObject([{ target_id: 'probe' }]);
    expect(await resumedJobsOf(org.orgId)).toHaveLength(1);
    expect(await paymentServiceOf(h, org.orgId)).toMatchObject({ status: 'active' });
  });
});

describe('cấu hình', () => {
  it('queue "đã mở lại": retry có backoff, dead-letter có sẵn', async () => {
    await h.app.get(PaymentServiceQueues).ready();
    expect(await boss.getQueue(JobQueue.PAYMENT_SERVICE_RESUMED)).toMatchObject({
      name: JobQueue.PAYMENT_SERVICE_RESUMED,
      deadLetter: JobQueue.PAYMENT_SERVICE_RESUMED_DEAD_LETTER,
      retryLimit: PAYMENT_SERVICE_RESUMED_QUEUE.queueOptions.retryLimit,
      retryBackoff: true,
    });
    expect(await boss.getQueue(JobQueue.PAYMENT_SERVICE_RESUMED_DEAD_LETTER)).toMatchObject({
      name: JobQueue.PAYMENT_SERVICE_RESUMED_DEAD_LETTER,
    });
  });

  it('CHECK của DB và enum Drizzle khớp đúng các giá trị trạng thái và lý do của contracts', async () => {
    const { rows } = await h.db.pool.query<{ name: string; def: string }>(
      `SELECT conname AS name, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('organizations_payment_service_status_check', 'organizations_payment_service_reason_check')`,
    );
    const def = (name: string) => rows.find((r) => r.name === name)!.def;
    /** Các literal trong `ARRAY[...]` đứng sau `<cột> = ANY (` của CHECK. */
    const valuesOf = (check: string, column: string) => {
      const list = new RegExp(`${column} = ANY \\(\\(?ARRAY\\[([^\\]]*)\\]`).exec(check)?.[1] ?? '';
      return [...list.matchAll(/'([^']*)'::text/g)].map((m) => m[1]).sort();
    };
    const statuses = Object.values(PaymentServiceStatus).sort();
    const reasons = Object.values(PaymentServiceReason).sort();
    expect(valuesOf(def('organizations_payment_service_status_check'), 'payment_service_status')).toEqual(statuses);
    expect(valuesOf(def('organizations_payment_service_reason_check'), 'payment_service_reason')).toEqual(reasons);
    expect([...organizations.paymentServiceStatus.enumValues].sort()).toEqual(statuses);
    expect([...organizations.paymentServiceReason.enumValues].sort()).toEqual(reasons);
  });
});

describe('notices', () => {
  it('BTC suspended: Owner và Admin thấy đúng một mã theo lý do, sau CLOSED_BETA_REVOKED, trước PAYOUT_ACCOUNT_NOT_LINKED; mã Token kèm tingeePortalUrl', async () => {
    const org = await newOrg('CLB Cờ tướng');
    const admin = await addAdmin(org);
    await suspendVia(org, '1033');
    await h.http
      .post(`/v1/admin/organizations/${org.orgId}/closed-beta/revoke`)
      .set('cookie', platformAdmin.cookie)
      .expect(204);
    await h.db.orm.execute(
      sql`UPDATE payout_accounts SET is_default = false, retired_at = now() WHERE organization_id = ${org.orgId}`,
    );

    const expected: Record<string, string> = {
      token: 'PAYMENT_SERVICE_SUSPENDED_TOKEN',
      credential_invalid: 'PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID',
      gateway_permission_missing: 'PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING',
      payout_account_not_allowed: 'PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED',
      tingee_disabled: 'PAYMENT_SERVICE_SUSPENDED_TINGEE_DISABLED',
    };
    expect(Object.keys(expected).sort()).toEqual(Object.values(PaymentServiceReason).sort());
    const versions = new Set<string>();
    for (const [reason, code] of Object.entries(expected)) {
      await h.db.orm.execute(sql`UPDATE organizations SET payment_service_reason = ${reason} WHERE id = ${org.orgId}`);
      for (const cookie of [org.owner.cookie, admin.cookie]) {
        const res = await h.http.get(`/v1/orgs/${org.orgId}/notices`).set('cookie', cookie).expect(200);
        const notices = StatusNoticeList.parse(res.body);
        expect(notices.map((n) => n.code), reason).toEqual(['CLOSED_BETA_REVOKED', code, 'PAYOUT_ACCOUNT_NOT_LINKED']);
        const notice = notices[1]!;
        expect(notice).toMatchObject({
          severity: 'danger',
          blocking: true,
          dismissible: false,
          scope: 'organization',
          audience: ['owner', 'admin'],
          data: reason === 'token' ? { tingeePortalUrl: PORTAL } : {},
        });
        versions.add(notice.version);
      }
    }
    // Đổi lý do thì `version` đổi.
    expect(versions.size).toBe(5);
  });
});

describe('worker thật (pg-boss)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    // Job còn chờ của các test trên không được chen vào.
    await boss.deleteQueuedJobs(JobQueue.PAYMENT_SERVICE_RESUMED);
    await boss.deleteQueuedJobs(JobQueue.PAYMENT_RECONCILE_ORDER);
    const moduleRef = await Test.createTestingModule({
      imports: [WorkerModule.forRoot(workerConfig({ TINGEE_BASE_URL: fake.url }))],
    }).compile();
    app = await moduleRef.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('lịch dò mỗi 5 phút; job dò thấy dịch vụ về → cờ active → job "đã mở lại" → job tra của Đơn còn mở tới hạn ngay', async () => {
    const schedules = await boss.getSchedules();
    expect(schedules.find((s) => s.name === JobQueue.ORGANIZER_PROBE_PAYMENT_SERVICE)).toMatchObject({
      cron: PAYMENT_SERVICE_PROBE_CRON,
    });
    expect(PAYMENT_SERVICE_PROBE_CRON).toBe('*/5 * * * *');

    const org = await newOrg('CLB Taekwondo');
    const sale = await newSale(org);
    const pending = await placePaid(sale);
    await suspendVia(org, '1033');

    // Chạy job dò ngay thay vì chờ lịch.
    await boss.send(JobQueue.ORGANIZER_PROBE_PAYMENT_SERVICE, null);
    await expect
      .poll(async () => (await paymentServiceOf(h, org.orgId)).status, { timeout: 20_000, interval: 200 })
      .toBe('active');
    await expect
      .poll(async () => (await resumedJobsOf(org.orgId))[0]?.state, { timeout: 20_000, interval: 200 })
      .toBe('completed');
    const jobs = await boss.findJobs(JobQueue.PAYMENT_RECONCILE_ORDER, { data: { orderId: pending.orderId } });
    // Job đầu của TX2 (lượt + 2 phút) và job tra "ngay" của lần mở lại.
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs.some((job) => job.startAfter.getTime() <= Date.now())).toBe(true);
    await expectInvariants(h, sale.eventId);
  });
});
