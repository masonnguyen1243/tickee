import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseTingeeTimestamp, verifySignature } from '../../src/modules/tingee/signing.js';

/*
 * Tingee fake: server HTTP thật trên cổng ngẫu nhiên (hoặc cổng chỉ định, cho dev local). Kiểm `x-client-id`, chữ ký
 * HMAC-SHA512 và độ lệch timestamp như Tingee; luôn trả HTTP 200 với `code` ('00' = thành công). Kịch bản `create-va`
 * chọn theo 4 số cuối số tài khoản:
 *   …0000 → liên kết ngay · …1111 → cần OTP (đúng: 123456; 000000 → 1065 hết hạn; 555555 → 500 lỗi hệ thống; khác → 1078 sai) ·
 *   …4343 → 1043 · …8181 → 1081 · …5000 → treo (quá timeout của client) · còn lại → liên kết ngay.
 * Mọi request được ghi lại (`requests`) để test kiểm.
 */

export const FAKE_OTP_OK = '123456';
export const FAKE_OTP_EXPIRED = '000000';
/** OTP làm `confirm-va` trả mã 500 (Tingee lỗi hệ thống), phiên xác nhận vẫn giữ. */
export const FAKE_OTP_PROVIDER_ERROR = '555555';
/** Timestamp cũ hơn chừng này (hoặc ở tương lai quá 1 phút) bị từ chối. */
const MAX_SKEW_MS = 10 * 60 * 1000;
const MAX_FUTURE_MS = 60 * 1000;

export interface TingeeFakeOptions {
  clientId: string;
  secretToken: string;
  /** 0 (mặc định) = cổng ngẫu nhiên. */
  port?: number;
  host?: string;
  /** Kịch bản "treo": giữ request tới khi client hủy hoặc hết chừng này (mặc định 30 giây). */
  hangMs?: number;
  /** In một dòng cho mỗi request (dev local). */
  log?: (line: string) => void;
}

export interface RecordedRequest {
  path: string;
  clientId: string | undefined;
  timestamp: string | undefined;
  signatureValid: boolean;
  /** Body đã parse (có số tài khoản, CCCD — chỉ nằm trong bộ nhớ của test). */
  body: Record<string, unknown>;
  receivedAt: Date;
}

export interface TingeeFake {
  url: string;
  requests: RecordedRequest[];
  /** Lời gọi theo đường dẫn, vd. `calls('/v1/create-va')`. */
  calls(path: string): RecordedRequest[];
  /** Chờ tới khi có ít nhất `count` lời gọi tới `path`. */
  waitFor(path: string, count?: number): Promise<void>;
  reset(): void;
  close(): Promise<void>;
}

type Reply = { code: string; message: string; data?: unknown };

