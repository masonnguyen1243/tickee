import { Inject, Injectable, Logger } from '@nestjs/common';
import { JobQueue } from '@tickee/contracts';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { DATABASE, type Database, type Tx } from '../db/index.js';
import { BOSS, defineQueue, errorName, QueueProducer } from '../jobs/index.js';
import { dbErrorSummary, isDatabaseError } from '../logging/index.js';
import { OPS_ALERT_KIND_VALUES, OPS_ALERT_KINDS, type OpsAlertDedupe, type OpsAlertKind } from './kinds.js';
import { opsAlertMarks } from './schema.js';

/*
 * Kênh cảnh báo vận hành (Story 4.6-b), vai api và worker: `raise` ghi dấu chống lặp `(kind, subject)` vào
 * `ops_alert_marks` và, khi có subject mới, enqueue một job `platform.ops-alert` trong cùng transaction; worker gửi email
 * tới đội vận hành (`ops-alert-jobs.ts`). Nơi gọi raise SAU khi transaction của chính nó đã commit: raise lỗi không bao
 * giờ làm hỏng IPN, Đối soát bù hay link chia sẻ (đổi lại, tiến trình chết giữa chừng thì mất cảnh báo; marker vẫn còn
 * trong log).
 */

/** Số subject mới tối đa trong một job (và một email); số đếm vẫn là tổng số subject mới. */
export const OPS_ALERT_MAX_SUBJECTS = 20;

/** Số subject tối đa mỗi câu INSERT dấu (giới hạn tham số của Postgres). */
const MARK_CHUNK = 1_000;

/** Bộ nhớ chống lặp `cooldown` lớn hơn chừng này mục thì dọn mục đã hết hạn. */
const RECENT_PRUNE_SIZE = 1_000;

/** Giá trị chi tiết: chỉ id, mã, tên queue, số đếm, lý do (không PII, secret, chữ ký hay token). */
const detailValue = z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()]);

/** Chi tiết của một cảnh báo: khóa camelCase, giá trị vô hướng. */
export const OpsAlertDetails = z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), detailValue);
export type OpsAlertDetails = z.infer<typeof OpsAlertDetails>;

/** Payload của job `platform.ops-alert`. */
export const OpsAlertPayload = z.object({
  kind: z.enum(OPS_ALERT_KIND_VALUES),
  /** Số subject mới của lần raise (có thể lớn hơn số phần tử của `subjects`). */
  count: z.int().positive(),
  /** Tối đa `OPS_ALERT_MAX_SUBJECTS` subject mới, theo thứ tự tăng dần. */
  subjects: z.array(z.string().min(1).max(200)).min(1).max(OPS_ALERT_MAX_SUBJECTS),
  details: OpsAlertDetails,
});
export type OpsAlertPayload = z.infer<typeof OpsAlertPayload>;

/**
 * Queue email cảnh báo vận hành. Retry khi gửi lỗi (SMTP chập chờn): 8 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ).
 * Hết lượt thì pg-boss chép job sang `platform.ops-alert.dead-letter`: job quét chỉ log `error` cho queue đó. Lấy tối đa
 * 10 job mỗi lần, lấy tiếp ngay khi lô đầy; mỗi job được chốt riêng.
 */
export const OPS_ALERT_QUEUE = defineQueue({
  name: JobQueue.OPS_ALERT,
  deadLetter: JobQueue.OPS_ALERT_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: OpsAlertPayload,
});

/** Tạo queue email cảnh báo lúc khởi động (cả vai api, chế độ producer); `ready()` trước transaction của `raise`. */
@Injectable()
export class OpsAlertQueue extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, OPS_ALERT_QUEUE, 'khi có cảnh báo vận hành');
  }
}

/** Token DI của cấu hình kênh cảnh báo vận hành. */
export const OPS_ALERT_SETTINGS = Symbol('OPS_ALERT_SETTINGS');

export interface OpsAlertSettings {
  /** `OPS_ALERT_COOLDOWN_MINUTES`: loại `cooldown` báo lại cùng subject sau chừng này phút. */
  cooldownMinutes: number;
  /**
   * Đồng hồ (ms) của bộ nhớ chống lặp trong instance; mặc định `Date.now`, test thay. Dấu trong DB luôn theo đồng hồ DB.
   */
  now?: () => number;
}

export interface OpsAlertInput {
  kind: OpsAlertKind;
  /** Đối tượng chống lặp (id, mã Đơn, tên queue…). Trùng thì gộp; rỗng thì bỏ. */
  subjects: readonly string[];
  /** Chi tiết vào job, email và log (id, mã, tên queue, số đếm, lý do). */
  details?: OpsAlertDetails;
  /**
   * `false`: chỉ ghi dấu và log `error`, không enqueue email (dead-letter của chính kênh). Mặc định `true`.
   */
  notify?: boolean;
}

