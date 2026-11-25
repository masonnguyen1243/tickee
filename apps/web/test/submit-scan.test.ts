import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, isNetworkError } from '@/lib/api/errors';
import { SCAN_TIMEOUT_MS, submitScan } from '@/lib/checkin/api';

/*
 * Hạn chờ 3 giây của mỗi lần gửi quét (Story 5.4): quá hạn thì hủy request và ném lỗi mạng (`isNetworkError`) để Màn
 * quét gửi lại cùng `scanId`; có phản hồi trước hạn thì trả kết quả (hay lỗi của api) và không còn timer nào chạy.
 */

const EVENT_ID = '019a3b2c-0712-7abc-8def-0123456789ab';
const BODY = { code: 't1.019a3b2c-0b00-7abc-8def-000000000001.sig', scanId: '019a3b2c-0c00-7abc-8def-000000000001' };
const OK = { outcome: 'ok', holderName: 'Nguyễn Văn Minh', seq: 1, count: 2, ticketTypeName: 'Đôi nam' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** `fetch` không bao giờ phản hồi; chỉ kết thúc (AbortError) khi `signal` của request bị hủy, như trình duyệt. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });

/** Kết quả của promise khi đã xong; `'pending'` khi chưa. */
async function settled<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown } | 'pending'> {
  let state: { value: T } | { error: unknown } | 'pending' = 'pending';
  promise.then(
    (value) => (state = { value }),
    (error: unknown) => (state = { error }),
  );
  await vi.advanceTimersByTimeAsync(0);
  return state;
}

describe('submitScan', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('hạn 3 giây: chưa phản hồi lúc 2,999 giây thì vẫn chờ; tới 3 giây thì hủy request và ném lỗi mạng; không còn timer', async () => {
    expect(SCAN_TIMEOUT_MS).toBe(3000);
    fetchMock.mockImplementation(hangingFetch);

    const pending = submitScan(EVENT_ID, BODY);
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS - 1);
    expect(await settled(pending)).toBe('pending');
    const signal = fetchMock.mock.calls[0]![1]!.signal!;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await settled(pending);
    expect(result).not.toBe('pending');
    const { error } = result as { error: unknown };
    expect(error).toBeInstanceOf(ApiError);
    expect(isNetworkError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: null });
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // Đúng một request: lần gửi lại là việc của Màn quét (cùng `scanId`).
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`http://api.test/v1/checkin/events/${EVENT_ID}/scans`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init!.body as string)).toEqual(BODY);
  });

  it('hạn 3 giây khi đang đọc body (header đã tới, body không bao giờ xong) → lỗi mạng, không phải lỗi dữ liệu; không còn timer', async () => {
    fetchMock.mockImplementation((_input, init) => {
      const signal = init?.signal;
      // Body chỉ kết thúc (lỗi AbortError) khi request bị hủy, như trình duyệt.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), {
            once: true,
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    });

    const pending = submitScan(EVENT_ID, BODY);
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS - 1);
    expect(await settled(pending)).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    const result = await settled(pending);
    expect(result).not.toBe('pending');
    const { error } = result as { error: unknown };
    expect(isNetworkError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('phản hồi trước 3 giây → kết quả; timer đã xóa, request không bị hủy về sau', async () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          setTimeout(() => resolve(jsonResponse(200, OK)), SCAN_TIMEOUT_MS - 500);
        }),
    );

    const pending = submitScan(EVENT_ID, BODY);
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS - 500);
    expect(await settled(pending)).toEqual({ value: OK });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SCAN_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  });

  it('lỗi của api trước 3 giây (403) → ApiError giữ status, không phải lỗi mạng; timer đã xóa', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: 'CHECKER_REVOKED', message: 'Bạn không còn quyền.', details: null } }),
    );

    const result = await settled(submitScan(EVENT_ID, BODY));
    const { error } = result as { error: unknown };
    expect(error).toMatchObject({ code: 'CHECKER_REVOKED', status: 403 });
    expect(isNetworkError(error)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lỗi mạng ngay (fetch lỗi) → lỗi mạng; timer đã xóa', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const { error } = (await settled(submitScan(EVENT_ID, BODY))) as { error: unknown };
    expect(isNetworkError(error)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('signal của nơi gọi hủy (rời Màn quét) → ném lại AbortError nguyên trạng, không phải lỗi mạng; timer đã xóa', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const leave = new AbortController();

    const pending = submitScan(EVENT_ID, BODY, leave.signal);
    await vi.advanceTimersByTimeAsync(1000);
    leave.abort();
    const { error } = (await settled(pending)) as { error: unknown };
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(isNetworkError(error)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    // Đã rời màn từ trước: không gửi được nữa (fetch nhận signal đã hủy).
    const late = await settled(submitScan(EVENT_ID, BODY, leave.signal));
    expect(isNetworkError((late as { error: unknown }).error)).toBe(false);
    expect(fetchMock.mock.calls[1]![1]!.signal!.aborted).toBe(true);
  });
});
