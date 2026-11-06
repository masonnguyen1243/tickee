import type { Page } from '@playwright/test';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler, type Reply } from './identity-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';

/*
 * Form mua vé (Story 2.9): trình sửa dùng chung ở wizard bước 3 và tab "Form mua" — trường mặc định chỉ đọc, câu hỏi
 * riêng (Thêm/Sửa qua `Dialog`, Xóa qua `Dialog` nêu hậu quả, "Lên"/"Xuống"), phần xem trước; bước 4 hiện mục "Form
 * mua" bằng cùng phần xem trước. API giả có trạng thái như api thật (id câu hỏi và id phương án ổn định).
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const EVENT_ID = '019a3b2c-0700-7abc-8def-0123456789ab';
const base = `/btc/${ORG_ID}/su-kien/${EVENT_ID}`;
const questionId = (n: number) => `019a3b2c-0a${String(n).padStart(2, '0')}-7abc-8def-0123456789ab`;
const optionId = (n: number) => `019a3b2c-0b${String(n).padStart(2, '0')}-7abc-8def-0123456789ab`;
const QUESTION_IDS = Array.from({ length: 21 }, (_, n) => questionId(n));
const formPath = `/orgs/${ORG_ID}/events/${EVENT_ID}/form`;

type Option = { id: string; label: string };
type Question = {
  id: string;
  position: number;
  label: string;
  kind: 'text' | 'choice';
  required: boolean;
  options: Option[];
};
type Body = { label: string; kind: 'text' | 'choice'; required: boolean; options: { id?: string; label: string }[] };

const event = () => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: 'giai-co-vua-mo-rong-a2b3',
  name: 'Giải cờ vua mở rộng',
  status: 'draft',
  startsAt: '2026-11-16T07:00:00+07:00',
  endsAt: '2026-11-16T17:00:00+07:00',
  effectiveEndAt: '2026-11-16T23:59:59+07:00',
  venue: null,
  description: null,
  refundPolicy: null,
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

const level = (n: number, overrides: Partial<Question> = {}): Question => ({
  id: questionId(n),
  position: n,
  label: 'Trình độ',
  kind: 'choice',
  required: true,
  options: [
    { id: optionId(n * 10), label: 'Mới chơi' },
    { id: optionId(n * 10 + 1), label: 'Trung bình' },
    { id: optionId(n * 10 + 2), label: 'Khá' },
  ],
  ...overrides,
});
const club = (n: number, overrides: Partial<Question> = {}): Question => ({
  id: questionId(n),
  position: n,
  label: 'Câu lạc bộ',
  kind: 'text',
  required: false,
  options: [],
  ...overrides,
});

const key = (label: string) => label.trim().toLowerCase();
const invalidOptions = (body: Body) =>
  body.kind === 'choice'
    ? body.options.length < 2 ||
      body.options.length > 20 ||
      new Set(body.options.map((o) => key(o.label))).size !== body.options.length
    : body.options.length > 0;

/**
 * API giả có trạng thái: Sự kiện nháp + câu hỏi riêng của form. `intercept(key)` trả reply thì dùng reply đó thay
 * handler (vd. 500 lần đầu), `undefined` thì handler chạy như thường.
 */
