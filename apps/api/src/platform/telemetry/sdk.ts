import type { IncomingMessage } from 'node:http';
import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import { setGlobalErrorHandler, W3CTraceContextPropagator, type ExportResult } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { AlwaysOnSampler, BatchSpanProcessor, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace';
import { register as registerEsmHooks } from 'import-in-the-middle/register-hooks.mjs';
import type { Logger } from 'pino';
import type { ApiConfig, WorkerConfig } from '../config/index.js';
import { REDACTED } from '../logging/pino-options.js';
import { redactEventAttributes, redactSpanAttributes, redactStatus } from './span-redaction.js';
import { setActiveTelemetry, telemetryErrorSummary } from './state.js';

/*
 * Khởi OpenTelemetry cho vai api và worker (Story 4.6-a). `main.ts` nạp file này ĐỘNG, chỉ khi có
 * `OTEL_EXPORTER_OTLP_ENDPOINT`, sau `loadConfig` và TRƯỚC khi nạp vai: hook nạp mô-đun (CommonJS và ESM) phải có trước
 * khi express và pg được nạp. Không dùng `--import`: Dockerfile, script và lệnh `node` giữ nguyên.
 */

export type TelemetryConfig = Pick<
  ApiConfig | WorkerConfig,
  'APP_ROLE' | 'OTEL_EXPORTER_OTLP_ENDPOINT' | 'OTEL_EXPORTER_OTLP_HEADERS' | 'OTEL_METRIC_EXPORT_INTERVAL'
>;

export const SERVICE_NAMES = { api: 'tickee-api', worker: 'tickee-worker' } as const;

/**
 * Mô-đun mà các instrumentation vá qua hook nạp mô-đun. Hook ESM chỉ chặn đúng các mô-đun này (không bọc mọi `import`):
 * `http`/`https` (instrumentation http) và `pg`/`pg-pool` (instrumentation pg). undici đi qua `diagnostics_channel`, runtime
 * đọc `perf_hooks`: không cần hook.
 */
const HOOKED_MODULES = ['http', 'https', 'pg', 'pg-pool'];

/** Đường probe của load balancer: không span, không metric. */
const PROBE_PATHS = new Set(['/healthz', '/readyz']);

function isProbe(req: IncomingMessage): boolean {
  const path = (req.url ?? '').split(/[?#]/, 1)[0]!.toLowerCase().replace(/\/+$/, '');
  return PROBE_PATHS.has(path);
}

/** URL của một tín hiệu theo quy ước của `OTEL_EXPORTER_OTLP_ENDPOINT`: `<endpoint>/v1/traces`, `<endpoint>/v1/metrics`. */
export function signalUrl(endpoint: string, signal: 'traces' | 'metrics'): string {
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
}

/** Bản sao an toàn của span để xuất: thuộc tính, event và trạng thái đã lọc (`span-redaction.ts`). */
function redactSpan(span: ReadableSpan): ReadableSpan {
  return {
    name: span.name,
    kind: span.kind,
    spanContext: () => span.spanContext(),
    parentSpanContext: span.parentSpanContext,
    startTime: span.startTime,
    endTime: span.endTime,
    status: redactStatus(span.status),
    attributes: redactSpanAttributes(span.attributes),
    links: span.links.map((link) => ({ ...link, attributes: link.attributes && redactSpanAttributes(link.attributes) })),
    events: span.events.map((event) => ({ ...event, attributes: redactEventAttributes(event.name, event.attributes) })),
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

/** Exporter bọc: mọi span đi qua bộ lọc trước khi tới exporter OTLP. */
export class RedactingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this.inner.export(spans.map(redactSpan), resultCallback);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

/**
 * Logger chẩn đoán của OpenTelemetry → `warn` của pino. Chỉ ghi chuỗi thông điệp (không ghi đối số kèm theo: có thể là
 * tùy chọn request mang header), và che giá trị header OTLP nếu lỡ có trong chuỗi.
 */
function diagLogger(warn: (message: string) => void, secrets: readonly string[]): DiagLogger {
  const scrub = (message: string): string => secrets.reduce((m, s) => m.split(s).join(REDACTED), message);
  const toWarn = (message: string) => warn(scrub(String(message)));
  const ignore = () => {};
  return { error: toWarn, warn: toWarn, info: ignore, debug: ignore, verbose: ignore };
}

/**
 * Khởi SDK: trace (lấy mẫu mọi trace, lọc thuộc tính trước khi xuất) và metrics, xuất OTLP/HTTP JSON tới
 * `OTEL_EXPORTER_OTLP_ENDPOINT`; không có log qua OTLP. Lỗi xuất chỉ log `warn`, không bao giờ ném. Không có endpoint thì
 * không làm gì.
 */
export function startTelemetry(config: TelemetryConfig, log: Logger): void {
  const endpoint = config.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;
  const headers = config.OTEL_EXPORTER_OTLP_HEADERS ?? {};
  const warn = (fields: Record<string, unknown>, message: string) => log.warn(fields, message);

  // Trước instrumentation: cảnh báo lúc vá mô-đun (vd. mô-đun đã nạp trước hook) cũng vào log.
  diag.setLogger(
    diagLogger((message) => warn({}, `OpenTelemetry: ${message}`), Object.values(headers).filter((v) => v !== '')),
    { logLevel: DiagLogLevel.WARN, suppressOverrideMessage: true },
  );
  // Lỗi xuất (collector không nghe, HTTP lỗi…): chỉ `warn`, không message (có thể kèm phản hồi của collector).
  setGlobalErrorHandler((err) => warn({ err: telemetryErrorSummary(err) }, 'OpenTelemetry: không xuất được dữ liệu'));

  // Hook ESM đồng bộ (`module.registerHooks`; `module.register` đã deprecated từ Node 26): bản build là ESM nên `import pg`
  // của vai đi qua loader ESM. Hook CommonJS (`require`) do instrumentation tự đăng ký.
  registerEsmHooks({ include: HOOKED_MODULES });

  const interval = config.OTEL_METRIC_EXPORT_INTERVAL;
  const sdk = new NodeSDK({
    serviceName: SERVICE_NAMES[config.APP_ROLE],
    sampler: new AlwaysOnSampler(),
    // Chỉ trace id (W3C `traceparent`), không baggage: như context lưu trên job pg-boss.
    textMapPropagator: new W3CTraceContextPropagator(),
    spanProcessors: [
      new BatchSpanProcessor({
        exporter: new RedactingSpanExporter(new OTLPTraceExporter({ url: signalUrl(endpoint, 'traces'), headers })),
      }),
    ],
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: signalUrl(endpoint, 'metrics'), headers }),
        exportIntervalMillis: interval,
        exportTimeoutMillis: Math.min(interval, 30_000),
      }),
    ],
    // Không gửi log qua OTLP (mặc định của NodeSDK là có): log vẫn là JSON ra stdout.
    logRecordProcessors: [],
    instrumentations: [
      new HttpInstrumentation({
        // Chỉ phía server: lời gọi ra ngoài dùng `fetch` (undici).
        disableOutgoingRequestInstrumentation: true,
        ignoreIncomingRequestHook: isProbe,
      }),
      new UndiciInstrumentation(),
      // Không `enhancedDatabaseReporting` (params của câu SQL). Chỉ query trong một trace (request, job): vòng poll của
      // pg-boss và kết nối `LISTEN` không sinh trace riêng mỗi giây.
      new PgInstrumentation({ enhancedDatabaseReporting: false, requireParentSpan: true }),
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();
  setActiveTelemetry({ shutdown: () => sdk.shutdown(), warn });
  log.info({ serviceName: SERVICE_NAMES[config.APP_ROLE], metricIntervalMs: interval }, 'OpenTelemetry đã bật');
}
