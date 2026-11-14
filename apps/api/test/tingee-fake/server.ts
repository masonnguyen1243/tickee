import { randomInt, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseTingeeTimestamp, sign, tingeeTimestamp, verifySignature } from '../../src/modules/tingee/signing.js';

/*
 * Tingee fake: server HTTP thật trên cổng ngẫu nhiên (hoặc cổng chỉ định, cho dev local) với nhiều merchant, mỗi merchant
 * một cặp key (Client ID + Secret Token) và một danh sách tài khoản (AD-9). Kiểm `x-client-id`, độ lệch timestamp và chữ
 * ký HMAC-SHA512 bằng secret của merchant có Client ID khớp, rồi trả mã như Tingee: 92 Client ID lạ · 90 timestamp sai
 * dạng · 91 lệch giờ · 97 sai chữ ký. `behavior` của merchant: `forbidden` → 1133 (key thiếu quyền) · `suspended` → 1007 ·
 * `error` → HTTP 500 · `hang` → treo (quá timeout của client). `get-va-paging` có `merchantId` trong body → mã 400 (key
 * merchant không được gửi `merchantId`). Mọi request được ghi lại (`requests`) để test kiểm.
 *
 * Cổng thanh toán (Story 3.4): `create-link` ký bằng timestamp `yyyyMMddHHmmssSSS` như API Tài khoản; UNIX ms → 90 như
 * Tingee production (dù trang tài liệu `create-link` ghi UNIX ms; chẩn đoán 10/11/2026). Kiểm body như tài liệu
 * (`requestId` uuid v4, `orderId`, `amount` ≥ 2.000, không `merchantId`), VA phải là tài khoản `active` của merchant
 * (không thì 2023), rồi trả `00` với checkout URL trỏ về chính fake (`GET /checkout/:orderId`, trang thanh toán giả).
 * `linkReplies` cài trước phản hồi của từng lần gọi kế tiếp (mã lỗi, HTTP lạ, `data` sai dạng, treo); `linkDelayMs` giả
 * Tingee chậm.
 *
 * IPN (Story 3.5): `signIpn` / `fake.signIpn(clientId, …)` ký body IPN bằng Secret Token của từng merchant như Tingee
 * (`x-request-timestamp` `yyyyMMddHHmmssSSS` giờ Việt Nam, `x-signature` = HMAC-SHA512 của `timestamp:rawBody`) và trả
 * đúng chuỗi byte đã ký; `fakeIpnPayload` dựng body đủ 14 trường như tài liệu Cổng thanh toán, `fakeStatusIpnPayload`
 * body IPN trạng thái (`expired`, `canceled`).
 *
 * Trang thanh toán giả (dev local): số tiền, mã Đơn, link quay về `returnUrl`, và một form có ô "Đường dẫn IPN" (như ô
 * cùng tên trên portal Tingee: một URL cho mỗi merchant, điền sẵn `ipnUrl` của merchant tạo link) cùng ba nút "Đã thanh
 * toán (giả lập)", "Hết hạn", "Hủy". Bấm nút (`POST /checkout/:orderId`, `ipnUrl` + `status`): fake ký IPN bằng Secret
 * Token của merchant tạo link rồi POST nguyên chuỗi đã ký tới URL đó (timeout `ipnTimeoutMs`, mặc định 10 giây). Bên
 * nhận trả 2xx kèm JSON `code: '00'` (ACK của api Tickee) → lưu URL vào merchant, 303 về `returnUrl` (không có thì trang
 * kết quả); phản hồi khác (HTTP ≠ 2xx, hoặc 2xx mà không phải ACK, vd. URL trỏ nhầm dịch vụ khác) → 502 kèm HTTP status
 * và body bên nhận; lỗi mạng hay timeout → 502; URL không phải http(s) hay `status` lạ → 400, không gửi gì; link lạ →
 * 404. Mỗi lần gửi được ghi lại (`ipnDeliveries`). Không bao giờ log hay hiện secret, chữ ký.
 *
 * Tra đơn Gateway (Story 4.1, hợp đồng tạm `GET_ORDER_PATH`, chờ Tingee xác nhận): mỗi link giữ trạng thái thanh toán
 * (`pending` = chưa trả, link còn · `success` · `expired` · `canceled`), mã giao dịch ổn định, `paidAmount`, `paidAt`.
 * Nút "Đã thanh toán (giả lập)" chuyển link sang `success` trước khi gửi IPN (IPN gửi không tới vẫn là đã trả: giả IPN
 * mất) và mọi IPN `success` của link mang cùng mã giao dịch; "Hết hạn"/"Hủy" chỉ đổi link còn `pending`. `POST
 * /v1/payment-gateway/get-order` (`{ requestId, orderId }`, ký như mọi API) trả `00` với `data` dùng đúng tên trường của
 * IPN, hoặc `2004` khi merchant gọi không có link này. `orderReplies` cài trước phản hồi của các lần tra kế tiếp. Test
 * dùng `fake.markPaid` / `fake.markExpired` để đổi trạng thái link mà không gửi IPN.
 *
 * Dò dịch vụ thanh toán (Story 4.2, hợp đồng tạm: `get-va-paging` bằng key hiện hành): `accountReplies` cài trước phản hồi
 * của các lần gọi `get-va-paging` kế tiếp (sau khi qua kiểm key, giờ và chữ ký), vd. `1033` (hết Token), `1007`/`1034`
 * (merchant bị khóa), `97` (key không còn dùng được), HTTP 500 hay treo; hết thì trả danh sách tài khoản như Tingee. Mã
 * ngắt của `create-link` cài bằng `linkReplies`.
 */