async function openApi(
  page: Page,
  seeded: Question[] = [],
  intercept: (key: string) => Reply | undefined = () => undefined,
): Promise<{ calls: Call[]; questions: Question[] }> {
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const questions = [...seeded];
  let nextQuestion = seeded.length;
  /** Phương án mới: id `0b50`…`0b99`, không trùng id phương án của câu hỏi dựng sẵn. */
  let nextOption = 50;
  const renumber = () => questions.forEach((q, position) => (q.position = position));
  const optionsOf = (body: Body, current: Option[] = []): Option[] =>
    body.kind === 'choice'
      ? body.options.map((o) => ({
          id: o.id && current.some((c) => c.id === o.id) ? o.id : optionId(nextOption++),
          label: o.label.trim(),
        }))
      : [];
  const validation = (): Reply => apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'options', code: 'custom' }] });

  const perQuestion = Object.fromEntries(
    QUESTION_IDS.flatMap((id): [string, Handler][] => [
      [
        `PATCH ${formPath}/questions/${id}`,
        (request) => {
          const index = questions.findIndex((q) => q.id === id);
          if (index < 0) return apiError(404, 'FORM_QUESTION_NOT_FOUND');
          const body = request.postDataJSON() as Body;
          if (invalidOptions(body)) return validation();
          const current = questions[index]!;
          questions[index] = {
            ...current,
            label: body.label.trim(),
            kind: body.kind,
            required: body.required,
            options: optionsOf(body, current.options),
          };
          return { status: 200, body: questions[index] };
        },
      ],
      [
        `DELETE ${formPath}/questions/${id}`,
        () => {
          const index = questions.findIndex((q) => q.id === id);
          if (index < 0) return apiError(404, 'FORM_QUESTION_NOT_FOUND');
          questions.splice(index, 1);
          renumber();
          return { status: 204 };
        },
      ],
    ]),
  );
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'admin' }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: 'admin' }] }),
    [`GET /orgs/${ORG_ID}/events/${EVENT_ID}`]: () => ({ status: 200, body: event() }),
    [`PATCH /orgs/${ORG_ID}/events/${EVENT_ID}`]: () => ({ status: 200, body: event() }),
    [`GET ${formPath}`]: () => ({ status: 200, body: { questions } }),
    [`POST ${formPath}/questions`]: (request) => {
      if (questions.length >= 20) return apiError(409, 'FORM_QUESTION_LIMIT_REACHED', { limit: 20 });
      const body = request.postDataJSON() as Body;
      if (invalidOptions(body)) return validation();
      const created: Question = {
        id: questionId(nextQuestion++),
        position: questions.length,
        label: body.label.trim(),
        kind: body.kind,
        required: body.required,
        options: optionsOf(body),
      };
      questions.push(created);
      return { status: 201, body: created };
    },
    [`PUT ${formPath}/order`]: (request) => {
      const ids = (request.postDataJSON() as { questionIds: string[] }).questionIds;
      const same = ids.length === questions.length && ids.every((id) => questions.some((q) => q.id === id));
      if (!same || new Set(ids).size !== ids.length) {
        return apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'questionIds', code: 'custom' }] });
      }
      questions.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      renumber();
      return { status: 200, body: { questions } };
    },
    ...perQuestion,
  };
  const intercepted = Object.fromEntries(
    Object.entries(handlers).map(([key, handler]): [string, Handler] => [
      key,
      (request) => intercept(key) ?? handler(request),
    ]),
  );
  const calls = await mockOrganizerApi(page, intercepted);
  return { calls, questions };
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET');
const formWrites = (calls: Call[]) => writes(calls).filter((c) => c.path.startsWith(formPath));
const dialog = (page: Page) => page.getByRole('dialog');
const inDialog = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
const rows = (page: Page) => page.locator('[data-slot="form-question-row"]');
const preview = (page: Page) =>
  page.locator('[data-slot="purchase-form-preview-card"] [data-slot="purchase-form-preview"]');
const previewFields = (page: Page) => preview(page).locator('[data-slot="purchase-form-field"]');
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Tên các trường của một phần xem trước theo thứ tự (nhãn, bỏ dấu `*` và "(bắt buộc)"). */
const fieldNames = (fields: ReturnType<Page['locator']>) =>
  fields.evaluateAll((elements) =>
    elements.map((el) => {
      const label = el.querySelector('legend, label');
      const text = (label?.firstElementChild ?? label)?.textContent ?? '';
      return text.trim();
    }),
  );

