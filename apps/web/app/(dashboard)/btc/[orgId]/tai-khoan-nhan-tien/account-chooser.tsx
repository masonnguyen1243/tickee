'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ErrorCode,
  type PayoutAccount,
  type PayoutAccountOption,
  type PayoutAccountOverview,
  type TingeeCredentialSummary,
} from '@tickee/contracts';
import { Landmark } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/tickee/empty-state';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { TingeeLink } from '@/components/tickee/tingee-link';
import { Button } from '@/components/ui/button';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  fetchPayoutAccountOptions,
  payoutAccountOptionsQueryKey,
  payoutAccountQueryKey,
  selectPayoutAccount,
} from '@/lib/organizer/api';
import { cn } from '@/lib/utils';

import {
  ACCOUNT_ALREADY_LINKED,
  cardClass,
  CHANGE_KEY,
  CREDENTIAL_REVOKED,
  CREDENTIAL_REVOKED_LOCKED,
  ListSkeleton,
  PROVIDER_DOWN,
  refreshOverview,
  UNAVAILABLE,
  VIETINBANK,
} from './shared';

function OptionRow({
  option,
  linked,
  pending,
  onSelect,
}: {
  option: PayoutAccountOption;
  /** VA đang là tài khoản nhận tiền hiện hành (theo tổng quan, không theo cờ trong cache danh sách). */
  linked: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  const infoId = useId();
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
      data-slot="payout-account-option"
      data-selectable={option.selectable}
      data-linked={linked}
    >
      <div id={infoId} className={cn('min-w-0 flex-1 basis-40', !option.selectable && 'opacity-50')}>
        <p className="text-label">{option.bankName}</p>
        <p className="text-body tabular-nums">•••• {option.accountLast4}</p>
        <p className="text-meta break-words text-muted-foreground uppercase">{option.accountName}</p>
      </div>
      {linked ? (
        <StatusBadge tone="success">Đã liên kết</StatusBadge>
      ) : option.selectable ? (
        <Button type="button" variant="secondary" size="sm" loading={pending} aria-describedby={infoId} onClick={onSelect}>
          Dùng tài khoản này
        </Button>
      ) : (
        <span className="text-meta text-muted-foreground">{VIETINBANK}</span>
      )}
    </li>
  );
}

/**
 * Danh sách tài khoản đọc từ Tingee bằng credential hiện hành: chọn tài khoản đầu tiên (BTC chưa có tài khoản nào) hoặc
 * thêm tài khoản (`adding`). Tài khoản đã liên kết hiện "Đã liên kết" thay cho nút.
 */
