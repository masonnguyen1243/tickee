import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { DATABASE, type Database } from '../db/index.js';
import { BOSS, defineQueue, errorName, JOB_COMPLETED, PGBOSS_SCHEMA, registerQueueWorker } from '../jobs/index.js';
import { dbErrorSummary, isDatabaseError } from '../logging/index.js';
import { OpsAlertKind } from './kinds.js';
import { OpsAlerts } from './ops-alerts.js';
import { opsAlertMarks } from './schema.js';

/*
 * Job quét cảnh báo vận hành (Story 4.6-b), chỉ vai worker: cron `platform.ops-alert-scan` mỗi phút chạy tuần tự mọi
 * luật trong registry (`OpsAlertRules`). Platform đăng ký hai luật pg-boss (hàng đợi ùn, dead-letter); mô-đun đăng ký
 * luật nghiệp vụ của mình về sau (Story 4.6-e). Một luật lỗi chỉ log `warn`, các luật còn lại vẫn chạy. Mỗi lượt cũng xóa
 * dấu chống lặp cũ hơn 30 ngày. Worker chết thì không có lượt quét nào: kiểm tra uptime từ bên ngoài (Story 4.7) lo phần
 * đó.
 */

/** Lịch của job quét: mỗi phút. */
export const OPS_ALERT_SCAN_CRON = '* * * * *';

/** Dấu chống lặp cũ hơn chừng này ngày bị xóa (job dead-letter đã bị pg-boss xóa trước đó: giữ 14 ngày). */
export const OPS_ALERT_MARK_RETENTION_DAYS = 30;

/** Hậu tố tên queue dead-letter (mọi queue dead-letter của Tickee khai ở `JobQueue` đều theo quy ước này). */
export const DEAD_LETTER_SUFFIX = '.dead-letter';

/** Tiền tố queue nội bộ của pg-boss (vd. `__pgboss__send-it` của lịch cron). */
const PGBOSS_INTERNAL_PREFIX = '__pgboss';

/** Queue cron của job quét: không payload (pg-boss gửi `null`), không retry, không dead-letter (lượt kế làm lại). */
export const OPS_ALERT_SCAN_QUEUE = defineQueue({
  name: JobQueue.OPS_ALERT_SCAN,
  options: { retryLimit: 0 },
  work: { batchSize: 1, perJobResults: true },
  payload: z.unknown(),
});

/** Thứ một luật dùng trong một lượt quét. */
export interface OpsAlertScanContext {
  db: Database;
  alerts: OpsAlerts;
}

/** Luật cảnh báo của job quét. */
export interface OpsAlertRule {
  /** Tên luật (duy nhất trong registry; log, kết quả quét). */
  readonly name: string;
  /**
   * Một lượt: đọc trạng thái rồi `alerts.raise(…)` cho từng vi phạm (raise tự chống lặp). Ném lỗi → job quét log `warn`
   * rồi chạy luật kế; lượt sau chạy lại.
   */
  check(context: OpsAlertScanContext): Promise<void>;
}

/** Registry luật của job quét (một mỗi app). Platform đăng ký luật pg-boss; mô-đun đăng ký luật của mình qua `index.ts`. */
@Injectable()
export class OpsAlertRules {
  private readonly rules = new Map<string, OpsAlertRule>();

  register(rule: OpsAlertRule): void {
    if (this.rules.has(rule.name)) throw new Error(`Luật cảnh báo vận hành ${rule.name} đã đăng ký`);
    this.rules.set(rule.name, rule);
  }

  /** Các luật theo thứ tự đăng ký. */
  list(): OpsAlertRule[] {
    return [...this.rules.values()];
  }
}

const job = sql`${sql.identifier(PGBOSS_SCHEMA)}.job`;

/**
 * Luật `queue_backlog`: mỗi queue (không phải dead-letter, không phải queue nội bộ của pg-boss) có job `created` hoặc
 * `retry` mà `start_after` đã qua quá `waitMinutes` phút → một lần raise cho queue đó (subject: tên queue, `cooldown`),
 * kèm số job đang chờ và số phút chờ của job lâu nhất. Job hoãn (`start_after` ở tương lai) không tính. Riêng queue email
 * cảnh báo (`platform.ops-alert`) ùn thì chỉ ghi dấu và log `error`: email báo sẽ kẹt trong chính queue đang ùn.
 */
export function queueBacklogRule(waitMinutes: number): OpsAlertRule {
  return {
    name: OpsAlertKind.QUEUE_BACKLOG,
    async check({ db, alerts }) {
      const { rows } = await db.orm.execute<{ queue: string; waiting: number; wait_minutes: number }>(sql`
        SELECT name AS queue,
               count(*)::int AS waiting,
               floor(extract(epoch FROM now() - min(start_after)) / 60)::int AS wait_minutes
          FROM ${job}
         WHERE state IN ('created', 'retry')
           AND start_after < now() - make_interval(mins => ${waitMinutes})
           AND name NOT LIKE ${`%${DEAD_LETTER_SUFFIX}`}
           AND NOT starts_with(name, ${PGBOSS_INTERNAL_PREFIX})
         GROUP BY name
         ORDER BY name`);
      for (const row of rows) {
        await alerts.raise({
          kind: OpsAlertKind.QUEUE_BACKLOG,
          subjects: [row.queue],
          details: { queue: row.queue, waiting: row.waiting, waitMinutes: row.wait_minutes, thresholdMinutes: waitMinutes },
          notify: row.queue !== JobQueue.OPS_ALERT,
        });
      }
    },
  };
}

