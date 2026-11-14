import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ErrorCode, PaymentServiceReason } from '@tickee/contracts';
import { z } from 'zod';
import { AppError } from '../../platform/http/index.js';
import {
  createLinkServiceReasonOf,
  DOMAIN_ERROR_MESSAGES,
  domainErrorOf,
  paymentServiceReasonOf,
  TINGEE_ERROR_CODES,
  TINGEE_ORDER_NOT_FOUND_CODE,
  type TingeeDomainError,
} from './errors.js';
import { sign, tingeeTimestamp } from './signing.js';

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
 * Đường dẫn tra đơn Gateway theo `orderId` (Đối soát bù, Story 4.1). Hợp đồng tạm: Tingee chưa công bố API này (tài liệu
 * công khai đọc ngày 13/11/2026 chỉ có `create-link`). Khi Tingee xác nhận, chỉ sửa file này và Tingee fake.
 */
export const TINGEE_GET_ORDER_PATH = '/v1/payment-gateway/get-order';

/** Timeout của lời gọi tra đơn Gateway: worker tra tuần tự, một Đơn chậm không được giữ cả lô. */
export const TINGEE_ORDER_STATUS_TIMEOUT_MS = 5_000;

/** `get-va-paging`: danh sách tài khoản (VA) của BTC; cũng là lời gọi dò dịch vụ (hợp đồng tạm của Story 4.2). */
export const TINGEE_ACCOUNTS_PATH = '/v1/get-va-paging';

/**
 * Timeout của lời gọi dò dịch vụ thanh toán (Story 4.2): Owner bấm "Kiểm tra lại" chờ kết quả, job dò tuần tự qua các BTC.
 */
export const TINGEE_SERVICE_STATUS_TIMEOUT_MS = 5_000;

/**
 * Kết quả dò dịch vụ thanh toán của BTC bằng key hiện hành (Story 4.2, AD-32): `active` (Tingee nhận key, dịch vụ hoạt
 * động), `suspended` kèm lý do theo mã Tingee (`paymentServiceReasonOf`), hoặc `unknown` (Tingee tạm lỗi, timeout, lỗi
 * mạng, phản hồi không đọc được, mã khác): không kết luận được, bên gọi giữ nguyên cờ.
 */
export type MerchantServiceStatus =
  | { status: 'active' }
  | { status: 'suspended'; reason: PaymentServiceReason }
  | { status: 'unknown' };

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
 *   `PAYMENT_PROVIDER_UNAVAILABLE`), `tingeeCode` là mã gốc (chỉ để log), `serviceReason` là lý do ngắt dịch vụ thanh
 *   toán của BTC theo mã (`createLinkServiceReasonOf`, Story 4.2; nhóm VA → `payout_account_not_allowed`, Story 4.2-d),
 *   `null` khi mã không phải ngắt dịch vụ (mã lạ, lệch giờ).
 * - `ambiguous`: timeout, lỗi mạng, HTTP ≠ 200, JSON hỏng, `code` thiếu/không phải chuỗi hay số, hoặc `'00'` mà `data`
 *   không phải URL http/https: có thể Tingee đã tạo link. Không được gọi lại cùng `orderId`. `code` luôn là
 *   `PAYMENT_PROVIDER_UNAVAILABLE`; `httpStatus` và `tingeeCode` (mã gốc trong body, nếu đọc được) chỉ để log;
 *   `serviceReason` luôn `null`.
 */
