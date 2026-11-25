import type { Locator, Page, Request } from '@playwright/test';

import { fakeCamera, recordScanSound, type CameraMode } from './checkin-camera';
import {
  checkerRevoked,
  CHECKER_REVOKED_MESSAGE,
  checkinEvent,
  lookupRateLimited,
  lookupResult,
  mockCheckinApi,
  notAMember,
  NOT_A_MEMBER_MESSAGE,
  scanResult,
  type CheckinHandler,
  type LookupTicket,
} from './checkin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, unauthenticated, type Call, type Reply } from './identity-mock';

/*
 * Tra tay và check-in tay trên Màn quét (Story 5.5, UX-DR32) với API giả và camera giả: "Tra tay" mở `manual-lookup`
 * (Sheet từ dưới, ô tìm tự focus, nhãn luôn hiện), camera không giải mã khi Sheet mở; debounce và chỉ gửi khi đủ SĐT /
 * email (đúng một request khi gõ từng ký tự); kết quả lưu theo giá trị đã chuẩn hóa; không có Vé, 429, 5xx / lỗi mạng
 * ("Thử lại"), offline; check-in tay (spinner, nút khác tắt, `Idempotency-Key` mỗi lượt bấm, giữ khóa khi bấm lại sau lỗi
 * mạng / 5xx), overlay như khi quét, Sheet mở lại khi còn Vé chưa check-in; ở màn "Bật camera" và camera bị từ chối;
 * 401/403; 320px.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const EVENT_NAME = 'Giải Pickleball Mở rộng CLB Sóng Xanh 2026';
const SCAN_PATH = `/events/${EVENT_ID}`;
const EVENT_API = `/checkin/events/${EVENT_ID}`;
const SCAN_API = `${EVENT_API}/scans`;
const LOOKUP_API = `${EVENT_API}/lookups`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LABEL = 'SĐT hoặc email Người mua';
const INCOMPLETE = 'Nhập đủ SĐT hoặc email để tra.';
const EMPTY = 'Không tìm thấy Vé khớp.';
const OFFLINE = 'Tra tay cần mạng.';

const ticketId = (n: number) => `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`;
const checkInApi = (n: number) => `${EVENT_API}/tickets/${ticketId(n)}/check-in`;
/** Mã QR vé dạng thật `t<k>.<ticketId>.<sig>` (chữ ký giả). */
const ticketCode = (n: number) => `t1.${ticketId(n)}.${String(n).padStart(43, 'Q')}`;

const ticket = (n: number, overrides: Partial<LookupTicket> = {}): LookupTicket => ({
  ticketId: ticketId(n),
  holderName: 'Nguyễn Văn Minh',
  ticketTypeName: 'Đôi nam',
  seq: n,
  count: 3,
  checkedIn: false,
  ...overrides,
});

const okOf = (t: LookupTicket) => ({
  outcome: 'ok',
  holderName: t.holderName,
  seq: t.seq,
  count: t.count,
  ticketTypeName: t.ticketTypeName,
});

const lookups = (calls: Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === LOOKUP_API).map((c) => c.body as { query: string });
const scans = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === SCAN_API);
const checkIns = (calls: Call[], n: number) => calls.filter((c) => c.method === 'POST' && c.path === checkInApi(n));
const eventLoads = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === EVENT_API).length;

const enableButton = (page: Page) => page.getByRole('button', { name: 'Bật camera' });
const manualLookupButton = (page: Page) => page.getByRole('button', { name: 'Tra tay' });
const viewport = (page: Page) => page.locator('[data-slot="scanner-viewport"]');
const overlay = (page: Page) => page.locator('[data-slot="scan-result-overlay"]');
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Tra tay' });
const input = (page: Page) => sheet(page).getByLabel(LABEL);
const rows = (page: Page) => sheet(page).locator('[data-slot="manual-lookup-row"]');
const checkInButton = (row: Locator) => row.getByRole('button', { name: 'Check-in' });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Setup = {
  camera?: CameraMode;
  lookup?: CheckinHandler;
  checkIn?: Record<number, CheckinHandler>;
  scan?: CheckinHandler;
  event?: CheckinHandler;
};

