import type { IncomingMessage } from 'node:http';
import { Controller, HttpCode, Inject, Logger, Param, Post, Req } from '@nestjs/common';
import { ErrorCode, ORDER_CODE_PATTERN, TINGEE_IPN_PATH } from '@tickee/contracts';
import type { SecretBox } from '../../platform/crypto/index.js';
import { DATABASE, type Database } from '../../platform/db/index.js';
import { AppError, Public } from '../../platform/http/index.js';
import { orderForPayment } from '../ordering/index.js';
import { ipnRecipientOf, payoutAccountCredentialOf, type IpnCredential } from '../organizer/index.js';
import { parseTingeeTimestamp, verifySignature } from '../tingee/index.js';
import { IpnProcessor, TingeeIpn } from './ipn-processor.js';

/*
 * Endpoint nhận IPN của Tingee (Story 3.5, AD-7): `POST /v1/payments/tingee/ipn/:ipnKey`, `@Public` với guard người
 * dùng. Thứ tự: tra BTC theo `ipnKey` (lạ → 404, chưa đọc byte body nào) → đọc byte thô tối đa 64 KB (parser JSON toàn
 * cục bỏ qua tiền tố `TINGEE_IPN_PATH`) → kiểm `x-request-timestamp` và `x-signature` trên đúng byte nhận được → parse
 * JSON + schema → (chỉ khớp secret của credential đã thay: ràng với Đơn của credential đó) → lõi xử lý (`IpnProcessor`).
 * Không bao giờ log secret, chữ ký, raw body hay `customerEmail`.
 */

/** Token DI của cấu hình IPN. */
export const IPN_SETTINGS = Symbol('IPN_SETTINGS');

export interface IpnSettings {
  /** Giải mã Secret Token Tingee của BTC (khóa `TINGEE_CREDENTIAL_KEYS`). */
  secretBox: SecretBox;
}

/** Body IPN lớn hơn chừng này byte → 413. */
export const IPN_MAX_BODY_BYTES = 64 * 1024;

/** `x-request-timestamp` lệch đồng hồ server quá chừng này (cả hai chiều) → từ chối. */
export const IPN_MAX_SKEW_MS = 10 * 60 * 1000;

/** Phản hồi thành công mà Tingee chờ (kể cả IPN lặp). */
export const IPN_ACK = { code: '00', message: 'Success' } as const;

/** `ipnKey` do `organizer` sinh: base64url 128 bit. Dạng khác không thể có BTC nào → 404 mà không cần tra DB. */
const IPN_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Lý do từ chối chữ ký (chỉ để log). */
export type IpnSignatureRejection =
  | 'timestamp_missing'
  | 'timestamp_invalid'
  | 'timestamp_skew'
  | 'signature_missing'
  | 'no_credential'
  | 'signature_mismatch';

/**
 * Lý do từ chối IPN chỉ khớp secret của credential đã thay mà không ràng được với Đơn của credential đó (chỉ để log):
 * body không đọc được (JSON/schema hỏng), mã sai `ORDER_CODE_PATTERN`, không có Đơn, Đơn thuộc BTC khác, Đơn chưa có
 * link thanh toán, Đơn có link tạo bằng credential khác.
 */
export type RetiredKeyRejection =
  | 'retired_key_unreadable_body'
  | 'retired_key_invalid_order_code'
  | 'retired_key_order_not_found'
  | 'retired_key_other_organization'
  | 'retired_key_order_without_link'
  | 'retired_key_other_credential';

/** Kết quả kiểm chữ ký IPN. */
export type IpnSignatureCheck =
  | { ok: false; reason: IpnSignatureRejection }
  /** Khớp secret của credential hiện hành: có hiệu lực với mọi IPN của BTC. */
  | { ok: true; current: true }
  /**
   * Chỉ khớp secret của credential đã thay: id mọi credential cũ khớp (thường một; nhiều hơn khi BTC từng nhập lại cùng
   * Secret Token). Chỉ có hiệu lực với IPN của Đơn có link tạo bằng một trong các credential này (AD-35).
   */
  | { ok: true; current: false; retiredCredentialIds: string[] };

