import type { EmailMessage } from '../../platform/email/index.js';

/**
 * Email báo tài khoản vừa dùng một mã khôi phục TOTP (tiếng Việt). Không chứa mã nào: chỉ báo sự việc và việc phải
 * đăng ký lại ứng dụng xác thực.
 */
export function buildRecoveryCodeUsedEmail(): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Tài khoản Tickee của bạn vừa dùng mã khôi phục',
    text: [
      'Tài khoản Tickee của bạn vừa xác thực hai lớp bằng một mã khôi phục.',
      '',
      'Xác thực hai lớp cũ đã được gỡ. Lần tới bạn mở dashboard BTC, Tickee sẽ yêu cầu đăng ký lại ứng dụng xác thực',
      'và cấp bộ mã khôi phục mới.',
      'Nếu không phải bạn, hãy đăng xuất khỏi mọi thiết bị và liên hệ hỗ trợ Tickee ngay.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Tài khoản Tickee của bạn vừa xác thực hai lớp bằng một mã khôi phục.</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Xác thực hai lớp cũ đã được gỡ. Lần tới bạn mở dashboard BTC, Tickee sẽ yêu cầu đăng ký lại ứng dụng xác thực và cấp bộ mã khôi phục mới.</p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">Nếu không phải bạn, hãy đăng xuất khỏi mọi thiết bị và liên hệ hỗ trợ Tickee ngay.</p>
    </div>
  </body>
</html>`,
  };
}
