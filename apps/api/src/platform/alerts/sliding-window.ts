/*
 * Cửa sổ trượt theo thời gian trong bộ nhớ của một tiến trình (Story 4.6-e): nền cho luật cảnh báo đếm tại chỗ (IPN lỗi,
 * p95 tạo link) mà không lưu gì vào DB hay đọc lại metric OpenTelemetry. Mỗi mẫu có mốc ghi, nhãn và giá trị; mẫu ra khỏi
 * cửa sổ bị bỏ khi đọc hay ghi. Số mẫu giữ trong bộ nhớ có trần: đầy thì bỏ mẫu cũ nhất. Không đồng bộ giữa các instance.
 */

/** Trần số mẫu mặc định của một cửa sổ. */
export const SLIDING_WINDOW_MAX_SAMPLES = 5_000;

/** Dồn mảng khi phần đầu đã bỏ lớn hơn chừng này mẫu (và hơn nửa mảng). */
const COMPACT_AFTER = 1_024;

export interface SlidingWindowOptions {
  /** Độ dài cửa sổ (ms): mẫu ghi lúc `at` còn trong cửa sổ khi `at > now − windowMs`. */
  windowMs: number;
  /** Số mẫu tối đa giữ trong bộ nhớ (≥ 1); mặc định `SLIDING_WINDOW_MAX_SAMPLES`. */
  maxSamples?: number;
  /**
   * Đồng hồ (ms); mặc định `performance.now` (đơn điệu: không lùi khi giờ hệ thống bị chỉnh, nên mẫu luôn theo thứ tự
   * thời gian), test thay.
   */
  now?: () => number;
}

interface Sample<L extends string> {
  at: number;
  label: L;
  value: number;
}

/** Cửa sổ trượt: đếm theo nhãn và percentile nearest-rank của giá trị các mẫu còn trong cửa sổ. */
export class SlidingWindow<L extends string = string> {
  private samples: Sample<L>[] = [];
  /** Vị trí mẫu cũ nhất còn giữ (mẫu trước đó đã bỏ, chờ dồn mảng). */
  private head = 0;
  private readonly windowMs: number;
  private readonly maxSamples: number;
  private readonly now: () => number;

  constructor(options: SlidingWindowOptions) {
    this.windowMs = options.windowMs;
    this.maxSamples = Math.max(1, options.maxSamples ?? SLIDING_WINDOW_MAX_SAMPLES);
    this.now = options.now ?? (() => performance.now());
  }

  /** Ghi một mẫu nhãn `label`, giá trị `value` (mặc định 1) tại mốc hiện tại. */
  add(label: L, value = 1): void {
    this.prune();
    if (this.samples.length - this.head >= this.maxSamples) this.head += 1;
    this.samples.push({ at: this.now(), label, value });
    this.compact();
  }

  /** Số mẫu còn trong cửa sổ. */
  count(): number {
    this.prune();
    return this.samples.length - this.head;
  }

  /** Số mẫu còn trong cửa sổ theo nhãn (nhãn không có mẫu thì không có mặt). */
  countBy(): Map<L, number> {
    this.prune();
    const counts = new Map<L, number>();
    for (let i = this.head; i < this.samples.length; i++) {
      const { label } = this.samples[i]!;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Percentile nearest-rank `p` (0 < p ≤ 100) của giá trị các mẫu còn trong cửa sổ: giá trị thứ `⌈p·n/100⌉` theo thứ tự
   * tăng dần. `null` khi cửa sổ rỗng.
   */
  percentile(p: number): number | null {
    if (!(p > 0 && p <= 100)) throw new RangeError('percentile phải trong (0, 100]');
    this.prune();
    const n = this.samples.length - this.head;
    if (n === 0) return null;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = this.samples[this.head + i]!.value;
    values.sort();
    return values[Math.max(1, Math.ceil((p * n) / 100)) - 1]!;
  }

  /** Bỏ mẫu đã ra khỏi cửa sổ (mẫu ghi theo thứ tự thời gian: chỉ cần xét từ đầu). */
  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.head < this.samples.length && this.samples[this.head]!.at <= cutoff) this.head += 1;
    this.compact();
  }

  private compact(): void {
    if (this.head > COMPACT_AFTER && this.head * 2 > this.samples.length) {
      this.samples = this.samples.slice(this.head);
      this.head = 0;
    }
  }
}