export function AccountChooser({
  orgId,
  credential,
  portalUrl,
  linkedVas,
  adding,
  onReplaceKey,
  onChangeKey,
  changeKeyPending = false,
  onLinked,
  onClose,
}: {
  orgId: string;
  credential: TingeeCredentialSummary;
  portalUrl: string;
  /**
   * VA của các tài khoản hiện hành trong tổng quan. "Đã liên kết" tính từ đây lúc render, không từ cờ `linked` của danh
   * sách đang cache (cũ đi khi tab khác hủy liên kết).
   */
  linkedVas: ReadonlySet<string>;
  /** BTC đã có tài khoản, Owner đang thêm tài khoản khác. */
  adding: boolean;
  /** "Dùng key khác": chỉ có khi BTC chưa từng liên kết tài khoản nào (`canReplaceKey`). */
  onReplaceKey?: () => void;
  /** "Đổi key Tingee" (có xác nhận lại): khi BTC đã từng liên kết tài khoản. */
  onChangeKey?: () => void;
  /** Đang kiểm lần xác nhận lại của "Đổi key Tingee". */
  changeKeyPending?: boolean;
  onLinked: () => void;
  /** Đóng danh sách khi đang thêm tài khoản. */
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  // Mỗi lần tải là một lời gọi Tingee: chỉ tải khi mở danh sách hoặc Owner bấm "Thử lại"/"Tải lại" — không tự thử lại,
  // không tải lại khi quay lại tab hay có mạng lại. Cache theo credential: đổi key ở tab khác thì không dùng danh sách cũ.
  const options = useQuery({
    queryKey: payoutAccountOptionsQueryKey(orgId, credential.id),
    queryFn: ({ signal }) => fetchPayoutAccountOptions(orgId, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const select = useMutation({
    mutationFn: (vaAccountNumber: string) => selectPayoutAccount(orgId, { vaAccountNumber }),
    onSuccess: async (account: PayoutAccount) => {
      // Lần đọc tổng quan đang chạy có thể về sau và ghi đè tài khoản vừa thêm.
      await queryClient.cancelQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
      queryClient.setQueryData<PayoutAccountOverview>(payoutAccountQueryKey(orgId), (prev) =>
        prev
          ? { ...prev, accounts: [...prev.accounts.filter((a) => a.id !== account.id), account], canReplaceKey: false }
          : prev,
      );
      refreshOverview(queryClient, orgId);
      toast.success('Đã liên kết tài khoản nhận tiền.');
      onLinked();
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)) {
        // Tab khác vừa liên kết đúng tài khoản này: tổng quan đọc lại sẽ có nó.
        toast.info(ACCOUNT_ALREADY_LINKED);
        refreshOverview(queryClient, orgId);
      }
    },
  });

  const reload = () => {
    select.reset();
    void options.refetch();
  };
  const otherKeyAction = onReplaceKey ? (
    <Button type="button" variant="link" size="sm" onClick={onReplaceKey}>
      Dùng key khác
    </Button>
  ) : null;
  const changeKeyAction = onChangeKey ? (
    <Button type="button" variant="link" size="sm" loading={changeKeyPending} onClick={onChangeKey}>
      {CHANGE_KEY}
    </Button>
  ) : null;
  // Key bị thu hồi trên Tingee: "Dùng key khác" (chưa từng liên kết) hoặc "Đổi key Tingee" mở form nhập key mới.
  const revokedDescription = onReplaceKey ? CREDENTIAL_REVOKED : CREDENTIAL_REVOKED_LOCKED;
  const revokedAction = otherKeyAction ?? changeKeyAction ?? <TingeeLink href={portalUrl}>Mở portal Tingee</TingeeLink>;

  const selectFailure =
    select.error &&
    !handledElsewhere(select.error) &&
    !hasErrorCode(select.error, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)
      ? select.error
      : null;
  let selectBanner: ReactNode = null;
  if (selectFailure) {
    const retry = (
      <Button type="button" variant="link" size="sm" onClick={() => select.mutate(select.variables!)}>
        Thử lại
      </Button>
    );
    const reloadAction = (
      <Button type="button" variant="link" size="sm" onClick={reload}>
        Tải lại
      </Button>
    );
    const [description, action] = hasErrorCode(selectFailure, ErrorCode.PAYOUT_ACCOUNT_UNAVAILABLE)
      ? [UNAVAILABLE, reloadAction]
      : hasErrorCode(selectFailure, ErrorCode.BANK_NOT_SUPPORTED)
        ? [`${VIETINBANK}. Chọn tài khoản ở ngân hàng khác.`, reloadAction]
        : hasErrorCode(selectFailure, ErrorCode.TINGEE_CREDENTIAL_INVALID)
          ? [revokedDescription, revokedAction]
          : hasErrorCode(selectFailure, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)
            ? [PROVIDER_DOWN, retry]
            : [messageOf(selectFailure), retry];
    selectBanner = (
      <StatusBanner tone="danger" title="Chưa dùng được tài khoản này" description={description} action={action} />
    );
  }

  // Lỗi tải danh sách, kể cả khi "Tải lại" thất bại mà vẫn còn danh sách cũ (hiện banner phía trên danh sách cũ).
  const optionsError = options.isError && !handledElsewhere(options.error) ? options.error : null;
  let optionsBanner: ReactNode = null;
  if (optionsError) {
    optionsBanner = hasErrorCode(optionsError, ErrorCode.TINGEE_CREDENTIAL_INVALID) ? (
      <StatusBanner
        tone="danger"
        title="Key Tingee không còn dùng được"
        description={revokedDescription}
        action={revokedAction}
      />
    ) : (
      <StatusBanner
        tone="danger"
        title="Chưa tải được danh sách tài khoản"
        description={
          hasErrorCode(optionsError, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE) ? PROVIDER_DOWN : messageOf(optionsError)
        }
        action={
          <Button type="button" variant="link" size="sm" onClick={reload}>
            Thử lại
          </Button>
        }
      />
    );
  }

  let body: ReactNode;
  if (!options.data) {
    body = optionsBanner ? null : <ListSkeleton />;
  } else if (options.data.accounts.length === 0) {
    body = (
      <EmptyState
        icon={Landmark}
        title="Tài khoản Tingee của bạn chưa liên kết tài khoản ngân hàng nào."
        description="Liên kết tài khoản ngân hàng của CLB trên portal Tingee rồi bấm “Tải lại”."
        action={
          <div className="flex flex-col items-center gap-3">
            <Button type="button" variant="secondary" loading={options.isFetching} onClick={reload}>
              Tải lại
            </Button>
            <TingeeLink href={portalUrl}>Mở portal Tingee</TingeeLink>
          </div>
        }
      />
    );
  } else {
    body = (
      <>
        <ul className="flex flex-col divide-y divide-border" data-slot="payout-account-options">
          {options.data.accounts.map((option) => (
            <OptionRow
              key={option.vaAccountNumber}
              option={option}
              linked={linkedVas.has(option.vaAccountNumber)}
              pending={select.isPending && select.variables === option.vaAccountNumber}
              onSelect={() => {
                if (!select.isPending) select.mutate(option.vaAccountNumber);
              }}
            />
          ))}
        </ul>
        {/* Vừa liên kết thêm ngân hàng trên Tingee: tải lại danh sách mà không phải tải lại cả trang. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-slot="payout-account-options-footer">
          <Button type="button" variant="secondary" size="sm" loading={options.isFetching} onClick={reload}>
            Tải lại
          </Button>
          <TingeeLink href={portalUrl}>Mở portal Tingee</TingeeLink>
        </div>
      </>
    );
  }

  return (
    <section className={cardClass} data-slot="payout-account-chooser">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="text-title">{adding ? 'Thêm tài khoản nhận tiền' : 'Chọn tài khoản nhận tiền'}</h2>
          {onClose ? (
            <Button type="button" variant="link" size="sm" onClick={onClose}>
              Đóng
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
          <span>
            Đã kết nối Tingee · Client ID <span className="tabular-nums">{credential.clientIdMasked}</span>
          </span>
          {/* Đang thêm tài khoản: "Đổi key Tingee" đã có ở thẻ tài khoản nhận tiền phía trên. */}
          {otherKeyAction ?? (adding ? null : changeKeyAction)}
        </div>
      </div>
      {selectBanner}
      {optionsBanner}
      {body}
    </section>
  );
}
