import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ErrorCode,
  REALTIME_HEARTBEAT_SECONDS,
  REALTIME_RESYNC,
  RealtimeSignal,
  type RealtimeStreamMessage,
} from '@tickee/contracts';
import pg from 'pg';
import { AppError } from '../http/app-error.js';
import { REALTIME_CHANNEL } from './notify.js';

/** Token DI của cấu hình hub. */
export const REALTIME_OPTIONS = Symbol('REALTIME_OPTIONS');

export interface RealtimeOptions {
  /** `DATABASE_URL`: kết nối session trực tiếp (không qua pooler chế độ transaction) cho `LISTEN`. */
  connectionString: string;
  applicationName?: string;
  /** Chu kỳ heartbeat của mỗi stream (ms); mặc định `REALTIME_HEARTBEAT_SECONDS`. */
  heartbeatMs?: number;
  /** Chờ trước lần nối lại `LISTEN` đầu (ms), gấp đôi sau mỗi lần thất bại, tối đa `reconnectMaxMs`. */
  reconnectInitialMs?: number;
  reconnectMaxMs?: number;
}

/** Bộ lọc của một người đăng ký trên payload `{type, id, organizationId, eventId}` (đã kiểm quyền lúc mở stream). */
export type SignalFilter = (signal: RealtimeSignal) => boolean;

interface Stream {
  res: ServerResponse;
  filter: SignalFilter;
  heartbeat: NodeJS.Timeout;
}

const CONNECT_TIMEOUT_MS = 3_000;
/** TCP keepalive của kết nối `LISTEN`: socket nửa mở (DB failover) bị phát hiện sau chừng này, không phải ~2 giờ của OS. */
const KEEPALIVE_INITIAL_DELAY_MS = 10_000;
/** Mỗi stream mới nhận `retry:` ngẫu nhiên trong khoảng này (ms): client của một instance vừa tắt không nối lại cùng lúc. */
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 5_000;

/** Một tin SSE (sự kiện mặc định `message`) mang `{ type }`. */
const frame = (message: RealtimeStreamMessage): string => `data: ${JSON.stringify(message)}\n\n`;

/**
 * Hub realtime của vai api (AD-17). Một `pg.Client` riêng `LISTEN` trên kênh `REALTIME_CHANNEL` (không giữ kết nối DB
 * nào cho từng stream); mỗi tín hiệu `NOTIFY` được kiểm dạng rồi đẩy `{ type }` tới các stream SSE có bộ lọc khớp. Hub
 * không biết phạm vi nào: mô-đun mở endpoint của mình, kiểm quyền, rồi `open` với bộ lọc theo id đã kiểm.
 *
 * - Mất `LISTEN` (DB khởi động lại, kết nối bị cắt) → `isReady()` false (`/readyz` 503, stream mới 503), log cảnh báo,
 *   nối lại sau `reconnectInitialMs` gấp đôi mỗi lần tới `reconnectMaxMs` (mặc định 5 giây, để instance sẵn sàng lại
 *   sớm sau khi DB về). Nối lại xong, mọi stream đang mở nhận một tín hiệu `resync` (tín hiệu trong khoảng mất kết nối
 *   đã mất) thay vì bị đóng, nên không làm mọi client cùng nối lại.
 * - Mỗi stream: header chống cache và chống buffer, `retry:` ngẫu nhiên 1–5 giây, một dòng comment heartbeat mỗi
 *   `heartbeatMs`.
 * - Tắt máy (SIGTERM): từ `onModuleDestroy` từ chối stream mới (`503 SERVICE_UNAVAILABLE`) và đóng mọi stream đang mở
 *   (để server HTTP đóng được), rồi `onApplicationShutdown` đóng `LISTEN`.
 */
@Injectable()
export class RealtimeHub implements OnModuleInit, OnModuleDestroy, OnApplicationShutdown {
  private readonly logger = new Logger('Realtime');
  private readonly streams = new Set<Stream>();
  private readonly heartbeatMs: number;
  private readonly reconnectInitialMs: number;
  private readonly reconnectMaxMs: number;
  private client: pg.Client | null = null;
  private listening = false;
  private closing = false;
  private failures = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(@Inject(REALTIME_OPTIONS) private readonly options: RealtimeOptions) {
    this.heartbeatMs = options.heartbeatMs ?? REALTIME_HEARTBEAT_SECONDS * 1000;
    this.reconnectInitialMs = options.reconnectInitialMs ?? 1_000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5_000;
  }

  /** `LISTEN` đang chạy và hub chưa tắt (`/readyz`). */
  isReady(): boolean {
    return this.listening && !this.closing;
  }

  /** Số stream đang mở (log, test). */
  get streamCount(): number {
    return this.streams.size;
  }

  /** Lần `LISTEN` đầu: chờ một lần thử (lỗi không chặn khởi động, chỉ log rồi thử lại sau). */
  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  onModuleDestroy(): void {
    this.closing = true;
    this.clearReconnect();
    const open = [...this.streams];
    for (const stream of open) {
      this.drop(stream);
      stream.res.end();
    }
    if (open.length > 0) this.logger.log({ streams: open.length }, 'Đã đóng các stream SSE đang mở');
  }