/** `create-link` của Cổng thanh toán (`developers.tingee.vn/docs/payment-gateway/create-payment-link`). */
export const CREATE_LINK_PATH = '/v1/payment-gateway/create-link';

/** Tra đơn Gateway theo `orderId` (hợp đồng tạm của Story 4.1, cùng giá trị với `TINGEE_GET_ORDER_PATH` của adapter). */
export const GET_ORDER_PATH = '/v1/payment-gateway/get-order';

/** Danh sách tài khoản (VA) của merchant; cũng là lời gọi dò dịch vụ thanh toán (hợp đồng tạm của Story 4.2). */
export const ACCOUNTS_PATH = '/v1/get-va-paging';

/** Mã "không tìm thấy đơn" của tra đơn Gateway (hợp đồng tạm). */
export const ORDER_NOT_FOUND_CODE = '2004';

/** `merchantId` mà fake điền vào IPN và kết quả tra (số của Tingee, không phải Client ID). */
const FAKE_MERCHANT_ID = 29267;

/** Trạng thái thanh toán của một link trên fake (`status` của kết quả tra). */
export type FakeOrderStatus = 'pending' | 'success' | 'expired' | 'canceled';

/** Timestamp cũ hơn chừng này (hoặc ở tương lai quá 1 phút) bị từ chối. */
const MAX_SKEW_MS = 10 * 60 * 1000;
const MAX_FUTURE_MS = 60 * 1000;

/** Trang thanh toán giả chờ bên nhận IPN tối đa chừng này (mặc định của `ipnTimeoutMs`). */
export const CHECKOUT_IPN_TIMEOUT_MS = 10_000;

/** `status` của IPN mà ba nút trên trang thanh toán giả gửi. */
export const CHECKOUT_IPN_STATUSES = ['success', 'expired', 'canceled'] as const;
export type CheckoutIpnStatus = (typeof CHECKOUT_IPN_STATUSES)[number];

/** Một dòng `items[]` của `get-va-paging` theo dạng của Tingee (để `Record` để test cài được dòng sai dạng). */
export type FakeAccount = Record<string, unknown>;

export type FakeMerchantBehavior = 'suspended' | 'forbidden' | 'error' | 'hang';

/** Một phản hồi `create-link` cài trước: mã Tingee (kèm HTTP và `data` tùy chọn) hoặc treo tới khi client hủy. */
export type FakeLinkReply = { code: string; httpStatus?: number; data?: unknown } | 'hang';

export interface FakeMerchant {
  clientId: string;
  secretToken: string;
  /** Sửa trực tiếp mảng này giữa hai lời gọi để giả lập BTC đổi tài khoản trên Tingee. */
  accounts: FakeAccount[];
  behavior?: FakeMerchantBehavior;
  /** Phản hồi của các lần gọi `create-link` kế tiếp, lấy lần lượt từ đầu mảng; hết thì tạo link như Tingee (`00`). */
  linkReplies?: FakeLinkReply[];
  /** Hoãn mọi phản hồi `create-link` chừng này ms (giả Tingee chậm, để test gọi song song chồng nhau). */
  linkDelayMs?: number;
  /** Phản hồi của các lần tra đơn Gateway kế tiếp (`GET_ORDER_PATH`), lấy lần lượt; hết thì trả trạng thái link. */
  orderReplies?: FakeLinkReply[];
  /**
   * Phản hồi của các lần gọi `get-va-paging` kế tiếp (`ACCOUNTS_PATH`: đọc danh sách tài khoản và dò dịch vụ của Story
   * 4.2), lấy lần lượt; hết thì trả danh sách tài khoản.
   */
  accountReplies?: FakeLinkReply[];
  /**
   * "Đường dẫn IPN" của merchant (như ô cùng tên trên portal Tingee: một URL cho mỗi merchant). Trang thanh toán giả
   * điền sẵn URL này, và lưu đè bằng URL vừa gửi IPN thành công (api trả ACK: 2xx + `code: '00'`).
   */
  ipnUrl?: string;
}

