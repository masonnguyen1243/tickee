import type { Locator, Page } from '@playwright/test';

import {
  DEAD_LETTERS_KEY,
  deadLetterJob,
  mockAdminApi,
  queueKey,
  requeueKey,
  type DeadLetterJob,
  type Gate,
} from './admin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler } from './identity-mock';

/*
 * Tab "Dead-letter" của `/admin` (Story 4.6-d) với API giả: bảng job pg-boss hết retry, "Requeue" từng job qua
 * `Dialog`, 409 khi job không còn, bảng trống, danh sách bị cắt ở 200 job. Bề mặt desktop (viewport 1280×800); giờ
 * luôn theo giờ Việt Nam, kể cả khi trình duyệt ở múi giờ khác.
 */

test.use({ timezoneId: 'America/New_York' });

const CONSENTED = '2026-10-29T01:02:03.000Z';
const DESKTOP = { width: 1280, height: 800 };

const EMAIL_JOB_ID = '019a3b2c-0d01-7abc-8def-0123456789ab';
const EXPIRE_JOB_ID = '019a3b2c-0d02-7abc-8def-0123456789ab';
const MANUAL_JOB_ID = '019a3b2c-0d03-7abc-8def-0123456789ab';
/** Id job gốc (mặc định của `deadLetterJob` cho job email). */
const EMAIL_SOURCE_JOB_ID = '019a3b2c-0f01-7abc-8def-0123456789ab';
const EXPIRE_SOURCE_JOB_ID = '019a3b2c-0f02-7abc-8def-0123456789ab';

const EMAIL_QUEUE = 'ordering.send-buyer-email';
const EXPIRE_QUEUE = 'ordering.expire-order';

/** Theo thứ tự api trả: mới vào dead-letter nhất trước. */
function seed(): DeadLetterJob[] {
  return [
    deadLetterJob({
      id: EMAIL_JOB_ID,
      createdAt: '2026-11-17T03:00:00.000Z',
      retryCount: 8,
      reason: 'Không gửi được tới [REDACTED] (SmtpError)',
      payload: '{"orderId":"019a3b2c-0e01-7abc-8def-0123456789ab"}',
    }),
    deadLetterJob({
      id: EXPIRE_JOB_ID,
      queue: `${EXPIRE_QUEUE}.dead-letter`,
      sourceQueue: EXPIRE_QUEUE,
      sourceJobId: EXPIRE_SOURCE_JOB_ID,
      retryCount: 10,
      createdAt: '2026-11-16T01:30:00.000Z',
      reason: '{"error":"Payload không hợp lệ"}',
      payload: '{"linked":true,"orderId":"019a3b2c-0e02-7abc-8def-0123456789ab"}',
    }),
  ];
}

async function openDeadLetters(
  page: Page,
  {
    deadLetters = seed(),
    gate,
    handlers,
  }: { deadLetters?: DeadLetterJob[]; gate?: Gate; handlers?: Record<string, Handler> } = {},
) {
  await page.setViewportSize(DESKTOP);
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED, true) });
  const calls = await mockAdminApi(page, [], { deadLetters, gate, handlers });
  await page.goto('/admin');
  await tab(page).click();
  await expect(tab(page)).toHaveAttribute('aria-selected', 'true');
  return { calls, deadLetters };
}

const tab = (page: Page) => page.getByRole('tab', { name: 'Dead-letter' });
const rows = (page: Page) => page.locator('[data-slot="dead-letter-row"]');
const row = (page: Page, jobId: string) => rows(page).filter({ hasText: jobId });
const requeueButton = (page: Page, jobId: string) => row(page, jobId).getByRole('button', { name: /Requeue/ });
const requeueDialog = (page: Page, sourceQueue: string) =>
  page.getByRole('dialog', { name: `Requeue job vào ${sourceQueue}?` });
const attempts = (row: Locator) => row.locator('[data-slot="dead-letter-attempts"]');
const sourceJob = (row: Locator) => row.locator('[data-slot="dead-letter-source-job"]');
const posts = (calls: Call[]) => calls.filter((c) => c.method === 'POST').map((c) => c.path);
const listGets = (calls: Call[]) => calls.filter((c) => `${c.method} ${c.path}` === DEAD_LETTERS_KEY);

