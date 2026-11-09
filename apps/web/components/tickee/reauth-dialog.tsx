'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ErrorCode, OTP_LENGTH, REAUTH_TTL_SECONDS, ReauthMethod, TOTP_DIGITS } from '@tickee/contracts';
import { useEffect, useId, useState, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api/errors';
import { messageOf } from '@/lib/api/message-of';
import {
  fetchMe,
  hasErrorCode,
  ME_QUERY_KEY,
  remainingAttempts,
  retryAfterHours,
  retryAfterMinutes,
} from '@/lib/auth/api';
import {
  confirmReauth,
  currentReauthPrompt,
  forgetEmailCode,
  lastEmailCode,
  reauthMethodOf,
  rememberEmailCodeSent,
  sendReauthEmailCode,
  settleReauthPrompt,
  subscribeReauthPrompt,
} from '@/lib/auth/reauth';
import { totpErrorMessage } from '@/lib/auth/totp';

import { FieldError } from './field-error';
import { OtpInput } from './otp-input';

/** Lời báo khi api cho biết cách xác nhận đã đổi (2FA vừa bật/tắt ở nơi khác). */
const SWITCHED_TO: Readonly<Record<ReauthMethod, string>> = {
  [ReauthMethod.TOTP]: 'Tài khoản đã bật xác thực hai lớp. Nhập mã trong ứng dụng xác thực.',
  [ReauthMethod.EMAIL_OTP]: 'Tài khoản không còn bật xác thực hai lớp. Gửi mã qua email để xác nhận.',
};
const TTL_MINUTES = Math.ceil(REAUTH_TTL_SECONDS / 60);

/** Mã email gửi trước đó (lần mở dialog trước) còn dùng được không. */
const hasUsableEmailCode = () => {
  const last = lastEmailCode();
  return last !== null && last.usable && last.expiresAt > Date.now();
};

/** Lỗi tại chỗ; `newCode` = kèm nút "Gửi mã mới" (mã email hết hạn/hết lượt). */
type FieldFailure = { message: string; newCode?: boolean };

const isOtpError = (error: unknown) =>
  error instanceof ApiError &&
  (error.code === ErrorCode.OTP_INVALID ||
    error.code === ErrorCode.OTP_EXPIRED ||
    error.code === ErrorCode.OTP_ATTEMPTS_EXCEEDED);

const isTotpError = (error: unknown) =>
  error instanceof ApiError && (error.code === ErrorCode.TOTP_INVALID || error.code === ErrorCode.TOTP_LOCKED);

function sendErrorOf(error: unknown): FieldFailure {
  if (hasErrorCode(error, ErrorCode.OTP_LOCKED)) {
    return { message: `Bạn đã nhập sai quá nhiều lần. Thử lại sau ${retryAfterHours(error)} giờ.` };
  }
  if (hasErrorCode(error, ErrorCode.OTP_RATE_LIMITED)) {
    return { message: `Bạn đã yêu cầu quá nhiều mã. Thử lại sau ${retryAfterMinutes(error)} phút.` };
  }
  return { message: messageOf(error) };
}

function emailCodeErrorOf(error: unknown): FieldFailure {
  if (hasErrorCode(error, ErrorCode.OTP_LOCKED)) {
    return { message: `Bạn đã nhập sai quá nhiều lần. Thử lại sau ${retryAfterHours(error)} giờ.` };
  }
  if (hasErrorCode(error, ErrorCode.OTP_INVALID)) {
    const left = remainingAttempts(error);
    return { message: left === null ? 'Mã chưa đúng.' : `Mã chưa đúng, còn ${left} lần.` };
  }
  if (hasErrorCode(error, ErrorCode.OTP_EXPIRED)) return { message: 'Mã đã hết hạn.', newCode: true };
  if (hasErrorCode(error, ErrorCode.OTP_ATTEMPTS_EXCEEDED)) return { message: 'Mã đã hết hiệu lực.', newCode: true };
  if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) return { message: `Mã gồm ${OTP_LENGTH} số.` };
  return { message: messageOf(error) };
}

