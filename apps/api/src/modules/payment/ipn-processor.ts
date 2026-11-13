import { Inject, Injectable, Logger } from '@nestjs/common';
import { ORDER_CODE_PATTERN, OrderStatus, ReviewItemType, type ReviewItemReason } from '@tickee/contracts';
import { z } from 'zod';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import {
  markExpired,
  OrderPayments,
  orderForPayment,
  type GatewaySource,
  type MarkPaidOutcome,
  type MarkPaidResult,
  type OrderForPayment,
} from '../ordering/index.js';
import { paymentEvents, reviewItems, type PaymentEventKind } from './schema.js';

/*
 * Lõi xử lý IPN Tingee (Story 3.5, 3.6, AD-7), tách khỏi controller để Đối soát bù (Story 4.1, vai worker) đi cùng
 * đường: cùng whitelist, cùng khóa `payment_events`, cùng thứ tự kiểm, cùng cách tạo mục Cần xử lý. Đầu vào là BTC đã
 * xác định (IPN: BTC sở hữu `ipnKey`, đã qua chữ ký; Đối soát bù: BTC của Đơn được tra), payload đã kiểm bằng
 * `TingeeIpn` và nguồn (`ipn` | `reconciliation`, ghi vào `orders.paid_source`). Không gọi Tingee.
 */

/** `status` của IPN khi tiền về. */
export const IPN_SUCCESS_STATUS = 'success';

/** Trạng thái đơn Gateway làm Đơn `pending` hết hạn (AD-4 (b)): link không còn trả được. */
export const IPN_EXPIRING_STATUSES: ReadonlySet<string> = new Set(['expired', 'canceled']);

/** Chuỗi tùy chọn: thiếu, `null` hay rỗng đều lưu `null`. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const optionalAmount = z
  .int()
  .min(0)
  .nullish()
  .transform((v) => v ?? null);

/** `paidAt`: ISO 8601 có múi giờ (Tingee gửi dạng `…Z`); rỗng → `null`. */
const isoInstant = z
  .union([z.literal(''), z.iso.datetime({ offset: true })])
  .nullish()
  .transform((v) => (v ? new Date(v) : null));

/** `merchantId` là số (tài liệu Tingee); nhận cả chuỗi, lưu dạng chuỗi. */
const merchantId = z
  .union([z.int(), z.string().max(100)])
  .nullish()
  .transform((v) => (v === null || v === undefined || v === '' ? null : String(v)));

const PROVIDER_TRANSACTION_CODE = optionalText(200);

/**
 * Body IPN của Cổng thanh toán Tingee, chỉ các trường trong whitelist (`description`, `orderInfo`, `customerEmail` và
 * trường lạ bị bỏ). Kiểm chặt (sai → 400 để Tingee gửi lại): `orderId`, `status`, và khi `status = 'success'` thì
 * `providerTransactionCode` (khóa chống lặp) + `paidAmount` (số tiền so với Đơn). Trường phụ (`paidAt`, `requestId`,
 * `billId`, `statusCode`, `paymentMethod`, `merchantId`, `amount`, và `providerTransactionCode`/`paidAmount` của IPN
 * trạng thái) sai định dạng → `null` thay vì từ chối cả gói: định dạng thật của Tingee từng khác tài liệu (Story 3.4),
 * và một trường phụ lạ không được làm Người mua đã trả tiền mà không có Vé. `paidAt` cần ISO 8601 có múi giờ (Tingee gửi
 * dạng `…Z`); thiếu múi giờ thì không đoán, coi như không báo (`paid_at` lấy đồng hồ DB).
 */
export const TingeeIpn = z
  .object({
    requestId: optionalText(200).catch(null),
    orderId: z.string().min(1).max(200),
    amount: optionalAmount.catch(null),
    paidAmount: z.unknown(),
    status: z.string().min(1).max(50),
    statusCode: optionalText(50).catch(null),
    billId: optionalText(200).catch(null),
    paymentMethod: optionalText(50).catch(null),
    providerTransactionCode: z.unknown(),
    paidAt: isoInstant.catch(null),
    merchantId: merchantId.catch(null),
  })
  .transform((ipn, ctx) => {
    const transactionCode = PROVIDER_TRANSACTION_CODE.safeParse(ipn.providerTransactionCode);
    const paidAmount = optionalAmount.safeParse(ipn.paidAmount);
    const providerTransactionCode = transactionCode.success ? transactionCode.data : null;
    const paid = paidAmount.success ? paidAmount.data : null;
    if (ipn.status === IPN_SUCCESS_STATUS && (providerTransactionCode === null || paid === null)) {
      const message = 'thiếu hoặc sai định dạng khi status = success';
      if (providerTransactionCode === null) ctx.addIssue({ code: 'custom', path: ['providerTransactionCode'], message });
      if (paid === null) ctx.addIssue({ code: 'custom', path: ['paidAmount'], message });
      return z.NEVER;
    }
    return { ...ipn, providerTransactionCode, paidAmount: paid };
  });
