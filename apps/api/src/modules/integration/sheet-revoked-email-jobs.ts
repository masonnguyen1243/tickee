import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  eventSettingsPath,
  NOTIFICATION_CATALOG,
  SHEET_SYNC_ERROR_LABEL,
  SheetConnectionStatus,
  sheetSyncErrorCodeSchema,
  type SheetsAuthRevokedEmailPayload,
} from '@tickee/contracts';
import type { PgBoss } from 'pg-boss';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { BOSS, errorName, fanOut, JOB_COMPLETED, registerQueueWorker } from '../../platform/jobs/index.js';
import { ticketEventById } from '../event/index.js';
import { userContacts } from '../identity/index.js';
import { memberRoleOf, memberUserIdsOf } from '../organizer/index.js';
import { connectionById } from './sheet-connection-store.js';
import { buildSheetsAuthRevokedEmail } from './sheet-revoked-email.js';
import { SHEETS_AUTH_REVOKED_EMAIL_QUEUE } from './sheet-revocation.js';

/*
 * Email mất quyền Google Sheets (Story 6.6, FR-32, AD-34), vai worker. Lệnh chuyển kết nối sang `auth_revoked` enqueue
 * một job gốc `{ connectionId, authRevokedAt }` (id cố định theo kết nối và mốc). Job gốc chốt người nhận lúc xử lý theo
 * danh mục thông báo (Owner rồi mọi Admin của BTC) và tạo mỗi người một job con (`recipientUserId`, id suy từ id job
 * gốc); job con gửi đúng một email. SMTP lỗi với một địa chỉ thì chỉ job con của người đó retry. Cả hai bỏ qua khi kết nối
 * không còn ("Ngắt kết nối"), hoặc không còn `auth_revoked` với đúng mốc của payload (đã "Kết nối lại" trước khi job
 * chạy; mất quyền lần mới có job riêng). Payload, job và log chỉ có id: không token, không email.
 */

/** Token DI của cấu hình email mất quyền (vai worker). */
export const SHEETS_REVOKED_EMAIL_SETTINGS = Symbol('SHEETS_REVOKED_EMAIL_SETTINGS');

export interface SheetsRevokedEmailSettings {
  /** Origin web: link "Kết nối lại" là `{webOrigin}/btc/{orgId}/su-kien/{eventId}?tab=cai-dat`. */
  webOrigin: string;
}

export interface SheetsRevokedNotifier extends SheetsRevokedEmailSettings {
  db: Database;
  email: EmailTransport;
}

/** Vai nhận email theo danh mục thông báo: Owner và Admin. */
const RECIPIENTS = NOTIFICATION_CATALOG.sheets_auth_revoked.recipients;

/** Câu lý do khi `last_error_code` trống hay lạ. */
const FALLBACK_REASON = 'Google không còn cho Tickee ghi vào Sheet.';

interface RevokedConnection {
  organizationId: string;
  eventId: string;
  lastErrorCode: string | null;
}

/** Kết nối của payload khi vẫn `auth_revoked` với đúng mốc đó; không thì `undefined` (bỏ qua). */
async function revokedConnectionOf(
  db: Database,
  payload: SheetsAuthRevokedEmailPayload,
): Promise<RevokedConnection | undefined> {
  const connection = await connectionById(db.orm, payload.connectionId);
  if (!connection || connection.status !== SheetConnectionStatus.AUTH_REVOKED || !connection.authRevokedAt) {
    return undefined;
  }
  if (connection.authRevokedAt.getTime() !== Date.parse(payload.authRevokedAt)) return undefined;
  return {
    organizationId: connection.organizationId,
    eventId: connection.eventId,
    lastErrorCode: connection.lastErrorCode,
  };
}

/**
 * Job gốc: người nhận theo thứ tự liệt kê (Owner rồi mọi Admin của BTC lúc xử lý, theo ngày vào). Kết nối không còn hay
 * không còn mất quyền ở mốc này → `skipped`.
 */
