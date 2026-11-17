import { escapeHtml, type EmailMessage } from '../email/index.js';
import { OPS_ALERT_KINDS } from './kinds.js';
import type { OpsAlertPayload } from './ops-alerts.js';

/** Tiền tố tiêu đề của mọi email cảnh báo vận hành. */
export const OPS_ALERT_SUBJECT_PREFIX = '[Tickee vận hành]';

/**
 * Email cảnh báo vận hành (Story 4.6-b) gửi đội vận hành: `[Tickee vận hành] <tiêu đề loại>`; nội dung chỉ có loại, chi
 * tiết của job (id, mã, tên queue, số đếm, lý do; giá trị `null` bỏ qua), số subject mới và tối đa 20 subject. Không
 * PII, secret, chữ ký hay token (payload job không có). Mọi giá trị được escape trong HTML.
 */
export function buildOpsAlertEmail(payload: OpsAlertPayload): Omit<EmailMessage, 'to'> {
  const spec = OPS_ALERT_KINDS[payload.kind];
  const details = Object.entries(payload.details).filter(([, value]) => value !== null);
  const more = payload.count - payload.subjects.length;
  const listTitle = `${spec.subjectLabel}, ${payload.count} mục mới:`;
  const moreLine = more > 0 ? `… và ${more} mục khác` : null;
  const footer = 'Email tự động của kênh cảnh báo vận hành Tickee: mỗi mục chỉ báo một lần, hoặc một lần mỗi chu kỳ cooldown.';

  const text = [
    spec.summary,
    '',
    `Loại: ${payload.kind}`,
    ...details.map(([key, value]) => `${key}: ${String(value)}`),
    '',
    listTitle,
    ...payload.subjects.map((subject) => `- ${subject}`),
    ...(moreLine ? [moreLine] : []),
    '',
    footer,
  ].join('\n');

  const row = (key: string, value: string) =>
    `        <tr><td style="padding:2px 12px 2px 0;color:#5C5552">${escapeHtml(key)}</td><td style="padding:2px 0;font-family:ui-monospace,Menlo,monospace">${escapeHtml(value)}</td></tr>`;
  const html = `<!doctype html>
<html lang="vi">
  <body style="margin:0;padding:24px;background:#F7F3F2;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1C1917">
    <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:12px;padding:24px">
      <p style="margin:0 0 8px;font-size:17px;font-weight:700">${escapeHtml(spec.title)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(spec.summary)}</p>
      <table style="margin:0 0 16px;font-size:14px;border-collapse:collapse">
${[row('Loại', payload.kind), ...details.map(([key, value]) => row(key, String(value)))].join('\n')}
      </table>
      <p style="margin:0 0 8px;font-size:14px;font-weight:700">${escapeHtml(listTitle)}</p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;font-family:ui-monospace,Menlo,monospace">
${payload.subjects.map((subject) => `        <li>${escapeHtml(subject)}</li>`).join('\n')}
      </ul>
${moreLine ? `      <p style="margin:0 0 16px;font-size:14px">${escapeHtml(moreLine)}</p>\n` : ''}      <p style="margin:0;font-size:13px;line-height:1.45;color:#5C5552">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`;

  return { subject: `${OPS_ALERT_SUBJECT_PREFIX} ${spec.title}`, text, html };
}
