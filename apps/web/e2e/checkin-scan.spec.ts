import type { Locator, Page } from '@playwright/test';

import { fakeCamera, recordScanSound, type CameraMode, type CameraSize } from './checkin-camera';
import { checkerRevoked, CHECKER_REVOKED_MESSAGE, checkinEvent, mockCheckinApi, scanResult, type CheckinHandler } from './checkin-mock';
import { expect, test } from './fixtures';
import { apiError, me, mockIdentityApi, unauthenticated, type Call } from './identity-mock';
import { setVisibility } from './live-mock';
import { mockOrganizerApi, organization, ORG_ID } from './organizer-mock';
import { recordWakeLock } from './wake-lock-mock';

/*
 * Màn quét `/events/:eventId` (Story 5.3) với API giả và camera giả (`canvas.captureStream()` vẽ Mã QR do `qrcode` sinh,
 * giải mã thật bằng jsQR): "Bật camera" ở mọi lần vào, bị từ chối / không có camera, quét xanh (số đã check-in tải lại),
 * quét lặp, đỏ (đã check-in, Vé không hợp lệ) có âm thanh, mất quyền giữa chừng, lỗi mạng/5xx, rời màn (tab ẩn, rời
 * trang), hai mã liên tiếp, 320px. Tải Sự kiện (401, 403, lỗi) ở `checker-invite-accept.spec.ts`.
 */

const CONSENTED = '2026-10-29T01:02:03.000Z';
const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const EVENT_NAME = 'Giải Pickleball Mở rộng CLB Sóng Xanh 2026';
const SCAN_PATH = `/events/${EVENT_ID}`;
const SCAN_API = `/checkin/events/${EVENT_ID}/scans`;
const EVENT_API = `/checkin/events/${EVENT_ID}`;
const SEND_FAILED = 'Chưa gửi được kết quả quét. Quét lại mã.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ticketId = (n: number) => `019a3b2c-0b00-7abc-8def-${String(n).padStart(12, '0')}`;
/** Mã QR vé dạng thật `t<k>.<ticketId>.<sig>` (chữ ký giả 43 ký tự base64url). */
const ticketCode = (n: number) => `t1.${ticketId(n)}.${String(n).padStart(43, 'Q')}`;

const OK = { outcome: 'ok', holderName: 'Nguyễn Văn Minh', seq: 2, count: 2, ticketTypeName: 'Đôi nam' };

type ScanBody = { code: string; scanId: string };

const scans = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === SCAN_API).map((c) => c.body as ScanBody);
const eventLoads = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === EVENT_API).length;

const enableButton = (page: Page) => page.getByRole('button', { name: 'Bật camera' });
const overlay = (page: Page) => page.locator('[data-slot="scan-result-overlay"]');
const viewport = (page: Page) => page.locator('[data-slot="scanner-viewport"]');
const manualLookup = (page: Page) => page.getByRole('button', { name: 'Tra tay' });

type Setup = {
  camera?: CameraMode;
  cameraSize?: CameraSize;
  scan?: CheckinHandler;
  event?: CheckinHandler;
};

/** Đã đăng nhập; camera giả, âm thanh và Wake Lock ghi lại; API CTV giả. */
async function openScanScreen(page: Page, { camera: mode = 'grant', cameraSize, scan, event }: Setup = {}) {
  const camera = await fakeCamera(page, mode, cameraSize);
  const sound = await recordScanSound(page);
  const wakeLock = await recordWakeLock(page);
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const calls = await mockCheckinApi(page, {
    [`GET ${EVENT_API}`]: event ?? (() => checkinEvent(EVENT_ID, EVENT_NAME, { checkedInCount: 3, validTicketCount: 10 })),
    ...(scan ? { [`POST ${SCAN_API}`]: scan } : {}),
  });
  await page.goto(SCAN_PATH);
  return { camera, sound, wakeLock, calls };
}

/** Bấm "Bật camera" và chờ camera chạy (track sống, khung camera hiện). */
async function startCamera(page: Page, camera: Awaited<ReturnType<typeof fakeCamera>>) {
  await enableButton(page).click();
  await expect(viewport(page)).toBeVisible();
  await expect.poll(async () => (await camera.state()).live).toBe(1);
}

type ScanTimeline = { sends: number[]; closes: number[] };

