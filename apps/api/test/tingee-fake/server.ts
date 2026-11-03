import { randomInt } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseTingeeTimestamp, verifySignature } from '../../src/modules/tingee/signing.js';

/*
 * Tingee fake: server HTTP thật trên cổng ngẫu nhiên (hoặc cổng chỉ định, cho dev local) với nhiều merchant, mỗi merchant
 * một cặp key (Client ID + Secret Token) và một danh sách tài khoản (AD-9). Kiểm `x-client-id`, độ lệch timestamp và chữ
 * ký HMAC-SHA512 bằng secret của merchant có Client ID khớp, rồi trả mã như Tingee: 92 Client ID lạ · 90 timestamp sai
 * dạng · 91 lệch giờ · 97 sai chữ ký. `behavior` của merchant: `forbidden` → 1133 (key thiếu quyền) · `suspended` → 1007 ·
 * `error` → HTTP 500 · `hang` → treo (quá timeout của client). `get-va-paging` có `merchantId` trong body → mã 400 (key
 * merchant không được gửi `merchantId`). Mọi request được ghi lại (`requests`) để test kiểm.
 */

/** Timestamp cũ hơn chừng này (hoặc ở tương lai quá 1 phút) bị từ chối. */
const MAX_SKEW_MS = 10 * 60 * 1000;
const MAX_FUTURE_MS = 60 * 1000;

/** Một dòng `items[]` của `get-va-paging` theo dạng của Tingee (để `Record` để test cài được dòng sai dạng). */
export type FakeAccount = Record<string, unknown>;

export type FakeMerchantBehavior = 'suspended' | 'forbidden' | 'error' | 'hang';

export interface FakeMerchant {
  clientId: string;
  secretToken: string;
  /** Sửa trực tiếp mảng này giữa hai lời gọi để giả lập BTC đổi tài khoản trên Tingee. */
  accounts: FakeAccount[];
  behavior?: FakeMerchantBehavior;
}

export interface TingeeFakeOptions {
  merchants: FakeMerchant[];
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
  /** `x-signature` đã gửi (chỉ nằm trong bộ nhớ của test: dùng để kiểm chữ ký không lọt vào log hay response). */
  signature: string;
  /** Chữ ký đúng với secret của merchant có `x-client-id` khớp (Client ID lạ → `false`). */
  signatureValid: boolean;
  body: Record<string, unknown>;
  receivedAt: Date;
}

export interface TingeeFake {
  url: string;
  requests: RecordedRequest[];
  /** Merchant theo Client ID (cùng object đã truyền vào, sửa được). */
  merchant(clientId: string): FakeMerchant;
  /** Lời gọi theo đường dẫn, vd. `calls('/v1/get-va-paging')`. */
  calls(path: string): RecordedRequest[];
  /** Chờ tới khi có ít nhất `count` lời gọi tới `path`. */
  waitFor(path: string, count?: number): Promise<void>;
  reset(): void;
  close(): Promise<void>;
}

let accountSeq = 0;

/**
 * Một tài khoản `active` (MB, cá nhân) dạng Tingee; số tài khoản và số VA duy nhất trong tiến trình, khác nhau, không
 * trùng 4 số cuối.
 */
export function fakeAccount(overrides: FakeAccount = {}): FakeAccount {
  accountSeq += 1;
  const n = String(accountSeq).padStart(4, '0');
  const salt = String(randomInt(100_000, 999_999));
  return {
    bankName: 'MB Bank',
    bankBin: '970422',
    accountType: 'personal-account',
    accountName: 'NGUYEN VAN AN',
    accountNumber: `07${salt}${n}`,
    vaAccountNumber: `96${salt}${n}8`,
    status: 'active',
    shopId: 7000 + accountSeq,
    transactionType: 'credit',
    creationTime: '2026-11-01T10:00:00',
    ...overrides,
  };
}

