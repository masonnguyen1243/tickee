import { CreateOrderRequest, ErrorCode, orderRequestFor, type FormQuestion } from '@tickee/contracts';
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import {
  fieldErrors,
  firstErrorField,
  initialValues,
  isRetryableSubmitError,
  notOnSaleMessage,
  orderRequest,
  rateLimitedMessage,
  serverFieldErrors,
  type CheckoutValues,
} from '@/lib/order/checkout-form';

const A = '019a3b2c-0800-7abc-8def-000000000001';
const Q_SIZE = '019a3b2c-0900-7abc-8def-000000000001';
const Q_LEVEL = '019a3b2c-0900-7abc-8def-000000000002';
const Q_NOTE = '019a3b2c-0900-7abc-8def-000000000003';
const OPT_1 = '019a3b2c-0a00-7abc-8def-000000000001';
const FUNNEL = '5f0c6b8e-2a4d-4c1e-9b7a-3d2f1e0a9c8b';

const questions: FormQuestion[] = [
  { id: Q_SIZE, position: 0, label: 'Size áo', kind: 'text', required: true, options: [] },
  {
    id: Q_LEVEL,
    position: 1,
    label: 'Trình độ',
    kind: 'choice',
    required: true,
    options: [{ id: OPT_1, label: 'Mới chơi' }],
  },
  { id: Q_NOTE, position: 2, label: 'Ghi chú', kind: 'text', required: false, options: [] },
];

const valid: CheckoutValues = { name: 'An', phone: '0912 345 678', answers: { [Q_SIZE]: 'M', [Q_LEVEL]: OPT_1 } };

describe('initialValues', () => {
  it('tự điền tên; SĐT E.164 hiện dạng 0…; chưa có SĐT → rỗng', () => {
    const form = { questions, buyer: { name: 'An', phone: '+84912345678', email: 'an@vidu.vn' } };
    expect(initialValues(form)).toEqual({ name: 'An', phone: '0912345678', answers: {} });
    expect(initialValues({ ...form, buyer: { ...form.buyer, name: '', phone: null } })).toEqual({
      name: '',
      phone: '',
      answers: {},
    });
  });
});

describe('fieldErrors', () => {
  it('hợp lệ → {}', () => {
    expect(fieldErrors(valid, questions)).toEqual({});
  });

  it('mọi trường sai cùng lúc, câu báo theo loại câu hỏi; trường đầu tiên theo thứ tự màn hình', () => {
    const errors = fieldErrors({ name: '  ', phone: '123', answers: { [Q_NOTE]: 'x'.repeat(1001) } }, questions);
    expect(errors).toEqual({
      name: 'Nhập tên của bạn.',
      phone: 'Số điện thoại chưa đúng (vd. 0912 345 678).',
      [Q_SIZE]: 'Câu này bắt buộc.',
      [Q_LEVEL]: 'Chọn một phương án.',
      [Q_NOTE]: 'Tối đa 1.000 ký tự.',
    });
    expect(firstErrorField(errors, questions)).toBe('name');
    expect(firstErrorField({ [Q_LEVEL]: 'x', phone: 'y' }, questions)).toBe('phone');
    expect(firstErrorField({}, questions)).toBeNull();
    expect(fieldErrors({ ...valid, phone: '' }, questions)).toEqual({ phone: 'Nhập số điện thoại.' });
  });

  it('khớp schema của API: form hợp lệ ở web thì body hợp lệ với orderRequestFor', () => {
    const body = orderRequest(valid, [{ ticketTypeId: A, quantity: 2 }], FUNNEL);
    expect(orderRequestFor({ maxTicketsPerOrder: 10 }, questions).safeParse(body).success).toBe(true);
    const bad = orderRequest({ ...valid, answers: {} }, [{ ticketTypeId: A, quantity: 2 }], null);
    expect(orderRequestFor({ maxTicketsPerOrder: 10 }, questions).safeParse(bad).success).toBe(false);
  });
});

