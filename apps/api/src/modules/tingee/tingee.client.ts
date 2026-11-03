import { Logger } from '@nestjs/common';
import { ErrorCode } from '@tickee/contracts';
import { z } from 'zod';
import { AppError } from '../../platform/http/index.js';
import { DOMAIN_ERROR_INFO, domainErrorOf, type TingeeDomainError } from './errors.js';
import { sign, tingeeTimestamp } from './signing.js';

/** Token DI của `TingeeClient`; test thay bằng client trỏ vào Tingee fake. */
export const TINGEE_CLIENT = Symbol('TINGEE_CLIENT');

/** Timeout mỗi lời gọi Tingee. */
export const TINGEE_TIMEOUT_MS = 15_000;

export interface CreateMerchantInput {
  /** Tên BTC. */
  name: string;
  /** SĐT đăng ký Merchant con (10 số, bắt đầu bằng 0). */
  phone: string;
}

export interface CreateVaInput {
  merchantId: number;
  bankBin: string;
  accountType: 'personal-account';
  accountNumber: string;
  /** In hoa, không dấu. */
  accountName: string;
  identityNumber: string;
  phone: string;
}

/** Tài khoản đã liên kết: số VA nhận tiền Tingee cấp. */
export interface LinkedVa {
  vaAccountNumber: string;
  shopId: number | null;
}

export type CreateVaResult = ({ kind: 'linked' } & LinkedVa) | { kind: 'otp_required'; confirmId: string };

export interface ConfirmVaInput {
  merchantId: number;
  bankBin: string;
  confirmId: string;
  otp: string;
}

/**
 * Cổng gọi Tingee (AD-5, AD-9): chỉ mô-đun `tingee` biết tên trường, host và mã lỗi Tingee. Lỗi luôn là `AppError` với
 * mã miền (`PAYOUT_ACCOUNT_INVALID`, `BANK_NOT_SUPPORTED`, … `PAYMENT_PROVIDER_UNAVAILABLE`). Không bao giờ gọi bên trong
 * transaction DB.
 */
export interface TingeeClient {
  /** `POST /v1/merchant/create`: tạo Merchant con cho một BTC. */
  createMerchant(input: CreateMerchantInput): Promise<{ merchantId: number }>;
  /** `POST /v1/create-va`: liên kết ngay hoặc cần OTP ngân hàng (`confirmId`). */
  createVa(input: CreateVaInput): Promise<CreateVaResult>;
  /** `POST /v1/confirm-va`: xác nhận OTP ngân hàng. */
  confirmVa(input: ConfirmVaInput): Promise<LinkedVa>;
}

export interface TingeeClientOptions {
  /** Origin, vd. `https://uat-open-api.tingee.vn`. */
  baseUrl: string;
  clientId: string;
  /** Không bao giờ log. */
  secretToken: string;
  timeoutMs?: number;
  now?: () => Date;
}

const Envelope = z.object({ code: z.coerce.string(), message: z.string().nullish(), data: z.unknown().optional() });
const Id = z.coerce.number().int().positive();
const MerchantData = z.object({ merchantId: Id });
// `create-va` liên kết ngay trả thêm `merchantAccountNumberId`; `confirm-va` thì không — chỉ dựa vào hai trường chung.
// Không dùng `z.coerce.string()`: `null` sẽ thành chuỗi "null". Số VA dạng số thì đổi sang chuỗi.
const LinkedData = z.object({
  vaAccountNumber: z.union([z.string().min(1), z.number().int().nonnegative().transform(String)]),
  shopId: Id.nullish(),
});
const ConfirmData = z.object({ confirmId: z.string().min(1) });

/** Lỗi miền kèm thông điệp hành động được; `details.field` là trường nghi sai nếu biết. */
export function tingeeError(code: TingeeDomainError, cause?: unknown): AppError {
  const info = DOMAIN_ERROR_INFO[code];
  return new AppError(code, info.message, { details: info.field ? { field: info.field } : null, cause });
}

/** Lỗi không mang dữ liệu request (body có số tài khoản, CCCD): an toàn để log làm `cause`. */
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

  async createMerchant(input: CreateMerchantInput): Promise<{ merchantId: number }> {
    // SĐT đã có trên Tingee thì Tingee gắn Merchant sẵn có vào Master thay vì tạo mới (vẫn trả `merchantId`).
    const data = await this.post('/v1/merchant/create', { name: input.name, phoneNumber: input.phone });
    return this.parse('/v1/merchant/create', MerchantData, data);
  }

  async createVa(input: CreateVaInput): Promise<CreateVaResult> {
    const data = await this.post('/v1/create-va', {
      merchantId: input.merchantId,
      accountType: input.accountType,
      bankBin: input.bankBin,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      identity: input.identityNumber,
      mobile: input.phone,
      // VA là đường mọi ngân hàng hỗ trợ; Gateway truyền `vaAccountNumber` để nhận tiền đúng chỗ.
      isNotifyAccountNumber: false,
      appType: 'baas',
    });
    const otp = ConfirmData.safeParse(data);
    if (otp.success) return { kind: 'otp_required', confirmId: otp.data.confirmId };
    return { kind: 'linked', ...this.linked('/v1/create-va', data) };
  }

  async confirmVa(input: ConfirmVaInput): Promise<LinkedVa> {
    const data = await this.post('/v1/confirm-va', {
      merchantId: input.merchantId,
      bankBin: input.bankBin,
      confirmId: input.confirmId,
      otpNumber: input.otp,
    });
    return this.linked('/v1/confirm-va', data);
  }

  private linked(path: string, data: unknown): LinkedVa {
    const parsed = this.parse(path, LinkedData, data);
    return { vaAccountNumber: parsed.vaAccountNumber, shopId: parsed.shopId ?? null };
  }

  private parse<S extends z.ZodType>(path: string, schema: S, data: unknown): z.output<S> {
    const parsed = schema.safeParse(data);
    if (parsed.success) return parsed.data;
    this.logger.warn({ path }, 'Tingee trả dữ liệu không đúng dạng');
    throw tingeeError(ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE, new TingeeTransportError(`${path}: dữ liệu sai dạng`));
  }

  /** Gửi một request đã ký; trả `data` khi `code === '00'`, không thì ném lỗi miền. */
  private async post(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify(payload);
    const timestamp = tingeeTimestamp(this.now());
    let response: Response;
    try {
      response = await fetch(new URL(path, this.options.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-client-id': this.options.clientId,
          'x-request-timestamp': timestamp,
          'x-signature': sign(timestamp, body, this.options.secretToken),
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
    if (!response.ok || !envelope.success) {
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
