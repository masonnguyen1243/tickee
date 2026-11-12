import { formatEventDateTime, formatVnDate, myTicketPath, type MyTicketStatus } from '@tickee/contracts';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

import { StatusBadge } from './status-badge';
import { TICKET_STATUS_BADGE } from './ticket-card';

type TicketRowCommon = {
  ticketId: string;
  eventName: string;
  /** Giờ bắt đầu Sự kiện (ISO). */
  startsAt: string;
  ticketTypeName: string;
  /** "Vé k/N". */
  seq: number;
  count: number;
};

type TicketRowProps = TicketRowCommon &
  (
    | {
        /** Vé còn hiệu lực: ngày-giờ, địa điểm, badge trạng thái. */
        status: MyTicketStatus;
        venue?: string | null;
        attended?: never;
      }
    | {
        /** Hàng lịch sử (Sự kiện đã kết thúc): ngày · "Đã tham dự" / "Chưa check-in", không badge. */
        attended: boolean;
        status?: never;
        venue?: never;
      }
  );

/**
 * Một dòng Vé của "Vé của tôi" (DESIGN.md › event-card, Story 3.9): nền `card`, tên Sự kiện, ngày-giờ (và địa điểm),
 * "Hạng vé · Vé k/N" + `status-badge` (Hợp lệ → success, Đã check-in → neutral, Đã hủy → danger); hàng lịch sử chỉ có
 * ngày và "Đã tham dự" / "Chưa check-in". Chạm cả dòng → Chi tiết Vé. Không bao giờ có Mã QR vé.
 */
export function TicketRow(props: TicketRowProps) {
  const { ticketId, eventName, startsAt, ticketTypeName, seq, count } = props;
  const history = props.attended !== undefined;
  const badge = props.status !== undefined ? TICKET_STATUS_BADGE[props.status] : null;
  const when = history
    ? `${formatVnDate(startsAt)} · ${props.attended ? 'Đã tham dự' : 'Chưa check-in'}`
    : formatEventDateTime(startsAt);
  return (
    <Link
      href={myTicketPath(ticketId)}
      data-slot="ticket-row"
      data-status={props.status}
      data-history={history ? 'true' : undefined}
      className="flex items-center gap-3 rounded-lg bg-card p-card-padding text-card-foreground shadow-card"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-title wrap-break-word">{eventName}</span>
        <span data-slot="ticket-row-when" className="text-meta text-muted-foreground tabular-nums">
          {when}
        </span>
        {props.venue ? <span className="text-meta text-muted-foreground wrap-break-word">{props.venue}</span> : null}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span data-slot="ticket-row-tier" className="text-meta wrap-break-word">
            {ticketTypeName} · Vé {seq}/{count}
          </span>
          {badge ? <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge> : null}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
