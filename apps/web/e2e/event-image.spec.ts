import { randomBytes } from 'node:crypto';

import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';

import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, type Call, type Handler, type Reply } from './identity-mock';
import {
  eventImageKey,
  eventImageUploadUrl,
  eventImageUrl,
  mockImageStorage,
  mockOrganizerApi,
  organization,
  ORG_ID,
  presignReply,
  STORAGE_ORIGIN,
  type ImageStorageOptions,
} from './organizer-mock';

/*
 * Ảnh Sự kiện trên web (Story 4.8-b): ô "Ảnh bìa" ở wizard bước 1 và tab "Cài đặt" upload thẳng lên storage ngay khi chọn
 * (presign theo BTC rồi PUT), key vào Sự kiện khi bấm lưu; thumbnail ở `event-card`. API giả có trạng thái; storage giả
 * bằng `page.route` theo host (`mockImageStorage`). Hero và ảnh OG: xem `public-event.spec.ts`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const ORG_NAME = 'CLB Cờ Vua Quận 3';
const EVENT_ID = '019a3b2c-0750-7abc-8def-0123456789ab';
const base = `/btc/${ORG_ID}`;
const settingsUrl = `${base}/su-kien/${EVENT_ID}?tab=cai-dat`;
const eventApiPath = `/orgs/${ORG_ID}/events/${EVENT_ID}`;
const presignPath = `/orgs/${ORG_ID}/event-images`;
/** Ảnh đang có của Sự kiện (đã nằm trên storage giả). */
const OLD_KEY = eventImageKey(900, 'jpg');

type Status = 'draft' | 'published' | 'cancelled';
type EventState = {
  name: string;
  status: Status;
  startsAt: string;
  endsAt: string;
  venue: string | null;
  description: string | null;
  refundPolicy: string | null;
  imageKey: string | null;
};

type ApiOptions = {
  event?: Partial<EventState> | null;
  /** Thay phản hồi presign lần thứ `n` (bắt đầu từ 1); `undefined` → presign hợp lệ cho key thứ `n`. */
  presign?: (n: number) => Reply | undefined;
  /** Thời hạn của presign hợp lệ (mặc định 5 phút như api). */
  presignTtlMs?: number;
  /** Chặn phản hồi `PATCH` tới khi promise xong. */
  holdPatch?: Promise<void>;
  storage?: ImageStorageOptions;
};

type Api = { calls: Call[]; state: { event: EventState | null; rejectImage: boolean } };

const detailOf = (e: EventState) => ({
  id: EVENT_ID,
  organizationId: ORG_ID,
  slug: 'giai-chay-ha-noi-2026-c4d5',
  name: e.name,
  status: e.status,
  startsAt: e.startsAt,
  endsAt: e.endsAt,
  effectiveEndAt: '2099-11-16T23:59:59+07:00',
  endedManuallyAt: null,
  venue: e.venue,
  description: e.description,
  refundPolicy: e.refundPolicy,
  imageKey: e.imageKey,
  imageUrl: e.imageKey ? eventImageUrl(e.imageKey) : null,
  maxTicketsPerOrder: 10,
  createdAt: '2026-11-03T03:00:00+07:00',
  updatedAt: '2026-11-03T03:00:00+07:00',
});

const summaryOf = (e: EventState) => {
  const { id, slug, name, status, startsAt, endsAt, effectiveEndAt, imageUrl } = detailOf(e);
  return { id, slug, name, status, startsAt, endsAt, effectiveEndAt, imageUrl };
};

