import type { EmailMessage } from '../../platform/email/index.js';

/** Email báo việc về xác thực hai lớp: tiêu đề + các đoạn (đoạn cuối là lời dặn khi không phải người dùng làm). */
function securityEmail(subject: string, paragraphs: readonly string[], warning: string): Omit<EmailMessage, 'to'> {
  return {
    subject,
    text: [...paragraphs.flatMap((p) => [p, '']), warning].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
${paragraphs.map((p) => `      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${p}</p>`).join('\n')}
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">${warning}</p>
    </div>
  </body>
</html>`,
  };
}

/**
 * Email báo tài khoản vừa dùng một mã khôi phục TOTP (tiếng Việt). Không chứa mã nào: chỉ báo sự việc, việc 2FA cũ đã
 * bị gỡ và cách bật lại.
 */
export function buildRecoveryCodeUsedEmail(): Omit<EmailMessage, 'to'> {
  return securityEmail(
    'Tài khoản Tickee của bạn vừa dùng mã khôi phục',
    [
      'Tài khoản Tickee của bạn vừa xác thực hai lớp bằng một mã khôi phục.',
      'Xác thực hai lớp cũ đã được gỡ. Hãy vào Bảo mật tài khoản để bật lại với thiết bị mới và nhận bộ mã khôi phục mới.',
    ],
    'Nếu không phải bạn, hãy đăng xuất khỏi mọi thiết bị và liên hệ hỗ trợ Tickee ngay.',
  );
}

/** Email báo tài khoản vừa tắt xác thực hai lớp (tiếng Việt). */
export function buildTotpDisabledEmail(): Omit<EmailMessage, 'to'> {
  return securityEmail(
    'Tài khoản Tickee của bạn vừa tắt xác thực hai lớp',
    [
      'Xác thực hai lớp của tài khoản Tickee của bạn vừa được tắt. Mã khôi phục cũ không còn dùng được.',
      'Từ giờ tài khoản chỉ còn được bảo vệ bằng email. Bạn có thể bật lại bất cứ lúc nào trong Bảo mật tài khoản.',
    ],
    'Nếu không phải bạn, hãy đăng xuất khỏi mọi thiết bị, bật lại xác thực hai lớp và liên hệ hỗ trợ Tickee ngay.',
  );
}
