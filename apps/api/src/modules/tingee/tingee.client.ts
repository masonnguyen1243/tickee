import { Logger } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import { z } from 'zod';
import { AppError } from '../../platform/http/index.js';
import { DOMAIN_ERROR_MESSAGES, domainErrorOf, TINGEE_ERROR_CODES, type TingeeDomainError } from './errors.js';
import { sign, tingeeTimestamp } from './signing.js';

/** Token DI của `TingeeClient`; test thay bằng client trỏ vào Tingee fake. */
export const TINGEE_CLIENT = Symbol('TINGEE_CLIENT');

/** Timeout mỗi lời gọi Tingee. */
export const TINGEE_TIMEOUT_MS = 15_000;

/** Số dòng tối đa đọc trong một lần `get-va-paging` (Tingee cho tối đa 2000; một BTC nhiều hơn chừng này là bất thường). */
export const TINGEE_ACCOUNT_PAGE_SIZE = 200;

/**
 * API key của một BTC trên Tingee (`organizer` giải mã ngay trước khi gọi). Không bao giờ log, không giữ lâu hơn lời gọi.
 */
export interface TingeeCredential {
  clientId: string;
  secretToken: string;
}

/**
 * Một tài khoản (VA) `active`, nhận được tiền, của BTC trên Tingee. Không có số tài khoản đầy đủ: chỉ 4 số cuối.
 * `vaAccountNumber` là số Tingee dùng để nhận tiền (`create-link` truyền số này, AD-6).
 */
export interface TingeeAccount {
  vaAccountNumber: string;
  bankBin: string;
  bankName: string;
  accountType: string;
  accountLast4: string;
  accountName: string;
  shopId: number | null;
}

/**
 * Cổng gọi Tingee (AD-5, AD-9): chỉ mô-đun `tingee` biết tên trường, host và mã lỗi Tingee. Mọi lời gọi nhận credential
 * của một BTC làm tham số và không gửi `merchantId`. Lỗi luôn là `AppError` với mã miền (`TINGEE_CREDENTIAL_INVALID`,
 * `MERCHANT_SUSPENDED`, `PAYMENT_PROVIDER_UNAVAILABLE`). Không bao giờ gọi bên trong transaction DB.
 */
export interface TingeeClient {
  /**
   * `POST /v1/get-va-paging`: các tài khoản `status: active` của BTC, bỏ tài khoản chỉ chi (`transactionType: debit`).
   * Cũng là cách kiểm key: key sai → `TINGEE_CREDENTIAL_INVALID`.
   */
  listAccounts(credential: TingeeCredential): Promise<TingeeAccount[]>;
}

export interface TingeeClientOptions {
  /** Origin, vd. `https://uat-open-api.tingee.vn`. */
  baseUrl: string;
  timeoutMs?: number;
  now?: () => Date;
}

const Envelope = z.object({ code: z.coerce.string(), message: z.string().nullish(), data: z.unknown().optional() });
const Page = z.object({ items: z.array(z.unknown()), totalCount: z.unknown().optional() });
/** Chuỗi không rỗng; số (vd. `bankBin` dạng số) đổi sang chuỗi. Không dùng `z.coerce.string()`: `null` sẽ thành "null". */
const Text = z.union([z.string().trim().min(1), z.number().int().nonnegative().transform(String)]);
/** `shopId` không bắt buộc: giá trị lạ thì coi như không có, không bỏ cả dòng. */
const OptionalId = z.unknown().transform((v): number | null => {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v)) return Number(v);
  return null;
});
const AccountItem = z.object({
  vaAccountNumber: Text,
  accountNumber: Text,
  bankBin: Text,
  bankName: Text,
  accountType: Text,
  accountName: Text,
  status: Text,
  transactionType: z.string().nullish(),
  shopId: OptionalId,
});

/** Lỗi miền kèm thông điệp hành động được. */
export function tingeeError(code: TingeeDomainError, cause?: unknown): AppError {
  return new AppError(code, DOMAIN_ERROR_MESSAGES[code], { cause });
}

