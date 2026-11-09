'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConnectTingeeRequest, ErrorCode, type PayoutAccountOptions } from '@tickee/contracts';
import { useId, useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { FieldError } from '@/components/tickee/field-error';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import { connectTingee } from '@/lib/organizer/api';

import { cardClass, CREDENTIAL_INVALID, type Draft, PROVIDER_DOWN, refreshOverview } from './shared';

type Field = keyof Draft;
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY_MESSAGES: Readonly<Record<Field, string>> = {
  clientId: 'Nhập Client ID.',
  secretToken: 'Nhập Secret Token.',
};
const INVALID_MESSAGES: Readonly<Record<Field, string>> = {
  clientId: 'Client ID quá dài. Kiểm tra lại rồi dán lại.',
  secretToken: 'Secret Token quá dài. Kiểm tra lại rồi dán lại.',
};

/**
 * Form Client ID / Secret Token dùng chung cho kết nối lần đầu ("Dùng key khác") và "Đổi key Tingee": kiểm tại ô (không
 * gọi api), gửi key đã bỏ khoảng trắng qua `onSubmit`, báo lỗi của lần gửi (`failure`) tại form, dữ liệu đã nhập được
 * giữ. Sửa key khi đang báo key sai thì `onEdited` (người gọi bỏ lỗi cũ).
 */
export function TingeeKeyForm({
  title,
  description,
  slot,
  submitLabel,
  failureTitle,
  initial,
  pending,
  failure,
  onSubmit,
  onEdited,
  onCancel,
}: {
  title: string;
  description?: string;
  slot: string;
  submitLabel: string;
  failureTitle: string;
  /** Giá trị ban đầu (quay lại form từ bước sau). */
  initial?: Draft;
  pending: boolean;
  /** Lỗi của lần gửi gần nhất mà form phải báo (người gọi đã lọc lỗi do nơi khác xử lý). */
  failure: unknown;
  onSubmit: (key: ConnectTingeeRequest) => void;
  onEdited: () => void;
  onCancel?: () => void;
}) {
  const ids = useId();
  const id = (field: Field) => `${ids}-${field}`;
  const [draft, setDraft] = useState<Draft>(initial ?? { clientId: '', secretToken: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    if (pending) return;
    const parsed = ConnectTingeeRequest.safeParse(draft);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        if (next[field]) continue;
        next[field] = draft[field].trim() === '' ? EMPTY_MESSAGES[field] : INVALID_MESSAGES[field];
      }
      setErrors(next);
      onEdited();
      return;
    }
    setErrors({});
    onSubmit(parsed.data);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const credentialInvalid = hasErrorCode(failure, ErrorCode.TINGEE_CREDENTIAL_INVALID);
  const providerDown = hasErrorCode(failure, ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE);

  const change = (field: Field, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    // Đã sửa key: bỏ câu "không đúng" của lần gửi trước.
    if (credentialInvalid) onEdited();
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
      <div className="flex flex-col gap-1">
        <h2 className="text-title">{title}</h2>
        {description ? <p className="text-meta text-muted-foreground">{description}</p> : null}
      </div>
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-stack" data-slot={slot}>
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
            title={failureTitle}
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
          <Button type="submit" loading={pending}>
            {submitLabel}
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

export function ConnectForm({
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
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();

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

  const failure =
    connect.error &&
    !handledElsewhere(connect.error) &&
    !hasErrorCode(connect.error, ErrorCode.PAYOUT_ACCOUNT_ALREADY_LINKED)
      ? connect.error
      : null;

  return (
    <TingeeKeyForm
      title={replacing ? 'Nhập key Tingee khác' : 'Kết nối tài khoản Tingee'}
      slot="tingee-connect-form"
      submitLabel="Kết nối"
      failureTitle="Chưa kết nối được Tingee"
      pending={connect.isPending}
      failure={failure}
      onSubmit={(key) => connect.mutate(key)}
      onEdited={() => connect.reset()}
      onCancel={onCancel}
    />
  );
}
