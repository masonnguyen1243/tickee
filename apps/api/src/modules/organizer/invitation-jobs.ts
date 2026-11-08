import {
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { JobQueue, ORGANIZATION_INVITATION_PATH } from '@tickee/contracts';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { fromDrizzle, type JobResult, type PgBoss, type Queue, type WorkOptions } from 'pg-boss';
import { z } from 'zod';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { BOSS } from '../../platform/jobs/index.js';
import { buildAdminInvitationEmail } from './invitation-email.js';
import { generateInvitationToken, hashInvitationToken } from './invitation-token.js';
import { DefaultPayoutWorker } from './payout-default-jobs.js';
import { organizationInvitations, organizations } from './schema.js';

const QUEUE = JobQueue.ORGANIZER_SEND_ADMIN_INVITATION;
const DEAD_LETTER = JobQueue.ORGANIZER_SEND_ADMIN_INVITATION_DEAD_LETTER;

/**
 * Retry khi gửi lỗi (SMTP chập chờn): 8 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ) — vài giờ trước khi bỏ cuộc,
 * còn xa hạn 7 ngày của lời mời. Hết lượt thì pg-boss chép job sang dead-letter (cảnh báo dead-letter là Story 4.6).
 */
export const ADMIN_INVITATION_QUEUE_OPTIONS = {
  retryLimit: 8,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 3600,
  deadLetter: DEAD_LETTER,
} as const satisfies Omit<Queue, 'name'>;

/**
 * Lấy tối đa 10 job mỗi lần và lấy tiếp ngay khi lô đầy (dồn job thì xả nhanh, không chờ chu kỳ poll 2 giây cho từng
 * job); mỗi job được chốt riêng nên một email lỗi không làm hỏng cả lô.
 */
const WORK_OPTIONS = { batchSize: 10, burstWhenBatchFull: true, perJobResults: true } as const satisfies WorkOptions;

/** Payload của job: chỉ id lời mời — không email, không token. */
export const SendAdminInvitationPayload = z.object({ invitationId: z.uuid() });
export type SendAdminInvitationPayload = z.infer<typeof SendAdminInvitationPayload>;

/**
 * Tạo queue gửi lời mời và dead-letter của nó (gọi lại không sao). Cả vai `api` (gửi job) lẫn `worker` (xử lý) gọi lúc
 * khởi động: `boss.send` ném lỗi khi queue hoặc dead-letter chưa tồn tại. `createQueue` bỏ qua queue đã có (không đổi
 * cấu hình), nên `updateQueue` áp lại `ADMIN_INVITATION_QUEUE_OPTIONS` cho môi trường đã có queue.
 */
export async function ensureAdminInvitationQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(DEAD_LETTER);
  await boss.createQueue(QUEUE, ADMIN_INVITATION_QUEUE_OPTIONS);
  await boss.updateQueue(QUEUE, ADMIN_INVITATION_QUEUE_OPTIONS);
}

/**
 * Enqueue job gửi email mời bằng chính `tx` tạo lời mời: `tx` rollback thì không có job; commit thì job chắc chắn có.
 * Email không bao giờ được gửi trong transaction.
 */
export async function enqueueAdminInvitation(boss: PgBoss, tx: Tx, invitationId: string): Promise<void> {
  const payload: SendAdminInvitationPayload = { invitationId };
  const jobId = await boss.send(QUEUE, payload, { db: fromDrizzle(tx, sql) });
  if (!jobId) throw new Error(`pg-boss không tạo job ${QUEUE}`);
}

export interface AdminInvitationSender {
  db: Database;
  email: EmailTransport;
  /** Origin web, link là `{webOrigin}/loi-moi-btc#{token}`. */
  webOrigin: string;
}

/**
 * Gửi email mời (handler của job). Idempotent: lời mời đã gửi, đã thu hồi, đã nhận, hết hạn hoặc không tồn tại → bỏ qua
 * (`skipped`), job vẫn hoàn tất. Còn cần gửi thì sinh token mới, ghi hash (ghi đè hash của lần chạy trước nếu lần đó
 * chưa gửi được: link cũ chưa tới tay ai), gửi email ngoài transaction, rồi đánh dấu đã gửi. Gửi lỗi → ném lỗi để
 * pg-boss retry; lỗi chỉ mang tên lớp (message của lỗi SMTP có thể chứa địa chỉ email, mà job lưu lỗi vào DB).
 */