test('wizard bước 3: trường mặc định chỉ đọc; thêm "Trình độ" (lựa chọn, bắt buộc) → hiện ngay ở danh sách và xem trước; tab "Form mua" thấy đúng câu đó', async ({
  page,
}) => {
  const { calls } = await openApi(page);
  await page.goto(`${base}/thiet-lap?buoc=3`);
  await expect(page.getByText('Bước 3/4 · Form mua')).toBeVisible();

  const defaults = page.locator('[data-slot="purchase-form-default-field"]');
  await expect(defaults).toHaveCount(3);
  await expect(defaults.nth(0)).toContainText('Tên');
  await expect(defaults.nth(1)).toContainText('Số điện thoại');
  await expect(defaults.nth(1)).toContainText('Chỉ hỏi nếu tài khoản chưa có');
  await expect(defaults.nth(2)).toContainText('Email');
  await expect(defaults.nth(2)).toContainText('Tự điền từ tài khoản, không sửa được');
  await expect(defaults.locator('input, button, textarea')).toHaveCount(0);
  await expect(preview(page).getByRole('textbox', { name: /^Tên/ })).toHaveAttribute('readonly', '');
  await expect(preview(page).getByRole('textbox', { name: /^Số điện thoại/ })).toHaveAttribute('readonly', '');
  await expect(preview(page).getByRole('textbox', { name: /^Email/ })).toHaveAttribute('readonly', '');
  // Ô xem trước không là điểm dừng Tab; Enter trong ô không gửi form wizard (không PATCH, không sang bước 4).
  const previewName = preview(page).getByRole('textbox', { name: /^Tên/ });
  await expect(previewName).toHaveAttribute('tabindex', '-1');
  await previewName.focus();
  await previewName.press('Enter');
  await expect(page.getByText('Bước 3/4 · Form mua')).toBeVisible();
  await expect(page.getByText('Chưa có câu hỏi riêng.')).toBeVisible();

  await page.getByRole('button', { name: 'Thêm câu hỏi' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Thêm câu hỏi' })).toBeVisible();
  await inDialog(page, 'Câu hỏi').fill('Trình độ');
  await dialog(page).getByRole('radio', { name: 'Lựa chọn (chọn một)' }).check();
  await dialog(page).getByRole('checkbox', { name: 'Bắt buộc trả lời' }).click();
  await inDialog(page, 'Phương án 1').fill('Mới chơi');
  await inDialog(page, 'Phương án 2').fill('Trung bình');
  await dialog(page).getByRole('button', { name: 'Thêm phương án' }).click();
  await expect(inDialog(page, 'Phương án 3')).toBeFocused();
  await inDialog(page, 'Phương án 3').fill('Khá');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Trình độ');
  await expect(rows(page).first()).toContainText('Lựa chọn (chọn một) · Bắt buộc');
  await expect(rows(page).first()).toContainText('Mới chơi · Trung bình · Khá');
  const group = preview(page).getByRole('group', { name: /Trình độ/ });
  await expect(group).toBeVisible();
  await expect(group.getByRole('radio')).toHaveCount(3);
  await expect(group).toContainText('(bắt buộc)');
  // Vẫn ở bước 3: submit trong `Dialog` không gửi form wizard.
  await expect(page.getByText('Bước 3/4 · Form mua')).toBeVisible();
  expect(writes(calls)).toEqual([
    {
      method: 'POST',
      path: `${formPath}/questions`,
      body: {
        label: 'Trình độ',
        kind: 'choice',
        required: true,
        options: [{ label: 'Mới chơi' }, { label: 'Trung bình' }, { label: 'Khá' }],
      },
    },
  ]);

  await page.goto(`${base}?tab=form-mua`);
  await expect(page.getByRole('tab', { name: 'Form mua' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Trình độ');
  await expect(preview(page).getByRole('group', { name: /Trình độ/ }).getByRole('radio')).toHaveCount(3);
});

test('lỗi phương án: còn 1 phương án → lỗi tại danh sách; "Khá" và " khá " → lỗi tại ô trùng; không gọi api', async ({
  page,
}) => {
  const { calls } = await openApi(page);
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Thêm câu hỏi' }).click();
  await inDialog(page, 'Câu hỏi').fill('Trình độ');
  await dialog(page).getByRole('radio', { name: 'Lựa chọn (chọn một)' }).check();
  await inDialog(page, 'Phương án 1').fill('Khá');
  await dialog(page).getByRole('button', { name: 'Xóa phương án 2' }).click();
  await expect(inDialog(page, 'Phương án 1')).toBeFocused();
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page).getByText('Câu lựa chọn cần ít nhất 2 phương án.')).toBeVisible();
  expect(formWrites(calls)).toEqual([]);

  await dialog(page).getByRole('button', { name: 'Thêm phương án' }).click();
  await expect(dialog(page).getByText('Câu lựa chọn cần ít nhất 2 phương án.')).toHaveCount(0);
  await inDialog(page, 'Phương án 2').fill(' khá ');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page).getByText('Các phương án không được trùng nhau.')).toBeVisible();
  await expect(dialog(page).getByText('Trùng với một phương án ở trên.')).toBeVisible();
  await expect(inDialog(page, 'Phương án 2')).toHaveAttribute('aria-invalid', 'true');
  await expect(inDialog(page, 'Phương án 1')).not.toHaveAttribute('aria-invalid', 'true');
  expect(formWrites(calls)).toEqual([]);

  // Sửa ô trước của cặp trùng → bỏ lỗi ở cả ô sau.
  await inDialog(page, 'Phương án 1').fill('Khá ');
  await expect(dialog(page).getByText('Trùng với một phương án ở trên.')).toHaveCount(0);
  await expect(inDialog(page, 'Phương án 2')).not.toHaveAttribute('aria-invalid', 'true');

  // Ô phương án trống → lỗi tại ô đó.
  await inDialog(page, 'Phương án 1').fill('Khá');
  await inDialog(page, 'Phương án 2').fill('');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page).getByText('Nhập phương án hoặc xóa ô này.')).toBeVisible();
  expect(formWrites(calls)).toEqual([]);

  await inDialog(page, 'Phương án 2').fill('Trung bình');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  expect(formWrites(calls).map((c) => c.method)).toEqual(['POST']);
});

