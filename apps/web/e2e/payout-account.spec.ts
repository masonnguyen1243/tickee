import type { Page, Request } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, EMAIL, me, mockIdentityApi, type Call, type Handler } from './identity-mock';
import { fakeEventSource } from './live-mock';
import {
  mockOrganizerApi,
  organization,
  ORG_ID,
  ORG_LIVE_URL,
  PAYMENT_SERVICE_NOTICE,
  statusNotice,
} from './organizer-mock';

/*
 * Trang Tài khoản nhận tiền (Story 2.6): BTC dùng tài khoản merchant Tingee của chính mình, liên kết một hay nhiều tài
 * khoản, đặt mặc định và hủy liên kết. API giả có trạng thái như api thật, "Tingee" giả theo cặp key như Tingee fake của
 * api: MAIN có MB (chọn được), VietinBank (mờ) và ACB (chọn được) · EMPTY chưa có tài khoản · FLAKY lần đầu Tingee tạm
 * lỗi. Key khác hoặc secret sai → `TINGEE_CREDENTIAL_INVALID`.
 *
 * Story 2.13-a: với `reauth`, hủy liên kết và đặt mặc định đòi header `x-reauth-token` (thiếu hay đã dùng →
 * `REAUTH_REQUIRED`), cấp bởi `/identity/reauth` giả: mã đúng là `123456`.
 *
 * Story 2.13-b: "Đổi key Tingee" (BTC đã từng liên kết) như api: begin và xem trước chỉ kiểm lần xác nhận (không tiêu),
 * lưu tiêu lần xác nhận rồi thay credential và mọi tài khoản bằng tài khoản đã chọn (mặc định). Key NEXT có VCB (chọn
 * được) và VietinBank (mờ).
 *
 * Story 4.2-b: `paymentService` của tổng quan đọc từ `state.paymentService`; `notices` thêm banner của lý do ngắt;
 * "Kiểm tra lại" (`POST …/payment-service/check`) trả lần lượt `checkReplies` (mặc định: vẫn ngắt / không ngắt), lưu key
 * mới tắt cờ khi lý do là key (như api). Giờ hiển thị theo giờ Việt Nam: các ca này chạy trình duyệt múi giờ New York.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const PAGE_PATH = `/btc/${ORG_ID}/tai-khoan-nhan-tien`;
const PORTAL = 'https://baas.tingee.vn';
const IPN_URL = 'http://localhost:3001/v1/payments/tingee/ipn/q3Vb7xYk2LmN9pRs4TuW6z';
const NOT_LINKED_TITLE = 'Chưa liên kết tài khoản nhận tiền';
const CREDENTIAL_INVALID = 'Client ID hoặc Secret Token không đúng.';
const PROVIDER_DOWN = 'Tingee tạm lỗi, thử lại sau ít phút.';

type Option = {
  vaAccountNumber: string;
  bankBin: string;
  bankName: string;
  accountType: string;
  accountLast4: string;
  accountName: string;
  selectable: boolean;
};
type Credential = { id: string; clientIdMasked: string; connectedAt: string };
type PaymentService = { status: string; reason: string | null; since: string | null; checkedAt: string | null };
/** Một lần "Kiểm tra lại" của API giả: kết quả (và số giây chờ), hoặc lỗi HTTP. */
type CheckReply = { outcome: string; retryAfterSeconds?: number } | { error: number };
type Account = Omit<Option, 'selectable'> & { id: string; isDefault: boolean; linkedAt: string };

const MB: Option = {
  vaAccountNumber: '9600004321',
  bankBin: '970422',
  bankName: 'MB Bank',
  accountType: 'personal-account',
  accountLast4: '4321',
  accountName: 'CLB CO VUA QUAN 3',
  selectable: true,
};
const VIETIN: Option = {
  vaAccountNumber: '9600008765',
  bankBin: '970415',
  bankName: 'VietinBank',
  accountType: 'personal-account',
  accountLast4: '8765',
  accountName: 'NGUYEN VAN AN',
  selectable: false,
};
const VCB: Option = { ...MB, vaAccountNumber: '9600001111', bankBin: '970436', bankName: 'Vietcombank', accountLast4: '1111' };
const ACB: Option = { ...MB, vaAccountNumber: '9600002222', bankBin: '970416', bankName: 'ACB', accountLast4: '2222' };

const MAIN = { clientId: 'tg-client-main-0a1b2c3d', secretToken: 'tg-secret-main-Zx9Yw8Vu7' };
const EMPTY = { clientId: 'tg-client-empty-8c9d0e1f', secretToken: 'tg-secret-empty-Nm3Lk2Ji1' };
const FLAKY = { clientId: 'tg-client-flaky-4e5f6a7b', secretToken: 'tg-secret-flaky-Ts6Rq5Po4' };
const NEXT = { clientId: 'tg-client-next-9a8b7c6d', secretToken: 'tg-secret-next-Qw1Er2Ty3' };

const credentialOf = (clientId: string, n: number): Credential => ({
  id: `019a3b2c-02${String(n).padStart(2, '0')}-7abc-8def-0123456789ab`,
  clientIdMasked: `••••${clientId.slice(-4)}`,
  connectedAt: '2026-11-03T03:00:00.000Z',
});

/** Id của tài khoản liên kết thứ `n` (mock đăng ký sẵn route hủy liên kết / đặt mặc định cho các id này). */
const accountId = (n: number) => `019a3b2c-03${String(n).padStart(2, '0')}-7abc-8def-0123456789ab`;
const ACCOUNT_IDS = Array.from({ length: 8 }, (_, n) => accountId(n));

const linkedAccount = (option: Option, n = 0, isDefault = n === 0): Account => {
  const { selectable: _selectable, ...rest } = option;
  return { ...rest, id: accountId(n), isDefault, linkedAt: `2026-11-03T03:${String(5 + n).padStart(2, '0')}:00.000Z` };
};

type State = {
  credential: Credential | null;
  /** Client ID của credential hiện hành (api biết, web không biết). */
  clientId: string | null;
  /** Tài khoản nhận tiền hiện hành, theo thứ tự liên kết. */
  accounts: Account[];
  /** BTC đã từng liên kết tài khoản (kể cả đã hủy hết): api không nhận key nữa (`canReplaceKey: false`). */
  everLinked: boolean;
  /** Tài khoản "Tingee" của từng key; sửa được giữa chừng (BTC liên kết thêm trên portal). */
  tingee: Record<string, { secretToken: string; accounts: Option[] }>;
  /** VA đã bị tắt trên Tingee sau khi danh sách hiện. */
  unavailable: Set<string>;
  flakyFailures: number;
  /** `GET …/options` lỗi: key bị thu hồi trên Tingee (422) hoặc Tingee tạm lỗi (503). */
  optionsError: 'invalid' | 'down' | null;
  /** `POST …/payout-account` lỗi: key bị thu hồi trên Tingee (422). */
  selectError: 'invalid' | null;
  /** Hủy liên kết (đã qua xác nhận lại) lỗi hệ thống 503. */
  unlinkFailure: boolean;
  /** Lưu đổi key lỗi: key mới bị thu hồi trên Tingee sau bước xem trước (422). */
  replaceError: 'invalid' | null;
  /** Dịch vụ thanh toán của BTC (Story 4.2). */
  paymentService: PaymentService;
  /** Các lần "Kiểm tra lại" kế tiếp. */
  checkReplies: CheckReply[];
  /** "Kiểm tra lại" chờ chừng này ms trước khi trả lời (kiểm spinner, chặn bấm lặp). */
  checkDelayMs: number;
};

const ACTIVE_SERVICE: PaymentService = { status: 'active', reason: null, since: null, checkedAt: null };
/** 13/11/2026 10:04 giờ Việt Nam. */
const SUSPENDED_SINCE = '2026-11-13T03:04:00.000Z';
/** 13/11/2026 10:20 giờ Việt Nam: lần "Kiểm tra lại" của API giả. */
const CHECKED_AT = '2026-11-13T03:20:00.000Z';
const suspended = (reason: string, checkedAt: string | null = null): PaymentService => ({
  status: 'suspended',
  reason,
  since: SUSPENDED_SINCE,
  checkedAt,
});

/** Mã xác nhận lại đúng ở API giả (TOTP hay mã email đều vậy). */
const REAUTH_CODE = '123456';