const EXT: Record<string, 'jpg' | 'png' | 'webp'> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function openApi(page: Page, options: ApiOptions = {}): Promise<Api> {
  const state: Api['state'] = {
    event:
      options.event === null || options.event === undefined
        ? null
        : {
            name: 'Giải chạy Hà Nội 2026',
            status: 'published',
            startsAt: '2099-11-16T07:00:00+07:00',
            endsAt: '2099-11-16T17:00:00+07:00',
            venue: 'Hồ Gươm',
            description: null,
            refundPolicy: 'Hoàn 100% trước 7 ngày.',
            imageKey: null,
            ...options.event,
          },
    rejectImage: false,
  };
  let presigns = 0;
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const write = (raw: unknown, status: Status): EventState => {
    const b = raw as Record<string, unknown>;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
    return {
      name: String(b.name),
      status,
      startsAt: String(b.startsAt),
      endsAt: String(b.endsAt),
      venue: text(b.venue),
      description: text(b.description),
      refundPolicy: text(b.refundPolicy),
      imageKey: (b.imageKey as string | null) ?? null,
    };
  };
  const rejected = () => apiError(400, 'VALIDATION_FAILED', { issues: [{ path: 'imageKey', code: 'custom' }] });
  const handlers: Record<string, Handler> = {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'owner' }),
    'GET /me/memberships': () => ({ status: 200, body: [{ organizationId: ORG_ID, name: ORG_NAME, role: 'owner' }] }),
    [`GET /orgs/${ORG_ID}/events`]: () => ({ status: 200, body: state.event ? [summaryOf(state.event)] : [] }),
    [`POST /orgs/${ORG_ID}/events`]: (request) => {
      if (state.rejectImage) return rejected();
      state.event = write(request.postDataJSON(), 'draft');
      return { status: 201, body: detailOf(state.event) };
    },
    [`GET ${eventApiPath}`]: () =>
      state.event ? { status: 200, body: detailOf(state.event) } : apiError(404, 'EVENT_NOT_FOUND'),
    [`PATCH ${eventApiPath}`]: async (request) => {
      if (options.holdPatch) await options.holdPatch;
      if (!state.event) return apiError(404, 'EVENT_NOT_FOUND');
      if (state.rejectImage) return rejected();
      if (state.event.status === 'cancelled') return apiError(409, 'EVENT_CANCELLED');
      state.event = write(request.postDataJSON(), state.event.status);
      return { status: 200, body: detailOf(state.event) };
    },
    [`POST ${presignPath}`]: (request) => {
      presigns += 1;
      const override = options.presign?.(presigns);
      if (override) return override;
      const { contentType } = request.postDataJSON() as { contentType: string };
      return presignReply(eventImageKey(presigns, EXT[contentType] ?? 'png'), options.presignTtlMs);
    },
  };
  const calls = await mockOrganizerApi(page, handlers);
  return { calls, state };
}

/** PNG thật ~200 KB (nhiễu ngẫu nhiên nên không nén được): trình duyệt vẽ được preview. */
const noisyPng = () =>
  sharp(randomBytes(256 * 256 * 3), { raw: { width: 256, height: 256, channels: 3 } })
    .png()
    .toBuffer();
const solidImage = (format: 'webp' | 'png') =>
  sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 40, g: 90, b: 200 } } })
    .toFormat(format)
    .toBuffer();

const picker = (page: Page) => page.getByRole('group', { name: 'Ảnh bìa' });
const fileInput = (page: Page) => page.locator('[data-slot="event-image-input"]');
const preview = (page: Page) => picker(page).locator('[data-slot="event-image-preview-image"]');
const chooseButton = (page: Page) => picker(page).getByRole('button', { name: /^(Chọn ảnh|Đổi ảnh)/ });
const removeButton = (page: Page) => picker(page).getByRole('button', { name: 'Gỡ ảnh' });
const retryButton = (page: Page) => picker(page).getByRole('button', { name: 'Thử lại' });
/** Vùng lỗi tại ô ảnh: luôn có mặt (ẩn khi rỗng), nên tìm theo thuộc tính chứ không theo cây a11y. */
const imageError = (page: Page) => picker(page).locator('[role="alert"]');
const nameInput = (page: Page) => page.getByLabel('Tên Sự kiện', { exact: true });
const presignCalls = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === presignPath);
const writes = (calls: Call[]) =>
  calls.filter((c) => (c.method === 'POST' && c.path === `/orgs/${ORG_ID}/events`) || c.method === 'PATCH');

const choose = (page: Page, name: string, mimeType: string, buffer: Buffer) =>
  fileInput(page).setInputFiles({ name, mimeType, buffer });

/**
 * Byte PUT lên storage đúng file đã chọn. Playwright với WebKit không đưa body Blob/File vào `postDataBuffer()` (luôn
 * `null`), nên chỉ so được ở Chromium; unit test `event-image-upload.test.ts` kiểm body của PUT chính là `File` đã chọn.
 */