export type TingeeIpn = z.output<typeof TingeeIpn>;

/**
 * Nhánh xử lý một IPN (log, và chọn mục Cần xử lý):
 * - chung: `duplicate` — trùng khóa `payment_events` (IPN lặp), không làm gì;
 * - `payment`, theo thứ tự kiểm của AD-7: `invalid_order_code` (bước 1, mã sai `ORDER_CODE_PATTERN`: chỉ lưu) ·
 *   `order_not_found` (bước 1) · `other_organization` (bước 2, Đơn thuộc BTC khác) · kết quả `markPaid` (bước 3–7:
 *   `paid`, `event_cancelled`, `duplicate_payment`, `mismatch`, `orphan`; nguồn `reconciliation` thêm `already_settled`:
 *   Đơn đã rời `pending`/`expired`, khoản tiền này đã được ghi nhận, không mục);
 * - `status`: `expired` (Đơn `pending` của chính BTC vừa hết hạn) · `stored` (chỉ lưu) · `unknown_status` (trạng thái
 *   lạ, chỉ lưu).
 */
export type IpnBranch =
  | 'duplicate'
  | 'invalid_order_code'
  | 'order_not_found'
  | 'other_organization'
  | Exclude<MarkPaidOutcome, 'lost_race'>
  | 'expired'
  | 'stored'
  | 'unknown_status';

/** Mục Cần xử lý vừa tạo cho khoản tiền của IPN (Story 3.6). */
export interface IpnReviewItem {
  id: string;
  type: ReviewItemType;
  /** Chỉ loại `orphan`. */
  reason: ReviewItemReason | null;
}

export interface IpnOutcome {
  /** Dòng `payment_events` vừa lưu; `null` khi IPN lặp. */
  paymentEventId: string | null;
  kind: PaymentEventKind;
  branch: IpnBranch;
  /** Mục Cần xử lý tạo trong cùng transaction; `null` khi IPN phát Vé, chỉ lưu, hay lặp. */
  reviewItem: IpnReviewItem | null;
}

/** Mục cần tạo cho một khoản tiền: loại, lý do (`orphan`), Đơn gắn kèm (`null` với `unmatched`). */
interface ReviewItemDraft {
  type: ReviewItemType;
  reason: ReviewItemReason | null;
  orderId: string | null;
}

/** Kết quả của bước kiểm IPN `success`: nhánh và mục cần tạo (nếu có). */
interface Settlement {
  branch: IpnBranch;
  item: ReviewItemDraft | null;
}

/** Nhánh không khớp Đơn nào của BTC (bước 1 có mã mà không có Đơn, bước 2): cảnh báo vận hành (`alert`). */
const UNMATCHED_BRANCHES: ReadonlySet<IpnBranch> = new Set<IpnBranch>(['order_not_found', 'other_organization']);

/** Marker log của cảnh báo vận hành cho tiền về không khớp Đơn (Story 4.6 nối kênh cảnh báo theo marker này). */
export const PAYMENT_UNMATCHED_ALERT = 'payment_unmatched';

