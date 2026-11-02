'use client';

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import type * as React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { useTheme } from '@/lib/use-theme';

// shadcn nguyên trạng, chỉ thay `next-themes` bằng `useTheme` (theme đang dùng: lựa chọn ở nút chuyển giao diện, chưa
// chọn thì theo hệ thống; đổi 02/11/2026) và Việt hóa nhãn a11y mặc định của Sonner.
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      containerAriaLabel="Thông báo"
      toastOptions={{ closeButtonAriaLabel: 'Đóng thông báo' }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
