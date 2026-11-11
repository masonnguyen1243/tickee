import { randomBytes, randomUUID } from 'node:crypto';
import { BuyerOrder, EventDetail, FormQuestion, IDEMPOTENCY_KEY_HEADER, TicketTypeDetail } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import { CreateLinkError, TINGEE_CLIENT, type TingeeClient, type TingeeCredential } from '../../src/modules/tingee/index.js';
import { parseCredentialKeys, SecretBox } from '../../src/platform/crypto/index.js';
import { signUpPlatformAdmin } from '../admin/platform-admin.js';
import { TEST_CREDENTIAL_KEYS } from '../helpers.js';
import { signUp, type Harness } from '../identity/harness.js';

/*
 * Dựng dữ liệu cho test tạo Đơn (Story 3.2): một Owner, BTC đã duyệt Closed Beta và có tài khoản nhận tiền mặc định
 * (bán được Vé có phí), Sự kiện đã mở bán với Hạng vé theo yêu cầu, và Người mua mới (đã đồng ý NĐ 13). Mỗi test dùng
 * Sự kiện mới nên không lẫn tồn kho của nhau.
 *
 * Story 3.4: tạo Đơn có phí gọi Tingee `create-link` ngay sau TX1. Test của 3.2/3.3 thay Tingee bằng
 * `REJECTING_TINGEE` (`create-link` luôn bị từ chối bằng mã thường): Đơn có phí vẫn `pending`, chưa có link, hạn Giữ chỗ
 * của TX1, như trước Story 3.4. Test của 3.4 dùng Tingee fake thật với merchant khớp credential của BTC.
 */

export type User = Awaited<ReturnType<typeof signUp>>;

export const EVENT_DRAFT = {
  name: 'Giải Pickleball mùa thu',
  startsAt: '2099-11-16T07:00:00+07:00',
  endsAt: '2099-11-16T17:00:00+07:00',
  refundPolicy: 'Hoàn 100% trước 7 ngày.',
};

export interface Org {
  h: Harness;
  owner: User;
  orgId: string;
}

/** Khóa giải mã credential của api trong test (`TEST_CREDENTIAL_KEYS`): niêm Secret Token như `organizer` lưu. */
export const testSecretBox = new SecretBox(parseCredentialKeys(TEST_CREDENTIAL_KEYS));

/** Tài khoản nhận tiền của BTC trong test: VA (khớp một tài khoản `active` của merchant trên Tingee fake), tên, ngân hàng. */
export interface PayoutSpec {
  vaAccountNumber: string;
  accountName: string;
  bankName: string;
}

export const DEFAULT_PAYOUT: PayoutSpec = {
  vaAccountNumber: '9600000001',
  accountName: 'NGUYEN VAN A',
  bankName: 'MB Bank',
};

/**
 * Lưu credential (Secret Token niêm bằng `testSecretBox`) + một tài khoản nhận tiền mặc định cho BTC `orgId`, như sau
 * khi Owner kết nối Tingee (Story 2.6), kể cả sinh `ipnKey` của BTC lần đầu (`ipnKeyOf`). Trả id tài khoản.
 */
export async function linkPayoutAccount(
  org: Org,
  credential: TingeeCredential,
  payout: PayoutSpec = DEFAULT_PAYOUT,
): Promise<{ credentialId: string; payoutAccountId: string }> {
  const { h, owner, orgId } = org;
  await h.db.orm.execute(sql`
    UPDATE organizations SET tingee_ipn_key = ${randomBytes(16).toString('base64url')}
     WHERE id = ${orgId} AND tingee_ipn_key IS NULL`);
  const created = await h.db.orm.execute<{ id: string }>(sql`
    INSERT INTO tingee_credentials (organization_id, client_id, secret_token_ciphertext, created_by)
    VALUES (${orgId}, ${credential.clientId}, ${testSecretBox.seal(credential.secretToken)}, ${owner.userId})
    RETURNING id`);
  const credentialId = created.rows[0]!.id;
  const account = await h.db.orm.execute<{ id: string }>(sql`
    INSERT INTO payout_accounts
      (organization_id, tingee_credential_id, va_account_number, bank_bin, bank_name, account_type, account_last4,
       account_name, created_by, is_default)
    VALUES (${orgId}, ${credentialId}, ${payout.vaAccountNumber}, '970422', ${payout.bankName}, 'personal-account',
      ${payout.vaAccountNumber.slice(-4)}, ${payout.accountName}, ${owner.userId}, true)
    RETURNING id`);
  return { credentialId, payoutAccountId: account.rows[0]!.id };
}

/** `ipnKey` của BTC (URL IPN `/v1/payments/tingee/ipn/:ipnKey`); BTC chưa kết nối Tingee → lỗi. */
export async function ipnKeyOf(h: Harness, orgId: string): Promise<string> {
  const { rows } = await h.db.pool.query<{ key: string | null }>(
    'SELECT tingee_ipn_key AS key FROM organizations WHERE id = $1',
    [orgId],
  );
  const key = rows[0]?.key;
  if (!key) throw new Error('BTC chưa có ipnKey');
  return key;
}

/** Credential giả của BTC trong test của 3.2/3.3 (Tingee là `REJECTING_TINGEE`, không bao giờ gọi HTTP). */
export const TEST_CREDENTIAL: TingeeCredential = { clientId: 'tg-client-test', secretToken: 'tg-secret-test-0123456789' };

/**
 * BTC mới của một Owner mới, đã duyệt Closed Beta và có tài khoản nhận tiền mặc định (bán được Vé có phí) ký bằng
 * `credential`.
 */
