import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue } from '@tickee/contracts';
import { and, asc, inArray, sql } from 'drizzle-orm';
import { fromDrizzle, type JobResult, type PgBoss, type Queue, type WorkOptions } from 'pg-boss';
import { z } from 'zod';
import { orgScope } from '../../platform/access/index.js';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { userContacts } from '../identity/index.js';
import { buildDefaultPayoutChangedEmail, DEFAULT_PAYOUT_CHANGE_REASONS } from './payout-default-email.js';
import { members, organizations, payoutAccounts } from './schema.js';

/*
 * Email cảnh báo đổi tài khoản nhận tiền mặc định (Story 2.13-a): mỗi lần tài khoản mặc định của BTC đổi (Owner đặt
 * tài khoản khác làm mặc định, hủy liên kết tài khoản mặc định, kể cả tài khoản cuối cùng, hoặc đổi key Tingee ở
 * 2.13-b), service enqueue một job bằng chính `tx` của thay đổi; worker gửi email cho Owner và mọi Admin của BTC.
 */

const QUEUE = JobQueue.ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED;
const DEAD_LETTER = JobQueue.ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED_DEAD_LETTER;

/**
 * Retry khi gửi lỗi (SMTP chập chờn): 8 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ). Hết lượt thì pg-boss chép
 * job sang dead-letter (như job mời Admin; cảnh báo dead-letter là Story 4.6).
 */
export const DEFAULT_PAYOUT_QUEUE_OPTIONS = {
  retryLimit: 8,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3600,
  deadLetter: DEAD_LETTER,
} as const satisfies Omit<Queue, 'name'>;

/** Như job mời Admin: lô tối đa 10 job, lấy tiếp ngay khi lô đầy, mỗi job được chốt riêng. */
const WORK_OPTIONS = { batchSize: 10, burstWhenBatchFull: true, perJobResults: true } as const satisfies WorkOptions;

/** Payload của job: chỉ id và mốc giờ, không PII (4 số cuối và email người nhận đọc lúc gửi). */
export const DefaultPayoutChangedPayload = z
  .object({
    organizationId: z.uuid(),
    /**
     * Tài khoản thôi là mặc định (dòng đã hủy liên kết vẫn còn nên luôn đọc được); `null`: trước đó BTC không có tài
     * khoản nhận tiền nào (đã hủy hết rồi mới đổi key Tingee).
     */
    previousAccountId: z.uuid().nullable(),
    /** Tài khoản mới là mặc định; `null`: BTC không còn tài khoản nhận tiền. */
    nextAccountId: z.uuid().nullable(),
    actorUserId: z.uuid(),
    changedAt: z.iso.datetime({ offset: true }),
    /** Vì sao mặc định đổi; thiếu (job tạo trước 2.13-b) → `default_changed`. */
    reason: z.enum(DEFAULT_PAYOUT_CHANGE_REASONS).default('default_changed'),
  })
  .refine((p) => p.previousAccountId !== null || p.nextAccountId !== null, {
    message: 'Cần ít nhất một trong previousAccountId, nextAccountId',
  });
/** Dạng gửi vào (`reason` không bắt buộc); worker nhận dạng đã parse, luôn có `reason`. */
export type DefaultPayoutChangedPayload = z.input<typeof DefaultPayoutChangedPayload>;

/**
 * Tạo queue cảnh báo và dead-letter của nó (gọi lại không sao). Cả vai `api` (gửi job) lẫn `worker` (xử lý) gọi lúc
 * khởi động: `boss.send` ném lỗi khi queue hoặc dead-letter chưa tồn tại. `updateQueue` áp lại
 * `DEFAULT_PAYOUT_QUEUE_OPTIONS` cho môi trường đã có queue.
 */
export async function ensureDefaultPayoutQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER);
  await boss.createQueue(QUEUE, DEFAULT_PAYOUT_QUEUE_OPTIONS);
  await boss.updateQueue(QUEUE, DEFAULT_PAYOUT_QUEUE_OPTIONS);
}

/**
 * Enqueue email cảnh báo bằng chính `tx` của thay đổi: `tx` rollback thì không có job, nên không có email nào được gửi.
 * Người gọi đã `DefaultPayoutQueues.ready()` trước transaction.
 */
export async function enqueueDefaultPayoutChanged(
  boss: PgBoss,
  tx: Tx,
  payload: DefaultPayoutChangedPayload,
): Promise<void> {
  const jobId = await boss.send(QUEUE, DefaultPayoutChangedPayload.parse(payload), { db: fromDrizzle(tx, sql) });
  if (!jobId) throw new Error(`pg-boss không tạo job ${QUEUE}`);
}

export interface DefaultPayoutNotifier {
  db: Database;
  email: EmailTransport;
}

