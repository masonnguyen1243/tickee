import type { PaymentRecipient } from '@tickee/contracts';
import { ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

type RecipientTrustBlockProps = {
  recipient: PaymentRecipient;
  className?: string;
};

/**
 * `recipient-trust-block` (DESIGN.md › payment-summary, EXPERIENCE › Niềm tin khi thanh toán): thẻ sáng ngay dưới stage,
 * tín hiệu tin cậy chính trước khi Người mua rời sang trang Tingee. Icon khiên coral trong ô stage + "Tiền chuyển thẳng
 * cho {BTC}"; hai hàng khóa–giá trị cách bằng đường chia: "Chủ tài khoản" (in hoa như app ngân hàng) và "Ngân hàng".
 * BTC không còn tài khoản nhận tiền → không có hai hàng đó. Tĩnh, không tương tác.
 */
export function RecipientTrustBlock({ recipient, className }: RecipientTrustBlockProps) {
  const rows = [
    { label: 'Chủ tài khoản', value: recipient.accountName, slot: 'recipient-account-name' },
    { label: 'Ngân hàng', value: recipient.bankName, slot: 'recipient-bank-name' },
  ].filter((row): row is { label: string; value: string; slot: string } => Boolean(row.value));

  return (
    <section
      aria-label="Người nhận tiền"
      data-slot="recipient-trust-block"
      className={cn('flex flex-col rounded-lg bg-card p-card-padding text-card-foreground shadow-card', className)}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-icon-button shrink-0 items-center justify-center rounded-md bg-stage text-primary"
        >
          <ShieldCheck className="size-5" />
        </span>
        <p data-slot="recipient-headline" className="min-w-0 text-title font-medium wrap-break-word">
          Tiền chuyển thẳng cho <strong className="font-bold">{recipient.organizationName}</strong>
        </p>
      </div>
      {rows.length > 0 ? (
        <dl className="mt-3 flex flex-col divide-y border-t">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 py-2 last:pb-0">
              <dt className="shrink-0 text-meta text-muted-foreground">{row.label}</dt>
              <dd data-slot={row.slot} className="min-w-0 text-right text-label wrap-break-word">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
