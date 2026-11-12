import { formatVnDateTime } from '@tickee/contracts';
import { escapeHtml, type EmailMessage } from '../../platform/email/index.js';

/*
 * Mẫu email cho Người mua (Story 3.8, tiếng Việt): email Vé (mỗi Vé một link chia sẻ) và email báo tiền về muộn mà
 * Hạng vé đã hết (`orphan` `sold_out`). Bản text và bản HTML; mọi chuỗi đưa vào HTML qua `escapeHtml`. Không đính Mã QR
 * vé: QR nằm sau link chia sẻ. Link chứa token nên chỉ nằm trong nội dung email, không bao giờ vào log.
 */

const BODY_STYLE =
  "margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917";
const CARD_STYLE = 'max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px';
const P_STYLE = 'margin:0 0 16px;font-size:15px;line-height:1.5';
const MUTED_STYLE = 'margin:0 0 16px;font-size:13px;line-height:1.45;color:#5C5552';

function page(content: string): string {
  return `<!doctype html>
<html lang="vi">
  <body style="${BODY_STYLE}">
    <div style="${CARD_STYLE}">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
${content}
    </div>
  </body>
</html>`;
}

/** Một Vé trong email Vé: "Vé k/N · {Hạng vé}" và link chia sẻ của Vé (`{WEB_ORIGIN}/xem-ve#<token>`). */
export interface TicketEmailLine {
  seq: number;
  count: number;
  ticketTypeName: string;
  link: string;
}

export interface TicketsEmailInput {
  eventName: string;
  startsAt: Date;
  venue: string | null;
  orderCode: string;
  tickets: readonly TicketEmailLine[];
  /** Trang Đơn của web (`{WEB_ORIGIN}/orders/:code`, cần đăng nhập). */
  orderLink: string;
}

/**
 * Email Vé gửi tới email Người mua đã chụp trên Đơn: tên Sự kiện, giờ bắt đầu (giờ Việt Nam), địa điểm (nếu có), mã
 * Đơn, mỗi Vé một dòng "Vé k/N · {Hạng vé}" kèm link chia sẻ, và link về Trang Đơn.
 */
export function buildTicketsEmail(input: TicketsEmailInput): Omit<EmailMessage, 'to'> {
  const { eventName, startsAt, venue, orderCode, tickets, orderLink } = input;
  const time = `${formatVnDateTime(startsAt)} (giờ Việt Nam)`;
  const label = (t: TicketEmailLine) => `Vé ${t.seq}/${t.count} · ${t.ticketTypeName}`;
  const details = [`Thời gian: ${time}`, ...(venue ? [`Địa điểm: ${venue}`] : []), `Mã Đơn: ${orderCode}`];
  const howTo =
    'Mỗi Vé có một link riêng mở Mã QR vé để vào cổng. Gửi đúng link cho từng người đi cùng: ai có link là dùng được Vé đó.';

  const ticketItems = tickets
    .map(
      (t) =>
        `        <li style="margin:0 0 12px"><a href="${escapeHtml(t.link)}" style="font-size:15px;font-weight:700;color:#1C1917">${escapeHtml(label(t))}</a><br><span style="font-size:13px;color:#5C5552;word-break:break-all">${escapeHtml(t.link)}</span></li>`,
    )
    .join('\n');
  return {
    subject: `Vé của bạn · ${eventName}`,
    text: [
      `Vé của bạn cho ${eventName} đã sẵn sàng.`,
      '',
      ...details,
      '',
      howTo,
      '',
      ...tickets.flatMap((t) => [label(t), t.link]),
      '',
      `Xem Đơn của bạn: ${orderLink}`,
    ].join('\n'),
    html: page(`      <p style="${P_STYLE}">Vé của bạn cho <strong>${escapeHtml(eventName)}</strong> đã sẵn sàng.</p>
      <p style="${P_STYLE}">${details.map(escapeHtml).join('<br>')}</p>
      <p style="${P_STYLE}">${escapeHtml(howTo)}</p>
      <ul style="margin:0 0 16px;padding:0;list-style:none">
${ticketItems}
      </ul>
      <p style="${MUTED_STYLE}">Xem Đơn của bạn: <a href="${escapeHtml(orderLink)}" style="color:#1C1917">${escapeHtml(orderLink)}</a></p>`),
  };
}

/** Kênh liên hệ BTC (tên BTC, SĐT và email liên hệ đã nhập khi tạo BTC). */
export interface OrganizerContactLine {
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
}

export interface OrphanSoldOutEmailInput {
  eventName: string;
  orderCode: string;
  organizer: OrganizerContactLine;
}

/** Câu báo chính của email `orphan_sold_out`. */
export const ORPHAN_SOLD_OUT_MESSAGE = 'BTC đã nhận tiền nhưng Hạng vé đã hết, BTC sẽ liên hệ hoàn tiền.';

/**
 * Email báo Người mua khi tiền về muộn cho Đơn đã hết hạn mà Hạng vé đã hết (mục Cần xử lý `orphan` `sold_out`): câu báo
 * hoàn tiền, tên Sự kiện, mã Đơn và kênh liên hệ BTC.
 */
export function buildOrphanSoldOutEmail({ eventName, orderCode, organizer }: OrphanSoldOutEmailInput): Omit<
  EmailMessage,
  'to'
> {
  const contact = [
    `Liên hệ BTC: ${organizer.name}`,
    ...(organizer.contactPhone ? [`SĐT: ${organizer.contactPhone}`] : []),
    ...(organizer.contactEmail ? [`Email: ${organizer.contactEmail}`] : []),
  ];
  const details = [`Sự kiện: ${eventName}`, `Mã Đơn: ${orderCode}`];
  return {
    subject: `Đơn ${orderCode}: BTC sẽ liên hệ hoàn tiền`,
    text: [ORPHAN_SOLD_OUT_MESSAGE, '', ...details, '', ...contact].join('\n'),
    html: page(`      <p style="${P_STYLE}">${escapeHtml(ORPHAN_SOLD_OUT_MESSAGE)}</p>
      <p style="${P_STYLE}">${details.map(escapeHtml).join('<br>')}</p>
      <p style="${P_STYLE}">${contact.map(escapeHtml).join('<br>')}</p>`),
  };
}
