/** Thời gian tối đa chờ SDK xuất nốt dữ liệu khi tắt; quá thì bỏ phần chưa xuất và tắt như cũ. */
export const TELEMETRY_SHUTDOWN_TIMEOUT_MS = 5_000;

/** SDK đang chạy (do `startTelemetry` của `sdk.ts` đặt); `null` khi telemetry tắt. */
export interface ActiveTelemetry {
  /** Flush rồi shutdown SDK (trace, metrics). */
  shutdown(): Promise<void>;
  /** Log `warn` (lỗi không bao giờ chặn tắt hay làm hỏng request). */
  warn(fields: Record<string, unknown>, message: string): void;
}

let active: ActiveTelemetry | null = null;

export function setActiveTelemetry(telemetry: ActiveTelemetry): void {
  active = telemetry;
}

/**
 * Flush rồi shutdown SDK, chờ tối đa `timeoutMs`. Không bao giờ ném: lỗi (collector chết…) hay quá hạn chỉ log `warn`.
 * Gọi lần hai (hoặc khi telemetry tắt) không làm gì.
 */
export async function shutdownTelemetry(timeoutMs = TELEMETRY_SHUTDOWN_TIMEOUT_MS): Promise<void> {
  const current = active;
  active = null;
  if (!current) return;
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([current.shutdown().then(() => 'done' as const), timedOut]);
    if (result === 'timeout') {
      current.warn({ timeoutMs }, 'OpenTelemetry: xuất dữ liệu khi tắt quá hạn; bỏ phần chưa xuất');
    }
  } catch (err) {
    current.warn({ err: telemetryErrorSummary(err) }, 'OpenTelemetry: tắt SDK lỗi');
  } finally {
    clearTimeout(timer);
  }
}

/** Mã lỗi an toàn để log: SQLSTATE, `ECONNREFUSED`, mã HTTP… (không bao giờ chuỗi tự do). */
const CODE_PATTERN = /^[0-9A-Za-z_]{1,64}$/;

/**
 * Bản rút gọn của lỗi OpenTelemetry để log: tên lớp và mã (`ECONNREFUSED`, HTTP 401…). Không message: lỗi xuất có thể
 * kèm phản hồi của collector hay URL.
 */
export function telemetryErrorSummary(err: unknown): { type: string; code?: string | number } {
  const ctor = typeof err === 'object' && err !== null ? (err as { constructor?: { name?: unknown } }).constructor : undefined;
  const type = typeof ctor?.name === 'string' && ctor.name !== '' ? ctor.name : typeof err;
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'number' && Number.isInteger(code)) return { type, code };
  if (typeof code === 'string' && CODE_PATTERN.test(code)) return { type, code };
  return { type };
}
