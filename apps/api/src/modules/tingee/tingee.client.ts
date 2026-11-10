import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import { z } from 'zod';
import { AppError } from '../../platform/http/index.js';
import { DOMAIN_ERROR_MESSAGES, domainErrorOf, TINGEE_ERROR_CODES, type TingeeDomainError } from './errors.js';
import { gatewayTimestamp, sign, tingeeTimestamp } from './signing.js';

/** Token DI của `TingeeClient`; test thay bằng client trỏ vào Tingee fake. */
export const TINGEE_CLIENT = Symbol('TINGEE_CLIENT');

/** Timeout mỗi lời gọi Tingee (API Tài khoản & Định danh). */
export const TINGEE_TIMEOUT_MS = 15_000;

/** Timeout của `create-link` (Story 3.4): Người mua đang chờ ở Checkout, API phải trả trong khoảng 6 giây. */
export const TINGEE_PAYMENT_LINK_TIMEOUT_MS = 5_000;

/** Số dòng tối đa đọc trong một lần `get-va-paging` (Tingee cho tối đa 2000; một BTC nhiều hơn chừng này là bất thường). */
export const TINGEE_ACCOUNT_PAGE_SIZE = 200;

/** Đường dẫn `create-link` của Cổng thanh toán (`developers.tingee.vn/docs/payment-gateway/create-payment-link`). */
export const TINGEE_CREATE_LINK_PATH = '/v1/payment-gateway/create-link';

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
 * Một link thanh toán Gateway cho một Đơn (`create-link`). `requestId` do adapter sinh mới (uuid v4) mỗi lần gọi; không
 * gửi `merchantId` (key của merchant) hay `customerEmail`.
 */
export interface PaymentLinkInput {
  /** Mã Đơn (`orderId` của Tingee, IPN trả lại đúng mã này). */
  orderId: string;
  /** Số tiền (đồng), đúng `total_amount` của Đơn. */
  amount: number;
  /** VA của tài khoản nhận tiền. */
  vaAccountNumber: string;
  expireInMinute: number;
  /** Trang Đơn trên web, nơi Tingee đưa Người mua quay về. */
  returnUrl: string;
  description: string;
}

/** Kết quả mơ hồ của `create-link`: không biết Tingee đã tạo link hay chưa. */
export type CreateLinkAmbiguousReason = 'timeout' | 'network' | 'http_status' | 'invalid_json' | 'invalid_response';

/**
 * Lỗi của `createPaymentLink`, phân hai loại (Story 3.4; chỉ `tingee` biết mã Tingee):
 * - `rejected`: Tingee trả JSON (HTTP 200) có `code` (chuỗi hoặc số) khác `'00'`: chắc chắn chưa có link. `code` là lỗi
 *   miền theo bảng mã (`TINGEE_CREDENTIAL_INVALID`, `MERCHANT_SUSPENDED`, `PAYMENT_ACCOUNT_NOT_ALLOWED`, mã lạ →
 *   `PAYMENT_PROVIDER_UNAVAILABLE`), `tingeeCode` là mã gốc (chỉ để log).
 * - `ambiguous`: timeout, lỗi mạng, HTTP ≠ 200, JSON hỏng, `code` thiếu/không phải chuỗi hay số, hoặc `'00'` mà `data`
 *   không phải URL http/https: có thể Tingee đã tạo link. Không được gọi lại cùng `orderId`. `code` luôn là
 *   `PAYMENT_PROVIDER_UNAVAILABLE`; `httpStatus` và `tingeeCode` (mã gốc trong body, nếu đọc được) chỉ để log.
 */
export class CreateLinkError extends AppError {
  override readonly name = 'CreateLinkError';

  private constructor(
    readonly outcome: 'rejected' | 'ambiguous',
    code: TingeeDomainError,
    readonly tingeeCode: string | null,
    readonly reason: CreateLinkAmbiguousReason | null,
    /** HTTP status của phản hồi; không nhận được phản hồi (timeout, lỗi mạng) → `null`. */
    readonly httpStatus: number | null,
    cause: unknown,
  ) {
    super(code, DOMAIN_ERROR_MESSAGES[code], { cause });
  }

  /** Tingee từ chối (HTTP 200) bằng mã `tingeeCode` (khác `'00'`). */
  static rejected(tingeeCode: string): CreateLinkError {
    const cause = new TingeeTransportError(`${TINGEE_CREATE_LINK_PATH}: Tingee code ${tingeeCode}`);
    return new CreateLinkError('rejected', domainErrorOf(tingeeCode), tingeeCode, null, 200, cause);
  }