const ok = (data: unknown): Reply => ({ code: '00', message: 'Success', data });
const fail = (code: string, message: string): Reply => ({ code, message });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function startTingeeFake(options: TingeeFakeOptions): Promise<TingeeFake> {
  const requests: RecordedRequest[] = [];
  const waiters = new Set<() => void>();
  const pendingOtp = new Map<string, { merchantId: unknown }>();
  const hanging = new Set<ServerResponse>();
  let merchantSeq = 1000;
  let vaSeq = 0;

  // Dạng phản hồi theo developers.tingee.vn: `create-va` liên kết ngay có thêm `merchantAccountNumberId`, `status`;
  // `confirm-va` có `accountNumber`, `accountType`.
  const linked = (extra: Record<string, unknown>) => {
    vaSeq += 1;
    return { vaAccountNumber: `96${String(vaSeq).padStart(8, '0')}`, shopId: 7000 + vaSeq, bankName: 'MBB', ...extra };
  };

  function route(path: string, body: Record<string, unknown>, res: ServerResponse): Reply | 'hang' {
    switch (path) {
      case '/v1/merchant/create':
        if (typeof body.name !== 'string' || typeof body.phoneNumber !== 'string') return fail('400', 'Thiếu thông tin');
        merchantSeq += 1;
        return ok({ merchantId: merchantSeq });
      case '/v1/create-va': {
        const account = String(body.accountNumber ?? '');
        if (!body.merchantId) return fail('400', 'Thiếu merchantId');
        if (body.appType !== 'baas') return fail('400', 'appType không hợp lệ');
        if (account.endsWith('5000')) {
          hanging.add(res);
          return 'hang';
        }
        if (account.endsWith('4343')) return fail('1043', 'Thông tin tài khoản không hợp lệ');
        if (account.endsWith('8181')) return fail('1081', 'Tài khoản đã được liên kết');
        if (account.endsWith('1111')) {
          const confirmId = randomUUID();
          pendingOtp.set(confirmId, { merchantId: body.merchantId });
          return ok({ confirmId });
        }
        return ok(linked({ merchantAccountNumberId: 5000 + vaSeq + 1, status: 'active' }));
      }
      case '/v1/confirm-va': {
        const confirmId = String(body.confirmId ?? '');
        if (!pendingOtp.has(confirmId)) return fail('1080', 'Phiên xác nhận không tồn tại');
        if (body.otpNumber === FAKE_OTP_EXPIRED) {
          pendingOtp.delete(confirmId);
          return fail('1065', 'OTP hết hạn');
        }
        // Tingee lỗi hệ thống: phiên xác nhận vẫn còn, nhập lại mã đúng vẫn được.
        if (body.otpNumber === FAKE_OTP_PROVIDER_ERROR) return fail('500', 'Lỗi hệ thống');
        if (body.otpNumber !== FAKE_OTP_OK) return fail('1078', 'OTP không đúng');
        pendingOtp.delete(confirmId);
        return ok(linked({ accountType: 'personal-account', accountNumber: 'redacted' }));
      }
      default:
        return fail('404', 'Không có API này');
    }
  }

  const server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const path = new URL(req.url ?? '/', 'http://fake').pathname;
      const header = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? v[0] : v;
      };
      const clientId = header('x-client-id');
      const timestamp = header('x-request-timestamp');
      const signature = header('x-signature') ?? '';
      const signatureValid =
        timestamp !== undefined && verifySignature(timestamp, raw, options.secretToken, signature);
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // body hỏng: xử lý như thiếu trường.
      }
      requests.push({ path, clientId, timestamp, signatureValid, body, receivedAt: new Date() });
      for (const wake of waiters) wake();

      const sent = timestamp ? parseTingeeTimestamp(timestamp) : null;
      const skew = sent ? Date.now() - sent.getTime() : Number.NaN;
      let reply: Reply | 'hang';
      if (req.method !== 'POST') reply = fail('405', 'Chỉ nhận POST');
      // Mã xác thực theo bảng lỗi Tingee: 92 client id, 90 sai dạng timestamp, 91 lệch giờ, 97 sai chữ ký.
      else if (clientId !== options.clientId) reply = fail('92', 'Sai x-client-id');
      else if (!sent) reply = fail('90', 'Timestamp sai định dạng');
      else if (skew > MAX_SKEW_MS || skew < -MAX_FUTURE_MS) reply = fail('91', 'Timestamp lệch giờ máy chủ');
      else if (!signatureValid) reply = fail('97', 'Sai chữ ký');
      else reply = route(path, body, res);

      options.log?.(`${req.method} ${path} → ${reply === 'hang' ? 'treo' : reply.code}`);
      if (reply === 'hang') {
        const timer = setTimeout(() => {
          hanging.delete(res);
          if (!res.writableEnded) res.end(JSON.stringify(ok(linked({}))));
        }, options.hangMs ?? 30_000);
        res.on('close', () => {
          clearTimeout(timer);
          hanging.delete(res);
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const calls = (path: string) => requests.filter((r) => r.path === path);

  return {
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    requests,
    calls,
    waitFor(path, count = 1) {
      if (calls(path).length >= count) return Promise.resolve();
      return new Promise((resolve) => {
        const wake = () => {
          if (calls(path).length >= count) {
            waiters.delete(wake);
            resolve();
          }
        };
        waiters.add(wake);
      });
    },
    reset() {
      requests.length = 0;
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
