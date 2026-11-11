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

  // expiresAt 2026-11-08T03:00:00Z = 10:00 giờ Việt Nam.
  await expect(invitationRow(page, 'cuong.le@vidu.vn')).toContainText('Hết hạn 10:00 08/11/2026');
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

// ---------------------------------------------------------------------------------------------------------------
// Story 2.14: chuyển quyền Owner
// ---------------------------------------------------------------------------------------------------------------

const REAUTH_CODE = '123456';
const TRANSFER_PATH = `/orgs/${ORG_ID}/members/${ADMIN_MEMBER_ID}/ownership-transfer`;
const transferSection = (page: Page) =>
  page.getByRole('region', { name: 'Chuyển quyền Owner' });
const transferDialog = (page: Page) => page.getByRole('dialog', { name: 'Chuyển quyền Owner?' });
const reauthDialog = (page: Page) => page.getByRole('dialog', { name: 'Xác nhận để tiếp tục' });

/**
 * Trang Thành viên với API giả cho luồng chuyển quyền: 2FA đã bật (xác nhận lại bằng TOTP, mã đúng `123456`), POST
 * chuyển quyền đòi header `x-reauth-token` (thiếu hay đã dùng → `REAUTH_REQUIRED`). Chuyển xong thì vai của người xem
 * thành `admin` ở mọi API. `transferReply` thay phản hồi sau khi đã qua xác nhận lại.
 */
async function openForTransfer(
  page: Page,
  {
    withAdmin = true,
    transferReply,
  }: { withAdmin?: boolean; transferReply?: (demote: () => void) => Reply | null } = {},
) {
  const state = initialState();
  if (!withAdmin) state.members = state.members.filter((m) => m.role === 'owner');
  let role: 'owner' | 'admin' = 'owner';
  const issued = new Set<string>();
  const transferHeaders: (string | null)[] = [];
  let grants = 0;
  await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/reauth': (request) => {
      if ((request.postDataJSON() as { code: string }).code !== REAUTH_CODE) {
        return apiError(400, 'TOTP_INVALID', { remainingAttempts: 4 });
      }
      grants += 1;
      const reauthToken = `tok-${grants}`;
      issued.add(reauthToken);
      return { status: 200, body: { reauthToken, expiresAt: '2026-11-09T03:09:00.000Z' } };
    },
  });
  const calls = await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role }] }),
    [`GET /orgs/${ORG_ID}/members`]: () =>
      role === 'owner' ? { status: 200, body: state } : apiError(403, 'FORBIDDEN_ROLE'),
    [`POST ${TRANSFER_PATH}`]: (request) => {
      const token = request.headers()['x-reauth-token'] ?? null;
      transferHeaders.push(token);
      if (!token || !issued.has(token)) return apiError(403, 'REAUTH_REQUIRED', { method: 'totp' });
      issued.delete(token);
      const custom = transferReply?.(() => {
        role = 'admin';
      });
      if (custom) return custom;
      role = 'admin';
      state.members = state.members.map((m) => ({ ...m, role: m.id === ADMIN_MEMBER_ID ? 'owner' : 'admin' }));
      return { status: 204 };
    },
  });
  await page.goto(MEMBERS_PATH);
  await expect(page.getByRole('heading', { name: 'Thành viên', level: 1 })).toBeVisible();
  return { calls, state, transferHeaders };
}

test('chuyển quyền: BTC chưa có Admin → nút tắt kèm "Mời một Admin trước rồi chuyển quyền."', async ({ page }) => {
  await openForTransfer(page, { withAdmin: false });
  const section = transferSection(page);
  await expect(section.getByRole('button', { name: 'Chuyển quyền Owner' })).toBeDisabled();
  await expect(section.getByText('Mời một Admin trước rồi chuyển quyền.')).toBeVisible();
  await expect(section.getByRole('combobox')).toHaveCount(0);
});

