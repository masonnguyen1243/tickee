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

export interface DefaultPayoutChangedEmailInput {
  organizationName: string;
  previous: PayoutAccountLabel;
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

/**
 * Email cảnh báo tài khoản nhận tiền mặc định của BTC vừa đổi (Story 2.13-a), gửi Owner và mọi Admin: tên BTC, tài
 * khoản cũ → mới (hoặc "không còn tài khoản nhận tiền"), người đổi, giờ Việt Nam và việc cần làm nếu không phải người
 * trong BTC đổi. Dữ liệu người dùng nhập (tên BTC, tên người đổi) được escape trong HTML.
 */
export function buildDefaultPayoutChangedEmail(input: DefaultPayoutChangedEmailInput): Omit<EmailMessage, 'to'> {
  const previous = payoutAccountLabel(input.previous);
  const next = input.next ? payoutAccountLabel(input.next) : NO_ACCOUNT;
  const changedAt = `${CHANGED_AT_FORMAT.format(input.changedAt)} (giờ Việt Nam)`;
  const effect = input.next
    ? `Đơn mới sẽ nhận tiền vào ${next}.`
    : 'BTC chưa bán được Vé có phí cho tới khi liên kết một tài khoản nhận tiền khác.';
  const warning =
    'Nếu không phải bạn hay Owner của BTC thực hiện thay đổi này, có thể tài khoản Owner đã bị lộ: Owner hãy đăng xuất khỏi mọi thiết bị, kiểm tra lại trang Tài khoản nhận tiền và liên hệ hỗ trợ Tickee ngay.';

  const name = escapeHtml(input.organizationName);
  const p = (html: string) => `      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${html}</p>`;
  return {
    subject: `Tài khoản nhận tiền mặc định của ${input.organizationName} vừa đổi`,
    text: [
      `Tài khoản nhận tiền mặc định của BTC ${input.organizationName} trên Tickee vừa đổi:`,
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
${p(`Tài khoản nhận tiền mặc định của BTC <strong>${name}</strong> trên Tickee vừa đổi:`)}
      <p style="margin:0 0 16px;font-size:17px;font-weight:700;font-variant-numeric:tabular-nums">${escapeHtml(previous)} → ${escapeHtml(next)}</p>
${p(escapeHtml(effect))}
${p(`Người đổi: ${escapeHtml(input.actor)}<br>Thời điểm: ${escapeHtml(changedAt)}`)}
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">${escapeHtml(warning)}</p>
    </div>
  </body>
</html>`,
  };
}
