'use client';

import { useMutation } from '@tanstack/react-query';
import { TOTP_DIGITS } from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { stepUpWithRecoveryCode, stepUpWithTotp, totpErrorMessage, totpRequiredReason } from '@/lib/auth/totp';

import { OtpInput } from './otp-input';

function FieldError({ id, message }: { id: string; message: string | null }) {
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

type StepUpFormProps = {
  onSuccess: () => void;
  onReenroll: () => void;
  onCancel: () => void;
};

function StepUpForm({ onSuccess, onReenroll, onCancel }: StepUpFormProps) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const errorId = `${ids}-error`;
  const recoveryId = `${ids}-recovery`;
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [partial, setPartial] = useState('');
  const [otpKey, setOtpKey] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Lỗi `TOTP_REQUIRED` (chưa đăng ký) do `Providers` chuyển sang màn đăng ký; ở đây chỉ báo lỗi tại ô.
  const onError = (err: unknown) => {
    if (totpRequiredReason(err) !== null) return;
    setError(totpErrorMessage(err));
  };
  const totp = useMutation({
    mutationFn: stepUpWithTotp,
    onSuccess,
    onError: (err) => {
      onError(err);
      setOtpKey((k) => k + 1);
      setPartial('');
    },
  });
  const recovery = useMutation({ mutationFn: stepUpWithRecoveryCode, onSuccess: onReenroll, onError });
  const pending = totp.isPending || recovery.isPending;

  const submitTotp = (code: string) => {
    if (pending) return;
    if (code.length !== TOTP_DIGITS) {
      setError(`Nhập đủ ${TOTP_DIGITS} số.`);
      return;
    }
    setError(null);
    totp.mutate(code);
  };

  const submitRecovery = () => {
    if (pending) return;
    if (recoveryCode.trim() === '') {
      setError('Nhập mã khôi phục.');
      return;
    }
    setError(null);
    recovery.mutate(recoveryCode);
  };

  const switchMode = (next: 'totp' | 'recovery') => {
    setMode(next);
    setError(null);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (mode === 'totp') submitTotp(partial);
        else submitRecovery();
      }}
      className="flex flex-col gap-stack"
    >
      {mode === 'totp' ? (
        <>
          <p id={labelId} className="text-label">
            Mã {TOTP_DIGITS} số trong ứng dụng xác thực
          </p>
          <OtpInput
            key={otpKey}
            length={TOTP_DIGITS}
            idPrefix={`${ids}-otp`}
            labelledBy={labelId}
            describedBy={errorId}
            invalid={error !== null}
            readOnly={totp.isPending}
            autoFocus
            onChange={setPartial}
            onComplete={submitTotp}
          />
        </>
      ) : (
        <>
          <Label htmlFor={recoveryId}>Mã khôi phục</Label>
          <Input
            id={recoveryId}
            name="recoveryCode"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            placeholder="XXXXX-XXXXX"
            className="font-mono"
            value={recoveryCode}
            onChange={(event) => {
              setRecoveryCode(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
          />
          <p className="text-meta text-muted-foreground">
            Dùng mã khôi phục sẽ gỡ xác thực hai lớp hiện tại; bạn cần đăng ký lại ngay sau đó.
          </p>
        </>
      )}
      <FieldError id={errorId} message={error} />
      <DialogFooter>
        <Button type="submit" className="w-full" loading={pending || totp.isSuccess || recovery.isSuccess}>
          Xác nhận
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={onCancel}>
          Hủy
        </Button>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="self-center"
          onClick={() => switchMode(mode === 'totp' ? 'recovery' : 'totp')}
        >
          {mode === 'totp' ? 'Dùng mã khôi phục' : 'Dùng mã trong ứng dụng xác thực'}
        </Button>
      </DialogFooter>
    </form>
  );
}

type StepUpDialogProps = StepUpFormProps & { open: boolean };

/**
 * Dialog step-up TOTP tại chỗ (UX-DR TOTP): mở khi api trả `TOTP_REQUIRED` `step_up`, không chuyển trang để giữ dữ
 * liệu form đang nhập. Mã sai báo tại ô và giữ dialog; đúng thì `onSuccess` (người gọi thử lại thao tác dở). Mã khôi
 * phục đúng → `onReenroll` (TOTP cũ đã bị gỡ).
 */
export function StepUpDialog({ open, onSuccess, onReenroll, onCancel }: StepUpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Xác thực hai lớp</DialogTitle>
          <DialogDescription>Nhập mã trong ứng dụng xác thực để tiếp tục thao tác của bạn.</DialogDescription>
        </DialogHeader>
        {/* Dựng lại form mỗi lần mở để không giữ mã/lỗi của lần trước. */}
        {open ? <StepUpForm onSuccess={onSuccess} onReenroll={onReenroll} onCancel={onCancel} /> : null}
      </DialogContent>
    </Dialog>
  );
}