export interface TingeeFakeOptions {
  merchants: FakeMerchant[];
  /** 0 (mặc định) = cổng ngẫu nhiên. */
  port?: number;
  host?: string;
  /** Kịch bản "treo": giữ request tới khi client hủy hoặc hết chừng này (mặc định 30 giây). */
  hangMs?: number;
  /** Trang thanh toán giả bỏ một lần gửi IPN sau chừng này ms không xong (mặc định `CHECKOUT_IPN_TIMEOUT_MS`). */
  ipnTimeoutMs?: number;
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

/** Body IPN của Cổng thanh toán (14 trường như tài liệu Tingee; trường lạ hay sai kiểu để test cài được). */
export type FakeIpnPayload = Record<string, unknown>;

let ipnSeq = 0;

/** Mã giao dịch mới, duy nhất trong tiến trình (dạng `providerTransactionCode` của Tingee). */
export function fakeTransactionCode(): string {
  ipnSeq += 1;
  return `tg-txn-${randomInt(100_000, 999_999)}-${String(ipnSeq).padStart(6, '0')}`;
}

/**
 * Body IPN `success` như Tingee gửi cho `orderId` (mã Đơn) với `amount` = `paidAmount` = `amount`; mỗi lần gọi một
 * `providerTransactionCode` và `requestId` mới. `overrides` thay hoặc thêm trường.
 */
export function fakeIpnPayload(orderId: string, amount: number, overrides: FakeIpnPayload = {}): FakeIpnPayload {
  return {
    requestId: randomUUID(),
    orderId,
    amount,
    paidAmount: amount,
    description: `Thanh toán Đơn ${orderId}`,
    orderInfo: null,
    status: 'success',
    statusCode: '00',
    billId: null,
    customerEmail: 'nguoi-tra@vidu.vn',
    paymentMethod: 'qr',
    providerTransactionCode: fakeTransactionCode(),
    paidAt: new Date().toISOString(),
    merchantId: FAKE_MERCHANT_ID,
    ...overrides,
  };
}

/**
 * Body IPN trạng thái (`expired`, `canceled`, …) như Tingee gửi cho `orderId` khi link không còn trả được: `statusCode`
 * `01`, chưa có giao dịch nên `paidAmount`, `providerTransactionCode`, `paidAt`, `paymentMethod` là `null`; `amount` và
 * `requestId` như `fakeIpnPayload`. `overrides` thay hoặc thêm trường.
 */
export function fakeStatusIpnPayload(
  orderId: string,
  amount: number,
  status: string,
  overrides: FakeIpnPayload = {},
): FakeIpnPayload {
  return fakeIpnPayload(orderId, amount, {
    status,
    statusCode: '01',
    paidAmount: null,
    providerTransactionCode: null,
    paidAt: null,
    paymentMethod: null,
    ...overrides,
  });
}

/** Một IPN đã ký: header như Tingee gửi và đúng chuỗi body đã ký (gửi nguyên văn, không serialize lại). */
export interface SignedIpn {
  headers: { 'content-type': string; 'x-request-timestamp': string; 'x-signature': string };
  body: string;
}

export interface SignIpnOptions {
  /** Thời điểm ký (mặc định bây giờ); bị `timestamp` ghi đè. */
  at?: Date;
  /** `x-request-timestamp` nguyên văn (vd. sai dạng). */
  timestamp?: string;
}

/**
 * Ký IPN bằng `secretToken` như Tingee: `body` dạng chuỗi được ký và gửi nguyên văn (giữ khoảng trắng, thứ tự khóa,
 * `\uXXXX`); dạng object thì `JSON.stringify` một lần (như Tingee gửi JSON đã minify).
 */
export function signIpn(secretToken: string, body: string | FakeIpnPayload, options: SignIpnOptions = {}): SignedIpn {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const timestamp = options.timestamp ?? tingeeTimestamp(options.at ?? new Date());
  return {
    headers: {
      'content-type': 'application/json',
      'x-request-timestamp': timestamp,
      'x-signature': sign(timestamp, raw, secretToken),
    },
    body: raw,
  };
}

/** Kết quả một lần gửi IPN: phản hồi của bên nhận (mọi HTTP status), hoặc không tới được. */
export type IpnDeliveryResult =
  | { kind: 'replied'; httpStatus: number; body: string }
  /** `network`: không kết nối được hay bị ngắt (`code` như `ECONNREFUSED` nếu có); `timeout`: quá `ipnTimeoutMs`. */
  | { kind: 'failed'; reason: 'network' | 'timeout'; code: string | null };

/** Một lần trang thanh toán giả gửi IPN (chỉ nằm trong bộ nhớ của test: có chữ ký). */
export interface IpnDelivery {
  orderId: string;
  /** Merchant tạo link, ký IPN bằng Secret Token của merchant này. */
  clientId: string;
  url: string;
  status: CheckoutIpnStatus;
  /** Header và đúng chuỗi body đã gửi. */
  ipn: SignedIpn;
  result: IpnDeliveryResult;
  sentAt: Date;
}

/** Trạng thái thanh toán của một link (bản chụp): `providerTransactionCode`, `paidAmount`, `paidAt` chỉ có khi `success`. */
export interface FakeOrderState {
  orderId: string;
  /** Merchant tạo link. */
  clientId: string;
  amount: number;
  status: FakeOrderStatus;
  providerTransactionCode: string | null;
  paidAmount: number | null;
  /** ISO 8601 `…Z`. */
  paidAt: string | null;
}

export interface TingeeFake {
  url: string;
  requests: RecordedRequest[];
  /** Các lần trang thanh toán giả gửi IPN, theo thứ tự. */
  ipnDeliveries: IpnDelivery[];
  /** Merchant theo Client ID (cùng object đã truyền vào, sửa được). */
  merchant(clientId: string): FakeMerchant;
  /** Trạng thái thanh toán của link `orderId`; fake chưa tạo link này → lỗi. */
  order(orderId: string): FakeOrderState;
  /**
   * Người mua đã trả link `orderId` mà không gửi IPN (giả IPN mất): link → `success` với mã giao dịch mới (hoặc
   * `providerTransactionCode`), `paidAmount` (mặc định đúng số tiền của link), `paidAt` = bây giờ. Link đã `success` thì
   * giữ nguyên. Trả trạng thái sau đó.
   */
  markPaid(orderId: string, options?: { paidAmount?: number; providerTransactionCode?: string }): FakeOrderState;
  /** Link `orderId` hết hạn (hoặc bị hủy) mà không gửi IPN; chỉ đổi link còn `pending`. Trả trạng thái sau đó. */
  markExpired(orderId: string, status?: 'expired' | 'canceled'): FakeOrderState;
  /** Ký IPN bằng Secret Token của merchant `clientId` (`signIpn`). */
  signIpn(clientId: string, body: string | FakeIpnPayload, options?: SignIpnOptions): SignedIpn;
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

/** Một link đã tạo: trang `GET /checkout/:orderId` và tra đơn Gateway của fake đọc lại. */
interface FakeLink {
  /** Merchant tạo link: ký IPN bằng Secret Token của merchant này và gửi tới `ipnUrl` của nó. */
  clientId: string;
  orderId: string;
  amount: number;
  description: string;
  returnUrl: string | null;
  status: FakeOrderStatus;
  providerTransactionCode: string | null;
  paidAmount: number | null;
  paidAt: string | null;
}

/** Link → `success` (lần trả của link: mã giao dịch ổn định); đã `success` thì giữ nguyên. */
function payLink(link: FakeLink, options: { paidAmount?: number; providerTransactionCode?: string } = {}): void {
  if (link.status === 'success') return;
  link.status = 'success';
  link.providerTransactionCode = options.providerTransactionCode ?? fakeTransactionCode();
  link.paidAmount = options.paidAmount ?? link.amount;
  link.paidAt = new Date().toISOString();
}

/** Link còn `pending` → `expired`/`canceled`; trạng thái khác giữ nguyên. */
function expireLink(link: FakeLink, status: 'expired' | 'canceled'): void {
  if (link.status === 'pending') link.status = status;
}

const stateOf = (link: FakeLink): FakeOrderState => ({
  orderId: link.orderId,
  clientId: link.clientId,
  amount: link.amount,
  status: link.status,
  providerTransactionCode: link.providerTransactionCode,
  paidAmount: link.paidAmount,
  paidAt: link.paidAt,
});

/** `data` của kết quả tra đơn Gateway: đúng tên trường của IPN (hợp đồng tạm). */
function orderData(link: FakeLink): Record<string, unknown> {
  const paid = link.status === 'success';
  return {
    orderId: link.orderId,
    amount: link.amount,
    paidAmount: link.paidAmount,
    status: link.status,
    providerTransactionCode: link.providerTransactionCode,
    paidAt: link.paidAt,
    statusCode: paid ? '00' : '01',
    billId: null,
    paymentMethod: paid ? 'qr' : null,
    merchantId: FAKE_MERCHANT_ID,
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_ID = /^[A-Za-z0-9_-]{1,100}$/;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

/** Nhãn ba nút của trang thanh toán giả, theo `status` IPN mà nút gửi. */
const CHECKOUT_BUTTONS: Record<CheckoutIpnStatus, string> = {
  success: 'Đã thanh toán (giả lập)',
  expired: 'Hết hạn',
  canceled: 'Hủy',
};

const isCheckoutIpnStatus = (value: unknown): value is CheckoutIpnStatus =>
  (CHECKOUT_IPN_STATUSES as readonly unknown[]).includes(value);

/** `raw` nếu là URL tuyệt đối http(s), không thì `null`. */
function httpUrlOrNull(raw: string): string | null {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/** Đoạn đường dẫn đã giải mã; mã `%` hỏng → `null`. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const formatMs = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000} giây` : `${ms} ms`);

/** Body bên nhận trả về dài hơn chừng này ký tự thì cắt khi hiện trên trang. */
const MAX_SHOWN_REPLY = 4_000;
const shownReply = (body: string) =>
  body.length > MAX_SHOWN_REPLY ? `${body.slice(0, MAX_SHOWN_REPLY)}… (cắt, ${body.length} ký tự)` : body;

/** Gợi ý theo HTTP status api trả cho IPN (dev local). */
const IPN_REPLY_HINTS: Record<number, string> = {
  401: 'api từ chối chữ ký: Đường dẫn IPN có phải của BTC đang dùng key của merchant này không?',
  404: 'ipnKey không thuộc BTC nào hoặc đường dẫn sai (thiếu /v1, sai cổng…): chép lại URL IPN ở trang Tài khoản nhận tiền của BTC.',
};

/** Phản hồi 2xx có body JSON `code: '00'`: ACK mà api Tickee trả khi đã nhận IPN. */
function isIpnAck(result: IpnDeliveryResult): boolean {
  if (result.kind !== 'replied' || result.httpStatus < 200 || result.httpStatus >= 300) return false;
  try {
    const json = JSON.parse(result.body) as unknown;
    return typeof json === 'object' && json !== null && (json as { code?: unknown }).code === '00';
  } catch {
    return false;
  }
}

/** Kết quả một lần bấm nút, hiện trên trang thanh toán giả. */
interface CheckoutNotice {
  title: string;
  lines: string[];
  /** Body bên nhận trả về, hiện nguyên văn. */
  reply?: string;
}

/** Trang thanh toán giả của `link`: ô "Đường dẫn IPN" điền sẵn `ipnUrl`, ba nút gửi IPN, link quay về `returnUrl`. */
function checkoutHtml(link: FakeLink, ipnUrl: string, notice: CheckoutNotice | null): string {
  const buttons = CHECKOUT_IPN_STATUSES.map(
    (status) => `<button type="submit" name="status" value="${status}">${CHECKOUT_BUTTONS[status]}</button>`,
  ).join(' ');
  const shown = notice
    ? `<section role="status"><h2>${escapeHtml(notice.title)}</h2>` +
      notice.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') +
      (notice.reply === undefined ? '' : `<pre>${escapeHtml(shownReply(notice.reply))}</pre>`) +
      `</section>`
    : '';
  const back = link.returnUrl ? `<p><a href="${escapeHtml(link.returnUrl)}">Quay lại Tickee</a></p>` : '';
  return (
    `<!doctype html><html lang="vi"><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>Tingee fake · Thanh toán</title>` +
    `<h1>Tingee fake · Thanh toán</h1><p>${escapeHtml(link.description)}</p>` +
    `<p>Mã Đơn ${escapeHtml(link.orderId)} · ${link.amount} đồng</p>` +
    `<p>Đây là trang giả: không có tiền nào được chuyển.</p>${shown}` +
    `<form method="post" action="/checkout/${encodeURIComponent(link.orderId)}">` +
    `<p><label for="ipnUrl">Đường dẫn IPN</label><br>` +
    `<input id="ipnUrl" name="ipnUrl" type="url" size="80" required value="${escapeHtml(ipnUrl)}"></p>` +
    `<p>Mỗi nút ký một IPN bằng Secret Token của merchant tạo link rồi gửi tới đường dẫn trên, như Tingee.</p>` +
    `<p>${buttons}</p></form>${back}</html>`
  );
}

export async function startTingeeFake(options: TingeeFakeOptions): Promise<TingeeFake> {
  const requests: RecordedRequest[] = [];
  const ipnDeliveries: IpnDelivery[] = [];
  const waiters = new Set<() => void>();
  const hanging = new Set<ServerResponse>();
  const findMerchant = (clientId: string | undefined) => options.merchants.find((m) => m.clientId === clientId);
  const links = new Map<string, FakeLink>();
  const ipnTimeoutMs = options.ipnTimeoutMs ?? CHECKOUT_IPN_TIMEOUT_MS;
  let baseUrl = '';

  function route(path: string, body: Record<string, unknown>, merchant: FakeMerchant): Reply {
    switch (path) {
      case ACCOUNTS_PATH: {
        // Key của merchant: `merchantId` chỉ dành cho key Master Merchant. Tingee không nhận chuỗi rỗng.
        if ('merchantId' in body) return fail('400', 'merchantId chỉ dùng với key Master Merchant');
        if (Object.values(body).some((v) => v === '')) return fail('400', 'Không truyền chuỗi rỗng');
        const skip = nonNegativeInt(body.skipCount, 0);
        const max = Math.min(nonNegativeInt(body.maxResultCount, 10), 2000);
        return ok({ totalCount: merchant.accounts.length, items: merchant.accounts.slice(skip, skip + max) });
      }
      case CREATE_LINK_PATH: {
        if ('merchantId' in body) return fail('400', 'merchantId chỉ dùng với key Master Merchant');
        if (Object.values(body).some((v) => v === '')) return fail('400', 'Không truyền chuỗi rỗng');
        const { requestId, orderId, amount, expireInMinute, vaAccountNumber, returnUrl, description } = body;
        if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) return fail('400', 'requestId phải là UUID v4');
        if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) return fail('400', 'orderId không hợp lệ');
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 2_000 || amount > 10_000_000_000) {
          return fail('400', 'amount không hợp lệ');
        }
        if (
          expireInMinute !== undefined &&
          (typeof expireInMinute !== 'number' || !Number.isInteger(expireInMinute) || expireInMinute < 5 || expireInMinute > 30)
        ) {
          return fail('400', 'expireInMinute không hợp lệ');
        }
        const allowed = merchant.accounts.some(
          (a) => String(a.vaAccountNumber) === vaAccountNumber && String(a.status).toLowerCase() === 'active',
        );
        if (vaAccountNumber !== undefined && !allowed) return fail('2023', 'VA chưa được cho phép trên Cổng thanh toán');
        links.set(orderId, {
          clientId: merchant.clientId,
          orderId,
          amount,
          description: typeof description === 'string' ? description : '',
          returnUrl: typeof returnUrl === 'string' ? returnUrl : null,
          status: 'pending',
          providerTransactionCode: null,
          paidAmount: null,
          paidAt: null,
        });
        return ok(`${baseUrl}/checkout/${encodeURIComponent(orderId)}?r=${requestId}`);
      }
      case GET_ORDER_PATH: {
        if ('merchantId' in body) return fail('400', 'merchantId chỉ dùng với key Master Merchant');
        if (Object.values(body).some((v) => v === '')) return fail('400', 'Không truyền chuỗi rỗng');
        const { requestId, orderId } = body;
        if (typeof requestId !== 'string' || !UUID_V4.test(requestId)) return fail('400', 'requestId phải là UUID v4');
        if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) return fail('400', 'orderId không hợp lệ');
        // Đơn của merchant khác: như Tingee, key này không thấy đơn đó.
        const link = links.get(orderId);
        if (!link || link.clientId !== merchant.clientId) return fail(ORDER_NOT_FOUND_CODE, 'Không tìm thấy đơn hàng');
        return ok(orderData(link));
      }
      default:
        return fail('404', 'Không có API này');
    }
  }