/** Đã đăng nhập; camera giả, âm thanh ghi lại; API CTV giả (tra tay, check-in tay theo số Vé). */
async function openScanScreen(page: Page, { camera: mode = 'grant', lookup, checkIn = {}, scan, event }: Setup = {}) {
  const camera = await fakeCamera(page, mode);
  const sound = await recordScanSound(page);
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockCheckinApi(page, {
    [`GET ${EVENT_API}`]: event ?? (() => checkinEvent(EVENT_ID, EVENT_NAME, { checkedInCount: 3, validTicketCount: 10 })),
    ...(lookup ? { [`POST ${LOOKUP_API}`]: lookup } : {}),
    ...(scan ? { [`POST ${SCAN_API}`]: scan } : {}),
    ...Object.fromEntries(Object.entries(checkIn).map(([n, handler]) => [`POST ${checkInApi(Number(n))}`, handler])),
  });
  await page.goto(SCAN_PATH);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  return { camera, sound, calls };
}

async function startCamera(page: Page, camera: Awaited<ReturnType<typeof fakeCamera>>) {
  await enableButton(page).click();
  await expect(viewport(page)).toBeVisible();
  await expect.poll(async () => (await camera.state()).live).toBe(1);
}

/** Bấm "Tra tay" và chờ Sheet mở với ô tìm có focus. */
async function openLookup(page: Page) {
  await manualLookupButton(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

/** Khóa `Idempotency-Key` của request check-in tay (Playwright trả tên header chữ thường). */
const keyOf = (request: Request) => request.headers()['idempotency-key'] ?? '';

/**
 * Ghi lại mọi `[data-slot="<slot>"]` được chèn vào trang từ lúc gọi (`MutationObserver`), kèm việc lúc chèn nó có nằm
 * trong một cây `aria-hidden="true"` hay không. Trả hàm đọc danh sách đã ghi.
 */
async function watchInserted(page: Page, slot: string): Promise<() => Promise<{ hidden: boolean }[]>> {
  const name = `__inserted_${slot.replace(/-/g, '_')}`;
  await page.evaluate(
    ({ slot: s, name: n }) => {
      const seen: { hidden: boolean }[] = [];
      (window as unknown as Record<string, unknown>)[n] = seen;
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            const found = node.matches(`[data-slot="${s}"]`) ? [node] : [...node.querySelectorAll(`[data-slot="${s}"]`)];
            for (const el of found) seen.push({ hidden: el.closest('[aria-hidden="true"]') !== null });
          }
        }
      }).observe(document, { childList: true, subtree: true });
    },
    { slot, name },
  );
  return () => page.evaluate((n) => (window as unknown as Record<string, { hidden: boolean }[]>)[n]!, name);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('mở từ Màn quét: Sheet từ dưới, tiêu đề "Tra tay", ô tìm có focus, nhãn luôn hiện; mã QR trước camera không tạo request quét khi Sheet mở; đóng Sheet thì quét tiếp', async ({
  page,
}) => {
  const { camera, calls } = await openScanScreen(page, {
    scan: () => scanResult({ outcome: 'ok', holderName: 'Lê Thu', seq: 1, count: 1, ticketTypeName: 'Đơn nữ' }),
  });
  await startCamera(page, camera);
  await openLookup(page);
  await expect(sheet(page).getByRole('heading', { name: 'Tra tay' })).toBeVisible();
  await expect(sheet(page)).toHaveAttribute('data-side', 'bottom');
  // Neo đáy màn (chờ hết animation trượt lên).
  await expect
    .poll(async () => {
      const box = (await sheet(page).boundingBox())!;
      return Math.round(box.y + box.height);
    })
    .toBe(page.viewportSize()!.height);
  const label = sheet(page).getByText(LABEL, { exact: true });
  await expect(label).toBeVisible();
  await input(page).fill('0912');
  // Nhãn luôn hiện (không phải placeholder) kể cả khi ô có chữ.
  await expect(label).toBeVisible();
  await expect(sheet(page).getByText(INCOMPLETE)).toBeVisible();

  await camera.show(ticketCode(1));
  await sleep(1500);
  expect(scans(calls)).toHaveLength(0);
  expect((await camera.state()).live).toBe(1);

  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  expect(scans(calls)).toHaveLength(1);
});

