import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  BuyerEmailKind,
  EventStatus,
  JobQueue,
  MY_TICKETS_PATH,
  orderPath,
  OrderStatus,
  SendBuyerEmailPayload,
  sharedTicketUrl,
} from '@tickee/contracts';
import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import { EMAIL_TRANSPORT, type EmailMessage, type EmailTransport } from '../../platform/email/index.js';
import {
  BOSS,
  defineQueue,
  derivedJobId,
  errorName,
  JOB_COMPLETED,
  QueueProducer,
  registerQueueWorker,
} from '../../platform/jobs/index.js';
import { ticketEventById } from '../event/index.js';
import { organizerContactOf } from '../organizer/index.js';
import { TicketsService } from '../ticketing/index.js';
import { buildOrphanSoldOutEmail, buildTicketsEmail } from './buyer-email.js';
import { orders } from './schema.js';

/*
 * Hàng đợi email Người mua (Story 3.8, FR-23, AD-12): một queue cho hai loại email, phân biệt bằng `kind` của payload.
 * - `tickets`: email Vé, enqueue trong `markPaid` (`pay`) khi Đơn chuyển `paid`, mọi nguồn.
 * - `orphan_sold_out`: tiền về muộn cho Đơn `expired` mà Hạng vé đã hết, enqueue ở nhánh `sold_out` của IPN.
 * Enqueue bằng chính `tx` của thay đổi (rollback thì không có job). Id job suy cố định từ (`kind`, `orderId`), nên enqueue
 * lặp không tạo job thứ hai khi dòng job cũ còn trong bảng của pg-boss (xem `EnqueueOptions.id`). Handler không ghi bảng
 * nào: idempotent nhờ id job cố định; gửi xong mà worker chết trước khi chốt job thì có thể gửi lặp một lần (chấp nhận).
 * Người mua không bao giờ thấy lỗi email: Vé vẫn hợp lệ.
 */

/**
 * Queue email Người mua. Retry khi gửi lỗi (SMTP chập chờn): 8 lần, chờ 30 giây rồi tăng gấp đôi (tối đa 1 giờ). Hết
 * lượt thì pg-boss chép job sang dead-letter (cảnh báo dead-letter là Story 4.6). Lấy tối đa 10 job mỗi lần, lấy tiếp
 * ngay khi lô đầy; mỗi job được chốt riêng nên một email lỗi không làm hỏng cả lô.
 */
export const BUYER_EMAIL_QUEUE = defineQueue({
  name: JobQueue.ORDERING_SEND_BUYER_EMAIL,
  deadLetter: JobQueue.ORDERING_SEND_BUYER_EMAIL_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: SendBuyerEmailPayload,
});
export const BUYER_EMAIL_QUEUE_OPTIONS = BUYER_EMAIL_QUEUE.queueOptions;

/** Id job cố định của email `kind` cho Đơn `orderId`. */
export const buyerEmailJobId = (kind: BuyerEmailKind, orderId: string): string =>
  derivedJobId(orderId, `${JobQueue.ORDERING_SEND_BUYER_EMAIL}:${kind}`);

/**
 * Enqueue email `kind` cho Đơn `orderId` bằng chính `tx` của người gọi, id job cố định (đã có thì không làm gì). Người
 * gọi đã `BuyerEmailQueues.ready()` (qua `OrderPayments.ready()`) trước transaction.
 */
export async function enqueueBuyerEmail(boss: PgBoss, tx: Tx, kind: BuyerEmailKind, orderId: string): Promise<void> {
  await BUYER_EMAIL_QUEUE.enqueue(boss, tx, { kind, orderId }, { id: buyerEmailJobId(kind, orderId) });
}

export interface BuyerEmailSender {
  db: Database;
  email: EmailTransport;
  tickets: TicketsService;
  /** Origin web: link Vé `{webOrigin}/xem-ve#<token>`, Trang Đơn `{webOrigin}/orders/:code`. */
  webOrigin: string;
}

export type BuyerEmailResult = 'sent' | 'skipped';

/** Đơn của job: chỉ phần email cần. `buyer_email` là bản chụp lúc đặt. */
async function orderOf(db: Database, orderId: string) {
  const [order] = await db.orm
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      buyerEmail: orders.buyerEmail,
      eventId: orders.eventId,
      organizationId: orders.organizationId,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  return order ?? null;
}

/**
 * Dựng email của job `{ kind, orderId }` từ trạng thái lúc gửi; không còn cần gửi → `null`:
 * - `tickets`: Đơn không còn `paid`, Sự kiện đã hủy, đồng hồ DB đã quá `effective_end_at` (retry có thể kéo dài vài giờ:
 *   mọi link chia sẻ trong email đã 404), hoặc Đơn không có Vé.
 * - `orphan_sold_out`: Đơn không còn `review` (BTC đã xử lý mục Cần xử lý).
 * Loại lạ (thêm vào `BuyerEmailKind` mà chưa có nhánh ở đây) → ném lỗi, không bao giờ rơi vào mẫu của loại khác.
 */