function expectPutBody(browserName: string, body: Buffer | null, file: Buffer) {
  if (browserName === 'webkit') return;
  expect(body?.equals(file)).toBe(true);
}

/** Ảnh đã tải xong và vẽ được (không phải ảnh hỏng). */
const expectLoaded = (image: Locator) =>
  expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);

async function fillRequired(page: Page) {
  await nameInput(page).fill('Giải chạy Hà Nội 2026');
  await page.getByLabel('Bắt đầu', { exact: true }).fill('2099-11-16T07:00');
  await page.getByLabel('Kết thúc', { exact: true }).fill('2099-11-16T17:00');
}

test('wizard (Sự kiện chưa có id): chọn PNG 200 KB → presign theo BTC, PUT đúng content-type và byte, preview hiện; "Lưu nháp" gửi imageKey mới; card có thumbnail', async ({
  page,
  browserName,
}) => {
  const { calls } = await openApi(page, { event: null });
  const puts = await mockImageStorage(page);
  const png = await noisyPng();
  expect(png.length).toBeGreaterThan(190 * 1024);

  await page.goto(`${base}/su-kien/tao`);
  await expect(picker(page)).toContainText('JPEG, PNG hoặc WebP, tối đa 5 MB. Nên dùng ảnh ngang 16:9.');
  await expect(picker(page)).toContainText('Chưa có ảnh bìa');
  await expect(chooseButton(page)).toHaveText('Chọn ảnh');
  await expect(removeButton(page)).toHaveCount(0);
  await fillRequired(page);

  await choose(page, 'anh-bia.png', 'image/png', png);
  await expect(preview(page)).toHaveAttribute('src', /^blob:/);
  await expectLoaded(preview(page));
  await expect(chooseButton(page)).toHaveText('Đổi ảnh');
  await expect(removeButton(page)).toBeVisible();
  expect(presignCalls(calls)).toEqual([
    { method: 'POST', path: presignPath, body: { contentType: 'image/png', contentLength: png.length } },
  ]);
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]!.key).toBe(eventImageKey(1, 'png'));
  expect(puts[0]!.contentType).toBe('image/png');
  expectPutBody(browserName, puts[0]!.body, png);

  await page.getByRole('button', { name: 'Lưu nháp' }).click();
  await page.waitForURL(`**${base}/su-kien/${EVENT_ID}/thiet-lap`);
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0]!.body).toMatchObject({ name: 'Giải chạy Hà Nội 2026', imageKey: eventImageKey(1, 'png') });
  // Trang của Sự kiện đã có: preview là ảnh công khai trên storage.
  await expect(preview(page)).toHaveAttribute('src', eventImageUrl(eventImageKey(1, 'png')));
  await expectLoaded(preview(page));

  await page.goto(base);
  const thumbnail = page.locator('[data-slot="event-card"] [data-slot="event-card-image"]');
  await expect(thumbnail).toHaveAttribute('src', eventImageUrl(eventImageKey(1, 'png')));
  await expect(thumbnail).toHaveClass(/object-cover/);
  await expectLoaded(thumbnail);
  const box = (await thumbnail.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([56, 56]);
  await expect(page.locator('[data-slot="event-card-placeholder"]')).toHaveCount(0);
});

test('file sai (.gif, 6 MB): lỗi tại chỗ, không gọi API; ảnh cũ giữ nguyên và lưu gửi key cũ', async ({ page }) => {
  const { calls } = await openApi(page, { event: { imageKey: OLD_KEY } });
  const puts = await mockImageStorage(page, { objects: [OLD_KEY] });
  await page.goto(settingsUrl);
  await expect(preview(page)).toHaveAttribute('src', eventImageUrl(OLD_KEY));
  await expectLoaded(preview(page));

  await choose(page, 'dong.gif', 'image/gif', Buffer.from('GIF89a'));
  await expect(imageError(page)).toHaveText('Chỉ nhận ảnh JPEG, PNG hoặc WebP.');
  await expect(preview(page)).toHaveAttribute('src', eventImageUrl(OLD_KEY));

  await choose(page, 'lon.png', 'image/png', Buffer.alloc(6 * 1024 * 1024));
  await expect(imageError(page)).toHaveText('Ảnh tối đa 5 MB.');
  await expect(preview(page)).toHaveAttribute('src', eventImageUrl(OLD_KEY));
  await expect(retryButton(page)).toHaveCount(0);
  expect(presignCalls(calls)).toEqual([]);
  expect(puts).toEqual([]);

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: OLD_KEY });
});