test('gõ từng ký tự SĐT 10 số: đúng một request tra sau khi đủ số, body là SĐT E.164; kết quả theo hàng; cùng số gõ cách khác dùng lại kết quả', async ({
  page,
}) => {
  const { calls } = await openScanScreen(page, {
    lookup: () =>
      lookupResult([ticket(1), ticket(2, { checkedIn: true }), ticket(3, { ticketTypeName: 'Đôi nam nữ', seq: 3 })]),
  });
  await openLookup(page);
  await input(page).pressSequentially('0912 345 67', { delay: 60 });
  await expect(sheet(page).getByText(INCOMPLETE)).toBeVisible();
  await sleep(400);
  expect(lookups(calls)).toEqual([]);

  await input(page).press('8');
  await expect(rows(page)).toHaveCount(3);
  await expect(sheet(page).getByText(INCOMPLETE)).toHaveCount(0);
  expect(lookups(calls)).toEqual([{ query: '+84912345678' }]);
  await expect(sheet(page).locator('[data-slot="manual-lookup-count"]')).toHaveText('3 Vé khớp');

  const [first, second, third] = [rows(page).nth(0), rows(page).nth(1), rows(page).nth(2)];
  await expect(first.locator('[data-slot="manual-lookup-name"]')).toHaveText('Nguyễn Văn Minh');
  await expect(first.locator('[data-slot="manual-lookup-meta"]')).toHaveText('Đôi nam · Vé 1/3');
  await expect(first.locator('[data-slot="status-badge"]')).toHaveText('Hợp lệ');
  await expect(first.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'success');
  await expect(checkInButton(first)).toBeEnabled();
  await expect(second.locator('[data-slot="status-badge"]')).toHaveText('Đã check-in');
  await expect(second.locator('[data-slot="status-badge"]')).toHaveAttribute('data-tone', 'neutral');
  await expect(checkInButton(second)).toHaveCount(0);
  await expect(third.locator('[data-slot="manual-lookup-meta"]')).toHaveText('Đôi nam nữ · Vé 3/3');
  // Nút "Check-in" cao 44px.
  expect(Math.round((await checkInButton(first).boundingBox())!.height)).toBe(44);

  await sleep(500);
  expect(lookups(calls)).toHaveLength(1);
  // Cùng số, gõ cách khác: dùng kết quả đã có, không tra lại.
  for (const typed of ['0912.345.678', '+84 912 345 678']) {
    await input(page).fill(typed);
    await expect(rows(page)).toHaveCount(3);
  }
  await sleep(400);
  expect(lookups(calls)).toHaveLength(1);
  // Giá trị tra chỉ đi trong body: không vào URL của trang.
  expect(page.url()).not.toContain('912');
});

test('gõ từng ký tự một email: tiền tố đã là email hợp lệ (`minh@gmail.co`) vẫn không gửi nhờ debounce; đúng một request với email đủ', async ({
  page,
}) => {
  const { calls } = await openScanScreen(page, { lookup: () => lookupResult([]) });
  await openLookup(page);
  await input(page).pressSequentially('minh@gmail.com', { delay: 60 });
  await sleep(400);
  expect(lookups(calls)).toEqual([{ query: 'minh@gmail.com' }]);
  await expect(sheet(page).getByText(EMPTY)).toBeVisible();
});

test('Enter / "Tìm" trên bàn phím: ô tìm mất focus (bàn phím đóng), không gửi thêm request', async ({ page }) => {
  const { calls } = await openScanScreen(page, { lookup: () => lookupResult([ticket(1)]) });
  await openLookup(page);
  await input(page).fill('0912345678');
  await expect(rows(page)).toHaveCount(1);
  await input(page).press('Enter');
  await expect(input(page)).not.toBeFocused();
  await expect(sheet(page)).toBeVisible();
  await sleep(400);
  expect(lookups(calls)).toHaveLength(1);
});

test('email: trim + chữ thường; không có Vé → "Không tìm thấy Vé khớp."; SĐT hay email chưa đủ → dòng nhắc, không gửi', async ({
  page,
}) => {
  const { calls } = await openScanScreen(page, { lookup: () => lookupResult([]) });
  await openLookup(page);
  await input(page).fill('  Minh@Gmail.com ');
  await expect(sheet(page).getByText(EMPTY)).toBeVisible();
  expect(lookups(calls)).toEqual([{ query: 'minh@gmail.com' }]);
  await expect(rows(page)).toHaveCount(0);

  for (const partial of ['minh@', '0912345', 'Nguyễn Văn Minh']) {
    await input(page).fill(partial);
    await expect(sheet(page).getByText(INCOMPLETE)).toBeVisible();
    await expect(sheet(page).getByText(EMPTY)).toHaveCount(0);
  }
  await sleep(400);
  expect(lookups(calls)).toHaveLength(1);
});

