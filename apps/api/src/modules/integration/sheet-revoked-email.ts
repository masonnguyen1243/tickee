import { SHEETS_KEPT_CHANGES_NOTE } from '@tickee/contracts';
import { escapeHtml, type EmailMessage } from '../../platform/email/index.js';

export interface SheetsAuthRevokedEmailInput {
  eventName: string;
  /** Lý do theo `last_error_code` (`SHEET_SYNC_ERROR_LABEL`), vd. "Người kết nối đã rời BTC.". */
  reason: string;
  /** Tab Cài đặt của Sự kiện trên web: `{WEB_ORIGIN}/btc/{orgId}/su-kien/{eventId}?tab=cai-dat`. */
  settingsUrl: string;
}

/**
 * Email báo Tickee mất quyền ghi Google Sheet của một Sự kiện (Story 6.6, FR-32), gửi Owner và mọi Admin: tên Sự kiện,
 * lý do, câu "thay đổi được giữ lại" và link "Kết nối lại" tới tab Cài đặt của Sự kiện. Không bao giờ có token, link
 * Sheet hay email/SĐT người mua. Tên Sự kiện được escape trong HTML.
 */
export function buildSheetsAuthRevokedEmail(input: SheetsAuthRevokedEmailInput): Omit<EmailMessage, 'to'> {
  const summary = (event: string) => `Tickee không còn ghi được lên Google Sheet của Sự kiện ${event}.`;
  const reason = `Lý do: ${input.reason}`;
  const action = 'Owner hoặc Admin mở tab Cài đặt của Sự kiện và bấm "Kết nối lại" để Tickee ghi tiếp lên Sheet.';
  const footer = 'Bạn nhận email này vì là Owner hoặc Admin của BTC.';
  const settings = escapeHtml(input.settingsUrl);
  const p = (html: string) => `      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${html}</p>`;
  return {
    subject: `Mất quyền ghi Google Sheets: ${input.eventName}`,
    text: [
      summary(input.eventName),
      reason,
      '',
      SHEETS_KEPT_CHANGES_NOTE,
      `${action} ${input.settingsUrl}`,
      '',
      footer,
    ].join('\n'),
    html: `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:'Be Vietnam Pro',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">tickee</p>
${p(summary(`<strong>${escapeHtml(input.eventName)}</strong>`))}
${p(escapeHtml(reason))}
${p(escapeHtml(SHEETS_KEPT_CHANGES_NOTE))}
${p(escapeHtml(action))}
      <p style="margin:0 0 16px"><a href="${settings}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#1C1917;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none">Kết nối lại</a></p>
      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`,
  };
}
