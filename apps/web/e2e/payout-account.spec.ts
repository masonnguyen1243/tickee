import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID, statusNotice } from './organizer-mock';

/*
 * Trang Tài khoản nhận tiền (Story 2.6): BTC dùng tài khoản merchant Tingee của chính mình. API giả có trạng thái, "Tingee"
 * giả theo cặp key như Tingee fake của api: MAIN có MB (chọn được) và VietinBank (mờ) · EMPTY chưa có tài khoản ·
 * FLAKY lần đầu Tingee tạm lỗi. Key khác hoặc secret sai → `TINGEE_CREDENTIAL_INVALID`.
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
type Account = Omit<Option, 'selectable'> & { id: string; linkedAt: string };

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

const MAIN = { clientId: 'tg-client-main-0a1b2c3d', secretToken: 'tg-secret-main-Zx9Yw8Vu7' };
const EMPTY = { clientId: 'tg-client-empty-8c9d0e1f', secretToken: 'tg-secret-empty-Nm3Lk2Ji1' };
const FLAKY = { clientId: 'tg-client-flaky-4e5f6a7b', secretToken: 'tg-secret-flaky-Ts6Rq5Po4' };

const credentialOf = (clientId: string, n: number): Credential => ({
  id: `019a3b2c-02${String(n).padStart(2, '0')}-7abc-8def-0123456789ab`,
  clientIdMasked: `••••${clientId.slice(-4)}`,
  connectedAt: '2026-11-03T03:00:00.000Z',
});

const linkedAccount = (option: Option): Account => {
  const { selectable: _selectable, ...rest } = option;
  return { ...rest, id: '019a3b2c-0300-7abc-8def-0123456789ab', linkedAt: '2026-11-03T03:05:00.000Z' };
};

type State = {
  credential: Credential | null;
  /** Client ID của credential hiện hành (api biết, web không biết). */
  clientId: string | null;
  account: Account | null;
  /** Tài khoản "Tingee" của từng key; sửa được giữa chừng (BTC liên kết thêm trên portal). */
  tingee: Record<string, { secretToken: string; accounts: Option[] }>;
  /** VA đã bị tắt trên Tingee sau khi danh sách hiện. */
  unavailable: Set<string>;
  flakyFailures: number;
  /** `GET …/options` lỗi: key bị thu hồi trên Tingee (422) hoặc Tingee tạm lỗi (503). */
  optionsError: 'invalid' | 'down' | null;
};

async function openPage(page: Page, { role = 'owner', initial = {} }: { role?: string; initial?: Partial<State> } = {}) {
  const state: State = {
    credential: null,
    clientId: null,
    account: null,
    tingee: {
      [MAIN.clientId]: { secretToken: MAIN.secretToken, accounts: [MB, VIETIN] },
      [EMPTY.clientId]: { secretToken: EMPTY.secretToken, accounts: [] },
      [FLAKY.clientId]: { secretToken: FLAKY.secretToken, accounts: [VCB] },
    },
    unavailable: new Set(),
    flakyFailures: 1,
    optionsError: null,
    ...initial,
  };
  let connections = 0;
  const optionsOf = () => ({ credential: state.credential, accounts: state.tingee[state.clientId!]!.accounts });

  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role }] }),
    [`GET /orgs/${ORG_ID}/notices`]: () => ({
      status: 200,
      body: state.account ? [] : [statusNotice('PAYOUT_ACCOUNT_NOT_LINKED')],
    }),
    [`GET /orgs/${ORG_ID}/payout-account`]: () => ({
      status: 200,
      body: {
        credential: state.credential,
        account: state.account,
        ipnUrl: state.credential ? IPN_URL : null,
        tingeePortalUrl: PORTAL,
      },
    }),
    [`POST /orgs/${ORG_ID}/payout-account/credential`]: (request) => {
      const { clientId, secretToken } = request.postDataJSON() as { clientId: string; secretToken: string };
      if (state.account) return apiError(409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
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
      if (state.account) return apiError(409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
      if (!state.credential) return apiError(404, 'NOT_FOUND');
      const option = optionsOf().accounts.find((a) => a.vaAccountNumber === vaAccountNumber);
      if (!option || state.unavailable.has(vaAccountNumber)) return apiError(409, 'PAYOUT_ACCOUNT_UNAVAILABLE');
      if (!option.selectable) return apiError(422, 'BANK_NOT_SUPPORTED');
      state.account = linkedAccount(option);
      return { status: 200, body: state.account };
    },
  });
  await page.goto(PAGE_PATH);
  await expect(page.getByRole('heading', { name: 'Tài khoản nhận tiền', level: 1 })).toBeVisible();
  return { calls, state };
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
  await expect(optionRows(page)).toHaveCount(2);
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
  await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Đã liên kết');
  await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success');
  await expect(card).toContainText('MB Bank');
  await expect(card).toContainText('•••• 4321');
  await expect(card).toContainText('CLB CO VUA QUAN 3');
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
  await expect(optionRows(page)).toHaveCount(2);
  expect(optionLoads(calls)).toHaveLength(1);
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);

  await chooser(page).getByRole('button', { name: 'Dùng key khác' }).click();
  await expect(page.getByRole('heading', { name: 'Nhập key Tingee khác' })).toBeVisible();
  await page.getByRole('button', { name: 'Hủy' }).click();
  await expect(optionRows(page)).toHaveCount(2);

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