test('429: "Tra quá nhiều lần. Thử lại sau N giây."; 5xx và lỗi mạng: dải lỗi kèm "Thử lại", không tự thử lại; offline: "Tra tay cần mạng.", không gửi', async ({
  page,
}) => {
  const attempts = new Map<string, number>();
  const { calls } = await openScanScreen(page, {
    lookup: (request) => {
      const { query } = request.postDataJSON() as { query: string };
      const n = (attempts.get(query) ?? 0) + 1;
      attempts.set(query, n);
      if (query === '+84911111111') return lookupRateLimited(42);
      if (query === '+84922222222') return n === 1 ? apiError(500, 'INTERNAL_ERROR') : lookupResult([ticket(1)]);
      if (query === '+84933333333') return n === 1 ? 'abort' : lookupResult([ticket(2)]);
      return lookupResult([ticket(3)]);
    },
  });
  await openLookup(page);

  await input(page).fill('0911111111');
  await expect(sheet(page).getByText('Tra quá nhiều lần. Thử lại sau 42 giây.')).toBeVisible();

  for (const [typed, row] of [
    ['0922222222', 1],
    ['0933333333', 2],
  ] as const) {
    await input(page).fill(typed);
    const strip = sheet(page).locator('[data-slot="status-banner"][data-tone="danger"]');
    await expect(strip).toContainText('Chưa tra được');
    await sleep(1000);
    expect(lookups(calls).filter((b) => b.query === `+84${typed.slice(1)}`)).toHaveLength(1);
    await strip.getByRole('button', { name: 'Thử lại' }).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('[data-slot="manual-lookup-meta"]')).toHaveText(`Đôi nam · Vé ${row}/3`);
    expect(lookups(calls).filter((b) => b.query === `+84${typed.slice(1)}`)).toHaveLength(2);
  }

  await page.context().setOffline(true);
  await expect(sheet(page).getByText(OFFLINE)).toBeVisible();
  // Kết quả đã có vẫn hiện, nhưng không check-in tay khi offline.
  await expect(checkInButton(rows(page).first())).toBeDisabled();
  const before = lookups(calls).length;
  await input(page).fill('0944444444');
  await sleep(800);
  expect(lookups(calls)).toHaveLength(before);

  await page.context().setOffline(false);
  await expect(sheet(page).getByText(OFFLINE)).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first().locator('[data-slot="manual-lookup-meta"]')).toHaveText('Đôi nam · Vé 3/3');
  expect(lookups(calls)).toHaveLength(before + 1);
});

