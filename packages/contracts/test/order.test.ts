import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../src/errors.js';
import type { FormQuestion } from '../src/form.js';
import { JobQueue } from '../src/jobs.js';
import {
  answerIssues,
  answerSnapshot,
  BUYER_ORDER_STATUSES,
  BuyerOrderPayment,
  BuyerOrderView,
  buyerOrderApiPath,
  buyerOrderLiveApiPath,
  BuyerPhone,
  BuyerTicket,
  CreateOrderRequest,
  FREE_TICKET_LIMIT_MESSAGE,
  IdempotencyKey,
  isBuyerOrderStatus,
  localBuyerPhone,
  NotOnSaleDetails,
  ORDER_CODE_ALPHABET,
  ORDER_CODE_PATTERN,
  ORDER_RATE_LIMITS,
  ORDER_STATUSES,
  orderPath,
  orderRequestFor,
  PAYMENT_LINK_ERRORS,
  PAYMENT_LINK_GRACE_SECONDS,
  PAYMENT_LINK_MINUTES,
  paymentLinkApiPath,
  TICKET_QR_PATTERN,
} from '../src/order.js';
import { PII_COLUMNS, PII_KEYS } from '../src/pii.js';

const A = '019a3b2c-0800-7abc-8def-000000000001';
const B = '019a3b2c-0800-7abc-8def-000000000002';
const Q_TEXT = '019a3b2c-0900-7abc-8def-000000000001';
const Q_CHOICE = '019a3b2c-0900-7abc-8def-000000000002';
const Q_OPTIONAL = '019a3b2c-0900-7abc-8def-000000000003';
const OPT_1 = '019a3b2c-0a00-7abc-8def-000000000001';
const OPT_2 = '019a3b2c-0a00-7abc-8def-000000000002';
const FUNNEL = '5f0c6b8e-2a4d-4c1e-9b7a-3d2f1e0a9c8b';
const TICKET = '019a3b2c-0b00-7abc-8def-000000000001';
const SIG = 'q2dA3x_9-Lr4ZfKXJ0b1c2d3e4f5g6h7i8j9k0l1m2n';
const QR = `t1.${TICKET}.${SIG}`;
const SHARE_TOKEN = 'Zx9_aB3-kLm0Qr7Tu1Vw2y';
const ticket = (seq: number, count: number) => ({
  id: TICKET,
  seq,
  count,
  ticketTypeName: 'Đơn nam',
  holderName: 'Nguyễn Văn An',
  qr: QR,
  shareToken: SHARE_TOKEN,
});

const questions: FormQuestion[] = [
  { id: Q_TEXT, position: 0, label: 'Size áo', kind: 'text', required: true, options: [] },
  {
    id: Q_CHOICE,
    position: 1,
    label: 'Trình độ',
    kind: 'choice',
    required: true,
    options: [
      { id: OPT_1, label: 'Mới chơi' },
      { id: OPT_2, label: 'Khá' },
    ],
  },
  { id: Q_OPTIONAL, position: 2, label: 'Ghi chú', kind: 'text', required: false, options: [] },
];

const body = (overrides: Record<string, unknown> = {}) => ({
  items: [
    { ticketTypeId: A, quantity: 2 },
    { ticketTypeId: B, quantity: 1 },
  ],
  buyer: { name: '  Nguyễn Văn An ', phone: '0912 345 678' },
  answers: { [Q_TEXT]: ' M ', [Q_CHOICE]: OPT_2 },
  funnelId: FUNNEL,
  ...overrides,
});

const issuePaths = (value: unknown, max = 10) => {
  const parsed = orderRequestFor({ maxTicketsPerOrder: max }, questions).safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join('.'));
};

describe('mã Đơn', () => {
  it('TK + 8 ký tự Crockford base32 (không I, L, O, U); orderPath', () => {
    expect(ORDER_CODE_ALPHABET).toHaveLength(32);
    expect(ORDER_CODE_ALPHABET).not.toMatch(/[ILOU]/);
    expect(ORDER_CODE_PATTERN.test('TK8F3Q2AXM')).toBe(true);
    for (const bad of ['TK8F3Q2AX', 'TK8F3Q2AXMM', 'tk8f3q2axm', 'TK8F3Q2AXI', 'TKOOOOOOOO', 'XX8F3Q2AXM']) {
      expect(ORDER_CODE_PATTERN.test(bad)).toBe(false);
    }
    expect(orderPath('TK8F3Q2AXM')).toBe('/orders/TK8F3Q2AXM');
  });

  it('mọi ký tự của bảng chữ cái khớp pattern', () => {
    for (const c of ORDER_CODE_ALPHABET) expect(ORDER_CODE_PATTERN.test(`TK${c.repeat(8)}`)).toBe(true);
  });
});

