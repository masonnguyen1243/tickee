import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { gunzipSync } from 'node:zlib';

/*
 * Receiver OTLP/HTTP giả (JSON) cho process test của Story 4.6-a: nhận `POST /v1/traces` và `POST /v1/metrics` như một
 * collector, giữ nguyên body (để kiểm không có secret) và trải phẳng span, metric để kiểm.
 */

export interface ReceivedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  /** Body đã giải nén, nguyên văn. */
  body: string;
}

export type AttributeMap = Record<string, unknown>;

export interface ReceivedSpan {
  service: string;
  scope: string;
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId: string | undefined;
  attributes: AttributeMap;
  status: { code?: number; message?: string };
  events: { name: string; attributes: AttributeMap }[];
}

export interface ReceivedDataPoint {
  service: string;
  scope: string;
  metric: string;
  attributes: AttributeMap;
}

export interface OtlpReceiver {
  url: string;
  readonly requests: ReceivedRequest[];
  spans(): ReceivedSpan[];
  dataPoints(): ReceivedDataPoint[];
  /** `hang`: nhận request nhưng không bao giờ trả lời (collector treo). */
  mode: 'ok' | 'hang';
  close(): Promise<void>;
}

interface OtlpKeyValue {
  key: string;
  value?: OtlpAnyValue;
}
interface OtlpAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values?: OtlpAnyValue[] };
}

function valueOf(v: OtlpAnyValue | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(valueOf);
  return undefined;
}

export function attributesOf(list: OtlpKeyValue[] | undefined): AttributeMap {
  return Object.fromEntries((list ?? []).map((kv) => [kv.key, valueOf(kv.value)]));
}

const serviceOf = (resource: { attributes?: OtlpKeyValue[] } | undefined): string =>
  String(attributesOf(resource?.attributes)['service.name'] ?? '');

/** Id của span/trace trong OTLP JSON: hex (chuẩn) hoặc base64 (một số exporter); luôn trả hex. */
function hexId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (/^[0-9a-f]+$/i.test(id)) return id.toLowerCase();
  return Buffer.from(id, 'base64').toString('hex');
}

export async function startOtlpReceiver(): Promise<OtlpReceiver> {
  const requests: ReceivedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let raw = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') raw = gunzipSync(raw);
      requests.push({ path: req.url ?? '', headers: req.headers, body: raw.toString('utf8') });
      if (receiver.mode === 'hang') return;
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Không lấy được cổng của receiver OTLP');

  const bodiesOf = (path: string) =>
    requests.filter((r) => r.path === path).map((r) => JSON.parse(r.body) as Record<string, unknown[]>);

  const receiver: OtlpReceiver = {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    mode: 'ok',
    spans() {
      const out: ReceivedSpan[] = [];
      for (const body of bodiesOf('/v1/traces')) {
        for (const rs of (body.resourceSpans ?? []) as {
          resource?: { attributes?: OtlpKeyValue[] };
          scopeSpans?: { scope?: { name?: string }; spans?: Record<string, unknown>[] }[];
        }[]) {
          const service = serviceOf(rs.resource);
          for (const ss of rs.scopeSpans ?? []) {
            for (const s of ss.spans ?? []) {
              out.push({
                service,
                scope: ss.scope?.name ?? '',
                name: String(s.name),
                kind: Number(s.kind),
                traceId: hexId(s.traceId as string)!,
                spanId: hexId(s.spanId as string)!,
                parentSpanId: hexId(s.parentSpanId as string | undefined),
                attributes: attributesOf(s.attributes as OtlpKeyValue[]),
                status: (s.status ?? {}) as { code?: number; message?: string },
                events: ((s.events ?? []) as { name: string; attributes?: OtlpKeyValue[] }[]).map((e) => ({
                  name: e.name,
                  attributes: attributesOf(e.attributes),
                })),
              });
            }
          }
        }
      }
      return out;
    },
    dataPoints() {
      const out: ReceivedDataPoint[] = [];
      for (const body of bodiesOf('/v1/metrics')) {
        for (const rm of (body.resourceMetrics ?? []) as {
          resource?: { attributes?: OtlpKeyValue[] };
          scopeMetrics?: { scope?: { name?: string }; metrics?: Record<string, unknown>[] }[];
        }[]) {
          const service = serviceOf(rm.resource);
          for (const sm of rm.scopeMetrics ?? []) {
            for (const m of sm.metrics ?? []) {
              const data = (m.histogram ?? m.sum ?? m.gauge ?? m.exponentialHistogram) as
                | { dataPoints?: { attributes?: OtlpKeyValue[] }[] }
                | undefined;
              for (const dp of data?.dataPoints ?? []) {
                out.push({
                  service,
                  scope: sm.scope?.name ?? '',
                  metric: String(m.name),
                  attributes: attributesOf(dp.attributes),
                });
              }
            }
          }
        }
      }
      return out;
    },
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, 'close').catch(() => undefined);
    },
  };
  return receiver;
}