test('sửa nhãn: Dialog điền sẵn; PATCH giữ id phương án; danh sách và xem trước đổi theo', async ({ page }) => {
  const { calls } = await openApi(page, [level(0)]);
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Sửa Trình độ' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Sửa câu hỏi' })).toBeVisible();
  await expect(inDialog(page, 'Câu hỏi')).toHaveValue('Trình độ');
  await expect(dialog(page).getByRole('radio', { name: 'Lựa chọn (chọn một)' })).toBeChecked();
  await expect(dialog(page).getByRole('checkbox', { name: 'Bắt buộc trả lời' })).toBeChecked();
  await expect(inDialog(page, 'Phương án 3')).toHaveValue('Khá');
  await inDialog(page, 'Câu hỏi').fill('Trình độ cờ vua');
  await dialog(page).getByRole('button', { name: 'Lưu', exact: true }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).first()).toContainText('Trình độ cờ vua');
  await expect(preview(page).getByRole('group', { name: /Trình độ cờ vua/ })).toBeVisible();
  expect(formWrites(calls)).toEqual([
    {
      method: 'PATCH',
      path: `${formPath}/questions/${questionId(0)}`,
      body: {
        label: 'Trình độ cờ vua',
        kind: 'choice',
        required: true,
        options: [
          { id: optionId(0), label: 'Mới chơi' },
          { id: optionId(1), label: 'Trung bình' },
          { id: optionId(2), label: 'Khá' },
        ],
      },
    },
  ]);
});

test('xóa qua Dialog nêu hậu quả: "Hủy" không gọi api; "Xóa" → 204, câu hỏi biến mất khỏi danh sách và xem trước', async ({
  page,
}) => {
  const { calls } = await openApi(page, [club(0), level(1)]);
  await page.goto(`${base}?tab=form-mua`);
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Xóa Câu lạc bộ' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Xóa câu hỏi Câu lạc bộ?' })).toBeVisible();
  await expect(dialog(page)).toContainText('Đơn đã đặt vẫn giữ câu trả lời cũ.');
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(formWrites(calls)).toEqual([]);

  await page.getByRole('button', { name: 'Xóa Câu lạc bộ' }).click();
  await dialog(page).getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('Đã xóa câu hỏi.')).toBeVisible();
  // Nút "Xóa" của hàng đã mất: focus sang "Thêm câu hỏi", không rơi về body.
  await expect(page.getByRole('button', { name: 'Thêm câu hỏi' })).toBeFocused();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Trình độ');
  await expect(preview(page).getByRole('textbox', { name: /^Câu lạc bộ/ })).toHaveCount(0);
  expect(formWrites(calls)).toEqual([
    { method: 'DELETE', path: `${formPath}/questions/${questionId(0)}`, body: null },
  ]);
});