/**
 * Ghi giờ (đồng hồ của trang) mỗi lần gửi `POST …/scans` (bọc `fetch`) và mỗi lần overlay kết quả rời DOM
 * (`MutationObserver`), để đo khoảng cách giữa lúc overlay đóng và lần gửi kế tiếp.
 */
async function recordScanTimeline(page: Page): Promise<() => Promise<ScanTimeline>> {
  await page.addInitScript(() => {
    const timeline: ScanTimeline = { sends: [], closes: [] };
    (window as unknown as { __scanTimeline: ScanTimeline }).__scanTimeline = timeline;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (method === 'POST' && url.pathname.endsWith('/scans')) timeline.sends.push(Date.now());
      return nativeFetch(input, init);
    };
    const isOverlay = (node: Node) =>
      node instanceof Element &&
      (node.matches('[data-slot="scan-result-overlay"]') || node.querySelector('[data-slot="scan-result-overlay"]') !== null);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) if (isOverlay(node)) timeline.closes.push(Date.now());
      }
    }).observe(document, { childList: true, subtree: true });
  });
  return () => page.evaluate(() => (window as unknown as { __scanTimeline: ScanTimeline }).__scanTimeline);
}

/**
 * Nút nằm trọn trong màn hình (sai số làm tròn < 1px) và không bị phần tử khác che: điểm giữa trúng chính nút. Nút bị
 * tắt có `pointer-events: none` (hit-test bỏ qua) nên bật tạm `pointer-events` trong lúc kiểm.
 */
async function expectReachable(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const size = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThan(size.height + 1);
  expect(box.x + box.width).toBeLessThan(size.width + 1);
  const hit = await locator.evaluate((el: HTMLElement) => {
    const previous = el.style.pointerEvents;
    el.style.pointerEvents = 'auto';
    try {
      const rect = el.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top !== null && (top === el || el.contains(top));
    } finally {
      el.style.pointerEvents = previous;
    }
  });
  expect(hit).toBe(true);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('vào màn: "Bật camera" có tên Sự kiện, chưa xin camera; không SiteHeader; viewport-fit=cover chỉ ở Màn quét', async ({
  page,
}) => {
  const { camera, wakeLock } = await openScanScreen(page);
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  await expect(enableButton(page)).toBeVisible();
  // "Tra tay" luôn hiện, bị tắt kèm lý do (Story 5.5 nối).
  await expect(manualLookup(page)).toBeDisabled();
  await expect(page.getByText('Tra tay sắp có')).toBeVisible();
  await expect(viewport(page)).toHaveCount(0);
  expect((await camera.state()).calls).toEqual([]);
  expect((await wakeLock()).requests).toBe(0);
  await expect(page.getByRole('link', { name: 'Tickee — Trang chủ' })).toHaveCount(0);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);

  // Trang khác giữ viewport gốc (không `cover`).
  await page.goto('/xem-ve');
  await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute('content', /viewport-fit/);
});

test('quét xanh: body POST có đúng code + scanId uuid; overlay xanh, bíp nhẹ, tự đóng rồi tải lại số đã check-in; giữ màn hình sáng', async ({
  page,
}) => {
  let checkedIn = 3;
  const { camera, sound, wakeLock, calls } = await openScanScreen(page, {
    event: () => checkinEvent(EVENT_ID, EVENT_NAME, { checkedInCount: checkedIn, validTicketCount: 10 }),
    scan: () => {
      checkedIn = 4;
      return scanResult(OK);
    },
  });
  await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
  await startCamera(page, camera);
  expect((await camera.state()).calls).toEqual([{ video: { facingMode: { ideal: 'environment' } }, audio: false }]);
  await expect(page.locator('[data-slot="scanner-count"]')).toHaveText('Đã check-in 3/10');
  await expect(manualLookup(page)).toBeDisabled();
  await expect(page.getByText('Tra tay sắp có')).toBeVisible();
  await expect.poll(async () => (await wakeLock()).requests).toBe(1);
  // Chạm "Bật camera" đã mở khóa âm thanh.
  expect((await sound()).unlocks).toBe(1);

  const loadsBefore = eventLoads(calls);
  await camera.show(ticketCode(1));
  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  await expect(overlay(page)).toHaveAttribute('aria-live', 'assertive');
  await expect(overlay(page).locator('[data-slot="scan-result-title"]')).toHaveText('Thành công');
  await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveText('Nguyễn Văn Minh · Vé 2/2 · Đôi nam');
  await expect(overlay(page).getByRole('button', { name: 'Chạm để quét tiếp' })).toHaveCount(0);
  expect((await sound()).tones).toEqual(['sine']);

  const sent = scans(calls);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.code).toBe(ticketCode(1));
  expect(sent[0]!.scanId).toMatch(UUID);
  expect(Object.keys(sent[0]!).sort()).toEqual(['code', 'scanId']);

  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  await expect.poll(() => eventLoads(calls)).toBeGreaterThan(loadsBefore);
  await expect(page.locator('[data-slot="scanner-count"]')).toHaveText('Đã check-in 4/10');
  // Mã QR vé không bao giờ vào URL nào.
  expect(page.url()).not.toContain(ticketCode(1));
});

