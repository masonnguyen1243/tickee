import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, gt, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  OPS_ALERT_SYSTEM_SUBJECT,
  OpsAlertKind,
  OpsAlertRules,
  type OpsAlertRule,
  type OpsAlertScanContext,
} from '../../platform/alerts/index.js';
import type { WorkerConfig } from '../../platform/config/index.js';
import type { Database } from '../../platform/db/index.js';
import { orders } from './schema.js';

/*
 * Luật cảnh báo `ticket_issuance_drop` (Story 4.6-e, NFR-10), chỉ vai worker: `ordering` đăng ký vào registry của job quét
 * `platform.ops-alert-scan` (mỗi phút). So tỉ lệ Đơn có link thanh toán được trả tiền (`paid_source` khác `NULL`: IPN,
 * Đối soát bù, duyệt tay) trong khung (mốc − 75 phút, mốc − 15 phút] theo `payment_link_attempt_at` với cùng khung 7 ngày
 * trước. Mốc là đồng hồ DB. Khung kết thúc 15 phút trước mốc vì link hết hạn sau 15 phút (`expires_at` =
 * `payment_link_attempt_at` + 15 phút): Đơn trong khung đã hết thời gian trả tiền. Đơn 0đ và Đơn chưa từng có lượt tạo
 * link (`payment_link_attempt_at` `NULL`) không tính. Chỉ đọc, hai khoảng theo index `orders_payment_link_attempt_at_idx`.
 */

/** Khung xét: Đơn có `payment_link_attempt_at` trong (mốc − 75 phút, mốc − 15 phút]. */
export const ISSUANCE_WINDOW_FROM_MINUTES = 75;
export const ISSUANCE_WINDOW_TO_MINUTES = 15;

/** Khung nền: cùng khung, lùi chừng này ngày. */
export const ISSUANCE_BASELINE_DAYS = 7;

/** Cấu hình của luật `ticket_issuance_drop` (vai worker). */
export type IssuanceDropConfig = Pick<WorkerConfig, 'OPS_ALERT_ISSUANCE_MIN_ORDERS' | 'OPS_ALERT_ISSUANCE_RATIO'>;

export interface IssuanceDropSettings {
  /** `OPS_ALERT_ISSUANCE_MIN_ORDERS`: khung xét phải có từ chừng này Đơn. */
  minOrders: number;
  /** `OPS_ALERT_ISSUANCE_RATIO`: báo khi tỉ lệ dưới chừng này lần tỉ lệ của khung nền. */
  ratio: number;
}

export const issuanceDropSettings = (config: IssuanceDropConfig): IssuanceDropSettings => ({
  minOrders: config.OPS_ALERT_ISSUANCE_MIN_ORDERS,
  ratio: config.OPS_ALERT_ISSUANCE_RATIO,
});

/** Số Đơn có link và số Đơn đã được trả tiền (`paid_source`) của khung xét và khung nền. */
export interface IssuanceCounts {
  orders: number;
  paidOrders: number;
  baselineOrders: number;
  baselinePaidOrders: number;
}

/**
 * Đếm hai khung quanh mốc `at` (mặc định đồng hồ DB `now()`), trong một câu: cùng một mốc cho cả hai khung.
 */
export async function issuanceCounts(db: Database, at?: Date): Promise<IssuanceCounts> {
  const anchor = at ? sql`${at.toISOString()}::timestamptz` : sql`now()`;
  const inWindow = (daysAgo: number): SQL =>
    and(
      gt(
        orders.paymentLinkAttemptAt,
        sql`${anchor} - make_interval(days => ${daysAgo}, mins => ${ISSUANCE_WINDOW_FROM_MINUTES})`,
      ),
      lte(
        orders.paymentLinkAttemptAt,
        sql`${anchor} - make_interval(days => ${daysAgo}, mins => ${ISSUANCE_WINDOW_TO_MINUTES})`,
      ),
    )!;
  const current = inWindow(0);
  const baseline = inWindow(ISSUANCE_BASELINE_DAYS);
  const [row] = await db.orm
    .select({
      orders: sql<number>`count(*) FILTER (WHERE ${current})::int`,
      paidOrders: sql<number>`count(${orders.paidSource}) FILTER (WHERE ${current})::int`,
      baselineOrders: sql<number>`count(*) FILTER (WHERE ${baseline})::int`,
      baselinePaidOrders: sql<number>`count(${orders.paidSource}) FILTER (WHERE ${baseline})::int`,
    })
    .from(orders)
    .where(or(current, baseline));
  return {
    orders: Number(row?.orders ?? 0),
    paidOrders: Number(row?.paidOrders ?? 0),
    baselineOrders: Number(row?.baselineOrders ?? 0),
    baselinePaidOrders: Number(row?.baselinePaidOrders ?? 0),
  };
}

