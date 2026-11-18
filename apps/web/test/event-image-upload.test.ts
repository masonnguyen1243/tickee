import { EVENT_IMAGE_MAX_BYTES } from '@tickee/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import {
  EventImagePutError,
  eventImageFileError,
  IMAGE_SIZE_ERROR,
  IMAGE_TYPE_ERROR,
  isUploadUrlReusable,
  putEventImage,
  uploadEventImage,
} from '@/lib/event/image-upload';

const ORG_ID = '019a3b2c-5678-7abc-8def-0123456789ab';
const KEY = `orgs/${ORG_ID}/events/019a3b2c-0a00-7abc-8def-000000000001.png`;
const NOW = Date.parse('2026-11-18T03:00:00.000Z');
const UPLOAD_URL = `http://storage.test/tickee-event-images/${KEY}?X-Amz-Signature=abc`;

const presign = (expiresAt = new Date(NOW + 5 * 60_000).toISOString(), key = KEY, uploadUrl = UPLOAD_URL) => ({
  key,
  uploadUrl,
  expiresAt,
});

const png = (bytes = 200 * 1024) => new File([new Uint8Array(bytes)], 'anh-bia.png', { type: 'image/png' });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** `fetch` giả treo tới khi signal bị hủy (hủy chủ động hoặc hết giờ), rồi reject bằng lý do của signal như trình duyệt. */
const hangUntilAborted: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Mong đợi lỗi');
    },
    (e: unknown) => e,
  );
}

describe('eventImageFileError', () => {
  it.each([
    ['image/jpeg', 1],
    ['image/png', 200 * 1024],
    ['image/webp', EVENT_IMAGE_MAX_BYTES],
  ])('%s, %d byte → hợp lệ', (type, size) => {
    expect(eventImageFileError({ type, size })).toBeNull();
  });

  it.each([['image/gif'], ['image/svg+xml'], ['application/pdf'], ['']])('loại %j → lỗi loại', (type) => {
    expect(eventImageFileError({ type, size: 1024 })).toBe(IMAGE_TYPE_ERROR);
  });

  it('quá 5 MB (kể cả 6 MB) → lỗi dung lượng', () => {
    expect(eventImageFileError({ type: 'image/png', size: EVENT_IMAGE_MAX_BYTES + 1 })).toBe(IMAGE_SIZE_ERROR);
    expect(eventImageFileError({ type: 'image/webp', size: 6 * 1024 * 1024 })).toBe(IMAGE_SIZE_ERROR);
  });

  it('sai loại và quá dung lượng → báo loại trước', () => {
    expect(eventImageFileError({ type: 'image/gif', size: 6 * 1024 * 1024 })).toBe(IMAGE_TYPE_ERROR);
  });

  it('file rỗng → lỗi loại (không phải ảnh)', () => {
    expect(eventImageFileError({ type: 'image/png', size: 0 })).toBe(IMAGE_TYPE_ERROR);
  });
});

describe('isUploadUrlReusable', () => {
  it('còn hơn 30 giây → dùng lại; còn ≤ 30 giây hoặc đã hết hạn → không', () => {
    expect(isUploadUrlReusable(presign(new Date(NOW + 31_000).toISOString()), NOW)).toBe(true);
    expect(isUploadUrlReusable(presign(new Date(NOW + 30_000).toISOString()), NOW)).toBe(false);
    expect(isUploadUrlReusable(presign(new Date(NOW - 1_000).toISOString()), NOW)).toBe(false);
  });
});

