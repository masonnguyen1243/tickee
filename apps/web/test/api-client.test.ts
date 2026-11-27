import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { apiDownload, apiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

const Health = z.object({ status: z.literal('ok') });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function catchApiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe('apiRequest', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test/');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('gọi /v1 kèm cookie và trả dữ liệu đã kiểm bằng schema', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }));

    await expect(apiRequest('/healthz', { schema: Health })).resolves.toEqual({ status: 'ok' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/healthz');
    expect(init?.credentials).toBe('include');
  });

  it("lời gọi công khai đặt credentials: 'omit' → không kèm cookie", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }));

    await apiRequest('/healthz', { schema: Health, init: { credentials: 'omit' } });
    expect(fetchMock.mock.calls[0]![1]?.credentials).toBe('omit');
  });

  it.each([
    [404, 'NOT_FOUND'],
    [400, 'VALIDATION_FAILED'],
    [503, 'SERVICE_UNAVAILABLE'],
  ] as const)('lỗi chuẩn %d → ApiError giữ code, message, details', async (status, code) => {
    fetchMock.mockResolvedValue(
      jsonResponse(status, { error: { code, message: 'Thông báo lỗi', details: { field: 'email' } } }),
    );

    const error = await catchApiError(apiRequest('/x', { schema: Health }));
    expect(error).toMatchObject({ code, message: 'Thông báo lỗi', details: { field: 'email' }, status });
  });

  it('body lỗi không đúng dạng chuẩn → INTERNAL_ERROR', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { message: 'oops' }));

    const error = await catchApiError(apiRequest('/x', { schema: Health }));
    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.status).toBe(500);
  });

  it('body thành công không đúng schema → INTERNAL_ERROR', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'down' }));

    const error = await catchApiError(apiRequest('/x', { schema: Health }));
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('body không phải JSON → INTERNAL_ERROR', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 502 }));

    const error = await catchApiError(apiRequest('/x', { schema: Health }));
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('fetch reject (lỗi mạng) → SERVICE_UNAVAILABLE, status null', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await catchApiError(apiRequest('/x', { schema: Health }));
    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.status).toBeNull();
  });

  it('hủy (signal aborted) → ném lại lỗi gốc, không thành ApiError', async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(abortError);

    await expect(apiRequest('/x', { schema: Health, init: { signal: controller.signal } })).rejects.toBe(abortError);
  });

  it('lỗi tên AbortError (không có signal) → ném lại lỗi gốc', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    fetchMock.mockRejectedValue(abortError);

    await expect(apiRequest('/x', { schema: Health })).rejects.toBe(abortError);
  });

  it('body chuỗi → content-type mặc định application/json', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }));

    await apiRequest('/x', { schema: Health, init: { method: 'POST', body: JSON.stringify({ a: 1 }) } });
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get('content-type')).toBe('application/json');
  });

  it.each([
    ['FormData', () => new FormData()],
    ['URLSearchParams', () => new URLSearchParams({ a: '1' })],
    ['Blob', () => new Blob(['x'])],
  ] as const)('body %s → không tự đặt content-type', async (_name, makeBody) => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }));

    await apiRequest('/x', { schema: Health, init: { method: 'POST', body: makeBody() } });
    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.has('content-type')).toBe(false);
  });
});

describe('apiDownload (Story 6.3: tải file, vd. CSV)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test/');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('gọi /v1 kèm cookie; thân thành công là Blob nguyên byte (không parse), kèm header', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62, 0x0d, 0x0a]);
    fetchMock.mockResolvedValue(
      new Response(bytes, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="a.csv"' } }),
    );

    const { blob, headers } = await apiDownload('/x/export?q=1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/x/export?q=1');
    expect(init?.credentials).toBe('include');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(headers.get('content-disposition')).toBe('attachment; filename="a.csv"');
  });

  it('lỗi JSON của api → ApiError giữ code và status; thân lạ → INTERNAL_ERROR', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'Đăng nhập', details: null } }));
    expect(await catchApiError(apiDownload('/x'))).toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });

    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    expect(await catchApiError(apiDownload('/x'))).toMatchObject({ code: 'INTERNAL_ERROR', status: 502 });
  });

  it('lỗi mạng, hoặc kết nối đứt khi đang nhận thân → SERVICE_UNAVAILABLE (không trả file cụt)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await catchApiError(apiDownload('/x'))).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: null });

    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xef, 0xbb, 0xbf]));
        controller.error(new TypeError('network error'));
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(broken, { status: 200, headers: { 'content-type': 'text/csv' } }));
    expect(await catchApiError(apiDownload('/x'))).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: null });
  });
});