async function openPage(
  page: Page,
  {
    role = 'owner',
    initial = {},
    reauth,
    requiredMethod = reauth,
    resendAfterSeconds = 60,
  }: {
    role?: string;
    initial?: Partial<State>;
    /** Cách xác nhận thật của tài khoản ở api giả; bỏ trống = thao tác không đòi xác nhận lại. */
    reauth?: 'totp' | 'email_otp';
    /** `details.method` của `REAUTH_REQUIRED` (mặc định = `reauth`; khác đi để giả lập 2FA vừa bật ở nơi khác). */
    requiredMethod?: 'totp' | 'email_otp';
    resendAfterSeconds?: number;
  } = {},
) {
  const state: State = {
    credential: null,
    clientId: null,
    accounts: [],
    everLinked: (initial.accounts?.length ?? 0) > 0,
    tingee: {
      [MAIN.clientId]: { secretToken: MAIN.secretToken, accounts: [MB, VIETIN, ACB] },
      [EMPTY.clientId]: { secretToken: EMPTY.secretToken, accounts: [] },
      [FLAKY.clientId]: { secretToken: FLAKY.secretToken, accounts: [VCB] },
      [NEXT.clientId]: { secretToken: NEXT.secretToken, accounts: [VCB, VIETIN] },
    },
    unavailable: new Set(),
    flakyFailures: 1,
    optionsError: null,
    selectError: null,
    unlinkFailure: false,
    replaceError: null,
    paymentService: ACTIVE_SERVICE,
    checkReplies: [],
    checkDelayMs: 0,
    ...initial,
  };
  // Credential seed (`credentialOf(…, n)`) đã chiếm số `n`: credential tạo sau (kết nối, đổi key) luôn có id mới.
  let connections = Number(state.credential?.id.match(/^019a3b2c-02(\d{2})-/)?.[1] ?? 0);
  let linkedCount = state.accounts.length;
  const isLinked = (vaAccountNumber: string) => state.accounts.some((a) => a.vaAccountNumber === vaAccountNumber);
  const optionsOf = () => ({
    credential: state.credential,
    accounts: state.tingee[state.clientId!]!.accounts.map((a) => ({ ...a, linked: isLinked(a.vaAccountNumber) })),
  });
  const overviewOf = () => ({
    credential: state.credential,
    accounts: state.accounts,
    canReplaceKey: !state.everLinked,
    ipnUrl: state.credential ? IPN_URL : null,
    tingeePortalUrl: PORTAL,
    paymentService: state.paymentService,
  });
  /** Banner như `reporting.notices`: lý do ngắt (Token kèm portal), rồi chưa liên kết tài khoản nhận tiền. */
  const noticesOf = () => {
    const notices: ReturnType<typeof statusNotice>[] = [];
    const { status, reason, since } = state.paymentService;
    if (status === 'suspended' && reason) {
      const data = reason === 'token' ? { tingeePortalUrl: PORTAL } : {};
      notices.push(statusNotice(PAYMENT_SERVICE_NOTICE[reason]!, { data, version: `${since}:${reason}` }));
    }
    if (state.accounts.length === 0) notices.push(statusNotice('PAYOUT_ACCOUNT_NOT_LINKED'));
    return notices;
  };
  // Xác nhận lại như api (Story 2.13-a): mỗi token dùng một lần; `reauthHeaders` ghi header của mọi lần gọi thao tác.
  // `consume: false`: chỉ kiểm (bước đầu của đổi key); xóa `issued` để giả lập lần xác nhận quá 5 phút.
  const issued = new Set<string>();
  const reauthHeaders: (string | null)[] = [];
  const reauthGranted = (request: Request, consume = true) => {
    const token = request.headers()['x-reauth-token'] ?? null;
    reauthHeaders.push(token);
    if (!reauth) return true;
    if (!token || !issued.has(token)) return false;
    if (consume) issued.delete(token);
    return true;
  };
  /** Key mới đúng (cặp Client ID + Secret Token có ở "Tingee"), không thì `null`. */
  const tingeeKey = (key: { clientId: string; secretToken: string }) => {
    const found = state.tingee[key.clientId];
    return found && found.secretToken === key.secretToken ? found : null;
  };
  const reauthRequired = () => apiError(403, 'REAUTH_REQUIRED', { method: requiredMethod });
  // Hủy liên kết và đặt mặc định như api: id lạ hoặc đã hủy → 404; hủy tài khoản mặc định thì tài khoản liên kết sớm
  // nhất còn lại thành mặc định.
  const accountRoutes: Record<string, Handler> = {};
  for (const id of ACCOUNT_IDS) {
    accountRoutes[`DELETE /orgs/${ORG_ID}/payout-account/${id}`] = (request) => {
      if (!reauthGranted(request)) return reauthRequired();
      if (state.unlinkFailure) return apiError(503, 'SERVICE_UNAVAILABLE');
      const target = state.accounts.find((a) => a.id === id);
      if (!target) return apiError(404, 'NOT_FOUND');
      state.accounts = state.accounts.filter((a) => a.id !== id);
      if (target.isDefault && state.accounts[0]) state.accounts[0] = { ...state.accounts[0], isDefault: true };
      return { status: 200, body: overviewOf() };
    };
    accountRoutes[`POST /orgs/${ORG_ID}/payout-account/${id}/default`] = (request) => {
      if (!reauthGranted(request)) return reauthRequired();
      if (!state.accounts.some((a) => a.id === id)) return apiError(404, 'NOT_FOUND');
      state.accounts = state.accounts.map((a) => ({ ...a, isDefault: a.id === id }));
      return { status: 200, body: overviewOf() };
    };
  }

  let grants = 0;
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, reauth === 'totp'),
    'POST /identity/reauth/email-code': () =>
      reauth === 'totp'
        ? apiError(409, 'REAUTH_METHOD_MISMATCH', { method: 'totp' })
        : { status: 200, body: { resendAfterSeconds } },
    'POST /identity/reauth': (request) => {
      if ((request.postDataJSON() as { code: string }).code !== REAUTH_CODE) {
        return apiError(400, reauth === 'totp' ? 'TOTP_INVALID' : 'OTP_INVALID', { remainingAttempts: 4 });
      }
      grants += 1;
      const reauthToken = `tok-${grants}`;
      issued.add(reauthToken);
      return { status: 200, body: { reauthToken, expiresAt: '2026-11-08T03:09:00.000Z' } };
    },
  });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role }] }),
    [`GET /orgs/${ORG_ID}/notices`]: () => ({ status: 200, body: noticesOf() }),
    // "Kiểm tra lại" (Story 4.2-b): `resumed` tắt cờ; các kết quả có gọi Tingee ghi lần kiểm tra.
    [`POST /orgs/${ORG_ID}/payment-service/check`]: async () => {
      if (state.checkDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, state.checkDelayMs));
      const isSuspended = state.paymentService.status === 'suspended';
      const reply = state.checkReplies.shift() ?? { outcome: isSuspended ? 'still_suspended' : 'not_suspended' };
      if ('error' in reply) return apiError(reply.error, 'SERVICE_UNAVAILABLE');
      if (reply.outcome === 'resumed') state.paymentService = { ...ACTIVE_SERVICE, checkedAt: CHECKED_AT };
      else if (reply.outcome === 'not_suspended') state.paymentService = ACTIVE_SERVICE;
      else if (isSuspended && reply.outcome !== 'cooldown') {
        state.paymentService = { ...state.paymentService, checkedAt: CHECKED_AT };
      }
      return {
        status: 200,
        body: {
          state: state.paymentService,
          outcome: reply.outcome,
          retryAfterSeconds: reply.outcome === 'cooldown' ? (reply.retryAfterSeconds ?? 30) : null,
        },
      };
    },
    [`GET /orgs/${ORG_ID}/payout-account`]: () => ({ status: 200, body: overviewOf() }),
    [`POST /orgs/${ORG_ID}/payout-account/credential`]: (request) => {
      const { clientId, secretToken } = request.postDataJSON() as { clientId: string; secretToken: string };
      if (state.everLinked) return apiError(409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
      const key = state.tingee[clientId];
      if (!key || key.secretToken !== secretToken) return apiError(422, 'TINGEE_CREDENTIAL_INVALID');
      if (clientId === FLAKY.clientId && state.flakyFailures > 0) {
        state.flakyFailures -= 1;
        return apiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE');
      }
      connections += 1;
      state.credential = credentialOf(clientId, connections);
      state.clientId = clientId;
      return { status: 200, body: optionsOf() };
    },
    [`GET /orgs/${ORG_ID}/payout-account/options`]: () => {
      if (!state.credential) return apiError(404, 'NOT_FOUND');
      if (state.optionsError === 'invalid') return apiError(422, 'TINGEE_CREDENTIAL_INVALID');
      if (state.optionsError === 'down') return apiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE');
      return { status: 200, body: optionsOf() };
    },
    [`POST /orgs/${ORG_ID}/payout-account`]: (request) => {
      const { vaAccountNumber } = request.postDataJSON() as { vaAccountNumber: string };
      if (!state.credential) return apiError(404, 'NOT_FOUND');
      if (isLinked(vaAccountNumber)) return apiError(409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
      if (state.selectError === 'invalid') return apiError(422, 'TINGEE_CREDENTIAL_INVALID');
      const option = state.tingee[state.clientId!]!.accounts.find((a) => a.vaAccountNumber === vaAccountNumber);
      if (!option || state.unavailable.has(vaAccountNumber)) return apiError(409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      if (!option.selectable) return apiError(422, 'BANK_NOT_SUPPORTED');
      const account = linkedAccount(option, linkedCount, state.accounts.length === 0);
      linkedCount += 1;
      state.accounts = [...state.accounts, account];
      state.everLinked = true;
      return { status: 200, body: account };
    },
    // Đổi key Tingee: chưa từng liên kết → 409 (trước xác nhận lại); key sai → 422, không đổi gì, không tiêu token.
    [`POST /orgs/${ORG_ID}/payout-account/credential/replacement/begin`]: (request) => {
      if (!state.everLinked) return apiError(409, 'PAYOUT_ACCOUNT_NOT_LINKED_YET');
      if (!reauthGranted(request, false)) return reauthRequired();
      return { status: 204 };
    },
    [`POST /orgs/${ORG_ID}/payout-account/credential/replacement/preview`]: (request) => {
      if (!state.everLinked) return apiError(409, 'PAYOUT_ACCOUNT_NOT_LINKED_YET');
      if (!reauthGranted(request, false)) return reauthRequired();
      const key = request.postDataJSON() as { clientId: string; secretToken: string };
      const found = tingeeKey(key);
      if (!found) return apiError(422, 'TINGEE_CREDENTIAL_INVALID');
      return {
        status: 200,
        body: {
          clientIdMasked: `••••${key.clientId.slice(-4)}`,
          accounts: found.accounts.map((a) => ({ ...a, linked: false })),
        },
      };
    },
    [`POST /orgs/${ORG_ID}/payout-account/credential/replacement`]: (request) => {
      if (!state.everLinked) return apiError(409, 'PAYOUT_ACCOUNT_NOT_LINKED_YET');
      if (!reauthGranted(request, false)) return reauthRequired();
      const body = request.postDataJSON() as { clientId: string; secretToken: string; vaAccountNumber: string };
      const found = tingeeKey(body);
      if (!found || state.replaceError === 'invalid') return apiError(422, 'TINGEE_CREDENTIAL_INVALID');
      const option = found.accounts.find((a) => a.vaAccountNumber === body.vaAccountNumber);
      if (!option) return apiError(409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      if (!option.selectable) return apiError(422, 'BANK_NOT_SUPPORTED');
      issued.delete(request.headers()['x-reauth-token'] ?? '');
      connections += 1;
      state.credential = credentialOf(body.clientId, connections);
      state.clientId = body.clientId;
      state.accounts = [linkedAccount(option, linkedCount, true)];
      linkedCount += 1;
      // Như api (`resumeAfterNewKey`): key mới hợp lệ tắt cờ khi BTC bị ngắt vì key.
      if (['credential_invalid', 'gateway_permission_missing'].includes(state.paymentService.reason ?? '')) {
        state.paymentService = ACTIVE_SERVICE;
      }
      return { status: 200, body: overviewOf() };
    },
    ...accountRoutes,
  });
  await page.goto(PAGE_PATH);
  await expect(page.getByRole('heading', { name: 'Tài khoản nhận tiền', level: 1 })).toBeVisible();
  return { calls, state, identityCalls, reauthHeaders, issued };
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const posts = (calls: Call[], suffix = '') =>
  calls.filter((c) => c.method === 'POST' && c.path === `/orgs/${ORG_ID}/payout-account${suffix}`);
const optionLoads = (calls: Call[]) =>
  calls.filter((c) => c.method === 'GET' && c.path === `/orgs/${ORG_ID}/payout-account/options`);
const banners = (page: Page) => page.locator('[data-slot="status-banner-stack"] [data-slot="status-banner"]');
const chooser = (page: Page) => page.locator('[data-slot="payout-account-chooser"]');
const optionRows = (page: Page) => page.locator('[data-slot="payout-account-option"]');
const optionRow = (page: Page, bankName: string) => optionRows(page).filter({ hasText: bankName });
const chooserBanner = (page: Page) => chooser(page).locator('[data-slot="status-banner"]');
const accountRows = (page: Page) => page.locator('[data-slot="payout-account-row"]');
const accountRow = (page: Page, bankName: string) => accountRows(page).filter({ hasText: bankName });
const unlinkDialog = (page: Page) => page.getByRole('dialog', { name: 'Hủy liên kết tài khoản này?' });
const reauthDialog = (page: Page) => page.getByRole('dialog', { name: 'Xác nhận để tiếp tục' });
const reauthBoxes = (page: Page) => reauthDialog(page).locator('[data-slot="otp-input"] input');
const replaceKeyForm = (page: Page) => page.locator('[data-slot="tingee-replace-key-form"]');
const replaceKeyAccounts = (page: Page) => page.locator('[data-slot="tingee-replace-key-accounts"]');
const replacements = (calls: Call[]) => posts(calls, '/credential/replacement');
const CREDENTIAL_REVOKED_LOCKED = 'Client ID hoặc Secret Token không còn đúng. Bấm “Đổi key Tingee” để nhập key mới.';
const CONNECTED = { credential: credentialOf(MAIN.clientId, 1), clientId: MAIN.clientId };
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function connectWith(page: Page, key: { clientId: string; secretToken: string }) {
  await field(page, 'Client ID').fill(key.clientId);
  await field(page, 'Secret Token').fill(key.secretToken);
  await page.getByRole('button', { name: 'Kết nối', exact: true }).click();
}

test('chưa kết nối: hướng dẫn + form; key sai → lỗi tại form, giữ dữ liệu; key đúng → danh sách; chọn → thẻ "Đã liên kết", banner mất', async ({
  page,
}) => {
  const { calls } = await openPage(page);
  await expect(banners(page).first()).toContainText(NOT_LINKED_TITLE);

  // Hướng dẫn cho BTC chưa có tài khoản Tingee: ba bước kèm link.
  const guide = page.locator('[data-slot="tingee-guide"]');
  await expect(guide.getByRole('heading', { name: 'Chưa có tài khoản Tingee?' })).toBeVisible();
  await expect(guide.locator('li')).toHaveCount(3);
  await expect(guide.getByRole('link', { name: 'portal Tingee' })).toHaveAttribute('href', PORTAL);
  await expect(guide.getByRole('link', { name: 'API Credentials' })).toHaveAttribute('href', `${PORTAL}/api-credentials`);
  await expect(field(page, 'Secret Token')).toHaveAttribute('type', 'password');
  // Không để trình duyệt hay trình quản lý mật khẩu lưu/điền Secret Token như mật khẩu Tickee.
  await expect(field(page, 'Secret Token')).toHaveAttribute('autocomplete', 'new-password');
  await expect(field(page, 'Client ID')).toHaveAttribute('autocomplete', 'off');
  for (const label of ['Client ID', 'Secret Token']) {
    await expect(field(page, label)).toHaveAttribute('data-1p-ignore', 'true');
    await expect(field(page, label)).toHaveAttribute('data-lpignore', 'true');
    await expect(field(page, label)).toHaveAttribute('data-bwignore', 'true');
  }

  // Lỗi tại ô, không gọi api.
  await page.getByRole('button', { name: 'Kết nối', exact: true }).click();
  await expect(page.getByText('Nhập Client ID.')).toBeVisible();
  await expect(page.getByText('Nhập Secret Token.')).toBeVisible();
  await expect(field(page, 'Client ID')).toHaveAttribute('aria-invalid', 'true');
  expect(posts(calls, '/credential')).toHaveLength(0);

  // Key sai: lỗi tại form, dữ liệu giữ nguyên, không có "Thử lại".
  await connectWith(page, { clientId: MAIN.clientId, secretToken: 'tg-secret-sai' });
  await expect(page.getByText(CREDENTIAL_INVALID)).toBeVisible();
  await expect(field(page, 'Client ID')).toHaveValue(MAIN.clientId);
  await expect(field(page, 'Secret Token')).toHaveValue('tg-secret-sai');
  await expect(page.getByRole('button', { name: 'Thử lại' })).toHaveCount(0);

  // Key đúng (dán kèm khoảng trắng): danh sách hiện ngay, không đọc lại Tingee lần nữa.
  await field(page, 'Secret Token').fill(` ${MAIN.secretToken} `);
  await page.getByRole('button', { name: 'Kết nối', exact: true }).click();
  await expect(chooser(page)).toBeVisible();
  expect(posts(calls, '/credential').at(-1)?.body).toEqual({ clientId: MAIN.clientId, secretToken: MAIN.secretToken });
  await expect(chooser(page)).toContainText('Client ID ••••2c3d');
  await expect(optionRows(page)).toHaveCount(3);
  const mb = optionRow(page, 'MB Bank');
  await expect(mb).toContainText('•••• 4321');
  await expect(mb).toContainText('CLB CO VUA QUAN 3');
  const vietin = optionRow(page, 'VietinBank');
  await expect(vietin).toContainText('Chưa hỗ trợ VietinBank');
  await expect(vietin.getByRole('button')).toHaveCount(0);
  await expect(vietin).toHaveAttribute('data-selectable', 'false');
  expect(optionLoads(calls)).toHaveLength(0);
  // Secret Token không còn ở đâu trên trang.
  expect(await page.content()).not.toContain(MAIN.secretToken);
  await expect(banners(page).first()).toContainText(NOT_LINKED_TITLE);

  await mb.getByRole('button', { name: 'Dùng tài khoản này' }).click();
  const card = page.locator('[data-slot="payout-account-card"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-slot="status-badge"][data-tone="success"]')).toHaveText('Đã liên kết');
  // Tài khoản đầu tiên tự thành mặc định.
  await expect(accountRows(page)).toHaveCount(1);
  const row = accountRow(page, 'MB Bank');
  await expect(row).toContainText('•••• 4321');
  await expect(row).toContainText('CLB CO VUA QUAN 3');
  await expect(row.locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  await expect(row.getByRole('button', { name: 'Đặt làm mặc định' })).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Hủy liên kết' })).toBeVisible();
  expect(posts(calls).map((c) => c.body)).toEqual([{ vaAccountNumber: MB.vaAccountNumber }]);
  await expect(page.getByText('Đã liên kết tài khoản nhận tiền.')).toBeVisible();
  await expect(field(page, 'URL IPN')).toHaveValue(IPN_URL);
  await expect(banners(page)).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('Tingee tạm lỗi: "Tingee tạm lỗi, thử lại sau ít phút." + "Thử lại" giữ dữ liệu → kết nối được', async ({ page }) => {
  const { calls } = await openPage(page);
  await connectWith(page, FLAKY);
  await expect(page.getByText(PROVIDER_DOWN)).toBeVisible();
  await expect(field(page, 'Client ID')).toHaveValue(FLAKY.clientId);
  await expect(field(page, 'Secret Token')).toHaveValue(FLAKY.secretToken);

  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(optionRow(page, 'Vietcombank')).toBeVisible();
  expect(posts(calls, '/credential')).toHaveLength(2);
});

test('danh sách rỗng: empty-state + link portal; liên kết trên Tingee rồi "Tải lại" → có tài khoản', async ({ page }) => {
  const { calls, state } = await openPage(page);
  await connectWith(page, EMPTY);
  const empty = chooser(page).locator('[data-slot="empty-state"]');
  await expect(empty).toContainText('Tài khoản Tingee của bạn chưa liên kết tài khoản ngân hàng nào.');
  await expect(empty.getByRole('link', { name: 'Mở portal Tingee' })).toHaveAttribute('href', PORTAL);

  state.tingee[EMPTY.clientId]!.accounts = [MB];
  await empty.getByRole('button', { name: 'Tải lại' }).click();
  await expect(optionRow(page, 'MB Bank')).toBeVisible();
  expect(optionLoads(calls)).toHaveLength(1);
});

test('đã kết nối, chưa chọn: mở trang đọc lại danh sách; "Dùng key khác" → form (có "Hủy"); key khác → danh sách mới', async ({
  page,
}) => {
  const { calls } = await openPage(page, {
    initial: { credential: credentialOf(MAIN.clientId, 1), clientId: MAIN.clientId },
  });
  await expect(optionRows(page)).toHaveCount(3);
  expect(optionLoads(calls)).toHaveLength(1);
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
  // Chưa từng liên kết: đổi key bằng "Dùng key khác" (không xác nhận lại), không có "Đổi key Tingee".
  await expect(page.getByRole('button', { name: 'Đổi key Tingee' })).toHaveCount(0);

  await chooser(page).getByRole('button', { name: 'Dùng key khác' }).click();
  await expect(page.getByRole('heading', { name: 'Nhập key Tingee khác' })).toBeVisible();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(optionRows(page)).toHaveCount(3);

  await chooser(page).getByRole('button', { name: 'Dùng key khác' }).click();
  // Key mới sai: vẫn ở form, key cũ không bị thay.
  await connectWith(page, { clientId: FLAKY.clientId, secretToken: 'sai' });
  await expect(page.getByText(CREDENTIAL_INVALID)).toBeVisible();
  await connectWith(page, EMPTY);
  await expect(chooser(page)).toContainText('Client ID ••••0e1f');
  await expect(chooser(page).locator('[data-slot="empty-state"]')).toBeVisible();
});

test('tài khoản không còn active trên Tingee: báo tại chỗ + "Tải lại" đọc lại danh sách', async ({ page }) => {
  const { calls, state } = await openPage(page, {
    initial: { credential: credentialOf(MAIN.clientId, 1), clientId: MAIN.clientId },
  });
  state.unavailable.add(MB.vaAccountNumber);
  await optionRow(page, 'MB Bank').getByRole('button', { name: 'Dùng tài khoản này' }).click();
  await expect(
    page.getByText('Tài khoản này không còn dùng được trên Tingee. Tải lại danh sách rồi chọn tài khoản khác.'),
  ).toBeVisible();

  state.tingee[MAIN.clientId]!.accounts = [VIETIN];
  await chooserBanner(page).getByRole('button', { name: 'Tải lại' }).click();
  await expect(optionRows(page)).toHaveCount(1);
  await expect(page.getByText('Tài khoản này không còn dùng được trên Tingee.', { exact: false })).toHaveCount(0);
  expect(optionLoads(calls)).toHaveLength(2);
});

test('tab khác đã liên kết đúng tài khoản này: toast "Tài khoản này đã được liên kết.", trang chuyển sang danh sách đã liên kết', async ({
  page,
}) => {
  const { state } = await openPage(page, { initial: CONNECTED });
  await expect(optionRows(page)).toHaveCount(3);
  state.accounts = [linkedAccount(MB)];
  state.everLinked = true;
  await optionRow(page, 'MB Bank').getByRole('button', { name: 'Dùng tài khoản này' }).click();
  await expect(page.getByText('Tài khoản này đã được liên kết.')).toBeVisible();
  await expect(page.locator('[data-slot="payout-account-card"]')).toBeVisible();
  await expect(accountRows(page)).toHaveCount(1);
  await expect(page.getByText('Chưa dùng được tài khoản này')).toHaveCount(0);
});

test('tab khác vừa liên kết tài khoản trong lúc tab này nhập key khác: toast, form nhường chỗ cho danh sách đã liên kết', async ({
  page,
}) => {
  const { calls, state } = await openPage(page, { initial: CONNECTED });
  await chooser(page).getByRole('button', { name: 'Dùng key khác' }).click();
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toBeVisible();
  state.accounts = [linkedAccount(MB)];
  state.everLinked = true;
  await connectWith(page, EMPTY);
  await expect(page.getByText('BTC đã liên kết tài khoản nhận tiền nên không đổi key ở đây được.')).toBeVisible();
  await expect(page.locator('[data-slot="payout-account-card"]')).toBeVisible();
  await expect(accountRows(page)).toHaveCount(1);
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
  await expect(page.getByText('Chưa kết nối được Tingee')).toHaveCount(0);
  expect(posts(calls, '/credential')).toHaveLength(1);
});

test('danh sách có tài khoản: "Tải lại" + link portal dưới danh sách đọc lại danh sách', async ({ page }) => {
  const { calls, state } = await openPage(page, { initial: CONNECTED });
  await expect(optionRows(page)).toHaveCount(3);
  const footer = chooser(page).locator('[data-slot="payout-account-options-footer"]');
  await expect(footer.getByRole('link', { name: 'Mở portal Tingee' })).toHaveAttribute('href', PORTAL);
  state.tingee[MAIN.clientId]!.accounts = [VIETIN, MB, ACB, VCB];
  await footer.getByRole('button', { name: 'Tải lại' }).click();
  await expect(optionRows(page)).toHaveCount(4);
  expect(optionLoads(calls)).toHaveLength(2);
});

test('đọc danh sách: key bị thu hồi trên Tingee (422) → "Key Tingee không còn dùng được" + "Dùng key khác" mở form', async ({
  page,
}) => {
  await openPage(page, { initial: { ...CONNECTED, optionsError: 'invalid' } });
  await expect(chooserBanner(page)).toContainText('Key Tingee không còn dùng được');
  await expect(optionRows(page)).toHaveCount(0);
  await chooserBanner(page).getByRole('button', { name: 'Dùng key khác' }).click();
  await expect(page.getByRole('heading', { name: 'Nhập key Tingee khác' })).toBeVisible();
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toBeVisible();
});

test('đọc danh sách: Tingee tạm lỗi (503) → "Thử lại" hiện danh sách; "Tải lại" lỗi thì báo lỗi, vẫn giữ danh sách cũ', async ({
  page,
}) => {
  const { calls, state } = await openPage(page, { initial: { ...CONNECTED, optionsError: 'down' } });
  await expect(chooserBanner(page)).toContainText(PROVIDER_DOWN);
  expect(optionLoads(calls)).toHaveLength(1);
  state.optionsError = null;
  await chooserBanner(page).getByRole('button', { name: 'Thử lại' }).click();
  await expect(optionRows(page)).toHaveCount(3);
  await expect(chooserBanner(page)).toHaveCount(0);

  state.optionsError = 'down';
  await chooser(page).locator('[data-slot="payout-account-options-footer"]').getByRole('button', { name: 'Tải lại' }).click();
  await expect(chooserBanner(page)).toContainText('Chưa tải được danh sách tài khoản');
  await expect(chooserBanner(page)).toContainText(PROVIDER_DOWN);
  await expect(optionRows(page)).toHaveCount(3);
});

test('đã liên kết: thẻ tài khoản, URL IPN + "Sao chép" (toast), checklist hai bước; không có form hay danh sách', async ({
  page,
  browserName,
}) => {
  // Chromium headless chặn clipboard nếu không cấp quyền; WebKit cho phép sau thao tác người dùng.
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const { calls } = await openPage(page, { initial: { ...CONNECTED, accounts: [linkedAccount(MB)] } });
  const card = page.locator('[data-slot="payout-account-card"]');
  await expect(card).toContainText('Đã liên kết');
  await expect(card).toContainText('•••• 4321');
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
  await expect(chooser(page)).toHaveCount(0);
  expect(optionLoads(calls)).toHaveLength(0);

  const setup = page.locator('[data-slot="tingee-setup"]');
  await expect(setup.getByRole('heading', { name: 'Cấu hình trên Tingee' })).toBeVisible();
  await expect(field(page, 'URL IPN')).toHaveValue(IPN_URL);
  const steps = setup.locator('[data-slot="tingee-setup-steps"] li');
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(0)).toContainText('Đường dẫn IPN');
  await expect(steps.nth(0).getByRole('link', { name: 'portal Tingee' })).toHaveAttribute('href', PORTAL);
  await expect(steps.nth(1)).toContainText('Các Tài khoản cho phép thanh toán');
  await expect(steps.nth(1)).toContainText('chọn tài khoản MB Bank •••• 4321 rồi lưu.');

  await setup.getByRole('button', { name: 'Sao chép' }).click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (copied !== null) expect(copied).toBe(IPN_URL);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('nhiều tài khoản: thêm tài khoản thứ hai, đặt mặc định, hủy liên kết (kể cả tài khoản cuối) → quay về chọn tài khoản, banner hiện lại', async ({
  page,
}) => {
  const { calls, state } = await openPage(page, { initial: { ...CONNECTED, accounts: [linkedAccount(MB)] } });
  await expect(accountRows(page)).toHaveCount(1);
  await expect(banners(page)).toHaveCount(0);
  await expect(chooser(page)).toHaveCount(0);

  // Thêm tài khoản: danh sách đọc lại từ Tingee; MB hiện "Đã liên kết" thay cho nút; không có "Dùng key khác".
  await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
  await expect(chooser(page).getByRole('heading', { name: 'Thêm tài khoản nhận tiền' })).toBeVisible();
  await expect(optionRows(page)).toHaveCount(3);
  expect(optionLoads(calls)).toHaveLength(1);
  const mbOption = optionRow(page, 'MB Bank');
  await expect(mbOption).toHaveAttribute('data-linked', 'true');
  await expect(mbOption.locator('[data-slot="status-badge"]')).toHaveText('Đã liên kết');
  await expect(mbOption.getByRole('button')).toHaveCount(0);
  await expect(chooser(page).getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thêm tài khoản' })).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // "Đóng" rồi mở lại: danh sách lấy từ cache, không gọi Tingee lần nữa.
  await chooser(page).getByRole('button', { name: 'Đóng' }).click();
  await expect(chooser(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
  await expect(optionRows(page)).toHaveCount(3);
  expect(optionLoads(calls)).toHaveLength(1);

  await optionRow(page, 'ACB').getByRole('button', { name: 'Dùng tài khoản này' }).click();
  await expect(chooser(page)).toHaveCount(0);
  await expect(accountRows(page)).toHaveCount(2);
  expect(posts(calls).map((c) => c.body)).toEqual([{ vaAccountNumber: ACB.vaAccountNumber }]);
  await expect(accountRow(page, 'MB Bank').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  await expect(accountRow(page, 'ACB').locator('[data-slot="status-badge"]')).toHaveCount(0);
  // Checklist bước 2: chọn mọi tài khoản đã liên kết.
  const step2 = page.locator('[data-slot="tingee-setup-steps"] li').nth(1);
  await expect(step2).toContainText('mọi tài khoản đã liên kết');
  await expect(step2).toContainText('MB Bank •••• 4321');
  await expect(step2).toContainText('ACB •••• 2222');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // Mở lại "Thêm tài khoản": ACB vừa thêm hiện "Đã liên kết" (tính từ tổng quan, không từ cache danh sách), không gọi
  // Tingee lần nữa.
  const loadsBefore = optionLoads(calls).length;
  await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
  const acbOption = optionRow(page, 'ACB');
  await expect(acbOption).toHaveAttribute('data-linked', 'true');
  await expect(acbOption.locator('[data-slot="status-badge"]')).toHaveText('Đã liên kết');
  await expect(acbOption.getByRole('button')).toHaveCount(0);
  expect(optionLoads(calls)).toHaveLength(loadsBefore);
  await chooser(page).getByRole('button', { name: 'Đóng' }).click();
  await expect(chooser(page)).toHaveCount(0);

  // Đặt ACB làm mặc định: MB không còn là mặc định.
  await accountRow(page, 'ACB').getByRole('button', { name: 'Đặt làm mặc định' }).click();
  await expect(accountRow(page, 'ACB').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  await expect(accountRow(page, 'MB Bank').locator('[data-slot="status-badge"]')).toHaveCount(0);
  await expect(accountRow(page, 'MB Bank').getByRole('button', { name: 'Đặt làm mặc định' })).toBeVisible();
  expect(posts(calls, `/${state.accounts[1]!.id}/default`)).toHaveLength(1);

  // Hủy ACB (mặc định): Dialog nêu hậu quả; "Giữ tài khoản" không gọi api.
  await accountRow(page, 'ACB').getByRole('button', { name: 'Hủy liên kết' }).click();
  const dialog = unlinkDialog(page);
  await expect(dialog).toContainText('Đơn mới sẽ không nhận tiền vào ACB •••• 2222 nữa.');
  await expect(dialog).toContainText('MB Bank •••• 4321 sẽ thành tài khoản mặc định.');
  await expect(dialog).toContainText('Các Tài khoản cho phép thanh toán');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  await dialog.getByRole('button', { name: 'Giữ tài khoản' }).click();
  await expect(dialog).toHaveCount(0);
  const deletes = () => calls.filter((c) => c.method === 'DELETE');
  expect(deletes()).toHaveLength(0);

  await accountRow(page, 'ACB').getByRole('button', { name: 'Hủy liên kết' }).click();
  await unlinkDialog(page).getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(unlinkDialog(page)).toHaveCount(0);
  await expect(page.getByText('Đã hủy liên kết ACB •••• 2222.')).toBeVisible();
  await expect(accountRows(page)).toHaveCount(1);
  await expect(accountRow(page, 'MB Bank').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  await expect(banners(page)).toHaveCount(0);
  expect(deletes().map((c) => c.path)).toEqual([`/orgs/${ORG_ID}/payout-account/${accountId(1)}`]);

  // Hủy tài khoản cuối: Dialog báo BTC hết tài khoản; trang quay về chọn tài khoản, banner NOT_LINKED hiện lại.
  await accountRow(page, 'MB Bank').getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(unlinkDialog(page)).toContainText('BTC sẽ không còn tài khoản nhận tiền nào');
  await unlinkDialog(page).getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(chooser(page).getByRole('heading', { name: 'Chọn tài khoản nhận tiền' })).toBeVisible();
  await expect(page.locator('[data-slot="payout-account-card"]')).toHaveCount(0);
  await expect(banners(page).first()).toContainText(NOT_LINKED_TITLE);
  // Đã từng liên kết: không còn "Dùng key khác"; MB chọn lại được.
  await expect(chooser(page).getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
  await expect(optionRow(page, 'MB Bank').getByRole('button', { name: 'Dùng tài khoản này' })).toBeVisible();
  await expect(optionRow(page, 'ACB').getByRole('button', { name: 'Dùng tài khoản này' })).toBeVisible();
  expect(deletes()).toHaveLength(2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('hủy liên kết tài khoản mà tab khác đã hủy: toast "Tài khoản này đã được hủy liên kết.", danh sách đọc lại', async ({
  page,
}) => {
  const { state } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1)] },
  });
  await expect(accountRows(page)).toHaveCount(2);
  state.accounts = state.accounts.filter((a) => a.vaAccountNumber !== ACB.vaAccountNumber);
  await accountRow(page, 'ACB').getByRole('button', { name: 'Hủy liên kết' }).click();
  // ACB không phải mặc định: Đơn mới không bị ảnh hưởng.
  await expect(unlinkDialog(page)).toContainText(
    'ACB •••• 2222 không phải tài khoản mặc định nên Đơn mới không bị ảnh hưởng.',
  );
  await expect(unlinkDialog(page)).not.toContainText('sẽ thành tài khoản mặc định');
  await unlinkDialog(page).getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(page.getByText('Tài khoản này đã được hủy liên kết.')).toBeVisible();
  await expect(unlinkDialog(page)).toHaveCount(0);
  await expect(accountRows(page)).toHaveCount(1);
});

test('đặt mặc định tài khoản mà tab khác đã hủy: toast "Tài khoản này không còn được liên kết.", danh sách đọc lại', async ({
  page,
}) => {
  const { state } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1)] },
  });
  await expect(accountRows(page)).toHaveCount(2);
  state.accounts = state.accounts.filter((a) => a.vaAccountNumber !== ACB.vaAccountNumber);
  await accountRow(page, 'ACB').getByRole('button', { name: 'Đặt làm mặc định' }).click();
  await expect(page.getByText('Tài khoản này không còn được liên kết.')).toBeVisible();
  await expect(accountRows(page)).toHaveCount(1);
  await expect(accountRow(page, 'MB Bank').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
});

test('thêm tài khoản khi key bị thu hồi trên Tingee: banner gợi ý "Đổi key Tingee", không có "Dùng key khác"', async ({
  page,
}) => {
  await openPage(page, { initial: { ...CONNECTED, accounts: [linkedAccount(MB)], selectError: 'invalid' } });
  await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
  // Đang thêm tài khoản: "Đổi key Tingee" chỉ ở thẻ tài khoản nhận tiền, không lặp ở đầu danh sách.
  await expect(chooser(page).getByRole('button', { name: 'Đổi key Tingee' })).toHaveCount(0);
  await optionRow(page, 'ACB').getByRole('button', { name: 'Dùng tài khoản này' }).click();
  const banner = chooserBanner(page);
  await expect(banner).toContainText('Chưa dùng được tài khoản này');
  await expect(banner).toContainText(CREDENTIAL_REVOKED_LOCKED);
  await expect(banner.getByRole('button', { name: 'Đổi key Tingee' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
  await expect(accountRows(page)).toHaveCount(1);
});

test('đã từng liên kết rồi hủy hết: không có "Dùng key khác", không có form nhập key; có "Đổi key Tingee"', async ({
  page,
}) => {
  await openPage(page, { initial: { ...CONNECTED, everLinked: true } });
  await expect(optionRows(page)).toHaveCount(3);
  await expect(chooser(page).getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
  await expect(chooser(page).getByRole('button', { name: 'Đổi key Tingee' })).toBeVisible();
});

test('đã từng liên kết, key bị thu hồi trên Tingee: banner gợi ý "Đổi key Tingee" → xác nhận lại → form nhập key mới', async ({
  page,
}) => {
  const { reauthHeaders } = await openPage(page, {
    initial: { ...CONNECTED, everLinked: true, optionsError: 'invalid' },
    reauth: 'totp',
  });
  await expect(chooserBanner(page)).toContainText('Key Tingee không còn dùng được');
  await expect(chooserBanner(page)).toContainText(CREDENTIAL_REVOKED_LOCKED);
  await expect(page.getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
  await chooserBanner(page).getByRole('button', { name: 'Đổi key Tingee' }).click();
  await expect(reauthDialog(page)).toBeVisible();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(replaceKeyForm(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Đổi key Tingee' })).toBeVisible();
  expect(reauthHeaders).toEqual([null, 'tok-1']);
});

test('Admin mở URL: "Chỉ Owner xem được mục này.", không gọi api tài khoản nhận tiền', async ({ page }) => {
  const { calls } = await openPage(page, { role: 'admin', initial: { ...CONNECTED, accounts: [linkedAccount(MB)] } });
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
  // Story 2.13-a giữ nguyên 2.6: Admin không thấy nút đổi nơi nhận tiền (kể cả "Đổi key Tingee" của 2.13-b).
  await expect(page.getByRole('button', { name: 'Đặt làm mặc định' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hủy liên kết' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Đổi key Tingee' })).toHaveCount(0);
  expect(calls.filter((c) => c.path.startsWith(`/orgs/${ORG_ID}/payout-account`))).toHaveLength(0);
});

test('xác nhận lại bằng TOTP: "Đặt làm mặc định" mở dialog "Xác nhận để tiếp tục"; Hủy thì không đổi gì; mã sai báo tại ô; đúng → tự chạy tiếp', async ({
  page,
}) => {
  const { calls, identityCalls, reauthHeaders } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1, false)] },
    reauth: 'totp',
  });
  const defaults = () => posts(calls, `/${accountId(1)}/default`);

  // Đóng dialog bằng "Hủy": thao tác không chạy, không báo lỗi.
  await accountRow(page, 'ACB').getByRole('button', { name: 'Đặt làm mặc định' }).click();
  await expect(reauthDialog(page)).toBeVisible();
  await expect(reauthDialog(page)).toContainText('Mã 6 số trong ứng dụng xác thực');
  await expect(reauthDialog(page).getByRole('button', { name: /Gửi mã/ })).toHaveCount(0);
  await reauthDialog(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(reauthDialog(page)).toBeHidden();
  await expect(accountRow(page, 'MB Bank').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  await expect(page.getByText('Lỗi giả lập')).toHaveCount(0);
  expect(defaults()).toHaveLength(1);

  // Mã sai: báo tại ô, dialog vẫn mở; mã đúng: đặt mặc định chạy lại với lần xác nhận, không phải bấm lại.
  await accountRow(page, 'ACB').getByRole('button', { name: 'Đặt làm mặc định' }).click();
  await reauthBoxes(page).first().fill('000000');
  await expect(reauthDialog(page).getByText('Mã chưa đúng, còn 4 lần.')).toBeVisible();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(accountRow(page, 'ACB').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  await expect(page.getByText('ACB •••• 2222 là tài khoản mặc định.')).toBeVisible();
  expect(defaults()).toHaveLength(3);
  expect(reauthHeaders).toEqual([null, null, 'tok-1']);
  expect(identityCalls.filter((c) => c.path === '/identity/reauth').map((c) => c.body)).toEqual([
    { code: '000000' },
    { code: REAUTH_CODE },
  ]);
  expect(identityCalls.filter((c) => c.path === '/identity/reauth/email-code')).toHaveLength(0);

  // Hủy liên kết: Dialog hủy liên kết đóng, dialog xác nhận hiện; mã đúng → hủy chạy tiếp mà không bấm lại.
  await accountRow(page, 'MB Bank').getByRole('button', { name: 'Hủy liên kết' }).click();
  await unlinkDialog(page).getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(reauthDialog(page)).toBeVisible();
  await expect(unlinkDialog(page)).toHaveCount(0);
  // Form dựng lại cho yêu cầu mới: không còn lỗi cũ.
  await expect(reauthDialog(page).getByText('Mã chưa đúng')).toHaveCount(0);
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(page.getByText('Đã hủy liên kết MB Bank •••• 4321.')).toBeVisible();
  await expect(accountRows(page)).toHaveCount(1);
  await expect(unlinkDialog(page)).toHaveCount(0);
  const deletes = calls.filter((c) => c.method === 'DELETE');
  expect(deletes.map((c) => c.path)).toEqual([
    `/orgs/${ORG_ID}/payout-account/${accountId(0)}`,
    `/orgs/${ORG_ID}/payout-account/${accountId(0)}`,
  ]);
  expect(reauthHeaders.slice(-2)).toEqual([null, 'tok-2']);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('xác nhận lại bằng mã email (chưa bật 2FA): "Gửi mã tới {email}" → nhập mã → thao tác tự chạy tiếp, cả đặt mặc định lẫn hủy liên kết', async ({
  page,
}) => {
  const { identityCalls, reauthHeaders } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1, false)] },
    reauth: 'email_otp',
    // Ngắn để thấy đếm ngược ở lần xác nhận thứ hai mà test không phải chờ 60 giây.
    resendAfterSeconds: 8,
  });
  const emailCodes = () => identityCalls.filter((c) => c.path === '/identity/reauth/email-code');

  await accountRow(page, 'ACB').getByRole('button', { name: 'Đặt làm mặc định' }).click();
  const send = reauthDialog(page).getByRole('button', { name: `Gửi mã tới ${EMAIL}` });
  await expect(send).toBeVisible();
  // Chưa gửi thì chưa có ô nhập mã.
  await expect(reauthBoxes(page)).toHaveCount(0);
  expect(emailCodes()).toHaveLength(0);
  await send.click();
  await expect(reauthDialog(page).getByText(`Mã đã gửi tới ${EMAIL}`)).toBeVisible();
  await expect(reauthDialog(page).getByText(/Gửi lại mã sau \d+ giây/)).toBeVisible();
  await reauthBoxes(page).first().fill('111111');
  await expect(reauthDialog(page).getByText('Mã chưa đúng, còn 4 lần.')).toBeVisible();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(accountRow(page, 'ACB').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  expect(emailCodes()).toHaveLength(1);

  // Thao tác thứ hai ngay sau đó: mã cũ đã dùng, api còn chặn gửi lại → đếm ngược kèm lý do, nút gửi tắt tới hết giờ.
  await accountRow(page, 'ACB').getByRole('button', { name: 'Hủy liên kết' }).click();
  await unlinkDialog(page).getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(unlinkDialog(page)).toHaveCount(0);
  const resend = reauthDialog(page).getByRole('button', { name: `Gửi mã tới ${EMAIL}` });
  await expect(reauthDialog(page).getByText(/Gửi được mã mới sau \d+ giây/)).toBeVisible();
  await expect(resend).toBeDisabled();
  await expect(reauthBoxes(page)).toHaveCount(0);
  await expect(resend).toBeEnabled({ timeout: 12_000 });
  await resend.click();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(page.getByText('Đã hủy liên kết ACB •••• 2222.')).toBeVisible();
  await expect(accountRows(page)).toHaveCount(1);
  await expect(accountRow(page, 'MB Bank').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  expect(emailCodes()).toHaveLength(2);
  expect(reauthHeaders).toEqual([null, 'tok-1', null, 'tok-2']);
});

test('hủy liên kết cần xác nhận lại: đóng dialog xác nhận → không hủy, không báo lỗi; xác nhận xong mà api lỗi → toast "Chưa hủy liên kết được."', async ({
  page,
}) => {
  const { state, reauthHeaders } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1, false)] },
    reauth: 'totp',
  });

  // (a) Đóng dialog xác nhận: tài khoản còn nguyên, không toast lỗi, không banner lỗi trong Dialog hủy liên kết.
  await accountRow(page, 'ACB').getByRole('button', { name: 'Hủy liên kết' }).click();
  await unlinkDialog(page).getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(reauthDialog(page)).toBeVisible();
  await expect(unlinkDialog(page)).toHaveCount(0);
  await reauthDialog(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(reauthDialog(page)).toBeHidden();
  await expect(accountRows(page)).toHaveCount(2);
  await expect(page.getByText('Lỗi giả lập')).toHaveCount(0);
  await expect(page.getByText('Chưa hủy liên kết được')).toHaveCount(0);
  // Mở lại Dialog hủy liên kết: không còn lỗi cũ.
  await accountRow(page, 'ACB').getByRole('button', { name: 'Hủy liên kết' }).click();
  await expect(unlinkDialog(page)).toBeVisible();
  await expect(unlinkDialog(page).locator('[data-slot="status-banner"]')).toHaveCount(0);
  await unlinkDialog(page).getByRole('button', { name: 'Giữ tài khoản' }).click();
  expect(reauthHeaders).toEqual([null]);

  // (b) Xác nhận đúng nhưng hủy liên kết lỗi (không phải 404): Dialog hủy liên kết đã đóng nên báo bằng toast.
  state.unlinkFailure = true;
  await accountRow(page, 'ACB').getByRole('button', { name: 'Hủy liên kết' }).click();
  await unlinkDialog(page).getByRole('button', { name: 'Hủy liên kết' }).click();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(page.getByText('Chưa hủy liên kết được.', { exact: false })).toBeVisible();
  await expect(unlinkDialog(page)).toHaveCount(0);
  await expect(accountRows(page)).toHaveCount(2);
  expect(reauthHeaders).toEqual([null, null, 'tok-1']);
});

test('2FA vừa bật ở nơi khác: REAUTH_REQUIRED báo email_otp nhưng gửi mã → REAUTH_METHOD_MISMATCH {totp} → ô mã TOTP kèm lời báo; mã đúng → thao tác chạy tiếp', async ({
  page,
}) => {
  const { identityCalls, reauthHeaders } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1, false)] },
    reauth: 'totp',
    requiredMethod: 'email_otp',
  });
  await accountRow(page, 'ACB').getByRole('button', { name: 'Đặt làm mặc định' }).click();
  await reauthDialog(page).getByRole('button', { name: `Gửi mã tới ${EMAIL}` }).click();
  await expect(
    reauthDialog(page).getByText('Tài khoản đã bật xác thực hai lớp. Nhập mã trong ứng dụng xác thực.'),
  ).toBeVisible();
  await expect(reauthDialog(page)).toContainText('Mã 6 số trong ứng dụng xác thực');
  await expect(reauthDialog(page).getByRole('button', { name: /Gửi mã/ })).toHaveCount(0);
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(accountRow(page, 'ACB').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  expect(identityCalls.filter((c) => c.path === '/identity/reauth/email-code')).toHaveLength(1);
  expect(identityCalls.filter((c) => c.path === '/identity/reauth').map((c) => c.body)).toEqual([{ code: REAUTH_CODE }]);
  expect(reauthHeaders).toEqual([null, 'tok-1']);
});

async function enterNewKey(page: Page, key: { clientId: string; secretToken: string }) {
  await field(page, 'Client ID').fill(key.clientId);
  await field(page, 'Secret Token').fill(key.secretToken);
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
}

test('đổi key Tingee: bấm nút → xác nhận lại ngay; key sai báo tại form; key đúng → danh sách; "Lưu" → chỉ còn tài khoản mới (mặc định), Client ID mới che, URL IPN giữ nguyên', async ({
  page,
}) => {
  const { calls, reauthHeaders } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1, false)] },
    reauth: 'totp',
  });
  const keyRow = page.locator('[data-slot="tingee-key"]');
  await expect(keyRow).toContainText('Client ID ••••2c3d');

  // Dialog xác nhận lại hiện ngay khi bấm; mã đúng → form nhập key mới (chưa gọi Tingee, chưa đổi gì).
  await keyRow.getByRole('button', { name: 'Đổi key Tingee' }).click();
  await expect(reauthDialog(page)).toBeVisible();
  await expect(replaceKeyForm(page)).toHaveCount(0);
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  await expect(replaceKeyForm(page)).toBeVisible();
  await expect(field(page, 'Secret Token')).toHaveAttribute('type', 'password');
  await expect(field(page, 'Secret Token')).toHaveAttribute('autocomplete', 'new-password');
  // Lỗi tại ô, không gọi api.
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(page.getByText('Nhập Client ID.')).toBeVisible();
  expect(posts(calls, '/credential/replacement/preview')).toHaveLength(0);

  // Key sai: lỗi tại form, dữ liệu giữ nguyên, không tiêu lần xác nhận.
  await enterNewKey(page, { clientId: NEXT.clientId, secretToken: 'tg-secret-sai' });
  await expect(replaceKeyForm(page).getByText(CREDENTIAL_INVALID)).toBeVisible();
  await expect(field(page, 'Client ID')).toHaveValue(NEXT.clientId);
  await expect(field(page, 'Secret Token')).toHaveValue('tg-secret-sai');

  // Key đúng (dán kèm khoảng trắng): danh sách của key mới; VietinBank mờ, không chọn được.
  await field(page, 'Secret Token').fill(` ${NEXT.secretToken} `);
  await page.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  const accounts = replaceKeyAccounts(page);
  await expect(accounts).toContainText('Client ID ••••7c6d');
  await expect(accounts.locator('[data-slot="replace-key-consequences"]')).toContainText(
    'mọi tài khoản nhận tiền hiện tại bị hủy liên kết',
  );
  await expect(accounts.getByRole('radio', { name: /Vietcombank/ })).toBeEnabled();
  await expect(accounts.getByRole('radio', { name: /VietinBank/ })).toBeDisabled();
  await expect(accounts).toContainText('Chưa hỗ trợ VietinBank');
  expect(posts(calls, '/credential/replacement/preview').map((c) => c.body)).toEqual([
    { clientId: NEXT.clientId, secretToken: 'tg-secret-sai' },
    { clientId: NEXT.clientId, secretToken: NEXT.secretToken },
  ]);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // "Lưu" chưa chọn tài khoản: báo tại chỗ, không gọi api.
  await accounts.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(accounts.getByText('Chọn một tài khoản nhận tiền.')).toBeVisible();
  expect(replacements(calls)).toHaveLength(0);

  await accounts.getByRole('radio', { name: /Vietcombank/ }).check();
  await accounts.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Đã đổi key Tingee.')).toBeVisible();
  await expect(replaceKeyAccounts(page)).toHaveCount(0);
  // Chỉ còn tài khoản mới (mặc định) và Client ID mới dạng che; URL IPN giữ nguyên.
  await expect(accountRows(page)).toHaveCount(1);
  await expect(accountRow(page, 'Vietcombank').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  await expect(keyRow).toContainText('Client ID ••••7c6d');
  await expect(field(page, 'URL IPN')).toHaveValue(IPN_URL);
  expect(replacements(calls).map((c) => c.body)).toEqual([
    { clientId: NEXT.clientId, secretToken: NEXT.secretToken, vaAccountNumber: VCB.vaAccountNumber },
  ]);
  // begin (không header → dialog, rồi lần xác nhận), hai lần xem trước và lần lưu cùng mang lần xác nhận đó.
  expect(reauthHeaders).toEqual([null, 'tok-1', 'tok-1', 'tok-1', 'tok-1']);
  expect(await page.content()).not.toContain(NEXT.secretToken);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('đổi key Tingee: quá 5 phút thì dialog hiện lại lúc lưu (đóng → không làm gì); lưu lỗi vì key bị thu hồi → báo tại chỗ; "Hủy" → key và tài khoản cũ giữ nguyên', async ({
  page,
}) => {
  const { calls, state, issued, reauthHeaders } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1, false)] },
    reauth: 'totp',
  });
  await page.getByRole('button', { name: 'Đổi key Tingee' }).click();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(replaceKeyForm(page)).toBeVisible();
  await enterNewKey(page, NEXT);
  const accounts = replaceKeyAccounts(page);
  await accounts.getByRole('radio', { name: /Vietcombank/ }).check();

  // Lần xác nhận hết hạn: "Lưu" → dialog hiện lại; đóng dialog thì vẫn ở danh sách, không báo lỗi.
  issued.clear();
  await accounts.getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(reauthDialog(page)).toBeVisible();
  await reauthDialog(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(reauthDialog(page)).toBeHidden();
  await expect(accounts).toBeVisible();
  await expect(accounts.locator('[data-slot="status-banner"]')).toHaveCount(0);

  // Xác nhận lại xong, lần lưu tự chạy tiếp với lần xác nhận mới; key bị thu hồi → báo tại chỗ.
  state.replaceError = 'invalid';
  await accounts.getByRole('button', { name: 'Lưu', exact: true }).click();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();
  const banner = accounts.locator('[data-slot="status-banner"]');
  await expect(banner).toContainText('Chưa đổi được key Tingee');
  await expect(banner).toContainText('Key và tài khoản nhận tiền hiện tại vẫn giữ nguyên.');
  await expect(banner.getByRole('button', { name: 'Nhập key khác' })).toBeVisible();
  expect(replacements(calls)).toHaveLength(3);
  expect(reauthHeaders.slice(-3)).toEqual(['tok-1', 'tok-1', 'tok-2']);

  // "Nhập key khác": về form với key mới vẫn điền sẵn; tài khoản đã chọn không còn được giữ.
  await banner.getByRole('button', { name: 'Nhập key khác' }).click();
  await expect(replaceKeyForm(page)).toBeVisible();
  await expect(field(page, 'Client ID')).toHaveValue(NEXT.clientId);
  await expect(field(page, 'Secret Token')).toHaveValue(NEXT.secretToken);
  await expect(replaceKeyAccounts(page)).toHaveCount(0);

  // "Hủy": quay về màn cũ; key, tài khoản và tài khoản mặc định cũ không đổi.
  await replaceKeyForm(page).getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(replaceKeyForm(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="tingee-key"]')).toContainText('Client ID ••••2c3d');
  await expect(accountRows(page)).toHaveCount(2);
  await expect(accountRow(page, 'MB Bank').locator('[data-slot="status-badge"]')).toHaveText('Mặc định');
  expect(await page.content()).not.toContain(NEXT.secretToken);
});