  /** Không biết Tingee đã tạo link hay chưa; kèm HTTP status và mã gốc nếu có (để log). */
  static ambiguous(
    reason: CreateLinkAmbiguousReason,
    { httpStatus = null, tingeeCode = null }: { httpStatus?: number | null; tingeeCode?: string | null } = {},
  ): CreateLinkError {
    const detail = [reason, httpStatus === null ? null : `HTTP ${httpStatus}`, tingeeCode === null ? null : `code ${tingeeCode}`]
      .filter((part) => part !== null)
      .join(', ');
    const cause = new TingeeTransportError(`${TINGEE_CREATE_LINK_PATH}: ${detail}`);
    return new CreateLinkError('ambiguous', ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, tingeeCode, reason, httpStatus, cause);
  }
}

/**
 * Cổng gọi Tingee (AD-5, AD-9): chỉ mô-đun `tingee` biết tên trường, host và mã lỗi Tingee. Mọi lời gọi nhận credential
 * của một BTC làm tham số và không gửi `merchantId`. Lỗi luôn là `AppError` với mã miền (`TINGEE_CREDENTIAL_INVALID`,
 * `MERCHANT_SUSPENDED`, `PAYMENT_ACCOUNT_NOT_ALLOWED`, `PAYMENT_PROVIDER_UNAVAILABLE`). Không bao giờ gọi bên trong
 * transaction DB.
 */
export interface TingeeClient {
  /**
   * `POST /v1/get-va-paging`: các tài khoản `status: active` của BTC, bỏ tài khoản chỉ chi (`transactionType: debit`).
   * Cũng là cách kiểm key: key sai → `TINGEE_CREDENTIAL_INVALID`.
   */
  listAccounts(credential: TingeeCredential): Promise<TingeeAccount[]>;
  /**
   * `POST /v1/payment-gateway/create-link` (Story 3.4): checkout URL (`data`) khi `code = '00'`. Timestamp UNIX ms,
   * timeout `TINGEE_PAYMENT_LINK_TIMEOUT_MS`. Lỗi luôn là `CreateLinkError` (`rejected` / `ambiguous`).
   */
  createPaymentLink(credential: TingeeCredential, input: PaymentLinkInput): Promise<string>;
}

export interface TingeeClientOptions {
  /** Origin, vd. `https://uat-open-api.tingee.vn`. */
  baseUrl: string;
  timeoutMs?: number;
  /** Timeout của `create-link`; mặc định `TINGEE_PAYMENT_LINK_TIMEOUT_MS`. */
  paymentLinkTimeoutMs?: number;
  now?: () => Date;
}

const Envelope = z.object({ code: z.coerce.string(), message: z.string().nullish(), data: z.unknown().optional() });
type Envelope = z.infer<typeof Envelope>;
/**
 * Mã của phản hồi `create-link`: chỉ chuỗi không rỗng hoặc số (không ép kiểu: `null` hay thiếu `code` không bao giờ thành
 * một mã "từ chối" để trả lượt rồi gọi lại cùng `orderId`).
 */
const LinkCode = z.union([z.string().trim().min(1), z.number().int()]).transform(String);
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
/** Checkout URL: chỉ http/https (web mở bằng `window.location.assign`, không bao giờ nhận `javascript:`). */
const CheckoutUrl = z.url({ protocol: /^https?$/ });

/** Lỗi miền kèm thông điệp hành động được. */
export function tingeeError(code: TingeeDomainError, cause?: unknown): AppError {
  return new AppError(code, DOMAIN_ERROR_MESSAGES[code], { cause });
}

/** Lỗi không mang dữ liệu request (header có Client ID, chữ ký): an toàn để log làm `cause`. */
class TingeeTransportError extends Error {
  override readonly name = 'TingeeTransportError';
}

/** Một lần gửi: không tới được Tingee / không đọc được phản hồi, hoặc phản hồi đọc được (envelope có thể sai dạng). */
type Sent =
  | { kind: 'failed'; reason: 'timeout' | 'network' | 'invalid_json'; httpStatus: number | null }
  | { kind: 'replied'; httpStatus: number; envelope: Envelope | null; json: unknown };