export async function sheetsAuthRevokedRecipients(
  db: Database,
  payload: SheetsAuthRevokedEmailPayload,
): Promise<string[] | 'skipped'> {
  const connection = await revokedConnectionOf(db, payload);
  if (!connection) return 'skipped';
  return memberUserIdsOf(db.orm, connection, RECIPIENTS);
}

/**
 * Job con: gửi email mất quyền cho đúng một người: tên Sự kiện, lý do theo `last_error_code`, câu giữ dòng bẩn và link
 * tab Cài đặt. Kết nối không còn mất quyền ở mốc này, Sự kiện không còn, người nhận không còn là Owner/Admin của BTC hay
 * không còn tài khoản → `skipped`. Gửi lỗi → ném lỗi chỉ mang tên lớp (message SMTP có thể chứa địa chỉ email) để
 * pg-boss retry riêng job con này.
 */
export async function sendSheetsAuthRevokedEmail(
  notifier: SheetsRevokedNotifier,
  payload: SheetsAuthRevokedEmailPayload,
  recipientUserId: string,
): Promise<'sent' | 'skipped'> {
  const { db } = notifier;
  const connection = await revokedConnectionOf(db, payload);
  if (!connection) return 'skipped';
  const event = await ticketEventById(db.orm, connection.eventId);
  if (!event || event.organizationId !== connection.organizationId) return 'skipped';
  const role = await memberRoleOf(db.orm, recipientUserId, connection.organizationId);
  if (!role || !RECIPIENTS.includes(role)) return 'skipped';
  const to = (await userContacts(db.orm, [recipientUserId])).get(recipientUserId)?.email;
  if (!to) return 'skipped';

  const code = sheetSyncErrorCodeSchema.safeParse(connection.lastErrorCode);
  const message = buildSheetsAuthRevokedEmail({
    eventName: event.name,
    reason: code.success ? SHEET_SYNC_ERROR_LABEL[code.data] : FALLBACK_REASON,
    settingsUrl: `${notifier.webOrigin}${eventSettingsPath(connection.organizationId, connection.eventId)}`,
  });
  try {
    await notifier.email.send({ to, ...message });
  } catch (err) {
    throw new Error(`Không gửi được email mất quyền Google Sheets (${errorName(err)})`);
  }
  return 'sent';
}

/** Vai `worker`: tạo queue email mất quyền (kèm dead-letter), đăng ký handler: job gốc tạo job con, job con gửi email. */
@Injectable()
export class SheetRevokedEmailWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('SheetRevokedEmailWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(SHEETS_REVOKED_EMAIL_SETTINGS) private readonly settings: SheetsRevokedEmailSettings,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const notifier: SheetsRevokedNotifier = { db: this.db, email: this.email, ...this.settings };
    await registerQueueWorker(this.boss, SHEETS_AUTH_REVOKED_EMAIL_QUEUE, {
      logger: this.logger,
      label: 'Gửi email mất quyền Google Sheets',
      logContext: ({ connectionId, recipientUserId }) => ({ connectionId, recipientUserId }),
      handle: async (payload, job) => {
        const { connectionId, recipientUserId } = payload;
        // Chỉ id trong log (không email).
        if (recipientUserId === undefined) {
          const recipients = await sheetsAuthRevokedRecipients(this.db, payload);
          if (recipients === 'skipped') {
            this.logger.log(
              { jobId: job.id, connectionId },
              'Bỏ qua email mất quyền Google Sheets: kết nối không còn mất quyền ở lần này',
            );
            return JOB_COMPLETED;
          }
          await fanOut(
            this.boss,
            SHEETS_AUTH_REVOKED_EMAIL_QUEUE,
            job.id,
            recipients.map((userId) => ({ key: userId, payload: { ...payload, recipientUserId: userId } })),
          );
          return JOB_COMPLETED;
        }
        if ((await sendSheetsAuthRevokedEmail(notifier, payload, recipientUserId)) === 'skipped') {
          this.logger.log(
            { jobId: job.id, connectionId, recipientUserId },
            'Bỏ qua email mất quyền Google Sheets: kết nối đã kết nối lại/ngắt, hoặc người nhận không còn',
          );
        }
        return JOB_COMPLETED;
      },
    });
  }
}