test('tab khác đã liên kết: chọn tài khoản → toast "BTC đã có tài khoản nhận tiền.", trang chuyển sang thẻ đã liên kết', async ({
  page,
}) => {
  const { state } = await openPage(page, { initial: CONNECTED });
  await expect(optionRows(page)).toHaveCount(2);
  state.account = linkedAccount(MB);
  await optionRow(page, 'MB Bank').getByRole('button', { name: 'Dùng tài khoản này' }).click();
  await expect(page.getByText('BTC đã có tài khoản nhận tiền.')).toBeVisible();
  await expect(page.locator('[data-slot="payout-account-card"]')).toBeVisible();
  await expect(page.getByText('Chưa dùng được tài khoản này')).toHaveCount(0);
});

test('danh sách có tài khoản: "Tải lại" + link portal dưới danh sách đọc lại danh sách', async ({ page }) => {
  const { calls, state } = await openPage(page, { initial: CONNECTED });
  await expect(optionRows(page)).toHaveCount(2);
  const footer = chooser(page).locator('[data-slot="payout-account-options-footer"]');
  await expect(footer.getByRole('link', { name: 'Mở portal Tingee' })).toHaveAttribute('href', PORTAL);
  state.tingee[MAIN.clientId]!.accounts = [VIETIN, MB, VCB];
  await footer.getByRole('button', { name: 'Tải lại' }).click();
  await expect(optionRows(page)).toHaveCount(3);
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
  await expect(optionRows(page)).toHaveCount(2);
  await expect(chooserBanner(page)).toHaveCount(0);

  state.optionsError = 'down';
  await chooser(page).locator('[data-slot="payout-account-options-footer"]').getByRole('button', { name: 'Tải lại' }).click();
  await expect(chooserBanner(page)).toContainText('Chưa tải được danh sách tài khoản');
  await expect(chooserBanner(page)).toContainText(PROVIDER_DOWN);
  await expect(optionRows(page)).toHaveCount(2);
});

test('đã liên kết: thẻ tài khoản, URL IPN + "Sao chép" (toast), checklist hai bước; không có form hay danh sách', async ({
  page,
  browserName,
}) => {
  // Chromium headless chặn clipboard nếu không cấp quyền; WebKit cho phép sau thao tác người dùng.
  if (browserName === 'chromium') await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const { calls } = await openPage(page, {
    initial: { credential: credentialOf(MAIN.clientId, 1), clientId: MAIN.clientId, account: linkedAccount(MB) },
  });
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
  await expect(steps.nth(1)).toContainText('MB Bank •••• 4321');

  await setup.getByRole('button', { name: 'Sao chép' }).click();
  await expect(page.getByText('Đã sao chép')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (copied !== null) expect(copied).toBe(IPN_URL);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('Admin mở URL: "Chỉ Owner xem được mục này.", không gọi api tài khoản nhận tiền', async ({ page }) => {
  const { calls } = await openPage(page, { role: 'admin' });
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
  await expect(page.locator('[data-slot="tingee-connect-form"]')).toHaveCount(0);
  expect(calls.filter((c) => c.path.startsWith(`/orgs/${ORG_ID}/payout-account`))).toHaveLength(0);
});
