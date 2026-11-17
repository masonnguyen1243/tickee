import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  JobQueue,
  NOTIFICATION_CATALOG,
  OrganizationSection,
  organizationSectionPath,
  TOKEN_ALERT_SCAN_CRON,
  TokenReadingStatus,
  type TokenAlertEmailPayload,
} from '@tickee/contracts';
import { and, asc, inArray } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { orgScope } from '../../platform/access/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { BOSS, defineQueue, errorName, JOB_COMPLETED, registerQueueWorker } from '../../platform/jobs/index.js';
import { userContacts } from '../identity/index.js';
import { members, organizations } from './schema.js';
import { buildTokenAlertEmail } from './token-alert-email.js';
import { TOKEN_ALERT_EMAIL_QUEUE, tokenAlertScanOrganizationIds, type TokenAlertTransition } from './token-alert.js';
import { TokenReader } from './token.service.js';

/*
 * Job nền của cảnh báo Token (Story 4.5-b), chỉ vai worker:
 * - Email (`organizer.token-alert-email`): lần đánh giá vừa vượt ngưỡng enqueue một job (id cố định theo BTC và mốc);
 *   handler bỏ qua khi mốc hiện tại của BTC khác payload, rồi gửi đúng một email cho Owner hiện tại.
 * - Dò mỗi giờ (`organizer.token-alert-scan`, cron `TOKEN_ALERT_SCAN_CRON`): tuần tự qua các BTC có ngưỡng và dịch vụ
 *   thanh toán `active`, mỗi BTC đọc Token như `GET …/token` (`TokenReader`) rồi đánh giá ngưỡng; lỗi một BTC thì log và
 *   đi tiếp. Không retry: lần chạy kế làm lại.
 * Payload, job và log không bao giờ chứa số dư, hạn mức hay Token khả dụng.
 */

/** Token DI của cấu hình email cảnh báo Token (vai worker). */
export const TOKEN_ALERT_EMAIL_SETTINGS = Symbol('TOKEN_ALERT_EMAIL_SETTINGS');

export interface TokenAlertEmailSettings {
  /** Origin web: link trang Token là `{webOrigin}/btc/{id}/token`. */
  webOrigin: string;
  /** Portal Tingee của môi trường api đang gọi (nơi mua Token). */
  tingeePortalUrl: string;
}

export interface TokenAlertNotifier extends TokenAlertEmailSettings {
  db: Database;
  email: EmailTransport;
}

/** Vai nhận email theo danh mục thông báo: chỉ Owner (một người mỗi BTC, unique index), nên mỗi job đúng một email. */
const RECIPIENTS = NOTIFICATION_CATALOG.token_below_threshold.recipients;

/**
 * Handler của job email: BTC không còn, không còn dưới ngưỡng, hay mốc hiện tại khác `belowThresholdSince` của payload
 * (đã về trên ngưỡng, Owner tắt cảnh báo, hoặc đã vượt lần mới: lần đó có job riêng) → `skipped`, không gửi. Không còn
 * Owner có email → `skipped`. Gửi lỗi → ném lỗi chỉ mang tên lớp (message SMTP có thể chứa địa chỉ email) để pg-boss
 * retry.
 */
export async function sendTokenAlertEmail(
  notifier: TokenAlertNotifier,
  payload: TokenAlertEmailPayload,
): Promise<'sent' | 'skipped'> {
  const { db } = notifier;
  const scope = orgScope({ organizationId: payload.organizationId });
  const [org] = await db.orm
    .select({
      name: organizations.name,
      threshold: organizations.tokenAlertThreshold,
      since: organizations.tokenBelowThresholdSince,
    })
    .from(organizations)
    .where(scope({ organizationId: organizations.id }));
  if (!org || org.threshold === null || org.since === null) return 'skipped';
  if (org.since.getTime() !== Date.parse(payload.belowThresholdSince)) return 'skipped';

  const [recipient] = await db.orm
    .select({ userId: members.userId })
    .from(members)
    .where(and(scope(members), inArray(members.role, [...RECIPIENTS])))
    .orderBy(asc(members.createdAt), asc(members.id));
  if (!recipient) return 'skipped';
  const to = (await userContacts(db.orm, [recipient.userId])).get(recipient.userId)?.email;
  if (!to) return 'skipped';

  const message = buildTokenAlertEmail({
    organizationName: org.name,
    threshold: org.threshold,
    tokenPageUrl: `${notifier.webOrigin}${organizationSectionPath(payload.organizationId, OrganizationSection.TOKEN)}`,
    tingeePortalUrl: notifier.tingeePortalUrl,
  });
  try {
    await notifier.email.send({ to, ...message });
  } catch (err) {
    throw new Error(`Không gửi được email cảnh báo Token (${errorName(err)})`);
  }
  return 'sent';
}