/** Lỗi không mang dữ liệu request (header có Client ID, chữ ký): an toàn để log làm `cause`. */
class TingeeTransportError extends Error {
  override readonly name = 'TingeeTransportError';
}

/** `TingeeClient` qua HTTP: ký HMAC-SHA512, timeout bằng `AbortSignal.timeout`, đổi mã lỗi Tingee sang lỗi miền. */
export class HttpTingeeClient implements TingeeClient {
  private readonly logger = new Logger('Tingee');
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: TingeeClientOptions) {
    this.timeoutMs = options.timeoutMs ?? TINGEE_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  async listAccounts(credential: TingeeCredential): Promise<TingeeAccount[]> {
    const path = '/v1/get-va-paging';
    // Gọi một lần, không phân trang; không lọc qua body (lọc ở dưới), không truyền chuỗi rỗng, không gửi `merchantId`.
    const data = await this.post(credential, path, { skipCount: 0, maxResultCount: TINGEE_ACCOUNT_PAGE_SIZE });
    const page = Page.safeParse(data);
    if (!page.success) {
      this.logger.warn({ path }, 'Tingee trả dữ liệu không đúng dạng');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: dữ liệu sai dạng`));
    }

    const accounts: TingeeAccount[] = [];
    let skipped = 0;
    for (const raw of page.data.items) {
      const item = AccountItem.safeParse(raw);
      if (!item.success) {
        skipped += 1;
        continue;
      }
      const row = item.data;
      if (row.status.toLowerCase() !== 'active' || row.transactionType?.trim().toLowerCase() === 'debit') continue;
      accounts.push({
        vaAccountNumber: row.vaAccountNumber,
        bankBin: row.bankBin,
        bankName: row.bankName,
        accountType: row.accountType,
        accountLast4: row.accountNumber.slice(-4),
        accountName: row.accountName,
        shopId: row.shopId,
      });
    }
    // Chỉ log số dòng, không bao giờ log nội dung dòng (có số tài khoản).
    if (skipped > 0) this.logger.warn({ path, skipped }, 'Bỏ dòng tài khoản Tingee sai dạng');
    const total = Number(page.data.totalCount);
    if (Number.isFinite(total) && total > page.data.items.length) {
      this.logger.warn({ path, totalCount: total, received: page.data.items.length }, 'Danh sách tài khoản Tingee bị cắt');
    }
    return accounts;
  }

  /** Gửi một request ký bằng credential của BTC; trả `data` khi `code === '00'`, không thì ném lỗi miền. */
  private async post(credential: TingeeCredential, path: string, payload: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify(payload);
    const timestamp = tingeeTimestamp(this.now());
    let response: Response;
    try {
      response = await fetch(new URL(path, this.options.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-client-id': credential.clientId,
          'x-request-timestamp': timestamp,
          'x-signature': sign(timestamp, body, credential.secretToken),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network';
      this.logger.warn({ path, reason }, 'Không gọi được Tingee');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: ${reason}`));
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'invalid_json';
      this.logger.warn({ path, httpStatus: response.status, reason }, 'Phản hồi Tingee không đọc được');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: ${reason}`));
    }
    const envelope = Envelope.safeParse(json);
    // Mã đã biết (key sai, merchant bị khóa) vẫn là lỗi miền dù Tingee kèm HTTP 4xx; còn lại HTTP lỗi là Tingee tạm lỗi.
    const known = envelope.success && TINGEE_ERROR_CODES.has(envelope.data.code);
    if (!envelope.success || (!response.ok && !known)) {
      this.logger.warn({ path, httpStatus: response.status }, 'Tingee trả lỗi HTTP');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: HTTP ${response.status}`));
    }
    const { code } = envelope.data;
    if (code === '00') return envelope.data.data;
    const domain = domainErrorOf(code);
    // Chỉ log mã Tingee, không log `message` (có thể lặp lại dữ liệu người dùng).
    this.logger.warn({ path, tingeeCode: code, domainCode: domain }, 'Tingee từ chối request');
    throw tingeeError(domain, new TingeeTransportError(`${path}: Tingee code ${code}`));
  }
}
