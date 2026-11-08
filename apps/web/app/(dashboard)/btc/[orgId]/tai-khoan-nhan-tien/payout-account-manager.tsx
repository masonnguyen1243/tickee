'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ConnectTingeeRequest,
  ErrorCode,
  type PayoutAccount,
  type PayoutAccountOption,
  type PayoutAccountOptions,
  type PayoutAccountOverview,
  type TingeeCredentialSummary,
} from '@tickee/contracts';
import { ExternalLink, Landmark, OctagonAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { isReauthRequired, withReauth } from '@/lib/auth/reauth';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { isTotpRequired } from '@/lib/auth/totp';
import { copyWithToast } from '@/lib/clipboard';
import {
  connectTingee,
  fetchPayoutAccount,
  fetchPayoutAccountOptions,
  payoutAccountOptionsQueryKey,
  payoutAccountQueryKey,
  selectPayoutAccount,
  setDefaultPayoutAccount,
  unlinkPayoutAccount,
} from '@/lib/organizer/api';
import { statusNoticesQueryKey } from '@/lib/reporting/api';
import { cn } from '@/lib/utils';

/*
 * Trang Tài khoản nhận tiền (Story 2.6, FR-5, UX-DR40), chỉ Owner. BTC dùng tài khoản merchant Tingee của chính mình:
 * chưa kết nối (hoặc Owner bấm "Dùng key khác", chỉ có khi BTC chưa từng liên kết tài khoản nào) → hướng dẫn 3 bước +
 * form Client ID / Secret Token; đã kết nối chưa có tài khoản (hoặc đã hủy hết) → danh sách tài khoản đọc từ Tingee; đã
 * liên kết → danh sách tài khoản (badge "Mặc định", "Đặt làm mặc định", "Hủy liên kết" qua `Dialog`), "Thêm tài khoản",
 * URL IPN để sao chép và checklist cấu hình portal. Lỗi báo tại chỗ, dữ liệu đã nhập được giữ. Secret Token không bao
 * giờ quay lại trình duyệt. "Đặt làm mặc định" và "Hủy liên kết" đổi nơi nhận tiền nên api đòi xác nhận lại (Story
 * 2.13-a): gọi qua `withReauth`, gặp `REAUTH_REQUIRED` thì dialog "Xác nhận để tiếp tục" mở, xác nhận xong thao tác tự
 * chạy tiếp; đóng dialog đó thì không làm gì.
 */

type Draft = { clientId: string; secretToken: string };
type Field = keyof Draft;
type FieldErrors = Partial<Record<Field, string>>;

const PROVIDER_DOWN = 'Tingee tạm lỗi, thử lại sau ít phút.';
const CREDENTIAL_INVALID = 'Client ID hoặc Secret Token không đúng.';
const CREDENTIAL_REVOKED = 'Client ID hoặc Secret Token không còn đúng. Bấm “Dùng key khác” để nhập key mới.';
/** Key bị thu hồi khi BTC đã từng liên kết tài khoản: không đổi key ở trang này được (Story 2.13). */
const CREDENTIAL_REVOKED_LOCKED = 'Client ID hoặc Secret Token không còn đúng. Kiểm tra API key trên portal Tingee.';
const ACCOUNT_ALREADY_LINKED = 'Tài khoản này đã được liên kết.';
const PORTAL_UNSELECT_HINT =
  'Không dùng tài khoản này nữa thì bỏ chọn nó trong “Các Tài khoản cho phép thanh toán” trên portal Tingee.';
const UNAVAILABLE = 'Tài khoản này không còn dùng được trên Tingee. Tải lại danh sách rồi chọn tài khoản khác.';
const VIETINBANK = 'Chưa hỗ trợ VietinBank';

const EMPTY_MESSAGES: Readonly<Record<Field, string>> = {
  clientId: 'Nhập Client ID.',
  secretToken: 'Nhập Secret Token.',
};
const INVALID_MESSAGES: Readonly<Record<Field, string>> = {
  clientId: 'Client ID quá dài. Kiểm tra lại rồi dán lại.',
  secretToken: 'Secret Token quá dài. Kiểm tra lại rồi dán lại.',
};

/** Lỗi do nơi khác xử lý: 2FA và đồng ý NĐ 13 (`Providers`), 401 (sang đăng nhập), bị xóa khỏi BTC (`DashboardShell`). */
const handledElsewhere = (error: unknown) =>
  isTotpRequired(error) ||
  hasErrorCode(error, ErrorCode.CONSENT_REQUIRED) ||
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
  hasErrorCode(error, ErrorCode.NOT_A_MEMBER);

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.');

function useGoToLogin() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.replace(withReturnTo(LOGIN_PATH, pathname));
}