/** `raise` của kênh cảnh báo vận hành: một transaction ngắn ghi dấu chống lặp và enqueue email khi có subject mới. */
@Injectable()
export class OpsAlerts {
  private readonly logger = new Logger('OpsAlerts');
  /** Bộ nhớ chống lặp `cooldown` của instance: `kind\0subject` → mốc (ms) hết bỏ qua. */
  private readonly recent = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(OpsAlertQueue) private readonly queue: OpsAlertQueue,
    @Inject(OPS_ALERT_SETTINGS) private readonly settings: OpsAlertSettings,
  ) {
    this.now = settings.now ?? Date.now;
  }

  /**
   * Báo cảnh báo `kind` cho các `subjects`. Trả các subject mới (đã ghi dấu; tăng dần), `[]` khi không có subject mới.
   * - `once`: subject đã có dấu thì bỏ.
   * - `cooldown`: subject instance này vừa raise trong `OPS_ALERT_COOLDOWN_MINUTES` thì bỏ ngay trong bộ nhớ (không ghi
   *   DB); còn lại, dấu cũ hơn cooldown được ghi đè (mới), dấu còn trong cooldown thì bỏ.
   * Có subject mới: cùng transaction enqueue một job email (`details`, số subject mới, tối đa 20 subject mới), rồi log
   * `error` kèm `alert: <kind>`. Không bao giờ ném lỗi: lỗi (DB, pg-boss) chỉ log `warn`.
   */
  async raise(input: OpsAlertInput): Promise<string[]> {
    try {
      return await this.raiseOrThrow(input);
    } catch (err) {
      this.logger.warn(
        { kind: input.kind, error: isDatabaseError(err) ? dbErrorSummary(err) : { type: errorName(err) } },
        'Không ghi được cảnh báo vận hành; bỏ qua lần báo này',
      );
      return [];
    }
  }

  private async raiseOrThrow({ kind, subjects: input, details = {}, notify = true }: OpsAlertInput): Promise<string[]> {
    const spec = OPS_ALERT_KINDS[kind];
    const now = this.now();
    let subjects = [...new Set(input.filter((subject) => subject !== ''))].sort();
    if (spec.dedupe === 'cooldown') subjects = subjects.filter((subject) => !this.isRecent(kind, subject, now));
    if (subjects.length === 0) return [];
    const parsedDetails = OpsAlertDetails.parse(details);

    // Job email enqueue trong `tx`: pg-boss đã start và queue đã có, trước transaction.
    if (notify) await this.queue.ready();
    const fresh = await this.db.transaction(async (tx) => {
      const marked = (await this.mark(tx, kind, spec.dedupe, subjects)).sort();
      if (marked.length > 0 && notify) {
        await OPS_ALERT_QUEUE.enqueue(this.boss, tx, {
          kind,
          count: marked.length,
          subjects: marked.slice(0, OPS_ALERT_MAX_SUBJECTS),
          details: parsedDetails,
        });
      }
      return marked;
    });

    if (spec.dedupe === 'cooldown') this.remember(kind, subjects, now);
    if (fresh.length > 0) {
      this.logger.error(
        {
          alert: kind,
          count: fresh.length,
          subjects: fresh.slice(0, OPS_ALERT_MAX_SUBJECTS),
          details: parsedDetails,
          notify,
        },
        `Cảnh báo vận hành: ${spec.title}`,
      );
    }
    return fresh;
  }

  /**
   * Ghi dấu `(kind, subject)` trong `tx`, trả subject mới. `once`: `ON CONFLICT DO NOTHING`. `cooldown`: `ON CONFLICT DO
   * UPDATE SET raised_at = now() WHERE raised_at < now() - cooldown` (dấu còn trong cooldown không đổi, không trả về).
   * Subject đã sắp xếp: hai instance ghi chồng cùng tập subject khóa dòng theo cùng thứ tự.
   */
  private async mark(tx: Tx, kind: OpsAlertKind, dedupe: OpsAlertDedupe, subjects: readonly string[]): Promise<string[]> {
    const fresh: string[] = [];
    for (let i = 0; i < subjects.length; i += MARK_CHUNK) {
      const insert = tx
        .insert(opsAlertMarks)
        .values(subjects.slice(i, i + MARK_CHUNK).map((subject) => ({ kind, subject })));
      const rows =
        dedupe === 'once'
          ? await insert.onConflictDoNothing().returning({ subject: opsAlertMarks.subject })
          : await insert
              .onConflictDoUpdate({
                target: [opsAlertMarks.kind, opsAlertMarks.subject],
                set: { raisedAt: sql`now()` },
                setWhere: sql`${opsAlertMarks.raisedAt} < now() - make_interval(mins => ${this.settings.cooldownMinutes})`,
              })
              .returning({ subject: opsAlertMarks.subject });
      fresh.push(...rows.map((row) => row.subject));
    }
    return fresh;
  }

  private isRecent(kind: OpsAlertKind, subject: string, now: number): boolean {
    return (this.recent.get(`${kind}\0${subject}`) ?? 0) > now;
  }

  /** Instance vừa raise `subjects` (mới hay còn trong cooldown ở DB): bỏ qua trong bộ nhớ tới hết cooldown. */
  private remember(kind: OpsAlertKind, subjects: readonly string[], now: number): void {
    if (this.recent.size > RECENT_PRUNE_SIZE) {
      for (const [key, until] of this.recent) if (until <= now) this.recent.delete(key);
    }
    const until = now + this.settings.cooldownMinutes * 60_000;
    for (const subject of subjects) this.recent.set(`${kind}\0${subject}`, until);
  }
}
