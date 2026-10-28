import { CircleCheck, Info, OctagonAlert, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { toneClasses, type StatusTone } from './tone';

/** Icon khác hình theo tone để không chỉ dựa vào màu: tích tròn · tam giác · bát giác · i tròn. */
const toneIcons: Record<StatusTone, LucideIcon> = {
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
  neutral: Info,
};

type StatusBannerProps = {
  tone: StatusTone;
  title: string;
  description?: string;
  /** Tối đa một hành động, dạng link/ghost (vd. `<Button variant="link" size="sm">`). */
  action?: React.ReactElement;
  /** Chỉ truyền khi banner đóng được. */
  onDismiss?: () => void;
  className?: string;
};

export function StatusBanner({ tone, title, description, action, onDismiss, className }: StatusBannerProps) {
  const Icon = toneIcons[tone];
  return (
    <div
      role="status"
      data-slot="status-banner"
      data-tone={tone}
      className={cn('flex items-start gap-3 rounded-md p-card-padding', toneClasses[tone], className)}
    >
      <Icon aria-hidden="true" data-slot="status-banner-icon" className="mt-px size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-48">
          <p className="text-label">{title}</p>
          {description ? <p className="text-meta">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0 [&_[data-slot=button]]:text-current">{action}</div> : null}
      </div>
      {onDismiss ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Đóng thông báo"
          onClick={onDismiss}
          className="-my-2.5 -mr-2.5 text-current hover:bg-transparent hover:text-current"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
