'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EmailAddress, ErrorCode, GoogleSignInError, OTP_LENGTH } from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { OtpInput } from '@/components/tickee/otp-input';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ApiError } from '@/lib/api/errors';
import {
  hasErrorCode,
  ME_QUERY_KEY,
  remainingAttempts,
  retryAfterHours,
  retryAfterMinutes,
  sendOtp,
  verifyOtp,
} from '@/lib/auth/api';
import { CONSENT_PATH, LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';

type Step = { kind: 'email' } | { kind: 'code'; email: string; resendAt: number };

/** Lỗi hiển thị cạnh ô nhập; `newCode` = kèm nút "Gửi mã mới". */
type FieldError = { message: string; newCode?: boolean };

const GENERIC_ERROR = 'Đã có lỗi xảy ra. Vui lòng thử lại.';

function rateLimitedMessage(error: ApiError): string {
  return `Bạn đã yêu cầu quá nhiều mã. Thử lại sau ${retryAfterMinutes(error)} phút.`;
}

/** Khóa theo ngày: không kèm "Gửi mã mới" vì gửi cũng bị khóa. */
function lockedMessage(error: ApiError): string {
  return `Bạn đã nhập sai quá nhiều lần. Thử lại sau ${retryAfterHours(error)} giờ.`;
}

function sendErrorOf(error: unknown): FieldError {
  if (hasErrorCode(error, ErrorCode.OTP_LOCKED)) return { message: lockedMessage(error) };
  if (hasErrorCode(error, ErrorCode.OTP_RATE_LIMITED)) return { message: rateLimitedMessage(error) };
  if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) return { message: 'Email chưa đúng định dạng.' };
  return { message: error instanceof ApiError ? error.message : GENERIC_ERROR };
}

function verifyErrorOf(error: unknown): FieldError {
  if (hasErrorCode(error, ErrorCode.OTP_LOCKED)) return { message: lockedMessage(error) };
  if (hasErrorCode(error, ErrorCode.OTP_INVALID)) {
    const left = remainingAttempts(error);
    return { message: left === null ? 'Mã chưa đúng.' : `Mã chưa đúng, còn ${left} lần` };
  }
  if (hasErrorCode(error, ErrorCode.OTP_EXPIRED)) return { message: 'Mã đã hết hạn', newCode: true };
  if (hasErrorCode(error, ErrorCode.OTP_ATTEMPTS_EXCEEDED)) return { message: 'Mã đã hết hiệu lực', newCode: true };
  if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) return { message: `Mã gồm ${OTP_LENGTH} số.` };
  return { message: error instanceof ApiError ? error.message : GENERIC_ERROR };
}

type GoogleBanner = { tone: 'warning' | 'danger'; title: string };

/** Banner cho `?error=<mã>` của luồng Google. Hủy trên Google thì không báo gì. */
function googleBannerOf(code: string | undefined): GoogleBanner | null {
  if (!code || code === GoogleSignInError.ACCESS_DENIED) return null;
  if (code === GoogleSignInError.EMAIL_NOT_VERIFIED) {
    return { tone: 'warning', title: 'Email Google chưa được xác minh. Hãy dùng mã qua email.' };
  }
  return { tone: 'danger', title: 'Chưa đăng nhập được bằng Google. Thử lại hoặc dùng mã qua email.' };
}

function ErrorText({ id, error }: { id: string; error: FieldError | null }) {
  // Vùng luôn có mặt để trình đọc màn hình thông báo khi lỗi xuất hiện.
  return (
    <p id={id} role="alert" className="flex min-h-0 items-start gap-1.5 text-meta text-danger-text empty:hidden">
      {error ? (
        <>
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error.message}</span>
        </>
      ) : null}
    </p>
  );
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

type LoginFormProps = {
  /** Đích sau đăng nhập, đã qua `safeReturnTo`. */
  returnTo: string;
  /**
   * Chỗ cho cách đăng nhập khác đặt phía trên `Separator` "hoặc" — Story 1.4 truyền nút "Tiếp tục với Google".
   * Chưa có thì không render cả separator.
   */
  alternativeSignIn?: ReactNode;
  /** Mã `error` mà luồng Google gắn khi quay về màn đăng nhập (đọc một lần, rồi xóa khỏi URL). */
  googleError?: string;
};