test('đổi key Tingee: tài khoản đã chọn không còn trên Tingee lúc lưu → báo tại chỗ; "Tải lại" đọc lại danh sách của key mới (không còn tài khoản đó)', async ({
  page,
}) => {
  const { calls, state } = await openPage(page, {
    initial: { ...CONNECTED, accounts: [linkedAccount(MB), linkedAccount(ACB, 1, false)] },
    reauth: 'totp',
  });
  await page.getByRole('button', { name: 'Đổi key Tingee' }).click();
  await reauthBoxes(page).first().fill(REAUTH_CODE);
  await enterNewKey(page, NEXT);
  const accounts = replaceKeyAccounts(page);
  await accounts.getByRole('radio', { name: /Vietcombank/ }).check();

  // VCB bị gỡ khỏi tài khoản Tingee của key mới (BTC liên kết thêm ACB) trước khi bấm "Lưu".
  state.tingee[NEXT.clientId]!.accounts = [VIETIN, ACB];
  await accounts.getByRole('button', { name: 'Lưu', exact: true }).click();
  const banner = accounts.locator('[data-slot="status-banner"]');
  await expect(banner).toContainText('Chưa đổi được key Tingee');
  await expect(banner).toContainText(
    'Tài khoản này không còn dùng được trên Tingee. Tải lại danh sách rồi chọn tài khoản khác.',
  );
  await expect(accounts.getByRole('radio', { name: /Vietcombank/ })).toBeChecked();
  const previews = () => posts(calls, '/credential/replacement/preview');
  expect(previews()).toHaveLength(1);

  await banner.getByRole('button', { name: 'Tải lại' }).click();
  await expect(accounts.getByRole('radio', { name: /Vietcombank/ })).toHaveCount(0);
  await expect(accounts.getByRole('radio', { name: /ACB/ })).toBeEnabled();
  await expect(accounts.getByRole('radio', { name: /ACB/ })).not.toBeChecked();
  await expect(accounts.locator('[data-slot="status-banner"]')).toHaveCount(0);
  expect(previews()).toHaveLength(2);
  expect(previews().at(-1)?.body).toEqual({ clientId: NEXT.clientId, secretToken: NEXT.secretToken });
  // Không có gì được lưu: key và tài khoản cũ vẫn hiện hành.
  expect(state.clientId).toBe(MAIN.clientId);
  expect(state.accounts.map((a) => a.bankName)).toEqual(['MB Bank', 'ACB']);
});

