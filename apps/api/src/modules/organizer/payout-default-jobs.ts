import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue } from '@tickee/contracts';
import { and, asc, inArray, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { orgScope } from '../../platform/access/index.js';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import {
  BOSS,
  defineQueue,
  fanOut,
  JOB_COMPLETED,
  QueueProducer,
  registerQueueWorker,
} from '../../platform/jobs/index.js';
import { userContacts } from '../identity/index.js';
import {
  buildDefaultPayoutChangedEmail,
  DEFAULT_PAYOUT_CHANGE_REASONS,
  type PayoutAccountLabel,
} from './payout-default-email.js';
import { members, organizations, payoutAccounts } from './schema.js';

/*
 * Email cảnh báo đổi tài khoản nhận tiền mặc định (Story 2.13-a): mỗi lần tài khoản mặc định của BTC đổi (Owner đặt
 * tài khoản khác làm mặc định, hủy liên kết tài khoản mặc định, kể cả tài khoản cuối cùng, hoặc đổi key Tingee ở
 * 2.13-b), service enqueue một job gốc bằng chính `tx` của thay đổi. Worker chạy job gốc: chốt danh sách Owner + Admin
 * của BTC lúc xử lý rồi tạo mỗi người một job con trong cùng queue; job con gửi đúng một email. SMTP lỗi với một địa
 * chỉ thì chỉ job con của người đó retry, người khác không nhận lại.
 */

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
    /**
     * Có: job con, gửi đúng một email cho người này. Thiếu: job gốc (kể cả job enqueue trước khi tách theo người
     * nhận), tính danh sách người nhận rồi tạo job con.
     */
    recipientUserId: z.uuid().optional(),
  })
  .refine((p) => p.previousAccountId !== null || p.nextAccountId !== null, {
    message: 'Cần ít nhất một trong previousAccountId, nextAccountId',
  });
/** Dạng gửi vào (`reason` không bắt buộc); worker nhận dạng đã parse, luôn có `reason`. */
export type DefaultPayoutChangedPayload = z.input<typeof DefaultPayoutChangedPayload>;

/**
 * Retry khi gửi lỗi (SMTP chập chờn): 8 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ). Hết lượt thì pg-boss chép
 * job sang dead-letter (như job mời Admin; cảnh báo dead-letter là Story 4.6). Lô tối đa 10 job, lấy tiếp ngay khi lô
 * đầy, mỗi job được chốt riêng.
 */
export const DEFAULT_PAYOUT_QUEUE = defineQueue({
  name: JobQueue.ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED,
  deadLetter: JobQueue.ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: DefaultPayoutChangedPayload,
});
export const DEFAULT_PAYOUT_QUEUE_OPTIONS = DEFAULT_PAYOUT_QUEUE.queueOptions;

/**
 * Tạo queue cảnh báo và dead-letter của nó (gọi lại không sao). Cả vai `api` (gửi job) lẫn `worker` (xử lý) gọi lúc
 * khởi động.
 */
export const ensureDefaultPayoutQueues = (boss: PgBoss): Promise<void> => DEFAULT_PAYOUT_QUEUE.ensure(boss);

/**
 * Enqueue job gốc cảnh báo bằng chính `tx` của thay đổi: `tx` rollback thì không có job, nên không có email nào được
 * gửi. Người gọi đã `DefaultPayoutQueues.ready()` trước transaction.
 */
export async function enqueueDefaultPayoutChanged(
  boss: PgBoss,
  tx: Tx,
  payload: Omit<DefaultPayoutChangedPayload, 'recipientUserId'>,
): Promise<void> {
  await DEFAULT_PAYOUT_QUEUE.enqueue(boss, tx, payload);
}

export interface DefaultPayoutNotifier {
  db: Database;
  email: EmailTransport;
}

