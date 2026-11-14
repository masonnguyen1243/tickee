'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CapacityBelowCommittedDetails,
  ErrorCode,
  EVENT_YEAR_MAX,
  EVENT_YEAR_MIN,
  EventOrderLimitInput,
  FREE_EVENT_TICKET_CAP,
  MAX_TICKETS_PER_ORDER_DEFAULT,
  MAX_TICKETS_PER_ORDER_MAX,
  MAX_TICKETS_PER_ORDER_MIN,
  MIN_PAID_PRICE,
  TICKET_TYPE_CAPACITY_MAX,
  TICKET_TYPE_DESCRIPTION_MAX,
  TICKET_TYPE_NAME_MAX,
  TICKET_TYPE_PRICE_MAX,
  TicketTypeInput,
  eventIsoToLocal,
  eventLocalToIso,
  formatEventDateTime,
  formatVnd,
  isEventYearInRange,
  type EventDetail,
  type TicketTypeDetail,
} from '@tickee/contracts';
import { Ticket } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { EmptyState } from '@/components/tickee/empty-state';
import { FieldError } from '@/components/tickee/field-error';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api/errors';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  createTicketType,
  deleteTicketType,
  eventQueryKey,
  fetchTicketTypes,
  ticketTypesQueryKey,
  updateOrderLimit,
  updateTicketType,
} from '@/lib/event/api';
import { refreshEventSaleStatus } from '@/lib/event/sale-status';

/*
 * Trình sửa Hạng vé (Story 2.8) dùng chung cho wizard bước 2 và tab "Hạng vé": danh sách Hạng vé (tên, giá, số suất,
 * giờ bán), "Thêm Hạng vé" / "Sửa" mở `Dialog` chứa form, "Xóa" mở `Dialog` xác nhận nêu hậu quả. Ô "Giới hạn Vé/Đơn"
 * đặt cạnh danh sách. Lỗi 409 về số suất (dưới đã bán + đang giữ chỗ, trần suất miễn phí) hiện tại ô số suất. Lỗi 409 khác
 * (BTC chưa đủ điều kiện bán Vé có phí, xóa Hạng vé cuối của Sự kiện đã mở bán) hiện câu của server. Giờ bán luôn hiểu
 * theo giờ Việt Nam (+07:00).
 */

/** Xóa Hạng vé đã có Đơn (`409 TICKET_TYPE_IN_USE`): không xóa mềm, chỉ BTC cách ngừng bán. */
const TICKET_TYPE_IN_USE_MESSAGE =
  'Hạng vé đã có Đơn, không xóa được. Muốn ngừng bán thì đặt giờ kết thúc bán của Hạng vé.';

// ---------------------------------------------------------------------------------------------------------------
// Form Hạng vé
// ---------------------------------------------------------------------------------------------------------------

type Field = 'name' | 'price' | 'capacity' | 'description' | 'saleStartsAt' | 'saleEndsAt';
/** Giá trị ô nhập; giờ là giá trị `datetime-local` theo giờ Việt Nam. */
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly Field[] = ['name', 'price', 'capacity', 'description', 'saleStartsAt', 'saleEndsAt'];
const EMPTY: Values = { name: '', price: '', capacity: '', description: '', saleStartsAt: '', saleEndsAt: '' };
const YEAR_OUT_OF_RANGE = `Năm phải trong khoảng ${EVENT_YEAR_MIN}–${EVENT_YEAR_MAX}.`;
const FREE_CAP_MESSAGE = `Tối đa ${FREE_EVENT_TICKET_CAP} suất miễn phí mỗi Sự kiện — giảm số suất hoặc đặt giá có phí.`;
const UNMATCHED_SERVER_ERROR = 'Thông tin chưa hợp lệ. Kiểm tra lại các ô rồi lưu lại.';

const valuesOf = (t: TicketTypeDetail): Values => ({
  name: t.name,
  price: String(t.price),
  capacity: String(t.capacity),
  description: t.description ?? '',
  saleStartsAt: t.saleStartsAt ? eventIsoToLocal(t.saleStartsAt) : '',
  saleEndsAt: t.saleEndsAt ? eventIsoToLocal(t.saleEndsAt) : '',
});

/**
 * Số nguyên không âm: chỉ chữ số ("300000"), hoặc 1–3 chữ số rồi các nhóm đúng 3 chữ số ngăn bằng `.`, `,` hay khoảng
 * trắng ("300.000", "300 000"); có thể kèm `đ` ở cuối. Còn lại ("4,5", "1,5", "30.00", trống) → `NaN`.
 */