/** Vai `worker`: tạo queue email cảnh báo Token (và dead-letter) rồi đăng ký handler. */
@Injectable()
export class TokenAlertEmailWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('TokenAlertEmailWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(TOKEN_ALERT_EMAIL_SETTINGS) private readonly settings: TokenAlertEmailSettings,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const notifier: TokenAlertNotifier = { db: this.db, email: this.email, ...this.settings };
    await registerQueueWorker(this.boss, TOKEN_ALERT_EMAIL_QUEUE, {
      logger: this.logger,
      label: 'Gửi email cảnh báo Token',
      logContext: ({ organizationId }) => ({ organizationId }),
      handle: async (payload, job) => {
        if ((await sendTokenAlertEmail(notifier, payload)) === 'skipped') {
          // Chỉ id (không email, không số).
          this.logger.log(
            { jobId: job.id, organizationId: payload.organizationId },
            'Bỏ qua email cảnh báo Token: không còn dưới ngưỡng ở lần vượt này, hoặc không còn Owner',
          );
        }
        return JOB_COMPLETED;
      },
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Job dò Token mỗi giờ
// ---------------------------------------------------------------------------------------------------------------

/**
 * Queue cron của job dò Token: không payload (pg-boss gửi `null`), không retry, không dead-letter (lần chạy kế làm lại).
 * Hai lần chạy chồng nhau vẫn chỉ một email cho mỗi lần vượt ngưỡng (CAS của lần đánh giá).
 */
export const TOKEN_ALERT_SCAN_QUEUE = defineQueue({
  name: JobQueue.TOKEN_ALERT_SCAN,
  options: { retryLimit: 0 },
  work: { batchSize: 1, perJobResults: true },
  payload: z.unknown(),
});

/** Kết quả dò một BTC: chuyển trạng thái cảnh báo (đọc `ok`), hoặc lý do đọc không được (không đổi gì). */
export type TokenAlertScanOutcome =
  | TokenAlertTransition
  | typeof TokenReadingStatus.UNAVAILABLE
  | typeof TokenReadingStatus.NO_PAYOUT_ACCOUNT;

/** Vai `worker`: tạo queue, lên lịch mỗi giờ (upsert: nhiều worker vẫn một lịch) và đăng ký handler dò. */
@Injectable()
export class TokenAlertScanWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('TokenAlertScanWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(TokenReader) private readonly reader: TokenReader,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerQueueWorker(this.boss, TOKEN_ALERT_SCAN_QUEUE, {
      logger: this.logger,
      label: 'Dò Token',
      logContext: () => ({}),
      handle: async () => {
        await this.scan();
        return JOB_COMPLETED;
      },
    });
    await this.boss.schedule(TOKEN_ALERT_SCAN_QUEUE.name, TOKEN_ALERT_SCAN_CRON);
  }

  /**
   * Dò tuần tự mọi BTC có ngưỡng và dịch vụ thanh toán `active`. Lỗi (DB) ở một BTC chỉ log rồi sang BTC kế. Trả kết quả
   * theo BTC (log, test).
   */
  async scan(): Promise<Map<string, TokenAlertScanOutcome | 'error'>> {
    const outcomes = new Map<string, TokenAlertScanOutcome | 'error'>();
    for (const organizationId of await tokenAlertScanOrganizationIds(this.db.orm)) {
      try {
        const { reading, transition } = await this.reader.readAndEvaluate(organizationId);
        outcomes.set(organizationId, reading.status === TokenReadingStatus.OK ? transition : reading.status);
      } catch (err) {
        outcomes.set(organizationId, 'error');
        this.logger.warn({ organizationId, error: errorName(err) }, 'Dò Token lỗi; lần chạy sau dò lại');
      }
    }
    if (outcomes.size > 0) this.logger.log({ organizations: outcomes.size }, 'Đã dò Token các BTC có ngưỡng cảnh báo');
    return outcomes;
  }
}