describe('BuyerPhone (E.164 +84)', () => {
  it.each([
    ['0912345678', '+84912345678'],
    ['0912 345 678', '+84912345678'],
    ['0912.345.678', '+84912345678'],
    ['0912-345-678', '+84912345678'],
    ['+84 912 345 678', '+84912345678'],
    ['+84912345678', '+84912345678'],
    ['(091) 234-5678', '+84912345678'],
  ])('%s → %s', (raw, expected) => {
    expect(BuyerPhone.parse(raw)).toBe(expected);
  });

  it.each([[''], ['091234567'], ['09123456789'], ['+840912345678'], ['0012345678'], ['abc'], ['+1 212 555 0100']])(
    'sai: %j',
    (raw) => {
      expect(BuyerPhone.safeParse(raw).success).toBe(false);
    },
  );

  it('localBuyerPhone: +84912345678 → 0912345678', () => {
    expect(localBuyerPhone('+84912345678')).toBe('0912345678');
    expect(localBuyerPhone('lạ')).toBe('lạ');
  });
});

describe('CreateOrderRequest / orderRequestFor', () => {
  it('hợp lệ: tên trim, SĐT về E.164, answers giữ nguyên (trim lúc chụp), funnelId tùy chọn', () => {
    const parsed = orderRequestFor({ maxTicketsPerOrder: 10 }, questions).parse(body());
    expect(parsed).toEqual({
      items: [
        { ticketTypeId: A, quantity: 2 },
        { ticketTypeId: B, quantity: 1 },
      ],
      buyer: { name: 'Nguyễn Văn An', phone: '+84912345678' },
      answers: { [Q_TEXT]: ' M ', [Q_CHOICE]: OPT_2 },
      funnelId: FUNNEL,
    });
    expect(CreateOrderRequest.parse(body({ funnelId: undefined, answers: undefined }))).toMatchObject({
      funnelId: null,
      answers: {},
    });
  });

  it.each([
    ['0 dòng', { items: [] }, ['items']],
    ['số lượng 0', { items: [{ ticketTypeId: A, quantity: 0 }] }, ['items.0.quantity']],
    ['số lượng 1.5', { items: [{ ticketTypeId: A, quantity: 1.5 }] }, ['items.0.quantity']],
    ['Hạng vé trùng', { items: [{ ticketTypeId: A, quantity: 1 }, { ticketTypeId: A, quantity: 1 }] }, ['items']],
    ['tên rỗng', { buyer: { name: '   ', phone: '0912345678' } }, ['buyer.name']],
    ['tên > 100', { buyer: { name: 'a'.repeat(101), phone: '0912345678' } }, ['buyer.name']],
    ['SĐT sai', { buyer: { name: 'An', phone: '12345' } }, ['buyer.phone']],
    ['trường lạ', { email: 'a@vidu.vn' }, ['']],
    ['funnelId sai', { funnelId: 'abc' }, ['funnelId']],
  ])('sai cấu trúc (%s) → lỗi tại đúng trường', (_label, overrides, expected) => {
    expect(issuePaths(body(overrides))).toEqual(expected);
  });

  it('tổng > giới hạn Vé/Đơn → lỗi tại items; bằng giới hạn thì được', () => {
    expect(issuePaths(body(), 2)).toEqual(['items']);
    expect(issuePaths(body(), 3)).toEqual([]);
  });

  it('thiếu câu bắt buộc, phương án lạ → lỗi tại answers.<id>; câu không bắt buộc bỏ trống được', () => {
    expect(issuePaths(body({ answers: {} }))).toEqual([`answers.${Q_TEXT}`, `answers.${Q_CHOICE}`]);
    expect(issuePaths(body({ answers: { [Q_TEXT]: '   ', [Q_CHOICE]: OPT_1 } }))).toEqual([`answers.${Q_TEXT}`]);
    expect(issuePaths(body({ answers: { [Q_TEXT]: 'M', [Q_CHOICE]: A } }))).toEqual([`answers.${Q_CHOICE}`]);
    expect(issuePaths(body({ answers: { [Q_TEXT]: 'M', [Q_CHOICE]: 'Khá' } }))).toEqual([`answers.${Q_CHOICE}`]);
  });

  it('uuid chữ hoa: cùng Hạng vé hai lần (hoa/thường) → lỗi trùng; khóa câu hỏi chữ hoa vẫn khớp câu hỏi', () => {
    expect(
      issuePaths(
        body({
          items: [
            { ticketTypeId: A.toUpperCase(), quantity: 1 },
            { ticketTypeId: A, quantity: 1 },
          ],
        }),
      ),
    ).toEqual(['items']);
    const parsed = orderRequestFor({ maxTicketsPerOrder: 10 }, questions).parse(
      body({
        items: [{ ticketTypeId: B.toUpperCase(), quantity: 1 }],
        answers: { [Q_TEXT.toUpperCase()]: 'M', [Q_CHOICE.toUpperCase()]: OPT_1 },
      }),
    );
    expect(parsed.items).toEqual([{ ticketTypeId: B, quantity: 1 }]);
    expect(parsed.answers).toEqual({ [Q_TEXT]: 'M', [Q_CHOICE]: OPT_1 });
  });

  it('id câu hỏi không có trong form bị bỏ qua', () => {
    expect(issuePaths(body({ answers: { [Q_TEXT]: 'M', [Q_CHOICE]: OPT_1, [A]: 'thừa' } }))).toEqual([]);
  });

  it('answerIssues: mỗi câu tối đa một lỗi, theo thứ tự câu hỏi; chữ quá 1.000 ký tự', () => {
    expect(answerIssues(questions, { [Q_CHOICE]: 'lạ', [Q_OPTIONAL]: 'x'.repeat(1001) })).toEqual([
      { questionId: Q_TEXT, reason: 'required' },
      { questionId: Q_CHOICE, reason: 'invalid_option' },
      { questionId: Q_OPTIONAL, reason: 'too_long' },
    ]);
  });
});

