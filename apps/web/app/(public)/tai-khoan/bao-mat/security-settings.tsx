'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCOUNT_SECURITY_PATH, ErrorCode, type Me } from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { CONSENT_PATH, LOGIN_PATH, TOTP_ENROLL_PATH, withReturnTo } from '@/lib/auth/return-to';
import {
  disableTotp,
  disableTotpRequest,
  isTotpNotEnabled,
  isTotpRequired,
  totpErrorMessage,
} from '@/lib/auth/totp';

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

/**
 * Ô mã TOTP hoặc mã khôi phục để tắt 2FA. Đặt xử lý kết quả trên `useMutation`: nếu session chưa qua lớp hai, api trả
 * `TOTP_REQUIRED`, `Providers` mở dialog "Xác thực hai lớp" rồi gửi lại đúng mutation này.
 */
function DisableForm({ onDisabled, onClose }: { onDisabled: () => void; onClose: () => void }) {
  const ids = useId();
  const inputId = `${ids}-code`;
  const errorId = `${ids}-error`;
  const hintId = `${ids}-hint`;
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const disable = useMutation({
    mutationFn: disableTotp,
    onSuccess: onDisabled,
    onError: (err) => {
      if (isTotpRequired(err)) return;
      if (isTotpNotEnabled(err)) {
        // Đã tắt ở nơi khác: đóng và tải lại trạng thái.
        void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
        onClose();
        return;
      }
      setError(totpErrorMessage(err));
    },
  });

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (disable.isPending) return;
        if (value.trim() === '') {
          setError('Nhập mã trong ứng dụng xác thực hoặc một mã khôi phục.');
          return;
        }
        setError(null);
        disable.mutate(disableTotpRequest(value));
      }}
      className="flex flex-col gap-stack"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={inputId}>Mã xác thực hoặc mã khôi phục</Label>
        <Input
          id={inputId}
          name="code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          placeholder="123456 hoặc XXXXX-XXXXX"
          className="font-mono"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${hintId} ${errorId}`}
        />
        <p id={hintId} className="text-meta text-muted-foreground">
          Nhập mã 6 số trong ứng dụng xác thực, hoặc một mã khôi phục chưa dùng.
        </p>
      </div>
      <FieldError id={errorId} message={error} />
      <DialogFooter>
        <Button type="submit" variant="destructive" className="w-full" loading={disable.isPending || disable.isSuccess}>
          Tắt xác thực hai lớp
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={onClose}>
          Hủy
        </Button>
      </DialogFooter>
    </form>
  );
}

function DisableDialog({
  open,
  onOpenChange,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tắt xác thực hai lớp?</DialogTitle>
          <DialogDescription>Tài khoản chỉ còn được bảo vệ bằng email.</DialogDescription>
        </DialogHeader>
        {/* Dựng lại form mỗi lần mở để không giữ mã/lỗi của lần trước. */}
        {open ? <DisableForm onDisabled={onDisabled} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function TwoFactorSection({ enabled, onDisable }: { enabled: boolean; onDisable: () => void }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={titleId} className="text-title">
          Xác thực hai lớp
        </h2>
        <StatusBadge tone={enabled ? 'success' : 'neutral'}>{enabled ? 'Đang bật' : 'Chưa bật'}</StatusBadge>
      </div>
      <p className="text-body text-muted-foreground">
        {enabled
          ? 'Mỗi lần đăng nhập, Tickee hỏi thêm mã trong ứng dụng xác thực. Mất thiết bị thì dùng một mã khôi phục.'
          : 'Ngoài email, mỗi lần đăng nhập Tickee sẽ hỏi thêm mã trong ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…).'}
      </p>
      {enabled ? (
        <Button type="button" variant="secondary" className="self-start" onClick={onDisable}>
          Tắt
        </Button>
      ) : (
        <Button asChild className="self-start">
          <Link href={TOTP_ENROLL_PATH}>Bật xác thực hai lớp</Link>
        </Button>
      )}
    </section>
  );
}

/**
 * Trang "Bảo mật tài khoản" (mọi vai): trạng thái 2FA; chưa bật → màn đăng ký (`/bao-mat/totp`, xong quay về đây);
 * đã bật → "Tắt" mở `Dialog` nêu hậu quả kèm ô mã TOTP hoặc mã khôi phục. `recoveryUsed`: vừa qua lớp hai bằng mã
 * khôi phục (2FA cũ đã bị gỡ) → banner warning gợi ý bật lại. Chưa đăng nhập → màn đăng nhập; chưa đồng ý → màn đồng ý.
 */
export function SecuritySettings({ recoveryUsed }: { recoveryUsed: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Luôn tải lại: `twoFactorEnabled` trong cache có thể đã cũ (vừa bật, vừa dùng mã khôi phục).
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal), refetchOnMount: 'always' });
  const [disableOpen, setDisableOpen] = useState(false);

  useEffect(() => {
    if (hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED)) router.replace(withReturnTo(LOGIN_PATH, ACCOUNT_SECURITY_PATH));
    else if (me.data && !me.data.consentedAt) router.replace(withReturnTo(CONSENT_PATH, ACCOUNT_SECURITY_PATH));
  }, [me.error, me.data, router]);

  const onDisabled = () => {
    setDisableOpen(false);
    queryClient.setQueryData<Me>(ME_QUERY_KEY, (prev) => (prev ? { ...prev, twoFactorEnabled: false } : prev));
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    toast.success('Đã tắt xác thực hai lớp');
  };

  let body;
  if (me.data?.consentedAt) {
    const enabled = me.data.twoFactorEnabled;
    body = (
      <>
        {recoveryUsed && !enabled ? (
          <StatusBanner tone="warning" title="Xác thực hai lớp cũ đã được gỡ. Bật lại với thiết bị mới." />
        ) : null}
        <TwoFactorSection enabled={enabled} onDisable={() => setDisableOpen(true)} />
        <DisableDialog open={disableOpen && enabled} onOpenChange={setDisableOpen} onDisabled={onDisabled} />
      </>
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
  } else {
    body = (
      <div role="status" aria-busy="true" className="flex flex-col gap-stack">
        <span className="sr-only">Đang tải</span>
        <div aria-hidden="true" className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <h1 className="text-headline">Bảo mật tài khoản</h1>
        <p className="text-body break-words text-muted-foreground">
          {me.data ? `Áp dụng cho ${me.data.email} ở mọi vai.` : 'Áp dụng cho tài khoản của bạn ở mọi vai.'}
        </p>
      </div>
      {body}
    </div>
  );
}