/**
 * Kiểm `x-request-timestamp` (`yyyyMMddHHmmssSSS` UTC+7, lệch `now` không quá `IPN_MAX_SKEW_MS` theo cả hai chiều) và
 * `x-signature` = HMAC-SHA512(`timestamp:body`). Thử secret của credential hiện hành trước (khớp thì không cần ràng gì
 * thêm), rồi secret của các credential đã thay; trả các credential cũ đã khớp để bên gọi ràng với Đơn.
 */
export function checkIpnSignature(input: {
  timestamp: string | undefined;
  signature: string | undefined;
  body: string;
  credentials: readonly Pick<IpnCredential, 'id' | 'secretToken' | 'current'>[];
  now: number;
}): IpnSignatureCheck {
  const reject = (reason: IpnSignatureRejection) => ({ ok: false, reason }) as const;
  if (!input.timestamp) return reject('timestamp_missing');
  const sent = parseTingeeTimestamp(input.timestamp);
  if (!sent) return reject('timestamp_invalid');
  if (Math.abs(input.now - sent.getTime()) > IPN_MAX_SKEW_MS) return reject('timestamp_skew');
  if (!input.signature) return reject('signature_missing');
  if (input.credentials.length === 0) return reject('no_credential');
  const signature = input.signature.trim().toLowerCase();
  const timestamp = input.timestamp;
  const matches = (credential: Pick<IpnCredential, 'secretToken'>) =>
    verifySignature(timestamp, input.body, credential.secretToken, signature);
  if (input.credentials.some((credential) => credential.current && matches(credential))) return { ok: true, current: true };
  const retiredCredentialIds = input.credentials
    .filter((credential) => !credential.current && matches(credential))
    .map((credential) => credential.id);
  return retiredCredentialIds.length > 0
    ? { ok: true, current: false, retiredCredentialIds }
    : reject('signature_mismatch');
}

/** Body IPN đã parse (JSON + `TingeeIpn`), hoặc lý do hỏng kèm tên trường lỗi (không có giá trị). */
type ParsedIpnBody =
  | { ok: true; ipn: TingeeIpn }
  | { ok: false; reason: 'invalid_json' | 'invalid_payload'; fields: string[] };

function parseIpnBody(body: string): ParsedIpnBody {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'invalid_json', fields: [] };
  }
  const parsed = TingeeIpn.safeParse(json);
  if (parsed.success) return { ok: true, ipn: parsed.data };
  const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || '(body)'))];
  return { ok: false, reason: 'invalid_payload', fields };
}

const tooLarge = () =>
  new AppError(ErrorCode.VALIDATION_FAILED, `Body IPN vượt ${IPN_MAX_BODY_BYTES} byte.`, { status: 413 });

/**
 * Đọc byte thô của request, tối đa `limit` byte: `content-length` lớn hơn → 413 ngay, không đọc; đọc vượt (chunked) →
 * 413, phần còn lại bị bỏ. Body đã bị parser khác đọc mất → ném (lỗi cấu hình: 500).
 */
export function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(tooLarge());
  if (req.readableEnded) return Promise.reject(new Error('Body IPN đã bị đọc trước handler (parser toàn cục?)'));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        cleanup();
        // Bỏ phần còn lại (stream vẫn chảy, không giữ trong bộ nhớ).
        req.resume();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new AppError(ErrorCode.VALIDATION_FAILED, 'Request IPN bị ngắt giữa chừng.'));
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