export class CreateLinkError extends AppError {
  override readonly name = 'CreateLinkError';
  /** Lý do ngắt dịch vụ thanh toán của BTC theo mã Tingee (chỉ khi `rejected`); `null`: không phải ngắt dịch vụ. */
  readonly serviceReason: PaymentServiceReason | null;

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
    this.serviceReason = outcome === 'rejected' && tingeeCode !== null ? createLinkServiceReasonOf(tingeeCode) : null;
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
   * `POST /v1/payment-gateway/create-link` (Story 3.4): checkout URL (`data`) khi `code = '00'`. Timestamp
   * `yyyyMMddHHmmssSSS` như mọi API Tingee (Tingee production trả 90 cho UNIX ms, dù trang tài liệu ghi UNIX ms), timeout
   * `TINGEE_PAYMENT_LINK_TIMEOUT_MS`. Lỗi luôn là `CreateLinkError` (`rejected` / `ambiguous`).
   */
  createPaymentLink(credential: TingeeCredential, input: PaymentLinkInput): Promise<string>;
  /**
   * Tra trạng thái đơn Gateway theo `orderId` (mã Đơn) (Story 4.1, hợp đồng tạm `TINGEE_GET_ORDER_PATH`, body
   * `{ requestId: uuid v4, orderId }`): `data` của phản hồi khi `code = '00'` (chưa kiểm dạng: bên gọi đưa qua whitelist
   * IPN), `null` khi Tingee không tìm thấy đơn (`TINGEE_ORDER_NOT_FOUND_CODE`). Còn lại ném lỗi miền như `listAccounts`
   * (key sai → `TINGEE_CREDENTIAL_INVALID`; timeout `TINGEE_ORDER_STATUS_TIMEOUT_MS`, lỗi mạng, HTTP lỗi, mã lạ →
   * `PAYMENT_PROVIDER_UNAVAILABLE`…). Chỉ đọc, gọi lại bao nhiêu lần cũng được.
   */
  getGatewayOrder(credential: TingeeCredential, orderId: string): Promise<unknown | null>;
  /**
   * Dò dịch vụ thanh toán của BTC bằng key `credential` (Story 4.2, AD-32). Hợp đồng tạm (quyết định 13/11/2026): Tingee
   * chưa có API trạng thái dịch vụ gọi bằng key merchant, nên gọi `get-va-paging` (`TINGEE_ACCOUNTS_PATH`, 1 dòng):
   * `'00'` → `active`; 1033 → `token`; 1007/1034 → `tingee_disabled`; mọi mã `TINGEE_CREDENTIAL_INVALID` (kể cả 1133:
   * `get-va-paging` không thuộc nhóm "Cổng thanh toán", nên 1133 ở đây nghĩa là key không còn dùng được) →
   * `credential_invalid`;
   * còn lại (timeout `TINGEE_SERVICE_STATUS_TIMEOUT_MS`, lỗi mạng, HTTP lỗi với mã lạ, phản hồi không đọc được, mã khác)
   * → `unknown`. Không bao giờ ném. Có API thật thì chỉ sửa hàm này và Tingee fake.
   */
  getMerchantServiceStatus(credential: TingeeCredential): Promise<MerchantServiceStatus>;
}

