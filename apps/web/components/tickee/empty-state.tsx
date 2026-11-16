import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  /** Câu mô tả; bỏ khi tiêu đề đã đủ nghĩa (vd. "Không có gì cần xử lý."). */
  description?: string;
  /** Tối đa một nút. */
  action?: React.ReactElement;
  className?: string;
};

/** Icon line 40px màu muted, một câu tiêu đề, tối đa một câu mô tả, tối đa một nút. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn('flex flex-col items-center gap-2 py-section text-center', className)}>
      <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-button text-muted-foreground" />
      <p className="text-title">{title}</p>
      {description ? <p className="text-body text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