test('Cài đặt, PUT lỗi 5xx: "Chưa tải được ảnh." + "Thử lại", ô khác giữ nguyên, lưu gửi ảnh cũ; "Thử lại" PUT lại cùng URL rồi lưu gửi key mới', async ({
  page,
  browserName,
}) => {
  const { calls } = await openApi(page, { event: { imageKey: OLD_KEY } });
  let putAttempts = 0;
  const puts = await mockImageStorage(page, {
    objects: [OLD_KEY],
    put: () => (++putAttempts === 1 ? 503 : 200),
  });
  const webp = await solidImage('webp');
  await page.goto(settingsUrl);
  await nameInput(page).fill('Giải chạy Hà Nội 2026 — mùa thu');

  await choose(page, 'anh-moi.webp', 'image/webp', webp);
  await expect(imageError(page)).toHaveText('Chưa tải được ảnh.');
  await expect(retryButton(page)).toBeVisible();
  await expect(nameInput(page)).toHaveValue('Giải chạy Hà Nội 2026 — mùa thu');
  // Ảnh của form vẫn là ảnh cũ (thứ sẽ được lưu).
  await expect(preview(page)).toHaveAttribute('src', eventImageUrl(OLD_KEY));

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(writes(calls)[0]!.body).toMatchObject({ name: 'Giải chạy Hà Nội 2026 — mùa thu', imageKey: OLD_KEY });

  await retryButton(page).click();
  await expect(imageError(page)).toBeEmpty();
  await expect(retryButton(page)).toHaveCount(0);
  await expect(preview(page)).toHaveAttribute('src', /^blob:/);
  // Presign còn hạn: PUT lại đúng URL cũ, không xin presign mới.
  expect(presignCalls(calls)).toHaveLength(1);
  expect(putAttempts).toBe(2);
  expect(puts.map((p) => p.key)).toEqual([eventImageKey(1, 'webp'), eventImageKey(1, 'webp')]);
  expect(puts[1]!.contentType).toBe('image/webp');
  expectPutBody(browserName, puts[1]!.body, webp);

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect.poll(() => writes(calls).length).toBe(2);
  expect(writes(calls)[1]!.body).toMatchObject({ imageKey: eventImageKey(1, 'webp') });
});

test('wizard, presign lỗi rồi mất mạng khi PUT: lỗi tại chỗ, các ô giữ nguyên; "Thử lại" presign lại, rồi PUT lại cùng URL', async ({
  page,
}) => {
  const { calls } = await openApi(page, {
    event: null,
    presign: (n) => (n === 1 ? apiError(500, 'INTERNAL_ERROR') : undefined),
  });
  let putAttempts = 0;
  const puts = await mockImageStorage(page, { put: () => (++putAttempts === 1 ? 'abort' : 200) });
  await page.goto(`${base}/su-kien/tao`);
  await fillRequired(page);

  await choose(page, 'anh.png', 'image/png', await solidImage('png'));
  await expect(imageError(page)).toHaveText('Chưa tải được ảnh.');
  await expect(picker(page)).toContainText('Chưa có ảnh bìa');
  expect(putAttempts).toBe(0);

  await retryButton(page).click();
  await expect(retryButton(page)).toBeVisible();
  await expect(imageError(page)).toHaveText('Chưa tải được ảnh.');
  expect(presignCalls(calls)).toHaveLength(2);
  expect(putAttempts).toBe(1);
  await expect(nameInput(page)).toHaveValue('Giải chạy Hà Nội 2026');

  await retryButton(page).click();
  await expect(chooseButton(page)).toHaveText('Đổi ảnh');
  await expect(imageError(page)).toBeEmpty();
  expect(presignCalls(calls)).toHaveLength(2);
  expect(puts.map((p) => p.key)).toEqual([eventImageKey(2, 'png')]);

  await page.getByRole('button', { name: 'Lưu nháp' }).click();
  await page.waitForURL(`**${base}/su-kien/${EVENT_ID}/thiet-lap`);
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: eventImageKey(2, 'png') });
});