describe('answerSnapshot', () => {
  it('nhãn và thứ tự câu hỏi lúc đặt, câu chọn lưu nhãn phương án, bỏ câu không trả lời', () => {
    expect(answerSnapshot(questions, { [Q_TEXT]: ' M ', [Q_CHOICE]: OPT_2.toUpperCase() })).toEqual([
      { questionId: Q_TEXT, position: 0, label: 'Size áo', kind: 'text', answer: 'M', optionId: null },
      { questionId: Q_CHOICE, position: 1, label: 'Trình độ', kind: 'choice', answer: 'Khá', optionId: OPT_2 },
    ]);
  });
});

describe('BuyerOrderView và lỗi', () => {
  const order = {
    code: 'TK8F3Q2AXM',
    buyerStatus: 'awaiting_payment',
    event: { slug: 'giai-chay-ab12', name: 'Giải chạy', startsAt: '2026-11-16T07:00:00+07:00', ended: false },
    items: [{ ticketTypeId: A, name: 'Đơn nam', unitPrice: 300_000, quantity: 2, amount: 600_000 }],
    totalAmount: 600_000,
    buyer: { name: 'An', phone: '+84912345678', email: 'an@vidu.vn' },
    answers: [{ questionId: Q_TEXT, label: 'Size áo', answer: 'M' }],
    refundPolicy: 'Hoàn 100% trước 7 ngày.',
    createdAt: '2026-11-10T08:00:00.000Z',
    expiresAt: '2026-11-10T08:01:00.000Z',
    serverNow: '2026-11-10T08:00:00.123Z',
    payment: {
      checkoutUrl: 'https://pay.tingee.vn/checkout/abc?x=1',
      linkError: null,
      recipient: { organizationName: 'CLB ABC', accountName: 'NGUYEN VAN TUAN', bankName: 'Vietcombank' },
    },
    tickets: [],
    organizer: { name: 'CLB ABC', contactPhone: '0901234567', contactEmail: 'lienhe@clbabc.vn' },
  };

  it('BuyerOrderView nhận đúng dạng API trả', () => {
    expect(BuyerOrderView.parse(order)).toEqual(order);
    const paid = { ...order, buyerStatus: 'paid', tickets: [ticket(1, 2), ticket(2, 2)] };
    expect(BuyerOrderView.parse(paid)).toEqual(paid);
    // Đơn 0đ: không có phần thanh toán; thiếu `payment` (API cũ) → không nhận.
    expect(BuyerOrderView.parse({ ...order, payment: null }).payment).toBeNull();
    const { payment: _payment, ...noPayment } = order;
    expect(BuyerOrderView.safeParse(noPayment).success).toBe(false);
    // Thiếu `tickets`, `event.startsAt` hay `event.ended` (API cũ) → không nhận.
    const { tickets: _tickets, ...noTickets } = order;
    expect(BuyerOrderView.safeParse(noTickets).success).toBe(false);
    expect(
      BuyerOrderView.safeParse({ ...order, event: { slug: 'giai-chay-ab12', name: 'Giải chạy', ended: false } }).success,
    ).toBe(false);
    const { ended: _ended, ...notEnded } = order.event;
    expect(BuyerOrderView.safeParse({ ...order, event: notEnded }).success).toBe(false);
    // Đơn `paid` của Sự kiện đã kết thúc, không kèm Vé, vẫn nhận.
    const ended = { ...order, buyerStatus: 'paid', event: { ...order.event, ended: true } };
    expect(BuyerOrderView.parse(ended)).toEqual(ended);
    // BTC không nhập kênh liên hệ → `null`; thiếu `organizer` (API cũ) → không nhận.
    const noContact = { ...order, organizer: { name: 'CLB ABC', contactPhone: null, contactEmail: null } };
    expect(BuyerOrderView.parse(noContact)).toEqual(noContact);
    const { organizer: _organizer, ...noOrganizer } = order;
    expect(BuyerOrderView.safeParse(noOrganizer).success).toBe(false);
    expect(ORDER_STATUSES).toEqual(['pending', 'paid', 'expired', 'review', 'cancelled', 'refunded']);
  });

  it('buyerStatus: bảy giá trị; giá trị lạ vẫn parse (web hiện trạng thái an toàn); thiếu hoặc không phải chuỗi → không nhận', () => {
    expect(BUYER_ORDER_STATUSES).toEqual([
      'awaiting_payment',
      'confirming',
      'under_review',
      'paid',
      'expired',
      'cancelled_by_organizer',
      'event_cancelled',
    ]);
    for (const buyerStatus of BUYER_ORDER_STATUSES) {
      expect(BuyerOrderView.parse({ ...order, buyerStatus }).buyerStatus).toBe(buyerStatus);
      expect(isBuyerOrderStatus(buyerStatus)).toBe(true);
    }
    expect(BuyerOrderView.parse({ ...order, buyerStatus: 'refund_pending' }).buyerStatus).toBe('refund_pending');
    expect(isBuyerOrderStatus('refund_pending')).toBe(false);
    // `status` thô của Đơn không còn trong view.
    expect(BuyerOrderView.parse({ ...order, status: 'review' })).not.toHaveProperty('status');
    const { buyerStatus: _status, ...noStatus } = order;
    expect(BuyerOrderView.safeParse(noStatus).success).toBe(false);
    expect(BuyerOrderView.safeParse({ ...order, buyerStatus: 3 }).success).toBe(false);
  });

  it('mã lỗi mới, queue hết hạn, NotOnSaleDetails', () => {
    for (const code of [
      'TICKET_TYPE_SOLD_OUT',
      'NOT_ON_SALE',
      'PENDING_ORDER_EXISTS',
      'ORDER_RATE_LIMITED',
      'ORDER_NOT_FOUND',
      'FREE_TICKET_LIMIT_REACHED',
    ] as const) {
      expect(ErrorCode[code]).toBe(code);
    }
    expect(JobQueue.ORDERING_EXPIRE_ORDER).toBe('ordering.expire-order');
    expect(JobQueue.ORDERING_EXPIRE_ORDER_DEAD_LETTER).toBe('ordering.expire-order.dead-letter');
    expect(NotOnSaleDetails.parse({ reason: 'hidden' })).toEqual({ reason: 'hidden' });
    expect(NotOnSaleDetails.safeParse({ reason: 'sold_out' }).success).toBe(false);
  });

  it('giới hạn tốc độ 10/user, 600/IP mỗi 10 phút; Idempotency-Key là uuid; bản chụp Người mua là PII', () => {
    expect(ORDER_RATE_LIMITS).toEqual({ windowSeconds: 600, perUser: 10, perIp: 600 });
    expect(IdempotencyKey.safeParse(FUNNEL).success).toBe(true);
    expect(IdempotencyKey.safeParse('abc').success).toBe(false);
    expect(PII_COLUMNS.ordering).toEqual(['buyer_name', 'buyer_phone', 'buyer_email', 'answer']);
    for (const key of ['buyerName', 'buyerPhone', 'buyerEmail', 'answer']) expect(PII_KEYS).toContain(key);
    expect(PII_COLUMNS.ticketing).toEqual(['holder_name']);
    for (const key of ['holder_name', 'holderName']) expect(PII_KEYS).toContain(key);
    expect(FREE_TICKET_LIMIT_MESSAGE).toBe('Bạn đã nhận đủ số Vé tối đa cho Sự kiện này.');
  });
});

