'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, type TingeeKeyPreview } from '@tickee/contracts';
import { Landmark } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/tickee/empty-state';
import { FieldError } from '@/components/tickee/field-error';
import { StatusBanner } from '@/components/tickee/status-banner';
import { TingeeLink } from '@/components/tickee/tingee-link';
import { Button } from '@/components/ui/button';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { isReauthRequired, withReauth } from '@/lib/auth/reauth';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { previewTingeeKeyReplacement, replaceTingeeKey } from '@/lib/organizer/api';
import { cn } from '@/lib/utils';

import {
  accountLabel,
  applyOverview,
  cardClass,
  CHANGE_KEY,
  type Draft,
  KEY_UNCHANGED,
  PROVIDER_DOWN,
  refreshOverview,
  UNAVAILABLE,
  VIETINBANK,
} from './shared';
import { TingeeKeyForm } from './tingee-key-form';

/**
 * Luồng "Đổi key Tingee" sau khi Owner đã xác nhận lại (`reauthToken`): nhập key mới → api đọc danh sách tài khoản của
 * key mới (không lưu gì) → chọn một tài khoản → "Lưu" (api đọc lại danh sách rồi mới lưu). Secret Token chỉ nằm trong
 * state của luồng tới lúc lưu. Mọi lời gọi mang lần xác nhận đang giữ; api báo `REAUTH_REQUIRED` (quá 5 phút) thì dialog
 * xác nhận hiện lại, lần mới được giữ thay và thao tác tự chạy tiếp; đóng dialog thì không làm gì. "Hủy" quay về màn cũ.
 */