function useSecondsUntil(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * Form của một yêu cầu xác nhận (dựng lại mỗi yêu cầu). Cách xác nhận theo `REAUTH_REQUIRED` của api (không rõ thì
 * theo `me.twoFactorEnabled`); api báo cách khác (2FA vừa bật/tắt ở nơi khác) thì đổi theo.
 */
function ReauthForm({ promptId, method: requested }: { promptId: number; method: ReauthMethod | null }) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const errorId = `${ids}-error`;
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const [override, setOverride] = useState<ReauthMethod | null>(null);
  const method =
    override ?? requested ?? (me.data ? (me.data.twoFactorEnabled ? ReauthMethod.TOTP : ReauthMethod.EMAIL_OTP) : null);
  /**
   * Đã có mã email để nhập (vừa gửi ở form này, hoặc gửi ở lần mở trước mà chưa dùng). Mốc được gửi lại lấy từ lần gửi
   * gần nhất của tab (giữ qua các lần mở dialog), nên thao tác thứ hai ngay sau đó thấy đếm ngược thay vì gửi lỗi.
   */
  const [codeSent, setCodeSent] = useState(hasUsableEmailCode);
  const [resendAt, setResendAt] = useState<number | null>(() => lastEmailCode()?.resendAt ?? null);
  const [error, setError] = useState<FieldFailure | null>(null);
  const [partial, setPartial] = useState('');
  const [otpKey, setOtpKey] = useState(0);
  const secondsLeft = useSecondsUntil(resendAt);

  const clearCode = () => {
    setPartial('');
    setOtpKey((k) => k + 1);
  };
  const switchTo = (next: ReauthMethod) => {
    setOverride(next);
    setCodeSent(next === ReauthMethod.EMAIL_OTP && hasUsableEmailCode());
    clearCode();
    setError({ message: SWITCHED_TO[next] });
  };
  /** `REAUTH_METHOD_MISMATCH`: đổi sang cách api báo trong `details` (không đọc được thì cách còn lại). */
  const switchFromMismatch = (err: unknown) =>
    switchTo(reauthMethodOf(err) ?? (method === ReauthMethod.TOTP ? ReauthMethod.EMAIL_OTP : ReauthMethod.TOTP));

  const send = useMutation({
    mutationFn: sendReauthEmailCode,
    onSuccess: ({ resendAfterSeconds }) => {
      setResendAt(rememberEmailCodeSent(resendAfterSeconds).resendAt);
      setCodeSent(true);
      setError(null);
      clearCode();
    },
    onError: (err) => {
      if (hasErrorCode(err, ErrorCode.REAUTH_METHOD_MISMATCH)) switchFromMismatch(err);
      else setError(sendErrorOf(err));
    },
  });

  const confirm = useMutation({
    mutationFn: confirmReauth,
    onSuccess: ({ reauthToken }) => {
      // Mã email đã bị tiêu: lần mở sau phải gửi mã mới.
      if (method === ReauthMethod.EMAIL_OTP) forgetEmailCode();
      settleReauthPrompt(promptId, reauthToken);
    },
    onError: (err) => {
      clearCode();
      if (hasErrorCode(err, ErrorCode.REAUTH_METHOD_MISMATCH)) switchFromMismatch(err);
      else if (method === ReauthMethod.TOTP && isOtpError(err)) switchTo(ReauthMethod.EMAIL_OTP);
      else if (method === ReauthMethod.EMAIL_OTP && isTotpError(err)) switchTo(ReauthMethod.TOTP);
      else if (method === ReauthMethod.TOTP) setError({ message: totpErrorMessage(err) });
      else {
        const fieldError = emailCodeErrorOf(err);
        if (fieldError.newCode) forgetEmailCode();
        setError(fieldError);
      }
    },
  });

  const length = method === ReauthMethod.TOTP ? TOTP_DIGITS : OTP_LENGTH;
  const submit = (code: string) => {
    if (confirm.isPending || confirm.isSuccess) return;
    if (code.length !== length) {
      setError({ message: `Nhập đủ ${length} số.` });
      return;
    }
    setError(null);
    confirm.mutate(code);
  };
  const sendCode = () => {
    if (send.isPending) return;
    setError(null);
    send.mutate();
  };
  const cancel = () => settleReauthPrompt(promptId, null);

  if (method === null) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-stack">
        <span className="sr-only">Đang tải</span>
        <div aria-hidden="true" className="h-14 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  const email = me.data?.email;
  if (method === ReauthMethod.EMAIL_OTP && !codeSent) {
    return (
      <div className="flex flex-col gap-stack" data-slot="reauth-send">
        <p className="text-body">
          Tickee sẽ gửi mã {OTP_LENGTH} số tới email của bạn. Mã có hiệu lực {TTL_MINUTES} phút.
        </p>
        {secondsLeft > 0 ? (
          // Lý do nút gửi đang tắt: vừa gửi mã (api chặn gửi lại trong khoảng này).
          <p className="text-meta text-muted-foreground tabular-nums" aria-live="off">
            Bạn vừa nhận một mã. Gửi được mã mới sau {secondsLeft} giây.
          </p>
        ) : null}
        <FieldError id={errorId} message={error?.message} />
        <DialogFooter>
          <Button
            type="button"
            className="w-full"
            loading={send.isPending}
            disabled={secondsLeft > 0}
            onClick={sendCode}
          >
            {email ? (
              <span className="break-all">Gửi mã tới {email}</span>
            ) : (
              'Gửi mã qua email'
            )}
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={cancel}>
            Hủy
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      noValidate
      data-slot="reauth-code"
      onSubmit={(event) => {
        event.preventDefault();
        submit(partial);
      }}
      className="flex flex-col gap-stack"
    >
      {method === ReauthMethod.EMAIL_OTP ? (
        <p role="status" className="text-body">
          Mã đã gửi tới <span className="font-bold break-all">{email ?? 'email của bạn'}</span>
        </p>
      ) : null}
      <p id={labelId} className="text-label">
        {method === ReauthMethod.TOTP ? `Mã ${TOTP_DIGITS} số trong ứng dụng xác thực` : `Mã xác nhận ${OTP_LENGTH} số`}
      </p>
      <OtpInput
        key={`${method}-${otpKey}`}
        length={length}
        idPrefix={`${ids}-otp`}
        labelledBy={labelId}
        describedBy={errorId}
        invalid={error !== null}
        readOnly={confirm.isPending}
        autoFocus
        onChange={setPartial}
        onComplete={submit}
      />
      <FieldError id={errorId} message={error?.message} />
      {method === ReauthMethod.EMAIL_OTP ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {secondsLeft > 0 ? (
            <p className="text-meta text-muted-foreground tabular-nums" aria-live="off">
              Gửi lại mã sau {secondsLeft} giây
            </p>
          ) : (
            <Button type="button" variant="link" size="sm" onClick={sendCode} loading={send.isPending}>
              {error?.newCode ? 'Gửi mã mới' : 'Gửi lại mã'}
            </Button>
          )}
        </div>
      ) : null}
      <DialogFooter>
        <Button type="submit" className="w-full" loading={confirm.isPending || confirm.isSuccess}>
          Xác nhận
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={cancel}>
          Hủy
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Dialog "Xác nhận để tiếp tục" (Story 2.13), gắn một lần trong `Providers`: mở khi `withReauth` gặp `REAUTH_REQUIRED`.
 * Đã bật 2FA → nhập mã TOTP; chưa bật → "Gửi mã tới {email}" rồi nhập mã. Lỗi báo tại ô, dialog vẫn mở. Đúng → thao tác
 * dở tự chạy lại; đóng (Hủy, Esc, nút đóng) → thao tác không chạy.
 */
export function ReauthDialog() {
  const prompt = useSyncExternalStore(subscribeReauthPrompt, currentReauthPrompt, () => null);
  return (
    <Dialog
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open && prompt) settleReauthPrompt(prompt.id, null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xác nhận để tiếp tục</DialogTitle>
          <DialogDescription>Đây là thao tác quan trọng nên bạn cần xác nhận lại danh tính.</DialogDescription>
        </DialogHeader>
        {/* Dựng lại form mỗi yêu cầu để không giữ mã/lỗi của lần trước. */}
        {prompt ? <ReauthForm key={prompt.id} promptId={prompt.id} method={prompt.method} /> : null}
      </DialogContent>
    </Dialog>
  );
}
