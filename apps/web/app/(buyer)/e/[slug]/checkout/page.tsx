import {
  checkoutPath,
  ErrorCode,
  eventPagePath,
  FUNNEL_ID_PARAM,
  SELECTION_PARAM,
  type PublicEvent,
} from '@tickee/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { hasErrorCode } from '@/lib/auth/api';
import { fetchPublicEvent } from '@/lib/event/public-api';
import {
  checkoutLines,
  checkoutSelection,
  priceLabel,
  selectionItems,
  selectionTotals,
  withSelection,
  type CheckoutLine,
} from '@/lib/event/selection';

import { CheckoutGate } from './checkout-gate';
import { CheckoutOrderForm } from './checkout-order-form';

export const metadata: Metadata = { title: 'Checkout · Tickee', robots: { index: false, follow: false } };

type CheckoutPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Phần tĩnh của Sự kiện (cùng cache 30 giây + tag với trang Sự kiện). Nháp/slug sai → về `/e/{slug}` (trang 404). */
async function loadEvent(slug: string): Promise<PublicEvent> {
  try {
    return await fetchPublicEvent(slug);
  } catch (error) {
    if (hasErrorCode(error, ErrorCode.EVENT_NOT_FOUND)) redirect(eventPagePath(slug));
    throw error;
  }
}

function SummaryLine({ line }: { line: CheckoutLine }) {
  return (
    <li data-slot="order-summary-line" className="flex items-start justify-between gap-3 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-label font-bold">{line.name}</p>
        <p className="text-meta text-muted-foreground tabular-nums">
          {line.quantity} × {priceLabel(line.price)}
        </p>
      </div>
      <span className="shrink-0 text-label font-bold tabular-nums">{priceLabel(line.amount)}</span>
    </li>
  );
}

/**
 * Checkout `/e/{slug}/checkout?items=…`: bề mặt cần đăng nhập, tóm tắt Đơn + "Sửa lựa chọn" (Story 3.1) và form mua một
 * lần cho cả Đơn với "Gửi Đơn" ở `purchase-bar` (Story 3.2). Server hợp lệ hóa `items` theo phần tĩnh của Sự kiện (sai,
 * hoặc Sự kiện không bán → về `/e/{slug}`); chặn chưa đăng nhập, ghi `login_completed` và giữ `funnelId` ở trình duyệt
 * (`checkout-gate.tsx`); câu hỏi form và phần tự điền tải ở trình duyệt (`checkout-order-form.tsx`).
 */
export default async function CheckoutPage({ params, searchParams }: CheckoutPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const event = await loadEvent(slug);
  const selection = checkoutSelection(event, query[SELECTION_PARAM], new Date());
  if (!selection) redirect(eventPagePath(slug));

  const lines = checkoutLines(selection, event.ticketTypes);
  const { count, amount } = selectionTotals(selection, event.ticketTypes);
  const funnel = z.uuid().safeParse(query[FUNNEL_ID_PARAM]);

  return (
    <CheckoutGate
      slug={slug}
      funnelId={funnel.success ? funnel.data : null}
      hasFunnelParam={query[FUNNEL_ID_PARAM] !== undefined}
      checkoutHref={withSelection(checkoutPath(slug), selection, event.ticketTypes)}
    >
      <div className="flex flex-col gap-section pt-2">
        <div className="flex flex-col gap-1">
          <p className="text-meta text-muted-foreground">{event.name}</p>
          <h1 className="text-headline">Tóm tắt Đơn</h1>
        </div>
        <section
          aria-labelledby="order-summary-heading"
          data-slot="order-summary"
          className="flex flex-col rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="order-summary-heading" className="text-title">
              Vé đã chọn
            </h2>
            <Button asChild variant="link" size="sm">
              <Link href={withSelection(eventPagePath(slug), selection, event.ticketTypes)}>Sửa lựa chọn</Link>
            </Button>
          </div>
          <ul className="flex flex-col divide-y">
            {lines.map((line) => (
              <SummaryLine key={line.ticketTypeId} line={line} />
            ))}
          </ul>
          <div className="flex items-baseline justify-between gap-3 border-t pt-3">
            <span data-slot="order-summary-count" className="text-meta text-muted-foreground tabular-nums">
              Tổng · {count} vé
            </span>
            <span data-slot="order-summary-total" className="text-total tabular-nums">
              {priceLabel(amount)}
            </span>
          </div>
        </section>
        <CheckoutOrderForm
          slug={slug}
          organizationName={event.organizationName}
          ticketTypes={event.ticketTypes}
          items={selectionItems(selection, event.ticketTypes)}
          count={count}
          amount={amount}
        />
      </div>
    </CheckoutGate>
  );
}
