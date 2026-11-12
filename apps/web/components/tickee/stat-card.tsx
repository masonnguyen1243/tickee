import type * as React from 'react';

import { cn } from '@/lib/utils';

import { StageBlock } from './stage-block';

type StatCardProps = {
  /** Nhãn (vd. "Doanh thu"). */
  label: string;
  /** Giá trị đã định dạng (vd. "300.000đ"). */
  value: string;
  /** Dòng phụ dưới giá trị (vd. "Chỉ tính Đơn Đã thanh toán · 3 Đơn"). */
  caption?: React.ReactNode;
  className?: string;
} & Omit<React.ComponentProps<'section'>, 'children'>;

/**
 * Thẻ số liệu nổi bật của Tổng quan Sự kiện (DESIGN.md › stat-card): `stage-block`, nhãn `label` màu `stage-muted`, giá
 * trị cỡ headline `tabular-nums`, dòng phụ `meta`. Dashboard tối đa 1–2 `stat-card` tối mỗi màn; số liệu phụ dùng
 * `card` sáng.
 */
export function StatCard({ label, value, caption, className, ...props }: StatCardProps) {
  return (
    <StageBlock data-slot="stat-card" className={cn('flex flex-col gap-1', className)} {...props}>
      <p data-slot="stat-card-label" className="text-label text-stage-muted">
        {label}
      </p>
      <p data-slot="stat-card-value" className="text-headline tabular-nums">
        {value}
      </p>
      {caption ? (
        <p data-slot="stat-card-caption" className="text-meta text-stage-muted">
          {caption}
        </p>
      ) : null}
    </StageBlock>
  );
}
