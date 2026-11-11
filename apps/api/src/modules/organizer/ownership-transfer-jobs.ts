import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, Role } from '@tickee/contracts';
import { asc, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { orgScope } from '../../platform/access/index.js';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import {
  BOSS,
  defineQueue,
  errorName,
  fanOut,
  JOB_COMPLETED,
  QueueProducer,
  registerQueueWorker,
} from '../../platform/jobs/index.js';
import { userContacts } from '../identity/index.js';
import { buildOwnershipTransferredEmail } from './ownership-transfer-email.js';
import { members, organizations } from './schema.js';

/*
 * Email báo chuyển quyền Owner (Story 2.14): `MembersService.transferOwnership` enqueue một job gốc bằng chính `tx` của
 * thay đổi. Worker chạy job gốc: chốt danh sách người nhận (Owner cũ, Owner mới và mọi Admin khác của BTC lúc xử lý)
 * rồi tạo mỗi người một job con trong cùng queue; job con gửi đúng một email. SMTP lỗi với một địa chỉ thì chỉ job con
 * của người đó retry, người khác không nhận lại.
 */

/** Payload của job: chỉ id, không PII (tên và email người nhận đọc lúc gửi). */
export const OwnershipTransferredPayload = z.object({
  organizationId: z.uuid(),
  previousOwnerUserId: z.uuid(),
  newOwnerUserId: z.uuid(),
  /**
   * Có: job con, gửi đúng một email cho người này. Thiếu: job gốc (kể cả job enqueue trước khi tách theo người nhận),
   * tính danh sách người nhận rồi tạo job con.
   */
  recipientUserId: z.uuid().optional(),
});
export type OwnershipTransferredPayload = z.infer<typeof OwnershipTransferredPayload>;

/** Như email cảnh báo đổi tài khoản nhận tiền: 8 lần retry, 30 giây rồi gấp đôi (tối đa 1 giờ), rồi dead-letter. */
export const OWNERSHIP_TRANSFER_QUEUE = defineQueue({
  name: JobQueue.ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED,
  deadLetter: JobQueue.ORGANIZER_NOTIFY_OWNERSHIP_TRANSFERRED_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: OwnershipTransferredPayload,
});
export const OWNERSHIP_TRANSFER_QUEUE_OPTIONS = OWNERSHIP_TRANSFER_QUEUE.queueOptions;

/** Tạo queue và dead-letter (gọi lại không sao); vai `api` và `worker` đều gọi lúc khởi động. */
export const ensureOwnershipTransferQueues = (boss: PgBoss): Promise<void> => OWNERSHIP_TRANSFER_QUEUE.ensure(boss);

/**
 * Enqueue job gốc báo chuyển quyền bằng chính `tx` của thay đổi: `tx` rollback thì không có job. Người gọi đã
 * `OwnershipTransferQueues.ready()` trước transaction.
 */
export async function enqueueOwnershipTransferred(
  boss: PgBoss,
  tx: Tx,
  payload: Omit<OwnershipTransferredPayload, 'recipientUserId'>,
): Promise<void> {
  await OWNERSHIP_TRANSFER_QUEUE.enqueue(boss, tx, payload);
}

export interface OwnershipTransferNotifier {
  db: Database;
  email: EmailTransport;
}

async function organizationName(db: Database, organizationId: string): Promise<string | undefined> {
  const scope = orgScope({ organizationId });
  const [org] = await db.orm
    .select({ name: organizations.name })
    .from(organizations)
    .where(scope({ organizationId: organizations.id }));
  return org?.name;
}

/**
 * Job gốc: người nhận email báo chuyển quyền, theo thứ tự liệt kê: Owner cũ, Owner mới (kể cả khi đã rời BTC sau đó, để
 * họ vẫn biết), rồi mọi Admin khác còn trong BTC lúc xử lý (Owner trước, rồi theo ngày vào; người đã bị xóa không nhận).
 * Job con tạo cùng lúc nên thứ tự gửi thực tế không cố định. BTC không còn → `skipped`.
 */
export async function ownershipTransferRecipients(
  db: Database,
  payload: OwnershipTransferredPayload,
): Promise<string[] | 'skipped'> {
  if ((await organizationName(db, payload.organizationId)) === undefined) return 'skipped';
  const scope = orgScope({ organizationId: payload.organizationId });
  const admins = await db.orm
    .select({ userId: members.userId })
    .from(members)
    .where(scope(members))
    .orderBy(sql`${members.role} = ${Role.OWNER} DESC`, asc(members.createdAt), asc(members.id));
  return [
    payload.previousOwnerUserId,
    payload.newOwnerUserId,
    ...admins.map((m) => m.userId).filter((id) => id !== payload.previousOwnerUserId && id !== payload.newOwnerUserId),
  ];
}

/**
 * Job con: gửi email báo chuyển quyền cho đúng một người (tên BTC, tên của Owner cũ và Owner mới đọc lúc gửi). BTC
 * không còn, hoặc người nhận không còn tài khoản → `skipped`. Gửi lỗi → ném lỗi (chỉ tên lớp: message của lỗi SMTP có
 * thể chứa địa chỉ email, mà job lưu lỗi vào DB) để pg-boss retry riêng job con này.
 */
export async function sendOwnershipTransferredEmail(
  notifier: OwnershipTransferNotifier,
  payload: OwnershipTransferredPayload,
  recipientUserId: string,
): Promise<'sent' | 'skipped'> {
  const { db } = notifier;
  const name = await organizationName(db, payload.organizationId);
  if (name === undefined) return 'skipped';

  const contacts = await userContacts(db.orm, [payload.previousOwnerUserId, payload.newOwnerUserId, recipientUserId]);
  const to = contacts.get(recipientUserId)?.email;
  if (!to) return 'skipped';
  const label = (userId: string) => {
    const contact = contacts.get(userId);
    return contact ? contact.name.trim() || contact.email : 'Không rõ';
  };
  const message = buildOwnershipTransferredEmail({
    organizationName: name,
    previousOwner: label(payload.previousOwnerUserId),
    newOwner: label(payload.newOwnerUserId),
  });
  try {
    await notifier.email.send({ to, ...message });
  } catch (err) {
    throw new Error(`Không gửi được email báo chuyển quyền Owner (${errorName(err)})`);
  }
  return 'sent';
}

/**
 * Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` chờ việc đó trước transaction (lần trước
 * lỗi thì làm lại).
 */
@Injectable()
export class OwnershipTransferQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, OWNERSHIP_TRANSFER_QUEUE, 'khi chuyển quyền Owner');
  }
}