test('check-in tay khách đi nhóm: spinner, nút khác tắt; Idempotency-Key mỗi lượt bấm; ok → Sheet đóng, overlay xanh; đóng overlay → Sheet mở lại nguyên ô tìm và kết quả (không tra lại), số đã check-in tải lại; hết Vé chưa check-in → về camera', async ({
  page,
}) => {
  let checkedIn = 3;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const keys: Record<number, string[]> = { 1: [], 3: [] };
  const group = [ticket(1), ticket(2, { checkedIn: true }), ticket(3)];
  const { camera, sound, calls } = await openScanScreen(page, {
    event: () => checkinEvent(EVENT_ID, EVENT_NAME, { checkedInCount: checkedIn, validTicketCount: 10 }),
    scan: () => scanResult(okOf(ticket(9))),
    lookup: () => lookupResult(group),
    checkIn: {
      1: async (request) => {
        keys[1]!.push(keyOf(request));
        await held;
        checkedIn += 1;
        return scanResult(okOf(group[0]!));
      },
      3: (request) => {
        keys[3]!.push(keyOf(request));
        checkedIn += 1;
        return scanResult(okOf(group[2]!));
      },
    },
  });
  await startCamera(page, camera);
  await expect(page.locator('[data-slot="scanner-count"]')).toHaveText('Đã check-in 3/10');
  await openLookup(page);
  await input(page).fill('0912 345 678');
  await expect(rows(page)).toHaveCount(3);

  const overlays = await watchInserted(page, 'scan-result-overlay');
  await checkInButton(rows(page).nth(0)).click();
  await expect(checkInButton(rows(page).nth(0))).toHaveAttribute('aria-busy', 'true');
  await expect(checkInButton(rows(page).nth(2))).toBeDisabled();
  await expect.poll(() => keys[1]!.length).toBe(1);
  expect(keys[1]![0]).toMatch(UUID);
  // Không body: chỉ Vé trong đường dẫn và khóa trong header.
  expect(checkIns(calls, 1)[0]!.body).toBeNull();

  const loadsBefore = eventLoads(calls);
  release();
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveText('Nguyễn Văn Minh · Vé 1/3 · Đôi nam');
  await expect(sheet(page)).toHaveCount(0);
  expect((await sound()).tones).toEqual(['sine']);
  // Overlay gắn vào `body`: lúc chèn không nằm trong cây `aria-hidden` của Sheet đang đóng.
  expect(await overlays()).toEqual([{ hidden: false }]);
  // Check-in tay không khóa cổng quét, nhưng overlay đang phủ thì camera không giải mã.
  await camera.show(ticketCode(9));
  await sleep(1000);
  expect(scans(calls)).toHaveLength(0);

  // Overlay xanh tự đóng → Sheet mở lại với ô tìm và kết quả cũ, hàng vừa check-in thành "Đã check-in".
  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  await expect(sheet(page)).toBeVisible();
  await expect(input(page)).toHaveValue('0912 345 678');
  await expect(rows(page).nth(0).locator('[data-slot="status-badge"]')).toHaveText('Đã check-in');
  await expect(checkInButton(rows(page).nth(0))).toHaveCount(0);
  await expect(checkInButton(rows(page).nth(2))).toBeEnabled();
  expect(lookups(calls)).toHaveLength(1);
  // Sheet mở: vẫn không giải mã. Bỏ mã khỏi khung trước khi về camera.
  expect(scans(calls)).toHaveLength(0);
  await camera.show(null);
  await expect.poll(() => eventLoads(calls)).toBeGreaterThan(loadsBefore);
  await expect(page.locator('[data-slot="scanner-count"]')).toHaveText('Đã check-in 4/10');

  await checkInButton(rows(page).nth(2)).click();
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  // Hết Vé chưa check-in → về camera, Sheet không mở lại.
  await sleep(300);
  await expect(sheet(page)).toHaveCount(0);
  await expect(viewport(page)).toBeVisible();
  await expect(page.locator('[data-slot="scanner-count"]')).toHaveText('Đã check-in 5/10');
  expect(keys[3]).toHaveLength(1);
  expect(keys[3]![0]).toMatch(UUID);
  expect(keys[3]![0]).not.toBe(keys[1]![0]);
  expect(lookups(calls)).toHaveLength(1);
  expect(scans(calls)).toHaveLength(0);
});

test('kết quả quét tới khi Sheet đang mở (mã đọc ngay trước khi bấm "Tra tay"): overlay hiện, Sheet đóng; đóng overlay thì Sheet mở lại nguyên chữ đã gõ, không tra lại', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { camera, calls } = await openScanScreen(page, {
    scan: async () => {
      await held;
      return scanResult(okOf(ticket(9)));
    },
    lookup: () => lookupResult([ticket(1)]),
  });
  await startCamera(page, camera);
  await camera.show(ticketCode(9));
  await expect.poll(() => scans(calls).length).toBe(1);
  await camera.show(null);

  await openLookup(page);
  await input(page).fill('0912 345 678');
  await expect(rows(page)).toHaveCount(1);
  release();
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  await expect(sheet(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  await expect(sheet(page)).toBeVisible();
  await expect(input(page)).toHaveValue('0912 345 678');
  await expect(rows(page)).toHaveCount(1);
  expect(lookups(calls)).toHaveLength(1);
  // Chỉ một lần quét (gửi lại nếu quá hạn 3 giây thì vẫn cùng `scanId`).
  expect(new Set(scans(calls).map((c) => (c.body as { scanId: string }).scanId)).size).toBe(1);
});

test('bấm lại sau lỗi mạng hay 5xx dùng cùng Idempotency-Key; lượt bấm Vé khác dùng khóa mới', async ({ page }) => {
  const replies: (Reply | 'abort')[] = ['abort', apiError(503, 'SERVICE_UNAVAILABLE'), scanResult(okOf(ticket(1)))];
  const keys: Record<number, string[]> = { 1: [], 3: [] };
  const { calls } = await openScanScreen(page, {
    lookup: () => lookupResult([ticket(1), ticket(3)]),
    checkIn: {
      1: (request) => {
        keys[1]!.push(keyOf(request));
        return replies.shift()!;
      },
      3: (request) => {
        keys[3]!.push(keyOf(request));
        return scanResult(okOf(ticket(3)));
      },
    },
  });
  await openLookup(page);
  await input(page).fill('0912345678');
  await expect(rows(page)).toHaveCount(2);

  const strip = sheet(page).locator('[data-slot="status-banner"][data-tone="danger"]');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await checkInButton(rows(page).nth(0)).click();
    await expect(strip).toContainText('Chưa check-in được');
    await expect(checkInButton(rows(page).nth(0))).toBeEnabled();
    await expect(checkInButton(rows(page).nth(1))).toBeEnabled();
    await expect(overlay(page)).toHaveCount(0);
    expect(keys[1]).toHaveLength(attempt);
  }
  // Không tự gửi lại.
  await sleep(800);
  expect(checkIns(calls, 1)).toHaveLength(2);

  await checkInButton(rows(page).nth(0)).click();
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  expect(keys[1]).toHaveLength(3);
  expect(new Set(keys[1]).size).toBe(1);
  expect(keys[1]![0]).toMatch(UUID);

  // Còn Vé 3 chưa check-in → Sheet mở lại; lượt bấm mới dùng khóa mới.
  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  await expect(sheet(page)).toBeVisible();
  await expect(strip).toHaveCount(0);
  await checkInButton(rows(page).nth(1)).click();
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  expect(keys[3]).toHaveLength(1);
  expect(keys[3]![0]).not.toBe(keys[1]![0]);
});