test.describe('dịch vụ thanh toán bị ngắt (Story 4.2-b)', () => {
  test.use({ timezoneId: 'America/New_York' });

  const block = (page: Page) => page.locator('[data-slot="payment-service-block"]');
  const checkButton = (page: Page) => block(page).getByRole('button', { name: 'Kiểm tra lại' });
  const checks = (calls: Call[]) =>
    calls.filter((c) => c.method === 'POST' && c.path === `/orgs/${ORG_ID}/payment-service/check`);
  const LINKED = { ...CONNECTED, accounts: [linkedAccount(MB)] };
  const PAUSED = 'Mọi Sự kiện có phí đang Tạm ngừng bán.';

  const REASONS = [
    {
      reason: 'token',
      text: 'Tingee báo đã hết Token (gói dịch vụ hết hạn).',
      guide: 'Mua thêm Token trên portal Tingee rồi bấm Kiểm tra lại.',
      link: { name: 'Mở portal Tingee', href: PORTAL },
    },
    {
      reason: 'tingee_disabled',
      text: 'Tingee đang tạm ngừng dịch vụ thanh toán của BTC.',
      guide: 'Liên hệ Tingee để mở lại dịch vụ. Tickee tự kiểm tra mỗi 5 phút; bạn cũng có thể bấm Kiểm tra lại.',
      link: null,
    },
    {
      reason: 'credential_invalid',
      text: 'Key Tingee không còn dùng được.',
      guide: 'Key có thể đã bị thu hồi hoặc đổi trên Tingee. Đổi key Tingee để bán lại.',
      link: null,
    },
    {
      reason: 'gateway_permission_missing',
      text: 'Key Tingee chưa được cấp quyền Cổng thanh toán.',
      guide:
        'Cấp quyền “Cổng thanh toán” cho key trên portal Tingee rồi bấm Kiểm tra lại. Tickee không tự kiểm tra được quyền này; nếu vẫn thiếu, lần bán vé kế tiếp sẽ tạm ngừng lại.',
      link: { name: 'Mở trang API key trên Tingee', href: `${PORTAL}/api-credentials` },
    },
  ];

  test('BTC hoạt động bình thường: không có khối "Dịch vụ thanh toán"', async ({ page }) => {
    await openPage(page, { initial: LINKED });
    await expect(page.locator('[data-slot="payout-account-card"]')).toBeVisible();
    await expect(block(page)).toHaveCount(0);
  });

  test('khối theo lý do: badge danger, lý do, "Từ …", lần kiểm tra gần nhất (giờ Việt Nam), hướng dẫn; đặt trên nội dung trang', async ({
    page,
  }) => {
    const { state } = await openPage(page, { initial: { ...LINKED, paymentService: suspended('token') } });
    for (const copy of REASONS) {
      state.paymentService = suspended(copy.reason, copy.reason === 'tingee_disabled' ? CHECKED_AT : null);
      await page.reload();
      const b = block(page);
      await expect(b.getByRole('heading', { name: 'Dịch vụ thanh toán', level: 2 })).toBeVisible();
      await expect(b.locator('[data-slot="status-badge"]')).toHaveText('Tạm ngừng bán');
      await expect(b.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'danger');
      await expect(b.locator('[data-slot="payment-service-reason"]'), copy.reason).toHaveText(`${copy.text} ${PAUSED}`);
      const times = b.locator('[data-slot="payment-service-times"]');
      await expect(times).toContainText('Từ 10:04 13/11/2026');
      await expect(times, copy.reason).toContainText(
        copy.reason === 'tingee_disabled' ? 'Lần kiểm tra gần nhất: 10:20 13/11/2026' : 'Chưa kiểm tra',
      );
      const guide = b.locator('[data-slot="payment-service-guide"]');
      await expect(guide, copy.reason).toContainText(copy.guide);
      if (copy.link) {
        const link = guide.getByRole('link', { name: copy.link.name });
        await expect(link).toHaveAttribute('href', copy.link.href);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      } else {
        await expect(guide.getByRole('link'), copy.reason).toHaveCount(0);
      }
      await expect(checkButton(page)).toBeVisible();
      await expect(b.getByRole('button', { name: 'Đổi key Tingee' }), copy.reason).toHaveCount(
        copy.reason === 'credential_invalid' ? 1 : 0,
      );
      // Banner của dải trên cùng vẫn hiện (khối là chỗ xử lý).
      await expect(banners(page).first()).toHaveAttribute('data-tone', 'danger');
    }
    // Khối nằm trên nội dung trang (thẻ tài khoản nhận tiền).
    const blockBox = await block(page).boundingBox();
    const cardBox = await page.locator('[data-slot="payout-account-card"]').boundingBox();
    expect(blockBox!.y + blockBox!.height).toBeLessThanOrEqual(cardBox!.y);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('"Kiểm tra lại": toast đúng câu cho từng outcome; lỗi mạng/5xx → toast lỗi, bấm lại được; not_suspended → khối biến mất', async ({
    page,
  }) => {
    const { calls } = await openPage(page, {
      initial: {
        ...LINKED,
        paymentService: suspended('tingee_disabled'),
        checkReplies: [
          { outcome: 'still_suspended' },
          { outcome: 'cooldown', retryAfterSeconds: 12 },
          { outcome: 'unknown' },
          { outcome: 'no_target' },
          { error: 503 },
          { outcome: 'not_suspended' },
        ],
      },
    });
    await expect(block(page)).toContainText('Chưa kiểm tra');

    await checkButton(page).click();
    await expect(page.getByText('Tingee vẫn đang ngắt dịch vụ thanh toán.')).toBeVisible();
    // Lần kiểm tra vừa rồi hiện ngay (giờ Việt Nam), không cần tải lại trang.
    await expect(block(page)).toContainText('Lần kiểm tra gần nhất: 10:20 13/11/2026');

    await checkButton(page).click();
    await expect(page.getByText('Vừa kiểm tra xong. Thử lại sau 12 giây.')).toBeVisible();
    await checkButton(page).click();
    await expect(page.getByText('Chưa kiểm tra được với Tingee. Thử lại sau ít phút.')).toBeVisible();
    await checkButton(page).click();
    await expect(page.getByText('BTC chưa có tài khoản nhận tiền mặc định.')).toBeVisible();
    await checkButton(page).click();
    await expect(page.getByText('Lỗi giả lập')).toBeVisible();
    await expect(block(page)).toBeVisible();
    await expect(checkButton(page)).toBeEnabled();

    // Đường khác vừa mở lại (Quản trị Tingee, job dò): khối và banner biến mất.
    await checkButton(page).click();
    await expect(page.getByText('Dịch vụ thanh toán đang hoạt động.')).toBeVisible();
    await expect(block(page)).toHaveCount(0);
    await expect(banners(page)).toHaveCount(0);
    expect(checks(calls)).toHaveLength(6);
  });

  test('"Kiểm tra lại" → resumed: spinner, chặn bấm lặp; toast, khối và banner biến mất không cần tải lại trang', async ({
    page,
  }) => {
    const { calls, state } = await openPage(page, {
      initial: { ...LINKED, paymentService: suspended('token'), checkReplies: [{ outcome: 'resumed' }], checkDelayMs: 800 },
    });
    await expect(banners(page).first()).toContainText('Mọi Sự kiện có phí đang Tạm ngừng bán');
    await checkButton(page).click();
    await expect(checkButton(page)).toHaveAttribute('aria-busy', 'true');
    await checkButton(page).click({ force: true });
    await expect(page.getByText('Dịch vụ thanh toán đã hoạt động lại. Sự kiện có phí bán lại bình thường.')).toBeVisible();
    await expect(block(page)).toHaveCount(0);
    await expect(banners(page)).toHaveCount(0);
    expect(checks(calls)).toHaveLength(1);
    expect(state.paymentService.status).toBe('active');
  });

  test('credential_invalid: "Đổi key Tingee" trong khối → xác nhận lại → luồng đổi key có sẵn; lưu key mới → khối biến mất', async ({
    page,
  }) => {
    const { reauthHeaders } = await openPage(page, {
      initial: { ...LINKED, paymentService: suspended('credential_invalid') },
      reauth: 'totp',
    });
    await block(page).getByRole('button', { name: 'Đổi key Tingee' }).click();
    await expect(reauthDialog(page)).toBeVisible();
    await reauthBoxes(page).first().fill(REAUTH_CODE);
    await expect(reauthDialog(page)).toBeHidden();
    await expect(replaceKeyForm(page)).toBeVisible();
    // Luồng đổi key đang mở: khối không lặp lại nút.
    await expect(block(page).getByRole('button', { name: 'Đổi key Tingee' })).toHaveCount(0);

    await enterNewKey(page, NEXT);
    const accounts = replaceKeyAccounts(page);
    await accounts.getByRole('radio', { name: /Vietcombank/ }).check();
    await accounts.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(page.getByText('Đã đổi key Tingee.')).toBeVisible();
    await expect(block(page)).toHaveCount(0);
    await expect(banners(page)).toHaveCount(0);
    expect(reauthHeaders[0]).toBeNull();
  });

  test('cờ đổi khi đang mở trang: org_status_changed qua stream cấp BTC → khối và banner hiện rồi biến mất, không tải lại trang', async ({
    page,
  }) => {
    const sse = await fakeEventSource(page, { url: ORG_LIVE_URL });
    const { state } = await openPage(page, { initial: LINKED });
    await expect(block(page)).toHaveCount(0);
    await expect.poll(sse.count).toBe(1);
    await sse.open();

    state.paymentService = suspended('gateway_permission_missing');
    await sse.message('org_status_changed');
    await expect(block(page)).toContainText('Key Tingee chưa được cấp quyền Cổng thanh toán.', { timeout: 3_000 });
    await expect(banners(page).first()).toContainText('Key Tingee chưa được cấp quyền Cổng thanh toán');

    state.paymentService = ACTIVE_SERVICE;
    await sse.message('org_status_changed');
    await expect(block(page)).toHaveCount(0, { timeout: 3_000 });
    await expect(banners(page)).toHaveCount(0);
    expect(await sse.count()).toBe(1);
  });

  test('không có SSE: banner đổi ở lần polling 10 giây → khối cũng cập nhật', async ({ page }) => {
    test.setTimeout(45_000);
    const { state } = await openPage(page, { initial: LINKED });
    await expect(block(page)).toHaveCount(0);
    state.paymentService = suspended('tingee_disabled');
    await expect(banners(page).first()).toContainText('Tingee đang tạm ngừng dịch vụ thanh toán của BTC', {
      timeout: 12_000,
    });
    await expect(block(page)).toContainText('Tingee đang tạm ngừng dịch vụ thanh toán của BTC.', { timeout: 3_000 });
  });

  test('Admin: không có khối, không gọi "Kiểm tra lại"; banner chỉ có câu nhờ Owner', async ({ page }) => {
    const { calls } = await openPage(page, {
      role: 'admin',
      initial: { ...LINKED, paymentService: suspended('credential_invalid') },
    });
    await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
    await expect(block(page)).toHaveCount(0);
    await expect(banners(page).first()).toContainText('Nhờ Owner cập nhật key Tingee.');
    await expect(banners(page).first().getByRole('link')).toHaveCount(0);
    expect(checks(calls)).toHaveLength(0);
    expect(calls.filter((c) => c.path.startsWith(`/orgs/${ORG_ID}/payout-account`))).toHaveLength(0);
  });
});
