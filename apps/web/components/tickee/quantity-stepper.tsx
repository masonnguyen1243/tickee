'use client';

import { Minus, Plus } from 'lucide-react';

import { cn } from '@/lib/utils';

type QuantityStepperProps = {
  /** Tên Hạng vé: aria-label "Giảm/Tăng số vé {Hạng vé}". */
  label: string;
  value: number;
  /** Trần của "+" (đã tính số còn lại và giới hạn Vé/Đơn còn lại). */
  max: number;
  onChange: (next: number) => void;
  /** Id của dòng giải thích trần "+" (vd. "Tối đa 4 vé mỗi Đơn"), gắn vào nút "+" bằng `aria-describedby`. */
  incrementDescribedBy?: string;
};

/**
 * Nút trong stepper: 34px, `rounded-sm`. Chạm trần/đáy thì mờ .45 và `aria-disabled` (không `disabled`): nút vẫn giữ
 * focus khi vừa bấm tới giới hạn, bàn phím không bị đẩy ra khỏi stepper.
 */
const stepButton = (enabled: boolean, increment: boolean) =>
  cn(
    'inline-flex size-stepper-button shrink-0 cursor-pointer items-center justify-center rounded-sm transition-opacity',
    increment && enabled ? 'bg-stage text-primary active:brightness-92' : 'text-foreground',
    !enabled && 'cursor-default opacity-45',
  );

/**
 * `quantity-stepper` (DESIGN.md): vỏ `surface-sunken` bo `md` đệm 3px; "−" · số (đậm, tabular) · "+". "+" đang bật nền
 * stage, icon coral. Số mới được đọc cho trình đọc màn hình (`aria-live`).
 */
export function QuantityStepper({ label, value, max, onChange, incrementDescribedBy }: QuantityStepperProps) {
  const canDecrease = value > 0;
  const canIncrease = value < max;
  return (
    <div
      role="group"
      aria-label={`Số vé ${label}`}
      data-slot="quantity-stepper"
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted p-[3px]"
    >
      <button
        type="button"
        aria-label={`Giảm số vé ${label}`}
        aria-disabled={!canDecrease || undefined}
        className={stepButton(canDecrease, false)}
        onClick={() => canDecrease && onChange(value - 1)}
      >
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <span
        data-slot="quantity-stepper-value"
        aria-live="polite"
        aria-atomic="true"
        className="min-w-6 text-center text-label font-bold tabular-nums"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`Tăng số vé ${label}`}
        aria-describedby={incrementDescribedBy}
        aria-disabled={!canIncrease || undefined}
        className={stepButton(canIncrease, true)}
        onClick={() => canIncrease && onChange(value + 1)}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