/** Kết quả `markPaid` (bước 3–7) của nguồn `source` → nhánh và mục Cần xử lý của Đơn `orderId`. */
function settlementOf(result: MarkPaidResult, orderId: string, source: GatewaySource): Settlement {
  const item = (type: ReviewItemType, reason: ReviewItemReason | null = null): ReviewItemDraft => ({
    type,
    reason,
    orderId,
  });
  switch (result.outcome) {
    case 'paid':
      return { branch: 'paid', item: null };
    case 'already_settled':
      return { branch: 'already_settled', item: null };
    case 'event_cancelled':
      return { branch: 'event_cancelled', item: item(ReviewItemType.EVENT_CANCELLED) };
    case 'duplicate_payment':
      return { branch: 'duplicate_payment', item: item(ReviewItemType.DUPLICATE_PAYMENT) };
    case 'mismatch':
      return { branch: 'mismatch', item: item(ReviewItemType.AMOUNT_MISMATCH) };
    case 'orphan':
      return { branch: 'orphan', item: item(ReviewItemType.ORPHAN, result.reason) };
    case 'lost_race':
      // Nguồn qua Cổng thanh toán khóa Đơn trước khi kiểm nên không thể thua đua; ném để rollback (Tingee gửi lại, job
      // tra retry) thay vì im lặng.
      throw new Error(`markPaid nguồn ${source} trả lost_race`);
  }
}