/**
 * Tỉ lệ phát Vé giảm bất thường: khung xét có từ `minOrders` Đơn, khung nền có Đơn, và tỉ lệ khung xét dưới `ratio`
 * lần tỉ lệ khung nền. Khung nền không có Đơn thì không có gì để so: bỏ qua.
 */
export function isIssuanceDrop(counts: IssuanceCounts, settings: IssuanceDropSettings): boolean {
  if (counts.orders < settings.minOrders || counts.baselineOrders === 0) return false;
  // paid / orders < ratio × baselinePaid / baselineOrders, nhân chéo (mẫu số dương) trên số nguyên: `ratio` đổi ra phần
  // triệu, so bằng BigInt để tỉ lệ đúng bằng ngưỡng không bị sai số dấu phẩy động đẩy thành "dưới".
  const ratioPpm = BigInt(Math.round(settings.ratio * RATIO_SCALE));
  const current = BigInt(counts.paidOrders) * BigInt(counts.baselineOrders) * BigInt(RATIO_SCALE);
  return current < ratioPpm * BigInt(counts.baselinePaidOrders) * BigInt(counts.orders);
}

/** `ratio` so theo phần triệu. */
const RATIO_SCALE = 1_000_000;

/**
 * Một lượt của luật quanh mốc `at` (mặc định đồng hồ DB; test đặt mốc riêng): đếm hai khung, giảm bất thường thì `raise`
 * `ticket_issuance_drop` (subject cố định, `cooldown`) kèm số Đơn và số Đơn đã trả tiền của hai khung. Trả số đếm.
 */
export async function checkIssuanceDrop(
  { db, alerts }: OpsAlertScanContext,
  settings: IssuanceDropSettings,
  at?: Date,
): Promise<IssuanceCounts> {
  const counts = await issuanceCounts(db, at);
  if (isIssuanceDrop(counts, settings)) {
    await alerts.raise({
      kind: OpsAlertKind.TICKET_ISSUANCE_DROP,
      subjects: [OPS_ALERT_SYSTEM_SUBJECT],
      details: { ...counts, thresholdRatio: settings.ratio },
    });
  }
  return counts;
}

/** Luật `ticket_issuance_drop` của job quét (mốc: đồng hồ DB). */
export function issuanceDropRule(settings: IssuanceDropSettings): OpsAlertRule {
  return {
    name: OpsAlertKind.TICKET_ISSUANCE_DROP,
    async check(context) {
      await checkIssuanceDrop(context, settings);
    },
  };
}

/** Token DI của cấu hình luật `ticket_issuance_drop`. */
export const ISSUANCE_DROP_SETTINGS = Symbol('ISSUANCE_DROP_SETTINGS');

/** Vai `worker`: đăng ký luật `ticket_issuance_drop` vào registry của job quét khi mô-đun khởi tạo (trước lượt quét đầu). */
@Injectable()
export class IssuanceDropRuleRegistration implements OnModuleInit {
  constructor(
    @Inject(OpsAlertRules) private readonly rules: OpsAlertRules,
    @Inject(ISSUANCE_DROP_SETTINGS) private readonly settings: IssuanceDropSettings,
  ) {}

  onModuleInit(): void {
    this.rules.register(issuanceDropRule(this.settings));
  }
}
