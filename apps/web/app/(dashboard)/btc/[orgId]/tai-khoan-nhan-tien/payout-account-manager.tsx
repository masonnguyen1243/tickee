'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  BANK_OTP_PATTERN,
  ErrorCode,
  LinkPayoutAccountRequest,
  PayoutAccountStatus,
  payoutBankName,
  SUPPORTED_PAYOUT_BANKS,
  type PayoutAccount,
  type PayoutAccountOverview,
} from '@tickee/contracts';
import { ChevronDown, OctagonAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
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
import { confirmPayoutOtp, fetchPayoutAccount, linkPayoutAccount, payoutAccountQueryKey } from '@/lib/organizer/api';
import { statusNoticesQueryKey } from '@/lib/reporting/api';
import { cn } from '@/lib/utils';

/*
 * Trang Tài khoản nhận tiền (Story 2.6, FR-5, UX-DR40), chỉ Owner. Chưa liên kết → form; đang chờ OTP ngân hàng →
 * `status-badge` "Đang liên kết" + ô OTP (rời trang rồi quay lại vẫn nhập tiếp); đã liên kết → thẻ tài khoản. Lỗi báo tại
 * ô hoặc tại form, có "Thử lại", dữ liệu đã nhập được giữ (trừ CCCD khi OTP hết hạn và phải gửi lại).
 */

type Draft = {
  bankBin: string;
  accountNumber: string;
  accountName: string;
  identityNumber: string;
  phone: string;
};
type Field = keyof Draft;
type FieldErrors = Partial<Record<Field, string>>;

const FIELD_MESSAGES: Readonly<Record<Field, string>> = {
  bankBin: 'Chọn ngân hàng của tài khoản.',
  accountNumber: 'Số tài khoản gồm 6–20 chữ số.',
  accountName: 'Nhập tên chủ tài khoản in hoa, không dấu, đúng như ngân hàng in.',
  identityNumber: 'Số CCCD gồm 12 chữ số.',
  phone: 'SĐT gồm 10 số, bắt đầu bằng 0.',
};

const EMPTY_MESSAGES: Readonly<Record<Field, string>> = {
  bankBin: 'Chọn ngân hàng của tài khoản.',
  accountNumber: 'Nhập số tài khoản.',
  accountName: 'Nhập tên chủ tài khoản.',
  identityNumber: 'Nhập số CCCD của chủ tài khoản.',
  phone: 'Nhập SĐT đăng ký Tingee.',
};

/** Lỗi do nơi khác xử lý: 2FA và đồng ý NĐ 13 (`Providers`), 401 (sang đăng nhập), bị xóa khỏi BTC (`DashboardShell`). */
const handledElsewhere = (error: unknown) =>
  isTotpRequired(error) ||
  hasErrorCode(error, ErrorCode.CONSENT_REQUIRED) ||
  hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
  hasErrorCode(error, ErrorCode.NOT_A_MEMBER);

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.');

const PROVIDER_DOWN = 'Tingee tạm lỗi, thử lại sau ít phút.';

function useGoToLogin() {
  const router = useRouter();
  const pathname = usePathname();
  return () => router.replace(withReturnTo(LOGIN_PATH, pathname));
}

/** Ghi kết quả mới nhất vào cache và làm mới dải banner (chưa liên kết / đang liên kết). */
function applyResult(queryClient: QueryClient, orgId: string, account: PayoutAccount) {
  queryClient.setQueryData<PayoutAccountOverview>(payoutAccountQueryKey(orgId), { current: account });
  void queryClient.invalidateQueries({ queryKey: statusNoticesQueryKey(orgId) });
}

function refresh(queryClient: QueryClient, orgId: string) {
  void queryClient.invalidateQueries({ queryKey: payoutAccountQueryKey(orgId) });
  void queryClient.invalidateQueries({ queryKey: statusNoticesQueryKey(orgId) });
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

function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-meta text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

const describedBy = (id: string, hint: boolean) => (hint ? `${id}-hint ${id}-error` : `${id}-error`);

/** Câu nêu lý do + việc làm được, theo mã lỗi của lần liên kết (lỗi vừa gửi hoặc `failureCode` của lần thử trước). */
const FAILURE_COPY: Readonly<Partial<Record<ErrorCode, string>>> = {
  [ErrorCode.BANK_NOT_SUPPORTED]: 'Ngân hàng này chưa được hỗ trợ. Chọn ngân hàng khác.',
  [ErrorCode.PAYOUT_ACCOUNT_IN_USE]: 'Tài khoản này đã được liên kết ở nơi khác. Dùng tài khoản khác.',
  [ErrorCode.PAYOUT_ACCOUNT_INVALID]:
    'Ngân hàng chưa xác nhận được thông tin tài khoản. Kiểm tra số tài khoản, tên chủ tài khoản, CCCD và SĐT rồi thử lại.',
  [ErrorCode.BANK_OTP_EXPIRED]: 'Mã OTP đã hết hạn. Nhập lại thông tin rồi bấm “Liên kết” để nhận mã mới.',
  [ErrorCode.MERCHANT_SUSPENDED]: 'Tài khoản Tingee của BTC đang tạm khóa. Liên hệ Tingee để được hỗ trợ.',
  [ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE]: PROVIDER_DOWN,
};
const FAILURE_FALLBACK = 'Lần liên kết trước chưa thành công. Kiểm tra lại thông tin rồi thử lại.';

const failureCopy = (code: string): string => FAILURE_COPY[code as ErrorCode] ?? FAILURE_FALLBACK;

/** Lỗi của lần liên kết: lỗi nằm ở một ô thì báo tại ô, còn lại báo tại form. */
function linkErrorField(error: unknown): { field: Field; message: string } | null {
  if (hasErrorCode(error, ErrorCode.BANK_NOT_SUPPORTED)) return { field: 'bankBin', message: failureCopy(error.code) };
  if (hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_IN_USE)) {
    return { field: 'accountNumber', message: failureCopy(error.code) };
  }
  return null;
}

function LinkForm({
  draft,
  onChange,
  submitting,
  submitError,
  previousFailureCode,
  resend,
  onSubmit,
  onClearServerError,
}: {
  draft: Draft;
  onChange: (field: Field, value: string) => void;
  submitting: boolean;
  submitError: unknown;
  /** `failureCode` của lần thử trước đã thất bại (sau khi tải lại, hoặc lỗi xác nhận OTP), khi chưa gửi lại lần nào. */
  previousFailureCode: string | null;
  /** OTP vừa hết hạn: nút là "Gửi lại" và có lời nhắc nhập lại CCCD. */
  resend: boolean;
  onSubmit: (body: LinkPayoutAccountRequest) => void;
  /** Sửa ô đang mang lỗi của server: bỏ lỗi đó. */
  onClearServerError: () => void;
}) {
  const ids = useId();
  const id = (field: Field) => `${ids}-${field}`;
  const [errors, setErrors] = useState<FieldErrors>({});

  const serverField = linkErrorField(submitError);
  const errorOf = (field: Field) => errors[field] ?? (serverField?.field === field ? serverField.message : undefined);

  const submit = () => {
    if (submitting) return;
    const parsed = LinkPayoutAccountRequest.safeParse(draft);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        if (next[field]) continue;
        next[field] = draft[field].trim() === '' ? EMPTY_MESSAGES[field] : FIELD_MESSAGES[field];
      }
      setErrors(next);
      return;
    }
    setErrors({});
    // Gửi bản đã chuẩn hóa (bỏ khoảng trắng, tên in hoa không dấu); ô vẫn giữ nguyên chữ người dùng gõ.
    onSubmit(parsed.data);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const change = (field: Field, value: string) => {
    onChange(field, value);
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    if (serverField?.field === field) onClearServerError();
  };

  const formFailure =
    submitError && !serverField && !handledElsewhere(submitError) && !hasErrorCode(submitError, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)
      ? submitError
      : null;
  const providerDown = hasErrorCode(formFailure, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);

  const input = (field: Field) => ({
    id: id(field),
    name: field,
    value: draft[field],
    'aria-invalid': errorOf(field) ? true : undefined,
    onChange: (event: { target: { value: string } }) => change(field, event.target.value),
  });

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-stack" data-slot="payout-account-form">
      {resend ? (
        <StatusBanner
          tone="warning"
          title="Mã OTP đã hết hạn"
          description="Nhập lại số CCCD rồi bấm “Gửi lại” để ngân hàng gửi mã mới."
        />
      ) : null}
      <FormField id={id('bankBin')} label="Ngân hàng" hint="Chỉ nhận tài khoản cá nhân." error={errorOf('bankBin')}>
        <div className="relative">
          <select
            {...input('bankBin')}
            aria-describedby={describedBy(id('bankBin'), true)}
            className={cn(
              'h-control-height w-full min-w-0 appearance-none rounded-md border border-transparent bg-muted pr-10 pl-3 text-foreground focus:border-ring aria-invalid:border-danger-text',
              draft.bankBin === '' && 'text-muted-foreground',
            )}
          >
            <option value="" disabled>
              Chọn ngân hàng
            </option>
            {SUPPORTED_PAYOUT_BANKS.map((bank) => (
              <option key={bank.bin} value={bank.bin}>
                {bank.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </FormField>
      <FormField id={id('accountNumber')} label="Số tài khoản" error={errorOf('accountNumber')}>
        <Input
          {...input('accountNumber')}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          className="tabular-nums"
          aria-describedby={describedBy(id('accountNumber'), false)}
        />
      </FormField>
      <FormField
        id={id('accountName')}
        label="Tên chủ tài khoản"
        hint="In hoa, không dấu, đúng như ngân hàng in (vd. NGUYEN VAN AN)."
        error={errorOf('accountName')}
      >
        <Input
          {...input('accountName')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(event) => change('accountName', event.target.value.toUpperCase())}
          aria-describedby={describedBy(id('accountName'), true)}
        />
      </FormField>
      <FormField
        id={id('identityNumber')}
        label="Số CCCD"
        hint="Chỉ gửi tới Tingee và ngân hàng để xác minh chủ tài khoản; Tickee không lưu."
        error={errorOf('identityNumber')}
      >
        <Input
          {...input('identityNumber')}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          className="tabular-nums"
          aria-describedby={describedBy(id('identityNumber'), true)}
        />
      </FormField>
      <FormField
        id={id('phone')}
        label="SĐT đăng ký Tingee"
        hint="Tingee dùng SĐT này để tạo tài khoản nhận tiền cho BTC."
        error={errorOf('phone')}
      >
        <Input
          {...input('phone')}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          className="tabular-nums"
          aria-describedby={describedBy(id('phone'), true)}
        />
      </FormField>
      {formFailure ? (
        <StatusBanner
          tone="danger"
          title="Chưa liên kết được tài khoản"
          description={providerDown ? PROVIDER_DOWN : messageOf(formFailure)}
          action={
            <Button type="button" variant="link" size="sm" onClick={submit}>
              Thử lại
            </Button>
          }
        />
      ) : previousFailureCode ? (
        <StatusBanner
          tone="danger"
          title="Chưa liên kết được tài khoản"
          description={failureCopy(previousFailureCode)}
        />
      ) : null}
      <Button type="submit" className="self-start" loading={submitting}>
        {resend ? 'Gửi lại' : 'Liên kết'}
      </Button>
    </form>
  );
}

function AccountSummary({ account }: { account: PayoutAccount }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
      <dt className="text-muted-foreground">Ngân hàng</dt>
      <dd className="min-w-0 break-words">{payoutBankName(account.bankBin)}</dd>
      <dt className="text-muted-foreground">Số tài khoản</dt>
      <dd className="tabular-nums">•••• {account.accountLast4}</dd>
      <dt className="text-muted-foreground">Chủ tài khoản</dt>
      <dd className="min-w-0 break-words uppercase">{account.accountName}</dd>
      {account.vaAccountNumber ? (
        <>
          <dt className="text-muted-foreground">Số VA nhận tiền</dt>
          <dd className="min-w-0 break-all tabular-nums">{account.vaAccountNumber}</dd>
        </>
      ) : null}
    </dl>
  );
}

function OtpStep({
  orgId,
  attempt,
  onExpired,
  onRestart,
}: {
  orgId: string;
  attempt: PayoutAccount;
  onExpired: () => void;
  onRestart: () => void;
}) {
  const ids = useId();
  const inputId = `${ids}-otp`;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [otp, setOtp] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();

  const confirm = useMutation({
    mutationFn: (code: string) => confirmPayoutOtp(orgId, { attemptId: attempt.id, otp: code }),
    onSuccess: (account) => {
      applyResult(queryClient, orgId, account);
      toast.success('Đã liên kết tài khoản nhận tiền.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.BANK_OTP_INVALID)) setFieldError('Mã OTP chưa đúng. Kiểm tra tin nhắn ngân hàng rồi nhập lại.');
      else if (hasErrorCode(error, ErrorCode.BANK_OTP_EXPIRED)) {
        refresh(queryClient, orgId);
        onExpired();
      } else if (!handledElsewhere(error) && !hasErrorCode(error, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE)) {
        refresh(queryClient, orgId);
      }
    },
  });

  const submit = () => {
    if (confirm.isPending) return;
    const code = otp.replace(/\s+/g, '');
    if (!BANK_OTP_PATTERN.test(code)) {
      setFieldError(code === '' ? 'Nhập mã OTP ngân hàng gửi tới bạn.' : 'Mã OTP gồm 4–8 chữ số.');
      confirm.reset();
      return;
    }
    setFieldError(undefined);
    confirm.mutate(code);
  };

  const error = confirm.error;
  const failure =
    error &&
    !handledElsewhere(error) &&
    !hasErrorCode(error, ErrorCode.BANK_OTP_INVALID) &&
    !hasErrorCode(error, ErrorCode.BANK_OTP_EXPIRED)
      ? error
      : null;

  return (
    <section className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card" data-slot="payout-account-otp">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title">Nhập mã OTP ngân hàng</h2>
        <StatusBadge tone="neutral">Đang liên kết</StatusBadge>
      </div>
      <p className="text-body text-muted-foreground">
        {payoutBankName(attempt.bankBin)} đã gửi mã OTP tới SĐT đăng ký tài khoản{' '}
        <span className="tabular-nums">•••• {attempt.accountLast4}</span>. Bạn có thể rời trang và quay lại nhập sau.
      </p>
      <form
        noValidate
        className="flex flex-col gap-stack"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor={inputId}>Mã OTP</Label>
          <Input
            id={inputId}
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={8}
            className="tabular-nums"
            value={otp}
            onChange={(event) => {
              setOtp(event.target.value);
              if (fieldError) setFieldError(undefined);
            }}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={`${inputId}-error`}
          />
          <FieldError id={`${inputId}-error`} message={fieldError} />
        </div>
        {failure ? (
          <StatusBanner
            tone="danger"
            title="Chưa xác nhận được mã"
            description={hasErrorCode(failure, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE) ? PROVIDER_DOWN : messageOf(failure)}
            action={
              <Button type="button" variant="link" size="sm" onClick={submit}>
                Thử lại
              </Button>
            }
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" loading={confirm.isPending}>
            Xác nhận
          </Button>
          <Button type="button" variant="link" size="sm" onClick={onRestart}>
            Nhập lại thông tin
          </Button>
        </div>
      </form>
    </section>
  );
}

function LinkedCard({ account }: { account: PayoutAccount }) {
  return (
    <section className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card" data-slot="payout-account-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title">Tài khoản nhận tiền</h2>
        <StatusBadge tone="success">Đã liên kết</StatusBadge>
      </div>
      <AccountSummary account={account} />
      <p className="text-meta text-muted-foreground">
        Tiền bán vé chuyển thẳng vào tài khoản này qua Tingee. Tickee không giữ tiền của BTC.
      </p>
    </section>
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

const emptyDraft = (phone: string | null, from: PayoutAccount | null | undefined): Draft => ({
  bankBin: from?.bankBin ?? '',
  accountNumber: '',
  accountName: from?.accountName ?? '',
  identityNumber: '',
  phone: phone ?? '',
});

export function PayoutAccountManager() {
  const organization = useCurrentOrganization();
  const orgId = organization.id;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  /** Dữ liệu đã nhập, giữ qua lỗi và qua bước OTP (để "Gửi lại" khi mã hết hạn). `null` = chưa sửa gì. */
  const [draft, setDraft] = useState<Draft | null>(null);
  /** Owner chọn nhập lại form thay vì nhập OTP, hoặc OTP vừa hết hạn. */
  const [restart, setRestart] = useState<'manual' | 'expired' | null>(null);

  const overview = useQuery({
    queryKey: payoutAccountQueryKey(orgId),
    queryFn: ({ signal }) => fetchPayoutAccount(orgId, signal),
  });
  const current = overview.data?.current;
  const effectiveDraft = draft ?? emptyDraft(organization.contactPhone, current);

  const link = useMutation({
    mutationFn: (body: LinkPayoutAccountRequest) => linkPayoutAccount(orgId, body),
    onSuccess: (account) => {
      setRestart(null);
      applyResult(queryClient, orgId, account);
      if (account.status === PayoutAccountStatus.LINKED) toast.success('Đã liên kết tài khoản nhận tiền.');
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) {
        goToLogin();
        return;
      }
      if (hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)) toast.info('BTC đã có tài khoản nhận tiền.');
      if (!handledElsewhere(error)) refresh(queryClient, orgId);
    },
  });

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
  } else if (current?.status === PayoutAccountStatus.LINKED) {
    body = <LinkedCard account={current} />;
  } else if (current?.status === PayoutAccountStatus.AWAITING_OTP && restart === null && !link.isPending) {
    body = (
      <OtpStep
        key={current.id}
        orgId={orgId}
        attempt={current}
        onExpired={() => {
          setDraft({ ...effectiveDraft, identityNumber: '' });
          link.reset();
          setRestart('expired');
        }}
        onRestart={() => {
          link.reset();
          setRestart('manual');
        }}
      />
    );
  } else if (current?.status === PayoutAccountStatus.LINKING && restart === null && !link.isPending) {
    body = (
      <section className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title">Đang chờ Tingee xác nhận</h2>
          <StatusBadge tone="neutral">Đang liên kết</StatusBadge>
        </div>
        <AccountSummary account={current} />
        <Button type="button" variant="secondary" className="self-start" onClick={() => void overview.refetch()}>
          Tải lại
        </Button>
      </section>
    );
  } else {
    body = (
      <section className="flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card">
        <h2 className="text-title">Liên kết tài khoản ngân hàng</h2>
        <p className="text-meta text-muted-foreground">
          Hỗ trợ tài khoản cá nhân ở {SUPPORTED_PAYOUT_BANKS.map((b) => b.name).join(', ')}. Ngân hàng có thể gửi mã OTP
          tới SĐT đăng ký tài khoản để xác nhận.
        </p>
        <LinkForm
          draft={effectiveDraft}
          onChange={(field, value) => setDraft({ ...effectiveDraft, [field]: value })}
          submitting={link.isPending}
          submitError={link.error}
          previousFailureCode={
            !link.error && restart !== 'expired' && current?.status === PayoutAccountStatus.FAILED
              ? current.failureCode
              : null
          }
          resend={restart === 'expired'}
          onSubmit={(request) => link.mutate(request)}
          onClearServerError={() => link.reset()}
        />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <PageHeading eyebrow={organization.name} title="Tài khoản nhận tiền" />
        <p className="text-body text-muted-foreground">
          Tài khoản ngân hàng nhận tiền bán Vé có phí, liên kết qua Tingee. Chưa liên kết thì chưa bán được Vé có phí.
        </p>
      </div>
      {body}
    </div>
  );
}
