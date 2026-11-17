import { context, metrics, trace, type Attributes } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { MeterProvider, MetricReader, type DataPoint } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CreateLinkError,
  HttpTingeeClient,
  TINGEE_REQUEST_DURATION_METRIC,
  type PaymentLinkInput,
  type TingeeCredential,
} from '../../src/modules/tingee/index.js';
import { fakeAccount, startTingeeFake, type TingeeFake } from '../tingee-fake/server.js';

/*
 * Story 4.6-a: mỗi lời gọi `HttpTingeeClient.send` chạy trong span `tingee <operation>` (con của span đang chạy, vd. span
 * request) và ghi histogram `tickee.tingee.request.duration` theo `tingee.operation` và `outcome`. Provider OpenTelemetry
 * trong bộ nhớ (đăng ký toàn cục cho file này), Tingee fake thật.
 */

class TestReader extends MetricReader {
  protected override onShutdown(): Promise<void> {
    return Promise.resolve();
  }
  protected override onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

const A: TingeeCredential = { clientId: 'otel-tingee-a', secretToken: 'otel-tingee-secret-Qa1Ws2' };
const account = fakeAccount();
const input: PaymentLinkInput = {
  orderId: 'TKOTEL0001',
  amount: 300_000,
  vaAccountNumber: String(account.vaAccountNumber),
  expireInMinute: 15,
  returnUrl: 'http://web.tickee.test/orders/TKOTEL0001',
  description: 'Thanh toán Đơn TKOTEL0001',
};

let fake: TingeeFake;
let client: HttpTingeeClient;
const spans = new InMemorySpanExporter();
const reader = new TestReader();
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(async () => {
  context.setGlobalContextManager(contextManager.enable());
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }));
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));
  fake = await startTingeeFake({ merchants: [{ ...A, accounts: [account] }] });
  client = new HttpTingeeClient({ baseUrl: fake.url, paymentLinkTimeoutMs: 300 });
});
beforeEach(() => {
  spans.reset();
  fake.reset();
  fake.merchant(A.clientId).linkReplies = [];
});
afterAll(async () => {
  await fake.close();
  trace.disable();
  metrics.disable();
  context.disable();
});

/** Các điểm dữ liệu của histogram thời gian Tingee (giá trị cộng dồn từ đầu file): thuộc tính → số lần ghi. */
async function tingeeHistogram(): Promise<Map<string, number>> {
  const { resourceMetrics } = await reader.collect();
  const out = new Map<string, number>();
  for (const scope of resourceMetrics.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor.name !== TINGEE_REQUEST_DURATION_METRIC) continue;
      expect(metric.descriptor.unit).toBe('s');
      for (const point of metric.dataPoints as DataPoint<{ count: number }>[]) {
        out.set(JSON.stringify(point.attributes), point.value.count);
      }
    }
  }
  return out;
}

const key = (attributes: Attributes) => JSON.stringify(attributes);

/** Gọi `fn` bên trong một span "request" (như span server của instrumentation http). */
function inRequest<T>(fn: () => Promise<T>): Promise<{ result: T | Error; requestSpanId: string; traceId: string }> {
  return trace.getTracer('test').startActiveSpan('POST /v1/events/:slug/orders', async (span) => {
    const result = await fn().catch((err: unknown) => err as Error);
    span.end();
    return { result, requestSpanId: span.spanContext().spanId, traceId: span.spanContext().traceId };
  });
}

const tingeeSpans = () => spans.getFinishedSpans().filter((s) => s.name.startsWith('tingee '));

describe('span và histogram của lời gọi Tingee', () => {
  it('tạo link thành công: span `tingee create_link` là con của span request; histogram có create_link/ok', async () => {
    const { result, requestSpanId, traceId } = await inRequest(() => client.createPaymentLink(A, input));
    expect(typeof result).toBe('string');
    const [span] = tingeeSpans();
    expect(span?.name).toBe('tingee create_link');
    expect(span?.parentSpanContext?.spanId).toBe(requestSpanId);
    expect(span?.spanContext().traceId).toBe(traceId);
    expect(span?.attributes).toEqual({ 'tingee.operation': 'create_link', outcome: 'ok' });
    expect((await tingeeHistogram()).get(key({ 'tingee.operation': 'create_link', outcome: 'ok' }))).toBe(1);
  });

  it('timeout → outcome=timeout, span lỗi; lời gọi vẫn trả lỗi miền như trước', async () => {
    fake.merchant(A.clientId).linkReplies = ['hang'];
    const { result } = await inRequest(() => client.createPaymentLink(A, input));
    expect(result).toBeInstanceOf(CreateLinkError);
    expect(result).toMatchObject({ outcome: 'ambiguous', reason: 'timeout' });
    const [span] = tingeeSpans();
    expect(span?.attributes).toEqual({ 'tingee.operation': 'create_link', outcome: 'timeout' });
    expect(span?.status.code).toBe(2);
    expect((await tingeeHistogram()).get(key({ 'tingee.operation': 'create_link', outcome: 'timeout' }))).toBe(1);
  });

  it('Tingee từ chối → outcome=rejected (span không lỗi: phản hồi đọc được)', async () => {
    fake.merchant(A.clientId).linkReplies = [{ code: '1033' }];
    const { result } = await inRequest(() => client.createPaymentLink(A, input));
    expect(result).toMatchObject({ outcome: 'rejected', tingeeCode: '1033' });
    const [span] = tingeeSpans();
    expect(span?.attributes).toEqual({ 'tingee.operation': 'create_link', outcome: 'rejected' });
    expect(span?.status.code).toBe(0);
  });

  it('Tingee sự cố: HTTP 5xx kèm body JSON → outcome=rejected, span lỗi', async () => {
    fake.merchant(A.clientId).linkReplies = [{ code: '99', httpStatus: 503 }];
    const { result } = await inRequest(() => client.createPaymentLink(A, input));
    expect(result).toMatchObject({ outcome: 'ambiguous', reason: 'http_status', httpStatus: 503 });
    const [span] = tingeeSpans();
    expect(span?.attributes).toEqual({ 'tingee.operation': 'create_link', outcome: 'rejected' });
    expect(span?.status.code).toBe(2);
  });

  it('operation theo hằng đường dẫn cho mọi lời gọi; không thuộc tính nào mang credential, body hay id', async () => {
    await client.listAccounts(A);
    await client.getMerchantServiceStatus(A);
    await client.getTokenBalance(A);
    await client.getGatewayOrder(A, 'TKOTEL-KHONG-CO');
    expect(tingeeSpans().map((s) => s.attributes['tingee.operation'])).toEqual([
      'get_va_paging',
      'get_va_paging',
      'get_token_balance',
      'get_order',
    ]);
    const histogram = await tingeeHistogram();
    for (const operation of ['get_va_paging', 'get_token_balance']) {
      expect(histogram.get(key({ 'tingee.operation': operation, outcome: 'ok' }))).toBeGreaterThan(0);
    }
    // Tra đơn không có: Tingee trả mã "không tìm thấy" → rejected.
    expect(histogram.get(key({ 'tingee.operation': 'get_order', outcome: 'rejected' }))).toBe(1);
    const recorded = JSON.stringify([...tingeeSpans().map((s) => s.attributes), ...histogram.keys()]);
    for (const value of [A.clientId, A.secretToken, String(account.vaAccountNumber), 'TKOTEL']) {
      expect(recorded).not.toContain(value);
    }
  });
});