const errorName = (err: unknown): string =>
  (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';

interface DefaultPayoutChange {
  organizationName: string;
  /** `null`: không có tài khoản ở phía đó. */
  previous: PayoutAccountLabel | null;
  next: PayoutAccountLabel | null;
}

/**
 * Tên BTC và tên ngân hàng + 4 số cuối của hai tài khoản (kể cả dòng đã hủy liên kết). BTC không còn, hoặc id tài
 * khoản trong payload không còn (hay của BTC khác) → `undefined`.
 */
async function loadChange(db: Database, payload: DefaultPayoutChangedPayload): Promise<DefaultPayoutChange | undefined> {
  const scope = orgScope({ organizationId: payload.organizationId });
  const [org] = await db.orm
    .select({ name: organizations.name })
    .from(organizations)
    .where(scope({ organizationId: organizations.id }));
  if (!org) return undefined;

  const accountIds = [payload.previousAccountId, payload.nextAccountId].filter((id): id is string => id !== null);
  const accounts = await db.orm
    .select({ id: payoutAccounts.id, bankName: payoutAccounts.bankName, accountLast4: payoutAccounts.accountLast4 })
    .from(payoutAccounts)
    .where(and(scope(payoutAccounts), inArray(payoutAccounts.id, accountIds)));
  // `undefined`: id có trong payload nhưng không còn (hoặc của BTC khác); `null`: không có tài khoản ở phía đó.
  const accountOf = (id: string | null) => (id === null ? null : accounts.find((a) => a.id === id));
  const previous = accountOf(payload.previousAccountId);
  const next = accountOf(payload.nextAccountId);
  if (previous === undefined || next === undefined) return undefined;
  return { organizationName: org.name, previous, next };
}

/**
 * Job gốc: người nhận email cảnh báo, theo thứ tự liệt kê: Owner rồi mọi Admin của BTC lúc xử lý (theo ngày vào). Job
 * con tạo cùng lúc nên thứ tự gửi thực tế không cố định. BTC hay tài khoản không còn → `skipped`.
 */
export async function defaultPayoutRecipients(
  db: Database,
  payload: DefaultPayoutChangedPayload,
): Promise<string[] | 'skipped'> {
  if ((await loadChange(db, payload)) === undefined) return 'skipped';
  const recipients = await db.orm
    .select({ userId: members.userId })
    .from(members)
    .where(orgScope({ organizationId: payload.organizationId })(members))
    .orderBy(sql`${members.role} = 'owner' DESC`, asc(members.createdAt), asc(members.id));
  return recipients.map((r) => r.userId);
}

/**
 * Job con: gửi email cảnh báo cho đúng một người: tên BTC, tài khoản cũ → mới (phía `null` là "chưa có / không còn tài
 * khoản nhận tiền"), người đổi, giờ Việt Nam. BTC hay tài khoản không còn, hoặc người nhận không còn tài khoản →
 * `skipped`. Gửi lỗi → ném lỗi để pg-boss retry riêng job con này; lỗi chỉ mang tên lớp (message của lỗi SMTP có thể
 * chứa địa chỉ email, mà job lưu lỗi vào DB).
 */
export async function sendDefaultPayoutChangedEmail(
  notifier: DefaultPayoutNotifier,
  payload: DefaultPayoutChangedPayload,
  recipientUserId: string,
): Promise<'sent' | 'skipped'> {
  const { db } = notifier;
  const change = await loadChange(db, payload);
  if (change === undefined) return 'skipped';

  const contacts = await userContacts(db.orm, [recipientUserId, payload.actorUserId]);
  const to = contacts.get(recipientUserId)?.email;
  if (!to) return 'skipped';
  const actor = contacts.get(payload.actorUserId);
  const message = buildDefaultPayoutChangedEmail({
    ...change,
    reason: payload.reason ?? 'default_changed',
    actor: actor ? actor.name.trim() || actor.email : 'Không rõ',
    changedAt: new Date(payload.changedAt),
  });
  try {
    await notifier.email.send({ to, ...message });
  } catch (err) {
    throw new Error(`Không gửi được email cảnh báo đổi tài khoản nhận tiền (${errorName(err)})`);
  }
  return 'sent';
}

/**
 * Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` chờ việc đó trước transaction có thể enqueue
 * (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class DefaultPayoutQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, DEFAULT_PAYOUT_QUEUE, 'khi đổi tài khoản nhận tiền');
  }
}

/** Vai `worker`: tạo queue và đăng ký handler: job gốc tạo job con theo người nhận, job con gửi một email. */
@Injectable()
export class DefaultPayoutWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('DefaultPayoutWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const notifier: DefaultPayoutNotifier = { db: this.db, email: this.email };
    await registerQueueWorker(this.boss, DEFAULT_PAYOUT_QUEUE, {
      logger: this.logger,
      label: 'Gửi email cảnh báo',
      logContext: ({ organizationId, recipientUserId }) => ({ organizationId, recipientUserId }),
      handle: async (payload, job) => {
        const { organizationId, recipientUserId } = payload;
        // Chỉ id trong log (không email, không 4 số cuối).
        if (recipientUserId === undefined) {
          const recipients = await defaultPayoutRecipients(this.db, payload);
          if (recipients === 'skipped') {
            this.logger.log({ jobId: job.id, organizationId }, 'Bỏ qua cảnh báo: BTC/tài khoản không còn');
            return JOB_COMPLETED;
          }
          await fanOut(
            this.boss,
            DEFAULT_PAYOUT_QUEUE,
            job.id,
            recipients.map((userId) => ({ key: userId, payload: { ...payload, recipientUserId: userId } })),
          );
          return JOB_COMPLETED;
        }
        if ((await sendDefaultPayoutChangedEmail(notifier, payload, recipientUserId)) === 'skipped') {
          this.logger.log(
            { jobId: job.id, organizationId, recipientUserId },
            'Bỏ qua cảnh báo: BTC/tài khoản hoặc người nhận không còn',
          );
        }
        return JOB_COMPLETED;
      },
    });
  }
}
