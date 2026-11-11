import type { BuyerOrderOrganizer } from '@tickee/contracts';
import { Mail, Phone } from 'lucide-react';
import { useId } from 'react';

import { cn } from '@/lib/utils';

type OrganizerContactProps = {
  organizer: BuyerOrderOrganizer;
  className?: string;
};

/**
 * Khối liên hệ BTC của Trang Đơn (Story 3.7; DESIGN.md › order-card "khối liên hệ BTC"): tên BTC + SĐT, email liên hệ
 * BTC đã nhập khi tạo BTC (mở ứng dụng gọi điện / email). BTC không nhập kênh nào → chỉ còn tên. Không có nút chính.
 */
export function OrganizerContact({ organizer, className }: OrganizerContactProps) {
  const headingId = useId();
  const link = 'inline-flex min-h-6 items-center gap-2 self-start text-label text-foreground underline underline-offset-4';
  return (
    <section
      aria-labelledby={headingId}
      data-slot="organizer-contact"
      className={cn('flex flex-col gap-1 rounded-lg bg-card p-card-padding text-card-foreground shadow-card', className)}
    >
      <h2 id={headingId} className="text-meta text-muted-foreground">
        Liên hệ BTC
      </h2>
      <p data-slot="organizer-contact-name" className="text-label font-bold wrap-break-word">
        {organizer.name}
      </p>
      {organizer.contactPhone ? (
        <a data-slot="organizer-contact-phone" href={`tel:${organizer.contactPhone}`} className={cn(link, 'tabular-nums')}>
          <Phone aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {organizer.contactPhone}
        </a>
      ) : null}
      {organizer.contactEmail ? (
        <a data-slot="organizer-contact-email" href={`mailto:${organizer.contactEmail}`} className={cn(link, 'break-all')}>
          <Mail aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {organizer.contactEmail}
        </a>
      ) : null}
    </section>
  );
}
