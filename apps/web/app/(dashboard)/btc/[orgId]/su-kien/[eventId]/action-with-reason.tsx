'use client';

import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Nút kèm lý do tắt hiện ngay dưới nút (luôn đọc được, không chỉ tooltip), dùng chung ở tab Check-in ("Sao chép link",
 * "Tạo link mới", "Khôi phục"). `children` nhận id của dòng lý do để gắn `aria-describedby` (không có lý do → `undefined`).
 */
export function ActionWithReason({
  reason,
  className,
  children,
}: {
  reason: string | null;
  className?: string;
  children: (reasonId?: string) => ReactNode;
}) {
  const reasonId = useId();
  return (
    <div className={cn('flex min-w-0 flex-col items-start gap-1', className)}>
      {children(reason ? reasonId : undefined)}
      {reason ? (
        <p id={reasonId} className="text-meta text-muted-foreground">
          {reason}
        </p>
      ) : null}
    </div>
  );
}
