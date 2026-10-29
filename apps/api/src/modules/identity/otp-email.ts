import type { EmailMessage } from '../../platform/email/index.js';

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/**
 * Email chứa mã OTP đăng nhập (tiếng Việt). Mã chỉ nằm trong nội dung email, không bao giờ vào log.
 * `expiresInSeconds` truyền từ cấu hình plugin (`OTP_EXPIRES_IN_SECONDS`) để số phút trong email không lệch.
 */
export function buildOtpEmail(otp: string, expiresInSeconds: number): Omit<EmailMessage, 'to'> {
  const code = escapeHtml(otp);
  const minutes = Math.ceil(expiresInSeconds / 60);
  return {
    subject: 'Mã đăng nhập Tickee của bạn',
    text: [
      `Mã đăng nhập Tickee của bạn là: ${otp}`,
      '',
      `Mã có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.`,
      'Không chia sẻ mã này cho bất kỳ ai, kể cả người tự xưng là nhân viên Tickee.',
      'Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Mã đăng nhập Tickee của bạn là:</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:0.2em;font-variant-numeric:tabular-nums">${code}</p>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.5">Mã có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.</p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">Không chia sẻ mã này cho bất kỳ ai, kể cả người tự xưng là nhân viên Tickee. Nếu bạn không yêu cầu đăng nhập, hãy bỏ qua email này.</p>
    </div>
  </body>
</html>`,
  };
}