test('sắp thứ tự: "Lên" ở câu thứ hai → đổi ở danh sách và xem trước, PUT order; tải lại vẫn đúng', async ({ page }) => {
  const { calls } = await openApi(page, [club(0), level(1)]);
  await page.goto(`${base}?tab=form-mua`);
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Lên Câu lạc bộ' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Xuống Trình độ' })).toBeDisabled();
  expect(await fieldNames(previewFields(page))).toEqual(['Tên', 'Số điện thoại', 'Email', 'Câu lạc bộ', 'Trình độ']);

  await page.getByRole('button', { name: 'Lên Trình độ' }).click();
  await expect(rows(page).nth(0)).toContainText('Trình độ');
  await expect(rows(page).nth(1)).toContainText('Câu lạc bộ');
  await expect
    .poll(() => fieldNames(previewFields(page)))
    .toEqual(['Tên', 'Số điện thoại', 'Email', 'Trình độ', 'Câu lạc bộ']);
  // Câu vừa lên đầu: nút "Lên" tắt, focus sang "Xuống" của cùng hàng.
  await expect(page.getByRole('button', { name: 'Lên Trình độ' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Xuống Trình độ' })).toBeFocused();
  expect(formWrites(calls)).toEqual([
    { method: 'PUT', path: `${formPath}/order`, body: { questionIds: [questionId(1), questionId(0)] } },
  ]);

  await page.reload();
  await expect(rows(page).nth(0)).toContainText('Trình độ');
  await expect(rows(page).nth(1)).toContainText('Câu lạc bộ');
  expect(await fieldNames(previewFields(page))).toEqual(['Tên', 'Số điện thoại', 'Email', 'Trình độ', 'Câu lạc bộ']);
});

test('"Xuống" ở câu đầu trong ba câu → focus vẫn ở nút "Xuống" của câu đó', async ({ page }) => {
  const { calls } = await openApi(page, [club(0, { label: 'A' }), club(1, { label: 'B' }), club(2, { label: 'C' })]);
  await page.goto(`${base}?tab=form-mua`);
  await expect(rows(page)).toHaveCount(3);
  await page.getByRole('button', { name: 'Xuống A' }).click();
  await expect(rows(page).nth(0)).toContainText('B');
  await expect(rows(page).nth(1)).toContainText('A');
  await expect(page.getByRole('button', { name: 'Xuống A' })).toBeFocused();
  expect(formWrites(calls)).toEqual([
    { method: 'PUT', path: `${formPath}/order`, body: { questionIds: [questionId(1), questionId(0), questionId(2)] } },
  ]);
});

test('sắp thứ tự khi danh sách vừa đổi ở nơi khác (400) → toast, tải lại danh sách', async ({ page }) => {
  const { questions } = await openApi(page, [club(0, { label: 'A' }), club(1, { label: 'B' })]);
  await page.goto(`${base}?tab=form-mua`);
  await expect(rows(page)).toHaveCount(2);
  questions.push(club(2, { label: 'C' }));
  await page.getByRole('button', { name: 'Lên B' }).click();
  await expect(page.getByText('Danh sách câu hỏi vừa thay đổi. Đã tải lại, hãy thử lại.')).toBeVisible();
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toContainText('A');
});

test('sắp thứ tự lỗi 500 → banner "Chưa đổi được thứ tự"; "Thử lại" gửi lại PUT và thành công', async ({ page }) => {
  let failed = false;
  const { calls } = await openApi(page, [club(0, { label: 'A' }), club(1, { label: 'B' })], (key) => {
    if (key !== `PUT ${formPath}/order` || failed) return undefined;
    failed = true;
    return apiError(500, 'INTERNAL_ERROR');
  });
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Lên B' }).click();
  await expect(page.getByText('Chưa đổi được thứ tự')).toBeVisible();
  await expect(rows(page).nth(0)).toContainText('A');

  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page).nth(0)).toContainText('B');
  await expect(page.getByText('Chưa đổi được thứ tự')).toHaveCount(0);
  const body = { questionIds: [questionId(1), questionId(0)] };
  expect(formWrites(calls)).toEqual([
    { method: 'PUT', path: `${formPath}/order`, body },
    { method: 'PUT', path: `${formPath}/order`, body },
  ]);
});

