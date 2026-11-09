import type { EmailMessage } from '../../platform/email/index.js';

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export interface OwnershipTransferredEmailInput {
  organizationName: string;
  /** Tên (hoặc email nếu tài khoản chưa có tên) của Owner cũ, nay là Admin. */
  previousOwner: string;
  /** Tên (hoặc email nếu tài khoản chưa có tên) của Owner mới. */
  newOwner: string;
}

/**
 * Email báo quyền Owner của BTC vừa chuyển (Story 2.14), gửi Owner cũ, Owner mới và mọi Admin khác: "{tên mới} là Owner
 * mới của {BTC}; {tên cũ} chuyển sang Admin." kèm việc cần làm nếu không phải người trong BTC thực hiện. Dữ liệu người
 * dùng nhập (tên BTC, tên người) được escape trong HTML.
 */
export function buildOwnershipTransferredEmail(input: OwnershipTransferredEmailInput): Omit<EmailMessage, 'to'> {
  const summary = (org: string, previous: string, next: string) =>
    `${next} là Owner mới của ${org}; ${previous} chuyển sang Admin.`;
  const effect =
    'Từ nay Owner mới quản lý tài khoản nhận tiền, key Tingee và thành viên của BTC. Sự kiện, Đơn và tài khoản nhận tiền vẫn giữ nguyên.';
  const warning =
    'Nếu bạn không biết về thay đổi này, có thể tài khoản Owner cũ đã bị lộ: hãy đăng xuất khỏi mọi thiết bị và liên hệ hỗ trợ Tickee ngay.';
  const p = (html: string) => `      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${html}</p>`;
  return {
    subject: `${input.newOwner} là Owner mới của ${input.organizationName}`,
    text: [summary(input.organizationName, input.previousOwner, input.newOwner), '', effect, '', warning].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
${p(
  summary(
    `<strong>${escapeHtml(input.organizationName)}</strong>`,
    `<strong>${escapeHtml(input.previousOwner)}</strong>`,
    `<strong>${escapeHtml(input.newOwner)}</strong>`,
  ),
)}
${p(escapeHtml(effect))}
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">${escapeHtml(warning)}</p>
    </div>
  </body>
</html>`,
  };
}