test('người khác đã check-in (hàng cũ trên Sheet): overlay đỏ "Đã check-in" có âm thanh, giữ tới khi chạm; "Tra tay" mở mới thì ô tìm trống, không hiện hàng của khách trước, gõ lại cùng số thì tra lại', async ({
  page,
}) => {
  let looked = 0;
  const { sound, calls } = await openScanScreen(page, {
    lookup: () => {
      looked += 1;
      return lookupResult([ticket(1, { checkedIn: looked > 1 })]);
    },
    checkIn: {
      1: () =>
        scanResult({
          outcome: 'already',
          checkedInAt: '2026-11-25T19:05:00+07:00',
          checkedBy: { kind: 'role', role: 'checker' },
        }),
    },
  });
  await openLookup(page);
  await input(page).fill('0912345678');
  await checkInButton(rows(page).first()).click();

  await expect(overlay(page)).toHaveAttribute('data-tone', 'danger');
  await expect(overlay(page).locator('[data-slot="scan-result-title"]')).toHaveText('Đã check-in');
  await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveText('lúc 19:05 · bởi CTV khác');
  await expect.poll(async () => (await sound()).tones).toEqual(['square', 'square']);
  await sleep(2000);
  await expect(overlay(page)).toBeVisible();
  await overlay(page).getByRole('button', { name: 'Chạm để quét tiếp' }).click();
  await expect(overlay(page)).toHaveCount(0);
  // Không còn Vé chưa check-in → về màn trước ("Bật camera"), Sheet không mở lại.
  await sleep(300);
  await expect(sheet(page)).toHaveCount(0);
  await expect(enableButton(page)).toBeVisible();

  const inserted = await watchInserted(page, 'manual-lookup-row');
  await openLookup(page);
  await expect(input(page)).toHaveValue('');
  await sleep(500);
  expect(await inserted()).toEqual([]);
  // Kết quả cũ đã bị bỏ: gõ lại cùng số thì tra lại (Vé vừa được check-in ở nơi khác).
  await input(page).fill('0912 345 678');
  await expect(rows(page).first().locator('[data-slot="status-badge"]')).toHaveText('Đã check-in');
  expect(lookups(calls)).toHaveLength(2);
});

test('"Tra tay" mở mới sau một lượt check-in lỗi: dải "Chưa check-in được…" của lượt trước không còn', async ({ page }) => {
  await openScanScreen(page, {
    lookup: () => lookupResult([ticket(1)]),
    checkIn: { 1: () => apiError(503, 'SERVICE_UNAVAILABLE') },
  });
  await openLookup(page);
  await input(page).fill('0912345678');
  await checkInButton(rows(page).first()).click();
  const strip = sheet(page).locator('[data-slot="status-banner"][data-tone="danger"]');
  await expect(strip).toContainText('Chưa check-in được');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await openLookup(page);
  await expect(input(page)).toHaveValue('');
  await expect(strip).toHaveCount(0);
});

