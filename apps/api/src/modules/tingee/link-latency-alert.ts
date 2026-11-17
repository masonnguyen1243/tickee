import { Logger } from '@nestjs/common';
import { OPS_ALERT_SYSTEM_SUBJECT, OpsAlertKind, type OpsAlerts, SlidingWindow } from '../../platform/alerts/index.js';
import { errorName } from '../../platform/jobs/index.js';

/*
 * Luật cảnh báo `payment_link_slow` (Story 4.6-e, NFR-10), chỉ vai api (nơi duy nhất gọi `create-link`): `HttpTingeeClient`
 * nạp thời lượng mọi lời gọi `create-link` (mọi `outcome`, kể cả timeout; đúng số đo của histogram
 * `tickee.tingee.request.duration`) vào cửa sổ trượt 5 phút trong bộ nhớ của tiến trình. Khi có từ
 * `OPS_ALERT_LINK_MIN_SAMPLES` lần gọi mà p95 (nearest-rank) vượt `OPS_ALERT_LINK_P95_MS` thì báo kênh `platform/alerts`
 * (subject cố định, `cooldown`). Mỗi instance api đếm riêng. Ghi nhận không bao giờ ném và không đổi kết quả tạo link.
 */

/** Độ dài cửa sổ p95 tạo link. */
export const PAYMENT_LINK_LATENCY_WINDOW_MS = 5 * 60_000;

/** Percentile so với ngưỡng. */
const PERCENTILE = 95;

export interface PaymentLinkLatencyAlertSettings {
  /** `OPS_ALERT_LINK_P95_MS`: p95 (ms) phải vượt chừng này để báo. */
  p95Ms: number;
  /** `OPS_ALERT_LINK_MIN_SAMPLES`: số lời gọi tối thiểu trong cửa sổ để xét. */
  minSamples: number;
  /** Đồng hồ (ms) của cửa sổ; mặc định đồng hồ đơn điệu của `SlidingWindow`, test thay. */
  now?: () => number;
}

/** Trạng thái cửa sổ: số lời gọi và p95 (ms, làm tròn) trong 5 phút gần nhất; `null` khi chưa có lời gọi nào. */
export interface PaymentLinkLatencyStats {
  samples: number;
  p95Ms: number | null;
}

/** Cửa sổ thời lượng `create-link` của một instance api và luật `payment_link_slow`. */
export class PaymentLinkLatencyMonitor {
  private readonly logger = new Logger('PaymentLinkLatencyMonitor');
  /** Nhãn: `outcome` của lời gọi; giá trị: thời lượng (ms). */
  private readonly window: SlidingWindow;
  /** Lần báo đang chạy: lời gọi chậm tới cùng lúc không mở thêm transaction báo. */
  private raising: Promise<void> | null = null;

  constructor(
    private readonly alerts: OpsAlerts,
    private readonly settings: PaymentLinkLatencyAlertSettings,
  ) {
    this.window = new SlidingWindow({
      windowMs: PAYMENT_LINK_LATENCY_WINDOW_MS,
      // Đủ mẫu để xét dù ngưỡng số mẫu lớn hơn trần mặc định.
      maxSamples: Math.max(settings.minSamples, 5_000),
      ...(settings.now ? { now: settings.now } : {}),
    });
  }

  /**
   * Nạp thời lượng (giây) của một lời gọi `create-link` có `outcome`, rồi xét luật ngay: từ `minSamples` lời gọi trong 5
   * phút mà p95 (chưa làm tròn) > `p95Ms` → `raise` `payment_link_slow` kèm `p95Ms` (làm tròn), `samples` (kênh tự chống
   * lặp theo `cooldown`).
   * Không bao giờ ném: lỗi chỉ log `warn`. Promise xong khi lần báo (nếu có) xong; bên gọi không cần chờ.
   */
  async record(seconds: number, outcome: string): Promise<void> {
    try {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      this.window.add(outcome, seconds * 1000);
      // Đếm trước (rẻ); chỉ sắp xếp cửa sổ để tính p95 khi đã đủ mẫu.
      const samples = this.window.count();
      if (samples < this.settings.minSamples) return;
      const p95 = this.window.percentile(PERCENTILE);
      // So p95 thô với ngưỡng; chỉ làm tròn khi báo.
      if (p95 === null || p95 <= this.settings.p95Ms) return;
      if (this.raising) return await this.raising;
      this.raising = this.raise({ samples, p95Ms: Math.round(p95) }).finally(() => {
        this.raising = null;
      });
      await this.raising;
    } catch (err) {
      this.logger.warn({ error: { type: errorName(err) } }, 'Không ghi nhận được thời lượng tạo link cho cảnh báo vận hành');
    }
  }

  /** Số lời gọi `create-link` và p95 (ms, làm tròn) trong 5 phút gần nhất. */
  stats(): PaymentLinkLatencyStats {
    const p95 = this.window.percentile(PERCENTILE);
    return { samples: this.window.count(), p95Ms: p95 === null ? null : Math.round(p95) };
  }

  private async raise(stats: PaymentLinkLatencyStats): Promise<void> {
    await this.alerts.raise({
      kind: OpsAlertKind.PAYMENT_LINK_SLOW,
      subjects: [OPS_ALERT_SYSTEM_SUBJECT],
      details: {
        p95Ms: stats.p95Ms,
        samples: stats.samples,
        thresholdMs: this.settings.p95Ms,
        windowMinutes: PAYMENT_LINK_LATENCY_WINDOW_MS / 60_000,
      },
    });
  }
}