/**
 * Luật `dead_letter`: job `created` trong mọi queue `*.dead-letter` chưa có dấu → mỗi queue một lần raise (subject: id
 * job, `once`), nên mỗi queue tối đa một email mỗi lượt quét và mỗi job chỉ được báo một lần. Riêng
 * `platform.ops-alert.dead-letter` (email cảnh báo gửi hỏng) chỉ ghi dấu và log `error`, không gửi email.
 */
export const deadLetterRule: OpsAlertRule = {
  name: OpsAlertKind.DEAD_LETTER,
  async check({ db, alerts }) {
    const { rows } = await db.orm.execute<{ queue: string; job_id: string }>(sql`
      SELECT j.name AS queue, j.id::text AS job_id
        FROM ${job} j
       WHERE j.state = 'created'
         AND j.name LIKE ${`%${DEAD_LETTER_SUFFIX}`}
         AND NOT EXISTS (
               SELECT 1 FROM ops_alert_marks m
                WHERE m.kind = ${OpsAlertKind.DEAD_LETTER} AND m.subject = j.id::text)
       ORDER BY j.name, j.created_on, j.id`);
    const byQueue = new Map<string, string[]>();
    for (const row of rows) byQueue.set(row.queue, [...(byQueue.get(row.queue) ?? []), row.job_id]);
    for (const [queue, jobIds] of byQueue) {
      await alerts.raise({
        kind: OpsAlertKind.DEAD_LETTER,
        subjects: jobIds,
        details: { queue },
        notify: queue !== JobQueue.OPS_ALERT_DEAD_LETTER,
      });
    }
  },
};

/** Registry với hai luật pg-boss của platform (`queue_backlog`, `dead_letter`). */
export function platformOpsAlertRules(settings: { queueWaitMinutes: number }): OpsAlertRules {
  const rules = new OpsAlertRules();
  rules.register(queueBacklogRule(settings.queueWaitMinutes));
  rules.register(deadLetterRule);
  return rules;
}

/** Kết quả một luật trong một lượt quét (log, test). */
export type OpsAlertRuleOutcome = 'ok' | 'error';

const errorSummary = (err: unknown) => (isDatabaseError(err) ? dbErrorSummary(err) : { type: errorName(err) });

/** Vai `worker`: tạo queue, lên lịch mỗi phút (upsert: nhiều worker vẫn một lịch) và đăng ký handler quét. */
@Injectable()
export class OpsAlertScanWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('OpsAlertScanWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(OpsAlerts) private readonly alerts: OpsAlerts,
    @Inject(OpsAlertRules) private readonly rules: OpsAlertRules,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await registerQueueWorker(this.boss, OPS_ALERT_SCAN_QUEUE, {
      logger: this.logger,
      label: 'Quét cảnh báo vận hành',
      logContext: () => ({}),
      handle: async () => {
        await this.scan();
        return JOB_COMPLETED;
      },
    });
    await this.boss.schedule(OPS_ALERT_SCAN_QUEUE.name, OPS_ALERT_SCAN_CRON);
  }

  /**
   * Một lượt quét: xóa dấu cũ hơn `OPS_ALERT_MARK_RETENTION_DAYS` ngày, rồi chạy tuần tự mọi luật. Lỗi (dọn dấu hay một
   * luật) chỉ log `warn`; các luật còn lại vẫn chạy. Trả kết quả theo luật.
   */
  async scan(): Promise<Map<string, OpsAlertRuleOutcome>> {
    try {
      await this.db.orm
        .delete(opsAlertMarks)
        .where(sql`${opsAlertMarks.raisedAt} < now() - make_interval(days => ${OPS_ALERT_MARK_RETENTION_DAYS})`);
    } catch (err) {
      this.logger.warn({ error: errorSummary(err) }, 'Không xóa được dấu cảnh báo vận hành cũ; lượt quét sau làm lại');
    }
    const outcomes = new Map<string, OpsAlertRuleOutcome>();
    for (const rule of this.rules.list()) {
      try {
        await rule.check({ db: this.db, alerts: this.alerts });
        outcomes.set(rule.name, 'ok');
      } catch (err) {
        outcomes.set(rule.name, 'error');
        this.logger.warn({ rule: rule.name, error: errorSummary(err) }, 'Luật cảnh báo vận hành lỗi; lượt quét sau chạy lại');
      }
    }
    return outcomes;
  }
}
