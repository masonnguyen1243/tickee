'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CREATE_ORGANIZATION_PATH,
  CreateOrganizationRequest,
  ErrorCode,
  ORGANIZATION_NAME_MAX,
  organizationDashboardPath,
} from '@tickee/contracts';
import { OctagonAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ChangeEvent, type FormEvent } from 'react';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, hasErrorCode, ME_QUERY_KEY } from '@/lib/auth/api';
import { CONSENT_PATH, LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { createOrganization, MEMBERSHIPS_QUERY_KEY } from '@/lib/organizer/api';

type Field = 'name' | 'contactPhone' | 'contactEmail';
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly Field[] = ['name', 'contactPhone', 'contactEmail'];

function messageFor(field: Field, values: Values): string {
  if (field === 'name') {
    return values.name.trim() === '' ? 'Nhập tên BTC.' : `Tên BTC tối đa ${ORGANIZATION_NAME_MAX} ký tự.`;
  }
  if (field === 'contactPhone') return 'Số điện thoại chưa đúng (vd. 0901 234 567 hoặc +84 901 234 567).';
  return 'Email chưa đúng định dạng.';
}

/** Lỗi theo trường từ danh sách đường dẫn trường (Zod phía web hoặc `details.issues` của api). */
function fieldErrorsOf(paths: readonly unknown[], values: Values): FieldErrors {
  const errors: FieldErrors = {};
  for (const path of paths) {
    const field = FIELDS.find((f) => f === path);
    if (field && !errors[field]) errors[field] = messageFor(field, values);
  }
  return errors;
}

function serverIssuePaths(error: ApiError): string[] {
  const issues = (error.details as { issues?: { path?: unknown }[] } | null)?.issues;
  return Array.isArray(issues) ? issues.map((i) => String(i.path ?? '').split('.')[0] ?? '') : [];
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

/** Form tạo BTC: tên (bắt buộc) + kênh liên hệ tùy chọn. Lỗi tại ô; lỗi mạng/máy chủ có "Thử lại", giữ dữ liệu. */
export function CreateOrganizationForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const ids = useId();
  const [values, setValues] = useState<Values>({ name: '', contactPhone: '', contactEmail: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const goToLogin = () => router.replace(withReturnTo(LOGIN_PATH, CREATE_ORGANIZATION_PATH));

  useEffect(() => {
    if (hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED)) router.replace(withReturnTo(LOGIN_PATH, CREATE_ORGANIZATION_PATH));
    // Chưa đồng ý NĐ 13: sang màn đồng ý trước khi điền (gửi form cũng chỉ nhận CONSENT_REQUIRED và mất dữ liệu).
    else if (me.data && !me.data.consentedAt) router.replace(withReturnTo(CONSENT_PATH, CREATE_ORGANIZATION_PATH));
  }, [me.error, me.data, router]);

  const create = useMutation({
    mutationFn: createOrganization,
    onSuccess: (org) => {
      // Không chờ refetch memberships: BTC đã tạo, chuyển trang ngay.
      void queryClient.invalidateQueries({ queryKey: MEMBERSHIPS_QUERY_KEY });
      router.replace(organizationDashboardPath(org.id));
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) {
        const fieldErrors = fieldErrorsOf(serverIssuePaths(error), values);
        setErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { name: messageFor('name', values) });
      }
    },
  });

  const submit = () => {
    if (create.isPending || create.isSuccess) return;
    const parsed = CreateOrganizationRequest.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error.issues.map((i) => i.path[0]), values));
      create.reset();
      return;
    }
    setErrors({});
    create.mutate({
      name: parsed.data.name,
      contactPhone: parsed.data.contactPhone,
      contactEmail: parsed.data.contactEmail,
    });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const update = (field: Field) => (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setValues((v) => ({ ...v, [field]: next }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  // Lỗi không thuộc trường nào (mạng, 5xx…): banner tại chỗ + "Thử lại". CONSENT_REQUIRED do `Providers` chuyển trang.
  const failure =
    create.error &&
    !hasErrorCode(create.error, ErrorCode.VALIDATION_FAILED) &&
    !hasErrorCode(create.error, ErrorCode.UNAUTHENTICATED) &&
    !hasErrorCode(create.error, ErrorCode.CONSENT_REQUIRED)
      ? create.error
      : null;

  const field = (name: Field) => ({
    id: `${ids}-${name}`,
    errorId: `${ids}-${name}-error`,
  });

  const nameField = field('name');
  const phoneField = field('contactPhone');
  const emailField = field('contactEmail');

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-section">
      <div className="flex flex-col gap-stack">
        <Label htmlFor={nameField.id}>Tên BTC</Label>
        <Input
          id={nameField.id}
          name="name"
          autoComplete="organization"
          autoFocus
          placeholder="vd. CLB Cờ Vua Quận 3"
          value={values.name}
          onChange={update('name')}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={nameField.errorId}
        />
        <FieldError id={nameField.errorId} message={errors.name} />
      </div>

      <fieldset className="flex min-w-0 flex-col gap-stack">
        <legend className="text-label">Kênh liên hệ (không bắt buộc)</legend>
        <p className="text-meta text-muted-foreground">Người mua vé dùng để liên hệ BTC khi cần.</p>
        <Label htmlFor={phoneField.id}>Số điện thoại</Label>
        <Input
          id={phoneField.id}
          name="contactPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="0901 234 567"
          value={values.contactPhone}
          onChange={update('contactPhone')}
          aria-invalid={errors.contactPhone ? true : undefined}
          aria-describedby={phoneField.errorId}
        />
        <FieldError id={phoneField.errorId} message={errors.contactPhone} />
        <Label htmlFor={emailField.id} className="mt-2">
          Email liên hệ
        </Label>
        <Input
          id={emailField.id}
          name="contactEmail"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="lienhe@vidu.vn"
          value={values.contactEmail}
          onChange={update('contactEmail')}
          aria-invalid={errors.contactEmail ? true : undefined}
          aria-describedby={emailField.errorId}
        />
        <FieldError id={emailField.errorId} message={errors.contactEmail} />
      </fieldset>

      {failure ? (
        <StatusBanner
          tone="danger"
          title="Chưa tạo được BTC"
          description={failure instanceof ApiError ? failure.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.'}
          action={
            <Button type="button" variant="link" size="sm" onClick={submit}>
              Thử lại
            </Button>
          }
        />
      ) : null}

      <Button type="submit" className="w-full" loading={create.isPending || create.isSuccess}>
        Tạo BTC
      </Button>
    </form>
  );
}
