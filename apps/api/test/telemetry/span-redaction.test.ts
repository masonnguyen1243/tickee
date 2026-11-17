import { SpanStatusCode, TraceFlags } from '@opentelemetry/api';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { describe, expect, it } from 'vitest';
import {
  redactEventAttributes,
  redactFullUrl,
  redactPath,
  redactSpanAttributes,
  redactStatus,
  redactTarget,
  stackFramesOnly,
} from '../../src/platform/telemetry/index.js';
import { RedactingSpanExporter } from '../../src/platform/telemetry/sdk.js';

/*
 * Story 4.6-a: bộ lọc thuộc tính của span (hàm thuần, áp cho mọi span trước khi xuất). Mỗi dòng nhạy cảm của I/O Matrix:
 * link chia sẻ (token + query), callback Google (`code`, `state`), IPN (`ipnKey`, chữ ký), cùng query, header, IP,
 * User-Agent và message lỗi.
 */

const TOKEN = 'tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const IPN_KEY = 'ipnKey-Zx81Qw';

describe('redactPath', () => {
  it.each([
    [`/v1/shared-tickets/${TOKEN}`, '/v1/shared-tickets/[REDACTED]'],
    [`/v1/shared-tickets/${TOKEN}/qr`, '/v1/shared-tickets/[REDACTED]/qr'],
    // Express khớp route không phân biệt hoa thường: giữ tiền tố như đã gửi, vẫn che.
    [`/V1/Shared-Tickets/${TOKEN}`, '/V1/Shared-Tickets/[REDACTED]'],
    [`/v1/payments/tingee/ipn/${IPN_KEY}`, '/v1/payments/tingee/ipn/[REDACTED]'],
    ['/v1/auth/callback/google', '/v1/auth/[REDACTED]'],
    ['/v1/auth/reset-password/abc123', '/v1/auth/[REDACTED]'],
    ['/v1/orgs/0b4c/token', '/v1/orgs/0b4c/token'],
    ['/v1/shared-tickets', '/v1/shared-tickets'],
    ['/healthz', '/healthz'],
  ])('%s → %s', (input, expected) => {
    expect(redactPath(input)).toBe(expected);
  });
});

describe('redactTarget / redactFullUrl: bỏ query, fragment, thông tin đăng nhập; che đoạn bí mật', () => {
  it.each([
    [`/v1/shared-tickets/${TOKEN}?a=b`, '/v1/shared-tickets/[REDACTED]'],
    ['/v1/auth/callback/google?code=4/0Abc&state=xyz', '/v1/auth/[REDACTED]'],
    ['/v1/events/giai-a/availability?ref=email#top', '/v1/events/giai-a/availability'],
    // `req.url` dạng tuyệt đối (Node vẫn nhận, router vẫn khớp route).
    [`http://api.tickee.vn/v1/shared-tickets/${TOKEN}?a=b`, 'http://api.tickee.vn/v1/shared-tickets/[REDACTED]'],
  ])('target %s → %s', (input, expected) => {
    expect(redactTarget(input)).toBe(expected);
  });

  it.each([
    [`https://api.tickee.vn/v1/payments/tingee/ipn/${IPN_KEY}?x=1`, 'https://api.tickee.vn/v1/payments/tingee/ipn/[REDACTED]'],
    ['https://user:pass@tingee.example:8443/v1/payment-gateway/create-link?sig=abc', 'https://tingee.example:8443/v1/payment-gateway/create-link'],
    ['https://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/token'],
    ['khong phai url ?secret=1', '[REDACTED]'],
  ])('full %s → %s', (input, expected) => {
    expect(redactFullUrl(input)).toBe(expected);
  });
});

describe('redactSpanAttributes', () => {
  it('span server của link chia sẻ: không còn token hay query; route mẫu giữ nguyên', () => {
    const out = redactSpanAttributes({
      'http.request.method': 'GET',
      'url.path': `/v1/shared-tickets/${TOKEN}`,
      'url.query': 'a=b',
      'http.target': `/v1/shared-tickets/${TOKEN}?a=b`,
      'http.url': `http://api.tickee.vn/v1/shared-tickets/${TOKEN}?a=b`,
      'url.full': `http://api.tickee.vn/v1/shared-tickets/${TOKEN}?a=b`,
      'http.route': '/v1/shared-tickets/:token',
      'http.response.status_code': 200,
    });
    expect(out).toEqual({
      'http.request.method': 'GET',
      'url.path': '/v1/shared-tickets/[REDACTED]',
      'http.target': '/v1/shared-tickets/[REDACTED]',
      'http.url': 'http://api.tickee.vn/v1/shared-tickets/[REDACTED]',
      'url.full': 'http://api.tickee.vn/v1/shared-tickets/[REDACTED]',
      'http.route': '/v1/shared-tickets/:token',
      'http.response.status_code': 200,
    });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain('a=b');
  });

  it('callback Google: không còn `code` hay `state`', () => {
    const out = redactSpanAttributes({
      'url.path': '/v1/auth/callback/google',
      'url.query': 'code=4%2F0AbcDEF&state=st-123',
      'http.target': '/v1/auth/callback/google?code=4%2F0AbcDEF&state=st-123',
    });
    expect(out).toEqual({ 'url.path': '/v1/auth/[REDACTED]', 'http.target': '/v1/auth/[REDACTED]' });
  });

  it('IPN: không `ipnKey`, không header chữ ký (kể cả khi có instrumentation ghi header)', () => {
    const out = redactSpanAttributes({
      'url.path': `/v1/payments/tingee/ipn/${IPN_KEY}`,
      'http.route': '/v1/payments/tingee/ipn/:ipnKey',
      'http.request.header.x-signature': ['sig-abc'],
      'http.request.header.idempotency-key': ['idem-1'],
      'http.response.header.set-cookie': ['sid=1'],
    });
    expect(out).toEqual({ 'url.path': '/v1/payments/tingee/ipn/[REDACTED]', 'http.route': '/v1/payments/tingee/ipn/:ipnKey' });
  });

  it('bỏ IP, User-Agent và params của câu SQL; giữ thuộc tính khác', () => {
    const out = redactSpanAttributes({
      'client.address': '203.0.113.9',
      'client.port': 51234,
      'network.peer.address': '10.0.0.7',
      'network.peer.port': 51234,
      'net.peer.ip': '10.0.0.8',
      'user_agent.original': 'Mozilla/5.0',
      'http.user_agent': 'Mozilla/5.0',
      'drizzle.query.params': '["a@vidu.vn"]',
      'db.query.parameter.0': 'a@vidu.vn',
      'db.query.text': 'select 1 where email = $1',
      'db.system.name': 'postgresql',
      'tingee.operation': 'create_link',
    });
    expect(out).toEqual({
      'db.query.text': 'select 1 where email = $1',
      'db.system.name': 'postgresql',
      'tingee.operation': 'create_link',
    });
  });

  it('không sửa object đầu vào', () => {
    const input = { 'url.query': 'a=b', 'url.path': `/v1/shared-tickets/${TOKEN}` };
    redactSpanAttributes(input);
    expect(input).toEqual({ 'url.query': 'a=b', 'url.path': `/v1/shared-tickets/${TOKEN}` });
  });
});

