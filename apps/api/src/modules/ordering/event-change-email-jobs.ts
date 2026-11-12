import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { JobQueue, MY_TICKETS_PATH, OrderStatus, SendEventChangeEmailPayload } from '@tickee/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { DATABASE, type Database, type DbExecutor, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailTransport } from '../../platform/email/index.js';
import {
  BOSS,
  defineQueue,
  derivedJobId,
  errorName,
  fanOut,
  JOB_COMPLETED,
  QueueProducer,
  registerQueueWorker,
} from '../../platform/jobs/index.js';
import { eventOpenForTickets, ticketEventById } from '../event/index.js';
import { organizerContactOf } from '../organizer/index.js';
import { ORDERING_JOBS_CONFIG, type OrderingJobsConfig } from './buyer-email-jobs.js';
import { buildEventChangeEmail } from './buyer-email.js';
import { orders } from './schema.js';

/*
 * Email báo Người mua khi Sự kiện đổi giờ hoặc địa điểm (Story 3.10, FR-7, AD-12). "Người mua" = một `user_id` có Đơn
 * `paid` của Sự kiện (tính cả Đơn 0đ); mỗi người một email dù có nhiều Đơn, gửi tới `buyer_email` của Đơn `paid` mới nhất
 * của người đó.
 *
 * Lệnh sửa Sự kiện (`flows/event-update.flow.ts`) enqueue một job gốc `{ eventId, version }` bằng chính `tx` của thay
 * đổi (rollback thì không có job), id cố định theo (`eventId`, `version` = `events.time_venue_version` sau lệnh sửa):
 * mỗi lần sửa có đổi giờ/địa điểm là đúng một lượt, sửa hai lần là hai lượt (không hợp nhất). Worker chạy job gốc: chốt
 * danh sách Người mua lúc xử lý rồi tạo mỗi người một job con `{ eventId, version, userId }` trong cùng queue (`fanOut`,
 * id con suy từ id job gốc và `userId`, nên job gốc chạy lại không tạo thêm con). Job con gửi đúng một email với giờ và
 * địa điểm *hiện tại* của Sự kiện; SMTP lỗi thì chỉ job con đó retry. Payload và log chỉ có id.
 */

/**
 * Queue email đổi giờ/địa điểm. Retry khi gửi lỗi (SMTP chập chờn): 8 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ),
 * hết lượt thì pg-boss chép job sang dead-letter (như email Vé). Lô tối đa 10 job, lấy tiếp ngay khi lô đầy; mỗi job được
 * chốt riêng.
 */
export const EVENT_CHANGE_EMAIL_QUEUE = defineQueue({
  name: JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL,
  deadLetter: JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: SendEventChangeEmailPayload,
});
export const EVENT_CHANGE_EMAIL_QUEUE_OPTIONS = EVENT_CHANGE_EMAIL_QUEUE.queueOptions;

/** Id job gốc cố định của lượt email phiên bản `version` của Sự kiện `eventId`. */
export const eventChangeEmailJobId = (eventId: string, version: number): string =>
  derivedJobId(eventId, `${JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL}:v${version}`);

/** Đơn `paid` của Sự kiện (mọi truy vấn Người mua dùng chung điều kiện này). */
const paidOrdersOf = (eventId: string) => and(eq(orders.eventId, eventId), eq(orders.status, OrderStatus.PAID));

/**
 * Số Người mua của Sự kiện: số `user_id` khác nhau có Đơn `paid` (tính cả Đơn 0đ). `GET …/buyer-count` và lệnh sửa
 * (trong `tx`, sau khi khóa dòng Sự kiện `FOR UPDATE`: `markPaid` khóa `FOR SHARE` nên không có Đơn nào vừa `paid` chen
 * giữa) dùng chung.
 */
export async function paidBuyerCount(db: DbExecutor, eventId: string): Promise<number> {
  const [row] = await db
    .select({ buyers: sql<number>`count(DISTINCT ${orders.userId})::int` })
    .from(orders)
    .where(paidOrdersOf(eventId));
  return row?.buyers ?? 0;
}

/**
 * Enqueue job gốc của lượt email `{ eventId, version }` bằng chính `tx` của lệnh sửa, id cố định (`eventChangeEmailJobId`;
 * đã có thì không làm gì). Người gọi đã `EventChangeEmailQueues.ready()` trước transaction.
 */
export async function enqueueEventChangeEmail(
  boss: PgBoss,
  tx: Tx,
  { eventId, version }: { eventId: string; version: number },
): Promise<void> {
  await EVENT_CHANGE_EMAIL_QUEUE.enqueue(boss, tx, { eventId, version }, { id: eventChangeEmailJobId(eventId, version) });
}

/**
 * Job gốc: Người mua của Sự kiện lúc xử lý (id tăng dần). Sự kiện không còn, đã hủy hoặc đã kết thúc → `skipped` (không
 * tạo job con nào).
 */
export async function eventChangeRecipients(db: Database, eventId: string): Promise<string[] | 'skipped'> {
  // Sự kiện còn cần báo lúc xử lý = còn dùng được cho Vé (còn tồn tại, chưa hủy, chưa quá `effective_end_at`).
  if (!eventOpenForTickets(await ticketEventById(db.orm, eventId))) return 'skipped';
  const rows = await db.orm
    .selectDistinct({ userId: orders.userId })
    .from(orders)
    .where(paidOrdersOf(eventId))
    .orderBy(asc(orders.userId));
  return rows.map((r) => r.userId);
}