export function parseWholeNumber(text: string): number {
  const trimmed = text.trim().replace(/\s*đ$/i, '');
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (/^\d{1,3}(?:[.,\s]\d{3})+$/.test(trimmed)) return Number(trimmed.replace(/[.,\s]/g, ''));
  return Number.NaN;
}

const inputOf = (values: Values) => ({
  name: values.name,
  description: values.description,
  price: parseWholeNumber(values.price),
  capacity: parseWholeNumber(values.capacity),
  saleStartsAt: values.saleStartsAt === '' ? null : eventLocalToIso(values.saleStartsAt),
  saleEndsAt: values.saleEndsAt === '' ? null : eventLocalToIso(values.saleEndsAt),
});

function messageFor(field: Field, values: Values): string {
  switch (field) {
    case 'name':
      return values.name.trim() === '' ? 'Nhập tên Hạng vé.' : `Tên Hạng vé tối đa ${TICKET_TYPE_NAME_MAX} ký tự.`;
    case 'price': {
      if (values.price.trim() === '') return 'Nhập giá (0 nếu miễn phí).';
      const price = parseWholeNumber(values.price);
      if (Number.isNaN(price)) return 'Giá là số nguyên đồng, vd. 300000.';
      if (price > TICKET_TYPE_PRICE_MAX) return `Giá tối đa ${formatVnd(TICKET_TYPE_PRICE_MAX)}.`;
      return `Hạng vé có phí tối thiểu ${formatVnd(MIN_PAID_PRICE)} (hoặc 0đ nếu miễn phí).`;
    }
    case 'capacity':
      return values.capacity.trim() === ''
        ? 'Nhập số suất.'
        : `Số suất là số nguyên từ 1 đến ${TICKET_TYPE_CAPACITY_MAX.toLocaleString('vi-VN')}.`;
    case 'description':
      return `Mô tả tối đa ${TICKET_TYPE_DESCRIPTION_MAX.toLocaleString('vi-VN')} ký tự.`;
    case 'saleStartsAt':
      return values.saleStartsAt !== '' && !isEventYearInRange(eventLocalToIso(values.saleStartsAt))
        ? YEAR_OUT_OF_RANGE
        : 'Giờ mở bán chưa đúng.';
    case 'saleEndsAt':
      if (values.saleEndsAt !== '' && !isEventYearInRange(eventLocalToIso(values.saleEndsAt))) return YEAR_OUT_OF_RANGE;
      return 'Giờ đóng bán phải sau giờ mở bán.';
  }
}

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

/** Lỗi 409 về số suất → câu báo tại ô số suất; lỗi khác → `undefined`. */
function capacityConflictMessage(error: unknown): string | undefined {
  if (hasErrorCode(error, ErrorCode.CAPACITY_BELOW_COMMITTED)) {
    const details = CapacityBelowCommittedDetails.safeParse((error as ApiError).details);
    return details.success
      ? `Tối thiểu ${details.data.minimum} — đã bán và đang giữ chỗ.`
      : 'Số suất không được nhỏ hơn số đã bán và đang giữ chỗ.';
  }
  if (hasErrorCode(error, ErrorCode.FREE_EVENT_CAPACITY_EXCEEDED)) return FREE_CAP_MESSAGE;
  return undefined;
}

/**
 * Form trong `Dialog` Thêm/Sửa Hạng vé. Giữ Hạng vé đang sửa từ lúc mở (prop đổi trong lúc `Dialog` đóng không ảnh
 * hưởng). Submit không lan ra form ngoài (wizard): `Dialog` render qua portal nhưng sự kiện React vẫn nổi theo cây React.
 */
