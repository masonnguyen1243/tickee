import type { EmailMessage } from '../../platform/email/index.js';

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const CHANGED_AT_FORMAT = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Tài khoản nhận tiền như email hiển thị: tên ngân hàng và 4 số cuối (không bao giờ có số đầy đủ). */
export interface PayoutAccountLabel {
  bankName: string;
  accountLast4: string;
}

/**
 * Vì sao tài khoản mặc định đổi: Owner đặt mặc định hoặc hủy liên kết (`default_changed`), hoặc Owner đổi key Tingee
 * (`tingee_key_replaced`, Story 2.13-b: mọi tài khoản nhận tiền cũ bị hủy liên kết, tài khoản đã chọn thành mặc định).
 */
export const DEFAULT_PAYOUT_CHANGE_REASONS = ['default_changed', 'tingee_key_replaced'] as const;
export type DefaultPayoutChangeReason = (typeof DEFAULT_PAYOUT_CHANGE_REASONS)[number];

export interface DefaultPayoutChangedEmailInput {
  organizationName: string;
  /** Mặc định `default_changed`. */
  reason?: DefaultPayoutChangeReason;
  /** `null`: trước thay đổi BTC chưa có tài khoản nhận tiền nào (đã hủy hết rồi mới đổi key Tingee). */
  previous: PayoutAccountLabel | null;
  /** `null`: tài khoản mặc định cuối cùng vừa bị hủy liên kết, BTC không còn tài khoản nhận tiền. */
  next: PayoutAccountLabel | null;
  /** Tên (hoặc email nếu tài khoản chưa có tên) của người đổi. */
  actor: string;
  changedAt: Date;
}

/** Cụm hiển thị một tài khoản nhận tiền, vd. `MB Bank ••••4321`. */
export const payoutAccountLabel = (account: PayoutAccountLabel): string =>
  `${account.bankName} ••••${account.accountLast4}`;

const NO_ACCOUNT = 'không còn tài khoản nhận tiền';
const NO_PREVIOUS_ACCOUNT = 'chưa có tài khoản nhận tiền';

/**
 * Email cảnh báo tài khoản nhận tiền mặc định của BTC vừa đổi (Story 2.13-a), gửi Owner và mọi Admin: tên BTC, tài
 * khoản cũ (hoặc "chưa có tài khoản nhận tiền") → mới (hoặc "không còn tài khoản nhận tiền"), người đổi, giờ Việt Nam
 * và việc cần làm nếu không phải người trong BTC đổi. Đổi key Tingee (2.13-b) thì tiêu đề và câu mở đầu nói key Tingee
 * của BTC vừa đổi và mọi tài khoản nhận tiền cũ đã bị hủy liên kết (đổi key cùng merchant có thể ra "MB ••••1111 → MB
 * ••••1111"). Dữ liệu người dùng nhập (tên BTC, tên người đổi) được escape trong HTML.
 */
export function buildDefaultPayoutChangedEmail(input: DefaultPayoutChangedEmailInput): Omit<EmailMessage, 'to'> {
  const keyReplaced = input.reason === 'tingee_key_replaced';
  const previous = input.previous ? payoutAccountLabel(input.previous) : NO_PREVIOUS_ACCOUNT;
  const next = input.next ? payoutAccountLabel(input.next) : NO_ACCOUNT;
  const changedAt = `${CHANGED_AT_FORMAT.format(input.changedAt)} (giờ Việt Nam)`;
  const effect = input.next
    ? `Đơn mới sẽ nhận tiền vào ${next}.`
    : 'BTC chưa bán được Vé có phí cho tới khi liên kết một tài khoản nhận tiền khác.';
  const warning =
    'Nếu không phải bạn hay Owner của BTC thực hiện thay đổi này, có thể tài khoản Owner đã bị lộ: Owner hãy đăng xuất khỏi mọi thiết bị, kiểm tra lại trang Tài khoản nhận tiền và liên hệ hỗ trợ Tickee ngay.';

  const intro = (organization: string) =>
    keyReplaced
      ? `Key Tingee của BTC ${organization} trên Tickee vừa đổi. Mọi tài khoản nhận tiền cũ đã bị hủy liên kết; ` +
        'tài khoản nhận tiền mặc định:'
      : `Tài khoản nhận tiền mặc định của BTC ${organization} trên Tickee vừa đổi:`;

  const name = escapeHtml(input.organizationName);
  const p = (html: string) => `      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${html}</p>`;
  return {
    subject: keyReplaced
      ? `Key Tingee của ${input.organizationName} vừa đổi`
      : `Tài khoản nhận tiền mặc định của ${input.organizationName} vừa đổi`,
    text: [
      intro(input.organizationName),
      `${previous} → ${next}`,
      '',
      effect,
      '',
      `Người đổi: ${input.actor}`,
      `Thời điểm: ${changedAt}`,
      '',
      warning,
    ].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
${p(intro(`<strong>${name}</strong>`))}
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;font-variant-numeric:tabular-nums">${escapeHtml(previous)} → ${escapeHtml(next)}</p>
${p(escapeHtml(effect))}
${p(`Người đổi: ${escapeHtml(input.actor)}<br>Thời điểm: ${escapeHtml(changedAt)}`)}
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">${escapeHtml(warning)}</p>
    </div>
  </body>
</html>`,
  };
}
