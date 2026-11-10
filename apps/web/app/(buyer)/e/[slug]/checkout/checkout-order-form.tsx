'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BUYER_NAME_MAX,
  ErrorCode,
  eventPagePath,
  FormQuestionKind,
  NotOnSaleDetails,
  orderPath,
  PendingOrderExistsDetails,
  TicketTypeSoldOutDetails,
  type CreateOrderRequest,
  type FormQuestion,
  type PublicTicketType,
  type TicketSelectionItem,
} from '@tickee/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type ComponentProps, type FocusEvent, type FormEvent } from 'react';
import { toast } from 'sonner';

import { FieldError } from '@/components/tickee/field-error';
import { PurchaseBar } from '@/components/tickee/purchase-bar';
import { RequiredMark } from '@/components/tickee/purchase-form-preview';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ApiError } from '@/lib/api/errors';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { newFunnelId } from '@/lib/event/funnel';
import { availabilityQueryKey } from '@/lib/event/public-api';
import { priceLabel, withSelection } from '@/lib/event/selection';
import { buyerOrderQueryKey, checkoutFormQueryKey, createOrder, fetchCheckoutForm } from '@/lib/order/api';
import {
  fieldErrors,
  firstErrorField,
  hasFieldErrors,
  initialValues,
  isRetryableSubmitError,
  notOnSaleMessage,
  orderRequest,
  rateLimitedMessage,
  serverFieldErrors,
  SUBMIT_NETWORK_ERROR,
  type CheckoutValues,
  type FieldErrors,
  type FieldKey,
} from '@/lib/order/checkout-form';

import { useCheckoutFunnelId } from './checkout-gate';

type CheckoutOrderFormProps = {
  slug: string;
  /** Tên BTC: dòng "Thông tin trong form sẽ được chia sẻ cho {BTC}." */
  organizationName: string;
  ticketTypes: readonly Pick<PublicTicketType, 'id' | 'name' | 'price'>[];
  /** Lựa chọn đã hợp lệ hóa ở server, theo thứ tự Hạng vé. */
  items: readonly TicketSelectionItem[];
  count: number;
  amount: number;
};

type SubmitError = { message: string; retry: boolean };

const fieldDomId = (prefix: string, key: FieldKey) => `${prefix}-${key === 'name' || key === 'phone' ? key : `q-${key}`}`;

/** Cuộn trường vào giữa màn hình (không bị `purchase-bar` che) rồi focus; câu chọn: phương án đã chọn hoặc đầu tiên. */
function focusField(prefix: string, key: FieldKey): void {
  const node = document.getElementById(fieldDomId(prefix, key));
  if (!node) return;
  const target =
    node instanceof HTMLInputElement
      ? node
      : (node.querySelector<HTMLInputElement>('input:checked') ?? node.querySelector<HTMLInputElement>('input'));
  if (!target) return;
  target.scrollIntoView({ block: 'center' });
  target.focus({ preventScroll: true });
}

/**
 * Form mua một lần cho cả Đơn (Story 3.2): Tên, SĐT (tự điền từ Đơn gần nhất), Email (chỉ đọc), câu hỏi riêng của BTC;
 * `purchase-bar` với tổng và "Gửi Đơn". Lỗi tại trường khi rời trường và khi gửi; gửi lỗi thì cuộn rồi focus trường lỗi
 * đầu tiên. Một `Idempotency-Key` cho mỗi lần mở Checkout: "Thử lại" sau lỗi mạng dùng lại khóa đó. Dữ liệu form chỉ ở
 * state của trang.
 */