describe('event và trạng thái lỗi: không message', () => {
  const stack = [
    'DrizzleQueryError: Failed query: insert into "sessions" ("token") values ($1)',
    'params: tok-bi-mat,a@vidu.vn',
    '    at NodePgPreparedQuery.queryWithCache (file:///app/node_modules/drizzle-orm/pg-core/session.js:41:15)',
    '    at async Promise.all (index 0)',
  ].join('\n');

  it('event `exception`: chỉ còn tên lớp và khung stack', () => {
    const out = redactEventAttributes('exception', {
      'exception.type': 'DrizzleQueryError',
      'exception.message': 'Failed query … params: tok-bi-mat,a@vidu.vn',
      'exception.stacktrace': stack,
    });
    expect(out).toEqual({
      'exception.type': 'DrizzleQueryError',
      'exception.stacktrace': [
        '    at NodePgPreparedQuery.queryWithCache (file:///app/node_modules/drizzle-orm/pg-core/session.js:41:15)',
        '    at async Promise.all (index 0)',
      ].join('\n'),
    });
    expect(JSON.stringify(out)).not.toContain('a@vidu.vn');
    expect(stackFramesOnly(stack)).not.toContain('tok-bi-mat');
  });

  it('event khác lọc như thuộc tính của span', () => {
    expect(redactEventAttributes('redirect', { 'url.full': 'https://web.tickee.vn/a?returnTo=/x' })).toEqual({
      'url.full': 'https://web.tickee.vn/a',
    });
    expect(redactEventAttributes('x', undefined)).toBeUndefined();
  });

  it('trạng thái: giữ mã, bỏ message', () => {
    expect(redactStatus({ code: SpanStatusCode.ERROR, message: 'duplicate key a@vidu.vn' })).toEqual({
      code: SpanStatusCode.ERROR,
    });
    expect(redactStatus({ code: SpanStatusCode.OK })).toEqual({ code: SpanStatusCode.OK });
  });
});

describe('RedactingSpanExporter: bản xuất của span đã qua bộ lọc', () => {
  it('trạng thái không message; event `exception` chỉ còn tên lớp và khung stack; link và thuộc tính đã lọc', async () => {
    const secret = `bi-mat-${TOKEN}`;
    const memory = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter: new RedactingSpanExporter(memory) })],
    });
    const span = provider.getTracer('test').startSpan('GET /v1/shared-tickets/:token', {
      attributes: { 'url.path': `/v1/shared-tickets/${TOKEN}`, 'url.query': `a=${secret}` },
      links: [
        {
          context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: TraceFlags.SAMPLED },
          attributes: { 'url.query': `a=${secret}`, 'url.path': `/v1/shared-tickets/${TOKEN}` },
        },
      ],
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message: secret });
    span.recordException(new Error(secret));
    span.end();
    await provider.forceFlush();

    const [exported] = memory.getFinishedSpans();
    expect(exported?.status).toEqual({ code: SpanStatusCode.ERROR });
    expect(exported?.attributes).toEqual({ 'url.path': '/v1/shared-tickets/[REDACTED]' });
    expect(exported?.links.map((l) => l.attributes)).toEqual([{ 'url.path': '/v1/shared-tickets/[REDACTED]' }]);
    const exception = exported?.events.find((e) => e.name === 'exception');
    expect(exception?.attributes?.['exception.type']).toBe('Error');
    expect(exception?.attributes).not.toHaveProperty('exception.message');
    const frames = String(exception?.attributes?.['exception.stacktrace']).split('\n');
    expect(frames.length).toBeGreaterThan(0);
    for (const line of frames) expect(line).toMatch(/^\s+at\s/);
    const { name, attributes, status, events, links } = exported!;
    const raw = JSON.stringify({ name, attributes, status, events, links });
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(TOKEN);
    expect(exported?.spanContext().spanId).toBe(span.spanContext().spanId);
    await provider.shutdown();
  });
});