test('bảng job theo thứ tự api: queue gốc, id job, lúc vào dead-letter (giờ VN), số lần đã thử, lý do, payload; job không rõ queue gốc không requeue được', async ({
  page,
}) => {
  const manual = deadLetterJob({
    id: MANUAL_JOB_ID,
    sourceQueue: null,
    sourceJobId: null,
    retryCount: null,
    reason: null,
    payload: '{}',
    createdAt: '2026-11-15T03:00:00.000Z',
  });
  const { calls } = await openDeadLetters(page, { deadLetters: [...seed(), manual] });

  await expect(rows(page)).toHaveCount(3);
  const email = rows(page).nth(0);
  await expect(email).toContainText(EMAIL_QUEUE);
  await expect(email).toContainText(EMAIL_JOB_ID);
  await expect(sourceJob(email)).toHaveText(`Job gốc: ${EMAIL_SOURCE_JOB_ID}`);
  await expect(email).toContainText('10:00 17/11/2026');
  // `retryCount` 8 lần thử lại → 9 lần đã thử.
  await expect(attempts(email)).toHaveText('9');
  await expect(email).toContainText('Không gửi được tới [REDACTED] (SmtpError)');
  await expect(email).toContainText('{"orderId":"019a3b2c-0e01-7abc-8def-0123456789ab"}');
  await expect(requeueButton(page, EMAIL_JOB_ID)).toHaveText('Requeue');

  const expire = rows(page).nth(1);
  await expect(expire).toContainText(EXPIRE_QUEUE);
  await expect(sourceJob(expire)).toHaveText(`Job gốc: ${EXPIRE_SOURCE_JOB_ID}`);
  await expect(expire).toContainText('08:30 16/11/2026');
  await expect(attempts(expire)).toHaveText('11');
  await expect(expire).toContainText('{"error":"Payload không hợp lệ"}');
  await expect(requeueButton(page, EXPIRE_JOB_ID)).toBeVisible();

  const unknown = rows(page).nth(2);
  await expect(unknown).toContainText('Không rõ queue gốc');
  await expect(sourceJob(unknown)).toHaveCount(0);
  await expect(attempts(unknown)).toHaveText('Không rõ');
  await expect(unknown).toContainText('Không requeue được');
  await expect(unknown.getByRole('button')).toHaveCount(0);

  // Không bị cắt: không có câu "Đang hiện …".
  await expect(page.getByText(/^Đang hiện/)).toHaveCount(0);
  // Tab Dead-letter chỉ tải khi được mở.
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([queueKey('pending'), DEAD_LETTERS_KEY]);
});

