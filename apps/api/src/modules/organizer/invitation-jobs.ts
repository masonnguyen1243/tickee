import { Inject, Injectable, Logger, Module, type DynamicModule, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, ORGANIZATION_INVITATION_PATH } from '@tickee/contracts';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import { BOSS, defineQueue, JOB_COMPLETED, QueueProducer, registerQueueWorker } from '../../platform/jobs/index.js';
import { buildAdminInvitationEmail } from './invitation-email.js';
import { generateInvitationToken, hashInvitationToken } from './invitation-token.js';
import { OwnershipTransferWorker } from './ownership-transfer-jobs.js';
import { DefaultPayoutWorker } from './payout-default-jobs.js';
import { organizationInvitations, organizations } from './schema.js';

/** Payload của job: chỉ id lời mời — không email, không token. */
export const SendAdminInvitationPayload = z.object({ invitationId: z.uuid() });
export type SendAdminInvitationPayload = z.infer<typeof SendAdminInvitationPayload>;

/**
 * Queue gửi email mời Admin. Retry khi gửi lỗi (SMTP chập chờn): 8 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ) —
 * vài giờ trước khi bỏ cuộc, còn xa hạn 7 ngày của lời mời. Hết lượt thì pg-boss chép job sang dead-letter (cảnh báo
 * dead-letter là Story 4.6). Lấy tối đa 10 job mỗi lần và lấy tiếp ngay khi lô đầy (dồn job thì xả nhanh, không chờ chu
 * kỳ poll 2 giây cho từng job); mỗi job được chốt riêng nên một email lỗi không làm hỏng cả lô.
 */
export const ADMIN_INVITATION_QUEUE = defineQueue({
  name: JobQueue.ORGANIZER_SEND_ADMIN_INVITATION,
  deadLetter: JobQueue.ORGANIZER_SEND_ADMIN_INVITATION_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: SendAdminInvitationPayload,
});
export const ADMIN_INVITATION_QUEUE_OPTIONS = ADMIN_INVITATION_QUEUE.queueOptions;

/**
 * Tạo queue gửi lời mời và dead-letter của nó (gọi lại không sao). Cả vai `api` (gửi job) lẫn `worker` (xử lý) gọi lúc
 * khởi động.
 */
export const ensureAdminInvitationQueues = (boss: PgBoss): Promise<void> => ADMIN_INVITATION_QUEUE.ensure(boss);

/**
 * Enqueue job gửi email mời bằng chính `tx` tạo lời mời: `tx` rollback thì không có job; commit thì job chắc chắn có.
 * Email không bao giờ được gửi trong transaction.
 */
export async function enqueueAdminInvitation(boss: PgBoss, tx: Tx, invitationId: string): Promise<void> {
  await ADMIN_INVITATION_QUEUE.enqueue(boss, tx, { invitationId });
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
 * Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` chờ việc đó trước khi enqueue (lần trước lỗi
 * thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class AdminInvitationQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, ADMIN_INVITATION_QUEUE, 'khi mời');
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
    const sender: AdminInvitationSender = { db: this.db, email: this.email, webOrigin: this.config.WEB_ORIGIN };
    await registerQueueWorker(this.boss, ADMIN_INVITATION_QUEUE, {
      logger: this.logger,
      label: 'Gửi email mời Admin',
      logContext: ({ invitationId }) => ({ invitationId }),
      handle: async ({ invitationId }, job) => {
        if ((await sendAdminInvitation(sender, invitationId)) === 'skipped') {
          // Chỉ id (không email): lần theo khi có người báo "không nhận được email".
          this.logger.log(
            { jobId: job.id, invitationId },
            'Bỏ qua job gửi lời mời: đã gửi, đã thu hồi, đã nhận, hết hạn hoặc không còn',
          );
        }
        return JOB_COMPLETED;
      },
    });
  }
}

/**
 * Job nền của `organizer` cho vai `worker` (gửi email mời Admin, email cảnh báo đổi tài khoản nhận tiền mặc định,
 * email báo chuyển quyền Owner). Cần `DbModule`, `JobsModule` và `EmailModule` (toàn cục) ở gốc DI.
 */
@Module({})
export class OrganizerJobsModule {
  static forRoot(config: OrganizerJobsConfig): DynamicModule {
    return {
      module: OrganizerJobsModule,
      providers: [
        { provide: ORGANIZER_JOBS_CONFIG, useValue: config },
        AdminInvitationWorker,
        DefaultPayoutWorker,
        OwnershipTransferWorker,
      ],
    };
  }
}
