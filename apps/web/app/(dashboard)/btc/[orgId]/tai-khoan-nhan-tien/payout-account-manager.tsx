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
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBadge } from '@/components/tickee/status-badge';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
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
} from '@/lib/organizer/api';
import { statusNoticesQueryKey } from '@/lib/reporting/api';
import { cn } from '@/lib/utils';

/*
 * Trang Tài khoản nhận tiền (Story 2.6, FR-5, UX-DR40), chỉ Owner. BTC dùng tài khoản merchant Tingee của chính mình:
 * chưa kết nối (hoặc Owner bấm "Dùng key khác") → hướng dẫn 3 bước + form Client ID / Secret Token; đã kết nối chưa chọn
 * → danh sách tài khoản đọc từ Tingee; đã liên kết → thẻ tài khoản + URL IPN để sao chép + checklist cấu hình portal.
 * Lỗi báo tại chỗ, dữ liệu đã nhập được giữ. Secret Token không bao giờ quay lại trình duyệt.
 */

type Draft = { clientId: string; secretToken: string };
type Field = keyof Draft;
type FieldErrors = Partial<Record<Field, string>>;

const PROVIDER_DOWN = 'Tingee tạm lỗi, thử lại sau ít phút.';
const CREDENTIAL_INVALID = 'Client ID hoặc Secret Token không đúng.';
const CREDENTIAL_REVOKED = 'Client ID hoặc Secret Token không còn đúng. Bấm “Dùng key khác” để nhập key mới.';
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
        toast.info('BTC đã có tài khoản nhận tiền.');
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
  pending,
  onSelect,
}: {
  option: PayoutAccountOption;
  pending: boolean;
  onSelect: () => void;
}) {
  const infoId = useId();
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
      data-slot="payout-account-option"
      data-selectable={option.selectable}
    >
      <div id={infoId} className={cn('min-w-0 flex-1 basis-40', !option.selectable && 'opacity-50')}>
        <p className="text-label">{option.bankName}</p>
        <p className="text-body tabular-nums">•••• {option.accountLast4}</p>
        <p className="text-meta break-words text-muted-foreground uppercase">{option.accountName}</p>
      </div>
      {option.selectable ? (
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

/** Đã kết nối Tingee, chưa chọn tài khoản: danh sách đọc từ Tingee bằng credential hiện hành. */
function AccountChooser({
  orgId,
  credential,
  portalUrl,
  onReplaceKey,
}: {
  orgId: string;
  credential: TingeeCredentialSummary;
  portalUrl: string;
  onReplaceKey: () => void;
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
    onSuccess: (account: PayoutAccount) => {
      queryClient.setQueryData<PayoutAccountOverview>(payoutAccountQueryKey(orgId), (prev) =>
        prev ? { ...prev, account } : prev,
      );
      refreshOverview(queryClient, orgId);
      toast.success('Đã liên kết tài khoản nhận tiền.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)) {
        toast.info('BTC đã có tài khoản nhận tiền.');
        refreshOverview(queryClient, orgId);
      }
    },
  });

  const reload = () => {
    select.reset();
    void options.refetch();
  };
  const otherKeyAction = (
    <Button type="button" variant="link" size="sm" onClick={onReplaceKey}>
      Dùng key khác
    </Button>
  );

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
          ? [CREDENTIAL_REVOKED, otherKeyAction]
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
        description={CREDENTIAL_REVOKED}
        action={otherKeyAction}
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
        <h2 className="text-title">Chọn tài khoản nhận tiền</h2>
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

/** Đã liên kết: thẻ tài khoản + URL IPN để dán vào portal Tingee + checklist hai bước. */
function LinkedView({ account, ipnUrl, portalUrl }: { account: PayoutAccount; ipnUrl: string | null; portalUrl: string }) {
  const ipnInputId = useId();
  return (
    <>
      <section className={cardClass} data-slot="payout-account-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title">Tài khoản nhận tiền</h2>
          <StatusBadge tone="success">Đã liên kết</StatusBadge>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
          <dt className="text-muted-foreground">Ngân hàng</dt>
          <dd className="min-w-0 break-words">{account.bankName}</dd>
          <dt className="text-muted-foreground">Số tài khoản</dt>
          <dd className="tabular-nums">•••• {account.accountLast4}</dd>
          <dt className="text-muted-foreground">Chủ tài khoản</dt>
          <dd className="min-w-0 break-words uppercase">{account.accountName}</dd>
        </dl>
        <p className="text-meta text-muted-foreground">
          Tiền bán vé chuyển thẳng vào tài khoản này qua Tingee. Tickee không giữ tiền của BTC.
        </p>
      </section>
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
            Ở “Các Tài khoản cho phép thanh toán”, chọn tài khoản {account.bankName}{' '}
            <span className="tabular-nums">•••• {account.accountLast4}</span> rồi lưu.
          </li>
        </ol>
      </section>
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
  /** Owner bấm "Dùng key khác" khi đã kết nối nhưng chưa chọn tài khoản. */
  const [replacingKey, setReplacingKey] = useState(false);

  const overview = useQuery({
    queryKey: payoutAccountQueryKey(orgId),
    queryFn: ({ signal }) => fetchPayoutAccount(orgId, signal),
  });

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
    const { credential, account, ipnUrl, tingeePortalUrl } = overview.data;
    if (account) {
      body = <LinkedView account={account} ipnUrl={ipnUrl} portalUrl={tingeePortalUrl} />;
    } else if (credential && !replacingKey) {
      body = (
        <AccountChooser
          key={credential.id}
          orgId={orgId}
          credential={credential}
          portalUrl={tingeePortalUrl}
          onReplaceKey={() => setReplacingKey(true)}
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
