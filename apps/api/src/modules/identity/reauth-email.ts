import type { EmailMessage } from '../../platform/email/index.js';
import { securityEmail } from './totp-email.js';

/**
 * Email "Mã xác nhận" để xác nhận lại trước thao tác nhạy cảm (Story 2.13), cho tài khoản chưa bật 2FA. Mã (chỉ gồm
 * chữ số) chỉ nằm trong nội dung email, không bao giờ vào log; là dãy số đầu tiên trong phần chữ.
 */
export function buildReauthCodeEmail(code: string, expiresInSeconds: number): Omit<EmailMessage, 'to'> {
  if (!/^\d+$/.test(code)) throw new Error('Mã xác nhận phải toàn chữ số');
  const minutes = Math.ceil(expiresInSeconds / 60);
  return securityEmail(
    'Mã xác nhận Tickee của bạn',
    [
      `Mã xác nhận của bạn là: ${code}`,
      `Bạn vừa yêu cầu xác nhận lại để làm một thao tác quan trọng (như đổi tài khoản nhận tiền của BTC). Mã có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.`,
      'Không chia sẻ mã này cho bất kỳ ai, kể cả người tự xưng là nhân viên Tickee.',
    ],
    'Nếu không phải bạn yêu cầu, có thể ai đó đang dùng tài khoản của bạn: hãy đăng xuất khỏi mọi thiết bị, bật xác thực hai lớp và liên hệ hỗ trợ Tickee ngay.',
  );
}
