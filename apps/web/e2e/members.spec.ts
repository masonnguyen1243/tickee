import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, EMAIL, me, mockIdentityApi, USER_ID, type Call, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID, OTHER_ORG_ID } from './organizer-mock';

/*
 * Trang Thành viên (Story 2.4) với API giả: mời Admin (kể cả qua lớp hai giữa chừng rồi gửi lại), thu hồi lời mời,
 * xóa Admin, và `Dialog` khi bị xóa khỏi BTC giữa phiên.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const OTHER_NAME = 'Giải Chạy Bộ Sáng';
const base = `/btc/${ORG_ID}`;
const MEMBERS_PATH = `${base}/thanh-vien`;
const ADMIN_EMAIL = 'binh.tran@vidu.vn';
const ADMIN_MEMBER_ID = '019a3b2c-0002-7abc-8def-0123456789ab';
const PENDING_ID = '019a3b2c-0003-7abc-8def-0123456789ab';
const EXPIRED_ID = '019a3b2c-0004-7abc-8def-0123456789ab';
const NEW_ID = '019a3b2c-0005-7abc-8def-0123456789ab';

type Member = { id: string; userId: string; role: 'owner' | 'admin'; email: string; name: string; joinedAt: string };
type Invitation = { id: string; email: string; expiresAt: string; expired: boolean; createdAt: string };

function initialState(): { members: Member[]; invitations: Invitation[] } {
  return {
    members: [
      { id: '019a3b2c-0001-7abc-8def-0123456789ab', userId: USER_ID, role: 'owner', email: EMAIL, name: '', joinedAt: CONSENTED },
      {
        id: ADMIN_MEMBER_ID,
        userId: '019a3b2c-1111-7abc-8def-0123456789ab',
        role: 'admin',
        email: ADMIN_EMAIL,
        name: 'Trần Bình',
        joinedAt: '2026-10-30T01:02:03.000Z',
      },
    ],
    invitations: [
      {
        id: PENDING_ID,
        email: 'cuong.le@vidu.vn',
        expiresAt: '2026-11-08T03:00:00.000Z',
        expired: false,
        createdAt: '2026-11-01T03:00:00.000Z',
      },
      {
        id: EXPIRED_ID,
        email: 'dung.pham@vidu.vn',
        expiresAt: '2026-10-25T03:00:00.000Z',
        expired: true,
        createdAt: '2026-10-18T03:00:00.000Z',
      },
    ],
  };
}

const totpRequired = (): Reply => apiError(403, 'TOTP_REQUIRED', { reason: 'step_up' });

/** Mở trang Thành viên với API giả có trạng thái; `inviteReply` thay phản hồi mặc định (201) của POST mời. */
async function openMembers(
  page: Page,
  {
    inviteReply,
    twoFactorEnabled = false,
    steppedUp = () => undefined,
  }: { inviteReply?: (email: string) => Reply | null; twoFactorEnabled?: boolean; steppedUp?: () => void } = {},
) {
  const state = initialState();
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, twoFactorEnabled),
    'POST /identity/totp/step-up': () => {
      steppedUp();
      return { status: 200, body: { stepUpAt: '2026-11-02T03:00:00.000Z' } };
    },
  });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization(),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: 'owner' }] }),
    [`GET /orgs/${ORG_ID}/members`]: () => ({ status: 200, body: state }),
    [`POST /orgs/${ORG_ID}/invitations`]: (request) => {
      const { email } = request.postDataJSON() as { email: string };
      const custom = inviteReply?.(email);
      if (custom) return custom;
      const invitation: Invitation = {
        id: NEW_ID,
        email,
        expiresAt: '2026-11-09T03:00:00.000Z',
        expired: false,
        createdAt: '2026-11-02T03:00:00.000Z',
      };
      state.invitations.unshift(invitation);
      return { status: 201, body: invitation };
    },
    [`DELETE /orgs/${ORG_ID}/invitations/${PENDING_ID}`]: () => {
      state.invitations = state.invitations.filter((i) => i.id !== PENDING_ID);
      return { status: 204 };
    },
    [`DELETE /orgs/${ORG_ID}/members/${ADMIN_MEMBER_ID}`]: () => {
      state.members = state.members.filter((m) => m.id !== ADMIN_MEMBER_ID);
      return { status: 204 };
    },
  });
  await page.goto(MEMBERS_PATH);
  await expect(page.getByRole('heading', { name: 'Thành viên', level: 1 })).toBeVisible();
  return calls;
}

