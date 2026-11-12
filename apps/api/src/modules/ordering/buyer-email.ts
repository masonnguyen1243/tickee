import { formatEventTimeRange, formatVnDateTime } from '@tickee/contracts';
import { escapeHtml, type EmailMessage } from '../../platform/email/index.js';

/*
 * Mẫu email cho Người mua (tiếng Việt): email Vé (mỗi Vé một link chia sẻ) và email báo tiền về muộn mà Hạng vé đã hết
 * (`orphan` `sold_out`) của Story 3.8; email báo Sự kiện đổi giờ hoặc địa điểm của Story 3.10. Bản text và bản HTML; mọi
 * chuỗi đưa vào HTML qua `escapeHtml`. Không đính Mã QR vé: QR nằm sau link chia sẻ. Link chứa token nên chỉ nằm trong
 * nội dung email, không bao giờ vào log.
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
  /** Trang "Vé của tôi" của web (`{WEB_ORIGIN}/tickets`, cần đăng nhập, Story 3.9). */
  myTicketsLink: string;
}

/**
 * Email Vé gửi tới email Người mua đã chụp trên Đơn: tên Sự kiện, giờ bắt đầu (giờ Việt Nam), địa điểm (nếu có), mã
 * Đơn, mỗi Vé một dòng "Vé k/N · {Hạng vé}" kèm link chia sẻ, link về Trang Đơn và link "Vé của tôi" (Story 3.9).
 */
export function buildTicketsEmail(input: TicketsEmailInput): Omit<EmailMessage, 'to'> {
  const { eventName, startsAt, venue, orderCode, tickets, orderLink, myTicketsLink } = input;
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
      `Mọi Vé của bạn ở Vé của tôi: ${myTicketsLink}`,
    ].join('\n'),
    html: page(`      <p style="${P_STYLE}">Vé của bạn cho <strong>${escapeHtml(eventName)}</strong> đã sẵn sàng.</p>
      <p style="${P_STYLE}">${details.map(escapeHtml).join('<br>')}</p>
      <p style="${P_STYLE}">${escapeHtml(howTo)}</p>
      <ul style="margin:0 0 16px;padding:0;list-style:none">
${ticketItems}
      </ul>
      <p style="${MUTED_STYLE}">Xem Đơn của bạn: <a href="${escapeHtml(orderLink)}" style="color:#1C1917">${escapeHtml(orderLink)}</a></p>
      <p style="${MUTED_STYLE}">Mọi Vé của bạn ở Vé của tôi: <a href="${escapeHtml(myTicketsLink)}" style="color:#1C1917">${escapeHtml(myTicketsLink)}</a></p>`),
  };
}

/** Kênh liên hệ BTC (tên BTC, SĐT và email liên hệ đã nhập khi tạo BTC). */
export interface OrganizerContactLine {
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
}

/** Các dòng kênh liên hệ BTC: tên, rồi SĐT và email nếu BTC đã nhập. */
function organizerContactLines(organizer: OrganizerContactLine): string[] {
  return [
    `Liên hệ BTC: ${organizer.name}`,
    ...(organizer.contactPhone ? [`SĐT: ${organizer.contactPhone}`] : []),
    ...(organizer.contactEmail ? [`Email: ${organizer.contactEmail}`] : []),
  ];
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
  const contact = organizerContactLines(organizer);
  const details = [`Sự kiện: ${eventName}`, `Mã Đơn: ${orderCode}`];
  return {
    subject: `Đơn ${orderCode}: BTC sẽ liên hệ hoàn tiền`,
    text: [ORPHAN_SOLD_OUT_MESSAGE, '', ...details, '', ...contact].join('\n'),
    html: page(`      <p style="${P_STYLE}">${escapeHtml(ORPHAN_SOLD_OUT_MESSAGE)}</p>
      <p style="${P_STYLE}">${details.map(escapeHtml).join('<br>')}</p>
      <p style="${P_STYLE}">${contact.map(escapeHtml).join('<br>')}</p>`),
  };
}

export interface EventChangeEmailInput {
  eventName: string;
  /** Giờ và địa điểm hiện tại của Sự kiện lúc gửi (không phải giá trị cũ). */
  startsAt: Date;
  endsAt: Date;
  venue: string | null;
  /** Trang "Vé của tôi" của web (`{WEB_ORIGIN}/tickets`, cần đăng nhập, Story 3.9). */
  myTicketsLink: string;
  organizer: OrganizerContactLine;
}

/** Dòng báo Vé không đổi của email đổi giờ/địa điểm. */
export const EVENT_CHANGE_TICKETS_VALID = 'Vé của bạn vẫn dùng được, không cần làm gì thêm.';
/** Sự kiện chưa có địa điểm (`venue` trống). */
export const VENUE_NOT_ANNOUNCED = 'BTC chưa công bố địa điểm';

/**
 * Email báo Người mua khi Sự kiện đổi giờ hoặc địa điểm (Story 3.10, mẫu A của Mason: chỉ thông tin mới, không "trước →
 * sau"), theo thứ tự: BTC vừa cập nhật; thời gian hiện tại (khoảng giờ, giờ Việt Nam); địa điểm hiện tại (trống → "BTC
 * chưa công bố địa điểm"); Vé vẫn dùng được; link "Vé của tôi"; kênh liên hệ BTC.
 */
export function buildEventChangeEmail(input: EventChangeEmailInput): Omit<EmailMessage, 'to'> {
  const { eventName, startsAt, endsAt, venue, myTicketsLink, organizer } = input;
  const intro = `BTC ${organizer.name} vừa cập nhật thời gian hoặc địa điểm của ${eventName}.`;
  const details = [
    `Thời gian: ${formatEventTimeRange(startsAt.toISOString(), endsAt.toISOString())} (giờ Việt Nam)`,
    `Địa điểm: ${venue ?? VENUE_NOT_ANNOUNCED}`,
  ];
  const myTickets = `Vé của tôi: ${myTicketsLink}`;
  const contact = organizerContactLines(organizer);
  return {
    subject: `Sự kiện đổi giờ hoặc địa điểm · ${eventName}`,
    text: [intro, '', ...details, '', EVENT_CHANGE_TICKETS_VALID, '', myTickets, '', ...contact].join('\n'),
    html: page(`      <p style="${P_STYLE}">BTC ${escapeHtml(organizer.name)} vừa cập nhật thời gian hoặc địa điểm của <strong>${escapeHtml(eventName)}</strong>.</p>
      <p style="${P_STYLE}">${details.map(escapeHtml).join('<br>')}</p>
      <p style="${P_STYLE}">${escapeHtml(EVENT_CHANGE_TICKETS_VALID)}</p>
      <p style="${P_STYLE}">Vé của tôi: <a href="${escapeHtml(myTicketsLink)}" style="color:#1C1917">${escapeHtml(myTicketsLink)}</a></p>
      <p style="${MUTED_STYLE}">${contact.map(escapeHtml).join('<br>')}</p>`),
  };
}
