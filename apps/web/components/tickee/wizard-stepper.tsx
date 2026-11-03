import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

type WizardStepperProps = {
  /** Tên các bước theo thứ tự. */
  steps: readonly string[];
  /** Bước hiện tại, tính từ 0. */
  current: number;
  /** Nhãn của cả danh sách bước (vd. "Các bước tạo Sự kiện"). */
  label: string;
  className?: string;
};

/**
 * `wizard-stepper` (DESIGN.md): hàng các bước ở đầu form, số bước trong vòng tròn 28px. Bước hiện tại nền stage (dark mode
 * thành coral như `button-primary-on-light`), bước xong dấu tích `success-text`, bước sau `muted`. Dưới `md` thu thành
 * một dòng "Bước 1/4 · Thông tin".
 */
export function WizardStepper({ steps, current, label, className }: WizardStepperProps) {
  return (
    <nav aria-label={label} data-slot="wizard-stepper" className={cn('min-w-0', className)}>
      <p className="text-label md:hidden" aria-current="step">
        Bước {current + 1}/{steps.length} · {steps[current]}
      </p>
      <ol className="hidden items-center gap-3 md:flex">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              data-state={done ? 'done' : active ? 'current' : 'upcoming'}
              className="flex min-w-0 items-center gap-2"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-label tabular-nums',
                  active && 'bg-btn-on-light text-btn-on-light-foreground',
                  done && 'bg-success-subtle text-success-text',
                  !active && !done && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="size-4" /> : index + 1}
              </span>
              <span className={cn('truncate text-label', !active && 'text-muted-foreground')}>
                {step}
                {done ? <span className="sr-only"> (đã xong)</span> : null}
              </span>
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="h-px w-6 shrink-0 bg-border lg:w-10" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
