import {
  ErrorCode,
  Me,
  OtpInvalidDetails,
  OtpLockedDetails,
  OtpRateLimitedDetails,
  SendOtpResponse,
  VerifyOtpResponse,
  type SendOtpRequest,
  type VerifyOtpRequest,
} from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

/** Khóa TanStack Query của Tài khoản đang đăng nhập. */
export const ME_QUERY_KEY = ['identity', 'me'] as const;

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const sendOtp = (body: SendOtpRequest) =>
  apiRequest('/identity/otp', { schema: SendOtpResponse, init: json(body) });

export const verifyOtp = (body: VerifyOtpRequest) =>
  apiRequest('/identity/otp/verify', { schema: VerifyOtpResponse, init: json(body) });

export const fetchMe = (signal?: AbortSignal) => apiRequest('/identity/me', { schema: Me, init: { signal } });

export const giveConsent = () => apiRequest('/identity/consent', { schema: Me, init: { method: 'POST' } });

/** 204 No Content. Session đã hết (401) cũng coi như đã đăng xuất. */
export async function signOut(): Promise<void> {
  try {
    await apiRequest('/identity/sign-out', { schema: z.undefined(), init: { method: 'POST' } });
  } catch (error) {
    if (!hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) throw error;
  }
}

export function hasErrorCode(error: unknown, code: ErrorCode): error is ApiError {
  return error instanceof ApiError && error.code === code;
}

/** Số phút chờ trước khi gửi lại mã: làm tròn lên, tối thiểu 1. */
export function retryAfterMinutes(error: ApiError): number {
  const parsed = OtpRateLimitedDetails.safeParse(error.details);
  const seconds = parsed.success ? parsed.data.retryAfterSeconds : 60;
  return Math.max(1, Math.ceil(seconds / 60));
}

/** Số giờ chờ khi email bị khóa vì nhập sai quá nhiều lần: làm tròn lên, tối thiểu 1. */
export function retryAfterHours(error: ApiError): number {
  const parsed = OtpLockedDetails.safeParse(error.details);
  const seconds = parsed.success ? parsed.data.retryAfterSeconds : 3600;
  return Math.max(1, Math.ceil(seconds / 3600));
}

export function remainingAttempts(error: ApiError): number | null {
  const parsed = OtpInvalidDetails.safeParse(error.details);
  return parsed.success ? parsed.data.remainingAttempts : null;
}
