'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, type PayoutAccount, type TingeeCredentialSummary } from '@tickee/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { StatusBadge } from '@/components/tickee/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { isReauthRequired, withReauth } from '@/lib/auth/reauth';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { copyWithToast } from '@/lib/clipboard';
import { setDefaultPayoutAccount, unlinkPayoutAccount } from '@/lib/organizer/api';

import { AccountChooser } from './account-chooser';
import {
  accountLabel,
  applyOverview,
  cardClass,
  CHANGE_KEY,
  PORTAL_UNSELECT_HINT,
  refreshOverview,
  TingeeLink,
} from './shared';

function AccountRow({
  account,
  settingDefault,
  onSetDefault,
  onUnlink,
}: {
  account: PayoutAccount;
  settingDefault: boolean;
  onSetDefault: () => void;
  onUnlink: () => void;
}) {
  const infoId = useId();
  return (
    <li className="flex flex-col gap-3 py-3" data-slot="payout-account-row" data-default={account.isDefault}>
      <div id={infoId} className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-label">{account.bankName}</p>
          {account.isDefault ? <StatusBadge tone="neutral">Mặc định</StatusBadge> : null}
        </div>
        <p className="text-body tabular-nums">•••• {account.accountLast4}</p>
        <p className="text-meta break-words text-muted-foreground uppercase">{account.accountName}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {account.isDefault ? null : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={settingDefault}
            aria-describedby={infoId}
            onClick={onSetDefault}
          >
            Đặt làm mặc định
          </Button>
        )}
        <Button type="button" variant="secondary" size="sm" aria-describedby={infoId} onClick={onUnlink}>
          Hủy liên kết
        </Button>
      </div>
    </li>
  );
}

/**
 * Xác nhận hủy liên kết, nêu hậu quả. Api đòi xác nhận lại danh tính thì `Dialog` này đóng, dialog xác nhận mở; nhập mã
 * đúng thì hủy liên kết chạy tiếp mà không phải bấm lại (lỗi sau đó báo bằng toast vì `Dialog` này đã đóng). Chỉ giữ
 * id: tài khoản và hậu quả đọc từ tổng quan hiện tại, nên đổi mặc định ở tab khác thì câu chữ đổi theo.
 */
function UnlinkDialog({
  orgId,
  accountId,
  accounts,
  onClose,
}: {
  orgId: string;
  accountId: string | null;
  /** Các tài khoản hiện hành, theo thứ tự liên kết. */
  accounts: PayoutAccount[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const account = accounts.find((a) => a.id === accountId) ?? null;
  /** Lần bấm hiện tại đã qua dialog xác nhận lại (`Dialog` này đã đóng): lỗi báo bằng toast thay vì banner. */
  const prompted = useRef(false);
  const unlink = useMutation({
    mutationFn: (target: PayoutAccount) => {
      prompted.current = false;
      return withReauth((reauthToken) => unlinkPayoutAccount(orgId, target.id, reauthToken), {
        onPrompt: () => {
          prompted.current = true;
          onClose();
        },
      });
    },
    onSuccess: async (overview, target) => {
      onClose();
      await applyOverview(queryClient, orgId, overview);
      toast.success(`Đã hủy liên kết ${accountLabel(target)}.`, { description: PORTAL_UNSELECT_HINT });
    },
    onError: (error) => {
      // Đóng dialog xác nhận lại: không hủy gì, không báo lỗi.
      if (isReauthRequired(error)) return;
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.NOT_FOUND)) {
        onClose();
        toast.info('Tài khoản này đã được hủy liên kết.');
        refreshOverview(queryClient, orgId);
      } else if (prompted.current && !handledElsewhere(error)) {
        toast.error(`Chưa hủy liên kết được. ${messageOf(error)}`);
      }
    },
  });
  const failure =
    unlink.error &&
    !prompted.current &&
    !handledElsewhere(unlink.error) &&
    !isReauthRequired(unlink.error) &&
    !hasErrorCode(unlink.error, ErrorCode.NOT_FOUND)
      ? unlink.error
      : null;

  const others = account ? accounts.filter((a) => a.id !== account.id) : [];
  const nextDefault = others[0];
  let consequence: string | null = null;
  if (account && others.length === 0) {
    consequence =
      'BTC sẽ không còn tài khoản nhận tiền nào và chưa bán được Vé có phí cho tới khi liên kết một tài khoản khác.';
  } else if (account?.isDefault && nextDefault) {
    consequence = `${accountLabel(nextDefault)} sẽ thành tài khoản mặc định.`;
  }
  // Chỉ tài khoản mặc định nhận tiền của Đơn mới.
  const orderEffect = account
    ? account.isDefault
      ? `Đơn mới sẽ không nhận tiền vào ${accountLabel(account)} nữa.`
      : `${accountLabel(account)} không phải tài khoản mặc định nên Đơn mới không bị ảnh hưởng.`
    : null;

  const close = () => {
    if (unlink.isPending) return;
    unlink.reset();
    onClose();
  };

  return (
    <ConfirmDialog
      open={account !== null}
      onOpenChange={(open) => !open && close()}
      title="Hủy liên kết tài khoản này?"
      descriptionAsChild
      description={
        <div className="flex flex-col gap-2 break-words" data-slot="unlink-consequences">
          {account ? (
            <>
              <p>{orderEffect} Tickee chỉ ngừng dùng tài khoản này, không xóa gì trên Tingee.</p>
              {consequence ? <p>{consequence}</p> : null}
              <p>{PORTAL_UNSELECT_HINT}</p>
            </>
          ) : null}
        </div>
      }
      confirmLabel="Hủy liên kết"
      cancelLabel="Giữ tài khoản"
      onConfirm={() => account && unlink.mutate(account)}
      pending={unlink.isPending}
      failureTitle="Chưa hủy liên kết được"
      failure={failure && messageOf(failure)}
    />
  );
}