test('presign đã (gần) hết hạn: "Thử lại" xin presign mới và PUT URL mới', async ({ page }) => {
  // Hạn 10 giây (< 30 giây dự phòng): coi như hết hạn khi thử lại.
  const { calls } = await openApi(page, { event: {}, presignTtlMs: 10_000 });
  let putAttempts = 0;
  const putUrls: string[] = [];
  const puts = await mockImageStorage(page, {
    put: (request) => {
      putUrls.push(request.url());
      return ++putAttempts === 1 ? 503 : 200;
    },
  });
  await page.goto(settingsUrl);
  await choose(page, 'anh.png', 'image/png', await solidImage('png'));
  await expect(retryButton(page)).toBeVisible();

  await retryButton(page).click();
  await expect(chooseButton(page)).toHaveText('Đổi ảnh');
  expect(presignCalls(calls)).toHaveLength(2);
  expect(putUrls).toEqual([eventImageUploadUrl(eventImageKey(1, 'png')), eventImageUploadUrl(eventImageKey(2, 'png'))]);
  expect(puts).toHaveLength(2);

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect.poll(() => writes(calls).length).toBe(1);
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: eventImageKey(2, 'png') });
});

test('đang upload: "Lưu nháp" và "Tiếp" bận, bấm hay Enter không lưu; upload xong thì lưu được', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const { calls } = await openApi(page, { event: null });
  await mockImageStorage(page, { put: () => held.then(() => 200) });
  await page.goto(`${base}/su-kien/tao`);
  await fillRequired(page);

  await choose(page, 'anh.png', 'image/png', await solidImage('png'));
  const draft = page.getByRole('button', { name: /^Lưu nháp/ });
  const next = page.getByRole('button', { name: /^Tiếp/ });
  await expect(chooseButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect(draft).toHaveAttribute('aria-busy', 'true');
  await expect(next).toHaveAttribute('aria-busy', 'true');
  // Preview hiện ngay bằng file đã chọn, trước khi upload xong.
  await expect(preview(page)).toHaveAttribute('src', /^blob:/);
  await draft.click({ force: true });
  await nameInput(page).press('Enter');
  expect(writes(calls)).toEqual([]);

  release();
  await expect(draft).not.toHaveAttribute('aria-busy', 'true');
  await expect(chooseButton(page)).toHaveText('Đổi ảnh');
  await draft.click();
  await page.waitForURL(`**${base}/su-kien/${EVENT_ID}/thiet-lap`);
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: eventImageKey(1, 'png') });
});

test('Cài đặt, đang upload: "Lưu thay đổi" bận, bấm hay Enter không PATCH; upload xong thì PATCH mang key mới', async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const { calls } = await openApi(page, { event: { imageKey: OLD_KEY } });
  await mockImageStorage(page, { objects: [OLD_KEY], put: () => held.then(() => 200) });
  await page.goto(settingsUrl);

  await choose(page, 'anh.png', 'image/png', await solidImage('png'));
  const save = page.getByRole('button', { name: /^Lưu thay đổi/ });
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await save.click({ force: true });
  await nameInput(page).press('Enter');
  expect(writes(calls)).toEqual([]);

  release();
  await expect(save).not.toHaveAttribute('aria-busy', 'true');
  await expect(chooseButton(page)).not.toHaveAttribute('aria-busy', 'true');
  await save.click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: eventImageKey(1, 'png') });
});

