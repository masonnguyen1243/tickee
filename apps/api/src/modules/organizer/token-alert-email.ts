import { escapeHtml, type EmailMessage } from '../../platform/email/index.js';

export interface TokenAlertEmailInput {
  organizationName: string;
  /** Ngưỡng cảnh báo Owner đặt (số Token nguyên). */
  threshold: number;
  /** Trang Token của BTC trên web: `{WEB_ORIGIN}/btc/{id}/token`. */
  tokenPageUrl: string;
  /** Portal Tingee của môi trường api đang gọi (nơi mua Token). */
  tingeePortalUrl: string;
}

/** Số Token kiểu `vi-VN` (dấu chấm phân cách nghìn), tự chèn dấu: không phụ thuộc dữ liệu ICU của runtime. */
const formatCount = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Email cảnh báo Token dưới ngưỡng (Story 4.5-b), gửi Owner: tên BTC, ngưỡng cảnh báo, link trang Token và portal Tingee
 * để mua thêm Token. Không bao giờ có số dư, hạn mức hay Token khả dụng (Tickee không lưu các số này). Tên BTC được
 * escape trong HTML.
 */
export function buildTokenAlertEmail(input: TokenAlertEmailInput): Omit<EmailMessage, 'to'> {
  const threshold = `${formatCount(input.threshold)} Token`;
  const summary = (organization: string) =>
    `Token khả dụng của BTC ${organization} trên Tingee đã xuống dưới ngưỡng cảnh báo ${threshold}.`;
  const effect = 'Mua thêm Token trên portal Tingee trước khi Sự kiện có phí bị Tạm ngừng bán.';
  const footer = 'Bạn nhận email này vì là Owner của BTC. Đổi hoặc tắt ngưỡng cảnh báo trên trang Token của Tickee.';
  const portal = escapeHtml(input.tingeePortalUrl);
  const tokenPage = escapeHtml(input.tokenPageUrl);
  const p = (html: string) => `      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${html}</p>`;
  return {
    subject: `Token của ${input.organizationName} dưới ngưỡng cảnh báo`,
    text: [
      summary(input.organizationName),
      '',
      effect,
      `Mua thêm Token: ${input.tingeePortalUrl}`,
      `Xem Token của BTC: ${input.tokenPageUrl}`,
      '',
      footer,
    ].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
${p(summary(`<strong>${escapeHtml(input.organizationName)}</strong>`))}
${p(escapeHtml(effect))}
      <p style="margin:0 0 16px"><a href="${portal}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1C1917;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none">Mua thêm Token</a></p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5"><a href="${tokenPage}" style="color:#1C1917">Xem Token của BTC trên Tickee</a></p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`,
  };
}