@Injectable()
export class IpnProcessor {
  private readonly logger = new Logger('IpnProcessor');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OrderPayments) private readonly payments: OrderPayments,
  ) {}

  /**
   * Một transaction cho một IPN hợp lệ (hoặc một kết quả tra của Đối soát bù, `source = 'reconciliation'`) của BTC
   * `organizationId`: `INSERT … ON CONFLICT DO NOTHING` vào `payment_events` (trùng khóa → `duplicate`, không làm gì
   * thêm; IPN và kết quả tra cùng `providerTransactionCode` là một khoản tiền), rồi theo `status`:
   * - `success`: thứ tự kiểm của AD-7 (`settlePayment`); khoản tiền không thành Vé (trừ mã sai định dạng, và
   *   `already_settled` của Đối soát bù: Đơn đã chốt, event lưu gắn Đơn, không mục, log warn) → đúng một `review_items`
   *   của BTC `organizationId`, gắn event vừa lưu.
   * - `expired`/`canceled` cho Đơn `pending` của chính BTC → `markExpired`; còn lại chỉ lưu.
   * - trạng thái lạ → chỉ lưu.
   * Lỗi DB (kể cả phát Vé, enqueue email, tạo mục) → ném, cả `tx` rollback (không lưu event, Đơn và tồn kho không đổi):
   * Tingee gửi lại (IPN) hoặc job tra retry (Đối soát bù).
   */
  async process(organizationId: string, ipn: TingeeIpn, source: GatewaySource = 'ipn'): Promise<IpnOutcome> {
    const kind: PaymentEventKind = ipn.status === IPN_SUCCESS_STATUS ? 'payment' : 'status';
    const validCode = ORDER_CODE_PATTERN.test(ipn.orderId);
    // `markPaid` enqueue email Người mua trong `tx`: pg-boss đã start và queue đã có, trước transaction (lỗi → 5xx,
    // Tingee gửi lại).
    if (kind === 'payment' && validCode) await this.payments.ready();
    const outcome = await this.db.transaction(async (tx): Promise<IpnOutcome> => {
      const order = validCode ? await orderForPayment(tx, ipn.orderId) : null;
      const own = order && order.organizationId === organizationId ? order : null;
      const [saved] = await tx
        .insert(paymentEvents)
        .values({
          organizationId,
          orderId: own?.id ?? null,
          kind,
          status: ipn.status,
          providerOrderId: ipn.orderId,
          providerTransactionCode: ipn.providerTransactionCode,
          amount: ipn.amount,
          paidAmount: ipn.paidAmount,
          paidAt: ipn.paidAt,
          statusCode: ipn.statusCode,
          paymentMethod: ipn.paymentMethod,
          billId: ipn.billId,
          merchantId: ipn.merchantId,
          requestId: ipn.requestId,
        })
        .onConflictDoNothing()
        .returning({ id: paymentEvents.id });
      if (!saved) return { paymentEventId: null, kind, branch: 'duplicate', reviewItem: null };
      if (kind === 'status') {
        return { paymentEventId: saved.id, kind, branch: await this.applyStatus(tx, ipn, own), reviewItem: null };
      }
      const { branch, item } = await this.settlePayment(tx, ipn, source, validCode, order, own);
      const reviewItem = item ? await this.openReviewItem(tx, organizationId, saved.id, item) : null;
      return { paymentEventId: saved.id, kind, branch, reviewItem };
    });

    const context = {
      organizationId,
      source,
      paymentEventId: outcome.paymentEventId,
      // Mã khác định dạng Tickee là dữ liệu của BTC (dùng Tingee cho việc khác): không log.
      orderCode: validCode ? ipn.orderId : undefined,
      kind,
      status: ipn.status,
      branch: outcome.branch,
      reviewItemId: outcome.reviewItem?.id,
      reviewItemType: outcome.reviewItem?.type,
      reviewItemReason: outcome.reviewItem?.reason ?? undefined,
    };
    const what = source === 'ipn' ? 'IPN Tingee' : 'Kết quả Đối soát bù';
    if (UNMATCHED_BRANCHES.has(outcome.branch)) {
      // Cảnh báo vận hành cho tới khi Story 4.6 nối kênh: tiền đã về tài khoản BTC mà không khớp Đơn nào của BTC.
      this.logger.error(
        { ...context, alert: PAYMENT_UNMATCHED_ALERT },
        `${what}: tiền về không khớp Đơn nào của BTC; đã tạo mục Cần xử lý`,
      );
    } else if (outcome.reviewItem) {
      this.logger.warn(context, `${what} không phát Vé; đã tạo mục Cần xử lý`);
    } else if (outcome.branch === 'unknown_status') {
      this.logger.warn(context, `${what} có trạng thái lạ; chỉ lưu sự kiện thanh toán`);
    } else if (outcome.branch === 'already_settled') {
      // Kết quả tra cho Đơn đã chốt (có thể khác mã giao dịch hay số tiền): tín hiệu duy nhất để trả lời câu hỏi mở với
      // Tingee về mã giao dịch của API tra, nên warn.
      this.logger.warn(context, `${what} cho Đơn đã chốt: đã lưu sự kiện thanh toán, không tạo mục Cần xử lý`);
    } else {
      this.logger.log(context, `Đã xử lý ${what}`);
    }
    return outcome;
  }

  /**
   * IPN `success`: thứ tự kiểm cố định của AD-7, dừng ở nhánh đầu khớp. Bước 1–2 ở đây (dữ liệu không đổi của Đơn, đọc
   * không khóa): mã sai định dạng → chỉ lưu; mã không có Đơn, hoặc Đơn thuộc BTC khác → `unmatched` (không gắn Đơn,
   * không đổi Đơn của BTC kia). Bước 3–7 trong `markPaid` nguồn `source`, dưới khóa Sự kiện và khóa Đơn.
   */
  private async settlePayment(
    tx: Tx,
    ipn: TingeeIpn,
    source: GatewaySource,
    validCode: boolean,
    order: OrderForPayment | null,
    own: OrderForPayment | null,
  ): Promise<Settlement> {
    if (!validCode) return { branch: 'invalid_order_code', item: null };
    const unmatched: ReviewItemDraft = { type: ReviewItemType.UNMATCHED, reason: null, orderId: null };
    if (!order) return { branch: 'order_not_found', item: unmatched };
    if (!own) return { branch: 'other_organization', item: unmatched };
    if (ipn.paidAmount === null) throw new Error('IPN success thiếu paidAmount (schema phải chặn)');
    const result = await this.payments.markPaid(tx, own.id, source, ipn.paidAmount, { paidAt: ipn.paidAt });
    return settlementOf(result, own.id, source);
  }

  /** Tạo mục Cần xử lý `open` của BTC `organizationId` cho khoản tiền `paymentEventId`, trong `tx`. */
  private async openReviewItem(
    tx: Tx,
    organizationId: string,
    paymentEventId: string,
    item: ReviewItemDraft,
  ): Promise<IpnReviewItem> {
    const [row] = await tx
      .insert(reviewItems)
      .values({ organizationId, orderId: item.orderId, paymentEventId, type: item.type, reason: item.reason })
      .returning({ id: reviewItems.id });
    if (!row) throw new Error('INSERT review_items không trả về dòng nào');
    return { id: row.id, type: item.type, reason: item.reason };
  }

  /** IPN trạng thái: chỉ `expired`/`canceled` cho Đơn `pending` của chính BTC mới đổi Đơn. */
  private async applyStatus(tx: Tx, ipn: TingeeIpn, own: OrderForPayment | null): Promise<IpnBranch> {
    if (!IPN_EXPIRING_STATUSES.has(ipn.status)) return 'unknown_status';
    if (!own || own.status !== OrderStatus.PENDING) return 'stored';
    return (await markExpired(tx, own.id)) === 'expired' ? 'expired' : 'stored';
  }
}