/**
 * Xử lý job gốc `rootJobId`: tạo mỗi Người mua lúc xử lý một job con `{ eventId, version, userId }` trong cùng queue
 * (`fanOut`: id con suy từ `rootJobId` và `userId`, nên chạy lại không tạo thêm con). Trả số Người mua, hoặc `skipped` khi
 * Sự kiện không còn, đã hủy hoặc đã kết thúc. Lỗi DB → ném (job gốc retry).
 */
export async function fanOutEventChangeEmail(
  db: Database,
  boss: PgBoss,
  rootJobId: string,
  { eventId, version }: SendEventChangeEmailPayload,
): Promise<number | 'skipped'> {
  const recipients = await eventChangeRecipients(db, eventId);
  if (recipients === 'skipped') return 'skipped';
  await fanOut(
    boss,
    EVENT_CHANGE_EMAIL_QUEUE,
    rootJobId,
    recipients.map((userId) => ({ key: userId, payload: { eventId, version, userId } })),
  );
  return recipients.length;
}

export interface EventChangeEmailSender {
  db: Database;
  email: EmailTransport;
  /** Origin web: link "Vé của tôi" `{webOrigin}/tickets`. */
  webOrigin: string;
}

/**
 * Job con: gửi email cho đúng một Người mua, với tên, giờ và địa điểm hiện tại của Sự kiện và kênh liên hệ BTC. Bỏ qua
 * (`skipped`, job vẫn hoàn tất) khi lúc gửi Sự kiện không còn, đã hủy hoặc đã quá `effective_end_at` (đồng hồ DB), hoặc
 * người đó không còn Đơn `paid` của Sự kiện. Gửi tới `buyer_email` của Đơn `paid` mới nhất (theo `paid_at`). Gửi lỗi → ném
 * lỗi chỉ mang tên lớp (message của lỗi SMTP có thể chứa địa chỉ email, mà job lưu lỗi vào DB) để pg-boss retry riêng job
 * con này.
 */
export async function sendEventChangeEmail(
  sender: EventChangeEmailSender,
  { eventId }: SendEventChangeEmailPayload,
  userId: string,
): Promise<'sent' | 'skipped'> {
  const { db } = sender;
  const event = await ticketEventById(db.orm, eventId);
  if (!eventOpenForTickets(event)) return 'skipped';
  const [order] = await db.orm
    .select({ buyerEmail: orders.buyerEmail, organizationId: orders.organizationId })
    .from(orders)
    .where(and(paidOrdersOf(eventId), eq(orders.userId, userId)))
    .orderBy(desc(orders.paidAt), desc(orders.createdAt), desc(orders.id))
    .limit(1);
  if (!order) return 'skipped';
  const organizer = await organizerContactOf(db.orm, { organizationId: order.organizationId });
  if (!organizer) return 'skipped';
  const message = buildEventChangeEmail({
    eventName: event.name,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    venue: event.venue,
    myTicketsLink: `${sender.webOrigin.replace(/\/+$/, '')}${MY_TICKETS_PATH}`,
    organizer,
  });
  try {
    await sender.email.send({ to: order.buyerEmail, ...message });
  } catch (err) {
    throw new Error(`Không gửi được email đổi giờ/địa điểm (${errorName(err)})`);
  }
  return 'sent';
}

/**
 * Vai `api`: start pg-boss (producer) và tạo queue lúc khởi động; `ready()` chờ việc đó trước transaction của lệnh sửa
 * Sự kiện (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class EventChangeEmailQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, EVENT_CHANGE_EMAIL_QUEUE, 'khi sửa giờ hoặc địa điểm Sự kiện');
  }
}

/** Vai `worker`: tạo queue và đăng ký handler: job gốc tạo job con theo Người mua, job con gửi một email. */
@Injectable()
export class EventChangeEmailWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('EventChangeEmailWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(ORDERING_JOBS_CONFIG) private readonly config: OrderingJobsConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const sender: EventChangeEmailSender = { db: this.db, email: this.email, webOrigin: this.config.WEB_ORIGIN };
    await registerQueueWorker(this.boss, EVENT_CHANGE_EMAIL_QUEUE, {
      logger: this.logger,
      label: 'Gửi email đổi giờ/địa điểm',
      logContext: ({ eventId, version, userId }) => ({ eventId, version, userId }),
      handle: async (payload, job) => {
        const { eventId, version, userId } = payload;
        // Chỉ id trong log (không email, không tên).
        if (userId === undefined) {
          const buyers = await fanOutEventChangeEmail(this.db, this.boss, job.id, payload);
          this.logger.log({ jobId: job.id, eventId, version, buyers }, 'Xử lý job gốc email đổi giờ/địa điểm');
          return JOB_COMPLETED;
        }
        const result = await sendEventChangeEmail(sender, payload, userId);
        this.logger.log({ jobId: job.id, eventId, version, userId, result }, 'Xử lý job email đổi giờ/địa điểm');
        return JOB_COMPLETED;
      },
    });
  }
}