const FRAME_SIZES: [string, CameraSize][] = [
  ['ngang 1280×720', { width: 1280, height: 720 }],
  ['dọc 720×1280', { width: 720, height: 1280 }],
];
for (const [label, size] of FRAME_SIZES) {
  test(`quét xanh với khung hình ${label}: cắt vùng vuông giữa, thu về 480px, gửi đúng code`, async ({ page }) => {
    const { camera, calls } = await openScanScreen(page, { cameraSize: size, scan: () => scanResult(OK) });
    await startCamera(page, camera);
    await expect
      .poll(() => page.locator('[data-slot="scanner-camera"] video').evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight]))
      .toEqual([size.width, size.height]);
    await camera.show(ticketCode(7));
    await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
    expect(scans(calls).map((b) => b.code)).toEqual([ticketCode(7)]);
  });
}

test('quét lặp: cùng mã ngay sau khi overlay đóng không gửi lại; quá 2 giây thì gửi với scanId mới → trung tính, im lặng', async ({
  page,
}) => {
  let n = 0;
  const timeline = await recordScanTimeline(page);
  const { camera, sound, calls } = await openScanScreen(page, {
    scan: () => (n++ === 0 ? scanResult(OK) : scanResult({ outcome: 'recent' })),
  });
  await startCamera(page, camera);
  await camera.show(ticketCode(1));
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');

  // Mã vẫn trong khung suốt: lần gửi kế tiếp đến sau khi overlay xanh đóng, không sớm hơn 2 giây.
  await expect(overlay(page)).toHaveAttribute('data-tone', 'neutral', { timeout: 8000 });
  const { sends, closes } = await timeline();
  expect(sends).toHaveLength(2);
  const closedAt = closes[0]!;
  expect(sends[0]!).toBeLessThan(closedAt);
  expect(sends.filter((t) => t >= closedAt && t - closedAt < 2000)).toEqual([]);
  expect(sends[1]! - closedAt).toBeGreaterThanOrEqual(2000);
  await expect(overlay(page).locator('[data-slot="scan-result-title"]')).toHaveText('Bạn vừa check-in Vé này');
  await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveCount(0);
  const sent = scans(calls);
  expect(sent).toHaveLength(2);
  expect(sent[1]!.code).toBe(ticketCode(1));
  expect(sent[1]!.scanId).toMatch(UUID);
  expect(sent[1]!.scanId).not.toBe(sent[0]!.scanId);
  // Trung tính không kêu; chỉ có tiếng bíp của lần xanh.
  expect((await sound()).tones).toEqual(['sine']);
  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
});