test('chuyển quyền: gõ sai tên BTC thì không gửi được; đúng tên → xác nhận lại (TOTP) → 204, toast, về trang BTC, mất mục chỉ Owner', async ({
  page,
}) => {
  const { calls, transferHeaders } = await openForTransfer(page);
  const transfers = () => callsTo(calls, 'POST', TRANSFER_PATH);
  const section = transferSection(page);
  await expect(section.getByRole('combobox', { name: 'Admin nhận quyền' })).toHaveValue(ADMIN_MEMBER_ID);
  await section.getByRole('button', { name: 'Chuyển quyền Owner' }).click();

  const dialog = transferDialog(page);
  await expect(dialog).toContainText(
    'Trần Bình sẽ là Owner, quản lý tài khoản nhận tiền và Token. Bạn sẽ thành Admin.',
  );
  const confirm = dialog.getByRole('button', { name: 'Chuyển quyền', exact: true });
  const nameInput = dialog.getByRole('textbox', { name: 'Gõ tên BTC để xác nhận' });
  await expect(confirm).toBeDisabled();
  await expect(dialog.getByText(`Gõ đúng "${ORG_NAME}" để bật nút Chuyển quyền.`)).toBeVisible();

  // Sai tên (kể cả khác hoa thường): nút vẫn tắt, Enter không gửi.
  await nameInput.fill('clb cờ vua quận 3');
  await expect(confirm).toBeDisabled();
  await nameInput.press('Enter');
  await nameInput.fill('CLB Cờ Vua');
  await expect(confirm).toBeDisabled();
  expect(transfers()).toHaveLength(0);

  // Đúng tên (khoảng trắng đầu/cuối bỏ qua).
  await nameInput.fill(`  ${ORG_NAME} `);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Api đòi xác nhận lại: Dialog chuyển quyền đóng, dialog xác nhận mở; mã đúng → tự gửi lại kèm lần xác nhận.
  await expect(reauthDialog(page)).toBeVisible();
  await expect(dialog).toBeHidden();
  await reauthDialog(page).locator('[data-slot="otp-input"] input').first().fill(REAUTH_CODE);
  await expect(reauthDialog(page)).toBeHidden();

  await expect(page.getByText('Đã chuyển quyền Owner cho Trần Bình.')).toBeVisible();
  await page.waitForURL((url) => url.pathname === base);
  expect(transferHeaders).toEqual([null, 'tok-1']);
  expect(transfers()).toHaveLength(2);

  // Cache vai đã làm mới (chưa tải lại trang): Sheet "Thêm" không còn mục chỉ Owner.
  await page.locator('[data-slot="bottom-tab-bar"]').getByRole('button', { name: 'Thêm' }).click();
  const sheet = page.getByRole('dialog', { name: 'Thêm' });
  await expect(sheet.getByRole('link', { name: 'Token' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Thành viên' })).toHaveCount(0);
  await expect(sheet.getByRole('link', { name: 'Tài khoản nhận tiền' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Owner cũ (nay là Admin) mở lại trang Thành viên: empty-state, mục chỉ Owner bị ẩn.
  await page.goto(MEMBERS_PATH);
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chuyển quyền Owner' })).toHaveCount(0);
});

test('chuyển quyền: Admin đã bị xóa giữa chừng → 404 → toast, làm mới danh sách; không rời trang', async ({ page }) => {
  let gone = false;
  const { calls, state } = await openForTransfer(page, {
    transferReply: () => {
      gone = true;
      state.members = state.members.filter((m) => m.id !== ADMIN_MEMBER_ID);
      return apiError(404, 'NOT_FOUND');
    },
  });
  await transferSection(page).getByRole('button', { name: 'Chuyển quyền Owner' }).click();
  await transferDialog(page).getByRole('textbox', { name: 'Gõ tên BTC để xác nhận' }).fill(ORG_NAME);
  await transferDialog(page).getByRole('button', { name: 'Chuyển quyền', exact: true }).click();
  await reauthDialog(page).locator('[data-slot="otp-input"] input').first().fill(REAUTH_CODE);

  await expect(page.getByText('Thành viên này không còn là Admin của BTC.')).toBeVisible();
  expect(gone).toBe(true);
  await expect(memberRow(page, ADMIN_EMAIL)).toHaveCount(0);
  await expect(transferSection(page).getByText('Mời một Admin trước rồi chuyển quyền.')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(MEMBERS_PATH);
  expect(callsTo(calls, 'GET', `/orgs/${ORG_ID}/members`).length).toBeGreaterThanOrEqual(2);
});

test('chuyển quyền: đã chuyển ở tab khác → 403 FORBIDDEN_ROLE → toast, Dialog đóng, không banner lỗi, "Chỉ Owner xem được mục này."', async ({
  page,
}) => {
  await openForTransfer(page, {
    transferReply: (demote) => {
      demote();
      return apiError(403, 'FORBIDDEN_ROLE');
    },
  });
  await transferSection(page).getByRole('button', { name: 'Chuyển quyền Owner' }).click();
  await transferDialog(page).getByRole('textbox', { name: 'Gõ tên BTC để xác nhận' }).fill(ORG_NAME);
  await transferDialog(page).getByRole('button', { name: 'Chuyển quyền', exact: true }).click();
  await reauthDialog(page).locator('[data-slot="otp-input"] input').first().fill(REAUTH_CODE);

  await expect(page.getByText('Bạn không còn là Owner của BTC này.')).toBeVisible();
  await expect(transferDialog(page)).toHaveCount(0);
  await expect(page.getByText('Chưa chuyển quyền được')).toHaveCount(0);
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
});

test('Admin mở trang Thành viên: "Chỉ Owner xem được mục này.", không có mục "Chuyển quyền Owner"', async ({ page }) => {
  await openAsAdmin(page, []);
  await page.goto(MEMBERS_PATH);
  await expect(page.getByText('Chỉ Owner xem được mục này.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chuyển quyền Owner' })).toHaveCount(0);
});