const memberRow = (page: Page, email: string) => page.locator('[data-slot="member-row"]').filter({ hasText: email });
const invitationRow = (page: Page, email: string) =>
  page.locator('[data-slot="invitation-row"]').filter({ hasText: email });
const emailInput = (page: Page) => page.getByRole('textbox', { name: 'Email' });
const sendButton = (page: Page) => page.getByRole('button', { name: 'Mời', exact: true });
const callsTo = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('danh sách: Owner không có nút Xóa, Admin có; lời mời chờ hiện hạn hoặc "Đã hết hạn" kèm "Thu hồi"; không cuộn ngang', async ({
  page,
}) => {
  await openMembers(page);
  await expect(memberRow(page, EMAIL)).toContainText('Owner');
  await expect(memberRow(page, EMAIL).getByRole('button')).toHaveCount(0);
  await expect(memberRow(page, ADMIN_EMAIL)).toContainText('Admin');
  await expect(memberRow(page, ADMIN_EMAIL)).toContainText('Trần Bình');
  await expect(memberRow(page, ADMIN_EMAIL).getByRole('button', { name: `Xóa ${ADMIN_EMAIL}` })).toBeVisible();

  await expect(invitationRow(page, 'cuong.le@vidu.vn')).toContainText(/Hết hạn .*2026/);
  await expect(invitationRow(page, 'cuong.le@vidu.vn')).not.toContainText('Đã hết hạn');
  await expect(invitationRow(page, 'dung.pham@vidu.vn')).toContainText('Đã hết hạn');
  for (const email of ['cuong.le@vidu.vn', 'dung.pham@vidu.vn']) {
    await expect(invitationRow(page, email).getByRole('button', { name: `Thu hồi lời mời tới ${email}` })).toBeVisible();
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test('mời: email sai dạng → lỗi tại ô, không gọi api; hợp lệ → POST email đã chuẩn hóa, toast, ô trống, lời mời hiện trong danh sách', async ({
  page,
}) => {
  const calls = await openMembers(page);
  const invites = () => callsTo(calls, 'POST', `/orgs/${ORG_ID}/invitations`);

  await sendButton(page).click();
  await expect(page.getByText('Nhập email người bạn muốn mời.')).toBeVisible();
  await emailInput(page).fill('khong-phai-email');
  await sendButton(page).click();
  await expect(page.getByText('Email chưa đúng định dạng.')).toBeVisible();
  await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');
  expect(invites()).toHaveLength(0);

  await emailInput(page).fill('  Em.Hoang@Vidu.VN ');
  await expect(page.getByText('Email chưa đúng định dạng.')).toHaveCount(0);
  await sendButton(page).click();
  await expect(page.getByText('Đã gửi lời mời tới em.hoang@vidu.vn.')).toBeVisible();
  expect(invites().map((c) => c.body)).toEqual([{ email: 'em.hoang@vidu.vn' }]);
  await expect(emailInput(page)).toHaveValue('');
  await expect(invitationRow(page, 'em.hoang@vidu.vn')).toBeVisible();
});

test('mời email đã là thành viên → lỗi tại ô; quá giới hạn 24 giờ → banner; lỗi máy chủ → banner "Thử lại" giữ email', async ({
  page,
}) => {
  let reply: Reply | null = apiError(409, 'ALREADY_A_MEMBER', { field: 'email' });
  const calls = await openMembers(page, { inviteReply: () => reply });

  await emailInput(page).fill(ADMIN_EMAIL);
  await sendButton(page).click();
  await expect(page.getByText('Email này đã là thành viên của BTC.')).toBeVisible();
  await expect(emailInput(page)).toHaveAttribute('aria-invalid', 'true');

  reply = apiError(429, 'INVITATION_LIMIT_REACHED');
  await emailInput(page).fill('moi@vidu.vn');
  await sendButton(page).click();
  await expect(page.getByText('Đã đạt giới hạn lời mời')).toBeVisible();
  await expect(page.getByText('Mỗi BTC gửi tối đa 20 lời mời trong 24 giờ. Vui lòng thử lại sau.')).toBeVisible();

  reply = apiError(500, 'INTERNAL_ERROR');
  await sendButton(page).click();
  await expect(page.getByText('Chưa gửi được lời mời')).toBeVisible();
  await expect(emailInput(page)).toHaveValue('moi@vidu.vn');
  reply = null;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Đã gửi lời mời tới moi@vidu.vn.')).toBeVisible();
  await expect(page.getByText('Chưa gửi được lời mời')).toHaveCount(0);
  expect(callsTo(calls, 'POST', `/orgs/${ORG_ID}/invitations`)).toHaveLength(4);
});

test('mời khi session chưa qua lớp hai: TOTP_REQUIRED → dialog "Xác thực hai lớp", ô email giữ nguyên; nhập mã → tự gửi lại, toast', async ({
  page,
}) => {
  let steppedUpOk = false;
  const calls = await openMembers(page, {
    twoFactorEnabled: true,
    steppedUp: () => {
      steppedUpOk = true;
    },
    inviteReply: () => (steppedUpOk ? null : totpRequired()),
  });
  const stepUpDialog = page.getByRole('dialog', { name: 'Xác thực hai lớp' });

  await emailInput(page).fill('giang.vo@vidu.vn');
  await sendButton(page).click();
  await expect(stepUpDialog).toBeVisible();
  // Dialog modal ẩn phần còn lại khỏi cây trợ năng: tìm ô theo DOM.
  await expect(page.locator('input[name="email"]')).toHaveValue('giang.vo@vidu.vn');
  await expect(page.getByText('Chưa gửi được lời mời')).toHaveCount(0);

  await stepUpDialog.getByRole('group', { name: /Mã 6 số/ }).locator('input').first().fill('123456');
  await expect(stepUpDialog).toBeHidden();
  await expect(page.getByText('Đã gửi lời mời tới giang.vo@vidu.vn.')).toBeVisible();
  const invites = callsTo(calls, 'POST', `/orgs/${ORG_ID}/invitations`);
  expect(invites).toHaveLength(2);
  expect(invites.map((c) => c.body)).toEqual([{ email: 'giang.vo@vidu.vn' }, { email: 'giang.vo@vidu.vn' }]);
  await expect(invitationRow(page, 'giang.vo@vidu.vn')).toBeVisible();
  await expect(emailInput(page)).toHaveValue('');
});

test('thu hồi: DELETE đúng lời mời, lời mời rời danh sách, toast', async ({ page }) => {
  const calls = await openMembers(page);
  await invitationRow(page, 'cuong.le@vidu.vn').getByRole('button', { name: /Thu hồi/ }).click();
  await expect(page.getByText('Đã thu hồi lời mời tới cuong.le@vidu.vn.')).toBeVisible();
  await expect(invitationRow(page, 'cuong.le@vidu.vn')).toHaveCount(0);
  await expect(invitationRow(page, 'dung.pham@vidu.vn')).toBeVisible();
  expect(callsTo(calls, 'DELETE', `/orgs/${ORG_ID}/invitations/${PENDING_ID}`)).toHaveLength(1);
});

test('xóa Admin: Dialog nêu hậu quả; Hủy không gọi api; Xóa → DELETE, toast, Admin rời danh sách', async ({ page }) => {
  const calls = await openMembers(page);
  const dialog = page.getByRole('dialog', { name: 'Xóa Admin khỏi BTC?' });
  const deletes = () => callsTo(calls, 'DELETE', `/orgs/${ORG_ID}/members/${ADMIN_MEMBER_ID}`);

  await memberRow(page, ADMIN_EMAIL).getByRole('button', { name: `Xóa ${ADMIN_EMAIL}` }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`${ADMIN_EMAIL} sẽ không còn quản lý Sự kiện, Đơn và các mục khác của ${ORG_NAME}.`);
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
  expect(deletes()).toHaveLength(0);

  await memberRow(page, ADMIN_EMAIL).getByRole('button', { name: `Xóa ${ADMIN_EMAIL}` }).click();
  await dialog.getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Đã xóa ${ADMIN_EMAIL} khỏi BTC.`)).toBeVisible();
  await expect(memberRow(page, ADMIN_EMAIL)).toHaveCount(0);
  await expect(memberRow(page, EMAIL)).toBeVisible();
  expect(deletes()).toHaveLength(1);
});

/** Admin đang ở dashboard; `removed()` bật thì API trả NOT_A_MEMBER cho BTC này. */
async function openAsAdmin(page: Page, remaining: { organizationId: string; name: string; role: string }[]) {
  let removed = false;
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => (removed ? apiError(403, 'NOT_A_MEMBER') : organization({ role: 'admin' })),
    [`GET /orgs/${OTHER_ORG_ID}`]: () => organization({ id: OTHER_ORG_ID, name: OTHER_NAME, role: 'owner' }),
    'GET /me/memberships': () => ({
      status: 200,
      body: removed ? remaining : [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }, ...remaining],
    }),
  });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: ORG_NAME })).toBeVisible();
  return {
    calls,
    /** Bị xóa rồi request kế tiếp (tải lại BTC khi quay lại tab sau `staleTime`) nhận NOT_A_MEMBER. */
    async removeAndRefetch() {
      removed = true;
      await page.clock.setFixedTime(Date.now() + 60_000);
      await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    },
  };
}

const removedDialog = (page: Page) => page.getByRole('dialog', { name: `Bạn không còn là thành viên của ${ORG_NAME}.` });

test('bị xóa giữa phiên: Dialog không đóng được; "Đồng ý" → BTC đầu tiên còn lại', async ({ page }) => {
  const admin = await openAsAdmin(page, [{ organizationId: OTHER_ORG_ID, name: OTHER_NAME, role: 'owner' }]);
  await admin.removeAndRefetch();

  await expect(removedDialog(page)).toBeVisible();
  await expect(removedDialog(page).getByRole('button', { name: 'Đóng' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(removedDialog(page)).toBeVisible();

  await removedDialog(page).getByRole('button', { name: 'Đồng ý' }).click();
  await page.waitForURL(`**/btc/${OTHER_ORG_ID}`);
  await expect(page.getByRole('heading', { name: OTHER_NAME })).toBeVisible();
  await expect(removedDialog(page)).toHaveCount(0);
});

test('bị xóa giữa phiên, không còn BTC nào: "Đồng ý" → trang chủ', async ({ page }) => {
  const admin = await openAsAdmin(page, []);
  await admin.removeAndRefetch();
  await removedDialog(page).getByRole('button', { name: 'Đồng ý' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(removedDialog(page)).toHaveCount(0);
});

test('mở BTC lần đầu đã không có quyền: giữ empty-state, không có Dialog', async ({ page }) => {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  await mockOrganizerApi(page, { [`GET /orgs/${OTHER_ORG_ID}`]: () => apiError(403, 'NOT_A_MEMBER') });
  await page.goto(`/btc/${OTHER_ORG_ID}`);
  await expect(page.getByText('Bạn không có quyền xem BTC này.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