/** `TingeeClient` qua HTTP: ký HMAC-SHA512, timeout bằng `AbortSignal.timeout`, đổi mã lỗi Tingee sang lỗi miền. */
export class HttpTingeeClient implements TingeeClient {
  private readonly logger = new Logger('Tingee');
  private readonly timeoutMs: number;
  private readonly paymentLinkTimeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: TingeeClientOptions) {
    this.timeoutMs = options.timeoutMs ?? TINGEE_TIMEOUT_MS;
    this.paymentLinkTimeoutMs = options.paymentLinkTimeoutMs ?? TINGEE_PAYMENT_LINK_TIMEOUT_MS;
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

  /**
   * Ghi chú: không log ở đây (người gọi log kèm BTC và mã Đơn); không bao giờ log checkout URL hay body (có VA).
   */
  async createPaymentLink(credential: TingeeCredential, input: PaymentLinkInput): Promise<string> {
    // Đúng thứ tự trường của tài liệu; chỉ các trường dùng tới, không có trường rỗng.
    const payload = {
      requestId: randomUUID(),
      orderId: input.orderId,
      amount: input.amount,
      vaAccountNumber: input.vaAccountNumber,
      expireInMinute: input.expireInMinute,
      returnUrl: input.returnUrl,
      description: input.description,
    };
    const sent = await this.send(credential, TINGEE_CREATE_LINK_PATH, payload, {
      timestamp: gatewayTimestamp,
      timeoutMs: this.paymentLinkTimeoutMs,
    });
    if (sent.kind === 'failed') throw CreateLinkError.ambiguous(sent.reason, { httpStatus: sent.httpStatus });
    const { httpStatus, json } = sent;
    const rawCode = typeof json === 'object' && json !== null ? (json as { code?: unknown }).code : undefined;
    const code = LinkCode.safeParse(rawCode);
    const tingeeCode = code.success ? code.data : null;
    // HTTP ≠ 200 (kể cả khi body có mã lỗi): không chắc Tingee chưa tạo link.
    if (httpStatus !== 200) throw CreateLinkError.ambiguous('http_status', { httpStatus, tingeeCode });
    if (tingeeCode === null) throw CreateLinkError.ambiguous('invalid_response', { httpStatus });
    if (tingeeCode !== '00') throw CreateLinkError.rejected(tingeeCode);
    const url = CheckoutUrl.safeParse((json as { data?: unknown }).data);
    if (!url.success) throw CreateLinkError.ambiguous('invalid_response', { httpStatus, tingeeCode });
    return url.data;
  }

  /** Gửi một request ký bằng credential của BTC; trả `data` khi `code === '00'`, không thì ném lỗi miền. */
  private async post(credential: TingeeCredential, path: string, payload: Record<string, unknown>): Promise<unknown> {
    const sent = await this.send(credential, path, payload, { timestamp: tingeeTimestamp, timeoutMs: this.timeoutMs });
    if (sent.kind === 'failed') {
      if (sent.httpStatus === null) this.logger.warn({ path, reason: sent.reason }, 'Không gọi được Tingee');
      else this.logger.warn({ path, httpStatus: sent.httpStatus, reason: sent.reason }, 'Phản hồi Tingee không đọc được');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: ${sent.reason}`));
    }
    const { envelope, httpStatus } = sent;
    // Mã đã biết (key sai, merchant bị khóa) vẫn là lỗi miền dù Tingee kèm HTTP 4xx; còn lại HTTP lỗi là Tingee tạm lỗi.
    const known = envelope !== null && TINGEE_ERROR_CODES.has(envelope.code);
    const ok = httpStatus >= 200 && httpStatus < 300;
    if (!envelope || (!ok && !known)) {
      this.logger.warn({ path, httpStatus }, 'Tingee trả lỗi HTTP');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: HTTP ${httpStatus}`));
    }
    const { code } = envelope;
    if (code === '00') return envelope.data;
    const domain = domainErrorOf(code);
    // Chỉ log mã Tingee, không log `message` (có thể lặp lại dữ liệu người dùng).
    this.logger.warn({ path, tingeeCode: code, domainCode: domain }, 'Tingee từ chối request');
    throw tingeeError(domain, new TingeeTransportError(`${path}: Tingee code ${code}`));
  }

  /**
   * Ký và gửi `payload` (JSON minify, đúng chuỗi được ký) bằng credential của BTC. `timestamp` theo nhóm API (Gateway:
   * UNIX ms; Tài khoản & Định danh: `yyyyMMddHHmmssSSS`). Không ném: trả lỗi vận chuyển hoặc phản hồi đọc được.
   */
  private async send(
    credential: TingeeCredential,
    path: string,
    payload: Record<string, unknown>,
    { timestamp: format, timeoutMs }: { timestamp: (now: Date) => string; timeoutMs: number },
  ): Promise<Sent> {
    const body = JSON.stringify(payload);
    const timestamp = format(this.now());
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
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network';
      return { kind: 'failed', reason, httpStatus: null };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'invalid_json';
      return { kind: 'failed', reason, httpStatus: response.status };
    }
    const envelope = Envelope.safeParse(json);
    return { kind: 'replied', httpStatus: response.status, envelope: envelope.success ? envelope.data : null, json };
  }
}