test('"Gỡ ảnh" khi đang upload: bỏ upload dở, preview trống, không báo lỗi; lưu gửi imageKey null', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let putStarted = 0;
  const { calls } = await openApi(page, { event: { imageKey: OLD_KEY } });
  const puts = await mockImageStorage(page, {
    objects: [OLD_KEY],
    put: () => {
      putStarted += 1;
      return held.then(() => 200);
    },
  });
  await page.goto(settingsUrl);
  await expectLoaded(preview(page));

  await choose(page, 'anh.png', 'image/png', await solidImage('png'));
  await expect(chooseButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => putStarted).toBe(1);
  await removeButton(page).click();
  release();
  // PUT bị giữ đã trả lời (muộn, sau khi gỡ): kết quả đó không được đổi ô ảnh.
  await expect.poll(() => puts.length).toBe(1);

  await expect(preview(page)).toHaveCount(0);
  await expect(picker(page)).toContainText('Chưa có ảnh bìa');
  await expect(chooseButton(page)).toHaveText('Chọn ảnh');
  await expect(chooseButton(page)).not.toHaveAttribute('aria-busy', 'true');
  await expect(imageError(page)).toBeEmpty();
  await expect(retryButton(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: null });
});

test('đang lưu: ô ảnh tạm khóa (không chọn, không gỡ); lưu xong mở lại', async ({ page }) => {
  let release = () => {};
  const { calls } = await openApi(page, {
    event: { imageKey: OLD_KEY },
    holdPatch: new Promise<void>((resolve) => (release = resolve)),
  });
  await mockImageStorage(page, { objects: [OLD_KEY] });
  await page.goto(settingsUrl);
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(chooseButton(page)).toBeDisabled();
  await expect(removeButton(page)).toBeDisabled();

  release();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  await expect(chooseButton(page)).toBeEnabled();
  await expect(removeButton(page)).toBeEnabled();
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: OLD_KEY });
});

test('máy offline: "Chưa tải được ảnh." + "Thử lại" (không treo); có mạng lại thì "Thử lại" tải được', async ({
  page,
  context,
}) => {
  const { calls } = await openApi(page, { event: {} });
  const puts = await mockImageStorage(page);
  // `page.route` vẫn trả lời khi context offline: route đăng ký sau (được ưu tiên) cho presign và storage thất bại như
  // trình duyệt mất mạng thật, có mạng lại thì nhường cho API và storage giả.
  let offline = false;
  await page.route(
    (url) => url.origin === STORAGE_ORIGIN || url.pathname.endsWith(presignPath),
    (route) => (offline ? route.abort('internetdisconnected') : route.fallback()),
  );
  await page.goto(settingsUrl);
  offline = true;
  await context.setOffline(true);

  await choose(page, 'anh.png', 'image/png', await solidImage('png'));
  await expect(imageError(page)).toHaveText('Chưa tải được ảnh.');
  await expect(retryButton(page)).toBeVisible();
  await expect(chooseButton(page)).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).not.toHaveAttribute('aria-busy', 'true');
  expect(puts).toEqual([]);

  offline = false;
  await context.setOffline(false);
  await retryButton(page).click();
  await expect(chooseButton(page)).toHaveText('Đổi ảnh');
  await expect(imageError(page)).toBeEmpty();
  expect(puts).toHaveLength(1);

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: puts[0]!.key });
});

