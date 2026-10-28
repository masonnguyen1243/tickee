import { cn } from '@/lib/utils';

import { toneClasses, type StatusTone } from './tone';

type StatusBadgeProps = {
  tone: StatusTone;
  /** Luôn có chữ — không bao giờ chỉ chấm màu. */
  children: string;
  className?: string;
};

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-label', toneClasses[tone], className)}
    >
      {children}
    </span>
  );
}
