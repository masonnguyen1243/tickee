'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, TOTP_DIGITS, type TotpEnrollResponse } from '@tickee/contracts';
import { Copy, Download, OctagonAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { OtpInput } from '@/components/tickee/otp-input';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  groupManualKey,
  recoveryCodesText,
  totpErrorMessage,
  totpRequiredReason,
} from '@/lib/auth/totp';
import { copyWithToast } from '@/lib/clipboard';

/** 409 `VALIDATION_FAILED`: đã đăng ký (lúc bắt đầu) hoặc phiên đăng ký đã hết (lúc xác nhận). */
const isConflict = (error: unknown) =>
  error instanceof ApiError && error.code === ErrorCode.VALIDATION_FAILED && error.status === 409;

function ErrorText({ id, message }: { id: string; message: string | null }) {
  return (
    <p id={id} role="alert" className="flex min-h-0 items-start gap-1.5 text-meta text-danger-text empty:hidden">
      {message ? (
        <>
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}

function QrImage({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(uri, { margin: 1, width: 192, errorCorrectionLevel: 'M' })
      .then((url) => !cancelled && setSrc(url))
      .catch(() => !cancelled && setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return (
    // Nền trắng cố định: ứng dụng xác thực cần QR tương phản kể cả ở dark mode.
    <div className="mx-auto flex size-52 items-center justify-center rounded-md bg-white p-2">
      {src ? (
        <img src={src} width={192} height={192} alt="Mã QR để thêm Tickee vào ứng dụng xác thực" />
      ) : (
        <div aria-hidden="true" className="size-48 animate-pulse rounded-sm bg-muted" />
      )}
    </div>
  );
}

function ScanStep({
  enrollment,
  onConfirmed,
  onRestart,
}: {
  enrollment: TotpEnrollResponse;
  onConfirmed: (codes: string[]) => void;
  onRestart: () => void;
}) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const errorId = `${ids}-error`;
  const [partial, setPartial] = useState('');
  const [otpKey, setOtpKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const confirm = useMutation({
    mutationFn: confirmTotpEnrollment,
    onSuccess: ({ recoveryCodes }) => onConfirmed(recoveryCodes),
    onError: (err) => {
      if (isConflict(err)) return;
      setError(totpErrorMessage(err));
      setOtpKey((k) => k + 1);
      setPartial('');
    },
  });

  const submit = (code: string) => {
    if (confirm.isPending) return;
    if (code.length !== TOTP_DIGITS) {
      setError(`Nhập đủ ${TOTP_DIGITS} số.`);
      return;
    }
    setError(null);
    confirm.mutate(code);
  };

  return (
    <div className="flex flex-col gap-section">
      <section aria-labelledby={`${ids}-scan`} className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card">
        <h2 id={`${ids}-scan`} className="text-title">
          1. Quét mã QR
        </h2>
        <p className="text-body text-muted-foreground">
          Mở ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…) và quét mã này.
        </p>
        <QrImage uri={enrollment.totpUri} />
        <div className="flex flex-col gap-2">
          <p className="text-meta text-muted-foreground">Không quét được? Nhập khóa này vào ứng dụng:</p>
          <p data-testid="manual-key" className="font-mono text-body break-words tabular-nums">
            {groupManualKey(enrollment.manualKey)}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => void copyWithToast(enrollment.manualKey)}
          >
            <Copy aria-hidden="true" />
            Sao chép khóa
          </Button>
        </div>
      </section>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(partial);
        }}
        className="flex flex-col gap-stack"
      >
        <p id={labelId} className="text-label">
          2. Nhập mã {TOTP_DIGITS} số ứng dụng hiện ra
        </p>
        <OtpInput
          key={otpKey}
          length={TOTP_DIGITS}
          idPrefix={`${ids}-otp`}
          labelledBy={labelId}
          describedBy={errorId}
          invalid={error !== null}
          readOnly={confirm.isPending}
          onChange={setPartial}
          onComplete={submit}
        />
        <ErrorText id={errorId} message={error} />
        {isConflict(confirm.error) ? (
          <StatusBanner
            tone="warning"
            title="Phiên đăng ký đã hết"
            description="Hãy tạo mã QR mới rồi quét lại."
            action={
              <Button type="button" variant="link" size="sm" onClick={onRestart}>
                Tạo mã mới
              </Button>
            }
          />
        ) : null}
        <Button type="submit" className="mt-2 w-full" loading={confirm.isPending || confirm.isSuccess}>
          Xác nhận
        </Button>
      </form>
    </div>
  );
}

function RecoveryCodesStep({ codes, email, onContinue }: { codes: string[]; email?: string; onContinue: () => void }) {
  const checkboxId = useId();
  const [saved, setSaved] = useState(false);

  const download = () => {
    const blob = new Blob([recoveryCodesText(codes, email)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tickee-ma-khoi-phuc.txt';
    document.body.append(link);
    link.click();
    link.remove();
    // Thu hồi ngay sau `click()` có thể hủy tải xuống ở Safari/Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="flex flex-col gap-section">
      <StatusBanner tone="success" title="Đã bật xác thực hai lớp" />
      <section aria-labelledby={`${checkboxId}-title`} className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card">
        <h2 id={`${checkboxId}-title`} className="text-title">
          Lưu mã khôi phục
        </h2>
        <p className="text-body text-muted-foreground">
          Dùng một mã khi không mở được ứng dụng xác thực. Mỗi mã dùng một lần. Mã chỉ hiện lần này.
        </p>
        <ol aria-label="Mã khôi phục" className="grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-body tabular-nums">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={download}>
            <Download aria-hidden="true" />
            Tải xuống .txt
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void copyWithToast(codes.join('\n'))}>
            <Copy aria-hidden="true" />
            Sao chép
          </Button>
        </div>
      </section>
      <div className="flex items-center gap-3">
        <Checkbox id={checkboxId} checked={saved} onCheckedChange={(value) => setSaved(value === true)} />
        <Label htmlFor={checkboxId} className="cursor-pointer py-2">
          Tôi đã lưu mã khôi phục
        </Label>
      </div>
      <Button type="button" className="w-full" disabled={!saved} onClick={onContinue}>
        Tiếp tục
      </Button>
    </div>
  );
}

/**
 * Đăng ký TOTP: QR + khóa nhập tay + mã 6 số, rồi 10 mã khôi phục (hiện một lần; tải `.txt`, sao chép, xác nhận đã
 * lưu mới cho tiếp tục về `returnTo`). Chưa đăng nhập → màn đăng nhập; đã đăng ký → về thẳng `returnTo`.
 */
export function EnrollForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Luôn tải lại: `twoFactorEnabled` trong cache có thể đã cũ (vd. vừa dùng mã khôi phục, TOTP đã bị gỡ).
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal), refetchOnMount: 'always' });
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const begin = useMutation({ mutationFn: beginTotpEnrollment });
  const started = useRef(false);

  const fresh = me.isFetchedAfterMount && me.isSuccess;
  const enabled = fresh && me.data.twoFactorEnabled;
  const alreadyEnabled = (enabled || isConflict(begin.error)) && recoveryCodes === null;

  useEffect(() => {
    if (hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED)) router.replace(withReturnTo(LOGIN_PATH, returnTo));
  }, [me.error, returnTo, router]);

  useEffect(() => {
    if (alreadyEnabled) router.replace(returnTo);
  }, [alreadyEnabled, returnTo, router]);

  // Bắt đầu đăng ký một lần khi biết đã đăng nhập và chưa đăng ký (ref chặn StrictMode chạy hai lần).
  useEffect(() => {
    if (!fresh || enabled || started.current) return;
    started.current = true;
    begin.mutate();
  }, [fresh, enabled, begin]);

  const finish = () => {
    // Bỏ các query đang lỗi TOTP_REQUIRED để trang đích tải lại từ đầu với session mới.
    queryClient.removeQueries({ predicate: (query) => totpRequiredReason(query.state.error) !== null });
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    router.replace(returnTo);
  };

  let body: ReactNode;
  if (recoveryCodes) {
    body = <RecoveryCodesStep codes={recoveryCodes} email={me.data?.email} onContinue={finish} />;
  } else if (begin.data) {
    body = (
      <ScanStep
        key={begin.data.manualKey}
        enrollment={begin.data}
        onConfirmed={setRecoveryCodes}
        onRestart={() => begin.mutate()}
      />
    );
  } else if (me.isError && !hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được tài khoản"
        description={me.error instanceof ApiError ? me.error.message : 'Vui lòng thử lại.'}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void me.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else if (begin.isError && !isConflict(begin.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tạo được mã QR"
        description={begin.error instanceof ApiError ? begin.error.message : 'Vui lòng thử lại.'}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => begin.mutate()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-stack">
        <span className="sr-only">Đang tải</span>
        <div aria-hidden="true" className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <h1 className="text-headline">Bật xác thực hai lớp</h1>
        <p className="text-body text-muted-foreground">
          Owner cần xác thực hai lớp để quản lý BTC và tài khoản nhận tiền.
        </p>
      </div>
      {body}
    </div>
  );
}