describe('uploadEventImage', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('presign theo BTC với loại và số byte của file, rồi PUT thẳng uploadUrl: đúng content-type, không credentials', async () => {
    const file = png();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, presign())).mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(uploadEventImage(ORG_ID, file, { now: NOW })).resolves.toEqual(presign());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [presignUrl, presignInit] = fetchMock.mock.calls[0]!;
    expect(presignUrl).toBe(`http://api.test/v1/orgs/${ORG_ID}/event-images`);
    expect(presignInit?.method).toBe('POST');
    expect(presignInit?.credentials).toBe('include');
    expect(JSON.parse(presignInit?.body as string)).toEqual({ contentType: 'image/png', contentLength: 200 * 1024 });

    const [putUrl, putInit] = fetchMock.mock.calls[1]!;
    // URL tuyệt đối của storage, không qua api và không thêm `/v1`.
    expect(putUrl).toBe(UPLOAD_URL);
    expect(putInit?.method).toBe('PUT');
    expect(putInit?.body).toBe(file);
    expect(putInit?.credentials).toBe('omit');
    expect(new Headers(putInit?.headers).get('content-type')).toBe('image/png');
  });

  it('presign lỗi → ApiError, không PUT', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'Bận', details: null } }),
    );

    const error = await rejectionOf(uploadEventImage(ORG_ID, png(), { now: NOW }));
    expect(error).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('presign trả dữ liệu sai schema (key lạ) → ApiError, không PUT', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, presign(undefined, 'orgs/khac/anh.png')));

    expect(await rejectionOf(uploadEventImage(ORG_ID, png(), { now: NOW }))).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('storage 5xx → EventImagePutError giữ presign để PUT lại', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, presign())).mockResolvedValueOnce(new Response('', { status: 503 }));

    const error = await rejectionOf(uploadEventImage(ORG_ID, png(), { now: NOW }));
    expect(error).toBeInstanceOf(EventImagePutError);
    expect(error).toMatchObject({ status: 503, upload: presign() });
  });

  it('mất mạng khi PUT → EventImagePutError (status null) giữ presign', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, presign())).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await rejectionOf(uploadEventImage(ORG_ID, png(), { now: NOW }));
    expect(error).toBeInstanceOf(EventImagePutError);
    expect(error).toMatchObject({ status: null, upload: presign() });
  });

  it('storage 403 (chữ ký hết hạn hoặc sai) → EventImagePutError không giữ presign', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, presign())).mockResolvedValueOnce(new Response('', { status: 403 }));

    const error = await rejectionOf(uploadEventImage(ORG_ID, png(), { now: NOW }));
    expect(error).toMatchObject({ status: 403, upload: null });
  });

  it('"Thử lại" với presign còn hạn: PUT lại cùng URL, không presign mới', async () => {
    const file = png();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(uploadEventImage(ORG_ID, file, { previous: presign(), now: NOW + 60_000 })).resolves.toEqual(presign());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(UPLOAD_URL);
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(file);
  });

  it('"Thử lại" khi presign đã hết hạn: xin presign mới rồi PUT URL mới', async () => {
    const fresh = presign(new Date(NOW + 10 * 60_000).toISOString(), KEY.replace('001.png', '002.png'), `${UPLOAD_URL}2`);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, fresh)).mockResolvedValueOnce(new Response(null, { status: 200 }));

    const stale = presign(new Date(NOW + 10_000).toISOString());
    await expect(uploadEventImage(ORG_ID, png(), { previous: stale, now: NOW })).resolves.toEqual(fresh);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `http://api.test/v1/orgs/${ORG_ID}/event-images`,
      `${UPLOAD_URL}2`,
    ]);
  });

  it('PUT treo quá hạn giờ → EventImagePutError (status null) giữ presign, thử lại được như mất mạng', async () => {
    fetchMock.mockImplementationOnce(hangUntilAborted);

    const error = await rejectionOf(putEventImage(presign(), png(), new AbortController().signal, 20));
    expect(error).toBeInstanceOf(EventImagePutError);
    expect(error).toMatchObject({ status: null, upload: presign() });
  });

  it('presign treo quá hạn giờ → ApiError SERVICE_UNAVAILABLE (như mất mạng), không PUT', async () => {
    fetchMock.mockImplementationOnce(hangUntilAborted);

    const error = await rejectionOf(
      uploadEventImage(ORG_ID, png(), { now: NOW, signal: new AbortController().signal, timeouts: { presignMs: 20 } }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['presign', null],
    ['PUT', presign()],
  ] as const)('hủy chủ động khi %s đang treo → ném lại lỗi hủy, không thành lỗi thử lại được', async (_step, previous) => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(hangUntilAborted);

    const pending = rejectionOf(uploadEventImage(ORG_ID, png(), { previous, now: NOW, signal: controller.signal }));
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(EventImagePutError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as Error).name).toBe('AbortError');
  });

  it('hủy giữa chừng (chọn ảnh khác) → ném lại lỗi hủy, không thành EventImagePutError', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortError);

    await expect(putEventImage(presign(), png(), controller.signal)).rejects.toBe(abortError);
  });
});