for (const [label, mode, heading] of [
  ['"Bật camera"', 'grant', null],
  ['camera bị từ chối', 'deny', 'Chưa được dùng camera'],
  ['không mở được camera', 'not-found', 'Không mở được camera'],
] as const) {
  test(`"Tra tay" ở màn ${label}: check-in tay hiện overlay, đóng overlay thì về đúng màn đó`, async ({ page }) => {
    const { calls } = await openScanScreen(page, {
      camera: mode,
      lookup: () => lookupResult([ticket(1)]),
      checkIn: { 1: () => scanResult({ outcome: 'invalid', reason: 'EVENT_ENDED' }) },
    });
    if (heading) {
      await enableButton(page).click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
    await expect(manualLookupButton(page)).toBeEnabled();
    await openLookup(page);
    await input(page).fill('0912345678');
    await checkInButton(rows(page).first()).click();
    await expect(overlay(page)).toHaveAttribute('data-tone', 'danger');
    await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveText('Sự kiện đã kết thúc');
    await overlay(page).getByRole('button', { name: 'Chạm để quét tiếp' }).click();
    await expect(overlay(page)).toHaveCount(0);
    // `invalid` không đổi hàng: còn Vé chưa check-in → Sheet mở lại; đóng Sheet thì về đúng màn trước.
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet(page)).toHaveCount(0);
    if (heading) await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    else await expect(enableButton(page)).toBeVisible();
    expect(checkIns(calls, 1)).toHaveLength(1);
  });
}

test('401 khi check-in tay: sang đăng nhập với returnTo là Màn quét', async ({ page }) => {
  await openScanScreen(page, { lookup: () => lookupResult([ticket(1)]), checkIn: { 1: unauthenticated } });
  await openLookup(page);
  await input(page).fill('0912345678');
  await checkInButton(rows(page).first()).click();
  await page.waitForURL((url) => url.pathname === '/dang-nhap');
  expect(new URL(page.url()).search).toBe(`?returnTo=${encodeURIComponent(SCAN_PATH)}`);
});

test('403 khi tra (CHECKER_REVOKED): màn hết quyền với câu của api thay Màn quét, camera tắt', async ({ page }) => {
  const { camera } = await openScanScreen(page, { lookup: checkerRevoked });
  await startCamera(page, camera);
  await openLookup(page);
  await input(page).fill('0912345678');
  await expect(page.getByRole('heading', { name: CHECKER_REVOKED_MESSAGE })).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByText(EVENT_NAME)).toHaveCount(0);
  await expect.poll(async () => (await camera.state()).live).toBe(0);
});

test('403 khi check-in tay (NOT_A_MEMBER): màn hết quyền với câu của api, không overlay', async ({ page }) => {
  await openScanScreen(page, { lookup: () => lookupResult([ticket(1)]), checkIn: { 1: notAMember } });
  await openLookup(page);
  await input(page).fill('0912345678');
  await checkInButton(rows(page).first()).click();
  await expect(page.getByRole('heading', { name: NOT_A_MEMBER_MESSAGE })).toBeVisible();
  await expect(sheet(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveCount(0);
});

test('320px: Sheet không cuộn ngang; tên dài bị cắt, nút "Check-in" nằm trọn trong màn và bấm được', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const longName = 'Nguyễn Thị Phương Thảo Hoàng Lê Minh Châu Anh Trần Bảo Ngọc';
  await openScanScreen(page, {
    lookup: () =>
      lookupResult([
        ticket(1, { holderName: longName, ticketTypeName: 'Vé đôi nam nữ hạng VIP khu khán đài A' }),
        ticket(2, { holderName: longName, checkedIn: true }),
      ]),
  });
  await openLookup(page);
  await input(page).fill('0912345678');
  await expect(rows(page)).toHaveCount(2);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  const content = sheet(page);
  expect(await content.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  const name = rows(page).first().locator('[data-slot="manual-lookup-name"]');
  expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const button = checkInButton(rows(page).first());
  const box = (await button.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(Math.round(box.height)).toBe(44);
  const hit = await button.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top !== null && (top === el || el.contains(top));
  });
  expect(hit).toBe(true);
  const rowBox = (await rows(page).first().boundingBox())!;
  expect(rowBox.x + rowBox.width).toBeLessThanOrEqual(320);
});
