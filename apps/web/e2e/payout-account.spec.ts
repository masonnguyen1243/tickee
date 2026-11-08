import type { Page, Request } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, EMAIL, me, mockIdentityApi, type Call, type Handler } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID, statusNotice } from './organizer-mock';

/*
 * Trang Tài khoản nhận tiền (Story 2.6): BTC dùng tài khoản merchant Tingee của chính mình, liên kết một hay nhiều tài
 * khoản, đặt mặc định và hủy liên kết. API giả có trạng thái như api thật, "Tingee" giả theo cặp key như Tingee fake của
 * api: MAIN có MB (chọn được), VietinBank (mờ) và ACB (chọn được) · EMPTY chưa có tài khoản · FLAKY lần đầu Tingee tạm
 * lỗi. Key khác hoặc secret sai → `TINGEE_CREDENTIAL_INVALID`.
 *
 * Story 2.13-a: với `reauth`, hủy liên kết và đặt mặc định đòi header `x-reauth-token` (thiếu hay đã dùng →
 * `REAUTH_REQUIRED`), cấp bởi `/identity/reauth` giả: mã đúng là `123456`.
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
};

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
    },
    unavailable: new Set(),
    flakyFailures: 1,
    optionsError: null,
    selectError: null,
    unlinkFailure: false,
    ...initial,
  };
  let connections = 0;
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
  });
  // Xác nhận lại như api (Story 2.13-a): mỗi token dùng một lần; `reauthHeaders` ghi header của mọi lần gọi thao tác.
  const issued = new Set<string>();
  const reauthHeaders: (string | null)[] = [];
  const reauthGranted = (request: Request) => {
    const token = request.headers()['x-reauth-token'] ?? null;
    reauthHeaders.push(token);
    if (!reauth) return true;
    if (!token || !issued.has(token)) return false;
    issued.delete(token);
    return true;
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
    [`GET /orgs/${ORG_ID}/notices`]: () => ({
      status: 200,
      body: state.accounts.length > 0 ? [] : [statusNotice('PAYOUT_ACCOUNT_NOT_LINKED')],
    }),
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
    ...accountRoutes,
  });
  await page.goto(PAGE_PATH);
  await expect(page.getByRole('heading', { name: 'Tài khoản nhận tiền', level: 1 })).toBeVisible();
  return { calls, state, identityCalls, reauthHeaders };
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

test('thêm tài khoản khi key bị thu hồi trên Tingee: banner chỉ đường sang portal, không có "Dùng key khác"', async ({
  page,
}) => {
  await openPage(page, { initial: { ...CONNECTED, accounts: [linkedAccount(MB)], selectError: 'invalid' } });
  await page.getByRole('button', { name: 'Thêm tài khoản' }).click();
  await optionRow(page, 'ACB').getByRole('button', { name: 'Dùng tài khoản này' }).click();
  const banner = chooserBanner(page);
  await expect(banner).toContainText('Chưa dùng được tài khoản này');
  await expect(banner).toContainText('Kiểm tra API key trên portal Tingee.');
  await expect(banner.getByRole('link', { name: 'Mở portal Tingee' })).toHaveAttribute('href', PORTAL);
  await expect(page.getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
  await expect(accountRows(page)).toHaveCount(1);
});

test('đã từng liên kết rồi hủy hết: không có "Dùng key khác", không có form nhập key', async ({ page }) => {
  await openPage(page, { initial: { ...CONNECTED, everLinked: true } });
  await expect(optionRows(page)).toHaveCount(3);
  await expect(chooser(page).getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
});

test('đã từng liên kết, key bị thu hồi trên Tingee: banner chỉ đường sang portal, không có "Dùng key khác"', async ({
  page,
}) => {
  await openPage(page, { initial: { ...CONNECTED, everLinked: true, optionsError: 'invalid' } });
  await expect(chooserBanner(page)).toContainText('Key Tingee không còn dùng được');
  await expect(chooserBanner(page)).toContainText('Kiểm tra API key trên portal Tingee.');
  await expect(chooserBanner(page).getByRole('link', { name: 'Mở portal Tingee' })).toHaveAttribute('href', PORTAL);
  await expect(page.getByRole('button', { name: 'Dùng key khác' })).toHaveCount(0);
});

test('Admin mở URL: "Chỉ Owner xem được mục này.", không gọi api tài khoản nhận tiền', async ({ page }) => {
  const { calls } = await openPage(page, { role: 'admin', initial: { ...CONNECTED, accounts: [linkedAccount(MB)] } });
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
  // Story 2.13-a giữ nguyên 2.6: Admin không thấy nút đổi nơi nhận tiền.
  await expect(page.getByRole('button', { name: 'Đặt làm mặc định' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hủy liên kết' })).toHaveCount(0);
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
