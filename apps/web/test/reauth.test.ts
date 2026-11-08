import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import {
  currentReauthPrompt,
  forgetEmailCode,
  isReauthRequired,
  lastEmailCode,
  reauthMethodOf,
  rememberEmailCodeSent,
  settleReauthPrompt,
  subscribeReauthPrompt,
  withReauth,
  withReauthHeader,
} from '@/lib/auth/reauth';

const reauthRequired = (method: unknown = 'email_otp') =>
  new ApiError('REAUTH_REQUIRED', 'Bạn cần xác nhận lại để tiếp tục.', { method }, 403);

/** Chờ `withReauth` mở dialog (yêu cầu mới) rồi trả yêu cầu đó. */
async function nextPrompt() {
  await vi.waitFor(() => {
    if (!currentReauthPrompt()) throw new Error('chưa có yêu cầu xác nhận');
  });
  return currentReauthPrompt()!;
}

afterEach(() => {
  const prompt = currentReauthPrompt();
  if (prompt) settleReauthPrompt(prompt.id, null);
});

describe('withReauthHeader', () => {
  it('có token → thêm header x-reauth-token, giữ header và method cũ; không có → giữ nguyên init', () => {
    const init = withReauthHeader({ method: 'DELETE', headers: { accept: 'application/json' } }, 'tok');
    expect(init.method).toBe('DELETE');
    const headers = new Headers(init.headers);
    expect(headers.get('x-reauth-token')).toBe('tok');
    expect(headers.get('accept')).toBe('application/json');
    const plain = { method: 'POST' };
    expect(withReauthHeader(plain)).toBe(plain);
  });
});

describe('phân loại REAUTH_REQUIRED', () => {
  it('isReauthRequired và method trong details', () => {
    expect(isReauthRequired(reauthRequired())).toBe(true);
    expect(isReauthRequired(new ApiError('FORBIDDEN_ROLE', 'x', null, 403))).toBe(false);
    expect(reauthMethodOf(reauthRequired('totp'))).toBe('totp');
    expect(reauthMethodOf(reauthRequired('email_otp'))).toBe('email_otp');
    expect(reauthMethodOf(reauthRequired('khac'))).toBeNull();
    expect(reauthMethodOf(new Error('x'))).toBeNull();
  });
});

describe('withReauth', () => {
  it('không cần xác nhận → gọi một lần, không mở dialog', async () => {
    const call = vi.fn().mockResolvedValue('ok');
    await expect(withReauth(call)).resolves.toBe('ok');
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith();
    expect(currentReauthPrompt()).toBeNull();
  });

  it('REAUTH_REQUIRED → onPrompt, mở dialog với method; xác nhận xong gọi lại với token, dialog đóng', async () => {
    const call = vi.fn().mockRejectedValueOnce(reauthRequired('totp')).mockResolvedValueOnce('xong');
    const onPrompt = vi.fn();
    const listener = vi.fn();
    const unsubscribe = subscribeReauthPrompt(listener);
    const result = withReauth(call, { onPrompt });

    const prompt = await nextPrompt();
    expect(prompt.method).toBe('totp');
    expect(onPrompt).toHaveBeenCalledTimes(1);
    settleReauthPrompt(prompt.id, 'tok-1');
    await expect(result).resolves.toBe('xong');
    expect(call).toHaveBeenNthCalledWith(2, 'tok-1');
    expect(currentReauthPrompt()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('người dùng đóng dialog → ném lại REAUTH_REQUIRED, không gọi lại', async () => {
    const call = vi.fn().mockRejectedValue(reauthRequired());
    const result = withReauth(call);
    const prompt = await nextPrompt();
    settleReauthPrompt(prompt.id, null);
    await expect(result).rejects.toSatisfy(isReauthRequired);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('lần gọi lại vẫn REAUTH_REQUIRED → hỏi lại; lỗi khác → ném nguyên trạng', async () => {
    const notFound = new ApiError('NOT_FOUND', 'x', null, 404);
    const call = vi
      .fn()
      .mockRejectedValueOnce(reauthRequired())
      .mockRejectedValueOnce(reauthRequired())
      .mockRejectedValueOnce(notFound);
    const result = withReauth(call);
    const first = await nextPrompt();
    settleReauthPrompt(first.id, 'tok-1');
    await vi.waitFor(() => expect(currentReauthPrompt()?.id).not.toBe(first.id));
    const second = await nextPrompt();
    settleReauthPrompt(second.id, 'tok-2');
    await expect(result).rejects.toBe(notFound);
    expect(call.mock.calls).toEqual([[], ['tok-1'], ['tok-2']]);
  });

  it('lỗi khác ngay lần đầu → ném nguyên trạng, không mở dialog', async () => {
    const forbidden = new ApiError('FORBIDDEN_ROLE', 'x', null, 403);
    await expect(withReauth(() => Promise.reject(forbidden))).rejects.toBe(forbidden);
    expect(currentReauthPrompt()).toBeNull();
  });

  it('kết quả cho yêu cầu cũ bị bỏ qua; yêu cầu mới thay yêu cầu cũ (cũ coi như hủy)', async () => {
    // Bắt kết quả ngay: yêu cầu cũ bị hủy (reject) trước khi test kịp `await`.
    const first = withReauth(vi.fn().mockRejectedValue(reauthRequired())).catch((error: unknown) => error);
    const firstPrompt = await nextPrompt();
    const second = withReauth(vi.fn().mockRejectedValueOnce(reauthRequired()).mockResolvedValue('hai'));
    await vi.waitFor(() => expect(currentReauthPrompt()?.id).not.toBe(firstPrompt.id));
    expect(isReauthRequired(await first)).toBe(true);
    settleReauthPrompt(firstPrompt.id, 'tok-cu');
    const secondPrompt = currentReauthPrompt()!;
    settleReauthPrompt(secondPrompt.id, 'tok-moi');
    await expect(second).resolves.toBe('hai');
  });
});

describe('mã email gần nhất (giữ qua các lần mở dialog)', () => {
  it('gửi mã → mốc gửi lại và hạn 5 phút, còn dùng được; dùng/hết hiệu lực → không dùng được nhưng giữ mốc gửi lại', () => {
    const sent = rememberEmailCodeSent(60, 1_000_000);
    expect(sent).toEqual({ resendAt: 1_060_000, expiresAt: 1_300_000, usable: true });
    expect(lastEmailCode()).toBe(sent);
    forgetEmailCode();
    expect(lastEmailCode()).toEqual({ resendAt: 1_060_000, expiresAt: 1_300_000, usable: false });
  });
});
