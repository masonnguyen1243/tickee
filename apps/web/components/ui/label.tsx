'use client';

import { Label as LabelPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/** Nhãn form luôn hiện (WCAG 2.2 AA), cỡ `label`. */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('flex items-center gap-2 text-label select-none peer-disabled:opacity-45', className)}
      {...props}
    />
  );
}

export { Label };
