import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, Role } from '@tickee/contracts';
import { asc, sql } from 'drizzle-orm';
import { fromDrizzle, type JobResult, type PgBoss, type Queue, type WorkOptions } from 'pg-boss';
import { z } from 'zod';
import { orgScope } from '../../platform/access/index.js';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { userContacts } from '../identity/index.js';
import { buildOwnershipTransferredEmail } from './ownership-transfer-email.js';
import { members, organizations } from './schema.js';

/*
 * Email báo chuyển quyền Owner (Story 2.14): `MembersService.transferOwnership` enqueue một job bằng chính `tx` của
 * thay đổi; worker gửi email cho Owner cũ, Owner mới và mọi Admin khác của BTC tại thời điểm gửi.
 */

const QUEUE = JobQueue.ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED;
const DEAD_LETTER = JobQueue.ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED_DEAD_LETTER;

/** Như email cảnh báo đổi tài khoản nhận tiền: 8 lần retry, 30 giây rồi gấp đôi (tối đa 1 giờ), rồi dead-letter. */
export const OWNERSHIP_TRANSFER_QUEUE_OPTIONS = {
  retryLimit: 8,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3600,
  deadLetter: DEAD_LETTER,
} as const satisfies Omit<Queue, 'name'>;

const WORK_OPTIONS = { batchSize: 10, burstWhenBatchFull: true, perJobResults: true } as const satisfies WorkOptions;

/** Payload của job: chỉ id, không PII (tên và email người nhận đọc lúc gửi). */
export const OwnershipTransferredPayload = z.object({
  organizationId: z.uuid(),
  previousOwnerUserId: z.uuid(),
  newOwnerUserId: z.uuid(),
});
export type OwnershipTransferredPayload = z.infer<typeof OwnershipTransferredPayload>;

/** Tạo queue và dead-letter (gọi lại không sao); vai `api` và `worker` đều gọi lúc khởi động. */
export async function ensureOwnershipTransferQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER);
  await boss.createQueue(QUEUE, OWNERSHIP_TRANSFER_QUEUE_OPTIONS);
  await boss.updateQueue(QUEUE, OWNERSHIP_TRANSFER_QUEUE_OPTIONS);
}

/**
 * Enqueue email báo chuyển quyền bằng chính `tx` của thay đổi: `tx` rollback thì không có job. Người gọi đã
 * `OwnershipTransferQueues.ready()` trước transaction.
 */
export async function enqueueOwnershipTransferred(
  boss: PgBoss,
  tx: Tx,
  payload: OwnershipTransferredPayload,
): Promise<void> {
  const jobId = await boss.send(QUEUE, OwnershipTransferredPayload.parse(payload), { db: fromDrizzle(tx, sql) });
  if (!jobId) throw new Error(`pg-boss không tạo job ${QUEUE}`);
}

export interface OwnershipTransferNotifier {
  db: Database;
  email: EmailTransport;
}

const errorName = (err: unknown): string =>
  (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';

/**
 * Handler của job: đọc tên BTC, tên của Owner cũ và Owner mới, danh sách thành viên hiện tại, rồi gửi mỗi người một
 * email: Owner cũ, Owner mới (kể cả khi đã rời BTC sau đó, để họ vẫn biết) và mọi Admin còn trong BTC lúc gửi (người đã
 * bị xóa không nhận). BTC không còn → `skipped`. Có email gửi lỗi → ném lỗi (chỉ tên lớp) để pg-boss retry.
 * @returns số email đã gửi, hoặc `skipped`.
 */
export async function notifyOwnershipTransferred(
  notifier: OwnershipTransferNotifier,
  payload: OwnershipTransferredPayload,
): Promise<number | 'skipped'> {
  const { db } = notifier;
  const scope = orgScope({ organizationId: payload.organizationId });
  const [org] = await db.orm
    .select({ name: organizations.name })
    .from(organizations)
    .where(scope({ organizationId: organizations.id }));
  if (!org) return 'skipped';

  const admins = await db.orm
    .select({ userId: members.userId })
    .from(members)
    .where(scope(members))
    .orderBy(sql`${members.role} = ${Role.OWNER} DESC`, asc(members.createdAt), asc(members.id));
  const recipientIds = [
    payload.previousOwnerUserId,
    payload.newOwnerUserId,
    ...admins.map((m) => m.userId).filter((id) => id !== payload.previousOwnerUserId && id !== payload.newOwnerUserId),
  ];
  const contacts = await userContacts(db.orm, recipientIds);
  const label = (userId: string) => {
    const contact = contacts.get(userId);
    return contact ? contact.name.trim() || contact.email : 'Không rõ';
  };
  const message = buildOwnershipTransferredEmail({
    organizationName: org.name,
    previousOwner: label(payload.previousOwnerUserId),
    newOwner: label(payload.newOwnerUserId),
  });

  const addresses = [...new Set(recipientIds.flatMap((id) => contacts.get(id)?.email ?? []))];
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
      `Không gửi được ${failures.length}/${addresses.length} email báo chuyển quyền Owner (${errorName(failures[0])})`,
    );
  }
  return addresses.length;
}

/** Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` chờ việc đó trước transaction. */
@Injectable()
export class OwnershipTransferQueues implements OnApplicationBootstrap {
  private readonly logger = new Logger('OwnershipTransferQueues');
  private pending: Promise<void> | null = null;

  constructor(@Inject(BOSS) private readonly boss: PgBoss) {}

  onApplicationBootstrap(): void {
    this.ready().catch((err: unknown) =>
      this.logger.warn({ err }, `Chưa tạo được queue ${QUEUE}; sẽ thử lại khi chuyển quyền Owner`),
    );
  }

  ready(): Promise<void> {
    this.pending ??= (async () => {
      await this.boss.start();
      await ensureOwnershipTransferQueues(this.boss);
    })().catch((err: unknown) => {
      this.pending = null;
      throw err;
    });
    return this.pending;
  }
}

/** Vai `worker`: tạo queue và đăng ký handler gửi email báo chuyển quyền Owner. */
@Injectable()
export class OwnershipTransferWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('OwnershipTransferWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensureOwnershipTransferQueues(this.boss);
    const notifier: OwnershipTransferNotifier = { db: this.db, email: this.email };
    await this.boss.work<unknown>(QUEUE, WORK_OPTIONS, async (jobs) => {
      const results: JobResult[] = [];
      for (const job of jobs) {
        const payload = OwnershipTransferredPayload.safeParse(job.data);
        if (!payload.success) {
          this.logger.error({ jobId: job.id }, 'Payload job báo chuyển quyền Owner không hợp lệ');
          results.push({ id: job.id, status: 'deadletter', output: { error: 'Payload không hợp lệ' } });
          continue;
        }
        const { organizationId } = payload.data;
        try {
          const sent = await notifyOwnershipTransferred(notifier, payload.data);
          if (sent === 'skipped') this.logger.log({ jobId: job.id, organizationId }, 'Bỏ qua email chuyển quyền: BTC không còn');
          results.push({ id: job.id, status: 'completed' });
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Lỗi không rõ';
          this.logger.warn({ jobId: job.id, organizationId, error }, 'Gửi email chuyển quyền thất bại; pg-boss sẽ thử lại');
          results.push({ id: job.id, status: 'failed', output: { error } });
        }
      }
      return results;
    });
    this.logger.log(`Đã đăng ký job ${QUEUE}`);
  }
}