const errorName = (err: unknown): string =>
  (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';

/**
 * Handler của job: đọc tên BTC, tên ngân hàng + 4 số cuối của hai tài khoản (kể cả dòng đã hủy liên kết; phía `null`
 * là "chưa có / không còn tài khoản nhận tiền"), người đổi và danh sách Owner + Admin hiện tại, rồi gửi mỗi người một
 * email. BTC hay tài khoản không còn → `skipped` (job vẫn hoàn tất). Có email gửi lỗi → ném lỗi để pg-boss retry (lần
 * retry gửi lại cho mọi người: thà trùng còn hơn mất cảnh báo); lỗi chỉ mang tên lớp (message của lỗi SMTP có thể chứa
 * địa chỉ email, mà job lưu lỗi vào DB).
 * @returns số email đã gửi, hoặc `skipped`.
 */
export async function notifyDefaultPayoutChanged(
  notifier: DefaultPayoutNotifier,
  payload: DefaultPayoutChangedPayload,
): Promise<number | 'skipped'> {
  const { db } = notifier;
  const scope = orgScope({ organizationId: payload.organizationId });
  const [org] = await db.orm
    .select({ name: organizations.name })
    .from(organizations)
    .where(scope({ organizationId: organizations.id }));
  if (!org) return 'skipped';

  const accountIds = [payload.previousAccountId, payload.nextAccountId].filter((id): id is string => id !== null);
  const accounts = await db.orm
    .select({ id: payoutAccounts.id, bankName: payoutAccounts.bankName, accountLast4: payoutAccounts.accountLast4 })
    .from(payoutAccounts)
    .where(and(scope(payoutAccounts), inArray(payoutAccounts.id, accountIds)));
  // `undefined`: id có trong payload nhưng không còn (hoặc của BTC khác); `null`: không có tài khoản ở phía đó.
  const accountOf = (id: string | null) => (id === null ? null : accounts.find((a) => a.id === id));
  const previous = accountOf(payload.previousAccountId);
  const next = accountOf(payload.nextAccountId);
  if (previous === undefined || next === undefined) return 'skipped';

  const recipients = await db.orm
    .select({ userId: members.userId })
    .from(members)
    .where(scope(members))
    .orderBy(sql`${members.role} = 'owner' DESC`, asc(members.createdAt), asc(members.id));
  const contacts = await userContacts(db.orm, [...recipients.map((r) => r.userId), payload.actorUserId]);
  const actor = contacts.get(payload.actorUserId);
  const message = buildDefaultPayoutChangedEmail({
    organizationName: org.name,
    reason: payload.reason ?? 'default_changed',
    previous,
    next,
    actor: actor ? actor.name.trim() || actor.email : 'Không rõ',
    changedAt: new Date(payload.changedAt),
  });

  const addresses = [...new Set(recipients.flatMap((r) => contacts.get(r.userId)?.email ?? []))];
  const failures: unknown[] = [];
  for (const to of addresses) {
    try {
      await notifier.email.send({ to, ...message });
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `Không gửi được ${failures.length}/${addresses.length} email cảnh báo đổi tài khoản nhận tiền (${errorName(failures[0])})`,
    );
  }
  return addresses.length;
}

/**
 * Vai `api`: start pg-boss (chế độ `producer`) và tạo queue ngay lúc khởi động, không chặn khởi động khi DB chưa sẵn
 * sàng. Trước transaction có thể enqueue, `ready()` chờ việc đó xong (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class DefaultPayoutQueues implements OnApplicationBootstrap {
  private readonly logger = new Logger('DefaultPayoutQueues');
  private pending: Promise<void> | null = null;

  constructor(@Inject(BOSS) private readonly boss: PgBoss) {}

  onApplicationBootstrap(): void {
    this.ready().catch((err: unknown) =>
      this.logger.warn({ err }, `Chưa tạo được queue ${QUEUE}; sẽ thử lại khi đổi tài khoản nhận tiền`),
    );
  }

  ready(): Promise<void> {
    this.pending ??= (async () => {
      await this.boss.start();
      await ensureDefaultPayoutQueues(this.boss);
    })().catch((err: unknown) => {
      this.pending = null;
      throw err;
    });
    return this.pending;
  }
}

/** Vai `worker`: tạo queue và đăng ký handler gửi email cảnh báo. */
@Injectable()
export class DefaultPayoutWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('DefaultPayoutWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensureDefaultPayoutQueues(this.boss);
    const notifier: DefaultPayoutNotifier = { db: this.db, email: this.email };
    await this.boss.work<unknown>(QUEUE, WORK_OPTIONS, async (jobs) => {
      const results: JobResult[] = [];
      for (const job of jobs) {
        const payload = DefaultPayoutChangedPayload.safeParse(job.data);
        if (!payload.success) {
          // Payload hỏng thì retry vô ích: sang dead-letter ngay.
          this.logger.error({ jobId: job.id }, 'Payload job cảnh báo đổi tài khoản nhận tiền không hợp lệ');
          results.push({ id: job.id, status: 'deadletter', output: { error: 'Payload không hợp lệ' } });
          continue;
        }
        const { organizationId } = payload.data;
        try {
          const sent = await notifyDefaultPayoutChanged(notifier, payload.data);
          // Chỉ id (không email, không 4 số cuối).
          if (sent === 'skipped') this.logger.log({ jobId: job.id, organizationId }, 'Bỏ qua cảnh báo: BTC/tài khoản không còn');
          results.push({ id: job.id, status: 'completed' });
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Lỗi không rõ';
          this.logger.warn({ jobId: job.id, organizationId, error }, 'Gửi email cảnh báo thất bại; pg-boss sẽ thử lại');
          results.push({ id: job.id, status: 'failed', output: { error } });
        }
      }
      return results;
    });
    this.logger.log(`Đã đăng ký job ${QUEUE}`);
  }
}
