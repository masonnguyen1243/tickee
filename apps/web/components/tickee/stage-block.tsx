import type * as React from 'react';

import { cn } from '@/lib/utils';

type StageBlockProps = React.ComponentProps<'section'>;

/**
 * Khối "sân khấu" gần đen, có ở cả light và dark. Bên trong được dùng coral (`text-primary`, `button-primary`),
 * chữ phụ `text-stage-muted`. Mỗi màn Người mua tối đa một stage block lớn.
 */
export function StageBlock({ className, ...props }: StageBlockProps) {
  return (
    <section
      data-slot="stage-block"
      className={cn('rounded-lg bg-stage p-gutter-mobile text-stage-foreground', className)}
      {...props}
    />
  );
}
