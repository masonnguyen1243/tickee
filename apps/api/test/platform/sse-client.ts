import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';

/*
 * Client SSE thật cho test realtime (Story 3.7): mở `GET` trên server HTTP đang nghe cổng, đọc từng khung `data:` và
 * dòng comment khi chúng tới, ghi lại giờ nhận để đo độ trễ tín hiệu.
 */

/**
 * Server HTTP thật trên cùng app Express của harness (SSE cần socket mở lâu, supertest không đọc stream). `close()` mặc
 * định cắt mọi kết nối còn mở; `close({ force: false })` chỉ đóng như server thật (chờ response đang mở xong, cắt kết
 * nối rảnh): còn SSE mở thì treo.
 */
export async function listen(
  app: INestApplication,
): Promise<{ server: Server; baseUrl: string; close(options?: { force?: boolean }): Promise<void> }> {
  const server = createServer(app.getHttpAdapter().getInstance());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    close: ({ force = true } = {}) =>
      new Promise<void>((resolve) => {
        if (force) server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export interface SseMessage {
  /** `data:` đã parse JSON. */
  data: unknown;
  /** Chuỗi `data:` nguyên văn. */
  raw: string;
  /** `Date.now()` lúc nhận. */
  at: number;
}

export interface SseClient {
  status: number;
  headers: IncomingHttpHeaders;
  /** Body nguyên văn đã nhận (response không phải SSE: JSON lỗi). */
  text(): string;
  messages: SseMessage[];
  comments: string[];
  /** Chờ tới khi có ít nhất `count` tin `data:`; quá `timeoutMs` → lỗi. */
  waitForMessages(count: number, timeoutMs?: number): Promise<SseMessage[]>;
  /** Server đóng stream. */
  ended: Promise<void>;
  isEnded(): boolean;
  close(): void;
}

/** Mở `GET baseUrl + path` với `headers` (vd. cookie); resolve khi có header phản hồi. */
export function openSse(baseUrl: string, path: string, headers: Record<string, string> = {}): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, { headers: { accept: 'text/event-stream', ...headers } }, (res) => {
      res.setEncoding('utf8');
      let body = '';
      let buffer = '';
      let ended = false;
      const messages: SseMessage[] = [];
      const comments: string[] = [];
      const waiters: (() => void)[] = [];
      const wake = () => waiters.splice(0).forEach((w) => w());
      res.on('data', (chunk: string) => {
        body += chunk;
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = block.split('\n');
          const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());
          for (const l of lines) if (l.startsWith(':')) comments.push(l.slice(1).trim());
          if (data.length > 0) {
            const raw = data.join('\n');
            messages.push({ data: JSON.parse(raw) as unknown, raw, at: Date.now() });
          }
        }
        wake();
      });
      const ended$ = new Promise<void>((done) => {
        res.on('end', () => {
          ended = true;
          wake();
          done();
        });
        res.on('close', () => {
          ended = true;
          wake();
          done();
        });
      });
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        text: () => body,
        messages,
        comments,
        async waitForMessages(count, timeoutMs = 5_000) {
          const deadline = Date.now() + timeoutMs;
          while (messages.length < count) {
            if (ended) throw new Error(`Stream đã đóng khi mới có ${messages.length}/${count} tin`);
            const left = deadline - Date.now();
            if (left <= 0) throw new Error(`Chờ ${count} tin SSE quá ${timeoutMs}ms (có ${messages.length})`);
            await new Promise<void>((r) => {
              const timer = setTimeout(r, left);
              waiters.push(() => {
                clearTimeout(timer);
                r();
              });
            });
          }
          return messages.slice(0, count);
        },
        ended: ended$,
        isEnded: () => ended,
        close: () => req.destroy(),
      });
    });
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(err);
    });
    req.end();
  });
}

/** Chờ `ms`. */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
