import type * as React from 'react';

import { cn } from '@/lib/utils';

/** `Skeleton` của shadcn (DESIGN.md › Components: dùng nguyên trạng): khối xám nhấp nháy giữ chỗ khi đang tải. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div aria-hidden="true" data-slot="skeleton" className={cn('animate-pulse rounded-lg bg-muted', className)} {...props} />
  );
}

export { Skeleton };