describe('Thanh toán (Story 3.4)', () => {
  const recipient = { organizationName: 'CLB ABC', accountName: null, bankName: null };

  it('BuyerOrderPayment: checkoutUrl chỉ http/https; linkError ba giá trị; recipient không còn tài khoản → null', () => {
    expect(PAYMENT_LINK_ERRORS).toEqual(['provider_error', 'sales_paused', 'timeout']);
    for (const linkError of [...PAYMENT_LINK_ERRORS, null]) {
      expect(BuyerOrderPayment.safeParse({ checkoutUrl: null, linkError, recipient }).success).toBe(true);
    }
    expect(BuyerOrderPayment.safeParse({ checkoutUrl: null, linkError: 'other', recipient }).success).toBe(false);
    expect(
      BuyerOrderPayment.safeParse({ checkoutUrl: 'http://127.0.0.1:4010/checkout/TK8F3Q2AXM', linkError: null, recipient })
        .success,
    ).toBe(true);
    for (const checkoutUrl of ['javascript:alert(1)', 'data:text/html,x', '/orders/TK8F3Q2AXM', 'khong-phai-url']) {
      expect(BuyerOrderPayment.safeParse({ checkoutUrl, linkError: null, recipient }).success, checkoutUrl).toBe(false);
    }
  });

  it('link 15 phút, chừa 5 phút trước khi hết hạn (c); đường dẫn thử lại; mã lỗi tài khoản chưa được cho phép', () => {
    expect(PAYMENT_LINK_MINUTES).toBe(15);
    expect(PAYMENT_LINK_GRACE_SECONDS).toBe(300);
    expect(buyerOrderApiPath('TK8F3Q2AXM')).toBe('/me/orders/TK8F3Q2AXM');
    expect(paymentLinkApiPath('TK8F3Q2AXM')).toBe('/me/orders/TK8F3Q2AXM/payment-link');
    expect(paymentLinkApiPath('a/b')).toBe('/me/orders/a%2Fb/payment-link');
    expect(buyerOrderLiveApiPath('TK8F3Q2AXM')).toBe('/me/orders/TK8F3Q2AXM/live');
    expect(buyerOrderLiveApiPath('a/b')).toBe('/me/orders/a%2Fb/live');
    expect(ErrorCode.PAYMENT_ACCOUNT_NOT_ALLOWED).toBe('PAYMENT_ACCOUNT_NOT_ALLOWED');
  });
});