export async function paidReadyOrg(
  h: Harness,
  options: { name?: string; credential?: TingeeCredential; payout?: PayoutSpec } = {},
): Promise<Org> {
  const owner = await signUp(h);
  const platformAdmin = await signUpPlatformAdmin(h);
  const orgId = (
    await h.http
      .post('/v1/orgs')
      .set('cookie', owner.cookie)
      .send({ name: options.name ?? 'CLB ABC' })
      .expect(201)
  ).body.id as string;
  await h.http
    .post(`/v1/admin/organizations/${orgId}/closed-beta/approve`)
    .set('cookie', platformAdmin.cookie)
    .expect(204);
  const org = { h, owner, orgId };
  await linkPayoutAccount(org, options.credential ?? TEST_CREDENTIAL, options.payout);
  return org;
}

/**
 * Tingee giả cho test của 3.2/3.3: `create-link` luôn bị từ chối rõ ràng bằng mã thường (`1006`), nên Đơn có phí vẫn
 * `pending`, chưa có link (`payment.linkError = 'provider_error'`) và hết hạn theo job (a) như trước Story 3.4.
 */
export const REJECTING_TINGEE: TingeeClient = {
  listAccounts: () => Promise.resolve([]),
  createPaymentLink: () => Promise.reject(CreateLinkError.rejected('1006')),
};

/** Override của harness cho test của 3.2/3.3 (`REJECTING_TINGEE`). */
export const rejectingTingee = { provide: TINGEE_CLIENT, useValue: REJECTING_TINGEE };

export const eventsPath = (org: Org, eventId = '') => `/v1/orgs/${org.orgId}/events${eventId ? `/${eventId}` : ''}`;

export interface TierSpec {
  name: string;
  price: number;
  capacity: number;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
}

export interface QuestionSpec {
  label: string;
  kind: 'text' | 'choice';
  required: boolean;
  options?: string[];
}

export interface SaleEvent {
  event: EventDetail;
  tiers: TicketTypeDetail[];
  questions: FormQuestion[];
}

/** Sự kiện đã mở bán với các Hạng vé (theo thứ tự tạo) và câu hỏi form (theo thứ tự). */
export async function eventOnSale(
  org: Org,
  tiers: TierSpec[],
  options: { questions?: QuestionSpec[]; maxTicketsPerOrder?: number } = {},
): Promise<SaleEvent> {
  const { h, owner } = org;
  const event = EventDetail.parse(
    (await h.http.post(eventsPath(org)).set('cookie', owner.cookie).send(EVENT_DRAFT).expect(201)).body,
  );
  const created: TicketTypeDetail[] = [];
  for (const tier of tiers) {
    const res = await h.http
      .post(`${eventsPath(org, event.id)}/ticket-types`)
      .set('cookie', owner.cookie)
      .send(tier)
      .expect(201);
    created.push(TicketTypeDetail.parse(res.body));
  }
  const questions: FormQuestion[] = [];
  for (const q of options.questions ?? []) {
    const res = await h.http
      .post(`${eventsPath(org, event.id)}/form/questions`)
      .set('cookie', owner.cookie)
      .send({ label: q.label, kind: q.kind, required: q.required, options: (q.options ?? []).map((label) => ({ label })) })
      .expect(201);
    questions.push(FormQuestion.parse(res.body));
  }
  if (options.maxTicketsPerOrder !== undefined) {
    await h.http
      .patch(`${eventsPath(org, event.id)}/order-limit`)
      .set('cookie', owner.cookie)
      .send({ maxTicketsPerOrder: options.maxTicketsPerOrder })
      .expect(200);
  }
  await h.http.post(`${eventsPath(org, event.id)}/publish`).set('cookie', owner.cookie).expect(200);
  return { event, tiers: created, questions };
}

export const ordersPath = (slug: string) => `/v1/events/${slug}/orders`;

/** Gửi Đơn. `key` mặc định là uuid mới; `null` = không gửi header. */
export function postOrder(h: Harness, buyer: User, slug: string, body: unknown, key: string | null = randomUUID()) {
  const req = h.http.post(ordersPath(slug)).set('cookie', buyer.cookie);
  if (key !== null) req.set(IDEMPOTENCY_KEY_HEADER, key);
  return req.send(body as object);
}

export const buyerInput = { name: 'Nguyễn Văn An', phone: '0912 345 678' };

export const orderBody = (items: { ticketTypeId: string; quantity: number }[], extra: Record<string, unknown> = {}) => ({
  items,
  buyer: buyerInput,
  answers: {},
  ...extra,
});

export async function inventory(h: Harness, ticketTypeId: string) {
  const { rows } = await h.db.pool.query<{ capacity: number; sold: number; held: number }>(
    'SELECT capacity, sold, held FROM ticket_type_inventory WHERE ticket_type_id = $1',
    [ticketTypeId],
  );
  return rows[0];
}

export async function orderRow(h: Harness, code: string) {
  const { rows } = await h.db.pool.query<{
    id: string;
    status: string;
    expires_at: Date;
    created_at: Date;
    funnel_id: string | null;
    total_amount: string;
  }>('SELECT id, status, expires_at, created_at, funnel_id, total_amount FROM orders WHERE code = $1', [code]);
  return rows[0];
}

export async function ordersOfEvent(h: Harness, eventId: string) {
  const { rows } = await h.db.pool.query<{ code: string; status: string; user_id: string }>(
    'SELECT code, status, user_id FROM orders WHERE event_id = $1 ORDER BY created_at, id',
    [eventId],
  );
  return rows;
}

export const parseOrder = (body: unknown) => BuyerOrder.parse(body);

/** Xóa bộ đếm tạo Đơn: mọi request test đi từ cùng một IP. */
export async function resetOrderRateLimit(h: Harness): Promise<void> {
  await h.db.orm.execute(sql`DELETE FROM order_create_attempts`);
}
