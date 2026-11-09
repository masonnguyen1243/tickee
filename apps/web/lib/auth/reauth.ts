import {
  ErrorCode,
  REAUTH_HEADER,
  REAUTH_TTL_SECONDS,
  ReauthEmailCodeResponse,
  ReauthGrant,
  ReauthRequiredDetails,
  type ReauthMethod,
} from '@tickee/contracts';

import { apiRequest } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';

/*
 * Xác nhận lại trước thao tác nhạy cảm (Story 2.13): đổi tài khoản nhận tiền mặc định, hủy liên kết tài khoản nhận
 * tiền, đổi key Tingee (sau này chuyển quyền Owner). Web không đoán trước thao tác nào cần xác nhận: gọi bình thường, api
 * trả `REAUTH_REQUIRED` thì `withReauth` mở dialog "Xác nhận để tiếp tục" (`ReauthDialog`, gắn một lần trong
 * `Providers`), lấy lần xác nhận rồi gọi lại đúng thao tác đó kèm header `REAUTH_HEADER`.
 */

const post = (body?: unknown): RequestInit =>
  body === undefined ? { method: 'POST' } : { method: 'POST', body: JSON.stringify(body) };

/** Gửi mã xác nhận 6 số tới email của tài khoản (chỉ khi chưa bật 2FA; đã bật → `REAUTH_METHOD_MISMATCH`). */
export const sendReauthEmailCode = () =>
  apiRequest('/identity/reauth/email-code', { schema: ReauthEmailCodeResponse, init: post() });

/** Nhập mã (TOTP nếu đã bật 2FA, mã email nếu chưa) → lần xác nhận cho session hiện tại, dùng một lần, 5 phút. */
export const confirmReauth = (code: string) =>
  apiRequest('/identity/reauth', { schema: ReauthGrant, init: post({ code }) });

/** Thêm header `REAUTH_HEADER` vào `init` khi có lần xác nhận. */
export function withReauthHeader(init: RequestInit, reauthToken?: string): RequestInit {
  if (!reauthToken) return init;
  const headers = new Headers(init.headers);
  headers.set(REAUTH_HEADER, reauthToken);
  return { ...init, headers };
}

/** Lỗi là `REAUTH_REQUIRED`: thao tác cần xác nhận lại (hoặc người dùng vừa đóng dialog xác nhận). */
export const isReauthRequired = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.code === ErrorCode.REAUTH_REQUIRED;

/** Cách xác nhận lại mà api báo trong `details`; không đọc được thì `null` (dialog dựa vào `me.twoFactorEnabled`). */
export function reauthMethodOf(error: unknown): ReauthMethod | null {
  if (!(error instanceof ApiError)) return null;
  const parsed = ReauthRequiredDetails.safeParse(error.details);
  return parsed.success ? parsed.data.method : null;
}

/**
 * Mã xác nhận email gần nhất của tab này, giữ qua các lần mở dialog (dialog dựng lại form mỗi yêu cầu): api chặn gửi mã
 * mới trong `resendAfterSeconds` giây (chung cooldown với mã đăng nhập), nên thao tác nhạy cảm thứ hai ngay sau đó phải
 * thấy đếm ngược thay vì nút gửi sẽ lỗi. `usable`: mã chưa dùng, chưa hết lượt.
 */
export type EmailCodeState = { readonly resendAt: number; readonly expiresAt: number; readonly usable: boolean };

let emailCode: EmailCodeState | null = null;

export function lastEmailCode(): EmailCodeState | null {
  return emailCode;
}

/** Vừa gửi mã email: mốc được gửi lại và hạn của mã (`REAUTH_TTL_SECONDS`). */
export function rememberEmailCodeSent(resendAfterSeconds: number, now = Date.now()): EmailCodeState {
  emailCode = { resendAt: now + resendAfterSeconds * 1000, expiresAt: now + REAUTH_TTL_SECONDS * 1000, usable: true };
  return emailCode;
}

/** Mã email đã dùng hoặc hết hiệu lực: lần mở dialog sau phải gửi mã mới (vẫn giữ mốc được gửi lại). */
export function forgetEmailCode(): void {
  if (emailCode) emailCode = { ...emailCode, usable: false };
}

/** Yêu cầu xác nhận lại đang chờ dialog. */
export type ReauthPrompt = {
  readonly id: number;
  /** Cách xác nhận api yêu cầu (`null`: không rõ). */
  readonly method: ReauthMethod | null;
};

type PendingPrompt = ReauthPrompt & { readonly resolve: (token: string | null) => void };

let pending: PendingPrompt | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

/** Cho `useSyncExternalStore` của `ReauthDialog`. */
export function subscribeReauthPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Yêu cầu đang chờ (`null`: dialog đóng). Cùng một object tới khi yêu cầu đổi. */
export function currentReauthPrompt(): ReauthPrompt | null {
  return pending;
}

/** Mở dialog và chờ: token khi xác nhận xong, `null` khi người dùng đóng. Chỉ một dialog mỗi lúc: yêu cầu mới thay cũ. */
function requestReauth(method: ReauthMethod | null): Promise<string | null> {
  const previous = pending;
  return new Promise((resolve) => {
    pending = { id: nextId++, method, resolve };
    emit();
    previous?.resolve(null);
  });
}

/** Dialog trả kết quả cho yêu cầu `id` (bỏ qua nếu yêu cầu đó không còn chờ). */
export function settleReauthPrompt(id: number, token: string | null): void {
  if (!pending || pending.id !== id) return;
  const { resolve } = pending;
  pending = null;
  emit();
  resolve(token);
}

export type WithReauthOptions = {
  /** Gọi ngay trước khi mở dialog xác nhận (vd. đóng `Dialog` của chính thao tác để chỉ một dialog hiện). */
  onPrompt?: () => void;
};

/**
 * Chạy thao tác nhạy cảm: gọi `call()` không header; api trả `REAUTH_REQUIRED` thì mở dialog xác nhận, có lần xác nhận
 * thì gọi lại `call(token)` (người dùng không phải bấm lại). Lần gọi lại vẫn `REAUTH_REQUIRED` (vd. hết hạn) thì hỏi
 * lại. Người dùng đóng dialog → ném lại lỗi `REAUTH_REQUIRED` (người gọi coi là đã hủy, không báo lỗi). Lỗi khác ném
 * nguyên trạng.
 */
export async function withReauth<T>(
  call: (reauthToken?: string) => Promise<T>,
  options: WithReauthOptions = {},
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!isReauthRequired(error)) throw error;
    options.onPrompt?.();
    let required: ApiError = error;
    for (;;) {
      const token = await requestReauth(reauthMethodOf(required));
      if (token === null) throw required;
      try {
        return await call(token);
      } catch (retryError) {
        if (!isReauthRequired(retryError)) throw retryError;
        required = retryError;
      }
    }
  }
}