test('đỏ: "Đã check-in lúc HH:MM · bởi {người}" và "Vé không hợp lệ" có âm thanh cảnh báo, giữ tới khi chạm', async ({
  page,
}) => {
  const { camera, sound, calls } = await openScanScreen(page, {
    scan: (request) => {
      const { code } = request.postDataJSON() as ScanBody;
      return code === ticketCode(1)
        ? scanResult({ outcome: 'already', checkedInAt: '2026-11-25T00:42:00.000Z', checkedBy: { kind: 'name', name: 'Trần Hùng' } })
        : scanResult({ outcome: 'invalid', reason: 'OTHER_EVENT' });
    },
  });
  await startCamera(page, camera);
  await camera.show(ticketCode(1));
  await expect(overlay(page)).toHaveAttribute('data-tone', 'danger');
  await expect(overlay(page).locator('[data-slot="scan-result-title"]')).toHaveText('Đã check-in');
  // Giờ Việt Nam (00:42Z = 07:42).
  await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveText('lúc 07:42 · bởi Trần Hùng');
  await expect.poll(async () => (await sound()).tones).toEqual(['square', 'square']);
  // Không tự đóng.
  await page.waitForTimeout(2000);
  await expect(overlay(page)).toBeVisible();
  expect(scans(calls)).toHaveLength(1);
  // Chạm bất kỳ đâu để đóng; lần chạm đó mở khóa âm thanh lại.
  const unlocksBefore = (await sound()).unlocks;
  await overlay(page).click({ position: { x: 24, y: 120 } });
  await expect(overlay(page)).toHaveCount(0);
  expect((await sound()).unlocks).toBe(unlocksBefore + 1);

  await camera.show(ticketCode(2));
  await expect(overlay(page)).toHaveAttribute('data-tone', 'danger');
  await expect(overlay(page).locator('[data-slot="scan-result-title"]')).toHaveText('Vé không hợp lệ');
  await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveText('Vé của Sự kiện khác');
  await expect.poll(async () => (await sound()).tones).toEqual(['square', 'square', 'square', 'square']);
  const next = overlay(page).getByRole('button', { name: 'Chạm để quét tiếp' });
  await expect(next).toBeFocused();
  const unlocksBeforeNext = (await sound()).unlocks;
  await next.click();
  await expect(overlay(page)).toHaveCount(0);
  expect((await sound()).unlocks).toBe(unlocksBeforeNext + 1);
  expect(scans(calls).map((b) => b.code)).toEqual([ticketCode(1), ticketCode(2)]);
});

test('hai mã khác nhau liên tiếp: không có request thứ hai khi request đầu chưa xong; mỗi request một scanId riêng', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let n = 0;
  const { camera, calls } = await openScanScreen(page, {
    scan: async () => {
      if (n++ === 0) await held;
      return scanResult(OK);
    },
  });
  await startCamera(page, camera);
  await camera.show(ticketCode(1));
  await expect.poll(() => scans(calls).length).toBe(1);

  // Request đầu còn treo: đổi sang mã khác, vẫn không gửi gì thêm.
  await camera.show(ticketCode(2));
  await page.waitForTimeout(1000);
  expect(scans(calls)).toHaveLength(1);
  await expect(overlay(page)).toHaveCount(0);

  release();
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  // Overlay còn mở: vẫn khóa.
  expect(scans(calls)).toHaveLength(1);
  await expect(overlay(page)).toHaveCount(0, { timeout: 4000 });
  await expect.poll(() => scans(calls).length).toBe(2);

  const [first, second] = scans(calls);
  expect(first!.code).toBe(ticketCode(1));
  expect(second!.code).toBe(ticketCode(2));
  expect(first!.scanId).toMatch(UUID);
  expect(second!.scanId).toMatch(UUID);
  expect(second!.scanId).not.toBe(first!.scanId);
});