  async onApplicationShutdown(): Promise<void> {
    this.closing = true;
    this.clearReconnect();
    const client = this.client;
    this.client = null;
    this.listening = false;
    if (client) await client.end().catch(() => undefined);
  }

  /**
   * Mở stream SSE trên `res` cho người đăng ký với bộ lọc `filter` (người gọi đã kiểm phiên và quyền). Hub đang tắt
   * hoặc `LISTEN` chưa sẵn sàng (như `/readyz`) → ném `503 SERVICE_UNAVAILABLE` trước khi ghi gì vào response: client
   * tiếp tục polling thay vì tưởng đã kết nối mà không tín hiệu nào tới. Stream sống tới khi client ngắt hoặc hub tắt.
   */
  open(req: IncomingMessage, res: ServerResponse, filter: SignalFilter): void {
    if (!this.isReady()) {
      throw new AppError(ErrorCode.SERVICE_UNAVAILABLE, 'Máy chủ đang khởi động lại. Bạn thử lại sau ít giây.');
    }
    // Client đã ngắt trong lúc người gọi kiểm quyền: không mở gì.
    if (res.destroyed) return;
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-store, no-transform');
    res.setHeader('connection', 'keep-alive');
    // Proxy (nginx…) không gom buffer: tín hiệu tới trình duyệt ngay.
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);
    const retryMs = RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS + 1));
    res.write(`retry: ${retryMs}\n: connected\n\n`);

    const stream: Stream = {
      res,
      filter,
      heartbeat: setInterval(() => this.write(stream, ': heartbeat\n\n'), this.heartbeatMs),
    };
    stream.heartbeat.unref();
    this.streams.add(stream);
    // `close` của response (không phải của request: từ Node 16 request phát `close` ngay khi đọc xong) = kết nối đóng.
    const done = () => this.drop(stream);
    res.on('close', done);
    res.on('error', done);
  }

  private drop(stream: Stream): void {
    clearInterval(stream.heartbeat);
    this.streams.delete(stream);
  }

  private write(stream: Stream, chunk: string): void {
    if (stream.res.writableEnded || stream.res.destroyed) {
      this.drop(stream);
      return;
    }
    stream.res.write(chunk);
  }

  private async connect(): Promise<void> {
    if (this.closing) return;
    const client = new pg.Client({
      connectionString: this.options.connectionString,
      application_name: this.options.applicationName ?? 'tickee-api-realtime',
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      // `LISTEN` treo (DB nhận kết nối mà không trả lời) không được chặn `onModuleInit`.
      query_timeout: CONNECT_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
    });
    client.on('error', (err: Error & { code?: string }) => this.lost(client, err));
    client.on('end', () => this.lost(client, null));
    client.on('notification', (message) => {
      if (this.client === client) this.dispatch(message);
    });
    this.client = client;
    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    } catch (err) {
      this.lost(client, err as Error & { code?: string });
      return;
    }
    if (this.client !== client || this.closing) {
      await client.end().catch(() => undefined);
      return;
    }
    const reconnected = this.failures > 0;
    this.failures = 0;
    this.listening = true;
    if (reconnected) this.logger.log({ streams: this.streams.size }, 'Đã nối lại LISTEN; báo các stream tải lại');
    // Tín hiệu trong lúc chưa `LISTEN` đã mất: mọi stream đang mở tải lại một lần.
    for (const stream of this.streams) this.write(stream, frame({ type: REALTIME_RESYNC }));
  }

  /** Kết nối `LISTEN` lỗi hoặc đóng (gọi nhiều lần cho cùng client chỉ xử lý lần đầu). */
  private lost(client: pg.Client, err: (Error & { code?: string }) | null): void {
    if (this.client !== client) return;
    this.client = null;
    const wasListening = this.listening;
    this.listening = false;
    client.end().catch(() => undefined);
    if (this.closing) return;
    // Chỉ mã và message của lỗi: không bao giờ log chuỗi kết nối.
    this.logger.warn(
      { code: err?.code, message: err?.message },
      wasListening ? 'Mất kết nối LISTEN realtime; sẽ nối lại' : 'Chưa LISTEN được realtime; sẽ thử lại',
    );
    this.failures += 1;
    const delay = Math.min(this.reconnectInitialMs * 2 ** (this.failures - 1), this.reconnectMaxMs);
    this.clearReconnect();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** Một `NOTIFY`: kiểm dạng payload rồi đẩy `{ type }` tới các stream có bộ lọc khớp. */
  private dispatch(message: pg.Notification): void {
    if (message.channel !== REALTIME_CHANNEL || !message.payload) return;
    let signal: RealtimeSignal;
    try {
      signal = RealtimeSignal.parse(JSON.parse(message.payload));
    } catch {
      this.logger.warn('Tín hiệu realtime sai dạng; bỏ qua');
      return;
    }
    const data = frame({ type: signal.type });
    for (const stream of this.streams) {
      if (stream.filter(signal)) this.write(stream, data);
    }
  }
}
