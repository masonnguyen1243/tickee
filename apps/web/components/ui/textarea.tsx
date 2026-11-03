import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Ô nhập nhiều dòng, cùng kiểu với `Input` (DESIGN.md): nền `surface-sunken`, chữ 16px (quy tắc `textarea` ở base layer; Safari iOS không tự zoom),
 * viền `ring` khi focus, viền `danger-text` khi `aria-invalid`. Focus ring 2px do quy tắc `:focus-visible` toàn cục.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'min-h-28 w-full min-w-0 rounded-md border border-transparent bg-muted px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-ring disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-danger-text',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