test('lỗi mạng hay 5xx khi gửi: không đỏ, dải cảnh báo "Chưa gửi được kết quả quét. Quét lại mã."; quét tiếp được', async ({
  page,
}) => {
  let mode: 'error' | 'abort' | 'ok' = 'error';
  const { camera, sound, calls } = await openScanScreen(page, {
    scan: () => (mode === 'error' ? apiError(503, 'SERVICE_UNAVAILABLE') : mode === 'abort' ? 'abort' : scanResult(OK)),
  });
  await startCamera(page, camera);
  await camera.show(ticketCode(1));
  const banner = viewport(page).locator('[data-slot="status-banner"]');
  await expect(banner).toHaveText(SEND_FAILED);
  await expect(banner).toHaveAttribute('data-tone', 'warning');
  await expect(overlay(page)).toHaveCount(0);
  expect((await sound()).tones).toEqual([]);

  // Mất mạng hẳn (không phản hồi): cũng vậy. Mỗi lần gửi lại là một scanId mới.
  mode = 'abort';
  const before = scans(calls).length;
  await expect.poll(() => scans(calls).length, { timeout: 5000 }).toBeGreaterThan(before);
  await page.waitForTimeout(300);
  await expect(banner).toHaveText(SEND_FAILED);
  await expect(overlay(page)).toHaveCount(0);

  mode = 'ok';
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success', { timeout: 5000 });
  await expect(banner).toHaveCount(0);
  const ids = scans(calls).map((b) => b.scanId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(scans(calls).every((b) => b.code === ticketCode(1))).toBe(true);
});

test('mất quyền giữa chừng: POST scans → 403 CHECKER_REVOKED → màn hết quyền với câu của api, camera tắt, nhả Wake Lock', async ({
  page,
}) => {
  const { camera, wakeLock } = await openScanScreen(page, { scan: checkerRevoked });
  await startCamera(page, camera);
  await expect.poll(async () => (await wakeLock()).requests).toBe(1);
  await camera.show(ticketCode(1));
  await expect(page.getByRole('heading', { name: CHECKER_REVOKED_MESSAGE })).toBeVisible();
  await expect(page.getByText(EVENT_NAME)).toHaveCount(0);
  await expect(viewport(page)).toHaveCount(0);
  await expect(overlay(page)).toHaveCount(0);
  await expect.poll(async () => (await camera.state()).live).toBe(0);
  await expect.poll(async () => (await wakeLock()).released).toBe(1);
  // Không tự bật lại camera.
  await page.waitForTimeout(500);
  expect((await camera.state()).calls).toHaveLength(1);
});

test('Sự kiện tải lại trả 403 khi đang quét (sau lần xanh): màn hết quyền, camera tắt, nhả Wake Lock', async ({ page }) => {
  let revoked = false;
  const { camera, wakeLock, calls } = await openScanScreen(page, {
    event: () => (revoked ? checkerRevoked() : checkinEvent(EVENT_ID, EVENT_NAME, { checkedInCount: 3, validTicketCount: 10 })),
    scan: () => {
      revoked = true;
      return scanResult(OK);
    },
  });
  await startCamera(page, camera);
  await expect.poll(async () => (await wakeLock()).requests).toBe(1);
  const loadsBefore = eventLoads(calls);
  await camera.show(ticketCode(1));
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  // Overlay xanh đóng → tải lại `CheckinEvent` → 403.
  await expect.poll(() => eventLoads(calls), { timeout: 5000 }).toBeGreaterThan(loadsBefore);
  await expect(page.getByRole('heading', { name: CHECKER_REVOKED_MESSAGE })).toBeVisible();
  await expect(page.getByText(EVENT_NAME)).toHaveCount(0);
  await expect.poll(async () => (await camera.state()).live).toBe(0);
  await expect.poll(async () => (await wakeLock()).released).toBe(1);
  expect(scans(calls)).toHaveLength(1);
});

test('401 khi gửi quét: sang đăng nhập với returnTo là Màn quét, camera tắt', async ({ page }) => {
  const { camera } = await openScanScreen(page, { scan: unauthenticated });
  await startCamera(page, camera);
  await camera.show(ticketCode(1));
  await page.waitForURL((url) => url.pathname === '/dang-nhap');
  expect(new URL(page.url()).search).toBe(`?returnTo=${encodeURIComponent(SCAN_PATH)}`);
  await expect.poll(async () => (await camera.state()).live).toBe(0);
});

test('tab ẩn: dừng mọi track camera, nhả Wake Lock; hiện lại: bật lại camera và quét tiếp', async ({ page }) => {
  const { camera, wakeLock, calls } = await openScanScreen(page, { scan: () => scanResult(OK) });
  await startCamera(page, camera);
  await expect.poll(async () => (await wakeLock()).requests).toBe(1);

  await setVisibility(page, 'hidden');
  await expect.poll(async () => (await camera.state()).live).toBe(0);
  await expect.poll(async () => (await wakeLock()).released).toBe(1);

  await setVisibility(page, 'visible');
  await expect.poll(async () => (await camera.state()).calls.length).toBe(2);
  await expect.poll(async () => (await camera.state()).live).toBe(1);
  // Xin lại: đang giữ đúng một khóa (số lần xin có thể hơn 2 nếu khóa cũ kịp xin lại trước khi React gỡ nó).
  await expect
    .poll(async () => {
      const { requests, released } = await wakeLock();
      return requests >= 2 && requests - released === 1;
    })
    .toBe(true);
  await camera.show(ticketCode(1));
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  expect(scans(calls)).toHaveLength(1);
});

test('pagehide: dừng track camera; pageshow từ bfcache: bật lại camera', async ({ page }) => {
  const { camera } = await openScanScreen(page);
  await startCamera(page, camera);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect.poll(async () => (await camera.state()).live).toBe(0);

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(async () => (await camera.state()).calls.length).toBe(2);
  await expect.poll(async () => (await camera.state()).live).toBe(1);
  await expect(viewport(page)).toBeVisible();

  // `pagehide` rồi `pageshow` trong cùng một lượt JS (React chưa kịp áp `visible=false`): vẫn xin camera lại.
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(async () => (await camera.state()).calls.length).toBe(3);
  await expect.poll(async () => (await camera.state()).live).toBe(1);
});

test('track camera tự kết thúc (ứng dụng khác chiếm camera) khi tab vẫn hiện: xin camera lại', async ({ page }) => {
  const { camera, calls } = await openScanScreen(page, { scan: () => scanResult(OK) });
  await startCamera(page, camera);

  await page
    .locator('[data-slot="scanner-camera"] video')
    .evaluate((video: HTMLVideoElement) => (video.srcObject as MediaStream).getVideoTracks()[0]!.dispatchEvent(new Event('ended')));
  await expect.poll(async () => (await camera.state()).calls.length).toBe(2);
  await expect.poll(async () => (await camera.state()).live).toBe(1);
  // Stream mới vẫn quét được.
  await camera.show(ticketCode(1));
  await expect(overlay(page)).toHaveAttribute('data-tone', 'success');
  expect(scans(calls)).toHaveLength(1);
});

test('rời trang (Back về tab "Quét vé"): dừng track camera, nhả Wake Lock', async ({ page }) => {
  const camera = await fakeCamera(page);
  const wakeLock = await recordWakeLock(page);
  await mockIdentityApi(page, { 'GET /identity/me': () => me(CONSENTED) });
  const future = '2099-11-16T23:59:59+07:00';
  const summary = (id: string, name: string, startsAt: string) => ({
    id,
    slug: `su-kien-${id.slice(-4)}`,
    name,
    status: 'published',
    startsAt,
    endsAt: startsAt,
    effectiveEndAt: future,
    imageUrl: null,
  });
  await mockOrganizerApi(page, {
    [`GET /orgs/${ORG_ID}`]: () => organization({ role: 'owner' }),
    [`GET /orgs/${ORG_ID}/events`]: () => ({
      status: 200,
      body: [
        summary(EVENT_ID, EVENT_NAME, '2099-11-16T07:00:00+07:00'),
        summary('019a3b2c-0712-7abc-8def-0000000000ff', 'Giải phụ', '2099-11-20T07:00:00+07:00'),
      ],
    }),
  });
  await mockCheckinApi(page, { [`GET ${EVENT_API}`]: () => checkinEvent(EVENT_ID, EVENT_NAME) });

  await page.goto(`/btc/${ORG_ID}/quet-ve`);
  await page.getByRole('link', { name: new RegExp(EVENT_NAME) }).click();
  await page.waitForURL((url) => url.pathname === SCAN_PATH);
  await startCamera(page, camera);
  await expect.poll(async () => (await wakeLock()).requests).toBe(1);

  await page.goBack();
  await page.waitForURL((url) => url.pathname === `/btc/${ORG_ID}/quet-ve`);
  await expect(page.getByRole('heading', { name: 'Chọn Sự kiện để quét' })).toBeVisible();
  await expect.poll(async () => (await camera.state()).live).toBe(0);
  await expect.poll(async () => (await wakeLock()).released).toBe(1);
});

test.describe('camera không dùng được', () => {
  test('bị từ chối (NotAllowedError): hướng dẫn Safari iOS / Chrome Android, "Thử lại" xin lại, "Tra tay" tắt kèm lý do', async ({
    page,
  }) => {
    const { camera, wakeLock } = await openScanScreen(page, { camera: 'deny' });
    await enableButton(page).click();
    await expect(page.getByRole('heading', { name: 'Chưa được dùng camera' })).toBeVisible();
    const help = page.locator('[data-slot="camera-help"]');
    await expect(help.getByRole('heading', { name: 'Safari trên iPhone' })).toBeVisible();
    await expect(help.getByRole('heading', { name: 'Chrome trên Android' })).toBeVisible();
    await expect(page.getByRole('heading', { name: EVENT_NAME })).toBeVisible();
    await expect(manualLookup(page)).toBeDisabled();
    await expect(page.getByText('Tra tay sắp có')).toBeVisible();
    expect((await camera.state()).calls).toHaveLength(1);

    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect.poll(async () => (await camera.state()).calls.length).toBe(2);
    await expect(page.getByRole('heading', { name: 'Chưa được dùng camera' })).toBeVisible();
    expect((await wakeLock()).requests).toBe(0);
  });

  test('không mở được camera (NotFoundError, hay camera bận): "Không mở được camera", "Thử lại" xin lại, "Tra tay" tắt kèm lý do', async ({
    page,
  }) => {
    const { camera } = await openScanScreen(page, { camera: 'not-found' });
    await enableButton(page).click();
    await expect(page.getByRole('heading', { name: 'Không mở được camera' })).toBeVisible();
    await expect(page.getByText(/đang được ứng dụng khác dùng/)).toBeVisible();
    await expect(manualLookup(page)).toBeDisabled();
    await expect(page.getByText('Tra tay sắp có')).toBeVisible();
    expect((await camera.state()).calls).toHaveLength(1);

    await page.getByRole('button', { name: 'Thử lại' }).click();
    await expect.poll(async () => (await camera.state()).calls.length).toBe(2);
    await expect(page.getByRole('heading', { name: 'Không mở được camera' })).toBeVisible();
  });

  test('không có `navigator.mediaDevices`: "Không mở được camera" + "Thử lại" + "Tra tay" tắt kèm lý do', async ({ page }) => {
    await openScanScreen(page, { camera: 'missing' });
    await enableButton(page).click();
    await expect(page.getByRole('heading', { name: 'Không mở được camera' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    await expect(manualLookup(page)).toBeDisabled();
    await expect(page.getByText('Tra tay sắp có')).toBeVisible();
  });
});

test.describe('320px: không cuộn ngang, nút đáy không bị che', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
  });

  test('Bật camera → đang quét → đỏ → hết quyền', async ({ page }) => {
    let revoked = false;
    const { camera } = await openScanScreen(page, {
      scan: () => (revoked ? checkerRevoked() : scanResult({ outcome: 'invalid', reason: 'BAD_SIGNATURE' })),
    });
    await expect(enableButton(page)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectReachable(page, enableButton(page));
    await expectReachable(page, manualLookup(page));

    await startCamera(page, camera);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectReachable(page, manualLookup(page));

    await camera.show(ticketCode(1));
    const next = overlay(page).getByRole('button', { name: 'Chạm để quét tiếp' });
    await expect(next).toBeVisible();
    await expect(overlay(page).locator('[data-slot="scan-result-detail"]')).toHaveText('Mã QR vé không đúng');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectReachable(page, next);
    await next.click();
    await expect(overlay(page)).toHaveCount(0);

    revoked = true;
    await camera.show(ticketCode(2));
    await expect(page.getByRole('heading', { name: CHECKER_REVOKED_MESSAGE })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('bị từ chối và không có camera', async ({ page }) => {
    await openScanScreen(page, { camera: 'deny' });
    await enableButton(page).click();
    await expect(page.getByRole('button', { name: 'Thử lại' })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    // Màn hướng dẫn dài hơn 568px: cuộn xuống thì nút đáy hiện trọn, không bị che.
    await manualLookup(page).scrollIntoViewIfNeeded();
    await expectReachable(page, manualLookup(page));
    await page.getByRole('button', { name: 'Thử lại' }).scrollIntoViewIfNeeded();
    await expectReachable(page, page.getByRole('button', { name: 'Thử lại' }));
  });

  test('không có camera', async ({ page }) => {
    await openScanScreen(page, { camera: 'missing' });
    await enableButton(page).click();
    await expect(page.getByRole('heading', { name: 'Không mở được camera' })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await manualLookup(page).scrollIntoViewIfNeeded();
    await expectReachable(page, manualLookup(page));
    await page.getByRole('button', { name: 'Thử lại' }).scrollIntoViewIfNeeded();
    await expectReachable(page, page.getByRole('button', { name: 'Thử lại' }));
  });
});
