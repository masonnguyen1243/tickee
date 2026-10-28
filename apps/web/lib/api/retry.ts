import { ApiError } from './errors';

const MAX_RETRIES = 2;

/** Lỗi 4xx là kết quả nghiệp vụ, không thử lại; lỗi mạng/5xx thử lại tối đa 2 lần. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status !== null && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}