export function CheckoutOrderForm({ slug, organizationName, ticketTypes, items, count, amount }: CheckoutOrderFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const funnelId = useCheckoutFunnelId();
  const ids = useId();
  const [idempotencyKey] = useState(newFunnelId);
  const form = useQuery({
    queryKey: checkoutFormQueryKey(slug),
    queryFn: ({ signal }) => fetchCheckoutForm(slug, signal),
    // Câu hỏi không đổi dưới tay Người mua đang điền; API kiểm lại lúc gửi.
    refetchOnWindowFocus: false,
  });
  const questions: FormQuestion[] = form.data?.questions ?? [];

  const [values, setValues] = useState<CheckoutValues | null>(null);
  if (form.data && values === null) setValues(initialValues(form.data));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  /** Đã gửi xong hoặc đang chuyển trang: giữ spinner, chặn bấm lặp. */
  const [leaving, setLeaving] = useState(false);
  const pendingFocus = useRef<FieldKey | null>(null);
  const submitErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pendingFocus.current) return;
    focusField(ids, pendingFocus.current);
    pendingFocus.current = null;
  }, [errors, ids]);

  useEffect(() => {
    if (submitError) submitErrorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [submitError]);

  const leave = (href: string) => {
    setLeaving(true);
    router.push(href);
  };

  /** Về trang Sự kiện, giữ lựa chọn trừ Hạng vé `zeroId` (về 0); số vé tải lại ngay. */
  const backToEvent = (zeroId?: string) => {
    void queryClient.invalidateQueries({ queryKey: availabilityQueryKey(slug) });
    const selection = new Map(items.filter((i) => i.ticketTypeId !== zeroId).map((i) => [i.ticketTypeId, i.quantity]));
    leave(withSelection(eventPagePath(slug), selection, ticketTypes));
  };

  const onError = (error: unknown) => {
    if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) {
      setLeaving(true);
      router.replace(withReturnTo(LOGIN_PATH, `${window.location.pathname}${window.location.search}`));
      return;
    }
    // 2FA (gửi lại sau khi qua lớp hai) và đồng ý NĐ 13 do `Providers` xử lý.
    if (handledElsewhere(error)) return;
    const details = (error as ApiError | null)?.details;
    if (hasErrorCode(error, ErrorCode.TICKET_TYPE_SOLD_OUT)) {
      const parsed = TicketTypeSoldOutDetails.safeParse(details);
      const name = parsed.success ? parsed.data.ticketTypeName : 'này';
      toast.error(`Hạng vé ${name} vừa hết. Bạn chọn lại nhé.`);
      backToEvent(parsed.success ? parsed.data.ticketTypeId : undefined);
      return;
    }
    if (hasErrorCode(error, ErrorCode.NOT_ON_SALE)) {
      const parsed = NotOnSaleDetails.safeParse(details);
      toast.error(notOnSaleMessage(parsed.success ? parsed.data : null, ticketTypes));
      backToEvent(parsed.success ? parsed.data.ticketTypeId : undefined);
      return;
    }
    if (hasErrorCode(error, ErrorCode.PENDING_ORDER_EXISTS)) {
      const parsed = PendingOrderExistsDetails.safeParse(details);
      toast.info('Bạn đang có một Đơn chờ thanh toán cho Sự kiện này.');
      if (parsed.success) leave(orderPath(parsed.data.code));
      return;
    }
    if (hasErrorCode(error, ErrorCode.EVENT_NOT_FOUND)) {
      setLeaving(true);
      router.replace(eventPagePath(slug));
      return;
    }
    if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED) && values) {
      const server = serverFieldErrors(error, values, questions);
      if (hasFieldErrors(server.errors)) {
        pendingFocus.current = firstErrorField(server.errors, questions);
        setErrors(server.errors);
      }
      if (server.unmatched.includes('items')) {
        toast.error('Lựa chọn vé không còn hợp lệ. Bạn chọn lại nhé.');
        backToEvent();
      } else if (server.unmatched.length > 0) {
        void form.refetch();
        setSubmitError({ message: 'Form mua vừa thay đổi. Kiểm tra lại rồi gửi.', retry: false });
      }
      return;
    }
    if (hasErrorCode(error, ErrorCode.ORDER_RATE_LIMITED)) {
      setSubmitError({ message: rateLimitedMessage(error), retry: false });
      return;
    }
    setSubmitError(
      isRetryableSubmitError(error) ? { message: SUBMIT_NETWORK_ERROR, retry: true } : { message: messageOf(error), retry: false },
    );
  };

  // Xử lý kết quả trên `useMutation` (không trong `mutate(…, {})`): lần gửi lại sau 2FA cũng chạy các callback này.
  const submit = useMutation({
    mutationFn: (body: CreateOrderRequest) => createOrder(slug, idempotencyKey, body),
    onSuccess: (order) => {
      queryClient.setQueryData(buyerOrderQueryKey(order.code), order);
      leave(orderPath(order.code));
    },
    onError,
  });
  const busy = submit.isPending || leaving;

  const send = () => {
    if (!values || busy) return;
    const all = fieldErrors(values, questions);
    setErrors(all);
    setSubmitError(null);
    const first = firstErrorField(all, questions);
    if (first) {
      pendingFocus.current = first;
      return;
    }
    submit.mutate(orderRequest(values, items, funnelId));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  /** Lỗi của một trường theo giá trị hiện tại (rời trường, hoặc sửa trường đang báo lỗi). */
  const check = (key: FieldKey, next: CheckoutValues) =>
    setErrors((prev) => ({ ...prev, [key]: fieldErrors(next, questions)[key] }));

  const change = (key: FieldKey, value: string) => {
    if (!values) return;
    const next =
      key === 'name' || key === 'phone'
        ? { ...values, [key]: value }
        : { ...values, answers: { ...values.answers, [key]: value } };
    setValues(next);
    if (errors[key]) check(key, next);
  };

  if (form.isError && !form.data) {
    return (
      <StatusBanner
        tone="danger"
        title="Chưa tải được form mua"
        description={messageOf(form.error)}
        action={
          <Button type="button" variant="link" size="sm" loading={form.isFetching} onClick={() => void form.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  }

  if (!form.data || !values) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-stack">
        <span className="sr-only">Đang tải form mua</span>
        <div aria-hidden="true" data-slot="skeleton" className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  const textField = (key: FieldKey, label: string, required: boolean, input: ComponentProps<'input'>) => {
    const id = fieldDomId(ids, key);
    const errorId = `${id}-error`;
    const noteId = `${id}-note`;
    const note = key === 'phone' ? 'vd. 0912 345 678' : null;
    return (
      <div key={key} className="flex min-w-0 flex-col gap-stack" data-slot="checkout-field">
        <Label htmlFor={id} className="items-start gap-1">
          <span className="min-w-0 wrap-break-word">{label}</span>
          {required ? <RequiredMark /> : null}
        </Label>
        <Input
          id={id}
          aria-required={required || undefined}
          aria-invalid={errors[key] ? true : undefined}
          aria-describedby={note ? `${noteId} ${errorId}` : errorId}
          onBlur={() => check(key, values)}
          {...input}
        />
        {note ? (
          <p id={noteId} className="text-meta text-muted-foreground">
            {note}
          </p>
        ) : null}
        <FieldError id={errorId} message={errors[key]} />
      </div>
    );
  };

  const choiceField = (question: FormQuestion) => {
    const id = fieldDomId(ids, question.id);
    const errorId = `${id}-error`;
    const onGroupBlur = (event: FocusEvent<HTMLFieldSetElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget)) check(question.id, values);
    };
    return (
      // Bắt buộc báo bằng `*` + "(bắt buộc)" trong `legend` (`aria-required` không hợp lệ trên `fieldset`).
      <fieldset
        key={question.id}
        id={id}
        className="flex min-w-0 flex-col gap-stack"
        data-slot="checkout-field"
        onBlur={onGroupBlur}
      >
        <legend className="mb-stack flex items-start gap-1 text-label">
          <span className="min-w-0 wrap-break-word">{question.label}</span>
          {question.required ? <RequiredMark /> : null}
        </legend>
        <div className="flex min-w-0 flex-col gap-1">
          {question.options.map((option) => (
            <label key={option.id} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 text-body">
              <input
                type="radio"
                name={id}
                value={option.id}
                checked={values.answers[question.id] === option.id}
                onChange={() => {
                  change(question.id, option.id);
                  check(question.id, { ...values, answers: { ...values.answers, [question.id]: option.id } });
                }}
                aria-invalid={errors[question.id] ? true : undefined}
                aria-describedby={errorId}
                className="size-5 shrink-0"
              />
              <span className="min-w-0 wrap-break-word">{option.label}</span>
            </label>
          ))}
        </div>
        {/* Radio không bỏ chọn được: câu không bắt buộc đã chọn thì cho xóa câu trả lời (bấm nhầm). */}
        {!question.required && values.answers[question.id] ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="self-start"
            aria-label={`Bỏ chọn ${question.label}`}
            onClick={() => {
              change(question.id, '');
              document.getElementById(fieldDomId(ids, question.id))?.querySelector<HTMLInputElement>('input')?.focus();
            }}
          >
            Bỏ chọn
          </Button>
        ) : null}
        <FieldError id={errorId} message={errors[question.id]} />
      </fieldset>
    );
  };

  const emailId = `${ids}-email`;
  return (
    <form noValidate onSubmit={onSubmit} aria-labelledby={`${ids}-heading`} data-slot="checkout-form">
      <section className="flex flex-col gap-section rounded-lg bg-card p-card-padding text-card-foreground shadow-card">
        <div className="flex flex-col gap-1">
          <h2 id={`${ids}-heading`} className="text-title">
            Thông tin người mua
          </h2>
          <p data-slot="checkout-share-note" className="text-meta text-muted-foreground">
            Thông tin trong form sẽ được chia sẻ cho {organizationName}.
          </p>
          <p className="text-meta text-muted-foreground">
            Dấu <span className="text-danger-text">*</span> là câu bắt buộc.
          </p>
        </div>
        {textField('name', 'Tên', true, {
          name: 'name',
          autoComplete: 'name',
          value: values.name,
          maxLength: BUYER_NAME_MAX,
          onChange: (e) => change('name', e.target.value),
        })}
        {textField('phone', 'Số điện thoại', true, {
          name: 'phone',
          type: 'tel',
          inputMode: 'tel',
          autoComplete: 'tel',
          value: values.phone,
          maxLength: 30,
          onChange: (e) => change('phone', e.target.value),
        })}
        <div className="flex min-w-0 flex-col gap-stack" data-slot="checkout-field">
          <Label htmlFor={emailId}>Email</Label>
          <Input
            id={emailId}
            type="email"
            readOnly
            value={form.data.buyer.email}
            aria-describedby={`${emailId}-note`}
            className="text-muted-foreground"
          />
          <p id={`${emailId}-note`} className="text-meta text-muted-foreground">
            Tự điền từ tài khoản, không sửa được. Vé gửi về email này.
          </p>
        </div>
        {questions.map((question) =>
          question.kind === FormQuestionKind.CHOICE
            ? choiceField(question)
            : textField(question.id, question.label, question.required, {
                name: `answer-${question.id}`,
                value: values.answers[question.id] ?? '',
                maxLength: 1_000,
                onChange: (e) => change(question.id, e.target.value),
              }),
        )}
      </section>
      {submitError ? (
        <div
          ref={submitErrorRef}
          role="alert"
          data-slot="checkout-submit-error"
          className="mt-stack flex flex-wrap items-center justify-between gap-2 rounded-md bg-danger-subtle p-card-padding text-danger-text"
        >
          <p className="text-label">{submitError.message}</p>
          {submitError.retry ? (
            <Button type="button" variant="secondary" size="sm" loading={busy} onClick={send}>
              Thử lại
            </Button>
          ) : null}
        </div>
      ) : null}
      <PurchaseBar
        caption={`Tổng · ${count} vé`}
        total={priceLabel(amount)}
        action={
          <Button type="submit" variant="primary" loading={busy} className="w-35 shrink">
            Gửi Đơn
          </Button>
        }
      />
    </form>
  );
}
