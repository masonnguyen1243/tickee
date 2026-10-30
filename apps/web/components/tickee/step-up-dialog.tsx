'use client';

import { useMutation } from '@tanstack/react-query';
import { TOTP_DIGITS } from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signOut } from '@/lib/auth/api';
import { isTotpNotEnabled, stepUpWithRecoveryCode, stepUpWithTotp, totpErrorMessage } from '@/lib/auth/totp';

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
  /** Qua lớp hai bằng mã TOTP (hoặc tài khoản đã không còn bật 2FA): người gọi thử lại thao tác dở. */
  onSuccess: () => void;
  /** Qua lớp hai bằng mã khôi phục: 2FA cũ đã bị gỡ. */
  onRecovered: () => void;
  /** Đã đăng xuất (session ở server đã hủy). */
  onSignedOut: () => void;
};

function StepUpForm({ onSuccess, onRecovered, onSignedOut }: StepUpFormProps) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const errorId = `${ids}-error`;
  const recoveryId = `${ids}-recovery`;
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [partial, setPartial] = useState('');
  const [otpKey, setOtpKey] = useState(0);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 409: tài khoản đã tắt 2FA ở nơi khác, không còn gì phải nhập → coi như đã qua (thao tác dở được thử lại).
  const onError = (err: unknown) => {
    if (isTotpNotEnabled(err)) {
      onSuccess();
      return;
    }
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
  const recovery = useMutation({ mutationFn: stepUpWithRecoveryCode, onSuccess: onRecovered, onError });
  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: onSignedOut,
    onError: () => setError('Chưa đăng xuất được. Vui lòng thử lại.'),
  });
  const pending = totp.isPending || recovery.isPending || logout.isPending;

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
            Dùng mã khôi phục sẽ gỡ xác thực hai lớp hiện tại; sau đó bạn bật lại với thiết bị mới.
          </p>
        </>
      )}
      <FieldError id={errorId} message={error} />
      <DialogFooter>
        <Button
          type="submit"
          className="w-full"
          loading={totp.isPending || recovery.isPending || totp.isSuccess || recovery.isSuccess}
        >
          Xác nhận
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          loading={logout.isPending || logout.isSuccess}
          onClick={() => !pending && logout.mutate()}
        >
          Đăng xuất
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
 * Dialog "Xác thực hai lớp" tại chỗ (UX-DR42): mở khi api trả `TOTP_REQUIRED` ở bất kỳ trang nào, không chuyển trang
 * để giữ dữ liệu form đang nhập. Mã sai báo tại ô và giữ dialog; đúng thì `onSuccess` (người gọi thử lại thao tác dở).
 * Mã khôi phục đúng → `onRecovered` (TOTP cũ đã bị gỡ). Không đóng được bằng Esc/lớp phủ: chưa qua lớp hai thì mọi
 * thao tác đều bị chặn, lối ra duy nhất ngoài nhập mã là "Đăng xuất".
 */
export function StepUpDialog({ open, onSuccess, onRecovered, onSignedOut }: StepUpDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-0">
          <DialogTitle>Xác thực hai lớp</DialogTitle>
          <DialogDescription>Nhập mã trong ứng dụng xác thực để tiếp tục dùng tài khoản.</DialogDescription>
        </DialogHeader>
        {/* Dựng lại form mỗi lần mở để không giữ mã/lỗi của lần trước. */}
        {open ? <StepUpForm onSuccess={onSuccess} onRecovered={onRecovered} onSignedOut={onSignedOut} /> : null}
      </DialogContent>
    </Dialog>
  );
}
