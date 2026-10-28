import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Tối đa một nút. */
  action?: React.ReactElement;
  className?: string;
};

/** Icon line 40px màu muted, một câu tiêu đề, một câu mô tả, tối đa một nút. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn('flex flex-col items-center gap-2 py-section text-center', className)}>
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-button text-muted-foreground" />
      <p className="text-title">{title}</p>
      <p className="text-body text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