/** Màn đăng nhập: Google (nếu có) hoặc OTP email, bước email → bước mã. */
export function LoginForm({ returnTo, alternativeSignIn, googleError }: LoginFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ids = useId();
  const emailId = `${ids}-email`;
  const emailErrorId = `${ids}-email-error`;
  const codeLabelId = `${ids}-code-label`;
  const codeErrorId = `${ids}-code-error`;

  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<FieldError | null>(null);
  const [codeError, setCodeError] = useState<FieldError | null>(null);
  const [partialCode, setPartialCode] = useState('');
  const [otpKey, setOtpKey] = useState(0);
  const lastSubmitted = useRef<string | null>(null);
  // Giữ banner trong state: URL bị xóa `error` ngay sau đó, tải lại trang sẽ không hiện lại.
  const [googleBanner] = useState(() => googleBannerOf(googleError));

  useEffect(() => {
    if (googleError === undefined) return;
    // `history.replaceState` (Next đồng bộ với router) thay vì `router.replace`: không render lại trang server,
    // không mất state của form. Giữ `returnTo`, bỏ `error` và `error_description`.
    window.history.replaceState(window.history.state, '', withReturnTo(LOGIN_PATH, returnTo));
  }, [googleError, returnTo]);

  const secondsLeft = useSecondsUntil(step.kind === 'code' ? step.resendAt : null);

  const send = useMutation({
    mutationFn: (address: string) => sendOtp({ email: address }),
    onSuccess: (data, address) => {
      setStep({ kind: 'code', email: address, resendAt: Date.now() + data.resendAfterSeconds * 1000 });
      setCodeError(null);
      setPartialCode('');
      lastSubmitted.current = null;
      setOtpKey((k) => k + 1);
    },
    onError: (error) => {
      if (step.kind === 'code') setCodeError(sendErrorOf(error));
      else setEmailError(sendErrorOf(error));
    },
  });

  const verify = useMutation({
    mutationFn: (code: string) => verifyOtp({ email: step.kind === 'code' ? step.email : email, otp: code }),
    onSuccess: async ({ consentRequired }) => {
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      router.replace(consentRequired ? withReturnTo(CONSENT_PATH, returnTo) : returnTo);
    },
    onError: (error) => {
      setCodeError(verifyErrorOf(error));
      setPartialCode('');
      lastSubmitted.current = null;
      setOtpKey((k) => k + 1);
    },
  });

  const submitEmail = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (send.isPending) return;
    const parsed = EmailAddress.safeParse(email);
    if (!parsed.success) {
      setEmailError({ message: 'Email chưa đúng định dạng.' });
      return;
    }
    setEmailError(null);
    send.mutate(parsed.data);
  };

  const submitCode = (code: string) => {
    if (verify.isPending || verify.isSuccess || code === lastSubmitted.current) return;
    if (code.length !== OTP_LENGTH) {
      setCodeError({ message: `Nhập đủ ${OTP_LENGTH} số của mã.` });
      return;
    }
    lastSubmitted.current = code;
    setCodeError(null);
    verify.mutate(code);
  };

  const resend = () => {
    if (step.kind !== 'code' || send.isPending) return;
    setCodeError(null);
    send.mutate(step.email);
  };

  const changeEmail = () => {
    setStep({ kind: 'email' });
    setCodeError(null);
    setEmailError(null);
    send.reset();
    verify.reset();
  };

  if (step.kind === 'email') {
    return (
      <div className="flex flex-col gap-section">
        {googleBanner ? <StatusBanner tone={googleBanner.tone} title={googleBanner.title} /> : null}
        {alternativeSignIn ? (
          <>
            {alternativeSignIn}
            <div className="flex items-center gap-3 text-meta text-muted-foreground">
              <Separator className="flex-1" />
              <span>hoặc</span>
              <Separator className="flex-1" />
            </div>
          </>
        ) : null}
        <form noValidate onSubmit={submitEmail} className="flex flex-col gap-stack">
          <Label htmlFor={emailId}>Email</Label>
          <Input
            id={emailId}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            placeholder="ban@vidu.vn"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setEmailError(null);
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailErrorId}
          />
          <ErrorText id={emailErrorId} error={emailError} />
          <Button type="submit" className="mt-2 w-full" loading={send.isPending}>
            Gửi mã
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section">
      <p role="status" className="text-body">
        Mã đã gửi tới <span className="font-bold break-all">{step.email}</span>
      </p>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submitCode(partialCode);
        }}
        className="flex flex-col gap-stack"
      >
        <p id={codeLabelId} className="text-label">
          Mã đăng nhập {OTP_LENGTH} số
        </p>
        <OtpInput
          key={otpKey}
          length={OTP_LENGTH}
          idPrefix={`${ids}-otp`}
          labelledBy={codeLabelId}
          describedBy={codeErrorId}
          invalid={codeError !== null}
          readOnly={verify.isPending}
          autoFocus
          onChange={setPartialCode}
          onComplete={submitCode}
        />
        <ErrorText id={codeErrorId} error={codeError} />
        {codeError?.newCode ? (
          <Button type="button" variant="secondary" className="w-full" loading={send.isPending} onClick={resend}>
            Gửi mã mới
          </Button>
        ) : (
          <Button type="submit" className="mt-2 w-full" loading={verify.isPending || verify.isSuccess}>
            Xác nhận
          </Button>
        )}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {secondsLeft > 0 ? (
          <p className="text-meta text-muted-foreground tabular-nums" aria-live="off">
            Gửi lại mã sau {secondsLeft} giây
          </p>
        ) : (
          <Button type="button" variant="link" size="sm" onClick={resend} disabled={send.isPending}>
            Gửi lại mã
          </Button>
        )}
        <Button type="button" variant="link" size="sm" onClick={changeEmail}>
          Đổi email
        </Button>
      </div>
    </div>
  );
}