/**
 * Đã liên kết: Client ID (che) + "Đổi key Tingee", danh sách tài khoản (mặc định, đặt mặc định, hủy liên kết), "Thêm
 * tài khoản", URL IPN để dán vào portal Tingee và checklist hai bước.
 */
export function LinkedView({
  orgId,
  credential,
  accounts,
  ipnUrl,
  portalUrl,
  adding,
  onAdd,
  onAddDone,
  onChangeKey,
  changeKeyPending,
}: {
  orgId: string;
  credential: TingeeCredentialSummary | null;
  accounts: PayoutAccount[];
  ipnUrl: string | null;
  portalUrl: string;
  adding: boolean;
  onAdd: () => void;
  onAddDone: () => void;
  onChangeKey: () => void;
  changeKeyPending: boolean;
}) {
  const ipnInputId = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  // Tài khoản đang hỏi hủy không còn trong tổng quan (tab khác đã hủy): đóng `Dialog`.
  useEffect(() => {
    if (unlinkingId !== null && !accounts.some((a) => a.id === unlinkingId)) setUnlinkingId(null);
  }, [unlinkingId, accounts]);

  const makeDefault = useMutation({
    mutationFn: (target: PayoutAccount) =>
      withReauth((reauthToken) => setDefaultPayoutAccount(orgId, target.id, reauthToken)),
    onSuccess: async (overview, target) => {
      await applyOverview(queryClient, orgId, overview);
      toast.success(`${accountLabel(target)} là tài khoản mặc định.`);
    },
    onError: (error) => {
      // Đóng dialog xác nhận lại: không đổi gì, không báo lỗi.
      if (isReauthRequired(error)) return;
      if (handledElsewhere(error)) {
        if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
        return;
      }
      if (hasErrorCode(error, ErrorCode.NOT_FOUND)) toast.info('Tài khoản này không còn được liên kết.');
      else toast.error(messageOf(error));
      refreshOverview(queryClient, orgId);
    },
  });

  return (
    <>
      <section className={cardClass} data-slot="payout-account-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title">Tài khoản nhận tiền</h2>
          <StatusBadge tone="success">Đã liên kết</StatusBadge>
        </div>
        <p className="text-meta text-muted-foreground">
          Đơn mới nhận tiền vào tài khoản mặc định, chuyển thẳng qua Tingee. Tickee không giữ tiền của BTC.
        </p>
        {credential ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground"
            data-slot="tingee-key"
          >
            <span>
              Key Tingee · Client ID <span className="tabular-nums">{credential.clientIdMasked}</span>
            </span>
            <Button type="button" variant="link" size="sm" loading={changeKeyPending} onClick={onChangeKey}>
              {CHANGE_KEY}
            </Button>
          </div>
        ) : null}
        <ul className="flex flex-col divide-y divide-border" data-slot="payout-account-list">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              settingDefault={makeDefault.isPending && makeDefault.variables?.id === account.id}
              onSetDefault={() => {
                if (!makeDefault.isPending) makeDefault.mutate(account);
              }}
              onUnlink={() => setUnlinkingId(account.id)}
            />
          ))}
        </ul>
        {credential && !adding ? (
          <Button type="button" variant="secondary" className="self-start" onClick={onAdd}>
            Thêm tài khoản
          </Button>
        ) : null}
      </section>
      {credential && adding ? (
        <AccountChooser
          key={credential.id}
          orgId={orgId}
          credential={credential}
          portalUrl={portalUrl}
          linkedVas={new Set(accounts.map((a) => a.vaAccountNumber))}
          adding
          onChangeKey={onChangeKey}
          changeKeyPending={changeKeyPending}
          onLinked={onAddDone}
          onClose={onAddDone}
        />
      ) : null}
      <section className={cardClass} data-slot="tingee-setup">
        <div className="flex flex-col gap-1">
          <h2 className="text-title">Cấu hình trên Tingee</h2>
          <p className="text-meta text-muted-foreground">
            Làm hai bước này trên portal Tingee để Tingee báo thanh toán về Tickee.
          </p>
        </div>
        {ipnUrl ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={ipnInputId}>URL IPN</Label>
            <div className="flex items-center gap-2">
              <Input
                id={ipnInputId}
                readOnly
                value={ipnUrl}
                spellCheck={false}
                className="min-w-0 flex-1"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" variant="secondary" onClick={() => void copyWithToast(ipnUrl)}>
                Sao chép
              </Button>
            </div>
          </div>
        ) : null}
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-body" data-slot="tingee-setup-steps">
          <li>
            Mở <TingeeLink href={portalUrl}>portal Tingee</TingeeLink>, vào “Cấu hình thanh toán (Payment Gateway)” và
            dán URL IPN vào ô “Đường dẫn IPN”.
          </li>
          <li>
            Ở “Các Tài khoản cho phép thanh toán”, chọn{' '}
            {accounts.length > 1 ? 'mọi tài khoản đã liên kết' : 'tài khoản'}{' '}
            {accounts.map((account, index) => (
              <span key={account.id}>
                {index > 0 ? ', ' : null}
                <span className="tabular-nums whitespace-nowrap">{accountLabel(account)}</span>
              </span>
            ))}{' '}
            rồi lưu.
          </li>
        </ol>
        <p className="text-meta text-muted-foreground">
          Hủy liên kết tài khoản nào mà không dùng nữa thì bỏ chọn tài khoản đó ở “Các Tài khoản cho phép thanh toán”.
        </p>
      </section>
      <UnlinkDialog orgId={orgId} accountId={unlinkingId} accounts={accounts} onClose={() => setUnlinkingId(null)} />
    </>
  );
}