export async function sendAdminInvitation(sender: AdminInvitationSender, invitationId: string): Promise<'sent' | 'skipped'> {
  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const inv = organizationInvitations;
  const [pending] = await sender.db.orm
    .update(inv)
    .set({ tokenHash })
    .where(
      and(
        eq(inv.id, invitationId),
        isNull(inv.emailSentAt),
        isNull(inv.revokedAt),
        isNull(inv.acceptedAt),
        gt(inv.expiresAt, sql`now()`),
      ),
    )
    .returning({ email: inv.email, organizationId: inv.organizationId, expiresAt: inv.expiresAt });
  if (!pending) return 'skipped';

  const [org] = await sender.db.orm
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, pending.organizationId));
  if (!org) return 'skipped';

  const link = `${sender.webOrigin}${ORGANIZATION_INVITATION_PATH}#${token}`;
  try {
    await sender.email.send({
      to: pending.email,
      ...buildAdminInvitationEmail({ organizationName: org.name, link, expiresAt: pending.expiresAt }),
    });
  } catch (err) {
    const errName = (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';
    throw new Error(`Không gửi được email mời Admin (${errName})`);
  }

  // Chỉ đánh dấu khi hash vẫn là của lần chạy này (không đè dấu của một lần chạy khác).
  await sender.db.orm
    .update(inv)
    .set({ emailSentAt: sql`now()` })
    .where(and(eq(inv.id, invitationId), eq(inv.tokenHash, tokenHash)));
  return 'sent';
}

/**
 * Vai `api`: start pg-boss (chế độ `producer`) và tạo queue ngay lúc khởi động, không chặn khởi động khi DB chưa sẵn
 * sàng. Trước khi enqueue, `ready()` chờ việc đó xong (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class AdminInvitationQueues implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminInvitationQueues');
  private pending: Promise<void> | null = null;

  constructor(@Inject(BOSS) private readonly boss: PgBoss) {}

  onApplicationBootstrap(): void {
    this.ready().catch((err: unknown) => this.logger.warn({ err }, `Chưa tạo được queue ${QUEUE}; sẽ thử lại khi mời`));
  }

  ready(): Promise<void> {
    this.pending ??= (async () => {
      await this.boss.start();
      await ensureAdminInvitationQueues(this.boss);
    })().catch((err: unknown) => {
      this.pending = null;
      throw err;
    });
    return this.pending;
  }
}

export const ORGANIZER_JOBS_CONFIG = Symbol('ORGANIZER_JOBS_CONFIG');

export interface OrganizerJobsConfig {
  WEB_ORIGIN: string;
}

/** Vai `worker`: tạo queue và đăng ký handler gửi email mời Admin. */
@Injectable()
export class AdminInvitationWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminInvitationWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(ORGANIZER_JOBS_CONFIG) private readonly config: OrganizerJobsConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await ensureAdminInvitationQueues(this.boss);
    const sender: AdminInvitationSender = { db: this.db, email: this.email, webOrigin: this.config.WEB_ORIGIN };
    // `failed` → pg-boss retry theo cấu hình queue, hết lượt thì sang dead-letter. Payload hỏng thì retry vô ích:
    // sang dead-letter ngay.
    await this.boss.work<unknown>(QUEUE, WORK_OPTIONS, async (jobs) => {
      const results: JobResult[] = [];
      for (const job of jobs) {
        const payload = SendAdminInvitationPayload.safeParse(job.data);
        if (!payload.success) {
          results.push({ id: job.id, status: 'deadletter', output: { error: 'Payload không hợp lệ' } });
          continue;
        }
        const { invitationId } = payload.data;
        try {
          if ((await sendAdminInvitation(sender, invitationId)) === 'skipped') {
            // Chỉ id (không email): lần theo khi có người báo "không nhận được email".
            this.logger.log(
              { jobId: job.id, invitationId },
              'Bỏ qua job gửi lời mời: đã gửi, đã thu hồi, đã nhận, hết hạn hoặc không còn',
            );
          }
          results.push({ id: job.id, status: 'completed' });
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Lỗi không rõ';
          this.logger.warn({ jobId: job.id, invitationId, error }, 'Gửi email mời Admin thất bại; pg-boss sẽ thử lại');
          results.push({ id: job.id, status: 'failed', output: { error } });
        }
      }
      return results;
    });
    this.logger.log(`Đã đăng ký job ${QUEUE}`);
  }
}

/**
 * Job nền của `organizer` cho vai `worker` (gửi email mời Admin, email cảnh báo đổi tài khoản nhận tiền mặc định). Cần
 * `DbModule`, `JobsModule` và `EmailModule` (toàn cục) ở gốc DI.
 */
@Module({})
export class OrganizerJobsModule {
  static forRoot(config: OrganizerJobsConfig): DynamicModule {
    return {
      module: OrganizerJobsModule,
      providers: [{ provide: ORGANIZER_JOBS_CONFIG, useValue: config }, AdminInvitationWorker, DefaultPayoutWorker],
    };
  }
}