test('câu "Văn bản" (mặc định): POST options []; sửa câu lựa chọn thành "Văn bản" → PATCH options []', async ({
  page,
}) => {
  const { calls } = await openApi(page, [level(0)]);
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Thêm câu hỏi' }).click();
  await expect(dialog(page).getByRole('radio', { name: 'Văn bản', exact: true })).toBeChecked();
  await expect(inDialog(page, 'Phương án 1')).toHaveCount(0);
  await inDialog(page, 'Câu hỏi').fill('Câu lạc bộ');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).nth(1)).toContainText('Câu lạc bộ');
  await expect(rows(page).nth(1)).toContainText('Văn bản · Không bắt buộc');
  await expect(preview(page).getByRole('textbox', { name: 'Câu lạc bộ', exact: true })).toHaveAttribute('readonly', '');

  await page.getByRole('button', { name: 'Sửa Trình độ' }).click();
  await dialog(page).getByRole('radio', { name: 'Văn bản', exact: true }).check();
  await expect(inDialog(page, 'Phương án 1')).toHaveCount(0);
  await dialog(page).getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page).nth(0)).toContainText('Văn bản · Bắt buộc');
  await expect(preview(page).getByRole('group', { name: /Trình độ/ })).toHaveCount(0);
  await expect(preview(page).getByRole('textbox', { name: /^Trình độ/ })).toBeVisible();
  expect(formWrites(calls)).toEqual([
    {
      method: 'POST',
      path: `${formPath}/questions`,
      body: { label: 'Câu lạc bộ', kind: 'text', required: false, options: [] },
    },
    {
      method: 'PATCH',
      path: `${formPath}/questions/${questionId(0)}`,
      body: { label: 'Trình độ', kind: 'text', required: true, options: [] },
    },
  ]);
});

test('sửa câu hỏi đã bị xóa ở nơi khác (404) → toast "Câu hỏi này không còn nữa.", Dialog đóng, hàng biến mất', async ({
  page,
}) => {
  const { questions } = await openApi(page, [level(0)]);
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Sửa Trình độ' }).click();
  await expect(dialog(page)).toBeVisible();
  questions.splice(0);
  await inDialog(page, 'Câu hỏi').fill('Trình độ cờ vua');
  await dialog(page).getByRole('button', { name: 'Lưu', exact: true }).click();
  await expect(page.getByText('Câu hỏi này không còn nữa.')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('Chưa có câu hỏi riêng.')).toBeVisible();
});

test('tải form lỗi 500 → banner "Chưa tải được form mua"; "Thử lại" tải lại danh sách', async ({ page }) => {
  let failing = true;
  await openApi(page, [level(0)], (key) =>
    failing && key === `GET ${formPath}` ? apiError(500, 'INTERNAL_ERROR') : undefined,
  );
  await page.goto(`${base}?tab=form-mua`);
  await expect(page.getByText('Chưa tải được form mua')).toBeVisible();
  await expect(rows(page)).toHaveCount(0);

  failing = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Trình độ');
  await expect(page.getByText('Chưa tải được form mua')).toHaveCount(0);
});

test('xóa lỗi 500 → "Chưa xóa được" trong Dialog, hàng vẫn còn', async ({ page }) => {
  const { calls } = await openApi(page, [level(0)], (key) =>
    key === `DELETE ${formPath}/questions/${questionId(0)}` ? apiError(500, 'INTERNAL_ERROR') : undefined,
  );
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Xóa Trình độ' }).click();
  await dialog(page).getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(dialog(page).getByText('Chưa xóa được')).toBeVisible();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(formWrites(calls)).toEqual([{ method: 'DELETE', path: `${formPath}/questions/${questionId(0)}`, body: null }]);
});