describe('Mã QR vé và BuyerTicket', () => {
  it('t<k>.<ticketId>.<sig 43 ký tự base64url>; không nhận biến thể sai', () => {
    expect(TICKET_QR_PATTERN.test(QR)).toBe(true);
    expect(TICKET_QR_PATTERN.test(`t12.${TICKET}.${SIG}`)).toBe(true);
    for (const bad of [
      `t0.${TICKET}.${SIG}`,
      `t01.${TICKET}.${SIG}`,
      `v1.${TICKET}.${SIG}`,
      `t1.${TICKET.toUpperCase()}.${SIG}`,
      `t1.${TICKET}.${SIG}=`,
      `t1.${TICKET}.${SIG.slice(1)}`,
      `t1.${TICKET}.${SIG.slice(0, -1)}+`,
      `t1.khong-phai-uuid.${SIG}`,
      `t1.${TICKET}`,
      ` ${QR}`,
    ]) {
      expect(TICKET_QR_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('BuyerTicket: seq/count ≥ 1, qr đúng mẫu, shareToken 22 ký tự base64url', () => {
    expect(BuyerTicket.parse(ticket(1, 1))).toEqual(ticket(1, 1));
    expect(BuyerTicket.safeParse({ ...ticket(1, 1), seq: 0 }).success).toBe(false);
    expect(BuyerTicket.safeParse({ ...ticket(1, 1), qr: 'abc' }).success).toBe(false);
    for (const shareToken of [undefined, '', SHARE_TOKEN.slice(1), `${SHARE_TOKEN}A`, `${SHARE_TOKEN.slice(1)}=`, `${SHARE_TOKEN.slice(1)}+`]) {
      expect(BuyerTicket.safeParse({ ...ticket(1, 1), shareToken }).success, String(shareToken)).toBe(false);
    }
  });
});
