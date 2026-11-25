import type * as React from 'react';

import { progressRatio } from '@/lib/progress';
import { cn } from '@/lib/utils';

type ProgressBarProps = {
  /** Số đã xong (k). */
  value: number;
  /** Tổng (N). N = 0 → thanh rỗng. */
  max: number;
  /** Nhãn truy cập (`aria-label`), vd. tên Hạng vé. */
  label: string;
  /** Giá trị đọc cho trình đọc màn hình (`aria-valuetext`), vd. "3 trên 10 Vé đã check-in". */
  valueText?: string;
  /**
   * `stage`: trên `stat-card` (nền `stage-line`, phần đầy `brand`); `card`: trên `card` sáng (nền `surface-sunken`, phần
   * đầy `text` ở light mode / `brand` ở dark mode).
   */
  tone: 'stage' | 'card';
  className?: string;
} & Omit<React.ComponentProps<'div'>, 'children' | 'role'>;

/**
 * Thanh tiến độ (DESIGN.md › stat-card, checkin-progress; mock `key-dashboard-event.html`): cao 8px, bo tròn hết.
 * `role="progressbar"` với `aria-valuemin=0`, `aria-valuemax=N`, `aria-valuenow=k`, nhãn truy cập và giá trị đọc. Phần
 * đầy theo k/N (N = 0 → rỗng, không chia cho 0).
 */
export function ProgressBar({ value, max, label, valueText, tone, className, ...props }: ProgressBarProps) {
  const ratio = progressRatio(value, max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      data-slot="progress-bar"
      data-tone={tone}
      className={cn(
        'h-2 w-full overflow-hidden rounded-full',
        tone === 'stage' ? 'bg-stage-line' : 'bg-muted',
        className,
      )}
      {...props}
    >
      <div
        data-slot="progress-bar-fill"
        className={cn('h-full rounded-full', tone === 'stage' ? 'bg-primary' : 'bg-foreground dark:bg-primary')}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