test('wizard của Sự kiện đã có ảnh: "Tiếp" gửi lại key đang có', async ({ page }) => {
  const { calls } = await openApi(page, { event: { status: 'draft', imageKey: OLD_KEY } });
  await mockImageStorage(page, { objects: [OLD_KEY] });
  await page.goto(`${base}/su-kien/${EVENT_ID}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp' }).click();

  await expect(page.getByText('Bước 3/4 · Form mua')).toBeVisible();
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0]).toMatchObject({ method: 'PATCH', path: eventApiPath, body: { imageKey: OLD_KEY } });
});

test('"Gỡ ảnh": preview về trống, lưu gửi imageKey null; card dashboard về ô không ảnh', async ({ page }) => {
  const { calls, state } = await openApi(page, { event: { imageKey: OLD_KEY } });
  await mockImageStorage(page, { objects: [OLD_KEY] });
  await page.goto(base);
  await expectLoaded(page.locator('[data-slot="event-card-image"]'));

  await page.goto(settingsUrl);
  await expectLoaded(preview(page));
  await removeButton(page).click();
  await expect(preview(page)).toHaveCount(0);
  await expect(picker(page)).toContainText('Chưa có ảnh bìa');
  await expect(chooseButton(page)).toHaveText('Chọn ảnh');
  await expect(removeButton(page)).toHaveCount(0);
  // Gỡ chỉ đổi giá trị trong form: chưa gọi api.
  expect(writes(calls)).toEqual([]);

  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(writes(calls)).toHaveLength(1);
  expect(writes(calls)[0]!.body).toMatchObject({ imageKey: null });
  expect(state.event?.imageKey).toBeNull();

  await page.goto(base);
  await expect(page.locator('[data-slot="event-card-placeholder"]')).toBeVisible();
  await expect(page.locator('[data-slot="event-card-image"]')).toHaveCount(0);
});

test('server từ chối key (400 tại imageKey): lỗi tại ô ảnh, không báo chung ở ô tên; chọn ảnh khác thì lỗi mất', async ({
  page,
}) => {
  const { calls, state } = await openApi(page, { event: {} });
  await mockImageStorage(page);
  await page.goto(settingsUrl);
  await choose(page, 'anh.png', 'image/png', await solidImage('png'));
  await expect(chooseButton(page)).toHaveText('Đổi ảnh');

  state.rejectImage = true;
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(imageError(page)).toHaveText('Ảnh không hợp lệ. Chọn lại ảnh.');
  await expect(nameInput(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Thông tin chưa hợp lệ. Kiểm tra lại các ô rồi lưu lại.')).toHaveCount(0);
  await expect(page.getByText('Chưa lưu được thông tin')).toHaveCount(0);
  expect(writes(calls)).toHaveLength(1);

  state.rejectImage = false;
  await choose(page, 'anh-khac.png', 'image/png', await solidImage('png'));
  await expect(imageError(page)).toBeEmpty();
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Đã lưu thông tin Sự kiện.')).toBeVisible();
  expect(writes(calls)[1]!.body).toMatchObject({ imageKey: eventImageKey(2, 'png') });
});

test('wizard: server từ chối key → về bước 1, lỗi tại ô ảnh', async ({ page }) => {
  const { state } = await openApi(page, { event: { status: 'draft', imageKey: OLD_KEY } });
  await mockImageStorage(page, { objects: [OLD_KEY] });
  await page.goto(`${base}/su-kien/${EVENT_ID}/thiet-lap?buoc=2`);
  await expect(page.getByText('Bước 2/4 · Hạng vé')).toBeVisible();
  state.rejectImage = true;
  await page.getByRole('button', { name: 'Tiếp' }).click();

  await expect(page.getByText('Bước 1/4 · Thông tin')).toBeVisible();
  await expect(imageError(page)).toHaveText('Ảnh không hợp lệ. Chọn lại ảnh.');
  await expect(nameInput(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Chưa lưu được Sự kiện')).toHaveCount(0);
});

test('Sự kiện đã hủy: ô ảnh chỉ đọc (preview, không chọn, không gỡ)', async ({ page }) => {
  await openApi(page, { event: { status: 'cancelled', imageKey: OLD_KEY } });
  await mockImageStorage(page, { objects: [OLD_KEY] });
  await page.goto(settingsUrl);
  await expect(page.getByText('Thông tin chỉ để xem, không sửa được nữa.')).toBeVisible();
  await expect(preview(page)).toHaveAttribute('src', eventImageUrl(OLD_KEY));
  await expectLoaded(preview(page));
  await expect(picker(page).getByRole('button')).toHaveCount(0);
  await expect(fileInput(page)).toHaveCount(0);
});

test('card dashboard: ảnh tải lỗi → ô không ảnh như trước', async ({ page }) => {
  // Key không có trên storage giả: GET trả 404.
  await openApi(page, { event: { imageKey: eventImageKey(404) } });
  await mockImageStorage(page);
  await page.goto(base);
  await expect(page.locator('[data-slot="event-card-placeholder"]')).toBeVisible();
  await expect(page.locator('[data-slot="event-card-image"]')).toHaveCount(0);
});

test('320px: ô ảnh có ảnh không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openApi(page, { event: { imageKey: OLD_KEY } });
  await mockImageStorage(page, { objects: [OLD_KEY] });
  await page.goto(settingsUrl);
  await expectLoaded(preview(page));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
