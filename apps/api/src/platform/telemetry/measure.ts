import {
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Histogram,
  type MeterProvider,
  type Span,
} from '@opentelemetry/api';

/** Tên scope OpenTelemetry của mã Tickee (span và metric tự đo). */
export const TICKEE_SCOPE = 'tickee';

/**
 * Mốc histogram thời gian (giây) cho lời gọi ra ngoài: dày quanh 1–3 giây để đọc được p95 so với ngưỡng cảnh báo 2 giây
 * (4.6-b) và các timeout 3, 5, 15 giây của adapter Tingee.
 */
const DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 15];

/**
 * Meter của API toàn cục không có proxy như tracer: meter lấy trước khi SDK đăng ký là no-op mãi mãi. Histogram tạo lại khi
 * meter provider toàn cục đổi (SDK khởi sau khi mô-đun được nạp, hoặc test đăng ký provider riêng).
 */
const histograms = new Map<string, { provider: MeterProvider; histogram: Histogram }>();

function histogramOf(name: string, description: string): Histogram {
  const provider = metrics.getMeterProvider();
  const cached = histograms.get(name);
  if (cached?.provider === provider) return cached.histogram;
  const histogram = provider.getMeter(TICKEE_SCOPE).createHistogram(name, {
    description,
    unit: 's',
    advice: { explicitBucketBoundaries: DURATION_BUCKETS },
  });
  histograms.set(name, { provider, histogram });
  return histogram;
}

/** Kết quả của một lời gọi đã đo: `outcome` (giá trị ít, không id) và có phải lỗi không (span `ERROR`). */
export interface MeasuredOutcome {
  outcome: string;
  error: boolean;
}

export interface MeasuredCall<T> {
  /** Tên span, vd. `tingee create_link`. */
  span: string;
  /** Histogram thời gian (giây), vd. `tickee.tingee.request.duration`. */
  metric: string;
  description: string;
  /** Thuộc tính của cả span lẫn metric: chỉ giá trị ít (không id, không PII). */
  attributes: Attributes;
  outcome: (result: T) => MeasuredOutcome;
  /**
   * Nhận đúng số đo (giây) và `outcome` vừa ghi vào histogram, ngay sau khi ghi (cả khi telemetry tắt), vd. cửa sổ p95 của
   * cảnh báo tạo link chậm (Story 4.6-e). Lỗi của callback bị bỏ qua: không bao giờ đổi kết quả của lời gọi (bên nhận tự
   * log).
   */
  onRecorded?: (seconds: number, outcome: string) => void;
}

/**
 * Chạy `fn` trong một span (con của span đang chạy) rồi ghi thời gian vào histogram kèm `outcome` (và đưa cùng số đo cho
 * `onRecorded`). Telemetry tắt thì span và histogram là no-op. `fn` ném lỗi: span `ERROR`, không ghi histogram, ném lại.
 */
export function measured<T>(call: MeasuredCall<T>, fn: () => Promise<T>): Promise<T> {
  const tracer = trace.getTracer(TICKEE_SCOPE);
  return tracer.startActiveSpan(call.span, { kind: SpanKind.INTERNAL, attributes: call.attributes }, async (span) => {
    const startedAt = performance.now();
    try {
      const result = await fn();
      const { outcome, error } = call.outcome(result);
      span.setAttribute('outcome', outcome);
      if (error) span.setStatus({ code: SpanStatusCode.ERROR });
      const seconds = (performance.now() - startedAt) / 1000;
      histogramOf(call.metric, call.description).record(seconds, { ...call.attributes, outcome });
      if (call.onRecorded) {
        try {
          call.onRecorded(seconds, outcome);
        } catch {
          // Bên nhận số đo lỗi không làm hỏng lời gọi đã đo.
        }
      }
      return result;
    } catch (err) {
      markSpanFailed(span, errorType(err));
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Tên lớp của lỗi (không message). */
function errorType(err: unknown): string {
  return (err as { constructor?: { name?: string } } | null)?.constructor?.name ?? 'Unknown';
}

function markSpanFailed(span: Span, type: string): void {
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.setAttribute('error.type', type);
}

/**
 * Đánh dấu span đang chạy là lỗi kèm `error.type` (tên lớp lỗi hay mã ngắn, không message), vd. job pg-boss mà handler
 * ném lỗi (worker chốt từng job nên pg-boss không tự đánh dấu span `process <queue>`). Không có span thì không làm gì.
 */
export function markActiveSpanFailed(type: string): void {
  const span = trace.getActiveSpan();
  if (span) markSpanFailed(span, type);
}