test('xóa câu hỏi đã bị xóa ở nơi khác (404) → toast "Câu hỏi này không còn nữa.", Dialog đóng, hàng biến mất', async ({
  page,
}) => {
  const { questions } = await openApi(page, [level(0)]);
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Xóa Trình độ' }).click();
  await expect(dialog(page)).toBeVisible();
  questions.splice(0);
  await dialog(page).getByRole('button', { name: 'Xóa', exact: true }).click();
  await expect(page.getByText('Câu hỏi này không còn nữa.')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(0);
});

test('409 đủ 20 câu khi thêm (danh sách vừa đổi ở nơi khác) → banner giới hạn; "Thêm câu hỏi" tắt sau khi tải lại', async ({
  page,
}) => {
  const { questions } = await openApi(page, [club(0, { label: 'Câu 1' })]);
  await page.goto(`${base}?tab=form-mua`);
  await expect(rows(page)).toHaveCount(1);
  for (let n = 1; n < 20; n++) questions.push(club(n, { label: `Câu ${n + 1}` }));
  await page.getByRole('button', { name: 'Thêm câu hỏi' }).click();
  await inDialog(page, 'Câu hỏi').fill('Câu 21');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(dialog(page).getByText('Chưa lưu được câu hỏi')).toBeVisible();
  await expect(
    dialog(page).getByText('Mỗi Sự kiện tối đa 20 câu hỏi. Xóa bớt câu hỏi để thêm câu mới.'),
  ).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Hủy' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByRole('button', { name: 'Thêm câu hỏi' })).toBeDisabled();
});

test('server báo VALIDATION_FAILED tại options.1.label → lỗi tại ô "Phương án 2"', async ({ page }) => {
  await openApi(page, [], (key) =>
    key === `POST ${formPath}/questions`
      ? apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'options.1.label', code: 'too_big' }] })
      : undefined,
  );
  await page.goto(`${base}?tab=form-mua`);
  await page.getByRole('button', { name: 'Thêm câu hỏi' }).click();
  await inDialog(page, 'Câu hỏi').fill('Trình độ');
  await dialog(page).getByRole('radio', { name: 'Lựa chọn (chọn một)' }).check();
  await inDialog(page, 'Phương án 1').fill('Mới chơi');
  await inDialog(page, 'Phương án 2').fill('Khá');
  await dialog(page).getByRole('button', { name: 'Thêm', exact: true }).click();
  await expect(inDialog(page, 'Phương án 2')).toHaveAttribute('aria-invalid', 'true');
  await expect(inDialog(page, 'Phương án 1')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(dialog(page).getByText('Phương án tối đa 100 ký tự.')).toBeVisible();
});

test('bước 4: mục "Form mua" hiện đúng các trường và câu hỏi như xem trước ở bước 3; có phần mở bán', async ({
  page,
}) => {
  await openApi(page, [level(0), club(1)]);
  await page.goto(`${base}/thiet-lap?buoc=3`);
  await expect(rows(page)).toHaveCount(2);
  const atStep3 = await fieldNames(previewFields(page));
  expect(atStep3).toEqual(['Tên', 'Số điện thoại', 'Email', 'Trình độ', 'Câu lạc bộ']);

  await page.getByRole('button', { name: 'Tiếp' }).click();
  await expect(page.getByText('Bước 4/4 · Xem trước & mở bán')).toBeVisible();
  const review = page.locator('[data-slot="purchase-form-review"]');
  await expect(review.getByRole('heading', { name: 'Form mua' })).toBeVisible();
  const reviewFields = review.locator('[data-slot="purchase-form-field"]');
  await expect(reviewFields).toHaveCount(5);
  expect(await fieldNames(reviewFields)).toEqual(atStep3);
  await expect(review.getByRole('group', { name: /Trình độ/ }).getByRole('radio')).toHaveCount(3);
  await expect(page.getByText('Sắp có', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot="publish-panel"]').getByRole('heading', { name: 'Mở bán' })).toBeVisible();
  await expect(page.getByText('Đã đủ điều kiện mở bán.')).toBeVisible();
});

test('đủ 20 câu hỏi: "Thêm câu hỏi" tắt kèm lý do', async ({ page }) => {
  await openApi(page, Array.from({ length: 20 }, (_, n) => club(n, { label: `Câu ${n + 1}` })));
  await page.goto(`${base}?tab=form-mua`);
  await expect(rows(page)).toHaveCount(20);
  await expect(page.getByRole('button', { name: 'Thêm câu hỏi' })).toBeDisabled();
  await expect(page.getByText('Đã đủ 20 câu hỏi. Xóa bớt để thêm câu mới.')).toBeVisible();
});

test('320px: trình sửa, xem trước và Dialog không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApi(page, [
    level(0, {
      label: 'Câu hỏi có nhãn rất dài để kiểm tra xuống dòng ở màn hình hẹp của điện thoại',
      options: [
        { id: optionId(0), label: 'Phương án có nhãn rất dài để kiểm tra xuống dòng ở màn hình hẹp' },
        { id: optionId(1), label: 'Ngắn' },
      ],
    }),
    club(1),
  ]);
  await page.goto(`${base}?tab=form-mua`);
  await expect(rows(page)).toHaveCount(2);
  await expect(preview(page)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto(`${base}/thiet-lap?buoc=3`);
  await expect(rows(page)).toHaveCount(2);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: /^Sửa Câu hỏi có nhãn rất dài/ }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(inDialog(page, 'Phương án 2')).toHaveValue('Ngắn');
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
