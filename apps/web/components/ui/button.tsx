'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2Icon } from 'lucide-react';
import { Slot } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/*
 * Nút theo DESIGN.md § Components › Nút. Focus ring do quy tắc `:focus-visible` toàn cục (globals.css),
 * nên không dùng `outline-none` ở đây.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-button transition-[filter,background-color,color,opacity] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        /** Coral — CHỈ trên stage, bar, dashboard-sidebar, hero landing hoặc nền dark mode. */
        primary: 'bg-primary text-primary-foreground active:brightness-92',
        /** Nút chính trên nền sáng: nền stage; dark mode tự thành `primary` qua biến. */
        'primary-on-light': 'bg-btn-on-light text-btn-on-light-foreground active:brightness-92',
        secondary: 'bg-card text-card-foreground shadow-card active:brightness-95',
        destructive: 'bg-destructive text-destructive-foreground active:brightness-92',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-brand-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-control-height px-5',
        sm: 'h-10 px-3 text-label font-bold',
        icon: 'size-icon-button',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: {
      variant: 'primary-on-light',
      size: 'default',
    },
  },
);

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * Nút đang gọi mạng: spinner trong nút, giữ độ rộng, bỏ qua bấm lặp, `aria-busy`.
     * Không `disabled` để giữ focus và tránh đổi màu. Không dùng cùng `asChild`.
     */
    loading?: boolean;
  };

function Button({ className, variant, size, asChild = false, loading = false, onClick, children, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));

  if (asChild) {
    return (
      <Slot.Root data-slot="button" className={classes} onClick={onClick} {...props}>
        {children}
      </Slot.Root>
    );
  }

  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    if (loading) {
      // Chặn cả submit form khi đang gửi.
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      data-slot="button"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      className={classes}
      onClick={handleClick}
      {...props}
    >
      {/* Nhãn luôn render để độ rộng không đổi; khi loading ẩn bằng `opacity-0` để vẫn nằm trong cây a11y
          (tên nút thành "<nhãn> Đang xử lý"). */}
      <span className={cn('inline-flex items-center justify-center gap-2', loading && 'opacity-0')}>{children}</span>
      {loading ? (
        <span data-slot="button-spinner" className="absolute inset-0 flex items-center justify-center">
          <Loader2Icon aria-hidden="true" className="size-5 animate-spin" />
          <span className="sr-only">Đang xử lý</span>
        </span>
      ) : null}
    </button>
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