export interface TingeeClientOptions {
  /** Origin, vd. `https://uat-open-api.tingee.vn`. */
  baseUrl: string;
  timeoutMs?: number;
  /** Timeout của `create-link`; mặc định `TINGEE_PAYMENT_LINK_TIMEOUT_MS`. */
  paymentLinkTimeoutMs?: number;
  /** Timeout của tra đơn Gateway; mặc định `TINGEE_ORDER_STATUS_TIMEOUT_MS`. */
  orderStatusTimeoutMs?: number;
  /** Timeout của lời gọi dò dịch vụ thanh toán; mặc định `TINGEE_SERVICE_STATUS_TIMEOUT_MS`. */
  serviceStatusTimeoutMs?: number;
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
  private readonly orderStatusTimeoutMs: number;
  private readonly serviceStatusTimeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: TingeeClientOptions) {
    this.timeoutMs = options.timeoutMs ?? TINGEE_TIMEOUT_MS;
    this.paymentLinkTimeoutMs = options.paymentLinkTimeoutMs ?? TINGEE_PAYMENT_LINK_TIMEOUT_MS;
    this.orderStatusTimeoutMs = options.orderStatusTimeoutMs ?? TINGEE_ORDER_STATUS_TIMEOUT_MS;
    this.serviceStatusTimeoutMs = options.serviceStatusTimeoutMs ?? TINGEE_SERVICE_STATUS_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  async listAccounts(credential: TingeeCredential): Promise<TingeeAccount[]> {
    const path = TINGEE_ACCOUNTS_PATH;
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
    const sent = await this.send(credential, TINGEE_CREATE_LINK_PATH, payload, this.paymentLinkTimeoutMs);
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

  /**
   * Hợp đồng tạm (Story 4.1): `{ requestId, orderId }`, không `merchantId`. Không log ở đây ngoài mã Tingee (người gọi log
   * kèm BTC và mã Đơn); không bao giờ log `data` hay body.
   */
  async getGatewayOrder(credential: TingeeCredential, orderId: string): Promise<unknown | null> {
    const path = TINGEE_GET_ORDER_PATH;
    const envelope = await this.reply(credential, path, { requestId: randomUUID(), orderId }, this.orderStatusTimeoutMs, [
      TINGEE_ORDER_NOT_FOUND_CODE,
    ]);
    if (envelope.code === TINGEE_ORDER_NOT_FOUND_CODE) return null;
    return this.dataOf(path, envelope);
  }

  /**
   * Hợp đồng tạm (Story 4.2): `get-va-paging` một dòng bằng key hiện hành. Chỉ log đường dẫn, mã Tingee và loại lỗi; không
   * bao giờ log credential, `message` hay `data`.
   */
  async getMerchantServiceStatus(credential: TingeeCredential): Promise<MerchantServiceStatus> {
    const path = TINGEE_ACCOUNTS_PATH;
    const sent = await this.send(credential, path, { skipCount: 0, maxResultCount: 1 }, this.serviceStatusTimeoutMs);
    if (sent.kind === 'failed') {
      this.logger.warn({ path, reason: sent.reason, httpStatus: sent.httpStatus }, 'Dò dịch vụ: không gọi được Tingee');
      return { status: 'unknown' };
    }
    const { envelope, httpStatus } = sent;
    if (!envelope) {
      this.logger.warn({ path, httpStatus }, 'Dò dịch vụ: phản hồi Tingee không đúng dạng');
      return { status: 'unknown' };
    }
    const ok = httpStatus >= 200 && httpStatus < 300;
    if (envelope.code === '00') {
      if (ok) return { status: 'active' };
      this.logger.warn({ path, httpStatus }, 'Dò dịch vụ: Tingee trả 00 kèm HTTP lỗi');
      return { status: 'unknown' };
    }
    // Mã ngắt dịch vụ vẫn là kết luận dù Tingee kèm HTTP 4xx (như lỗi miền của `reply`). Ánh xạ 1133 →
    // `gateway_permission_missing` chỉ dành cho `create-link`.
    const reason =
      domainErrorOf(envelope.code) === ErrorCode.TINGEE_CREDENTIAL_INVALID
        ? PaymentServiceReason.CREDENTIAL_INVALID
        : paymentServiceReasonOf(envelope.code);
    this.logger.warn({ path, httpStatus, tingeeCode: envelope.code, serviceReason: reason }, 'Dò dịch vụ: Tingee từ chối');
    return reason ? { status: 'suspended', reason } : { status: 'unknown' };
  }

  /** Gửi một request ký bằng credential của BTC; trả `data` khi `code === '00'`, không thì ném lỗi miền. */
  private async post(credential: TingeeCredential, path: string, payload: Record<string, unknown>): Promise<unknown> {
    return this.dataOf(path, await this.reply(credential, path, payload, this.timeoutMs));
  }

  /**
   * Gửi một request ký bằng credential của BTC; trả envelope khi Tingee trả lời được: HTTP 2xx, hoặc mã đã biết (bảng mã,
   * và `extraKnownCodes` của người gọi) kèm HTTP lỗi. Không tới được, phản hồi không đọc được, HTTP lỗi với mã lạ → ném
   * `PAYMENT_PROVIDER_UNAVAILABLE`.
   */
  private async reply(
    credential: TingeeCredential,
    path: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
    extraKnownCodes: readonly string[] = [],
  ): Promise<Envelope> {
    const sent = await this.send(credential, path, payload, timeoutMs);
    if (sent.kind === 'failed') {
      if (sent.httpStatus === null) this.logger.warn({ path, reason: sent.reason }, 'Không gọi được Tingee');
      else this.logger.warn({ path, httpStatus: sent.httpStatus, reason: sent.reason }, 'Phản hồi Tingee không đọc được');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: ${sent.reason}`));
    }
    const { envelope, httpStatus } = sent;
    // Mã đã biết (key sai, merchant bị khóa) vẫn là lỗi miền dù Tingee kèm HTTP 4xx; còn lại HTTP lỗi là Tingee tạm lỗi.
    const known =
      envelope !== null && (TINGEE_ERROR_CODES.has(envelope.code) || extraKnownCodes.includes(envelope.code));
    const ok = httpStatus >= 200 && httpStatus < 300;
    if (!envelope || (!ok && !known)) {
      this.logger.warn({ path, httpStatus }, 'Tingee trả lỗi HTTP');
      throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: HTTP ${httpStatus}`));
    }
    return envelope;
  }

  /** `data` của envelope khi `code === '00'`; mã khác → ném lỗi miền theo bảng mã. */
  private dataOf(path: string, envelope: Envelope): unknown {
    const { code } = envelope;
    if (code === '00') return envelope.data;
    const domain = domainErrorOf(code);
    // Chỉ log mã Tingee, không log `message` (có thể lặp lại dữ liệu người dùng).
    this.logger.warn({ path, tingeeCode: code, domainCode: domain }, 'Tingee từ chối request');
    throw tingeeError(domain, new TingeeTransportError(`${path}: Tingee code ${code}`));
  }

  /**
   * Ký và gửi `payload` (JSON minify, đúng chuỗi được ký) bằng credential của BTC, timestamp `yyyyMMddHHmmssSSS` (mọi
   * API Tingee, kể cả Cổng thanh toán). Không ném: trả lỗi vận chuyển hoặc phản hồi đọc được.
   */
  private async send(
    credential: TingeeCredential,
    path: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Sent> {
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