function TicketTypeForm({
  orgId,
  eventId,
  target,
  onDone,
  onCancel,
}: {
  orgId: string;
  eventId: string;
  target: TicketTypeDetail | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const ids = useId();
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [editing] = useState(target);
  const [values, setValues] = useState<Values>(() => (editing ? valuesOf(editing) : EMPTY));
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: TicketTypeInput) =>
      editing ? updateTicketType(orgId, eventId, editing.id, body) : createTicketType(orgId, eventId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData<TicketTypeDetail[]>(ticketTypesQueryKey(orgId, eventId), (list) => {
        if (!list) return [saved];
        return editing ? list.map((t) => (t.id === saved.id ? saved : t)) : [...list, saved];
      });
      void queryClient.invalidateQueries({ queryKey: ticketTypesQueryKey(orgId, eventId) });
      // Giá và giờ bán đổi trạng thái bán của Sự kiện đã mở bán (badge dashboard, Story 4.2-c).
      void refreshEventSaleStatus(queryClient, orgId);
      toast.success(editing ? `Đã lưu ${saved.name}.` : `Đã thêm ${saved.name}.`);
      onDone();
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) return goToLogin();
      const capacity = capacityConflictMessage(error);
      if (capacity) return setErrors({ capacity });
      if (hasErrorCode(error, ErrorCode.VALIDATION_FAILED)) {
        const fieldErrors = fieldErrorsOf(serverIssuePaths(error), values);
        return setErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { name: UNMATCHED_SERVER_ERROR });
      }
      if (hasErrorCode(error, ErrorCode.TICKET_TYPE_NOT_FOUND)) {
        toast.info('Hạng vé này không còn nữa.');
        void queryClient.invalidateQueries({ queryKey: ticketTypesQueryKey(orgId, eventId) });
        onDone();
      }
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const parsed = TicketTypeInput.safeParse(inputOf(values));
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error.issues.map((i) => i.path[0]), values));
      save.reset();
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    submit();
  };

  const update = (field: Field) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValues((v) => ({ ...v, [field]: next }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const field = (name: Field) => {
    const id = `${ids}-${name}`;
    const errorId = `${id}-error`;
    return {
      id,
      errorId,
      props: {
        id,
        name,
        value: values[name],
        onChange: update(name),
        'aria-invalid': errors[name] ? true : undefined,
        'aria-describedby': errorId,
      },
    };
  };

  const failure =
    save.error &&
    !handledElsewhere(save.error) &&
    !hasErrorCode(save.error, ErrorCode.VALIDATION_FAILED) &&
    !hasErrorCode(save.error, ErrorCode.TICKET_TYPE_NOT_FOUND) &&
    !capacityConflictMessage(save.error)
      ? save.error
      : null;

  const name = field('name');
  const price = field('price');
  const capacity = field('capacity');
  const description = field('description');
  const saleStartsAt = field('saleStartsAt');
  const saleEndsAt = field('saleEndsAt');

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-section" data-slot="ticket-type-form">
      <DialogHeader>
        <DialogTitle>{editing ? 'Sửa Hạng vé' : 'Thêm Hạng vé'}</DialogTitle>
        <DialogDescription>Giá tính bằng đồng. Giờ Việt Nam (GMT+7).</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-stack">
        <Label htmlFor={name.id}>Tên Hạng vé</Label>
        <Input {...name.props} autoComplete="off" placeholder="vd. Đơn nam" />
        <FieldError id={name.errorId} message={errors.name} />
      </div>

      <div className="grid min-w-0 gap-stack sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-stack">
          <Label htmlFor={price.id}>Giá (đồng)</Label>
          <Input
            {...price.props}
            inputMode="numeric"
            autoComplete="off"
            placeholder="vd. 300000"
            className="tabular-nums"
            aria-describedby={`${price.id}-hint ${price.errorId}`}
          />
          <p id={`${price.id}-hint`} className="text-meta text-muted-foreground">
            0 nếu miễn phí; có phí từ {formatVnd(MIN_PAID_PRICE)}.
          </p>
          <FieldError id={price.errorId} message={errors.price} />
        </div>
        <div className="flex min-w-0 flex-col gap-stack">
          <Label htmlFor={capacity.id}>Số suất</Label>
          <Input {...capacity.props} inputMode="numeric" autoComplete="off" placeholder="vd. 100" className="tabular-nums" />
          <FieldError id={capacity.errorId} message={errors.capacity} />
        </div>
      </div>

      <div className="flex flex-col gap-stack">
        <Label htmlFor={description.id}>Mô tả Hạng vé (không bắt buộc)</Label>
        <Textarea {...description.props} rows={3} />
        <FieldError id={description.errorId} message={errors.description} />
      </div>

      <fieldset className="flex min-w-0 flex-col gap-stack">
        <legend className="text-label">Thời gian bán (không bắt buộc)</legend>
        <p className="text-meta text-muted-foreground">
          Để trống giờ mở: bán ngay khi Sự kiện mở bán. Để trống giờ đóng: bán đến khi Sự kiện kết thúc.
        </p>
        <div className="grid min-w-0 gap-stack sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-stack">
            <Label htmlFor={saleStartsAt.id}>Mở bán</Label>
            <Input {...saleStartsAt.props} type="datetime-local" />
            <FieldError id={saleStartsAt.errorId} message={errors.saleStartsAt} />
          </div>
          <div className="flex min-w-0 flex-col gap-stack">
            <Label htmlFor={saleEndsAt.id}>Đóng bán</Label>
            <Input {...saleEndsAt.props} type="datetime-local" />
            <FieldError id={saleEndsAt.errorId} message={errors.saleEndsAt} />
          </div>
        </div>
      </fieldset>

      {failure ? <StatusBanner tone="danger" title="Chưa lưu được Hạng vé" description={messageOf(failure)} /> : null}

      <DialogFooter>
        <Button type="submit" className="w-full" loading={save.isPending}>
          {editing ? 'Lưu' : 'Thêm'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (!save.isPending) onCancel();
          }}
        >
          Hủy
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Xóa Hạng vé
// ---------------------------------------------------------------------------------------------------------------

function DeleteDialog({
  orgId,
  eventId,
  target,
  returnFocusId,
  onClose,
}: {
  orgId: string;
  eventId: string;
  target: TicketTypeDetail | null;
  /** Nút nhận focus khi hàng vừa bị xóa (nút "Xóa" của hàng không còn trong DOM). */
  returnFocusId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  /** Hàng đã bị gỡ khỏi danh sách: khi đóng, focus sang `returnFocusId` thay vì nút "Xóa" đã mất (focus rơi về `body`). */
  const removed = useRef(false);

  const remove = useMutation({
    mutationFn: (t: TicketTypeDetail) => deleteTicketType(orgId, eventId, t.id),
    onSuccess: (_data, t) => {
      queryClient.setQueryData<TicketTypeDetail[]>(ticketTypesQueryKey(orgId, eventId), (list) =>
        list?.filter((x) => x.id !== t.id),
      );
      void queryClient.invalidateQueries({ queryKey: ticketTypesQueryKey(orgId, eventId) });
      void refreshEventSaleStatus(queryClient, orgId);
      toast.success(`Đã xóa ${t.name}.`);
      removed.current = true;
      onClose();
    },
    onError: (error) => {
      if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(error, ErrorCode.TICKET_TYPE_NOT_FOUND)) {
        toast.info('Hạng vé này không còn nữa.');
        void queryClient.invalidateQueries({ queryKey: ticketTypesQueryKey(orgId, eventId) });
        removed.current = true;
        onClose();
      } else if (hasErrorCode(error, ErrorCode.TICKET_TYPE_IN_USE)) {
        void queryClient.invalidateQueries({ queryKey: ticketTypesQueryKey(orgId, eventId) });
      }
    },
  });

  const inUse = hasErrorCode(remove.error, ErrorCode.TICKET_TYPE_IN_USE);
  // Lỗi không xóa được dù bấm lại (đã có người mua; Hạng vé cuối của Sự kiện đã mở bán): tắt "Xóa".
  const blocked = inUse || hasErrorCode(remove.error, ErrorCode.LAST_TICKET_TYPE);
  const failure =
    remove.error && !handledElsewhere(remove.error) && !hasErrorCode(remove.error, ErrorCode.TICKET_TYPE_NOT_FOUND)
      ? remove.error
      : null;

  const close = () => {
    if (remove.isPending) return;
    remove.reset();
    onClose();
  };

  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && close()}
      onCloseAutoFocus={(e) => {
        if (!removed.current) return;
        removed.current = false;
        e.preventDefault();
        document.getElementById(returnFocusId)?.focus();
      }}
      titleClassName="wrap-break-word"
      title={`Xóa Hạng vé ${target?.name}?`}
      description="Hạng vé và số suất của nó bị xóa khỏi Sự kiện, không khôi phục được. Chỉ xóa được Hạng vé chưa có Đơn nào."
      confirmLabel="Xóa"
      confirmDisabled={blocked}
      cancelLabel={blocked ? 'Đóng' : 'Hủy'}
      onConfirm={() => target && remove.mutate(target)}
      pending={remove.isPending}
      failureTitle="Chưa xóa được"
      failure={failure && (inUse ? TICKET_TYPE_IN_USE_MESSAGE : messageOf(failure))}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Giới hạn Vé/Đơn
// ---------------------------------------------------------------------------------------------------------------

const ORDER_LIMIT_MESSAGE = `Nhập số nguyên từ ${MAX_TICKETS_PER_ORDER_MIN} đến ${MAX_TICKETS_PER_ORDER_MAX}.`;

/**
 * Ô "Giới hạn Vé/Đơn" (không phải `<form>`: trong wizard nó nằm trong form của wizard). Enter trong ô thì lưu ô này,
 * không gửi form wizard. Rời ô (blur) với giá trị hợp lệ khác giá trị đã lưu cũng lưu, nên bấm "Tiếp"/"Lưu nháp"/"Quay
 * lại" của wizard ngay sau khi gõ không làm mất giá trị.
 */
function OrderLimitField({ orgId, event }: { orgId: string; event: EventDetail }) {
  const ids = useId();
  const inputId = `${ids}-limit`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  const [value, setValue] = useState(String(event.maxTicketsPerOrder));
  const [error, setError] = useState<string | undefined>();
  /** Giá trị đã lưu gần nhất: không gửi lại khi không đổi (vd. blur ngay trước khi bấm "Lưu"). */
  const lastSaved = useRef(event.maxTicketsPerOrder);

  const save = useMutation({
    mutationFn: (maxTicketsPerOrder: number) => updateOrderLimit(orgId, event.id, { maxTicketsPerOrder }),
    onSuccess: (saved) => {
      lastSaved.current = saved.maxTicketsPerOrder;
      queryClient.setQueryData(eventQueryKey(orgId, saved.id), saved);
      setValue(String(saved.maxTicketsPerOrder));
      toast.success('Đã lưu giới hạn Vé/Đơn.');
    },
    onError: (err) => {
      if (hasErrorCode(err, ErrorCode.UNAUTHENTICATED)) goToLogin();
      else if (hasErrorCode(err, ErrorCode.VALIDATION_FAILED)) setError(ORDER_LIMIT_MESSAGE);
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const parsed = EventOrderLimitInput.safeParse({ maxTicketsPerOrder: parseWholeNumber(value) });
    if (!parsed.success) {
      setError(ORDER_LIMIT_MESSAGE);
      save.reset();
      return;
    }
    setError(undefined);
    if (parsed.data.maxTicketsPerOrder === lastSaved.current) return;
    save.mutate(parsed.data.maxTicketsPerOrder);
  };

  /** Rời ô: chỉ lưu khi hợp lệ và khác giá trị đã lưu; giá trị sai để "Lưu"/Enter báo lỗi. */
  const onBlur = () => {
    if (save.isPending) return;
    const parsed = EventOrderLimitInput.safeParse({ maxTicketsPerOrder: parseWholeNumber(value) });
    if (!parsed.success || parsed.data.maxTicketsPerOrder === lastSaved.current) return;
    setError(undefined);
    save.mutate(parsed.data.maxTicketsPerOrder);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit();
  };

  const failure =
    save.error && !handledElsewhere(save.error) && !hasErrorCode(save.error, ErrorCode.VALIDATION_FAILED)
      ? save.error
      : null;

  return (
    <section
      aria-labelledby={`${ids}-title`}
      data-slot="order-limit"
      className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
    >
      <h3 id={`${ids}-title`} className="text-title">
        Giới hạn Vé/Đơn
      </h3>
      <Label htmlFor={inputId}>Số Vé tối đa mỗi Đơn</Label>
      <div className="flex min-w-0 items-start gap-stack">
        <Input
          id={inputId}
          name="maxTicketsPerOrder"
          inputMode="numeric"
          autoComplete="off"
          className="w-24 tabular-nums"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(undefined);
          }}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${hintId} ${errorId}`}
        />
        <Button type="button" variant="secondary" loading={save.isPending} onClick={submit}>
          Lưu
        </Button>
      </div>
      <p id={hintId} className="text-meta text-muted-foreground">
        Từ {MAX_TICKETS_PER_ORDER_MIN} đến {MAX_TICKETS_PER_ORDER_MAX} Vé, mặc định {MAX_TICKETS_PER_ORDER_DEFAULT}.
      </p>
      <FieldError id={errorId} message={error} />
      {failure ? <StatusBanner tone="danger" title="Chưa lưu được" description={messageOf(failure)} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Danh sách
// ---------------------------------------------------------------------------------------------------------------

function saleWindowText(t: TicketTypeDetail): string {
  const start = t.saleStartsAt ? `từ ${formatEventDateTime(t.saleStartsAt)}` : 'từ khi mở bán';
  const end = t.saleEndsAt ? `đến ${formatEventDateTime(t.saleEndsAt)}` : 'đến khi Sự kiện kết thúc';
  return `Bán ${start} ${end}`;
}

function TicketTypeRow({
  ticketType: t,
  onEdit,
  onDelete,
}: {
  ticketType: TicketTypeDetail;
  onEdit: (t: TicketTypeDetail) => void;
  onDelete: (t: TicketTypeDetail) => void;
}) {
  const committed = t.sold + t.held;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3" data-slot="ticket-type-row">
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <span className="text-body font-semibold wrap-break-word">{t.name}</span>
        <span className="text-body tabular-nums">
          <span data-slot="ticket-type-price">{t.price === 0 ? 'Miễn phí' : formatVnd(t.price)}</span>
          {' · '}
          <span data-slot="ticket-type-capacity">{t.capacity.toLocaleString('vi-VN')} suất</span>
        </span>
        <span className="text-meta text-muted-foreground tabular-nums">{saleWindowText(t)}</span>
        {committed > 0 ? (
          <span className="text-meta text-muted-foreground tabular-nums">
            Đã bán {t.sold} · Đang giữ chỗ {t.held}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" variant="secondary" size="sm" aria-label={`Sửa ${t.name}`} onClick={() => onEdit(t)}>
          Sửa
        </Button>
        <Button type="button" variant="secondary" size="sm" aria-label={`Xóa ${t.name}`} onClick={() => onDelete(t)}>
          Xóa
        </Button>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-24 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

type Editing = { kind: 'new' } | { kind: 'edit'; ticketType: TicketTypeDetail } | null;

/** Trình sửa Hạng vé của một Sự kiện, kèm ô "Giới hạn Vé/Đơn". */
export function TicketTypesEditor({ orgId, event }: { orgId: string; event: EventDetail }) {
  const titleId = useId();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<TicketTypeDetail | null>(null);
  const list = useQuery({
    queryKey: ticketTypesQueryKey(orgId, event.id),
    queryFn: ({ signal }) => fetchTicketTypes(orgId, event.id, signal),
  });

  let body;
  if (list.data) {
    body =
      list.data.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="Chưa có Hạng vé nào."
          description="Thêm Hạng vé với giá và số suất để bán vé."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.data.map((t) => (
            <TicketTypeRow
              key={t.id}
              ticketType={t}
              onEdit={(ticketType) => setEditing({ kind: 'edit', ticketType })}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      );
  } else if (list.isError && !handledElsewhere(list.error)) {
    body = (
      <StatusBanner
        tone="danger"
        title="Chưa tải được Hạng vé"
        description={messageOf(list.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void list.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else {
    body = <ListSkeleton />;
  }

  // Giữ nội dung form trong lúc `Dialog` đóng (hiệu ứng thoát); mở lại thì form mount mới.
  const [shownEditing, setShownEditing] = useState<Editing>(editing);
  if (editing && editing !== shownEditing) setShownEditing(editing);
  const closeForm = () => setEditing(null);
  const formTarget = shownEditing?.kind === 'edit' ? shownEditing.ticketType : null;

  return (
    <div className="grid min-w-0 items-start gap-section lg:grid-cols-[minmax(0,1fr)_18rem]" data-slot="ticket-types-editor">
      <section
        aria-labelledby={titleId}
        className="flex min-w-0 flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-stack">
          <h2 id={titleId} className="text-title">
            Hạng vé
          </h2>
          <Button
            id={`${titleId}-add`}
            type="button"
            variant="primary-on-light"
            size="sm"
            onClick={() => setEditing({ kind: 'new' })}
          >
            Thêm Hạng vé
          </Button>
        </div>
        {body}
      </section>

      <OrderLimitField orgId={orgId} event={event} />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent>
          {shownEditing ? (
            <TicketTypeForm
              key={formTarget?.id ?? 'new'}
              orgId={orgId}
              eventId={event.id}
              target={formTarget}
              onDone={closeForm}
              onCancel={closeForm}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <DeleteDialog
        orgId={orgId}
        eventId={event.id}
        target={deleting}
        returnFocusId={`${titleId}-add`}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