/** Đọc lại tổng quan (không gọi Tingee) và dải banner; danh sách tài khoản giữ nguyên cache. */
function refreshOverview(queryClient: QueryClient, orgId: string) {
  void queryClient.invalidateQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
  void queryClient.invalidateQueries({ queryKey: statusNoticesQueryKey(orgId) });
}

/**
 * Tổng quan mới do api trả (hủy liên kết, đặt mặc định) thay cache; dải banner đọc lại. Hủy lần đọc tổng quan đang chạy
 * trước: nó có thể về sau và ghi đè bằng dữ liệu cũ.
 */
async function applyOverview(queryClient: QueryClient, orgId: string, overview: PayoutAccountOverview) {
  await queryClient.cancelQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
  queryClient.setQueryData(payoutAccountQueryKey(orgId), overview);
  void queryClient.invalidateQueries({ queryKey: statusNoticesQueryKey(orgId) });
}

const accountLabel = (account: { bankName: string; accountLast4: string }) =>
  `${account.bankName} •••• ${account.accountLast4}`;

const cardClass = 'flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card';

/** Link sang portal Tingee (tab mới). */
function TingeeLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-brand-text underline underline-offset-4"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
    </a>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
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

/** Hướng dẫn cho BTC chưa có tài khoản Tingee: đăng ký merchant, liên kết ngân hàng, lấy API key. */
function TingeeGuide({ portalUrl }: { portalUrl: string }) {
  return (
    <section className={cardClass} data-slot="tingee-guide">
      <h2 className="text-title">Chưa có tài khoản Tingee?</h2>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-body">
        <li>
          Đăng ký tài khoản merchant trên <TingeeLink href={portalUrl}>portal Tingee</TingeeLink> và hoàn tất xác minh.
        </li>
        <li>Liên kết tài khoản ngân hàng của CLB trên Tingee.</li>
        <li>
          Tạo API key ở mục <TingeeLink href={`${portalUrl}/api-credentials`}>API Credentials</TingeeLink>, cấp quyền
          “Cổng thanh toán” và “Tài khoản &amp; Định danh”, rồi dán Client ID và Secret Token vào form bên dưới.
        </li>
      </ol>
    </section>
  );
}

