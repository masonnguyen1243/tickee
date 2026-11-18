import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseOtlpHeaders } from '../../src/platform/config/index.js';
import { signalUrl } from '../../src/platform/telemetry/sdk.js';
import { apiConfig, workerConfig } from '../helpers.js';

/*
 * Story 4.6-a: biến `OTEL_*` của vai api và worker (không có ở vai migrate). Không đặt → telemetry tắt, chu kỳ metrics
 * mặc định 60 giây. Lỗi nêu tên biến, không bao giờ nêu giá trị (header là secret).
 */

const SECRET = `otel-bi-mat-${Date.now()}`;

/** Env dạng chuỗi (như `process.env`) từ cấu hình test của một vai, bỏ các biến `OTEL_*`. */
function envOf(config: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(config)
      .filter(([key, value]) => value !== undefined && !key.startsWith('OTEL_'))
      .map(([key, value]) => [key, String(value)]),
  );
}

const apiEnv = { ...envOf(apiConfig()), PORT: '3001' };
const workerEnv = envOf(workerConfig());

function errorOf(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error('loadConfig phải ném lỗi');
}

describe('cấu hình OpenTelemetry', () => {
  it.each([
    ['api', apiEnv],
    ['worker', workerEnv],
  ])('vai %s: không đặt OTEL_* (hoặc đặt rỗng) → tắt, chu kỳ 60000', (_role, env) => {
    for (const extra of [{}, { OTEL_EXPORTER_OTLP_ENDPOINT: '', OTEL_EXPORTER_OTLP_HEADERS: '', OTEL_METRIC_EXPORT_INTERVAL: '' }]) {
      const config = loadConfig({ ...env, ...extra });
      expect(config).toMatchObject({ OTEL_METRIC_EXPORT_INTERVAL: 60_000 });
      expect(config).not.toHaveProperty('OTEL_EXPORTER_OTLP_ENDPOINT');
      expect(config).not.toHaveProperty('OTEL_EXPORTER_OTLP_HEADERS');
    }
  });

  it('đọc endpoint, header (giải mã percent-encoding, tên chữ thường) và chu kỳ', () => {
    const config = loadConfig({
      ...workerEnv,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.vn:4318/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer%20${SECRET}, x-scope-orgid = tickee`,
      OTEL_METRIC_EXPORT_INTERVAL: '15000',
    });
    expect(config).toMatchObject({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.vn:4318/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: { authorization: `Bearer ${SECRET}`, 'x-scope-orgid': 'tickee' },
      OTEL_METRIC_EXPORT_INTERVAL: 15_000,
    });
  });

  it('vai migrate không nhận biến OTEL_* (không bật telemetry)', () => {
    const config = loadConfig({
      APP_ROLE: 'migrate',
      NODE_ENV: 'test',
      MIGRATION_DATABASE_URL: 'postgres://m:p@db/tickee',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    expect(config).not.toHaveProperty('OTEL_EXPORTER_OTLP_ENDPOINT');
  });

  it.each([
    ['endpoint không phải URL', { OTEL_EXPORTER_OTLP_ENDPOINT: `abc-${SECRET}` }, 'OTEL_EXPORTER_OTLP_ENDPOINT', 'sai định dạng'],
    ['endpoint không phải http(s)', { OTEL_EXPORTER_OTLP_ENDPOINT: `grpc://${SECRET}:4317` }, 'OTEL_EXPORTER_OTLP_ENDPOINT', 'sai định dạng'],
    ['header thiếu dấu =', { OTEL_EXPORTER_OTLP_HEADERS: SECRET }, 'OTEL_EXPORTER_OTLP_HEADERS', 'phải là danh sách key=value cách nhau bằng dấu phẩy'],
    ['header giá trị rỗng', { OTEL_EXPORTER_OTLP_HEADERS: `a=${SECRET},b=` }, 'OTEL_EXPORTER_OTLP_HEADERS', 'phải là danh sách key=value cách nhau bằng dấu phẩy'],
    ['header tên sai', { OTEL_EXPORTER_OTLP_HEADERS: `bad key=${SECRET}` }, 'OTEL_EXPORTER_OTLP_HEADERS', 'phải là danh sách key=value cách nhau bằng dấu phẩy'],
    ['header percent-encoding hỏng', { OTEL_EXPORTER_OTLP_HEADERS: `a=%E0%A4%A${SECRET}` }, 'OTEL_EXPORTER_OTLP_HEADERS', 'phải là danh sách key=value cách nhau bằng dấu phẩy'],
    ['chu kỳ không phải số', { OTEL_METRIC_EXPORT_INTERVAL: SECRET }, 'OTEL_METRIC_EXPORT_INTERVAL', 'sai định dạng'],
    ['chu kỳ dưới 1 giây', { OTEL_METRIC_EXPORT_INTERVAL: '500' }, 'OTEL_METRIC_EXPORT_INTERVAL', 'ngoài khoảng cho phép'],
  ])('%s → lỗi nêu tên biến, không nêu giá trị', (_name, extra, variable, reason) => {
    for (const env of [apiEnv, workerEnv]) {
      const err = errorOf({ ...env, ...extra });
      expect(err.issues).toEqual([{ variable, reason }]);
      expect(err.message).not.toContain(SECRET);
    }
  });
});

describe('parseOtlpHeaders và signalUrl', () => {
  it('nhiều cặp, bỏ khoảng trắng, giá trị có dấu =', () => {
    expect(parseOtlpHeaders('a=1, B = x%3Dy ,c=d=e')).toEqual({ a: '1', b: 'x=y', c: 'd=e' });
    expect(parseOtlpHeaders('a=1\r\nx: y')).toBeNull();
  });

  it('URL theo tín hiệu: <endpoint>/v1/traces, <endpoint>/v1/metrics (bỏ dấu / cuối)', () => {
    expect(signalUrl('http://localhost:4318', 'traces')).toBe('http://localhost:4318/v1/traces');
    expect(signalUrl('https://otlp.example.vn/otlp/', 'metrics')).toBe('https://otlp.example.vn/otlp/v1/metrics');
  });
});