const headerOf = (req: IncomingMessage, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

@Public()
@Controller(TINGEE_IPN_PATH.replace(/^\/v1\//, ''))
export class TingeeIpnController {
  private readonly logger = new Logger('TingeeIpnController');

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IPN_SETTINGS) private readonly settings: IpnSettings,
    @Inject(IpnProcessor) private readonly processor: IpnProcessor,
  ) {}

  /**
   * `200 {"code":"00","message":"Success"}` khi đã xử lý (kể cả IPN lặp hay nhánh chỉ lưu). `404 NOT_FOUND` `ipnKey` lạ;
   * `413` body > 64 KB; `401 IPN_SIGNATURE_INVALID` timestamp hoặc chữ ký sai, hoặc chỉ khớp secret của credential đã
   * thay mà không ràng được với Đơn có link tạo bằng credential đó (không lưu gì); `400 VALIDATION_FAILED` chữ ký đúng
   * nhưng JSON/schema hỏng (Tingee gửi lại).
   */
  @Post(':ipnKey')
  @HttpCode(200)
  async receive(@Param('ipnKey') ipnKey: string, @Req() req: IncomingMessage): Promise<typeof IPN_ACK> {
    const recipient = IPN_KEY_PATTERN.test(ipnKey)
      ? await ipnRecipientOf(this.db.orm, this.settings.secretBox, ipnKey)
      : null;
    if (!recipient) {
      this.logger.warn({ reason: 'unknown_ipn_key' }, 'IPN Tingee tới ipnKey không thuộc BTC nào');
      throw new AppError(ErrorCode.NOT_FOUND, 'Không tìm thấy tài nguyên.');
    }
    const { organizationId } = recipient;

    const body = (await readRawBody(req, IPN_MAX_BODY_BYTES)).toString('utf8');
    const signature = checkIpnSignature({
      timestamp: headerOf(req, 'x-request-timestamp'),
      signature: headerOf(req, 'x-signature'),
      body,
      credentials: recipient.credentials,
      now: Date.now(),
    });
    if (!signature.ok) throw this.rejected(organizationId, signature.reason);

    const payload = parseIpnBody(body);
    if (!signature.current) {
      // Secret cũ (có thể đã lộ: lý do thường gặp để đổi key) chỉ có hiệu lực với Đơn có link tạo trước khi đổi key.
      const unbound = await this.retiredKeyRejection(organizationId, payload, signature.retiredCredentialIds);
      if (unbound) throw this.rejected(organizationId, unbound);
    }
    if (!payload.ok) {
      // Chỉ log tên trường lỗi, không log giá trị.
      this.logger.error(
        { organizationId, reason: payload.reason, fields: payload.fields },
        'IPN Tingee đúng chữ ký nhưng body không phải JSON hoặc sai schema',
      );
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        payload.reason === 'invalid_json' ? 'Body IPN không phải JSON.' : 'Body IPN không hợp lệ.',
      );
    }

    await this.processor.process(organizationId, payload.ipn);
    return IPN_ACK;
  }

  /** Log warn `{organizationId, reason}` rồi trả lỗi 401 để ném. Không lưu gì. */
  private rejected(organizationId: string, reason: IpnSignatureRejection | RetiredKeyRejection): AppError {
    this.logger.warn(
      { organizationId, reason },
      reason.startsWith('retired_key_')
        ? 'Từ chối IPN Tingee: ký bằng key cũ nhưng không thuộc Đơn có link tạo bằng key đó'
        : 'Từ chối IPN Tingee: chữ ký hoặc timestamp không hợp lệ',
    );
    return new AppError(ErrorCode.IPN_SIGNATURE_INVALID, 'Chữ ký IPN không hợp lệ.');
  }

  /**
   * IPN chỉ khớp secret của các credential đã thay `credentialIds`: hợp lệ (`null`) khi `orderId` là Đơn của chính BTC có
   * link tạo bằng một trong các credential đó (`orders.payout_account_id` → `payout_accounts.tingee_credential_id`; tài
   * khoản chụp ở TX2 không đổi sau đó). IPN `success` hay IPN trạng thái đều như nhau. Không thì lý do từ chối.
   */
  private async retiredKeyRejection(
    organizationId: string,
    payload: ParsedIpnBody,
    credentialIds: readonly string[],
  ): Promise<RetiredKeyRejection | null> {
    if (!payload.ok) return 'retired_key_unreadable_body';
    if (!ORDER_CODE_PATTERN.test(payload.ipn.orderId)) return 'retired_key_invalid_order_code';
    const order = await orderForPayment(this.db.orm, payload.ipn.orderId);
    if (!order) return 'retired_key_order_not_found';
    if (order.organizationId !== organizationId) return 'retired_key_other_organization';
    if (order.payoutAccountId === null) return 'retired_key_order_without_link';
    const credentialId = await payoutAccountCredentialOf(this.db.orm, order.payoutAccountId);
    if (!credentialId || !credentialIds.includes(credentialId)) return 'retired_key_other_credential';
    return null;
  }
}
