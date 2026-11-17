import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { OPS_ALERT_SYSTEM_SUBJECT, OpsAlertKind, OpsAlerts, SlidingWindow } from '../../platform/alerts/index.js';
import { AppError } from '../../platform/http/index.js';
import { errorName } from '../../platform/jobs/index.js';

/*
 * Luật cảnh báo `ipn_failures` (Story 4.6-e, NFR-10), chỉ vai api: endpoint IPN ghi nhận mỗi request kết thúc bằng lỗi
 * vào cửa sổ trượt 5 phút trong bộ nhớ của tiến trình; đạt `OPS_ALERT_IPN_FAILURES` lần thì báo kênh `platform/alerts`
 * (subject cố định, `cooldown`). Mỗi instance api đếm riêng, không cộng giữa instance. Ghi nhận không bao giờ ném và
 * không đổi mã trả về của IPN: lỗi chỉ log `warn`.
 */

/** Độ dài cửa sổ đếm IPN lỗi. */
export const IPN_FAILURE_WINDOW_MS = 5 * 60_000;

/**
 * Lý do một IPN lỗi được đếm: `signature` (401: timestamp/chữ ký sai, hoặc chỉ khớp key cũ mà không ràng được Đơn),
 * `invalid_body` (400: chữ ký đúng mà JSON/schema hỏng), `server_error` (5xx). Không đếm `ipnKey` lạ (404), body quá
 * lớn (413), client ngắt kết nối.
 */
export const IPN_FAILURE_REASONS = ['signature', 'invalid_body', 'server_error'] as const;
export type IpnFailureReason = (typeof IPN_FAILURE_REASONS)[number];

/** Token DI của cấu hình luật `ipn_failures`. */
export const IPN_FAILURE_ALERT_SETTINGS = Symbol('IPN_FAILURE_ALERT_SETTINGS');

export interface IpnFailureAlertSettings {
  /** `OPS_ALERT_IPN_FAILURES`: số IPN lỗi trong 5 phút để báo. */
  threshold: number;
  /** Đồng hồ (ms) của cửa sổ; mặc định đồng hồ đơn điệu của `SlidingWindow`, test thay. */
  now?: () => number;
}

/** Số IPN lỗi trong cửa sổ, tổng và theo lý do. */
export type IpnFailureCounts = { failures: number } & Record<IpnFailureReason, number>;

/**
 * Lỗi bay ra `ErrorFilter` có thành 5xx không: `AppError` hay `HttpException` theo status của nó, lỗi khác luôn là 500.
 */
export function isServerError(err: unknown): boolean {
  if (err instanceof AppError) return err.status >= 500;
  if (err instanceof HttpException) return err.getStatus() >= 500;
  return true;
}

/** Bộ đếm IPN lỗi của một instance api và luật `ipn_failures`. */
@Injectable()
export class IpnFailureMonitor {
  private readonly logger = new Logger('IpnFailureMonitor');
  private readonly window: SlidingWindow<IpnFailureReason>;
  /** Lần báo đang chạy: IPN lỗi tới cùng lúc không mở thêm transaction báo. */
  private raising: Promise<void> | null = null;

  constructor(
    @Inject(OpsAlerts) private readonly alerts: OpsAlerts,
    @Inject(IPN_FAILURE_ALERT_SETTINGS) private readonly settings: IpnFailureAlertSettings,
  ) {
    this.window = new SlidingWindow<IpnFailureReason>({
      windowMs: IPN_FAILURE_WINDOW_MS,
      // Đếm đủ ngưỡng dù ngưỡng lớn hơn trần mặc định.
      maxSamples: Math.max(settings.threshold, 1_000),
      ...(settings.now ? { now: settings.now } : {}),
    });
  }

  /**
   * Ghi nhận một IPN lỗi vì `reason`, rồi xét luật ngay: từ `threshold` lần trong 5 phút → `raise` `ipn_failures` kèm số
   * lần theo lý do (kênh tự chống lặp theo `cooldown`). Không bao giờ ném: lỗi chỉ log `warn`.
   */
  async record(reason: IpnFailureReason): Promise<void> {
    try {
      this.window.add(reason);
      const counts = this.counts();
      if (counts.failures < this.settings.threshold) return;
      if (this.raising) return await this.raising;
      this.raising = this.raise(counts).finally(() => {
        this.raising = null;
      });
      await this.raising;
    } catch (err) {
      this.logger.warn({ reason, error: { type: errorName(err) } }, 'Không ghi nhận được IPN lỗi cho cảnh báo vận hành');
    }
  }

  /** Số IPN lỗi trong 5 phút gần nhất (tổng và theo lý do). */
  counts(): IpnFailureCounts {
    const byReason = this.window.countBy();
    const counts = { failures: this.window.count() } as IpnFailureCounts;
    for (const reason of IPN_FAILURE_REASONS) counts[reason] = byReason.get(reason) ?? 0;
    return counts;
  }

  private async raise(counts: IpnFailureCounts): Promise<void> {
    await this.alerts.raise({
      kind: OpsAlertKind.IPN_FAILURES,
      subjects: [OPS_ALERT_SYSTEM_SUBJECT],
      details: { ...counts, windowMinutes: IPN_FAILURE_WINDOW_MS / 60_000, threshold: this.settings.threshold },
    });
  }
}
