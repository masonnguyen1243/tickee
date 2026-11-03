import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID, statusNotice } from './organizer-mock';

/*
 * Trang Tài khoản nhận tiền (Story 2.6) với API giả có trạng thái, kịch bản theo 4 số cuối số tài khoản như Tingee fake
 * của api: …0000 liên kết ngay · …1111 cần OTP (đúng 123456, 000000 hết hạn) · …4343 thông tin sai · …8181 đã dùng nơi
 * khác · …5000 Tingee tạm lỗi lần đầu. Ngân hàng OCB (970448) giả lập `BANK_NOT_SUPPORTED`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const PAGE_PATH = `/btc/${ORG_ID}/tai-khoan-nhan-tien`;
const CONTACT_PHONE = '0901234567';
const ATTEMPT_ID = '019a3b2c-0100-7abc-8def-0123456789ab';
const NOT_LINKED_TITLE = 'Chưa liên kết tài khoản nhận tiền';

type Account = {
  id: string;
  status: 'linking' | 'awaiting_otp' | 'linked' | 'failed';
  bankBin: string;
  accountType: 'personal-account';
  accountLast4: string;
  accountName: string;
  vaAccountNumber: string | null;
  failureCode: string | null;
  createdAt: string;
  linkedAt: string | null;
};

type LinkBody = { bankBin: string; accountNumber: string; accountName: string; identityNumber: string; phone: string };

async function openPage(page: Page, { role = 'owner', initial = null }: { role?: string; initial?: Account | null } = {}) {
  const state: { current: Account | null; attempts: number; providerDown: boolean } = {
    current: initial,
    attempts: 0,
    providerDown: true,
  };
  const attempt = (body: LinkBody, status: Account['status']): Account => {
    state.attempts += 1;
    const linked = status === 'linked';
    return {
      id: `019a3b2c-01${String(state.attempts).padStart(2, '0')}-7abc-8def-0123456789ab`,
      status,
      bankBin: body.bankBin,
      accountType: 'personal-account',
      accountLast4: body.accountNumber.slice(-4),
      accountName: body.accountName,
      vaAccountNumber: linked ? '9600000042' : null,
      failureCode: null,
      createdAt: '2026-11-03T03:00:00.000Z',
      linkedAt: linked ? '2026-11-03T03:00:01.000Z' : null,
    };
  };
  const fail = (body: LinkBody, reply: Reply): Reply => {
    state.current = { ...attempt(body, 'failed'), failureCode: (reply.body as { error: { code: string } }).error.code };
    return reply;
  };

  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role, contactPhone: CONTACT_PHONE }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role }] }),
    [`GET /orgs/${ORG_ID}/notices`]: () => {
      const status = state.current?.status;
      if (status === 'linked') return { status: 200, body: [] };
      return {
        status: 200,
        body: [statusNotice(status === 'awaiting_otp' ? 'PAYOUT_ACCOUNT_LINKING' : 'PAYOUT_ACCOUNT_NOT_LINKED')],
      };
    },
    [`GET /orgs/${ORG_ID}/payout-account`]: () => ({ status: 200, body: { current: state.current } }),
    [`POST /orgs/${ORG_ID}/payout-account`]: (request) => {
      const body = request.postDataJSON() as LinkBody;
      if (state.current?.status === 'linked') return apiError(409, 'PAYOUT_ACCOUNT_ALREADY_LINKED');
      if (body.bankBin === '970448') return apiError(422, 'BANK_NOT_SUPPORTED', { field: 'bankBin' });
      const suffix = body.accountNumber.slice(-4);
      if (suffix === '4343') return fail(body, apiError(422, 'PAYOUT_ACCOUNT_INVALID'));
      if (suffix === '8181') return fail(body, apiError(409, 'PAYOUT_ACCOUNT_IN_USE', { field: 'accountNumber' }));
      if (suffix === '5000' && state.providerDown) {
        state.providerDown = false;
        return fail(body, apiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE'));
      }
      state.current = attempt(body, suffix === '1111' ? 'awaiting_otp' : 'linked');
      return { status: 200, body: state.current };
    },
    [`POST /orgs/${ORG_ID}/payout-account/otp`]: (request) => {
      const { otp } = request.postDataJSON() as { attemptId: string; otp: string };
      if (!state.current || state.current.status !== 'awaiting_otp') return apiError(409, 'BANK_OTP_EXPIRED', { field: 'otp' });
      if (otp === '000000') {
        state.current = { ...state.current, status: 'failed', failureCode: 'BANK_OTP_EXPIRED' };
        return apiError(409, 'BANK_OTP_EXPIRED', { field: 'otp' });
      }
      if (otp !== '123456') return apiError(422, 'BANK_OTP_INVALID', { field: 'otp' });
      state.current = { ...state.current, status: 'linked', vaAccountNumber: '9600000042', linkedAt: '2026-11-03T03:01:00.000Z' };
      return { status: 200, body: state.current };
    },
  });
  await page.goto(PAGE_PATH);
  await expect(page.getByRole('heading', { name: 'Tài khoản nhận tiền', level: 1 })).toBeVisible();
  return { calls, state };
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const linkPosts = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === `/orgs/${ORG_ID}/payout-account`);
const banners = (page: Page) => page.locator('[data-slot="status-banner-stack"] [data-slot="status-banner"]');
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function fillForm(page: Page, accountNumber: string, { bankBin = '970422' } = {}) {
  await field(page, 'Ngân hàng').selectOption(bankBin);
  await field(page, 'Số tài khoản').fill(accountNumber);
  await field(page, 'Tên chủ tài khoản').fill('Nguyễn Văn Đạt');
  await field(page, 'Số CCCD').fill('079203001234');
}

const submit = (page: Page, name = 'Liên kết') => page.getByRole('button', { name, exact: true }).click();

test('chưa liên kết: form điền sẵn SĐT liên hệ; lỗi tại ô không gọi api; liên kết ngay → thẻ "Đã liên kết", banner biến mất', async ({
  page,
}) => {
  const { calls } = await openPage(page);
  await expect(banners(page).first()).toContainText(NOT_LINKED_TITLE);
  await expect(field(page, 'SĐT đăng ký Tingee')).toHaveValue(CONTACT_PHONE);
  // Danh sách ngân hàng: 5 ngân hàng luồng form + OTP, không có VietinBank.
  const options = await field(page, 'Ngân hàng').locator('option:not([disabled])').allTextContents();
  expect(options).toEqual(['BIDV', 'MB', 'ACB', 'VPBank', 'OCB']);

  await submit(page);
  await expect(page.getByText('Chọn ngân hàng của tài khoản.')).toBeVisible();
  await expect(page.getByText('Nhập số tài khoản.')).toBeVisible();
  await expect(page.getByText('Nhập số CCCD của chủ tài khoản.')).toBeVisible();
  await field(page, 'Số CCCD').fill('123');
  await submit(page);
  await expect(page.getByText('Số CCCD gồm 12 chữ số.')).toBeVisible();
  await expect(field(page, 'Số CCCD')).toHaveAttribute('aria-invalid', 'true');
  expect(linkPosts(calls)).toHaveLength(0);

  await fillForm(page, '0123 450 000');
  // Tên chủ tài khoản tự in hoa khi gõ.
  await expect(field(page, 'Tên chủ tài khoản')).toHaveValue('NGUYỄN VĂN ĐẠT');
  await submit(page);

  const card = page.locator('[data-slot="payout-account-card"]');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-slot="status-badge"]')).toHaveText('Đã liên kết');
  await expect(card.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success');
  await expect(card).toContainText('MB');
  await expect(card).toContainText('•••• 0000');
  await expect(card).toContainText('NGUYEN VAN DAT');
  await expect(card).toContainText('9600000042');
  await expect(card).not.toContainText('0123450000');
  expect(linkPosts(calls).map((c) => c.body)).toEqual([
    {
      bankBin: '970422',
      accountNumber: '0123450000',
      accountName: 'NGUYEN VAN DAT',
      identityNumber: '079203001234',
      phone: CONTACT_PHONE,
    },
  ]);
  await expect(page.getByText('Đã liên kết tài khoản nhận tiền.')).toBeVisible();
  await expect(banners(page)).toHaveCount(0);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('cần OTP: "Đang liên kết" + ô OTP; mã sai → lỗi tại ô; quay lại trang vẫn nhập tiếp; mã đúng → đã liên kết', async ({
  page,
}) => {
  await openPage(page);
  await fillForm(page, '0123451111');
  await submit(page);

  const step = page.locator('[data-slot="payout-account-otp"]');
  await expect(step).toBeVisible();
  await expect(step.locator('[data-slot="status-badge"]')).toHaveText('Đang liên kết');
  await expect(step.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
  await expect(step).toContainText('•••• 1111');
  await expect(banners(page).first()).toContainText('Đang liên kết tài khoản nhận tiền');

  await field(page, 'Mã OTP').fill('999999');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.getByText('Mã OTP chưa đúng. Kiểm tra tin nhắn ngân hàng rồi nhập lại.')).toBeVisible();
  await expect(field(page, 'Mã OTP')).toHaveAttribute('aria-invalid', 'true');

  await page.reload();
  await expect(step).toBeVisible();
  await field(page, 'Mã OTP').fill('123456');
  await page.getByRole('button', { name: 'Xác nhận' }).click();
  await expect(page.locator('[data-slot="payout-account-card"]')).toContainText('Đã liên kết');
  await expect(banners(page)).toHaveCount(0);
});

test('OTP hết hạn: form điền sẵn trừ CCCD, nút "Gửi lại" tạo lần thử mới', async ({ page }) => {
  const { calls } = await openPage(page);
  await fillForm(page, '0123451111');
  await submit(page);
  await field(page, 'Mã OTP').fill('000000');
  await page.getByRole('button', { name: 'Xác nhận' }).click();

  await expect(page.getByText('Mã OTP đã hết hạn')).toBeVisible();
  await expect(field(page, 'Ngân hàng')).toHaveValue('970422');
  await expect(field(page, 'Số tài khoản')).toHaveValue('0123451111');
  await expect(field(page, 'Tên chủ tài khoản')).toHaveValue('NGUYỄN VĂN ĐẠT');
  await expect(field(page, 'SĐT đăng ký Tingee')).toHaveValue(CONTACT_PHONE);
  await expect(field(page, 'Số CCCD')).toHaveValue('');

  await field(page, 'Số CCCD').fill('079203001234');
  await submit(page, 'Gửi lại');
  await expect(page.locator('[data-slot="payout-account-otp"]')).toBeVisible();
  expect(linkPosts(calls)).toHaveLength(2);
});

test('lỗi: ngân hàng không hỗ trợ → tại ô ngân hàng; tài khoản đã dùng → tại ô số tài khoản; thông tin sai → tại form; dữ liệu giữ nguyên', async ({
  page,
}) => {
  await openPage(page);
  await fillForm(page, '0123450000', { bankBin: '970448' });
  await submit(page);
  await expect(page.getByText('Ngân hàng này chưa được hỗ trợ. Chọn ngân hàng khác.')).toBeVisible();
  await expect(field(page, 'Ngân hàng')).toHaveAttribute('aria-invalid', 'true');

  await field(page, 'Ngân hàng').selectOption('970422');
  await field(page, 'Số tài khoản').fill('0123458181');
  await submit(page);
  await expect(page.getByText('Tài khoản này đã được liên kết ở nơi khác. Dùng tài khoản khác.')).toBeVisible();
  await expect(field(page, 'Số tài khoản')).toHaveAttribute('aria-invalid', 'true');

  await field(page, 'Số tài khoản').fill('0123454343');
  await submit(page);
  await expect(page.getByText('Chưa liên kết được tài khoản')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await expect(field(page, 'Số tài khoản')).toHaveValue('0123454343');
  await expect(field(page, 'Số CCCD')).toHaveValue('079203001234');
});

test('Tingee tạm lỗi: "Tingee tạm lỗi, thử lại sau ít phút" + "Thử lại" giữ dữ liệu → liên kết được', async ({ page }) => {
  const { calls } = await openPage(page);
  await fillForm(page, '0123455000');
  await submit(page);
  await expect(page.getByText('Tingee tạm lỗi, thử lại sau ít phút.')).toBeVisible();
  await expect(field(page, 'Số tài khoản')).toHaveValue('0123455000');

  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('[data-slot="payout-account-card"]')).toBeVisible();
  expect(linkPosts(calls)).toHaveLength(2);
});

test('đã liên kết: mở trang thấy thẻ tài khoản, không có form', async ({ page }) => {
  await openPage(page, {
    initial: {
      id: ATTEMPT_ID,
      status: 'linked',
      bankBin: '970418',
      accountType: 'personal-account',
      accountLast4: '1234',
      accountName: 'TRAN THI BINH',
      vaAccountNumber: '9600000007',
      failureCode: null,
      createdAt: '2026-11-03T03:00:00.000Z',
      linkedAt: '2026-11-03T03:00:01.000Z',
    },
  });
  const card = page.locator('[data-slot="payout-account-card"]');
  await expect(card).toContainText('BIDV');
  await expect(card).toContainText('•••• 1234');
  await expect(card).toContainText('TRAN THI BINH');
  await expect(page.locator('[data-slot="payout-account-form"]')).toHaveCount(0);
});

test('lần thử trước thất bại (tải lại trang): form nêu lý do, nhập được và gửi lại được', async ({ page }) => {
  const { calls } = await openPage(page, {
    initial: {
      id: ATTEMPT_ID,
      status: 'failed',
      bankBin: '970422',
      accountType: 'personal-account',
      accountLast4: '8181',
      accountName: 'NGUYEN VAN DAT',
      vaAccountNumber: null,
      failureCode: 'PAYOUT_ACCOUNT_IN_USE',
      createdAt: '2026-11-03T03:00:00.000Z',
      linkedAt: null,
    },
  });
  const form = page.locator('[data-slot="payout-account-form"]');
  await expect(form).toContainText('Chưa liên kết được tài khoản');
  await expect(form).toContainText('Tài khoản này đã được liên kết ở nơi khác. Dùng tài khoản khác.');
  // Điền sẵn ngân hàng và tên từ lần thử trước; các ô vẫn nhập được.
  await expect(field(page, 'Ngân hàng')).toHaveValue('970422');
  await expect(field(page, 'Tên chủ tài khoản')).toHaveValue('NGUYEN VAN DAT');
  await field(page, 'Số tài khoản').fill('0123450000');
  await field(page, 'Số CCCD').fill('079203001234');
  await submit(page);
  await expect(page.locator('[data-slot="payout-account-card"]')).toBeVisible();
  expect(linkPosts(calls)).toHaveLength(1);
});

test('Admin mở URL: "Chỉ Owner xem được mục này.", không gọi api tài khoản nhận tiền', async ({ page }) => {
  const { calls } = await openPage(page, { role: 'admin' });
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
  await expect(page.locator('[data-slot="payout-account-form"]')).toHaveCount(0);
  expect(calls.filter((c) => c.path === `/orgs/${ORG_ID}/payout-account`)).toHaveLength(0);
});
