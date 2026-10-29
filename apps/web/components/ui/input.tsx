import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Ô nhập theo DESIGN.md: nền `surface-sunken`, chữ 16px (Safari iOS không tự zoom), viền `ring` khi focus.
 * Focus ring 2px do quy tắc `:focus-visible` toàn cục, nên không dùng `outline-none`.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-control-height w-full min-w-0 rounded-md border border-transparent bg-muted px-3 text-input text-foreground placeholder:text-muted-foreground focus:border-ring disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-danger-text',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
