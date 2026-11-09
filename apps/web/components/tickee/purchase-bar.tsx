import type * as React from 'react';

import { cn } from '@/lib/utils';

type PurchaseBarProps = {
  /** Dòng trên, chữ phụ: "Tổng · 2 vé", "Chọn vé để tiếp tục", hoặc thông báo thay cả thanh ("Hết vé"). */
  caption: string;
  /** Dòng dưới, cỡ `total`: "300.000đ" / "Miễn phí". Không có → chỉ một dòng `caption`. */
  total?: string;
  /** Nút chính bên phải (`button-primary` ~140px): "Mua", "Đăng ký"; Checkout (3.2) đặt "Gửi Đơn". */
  action?: React.ReactNode;
  className?: string;
};

/**
 * `purchase-bar` (DESIGN.md): nền `bar`, bo `xl`, chữ `stage-foreground`. < `lg`: nổi dính đáy, cách mép 10px +
 * safe-area; trang tự chừa đáy bằng chiều cao thanh và `scroll-padding-bottom` (globals.css, theo `data-slot`) nên focus
 * và nội dung cuối trang không bị che. ≥ `lg`: nằm trong luồng (vd. dưới danh sách Hạng vé ở cột phải đang sticky).
 */
export function PurchaseBar({ caption, total, action, className }: PurchaseBarProps) {
  return (
    <div
      data-slot="purchase-bar"
      className={cn(
        'fixed inset-x-[10px] bottom-[calc(10px+env(safe-area-inset-bottom))] z-40 mx-auto flex min-h-purchase-bar max-w-content-max-buyer items-center justify-between gap-3.5 rounded-xl bg-bar py-2.5 pr-2.5 pl-4.5 text-stage-foreground',
        'lg:static lg:inset-auto lg:mx-0 lg:max-w-none',
        className,
      )}
    >
      <div className="min-w-0">
        <p
          data-slot="purchase-bar-caption"
          className={cn('tabular-nums', total ? 'text-meta text-stage-muted' : 'text-label')}
        >
          {caption}
        </p>
        {total ? (
          <p data-slot="purchase-bar-total" className="text-total tabular-nums">
            {total}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