test('Requeue: Dialog nêu queue gốc và cảnh báo chạy lại; Hủy không gọi api; xác nhận → POST requeue, toast, tải lại, hàng rời bảng', async ({
  page,
}) => {
  const { calls } = await openDeadLetters(page);
  const dialog = requeueDialog(page, EMAIL_QUEUE);

  await requeueButton(page, EMAIL_JOB_ID).click();
  await expect(dialog).toContainText(`Job chạy lại từ đầu ở ${EMAIL_QUEUE}`);
  await expect(dialog).toContainText('Job gửi email sẽ gửi lại email.');
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeHidden();
  expect(posts(calls)).toEqual([]);

  await requeueButton(page, EMAIL_JOB_ID).click();
  await dialog.getByRole('button', { name: 'Requeue' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Đã requeue job vào ${EMAIL_QUEUE}.`)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, EMAIL_JOB_ID)).toHaveCount(0);
  expect(posts(calls)).toEqual([`/admin/dead-letters/${EMAIL_JOB_ID}/requeue`]);
  expect(listGets(calls)).toHaveLength(2);
});

test('Requeue đang chạy: nút xác nhận quay spinner, bấm lặp hay Hủy không gửi thêm; xong thì Dialog đóng', async ({
  page,
}) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  const deadLetters = seed();
  const { calls } = await openDeadLetters(page, {
    deadLetters,
    handlers: {
      [requeueKey(EXPIRE_JOB_ID)]: async () => {
        await hold;
        deadLetters.splice(1, 1);
        return { status: 204 };
      },
    },
  });
  const dialog = requeueDialog(page, EXPIRE_QUEUE);
  await requeueButton(page, EXPIRE_JOB_ID).click();
  const confirm = dialog.getByRole('button', { name: /^Requeue/ });
  await confirm.click();
  await expect(confirm).toHaveAttribute('aria-busy', 'true');
  await confirm.click();
  await dialog.getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog).toBeVisible();
  expect(posts(calls)).toEqual([`/admin/dead-letters/${EXPIRE_JOB_ID}/requeue`]);

  release();
  await expect(page.getByText(`Đã requeue job vào ${EXPIRE_QUEUE}.`)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  expect(posts(calls)).toHaveLength(1);
});

test('409 DEAD_LETTER_JOB_GONE (đã requeue ở nơi khác): đóng Dialog, toast "Job không còn trong dead-letter." và tải lại danh sách', async ({
  page,
}) => {
  const deadLetters = seed();
  const { calls } = await openDeadLetters(page, {
    deadLetters,
    handlers: {
      // Quản trị Tingee khác vừa requeue job này trước khi bấm.
      [requeueKey(EMAIL_JOB_ID)]: () => {
        deadLetters.splice(0, 1);
        return apiError(409, 'DEAD_LETTER_JOB_GONE');
      },
    },
  });
  const dialog = requeueDialog(page, EMAIL_QUEUE);
  await requeueButton(page, EMAIL_JOB_ID).click();
  await dialog.getByRole('button', { name: 'Requeue' }).click();
  await expect(page.getByText('Job không còn trong dead-letter.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect.poll(() => listGets(calls).length).toBe(2);
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByText(`Đã requeue job vào ${EMAIL_QUEUE}.`)).toHaveCount(0);
});

test('Requeue lỗi máy chủ (500): Dialog vẫn mở, báo "Chưa requeue được"', async ({ page }) => {
  await openDeadLetters(page, { handlers: { [requeueKey(EMAIL_JOB_ID)]: () => apiError(500, 'INTERNAL_ERROR') } });
  const dialog = requeueDialog(page, EMAIL_QUEUE);
  await requeueButton(page, EMAIL_JOB_ID).click();
  await dialog.getByRole('button', { name: 'Requeue' }).click();
  await expect(dialog.getByText('Chưa requeue được')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
});

test('danh sách trống: "Không có job nào trong dead-letter."', async ({ page }) => {
  await openDeadLetters(page, { deadLetters: [] });
  await expect(page.getByText('Không có job nào trong dead-letter.')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});

test('quá 200 job: bảng 200 job mới nhất kèm "Đang hiện 200/{total} job mới nhất"', async ({ page }) => {
  const many = Array.from({ length: 201 }, (_, i) =>
    deadLetterJob({ id: `019a3b2c-0c00-7abc-8def-${i.toString(16).padStart(12, '0')}` }),
  );
  await openDeadLetters(page, { deadLetters: many });
  await expect(page.getByText('Đang hiện 200/201 job mới nhất')).toBeVisible();
  await expect(rows(page)).toHaveCount(200);
});

test('chưa qua lớp hai khi Requeue → dialog "Xác thực hai lớp"; nhập mã xong lần Requeue tự chạy tiếp', async ({
  page,
}) => {
  let steppedUp = false;
  await page.setViewportSize(DESKTOP);
  const identityCalls = await mockIdentityApi(page, {
    'GET /identity/me': () => me(CONSENTED, true),
    'POST /identity/totp/step-up': () => ({ status: 200, body: { stepUpAt: '2026-11-17T03:00:00.000Z' } }),
  });
  const calls = await mockAdminApi(page, [], {
    deadLetters: seed(),
    gate: (request) =>
      !steppedUp && request.method() === 'POST' ? apiError(403, 'TOTP_REQUIRED', { reason: 'step_up' }) : undefined,
  });
  await page.goto('/admin');
  await tab(page).click();
  await requeueButton(page, EMAIL_JOB_ID).click();
  await requeueDialog(page, EMAIL_QUEUE).getByRole('button', { name: 'Requeue' }).click();
  const stepUp = page.getByRole('dialog', { name: 'Xác thực hai lớp' });
  await expect(stepUp).toBeVisible();
  steppedUp = true;
  await stepUp.getByRole('group', { name: /Mã 6 số/ }).locator('input').first().fill('123456');
  await expect(stepUp).toBeHidden();
  await expect(page.getByText(`Đã requeue job vào ${EMAIL_QUEUE}.`)).toBeVisible();
  await expect(requeueDialog(page, EMAIL_QUEUE)).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  expect(posts(calls)).toEqual([
    `/admin/dead-letters/${EMAIL_JOB_ID}/requeue`,
    `/admin/dead-letters/${EMAIL_JOB_ID}/requeue`,
  ]);
  expect(identityCalls.filter((c) => c.path === '/identity/totp/step-up')).toHaveLength(1);
});

test('không có cờ (FORBIDDEN_ROLE) ở tab này → empty-state không quyền', async ({ page }) => {
  let flag = true;
  await openDeadLetters(page, { gate: () => (flag ? undefined : apiError(403, 'FORBIDDEN_ROLE')) });
  await expect(rows(page)).toHaveCount(2);
  flag = false;
  await requeueButton(page, EMAIL_JOB_ID).click();
  await requeueDialog(page, EMAIL_QUEUE).getByRole('button', { name: 'Requeue' }).click();
  await expect(page.getByText('Bạn không có quyền vào trang này.')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);
});