function ConnectForm({
  orgId,
  replacing,
  onConnected,
  onCancel,
}: {
  orgId: string;
  /** Đã có credential, Owner đang nhập key khác. */
  replacing: boolean;
  onConnected: (options: PayoutAccountOptions) => void;
  onCancel?: () => void;
}) {
  const ids = useId();
  const id = (field: Field) => `${ids}-${field}`;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [draft, setDraft] = useState<Draft>({ clientId: '', secretToken: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  const connect = useMutation({
    mutationFn: (body: ConnectTingeeRequest) => connectTingee(orgId, body),
    // Không toast: trang chuyển ngay sang danh sách tài khoản (toast ở 375px còn đè lên nút "Dùng tài khoản này").
    onSuccess: (options) => onConnected(options),
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)) {
        // Tab khác vừa liên kết tài khoản: từ đó không nhập key khác ở đây được nữa.
        toast.info('BTC đã liên kết tài khoản nhận tiền nên không đổi key ở đây được.');
        refreshOverview(queryClient, orgId);
      }
    },
  });

  const submit = () => {
    if (connect.isPending) return;
    const parsed = ConnectTingeeRequest.safeParse(draft);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        if (next[field]) continue;
        next[field] = draft[field].trim() === '' ? EMPTY_MESSAGES[field] : INVALID_MESSAGES[field];
      }
      setErrors(next);
      connect.reset();
      return;
    }
    setErrors({});
    connect.mutate(parsed.data);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const failure =
    connect.error &&
    !handledElsewhere(connect.error) &&
    !hasErrorCode(connect.error, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)
      ? connect.error
      : null;
  const credentialInvalid = hasErrorCode(failure, ErrorCode.TINGEE_CREDENTIAL_INVALID);
  const providerDown = hasErrorCode(failure, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);

  const change = (field: Field, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    // Đã sửa key: bỏ câu "không đúng" của lần gửi trước.
    if (credentialInvalid) connect.reset();
  };

  const input = (field: Field) => ({
    id: id(field),
    name: field,
    value: draft[field],
    // Client ID + ô password trông như form đăng nhập: chặn trình duyệt và trình quản lý mật khẩu lưu/điền Secret Token
    // như mật khẩu Tickee (`off` bị bỏ qua ở ô password).
    autoComplete: field === 'secretToken' ? 'new-password' : 'off',
    'data-1p-ignore': true,
    'data-lpignore': 'true',
    'data-bwignore': true,
    spellCheck: false,
    autoCapitalize: 'none',
    'aria-invalid': errors[field] || credentialInvalid ? true : undefined,
    'aria-describedby': `${id(field)}-hint ${id(field)}-error`,
    onChange: (event: { target: { value: string } }) => change(field, event.target.value),
  });

  return (
    <section className={cardClass}>
      <h2 className="text-title">{replacing ? 'Nhập key Tingee khác' : 'Kết nối tài khoản Tingee'}</h2>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-stack" data-slot="tingee-connect-form">
        <div className="flex flex-col gap-2">
          <Label htmlFor={id('clientId')}>Client ID</Label>
          <Input {...input('clientId')} />
          <p id={`${id('clientId')}-hint`} className="text-meta text-muted-foreground">
            Lấy ở mục API Credentials trên portal Tingee.
          </p>
          <FieldError id={`${id('clientId')}-error`} message={errors.clientId} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={id('secretToken')}>Secret Token</Label>
          <Input {...input('secretToken')} type="password" />
          <p id={`${id('secretToken')}-hint`} className="text-meta text-muted-foreground">
            Tickee mã hóa Secret Token khi lưu và không bao giờ hiển thị lại.
          </p>
          <FieldError id={`${id('secretToken')}-error`} message={errors.secretToken} />
        </div>
        {failure ? (
          <StatusBanner
            tone="danger"
            title="Chưa kết nối được Tingee"
            description={credentialInvalid ? CREDENTIAL_INVALID : providerDown ? PROVIDER_DOWN : messageOf(failure)}
            action={
              credentialInvalid ? undefined : (
                <Button type="button" variant="link" size="sm" onClick={submit}>
                  Thử lại
                </Button>
              )
            }
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={connect.isPending}>
            Kết nối
          </Button>
          {onCancel ? (
            <Button type="button" variant="link" size="sm" onClick={onCancel}>
              Hủy
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

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

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải danh sách tài khoản</span>
      <div aria-hidden="true" className="h-32 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

/**
 * Danh sách tài khoản đọc từ Tingee bằng credential hiện hành: chọn tài khoản đầu tiên (BTC chưa có tài khoản nào) hoặc
 * thêm tài khoản (`adding`). Tài khoản đã liên kết hiện "Đã liên kết" thay cho nút.
 */
function AccountChooser({
  orgId,
  credential,
  portalUrl,
  linkedVas,
  adding,
  onReplaceKey,
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
  // Key bị thu hồi trên Tingee: đổi key được thì mở form, không thì chỉ đường sang portal.
  const revokedDescription = onReplaceKey ? CREDENTIAL_REVOKED : CREDENTIAL_REVOKED_LOCKED;
  const revokedAction = otherKeyAction ?? <TingeeLink href={portalUrl}>Mở portal Tingee</TingeeLink>;

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
          {otherKeyAction}
        </div>
      </div>
      {selectBanner}
      {optionsBanner}
      {body}
    </section>
  );
}

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
    <Dialog open={account !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hủy liên kết tài khoản này?</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-2 break-words" data-slot="unlink-consequences">
              {account ? (
                <>
                  <p>{orderEffect} Tickee chỉ ngừng dùng tài khoản này, không xóa gì trên Tingee.</p>
                  {consequence ? <p>{consequence}</p> : null}
                  <p>{PORTAL_UNSELECT_HINT}</p>
                </>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <StatusBanner tone="danger" title="Chưa hủy liên kết được" description={messageOf(failure)} />
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            loading={unlink.isPending}
            onClick={() => account && unlink.mutate(account)}
          >
            Hủy liên kết
          </Button>
          <Button type="button" variant="secondary" className="w-full" onClick={close}>
            Giữ tài khoản
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Đã liên kết: danh sách tài khoản (mặc định, đặt mặc định, hủy liên kết), "Thêm tài khoản", URL IPN để dán vào portal
 * Tingee và checklist hai bước.
 */
function LinkedView({
  orgId,
  credential,
  accounts,
  ipnUrl,
  portalUrl,
  adding,
  onAdd,
  onAddDone,
}: {
  orgId: string;
  credential: TingeeCredentialSummary | null;
  accounts: PayoutAccount[];
  ipnUrl: string | null;
  portalUrl: string;
  adding: boolean;
  onAdd: () => void;
  onAddDone: () => void;
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

function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export function PayoutAccountManager() {
  const organization = useCurrentOrganization();
  const orgId = organization.id;
  const queryClient = useQueryClient();
  /** Owner bấm "Dùng key khác" khi đã kết nối nhưng BTC chưa từng liên kết tài khoản nào. */
  const [replacingKey, setReplacingKey] = useState(false);
  /** Owner bấm "Thêm tài khoản" khi BTC đã có tài khoản nhận tiền. */
  const [adding, setAdding] = useState(false);

  const overview = useQuery({
    queryKey: payoutAccountQueryKey(orgId),
    queryFn: ({ signal }) => fetchPayoutAccount(orgId, signal),
  });
  // Hết tài khoản (hủy hết, kể cả ở tab khác): lần sau có tài khoản thì không tự mở danh sách thêm tài khoản.
  const noAccounts = overview.data?.accounts.length === 0;
  useEffect(() => {
    if (noAccounts) setAdding(false);
  }, [noAccounts]);

  const onConnected = (options: PayoutAccountOptions) => {
    // Danh sách vừa đọc từ Tingee dùng luôn, không gọi Tingee lần nữa; tổng quan đọc lại để có URL IPN.
    queryClient.setQueryData(payoutAccountOptionsQueryKey(orgId, options.credential.id), options);
    queryClient.setQueryData<PayoutAccountOverview>(payoutAccountQueryKey(orgId), (prev) =>
      prev ? { ...prev, credential: options.credential } : prev,
    );
    refreshOverview(queryClient, orgId);
    setReplacingKey(false);
  };

  let body: ReactNode;
  if (overview.isError && !overview.data) {
    body = handledElsewhere(overview.error) ? (
      <PageSkeleton />
    ) : (
      <StatusBanner
        tone="danger"
        title="Chưa tải được tài khoản nhận tiền"
        description={messageOf(overview.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void overview.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else if (!overview.data) {
    body = <PageSkeleton />;
  } else {
    const { credential, accounts, ipnUrl, tingeePortalUrl, canReplaceKey } = overview.data;
    if (accounts.length > 0) {
      body = (
        <LinkedView
          orgId={orgId}
          credential={credential}
          accounts={accounts}
          ipnUrl={ipnUrl}
          portalUrl={tingeePortalUrl}
          adding={adding}
          onAdd={() => setAdding(true)}
          onAddDone={() => setAdding(false)}
        />
      );
    } else if (credential && !(replacingKey && canReplaceKey)) {
      // Chưa có tài khoản (hoặc đã hủy hết): chọn tài khoản. "Dùng key khác" chỉ khi BTC chưa từng liên kết tài khoản.
      body = (
        <AccountChooser
          key={credential.id}
          orgId={orgId}
          credential={credential}
          portalUrl={tingeePortalUrl}
          linkedVas={new Set()}
          adding={false}
          onReplaceKey={canReplaceKey ? () => setReplacingKey(true) : undefined}
          onLinked={() => setAdding(false)}
        />
      );
    } else {
      body = (
        <>
          <TingeeGuide portalUrl={tingeePortalUrl} />
          <ConnectForm
            orgId={orgId}
            replacing={credential !== null}
            onConnected={onConnected}
            onCancel={credential ? () => setReplacingKey(false) : undefined}
          />
        </>
      );
    }
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <PageHeading eyebrow={organization.name} title="Tài khoản nhận tiền" />
        <p className="text-body text-muted-foreground">
          Tài khoản ngân hàng nhận tiền bán Vé có phí, chọn từ tài khoản Tingee của BTC. Chưa liên kết thì chưa bán được
          Vé có phí.
        </p>
      </div>
      {body}
    </div>
  );
}