async function messageOf(
  sender: BuyerEmailSender,
  { kind, orderId }: SendBuyerEmailPayload,
): Promise<EmailMessage | null> {
  const { db, webOrigin } = sender;
  const order = await orderOf(db, orderId);
  if (!order) return null;
  const event = await ticketEventById(db.orm, order.eventId);
  if (!event) return null;

  switch (kind) {
    case BuyerEmailKind.TICKETS: {
      if (order.status !== OrderStatus.PAID || event.status === EventStatus.CANCELLED || event.ended) return null;
      const tickets = await sender.tickets.ticketsOfOrder(db.orm, order.id);
      if (tickets.length === 0) return null;
      return {
        to: order.buyerEmail,
        ...buildTicketsEmail({
          eventName: event.name,
          startsAt: event.startsAt,
          venue: event.venue,
          orderCode: order.code,
          tickets: tickets.map((t) => ({
            seq: t.seq,
            count: t.count,
            ticketTypeName: t.ticketTypeName,
            link: sharedTicketUrl(webOrigin, t.shareToken),
          })),
          orderLink: `${webOrigin.replace(/\/+$/, '')}${orderPath(order.code)}`,
          myTicketsLink: `${webOrigin.replace(/\/+$/, '')}${MY_TICKETS_PATH}`,
        }),
      };
    }
    case BuyerEmailKind.ORPHAN_SOLD_OUT: {
      if (order.status !== OrderStatus.REVIEW) return null;
      const organizer = await organizerContactOf(db.orm, { organizationId: order.organizationId });
      if (!organizer) return null;
      return {
        to: order.buyerEmail,
        ...buildOrphanSoldOutEmail({ eventName: event.name, orderCode: order.code, organizer }),
      };
    }
    default: {
      const unknown: never = kind;
      throw new Error(`Loại email Người mua chưa hỗ trợ: ${String(unknown)}`);
    }
  }
}

/**
 * Gửi email của job (handler). Không còn cần gửi → `skipped`, job vẫn hoàn tất. Gửi ngoài transaction. Gửi lỗi → ném
 * lỗi để pg-boss retry; lỗi chỉ mang tên lớp (`errorName`: message của lỗi SMTP có thể chứa địa chỉ email, mà job lưu
 * lỗi vào DB).
 */
export async function sendBuyerEmail(sender: BuyerEmailSender, payload: SendBuyerEmailPayload): Promise<BuyerEmailResult> {
  const message = await messageOf(sender, payload);
  if (!message) return 'skipped';
  try {
    await sender.email.send(message);
  } catch (err) {
    throw new Error(`Không gửi được email Người mua (${errorName(err)})`);
  }
  return 'sent';
}

/**
 * Mọi vai: start pg-boss (vai api chế độ producer) và tạo queue lúc khởi động; `ready()` chờ việc đó trước transaction
 * có thể enqueue (lần trước lỗi thì làm lại). Không đăng ký handler.
 */
@Injectable()
export class BuyerEmailQueues extends QueueProducer {
  constructor(@Inject(BOSS) boss: PgBoss) {
    super(boss, BUYER_EMAIL_QUEUE, 'khi Đơn chuyển paid hoặc tiền về muộn');
  }
}

export const ORDERING_JOBS_CONFIG = Symbol('ORDERING_JOBS_CONFIG');

/** Cấu hình job nền của `ordering` ở vai worker: origin web cho link trong email. */
export interface OrderingJobsConfig {
  WEB_ORIGIN: string;
}

/** Vai `worker`: tạo queue và đăng ký handler gửi email Người mua. */
@Injectable()
export class BuyerEmailWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('BuyerEmailWorker');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BOSS) private readonly boss: PgBoss,
    @Inject(EMAIL_TRANSPORT) private readonly email: EmailTransport,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(ORDERING_JOBS_CONFIG) private readonly config: OrderingJobsConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const sender: BuyerEmailSender = {
      db: this.db,
      email: this.email,
      tickets: this.tickets,
      webOrigin: this.config.WEB_ORIGIN,
    };
    await registerQueueWorker(this.boss, BUYER_EMAIL_QUEUE, {
      logger: this.logger,
      label: 'Gửi email Người mua',
      logContext: ({ kind, orderId }) => ({ kind, orderId }),
      handle: async (payload, job) => {
        const result = await sendBuyerEmail(sender, payload);
        // Chỉ loại và id (không email): lần theo khi có người báo "không nhận được email".
        this.logger.log({ jobId: job.id, kind: payload.kind, orderId: payload.orderId, result }, 'Xử lý job email Người mua');
        return JOB_COMPLETED;
      },
    });
  }
}
