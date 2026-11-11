import { formatVnDateTime, ORGANIZATION_INVITATION_TTL_DAYS } from '@tickee/contracts';
import { escapeHtml, type EmailMessage } from '../../platform/email/index.js';

export interface AdminInvitationEmailInput {
  organizationName: string;
  /** `{WEB_ORIGIN}/loi-moi-btc#{token}`. Không bao giờ vào log. */
  link: string;
  expiresAt: Date;
}

/** Email mời làm Admin của một BTC (tiếng Việt). Link chứa token nên chỉ nằm trong nội dung email. */
export function buildAdminInvitationEmail({ organizationName, link, expiresAt }: AdminInvitationEmailInput): Omit<
  EmailMessage,
  'to'
> {
  const expires = `${formatVnDateTime(expiresAt)} (giờ Việt Nam)`;
  const name = escapeHtml(organizationName);
  const href = escapeHtml(link);
  return {
    subject: `Lời mời làm Admin của ${organizationName} trên Tickee`,
    text: [
      `Bạn được mời làm Admin của ${organizationName} trên Tickee.`,
      '',
      'Admin cùng Owner tạo và quản lý Sự kiện, xem Đơn và doanh thu của BTC.',
      '',
      'Mở link sau để nhận lời mời:',
      link,
      '',
      `Link có hiệu lực ${ORGANIZATION_INVITATION_TTL_DAYS} ngày, tới ${expires}, và chỉ dùng được một lần.`,
      'Bạn cần đăng nhập Tickee bằng đúng địa chỉ email nhận thư này.',
      'Nếu bạn không biết BTC này, hãy bỏ qua email.',
    ].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Bạn được mời làm Admin của <strong>${name}</strong> trên Tickee.</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Admin cùng Owner tạo và quản lý Sự kiện, xem Đơn và doanh thu của BTC.</p>
      <p style="margin:0 0 16px"><a href="${href}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1C1917;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none">Nhận lời mời</a></p>
      <p style="margin:0 0 16px;font-size:13px;line-height:1.45;color:#5C5552;word-break:break-all">Hoặc mở link: ${href}</p>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.5">Link có hiệu lực ${ORGANIZATION_INVITATION_TTL_DAYS} ngày, tới ${escapeHtml(expires)}, và chỉ dùng được một lần. Bạn cần đăng nhập Tickee bằng đúng địa chỉ email nhận thư này.</p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">Nếu bạn không biết BTC này, hãy bỏ qua email.</p>
    </div>
  </body>
</html>`,
  };
}