describe('orderRequest', () => {
  it('bỏ câu trả lời trống; funnelId đi kèm; không có email', () => {
    const body = orderRequest({ ...valid, answers: { ...valid.answers, [Q_NOTE]: '  ' } }, [{ ticketTypeId: A, quantity: 1 }], FUNNEL);
    expect(body).toEqual({
      items: [{ ticketTypeId: A, quantity: 1 }],
      buyer: { name: 'An', phone: '0912 345 678' },
      answers: { [Q_SIZE]: 'M', [Q_LEVEL]: OPT_1 },
      funnelId: FUNNEL,
    });
    expect(CreateOrderRequest.safeParse(body).success).toBe(true);
  });
});

describe('serverFieldErrors', () => {
  const error = (paths: string[]) =>
    new ApiError(ErrorCode.VALIDATION_FAILED, 'x', { issues: paths.map((path) => ({ path, code: 'custom' })) }, 400);

  it('buyer.* và answers.<id> → lỗi tại trường; còn lại → unmatched', () => {
    const result = serverFieldErrors(
      error(['buyer.phone', `answers.${Q_SIZE}`, 'items', `answers.${A}`]),
      { ...valid, phone: '1', answers: { [Q_LEVEL]: OPT_1 } },
      questions,
    );
    expect(result.errors).toEqual({
      phone: 'Số điện thoại chưa đúng (vd. 0912 345 678).',
      [Q_SIZE]: 'Câu này bắt buộc.',
    });
    expect(result.unmatched).toEqual(['items', `answers.${A}`]);
  });

  it('API báo lỗi mà web thấy hợp lệ → câu chung tại trường', () => {
    expect(serverFieldErrors(error(['buyer.name']), valid, questions).errors).toEqual({
      name: 'Kiểm tra lại câu trả lời này.',
    });
  });
});

describe('câu báo lỗi gửi Đơn', () => {
  const tiers = [{ id: A, name: 'Đôi nam' }];

  it('NOT_ON_SALE theo lý do', () => {
    expect(notOnSaleMessage({ ticketTypeId: A, reason: 'paused' }, tiers)).toBe(
      'Hạng vé Đôi nam đang tạm ngừng bán. Bạn chọn lại nhé.',
    );
    expect(notOnSaleMessage({ ticketTypeId: A, reason: 'closed' }, tiers)).toBe(
      'Hạng vé Đôi nam đã đóng bán. Bạn chọn lại nhé.',
    );
    expect(notOnSaleMessage({ reason: 'hidden' }, tiers)).toBe('Sự kiện tạm dừng nhận Đơn.');
    expect(notOnSaleMessage(null, tiers)).toBe('Sự kiện hiện không nhận Đơn.');
  });

  it('quá nhanh: số phút làm tròn lên', () => {
    const limited = (seconds: number) =>
      new ApiError(ErrorCode.ORDER_RATE_LIMITED, 'x', { retryAfterSeconds: seconds }, 429);
    expect(rateLimitedMessage(limited(61))).toBe('Bạn gửi Đơn quá nhanh. Thử lại sau 2 phút.');
    expect(rateLimitedMessage(limited(5))).toBe('Bạn gửi Đơn quá nhanh. Thử lại sau 1 phút.');
  });

  it('chỉ lỗi mạng và 5xx mới "Thử lại" cùng khóa', () => {
    expect(isRetryableSubmitError(new ApiError(ErrorCode.SERVICE_UNAVAILABLE, 'x', null, null))).toBe(true);
    expect(isRetryableSubmitError(new ApiError(ErrorCode.INTERNAL_ERROR, 'x', null, 500))).toBe(true);
    expect(isRetryableSubmitError(new ApiError(ErrorCode.NOT_ON_SALE, 'x', null, 409))).toBe(false);
    expect(isRetryableSubmitError(new Error('x'))).toBe(false);
  });
});