export function ReplaceKeyFlow({
  orgId,
  reauthToken,
  portalUrl,
  onDone,
  onCancel,
}: {
  orgId: string;
  /** Lần xác nhận của bước "Đổi key Tingee" (không có thì lời gọi đầu tiên tự mở dialog xác nhận). */
  reauthToken: string | undefined;
  portalUrl: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const held = useRef(reauthToken);
  /** Key đã qua bước xem trước (giữ khi quay lại form bằng "Nhập key khác"). */
  const [key, setKey] = useState<Draft | null>(null);
  /** Danh sách tài khoản của `key`; `null`: đang ở form nhập key. */
  const [preview, setPreview] = useState<TingeeKeyPreview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [missingChoice, setMissingChoice] = useState(false);

  const withHeld = <T,>(call: (token: string | undefined) => Promise<T>) =>
    withReauth((fresh) => {
      if (fresh) held.current = fresh;
      return call(held.current);
    });

  /** Lỗi do nơi khác xử lý, hoặc đã xử lý trong `onError` (dialog xác nhận vừa đóng, BTC chưa từng liên kết). */
  const handled = (error: unknown) =>
    handledElsewhere(error) || isReauthRequired(error) || hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_NOT_LINKED_YET);
  const onFlowError = (error: unknown) => {
    if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
    else if (hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_NOT_LINKED_YET)) {
      // Không xảy ra từ nút của trang này; dữ liệu đã lệch (vd. tab khác): đọc lại và quay về màn cũ.
      refreshOverview(queryClient, orgId);
      onCancel();
    }
  };

  const load = useMutation({
    mutationFn: (next: Draft) => withHeld((token) => previewTingeeKeyReplacement(orgId, next, token)),
    onSuccess: (result, next) => {
      setKey(next);
      setPreview(result);
    },
    onError: onFlowError,
  });

  const save = useMutation({
    mutationFn: ({ next, vaAccountNumber }: { next: Draft; vaAccountNumber: string }) =>
      withHeld((token) => replaceTingeeKey(orgId, { ...next, vaAccountNumber }, token)),
    onSuccess: async (overview) => {
      await applyOverview(queryClient, orgId, overview);
      const account = overview.accounts.find((a) => a.isDefault);
      toast.success('Đã đổi key Tingee.', {
        description: account ? `${accountLabel(account)} là tài khoản mặc định.` : undefined,
      });
      onDone();
    },
    onError: onFlowError,
  });

  const loadFailure = load.error && !handled(load.error) ? load.error : null;
  const saveFailure = save.error && !handled(save.error) ? save.error : null;

  if (!preview || !key) {
    return (
      <TingeeKeyForm
        title={CHANGE_KEY}
        description="Nhập API key mới lấy trên portal Tingee. Tới lúc bạn lưu, key và tài khoản nhận tiền hiện tại vẫn được dùng."
        slot="tingee-replace-key-form"
        submitLabel="Tiếp tục"
        failureTitle="Chưa đọc được tài khoản của key mới"
        initial={key ?? undefined}
        pending={load.isPending}
        failure={loadFailure}
        onSubmit={(next) => load.mutate(next)}
        onEdited={() => load.reset()}
        onCancel={onCancel}
      />
    );
  }

  const options = preview.accounts;
  const chosen = options.find((o) => o.selectable && o.vaAccountNumber === selected)?.vaAccountNumber ?? null;
  const reload = () => {
    save.reset();
    load.mutate(key);
  };
  const otherKey = () => {
    save.reset();
    load.reset();
    setPreview(null);
    // Tài khoản đã chọn thuộc key cũ: danh sách của key sau phải chọn lại từ đầu.
    setSelected(null);
    setMissingChoice(false);
  };
  const submit = () => {
    if (save.isPending) return;
    if (!chosen) {
      setMissingChoice(true);
      return;
    }
    save.mutate({ next: key, vaAccountNumber: chosen });
  };

  let saveBanner: ReactNode = null;
  if (saveFailure) {
    const action = (label: string, onClick: () => void) => (
      <Button type="button" variant="link" size="sm" disabled={save.isPending} onClick={onClick}>
        {label}
      </Button>
    );
    const [description, button] = hasErrorCode(saveFailure, ErrorCode.TINGEE_CREDENTIAL_INVALID)
      ? ['Client ID hoặc Secret Token của key mới không còn đúng.', action('Nhập key khác', otherKey)]
      : hasErrorCode(saveFailure, ErrorCode.PAYOUT_ACCOUNT_UNAVAILABLE)
        ? [UNAVAILABLE, action('Tải lại', reload)]
        : hasErrorCode(saveFailure, ErrorCode.BANK_NOT_SUPPORTED)
          ? [`${VIETINBANK}. Chọn tài khoản ở ngân hàng khác.`, action('Tải lại', reload)]
          : hasErrorCode(saveFailure, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)
            ? [PROVIDER_DOWN, action('Thử lại', submit)]
            : [messageOf(saveFailure), action('Thử lại', submit)];
    saveBanner = (
      <StatusBanner
        tone="danger"
        title="Chưa đổi được key Tingee"
        description={`${description} ${KEY_UNCHANGED}`}
        action={button}
      />
    );
  }

  return (
    <section className={cardClass} data-slot="tingee-replace-key-accounts">
      <div className="flex flex-col gap-1">
        <h2 className="text-title">Chọn tài khoản nhận tiền của key mới</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
          <span>
            Key mới · Client ID <span className="tabular-nums">{preview.clientIdMasked}</span>
          </span>
          {/* Đang lưu: server có thể đang ghi, không cho rời bước này. */}
          <Button type="button" variant="link" size="sm" disabled={save.isPending} onClick={otherKey}>
            Nhập key khác
          </Button>
        </div>
      </div>
      <p className="text-body" data-slot="replace-key-consequences">
        Lưu xong, mọi tài khoản nhận tiền hiện tại bị hủy liên kết và tài khoản bạn chọn thành tài khoản mặc định: Đơn mới
        nhận tiền vào tài khoản này. URL IPN giữ nguyên; nếu key mới thuộc một tài khoản merchant Tingee khác, dán URL IPN
        vào “Cấu hình thanh toán (Payment Gateway)” trên portal Tingee của merchant đó. Thêm tài khoản khác sau bằng “Thêm
        tài khoản”.
      </p>
      {saveBanner}
      {loadFailure ? (
        <StatusBanner
          tone="danger"
          title="Chưa tải được danh sách tài khoản"
          description={
            hasErrorCode(loadFailure, ErrorCode.TINGEE_CREDENTIAL_INVALID)
              ? 'Client ID hoặc Secret Token của key mới không còn đúng.'
              : hasErrorCode(loadFailure, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)
                ? PROVIDER_DOWN
                : messageOf(loadFailure)
          }
          action={
            // Key mới bị từ chối: gửi lại đúng key đó vô ích, phải nhập key khác.
            hasErrorCode(loadFailure, ErrorCode.TINGEE_CREDENTIAL_INVALID) ? (
              <Button type="button" variant="link" size="sm" disabled={save.isPending} onClick={otherKey}>
                Nhập key khác
              </Button>
            ) : (
              <Button type="button" variant="link" size="sm" onClick={reload}>
                Thử lại
              </Button>
            )
          }
        />
      ) : null}
      {options.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Key mới chưa liên kết tài khoản ngân hàng nào trên Tingee."
          description="Liên kết tài khoản ngân hàng của CLB trên portal Tingee rồi bấm “Tải lại”, hoặc nhập key khác."
          action={
            <div className="flex flex-col items-center gap-3">
              <Button type="button" variant="secondary" loading={load.isPending} onClick={reload}>
                Tải lại
              </Button>
              <TingeeLink href={portalUrl}>Mở portal Tingee</TingeeLink>
            </div>
          }
        />
      ) : (
        <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={`${ids}-choice-error`}>
          <legend className="text-label">Tài khoản nhận tiền mặc định mới</legend>
          <ul className="flex flex-col divide-y divide-border" data-slot="replace-key-options">
            {options.map((option) => (
              <li key={option.vaAccountNumber} data-slot="replace-key-option" data-selectable={option.selectable}>
                <label
                  className={cn(
                    'flex min-h-11 min-w-0 items-center gap-3 py-3',
                    option.selectable ? 'cursor-pointer' : 'cursor-not-allowed',
                  )}
                >
                  <input
                    type="radio"
                    name={`${ids}-va`}
                    value={option.vaAccountNumber}
                    checked={chosen === option.vaAccountNumber}
                    disabled={!option.selectable}
                    onChange={() => {
                      setSelected(option.vaAccountNumber);
                      setMissingChoice(false);
                      save.reset();
                    }}
                    className="size-5 shrink-0 cursor-pointer accent-btn-on-light disabled:cursor-not-allowed"
                  />
                  <span className={cn('min-w-0 flex-1', !option.selectable && 'opacity-50')}>
                    <span className="block text-label">{option.bankName}</span>
                    <span className="block text-body tabular-nums">•••• {option.accountLast4}</span>
                    <span className="block text-meta break-words text-muted-foreground uppercase">
                      {option.accountName}
                    </span>
                  </span>
                  {option.selectable ? null : <span className="text-meta text-muted-foreground">{VIETINBANK}</span>}
                </label>
              </li>
            ))}
          </ul>
          <FieldError
            id={`${ids}-choice-error`}
            message={missingChoice && !chosen ? 'Chọn một tài khoản nhận tiền.' : undefined}
          />
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {options.length > 0 ? (
          <Button type="button" loading={save.isPending} onClick={submit}>
            Lưu
          </Button>
        ) : null}
        <Button type="button" variant="link" size="sm" disabled={save.isPending} onClick={onCancel}>
          Hủy
        </Button>
      </div>
    </section>
  );
}
