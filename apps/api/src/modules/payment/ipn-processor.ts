import { Inject, Injectable, Logger } from '@nestjs/common';
import { ORDER_CODE_PATTERN, OrderStatus } from '@tickee/contracts';
import { z } from 'zod';
import { DATABASE, type Database, type Tx } from '../../platform/db/index.js';
import {
  markExpired,
  OrderPayments,
  orderForPayment,
  type MarkPaidResult,
  type OrderForPayment,
} from '../ordering/index.js';
import { paymentEvents, type PaymentEventKind } from './schema.js';

/*
 * Lõi xử lý IPN Tingee (Story 3.5, AD-7), tách khỏi controller để Đối soát bù (Story 4.1, vai worker) đi cùng đường:
 * cùng whitelist, cùng khóa `payment_events`, cùng thứ tự kiểm. Đầu vào là BTC đã xác định (IPN: BTC sở hữu `ipnKey`, đã
 * qua chữ ký) và payload đã kiểm bằng `TingeeIpn`. Không gọi Tingee.
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
 * Nhánh xử lý một IPN (log, và Story 3.6 tạo `review_item` theo nhánh):
 * - chung: `duplicate` — trùng khóa `payment_events` (IPN lặp), không làm gì;
 * - `payment`, theo thứ tự kiểm: `invalid_order_code` (mã sai `ORDER_CODE_PATTERN`) · `order_not_found` ·
 *   `other_organization` (Đơn thuộc BTC khác) · `order_not_pending` · kết quả `markPaid` (`paid`, `event_cancelled`,
 *   `mismatch`, `orphan`, `lost_race`);
 * - `status`: `expired` (Đơn `pending` của chính BTC vừa hết hạn) · `stored` (chỉ lưu) · `unknown_status` (trạng thái
 *   lạ, chỉ lưu).
 */
export type IpnBranch =
  | 'duplicate'
  | 'invalid_order_code'
  | 'order_not_found'
  | 'other_organization'
  | 'order_not_pending'
  | MarkPaidResult
  | 'expired'
  | 'stored'
  | 'unknown_status';

export interface IpnOutcome {
  /** Dòng `payment_events` vừa lưu; `null` khi IPN lặp. */
  paymentEventId: string | null;
  kind: PaymentEventKind;
  branch: IpnBranch;
}

/** Nhánh chỉ lưu mà BTC/vận hành cần biết (Story 3.6 thêm `review_item`): log warn. */
const WARN_BRANCHES: ReadonlySet<IpnBranch> = new Set<IpnBranch>([
  'invalid_order_code',
  'order_not_found',
  'other_organization',
  'order_not_pending',
  'event_cancelled',
  'mismatch',
  'orphan',
  'lost_race',
  'unknown_status',
]);

@Injectable()
export class IpnProcessor {
  private readonly logger = new Logger('IpnProcessor');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OrderPayments) private readonly payments: OrderPayments,
  ) {}

  /**
   * Một transaction cho một IPN hợp lệ của BTC `organizationId`: `INSERT … ON CONFLICT DO NOTHING` vào `payment_events`
   * (trùng khóa → `duplicate`, không làm gì thêm), rồi theo `status`:
   * - `success`: mã sai dạng / không có Đơn / Đơn thuộc BTC khác / Đơn không `pending` → chỉ lưu; Đơn `pending` →
   *   `markPaid(tx, …, 'ipn', paidAmount, { paidAt })` (Đơn `paid` + Vé, hoặc `event_cancelled`/`mismatch`/`orphan`/
   *   `lost_race` không đổi gì).
   * - `expired`/`canceled` cho Đơn `pending` của chính BTC → `markExpired`; còn lại chỉ lưu.
   * - trạng thái lạ → chỉ lưu.
   * Lỗi DB (kể cả phát Vé) → ném, cả `tx` rollback (không lưu event): Tingee gửi lại.
   */
  async process(organizationId: string, ipn: TingeeIpn): Promise<IpnOutcome> {
    const kind: PaymentEventKind = ipn.status === IPN_SUCCESS_STATUS ? 'payment' : 'status';
    const validCode = ORDER_CODE_PATTERN.test(ipn.orderId);
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
      if (!saved) return { paymentEventId: null, kind, branch: 'duplicate' };
      const branch =
        kind === 'payment' ? await this.settlePayment(tx, ipn, validCode, order, own) : await this.applyStatus(tx, ipn, own);
      return { paymentEventId: saved.id, kind, branch };
    });

    const context = {
      organizationId,
      paymentEventId: outcome.paymentEventId,
      // Mã khác định dạng Tickee là dữ liệu của BTC (dùng Tingee cho việc khác): không log.
      orderCode: validCode ? ipn.orderId : undefined,
      kind,
      status: ipn.status,
      branch: outcome.branch,
    };
    if (WARN_BRANCHES.has(outcome.branch)) this.logger.warn(context, 'IPN Tingee không phát Vé; chỉ lưu sự kiện thanh toán');
    else this.logger.log(context, 'Đã xử lý IPN Tingee');
    return outcome;
  }

  /** IPN `success`: thứ tự kiểm cố định (AD-7), dừng ở nhánh đầu khớp. */
  private async settlePayment(
    tx: Tx,
    ipn: TingeeIpn,
    validCode: boolean,
    order: OrderForPayment | null,
    own: OrderForPayment | null,
  ): Promise<IpnBranch> {
    if (!validCode) return 'invalid_order_code';
    if (!order) return 'order_not_found';
    if (!own) return 'other_organization';
    if (own.status !== OrderStatus.PENDING) return 'order_not_pending';
    if (ipn.paidAmount === null) throw new Error('IPN success thiếu paidAmount (schema phải chặn)');
    return this.payments.markPaid(tx, own.id, 'ipn', ipn.paidAmount, { paidAt: ipn.paidAt });
  }

  /** IPN trạng thái: chỉ `expired`/`canceled` cho Đơn `pending` của chính BTC mới đổi Đơn. */
  private async applyStatus(tx: Tx, ipn: TingeeIpn, own: OrderForPayment | null): Promise<IpnBranch> {
    if (!IPN_EXPIRING_STATUSES.has(ipn.status)) return 'unknown_status';
    if (!own || own.status !== OrderStatus.PENDING) return 'stored';
    return (await markExpired(tx, own.id)) === 'expired' ? 'expired' : 'stored';
  }
}