/** Vai `worker`: tạo queue và đăng ký handler: job gốc tạo job con theo người nhận, job con gửi một email. */
@Injectable()
export class OwnershipTransferWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('OwnershipTransferWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const notifier: OwnershipTransferNotifier = { db: this.db, email: this.email };
    await registerQueueWorker(this.boss, OWNERSHIP_TRANSFER_QUEUE, {
      logger: this.logger,
      label: 'Gửi email chuyển quyền',
      logContext: ({ organizationId, recipientUserId }) => ({ organizationId, recipientUserId }),
      handle: async (payload, job) => {
        const { organizationId, recipientUserId } = payload;
        if (recipientUserId === undefined) {
          const recipients = await ownershipTransferRecipients(this.db, payload);
          if (recipients === 'skipped') {
            this.logger.log({ jobId: job.id, organizationId }, 'Bỏ qua email chuyển quyền: BTC không còn');
            return JOB_COMPLETED;
          }
          await fanOut(
            this.boss,
            OWNERSHIP_TRANSFER_QUEUE,
            job.id,
            recipients.map((userId) => ({ key: userId, payload: { ...payload, recipientUserId: userId } })),
          );
          return JOB_COMPLETED;
        }
        if ((await sendOwnershipTransferredEmail(notifier, payload, recipientUserId)) === 'skipped') {
          this.logger.log(
            { jobId: job.id, organizationId, recipientUserId },
            'Bỏ qua email chuyển quyền: BTC hoặc người nhận không còn',
          );
        }
        return JOB_COMPLETED;
      },
    });
  }
}