type Reply = { httpStatus?: number; code: string; message: string; data?: unknown };

const ok = (data: unknown): Reply => ({ code: '00', message: 'Success', data });
const fail = (code: string, message: string, httpStatus = 200): Reply => ({ httpStatus, code, message });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const nonNegativeInt = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback;

export async function startTingeeFake(options: TingeeFakeOptions): Promise<TingeeFake> {
  const requests: RecordedRequest[] = [];
  const waiters = new Set<() => void>();
  const hanging = new Set<ServerResponse>();
  const findMerchant = (clientId: string | undefined) => options.merchants.find((m) => m.clientId === clientId);

  function route(path: string, body: Record<string, unknown>, merchant: FakeMerchant): Reply {
    switch (path) {
      case '/v1/get-va-paging': {
        // Key của merchant: `merchantId` chỉ dành cho key Master Merchant. Tingee không nhận chuỗi rỗng.
        if ('merchantId' in body) return fail('400', 'merchantId chỉ dùng với key Master Merchant');
        if (Object.values(body).some((v) => v === '')) return fail('400', 'Không truyền chuỗi rỗng');
        const skip = nonNegativeInt(body.skipCount, 0);
        const max = Math.min(nonNegativeInt(body.maxResultCount, 10), 2000);
        return ok({ totalCount: merchant.accounts.length, items: merchant.accounts.slice(skip, skip + max) });
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
      const merchant = findMerchant(clientId);
      const signatureValid =
        merchant !== undefined &&
        timestamp !== undefined &&
        verifySignature(timestamp, raw, merchant.secretToken, signature);
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // body hỏng: xử lý như thiếu trường.
      }
      requests.push({ path, clientId, timestamp, signature, signatureValid, body, receivedAt: new Date() });
      for (const wake of waiters) wake();

      const sent = timestamp ? parseTingeeTimestamp(timestamp) : null;
      const skew = sent ? Date.now() - sent.getTime() : Number.NaN;
      let reply: Reply | 'hang';
      if (req.method !== 'POST') reply = fail('405', 'Chỉ nhận POST');
      else if (!merchant) reply = fail('92', 'Client ID không tồn tại hoặc bị khóa');
      else if (!sent) reply = fail('90', 'Timestamp sai định dạng');
      else if (skew > MAX_SKEW_MS || skew < -MAX_FUTURE_MS) reply = fail('91', 'Timestamp lệch giờ máy chủ');
      else if (!signatureValid) reply = fail('97', 'Sai chữ ký');
      else if (merchant.behavior === 'forbidden') reply = fail('1133', 'API key chưa được cấp quyền');
      else if (merchant.behavior === 'suspended') reply = fail('1007', 'Merchant đang bị khóa');
      else if (merchant.behavior === 'error') reply = fail('500', 'Lỗi hệ thống', 500);
      else if (merchant.behavior === 'hang') reply = 'hang';
      else reply = route(path, body, merchant);

      options.log?.(`${req.method} ${path} → ${reply === 'hang' ? 'treo' : reply.code}`);
      if (reply === 'hang') {
        hanging.add(res);
        const timer = setTimeout(() => {
          hanging.delete(res);
          if (!res.writableEnded) res.end(JSON.stringify(ok({ totalCount: 0, items: [] })));
        }, options.hangMs ?? 30_000);
        res.on('close', () => {
          clearTimeout(timer);
          hanging.delete(res);
        });
        return;
      }
      const { httpStatus = 200, ...envelope } = reply;
      res.writeHead(httpStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify(envelope));
    })();
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const calls = (path: string) => requests.filter((r) => r.path === path);

  return {
    url: `http://${options.host ?? '127.0.0.1'}:${port}`,
    requests,
    merchant(clientId) {
      const merchant = findMerchant(clientId);
      if (!merchant) throw new Error(`Tingee fake: không có merchant ${clientId}`);
      return merchant;
    },
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
