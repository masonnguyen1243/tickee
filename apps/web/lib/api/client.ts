import { ErrorResponse } from '@tickee/contracts';
import type { z } from 'zod';

import { ApiError, invalidResponseError, serviceUnavailableError } from './errors';

export type ApiRequestOptions<S extends z.ZodType> = {
  /** Schema Zod từ `@tickee/contracts`: kiểm response và suy kiểu kết quả. */
  schema: S;
  init?: RequestInit;
};

function apiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new Error('Thiếu biến môi trường NEXT_PUBLIC_API_BASE_URL');
  return base.replace(/\/+$/, '');
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === '') return undefined;
  return JSON.parse(text) as unknown;
}

/**
 * Lõi dùng chung cho bản client và bản server. `extraHeaders` cho phép bản server chuyển tiếp cookie.
 * @internal
 */
export async function performApiRequest<S extends z.ZodType>(
  path: string,
  { schema, init }: ApiRequestOptions<S>,
  extraHeaders?: HeadersInit,
): Promise<z.output<S>> {
  if (!path.startsWith('/')) throw new Error(`apiRequest: path phải bắt đầu bằng "/", nhận "${path}"`);

  const headers = new Headers(init?.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  // Chỉ mặc định JSON cho body chuỗi; FormData/URLSearchParams/Blob để fetch tự đặt (vd. boundary multipart).
  if (typeof init?.body === 'string' && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));

  const url = `${apiBaseUrl()}/v1${path}`;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, credentials: 'include' });
  } catch (cause) {
    // Hủy chủ động (TanStack Query cancel, signal abort) không phải lỗi mạng: ném lại nguyên trạng, không thử lại.
    if (init?.signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')) throw cause;
    throw serviceUnavailableError(cause);
  }

  let body: unknown;
  try {
    body = await readJson(res);
  } catch {
    throw invalidResponseError(res.status);
  }

  if (!res.ok) {
    const parsed = ErrorResponse.safeParse(body);
    if (!parsed.success) throw invalidResponseError(res.status);
    const { code, message, details } = parsed.data.error;
    throw new ApiError(code, message, details, res.status);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalidResponseError(res.status);
  return parsed.data;
}

/**
 * Gọi REST `/v1` từ trình duyệt (dùng trong `queryFn`/`mutationFn` của TanStack Query).
 * Cookie session đi kèm nhờ `credentials: 'include'`. Mọi lỗi là `ApiError`.
 */
export function apiRequest<S extends z.ZodType>(path: string, options: ApiRequestOptions<S>): Promise<z.output<S>> {
  return performApiRequest(path, options);
}
