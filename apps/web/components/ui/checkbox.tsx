'use client';

import { CheckIcon } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

// shadcn (new-york) trên `Checkbox` của radix-ui. Ô 20px nhưng vùng chạm do `Label` bao quanh mở rộng.

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-5 shrink-0 cursor-pointer rounded-sm border-2 border-muted-foreground bg-card disabled:cursor-not-allowed disabled:opacity-45 data-[state=checked]:border-btn-on-light data-[state=checked]:bg-btn-on-light data-[state=checked]:text-btn-on-light-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center">
        <CheckIcon aria-hidden="true" className="size-4" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