  function sendHtml(res: ServerResponse, httpStatus: number, html: string): void {
    res.writeHead(httpStatus, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  }

  function linkNotFound(res: ServerResponse): void {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Tingee fake: không có link thanh toán này');
  }

  /** Link của `orderId` và merchant tạo link; `null` khi fake chưa tạo link này. */
  function linkOf(orderId: string | null): { link: FakeLink; merchant: FakeMerchant } | null {
    const link = orderId === null ? undefined : links.get(orderId);
    const merchant = link && findMerchant(link.clientId);
    return link && merchant ? { link, merchant } : null;
  }

  /** `GET /checkout/:orderId`: trang thanh toán giả, ô "Đường dẫn IPN" điền sẵn `ipnUrl` của merchant tạo link. */
  function showCheckout(res: ServerResponse, orderId: string | null): void {
    const found = linkOf(orderId);
    if (!found) return linkNotFound(res);
    sendHtml(res, 200, checkoutHtml(found.link, found.merchant.ipnUrl ?? '', null));
  }

  /** POST body IPN đã ký (nguyên chuỗi đã ký) tới `url`; không ném. Không theo redirect (3xx là phản hồi lỗi). */
  async function deliverIpn(url: string, ipn: SignedIpn): Promise<IpnDeliveryResult> {
    const signal = AbortSignal.timeout(ipnTimeoutMs);
    try {
      const response = await fetch(url, { method: 'POST', headers: ipn.headers, body: ipn.body, redirect: 'manual', signal });
      return { kind: 'replied', httpStatus: response.status, body: await response.text() };
    } catch (err) {
      if (signal.aborted) return { kind: 'failed', reason: 'timeout', code: null };
      const code = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
      return { kind: 'failed', reason: 'network', code: typeof code === 'string' ? code : null };
    }
  }

  /**
   * `POST /checkout/:orderId` (một nút trên trang thanh toán giả, form `ipnUrl` + `status`): đầu vào sai → 400, không
   * gửi gì; không thì ký IPN bằng Secret Token của merchant tạo link, gửi tới `ipnUrl`, rồi 303 về `returnUrl` (ACK của
   * api: 2xx + `code: '00'`) hoặc 502 (phản hồi khác, lỗi mạng, timeout).
   */
  async function submitCheckout(res: ServerResponse, orderId: string | null, raw: string): Promise<void> {
    const found = linkOf(orderId);
    if (!found) return linkNotFound(res);
    const { link, merchant } = found;
    const form = new URLSearchParams(raw);
    const typed = (form.get('ipnUrl') ?? '').trim();
    const status = form.get('status');
    const url = httpUrlOrNull(typed);
    if (url === null || !isCheckoutIpnStatus(status)) {
      const lines: string[] = [];
      if (!typed) lines.push('Chưa nhập Đường dẫn IPN.');
      else if (url === null) lines.push('Đường dẫn IPN phải là URL http:// hoặc https://.');
      if (!isCheckoutIpnStatus(status)) lines.push('Nút lạ: chỉ có "Đã thanh toán (giả lập)", "Hết hạn" và "Hủy".');
      options.log?.(`POST /checkout/${link.orderId} → 400 (đầu vào sai, không gửi IPN)`);
      sendHtml(res, 400, checkoutHtml(link, typed, { title: 'Chưa gửi IPN', lines }));
      return;
    }

    // Người mua đã trả (hoặc link hết hạn) trên Tingee trước khi IPN đi: IPN gửi không tới thì Đối soát bù vẫn tra ra.
    // Mọi IPN `success` của một link là của cùng một lần trả (cùng mã giao dịch), như Tingee gửi lại.
    if (status === 'success') payLink(link);
    else expireLink(link, status);
    const payload =
      status === 'success'
        ? fakeIpnPayload(link.orderId, link.amount, {
            paidAmount: link.paidAmount,
            providerTransactionCode: link.providerTransactionCode,
            paidAt: link.paidAt,
          })
        : fakeStatusIpnPayload(link.orderId, link.amount, status);
    const ipn = signIpn(merchant.secretToken, payload);
    const result = await deliverIpn(url, ipn);
    ipnDeliveries.push({ orderId: link.orderId, clientId: merchant.clientId, url, status, ipn, result, sentAt: new Date() });
    const network = result.kind === 'failed' && result.code ? ` (${result.code})` : '';
    const outcome =
      result.kind === 'replied' ? `HTTP ${result.httpStatus}` : result.reason === 'timeout' ? 'timeout' : `lỗi mạng${network}`;
    options.log?.(`POST /checkout/${link.orderId} → IPN ${status} tới ${url} → ${outcome}`);

    if (result.kind === 'replied' && isIpnAck(result)) {
      // Như lưu "Đường dẫn IPN" trên portal Tingee: một URL cho mỗi merchant, link sau của merchant điền sẵn URL này.
      merchant.ipnUrl = url;
      if (link.returnUrl) {
        res.writeHead(303, { location: link.returnUrl, 'cache-control': 'no-store' });
        res.end();
        return;
      }
      const notice = { title: `Đã gửi IPN ${status}`, lines: [`Bên nhận trả HTTP ${result.httpStatus}.`], reply: result.body };
      sendHtml(res, 200, checkoutHtml(link, url, notice));
      return;
    }

    let notice: CheckoutNotice;
    if (result.kind === 'replied') {
      const ok = result.httpStatus >= 200 && result.httpStatus < 300;
      const hint = ok
        ? 'Phản hồi không phải ACK của api Tickee ({"code":"00",…}): Đường dẫn IPN có trỏ nhầm dịch vụ khác (vd. chính Tingee fake)?'
        : IPN_REPLY_HINTS[result.httpStatus];
      notice = {
        title: ok
          ? `Bên nhận không trả ACK cho IPN ${status}: HTTP ${result.httpStatus}`
          : `Bên nhận từ chối IPN ${status}: HTTP ${result.httpStatus}`,
        lines: hint ? [hint] : [],
        reply: result.body,
      };
    } else {
      notice =
        result.reason === 'timeout'
          ? {
              title: `Không có phản hồi cho IPN ${status} sau ${formatMs(ipnTimeoutMs)} (timeout)`,
              lines: [
                'IPN đã được gửi và có thể api đã xử lý: xem Trang Đơn trước khi bấm lại.',
                'Kiểm tra api đang chạy và Đường dẫn IPN đúng.',
              ],
            }
          : {
              title: `Không gửi được IPN ${status}: lỗi mạng${network}`,
              lines: ['Kiểm tra api đang chạy và Đường dẫn IPN đúng.'],
            };
    }
    sendHtml(res, 502, checkoutHtml(link, url, notice));
  }

  const server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const path = new URL(req.url ?? '/', 'http://fake').pathname;
      const page = /^\/checkout\/([^/]+)$/.exec(path);
      if (page && (req.method === 'GET' || req.method === 'POST')) {
        const orderId = decodeSegment(page[1]!);
        if (req.method === 'GET') showCheckout(res, orderId);
        else await submitCheckout(res, orderId, raw);
        return;
      }
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

      // Mọi API, kể cả Cổng thanh toán: `yyyyMMddHHmmssSSS` giờ Việt Nam (UNIX ms → 90).
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
      else if (path === CREATE_LINK_PATH) reply = await createLinkReply(body, merchant);
      else if (path === GET_ORDER_PATH) reply = orderReply(body, merchant);
      else if (path === ACCOUNTS_PATH) reply = accountsReply(body, merchant);
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

  /** `create-link` sau khi qua kiểm key, giờ và chữ ký: phản hồi cài trước (nếu có), không thì như Tingee. */
  async function createLinkReply(body: Record<string, unknown>, merchant: FakeMerchant): Promise<Reply | 'hang'> {
    if (merchant.linkDelayMs) await sleep(merchant.linkDelayMs);
    const scripted = merchant.linkReplies?.shift();
    if (scripted === 'hang') return 'hang';
    if (scripted) return { httpStatus: scripted.httpStatus, code: scripted.code, message: 'Kịch bản test', data: scripted.data };
    return route(CREATE_LINK_PATH, body, merchant);
  }

  /** Tra đơn Gateway sau khi qua kiểm key, giờ và chữ ký: phản hồi cài trước (nếu có), không thì trạng thái link. */
  function orderReply(body: Record<string, unknown>, merchant: FakeMerchant): Reply | 'hang' {
    const scripted = merchant.orderReplies?.shift();
    if (scripted === 'hang') return 'hang';
    if (scripted) return { httpStatus: scripted.httpStatus, code: scripted.code, message: 'Kịch bản test', data: scripted.data };
    return route(GET_ORDER_PATH, body, merchant);
  }

  /** `get-va-paging` sau khi qua kiểm key, giờ và chữ ký: phản hồi cài trước (nếu có), không thì danh sách tài khoản. */
  function accountsReply(body: Record<string, unknown>, merchant: FakeMerchant): Reply | 'hang' {
    const scripted = merchant.accountReplies?.shift();
    if (scripted === 'hang') return 'hang';
    if (scripted) return { httpStatus: scripted.httpStatus, code: scripted.code, message: 'Kịch bản test', data: scripted.data };
    return route(ACCOUNTS_PATH, body, merchant);
  }

  /** Link `orderId` mà fake đã tạo; chưa tạo → lỗi (lỗi của test). */
  function linkFor(orderId: string): FakeLink {
    const link = links.get(orderId);
    if (!link) throw new Error(`Tingee fake: chưa có link ${orderId}`);
    return link;
  }

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://${options.host ?? '127.0.0.1'}:${port}`;
  const calls = (path: string) => requests.filter((r) => r.path === path);

  return {
    url: baseUrl,
    requests,
    ipnDeliveries,
    merchant(clientId) {
      const merchant = findMerchant(clientId);
      if (!merchant) throw new Error(`Tingee fake: không có merchant ${clientId}`);
      return merchant;
    },
    signIpn(clientId, body, options) {
      const merchant = findMerchant(clientId);
      if (!merchant) throw new Error(`Tingee fake: không có merchant ${clientId}`);
      return signIpn(merchant.secretToken, body, options);
    },
    order(orderId) {
      return stateOf(linkFor(orderId));
    },
    markPaid(orderId, options) {
      const link = linkFor(orderId);
      payLink(link, options);
      return stateOf(link);
    },
    markExpired(orderId, status = 'expired') {
      const link = linkFor(orderId);
      expireLink(link, status);
      return stateOf(link);
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
      ipnDeliveries.length = 0;
    },
    async close() {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
