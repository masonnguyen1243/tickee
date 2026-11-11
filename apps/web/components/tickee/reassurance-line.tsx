import { ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Copy chuẩn của "Chờ lâu" (EXPERIENCE › State Patterns). */
export const REASSURANCE_TEXT = 'Nếu bạn đã chuyển, vé sẽ về trong vài phút — đừng chuyển lại.';

/**
 * `reassurance-line` (DESIGN.md › payment-summary): khi Người mua đã chờ lâu ở màn chờ thanh toán, khối stage nhỏ
 * `rounded-lg` padding 14px, icon coral, chữ `stage-foreground` weight 500 thay dòng chờ, để không ai chuyển tiền hai lần.
 * Người gọi đặt nó trong vùng `aria-live="polite"` để trình đọc màn hình đọc khi nó xuất hiện.
 */
export function ReassuranceLine({ className }: { className?: string }) {
  return (
    <p
      data-slot="reassurance-line"
      className={cn('flex items-start gap-2.5 rounded-lg bg-stage p-[14px] text-label font-medium text-stage-foreground', className)}
    >
      <ShieldCheck aria-hidden="true" className="mt-px size-5 shrink-0 text-primary" />
      <span>{REASSURANCE_TEXT}</span>
    </p>
  );
}
