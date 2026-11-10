import { describe, expect, it } from 'vitest';
import {
  checkoutPath,
  eventPagePath,
  FUNNEL_EVENT_TYPES,
  FunnelEventInput,
  parseSelection,
  serializeSelection,
} from '../src/checkout.js';
import { safeReturnTo } from '../src/identity.js';

const A = '019a3b2c-0800-7abc-8def-000000000001';
const B = '019a3b2c-0800-7abc-8def-000000000002';
const FUNNEL = '5f0c6b8e-2a4d-4c1e-9b7a-3d2f1e0a9c8b';

describe('lựa chọn Vé trong URL (items=<ticketTypeId>:<qty>[,…])', () => {
  it('hợp lệ: giữ thứ tự; serialize là ngược của parse', () => {
    const raw = `${B}:2,${A}:1`;
    const items = parseSelection(raw);
    expect(items).toEqual([
      { ticketTypeId: B, quantity: 2 },
      { ticketTypeId: A, quantity: 1 },
    ]);
    expect(serializeSelection(items!)).toBe(raw);
    expect(parseSelection(`${A}:50`)).toEqual([{ ticketTypeId: A, quantity: 50 }]);
  });

  it('id trùng → null, kể cả khác hoa/thường; id chữ hoa về chữ thường', () => {
    expect(parseSelection(`${A}:1,${A}:2`)).toBeNull();
    expect(parseSelection(`${A.toUpperCase()}:1,${A}:2`)).toBeNull();
    expect(parseSelection(`${A.toUpperCase()}:2`)).toEqual([{ ticketTypeId: A, quantity: 2 }]);
  });

  it.each([
    ['0', `${A}:0`],
    ['âm', `${A}:-1`],
    ['thập phân', `${A}:1.5`],
    ['số mũ', `${A}:1e1`],
    ['số 0 đứng đầu', `${A}:02`],
    ['có khoảng trắng', `${A}: 2`],
    ['> 50', `${A}:51`],
    ['rất dài', `${A}:${'9'.repeat(400)}`],
    ['thiếu số', `${A}:`],
    ['thiếu id', ':2'],
  ])('số lượng/khóa sai (%s) → null', (_label, raw) => {
    expect(parseSelection(raw)).toBeNull();
  });

  it.each([
    [''],
    ['rác'],
    [','],
    [`${A}:1,`],
    [`${A}:1:2`],
    ['khong-phai-uuid:1'],
    [`${A}:1;${B}:1`],
    [undefined],
    [null],
    [['a', 'b']],
    [42],
  ])('chuỗi rác %j → null', (raw) => {
    expect(parseSelection(raw)).toBeNull();
  });

  it('đường dẫn Checkout giữ nguyên qua returnTo (safeReturnTo giữ query)', () => {
    expect(eventPagePath('giai-chay-ab12')).toBe('/e/giai-chay-ab12');
    expect(checkoutPath('giai-chay-ab12')).toBe('/e/giai-chay-ab12/checkout');
    const target = `${checkoutPath('giai-chay-ab12')}?items=${A}:2,${B}:1&f=${FUNNEL}`;
    expect(safeReturnTo(target)).toBe(target);
  });
});

describe('FunnelEventInput', () => {
  it('bốn loại sự kiện phễu; order_created và paid chỉ API ghi (không gửi qua funnel-events)', () => {
    expect(FUNNEL_EVENT_TYPES).toEqual(['buy_clicked', 'login_completed', 'order_created', 'paid']);
    expect(FunnelEventInput.safeParse({ type: 'order_created', funnelId: FUNNEL }).success).toBe(false);
    expect(FunnelEventInput.safeParse({ type: 'paid', funnelId: FUNNEL }).success).toBe(false);
  });

  it('buy_clicked cần loginRequired; login_completed chỉ có funnelId', () => {
    expect(FunnelEventInput.parse({ type: 'buy_clicked', funnelId: FUNNEL, loginRequired: true })).toEqual({
      type: 'buy_clicked',
      funnelId: FUNNEL,
      loginRequired: true,
    });
    expect(FunnelEventInput.parse({ type: 'login_completed', funnelId: FUNNEL })).toEqual({
      type: 'login_completed',
      funnelId: FUNNEL,
    });
    expect(FunnelEventInput.safeParse({ type: 'buy_clicked', funnelId: FUNNEL }).success).toBe(false);
  });

  it.each([
    [{ type: 'paid', funnelId: FUNNEL }],
    [{ type: 'login_completed', funnelId: 'khong-phai-uuid' }],
    [{ type: 'login_completed' }],
    // Không nhận trường lạ (không để lọt PII như email).
    [{ type: 'login_completed', funnelId: FUNNEL, email: 'a@vidu.vn' }],
    [{ type: 'buy_clicked', funnelId: FUNNEL, loginRequired: 'true' }],
    [null],
    ['buy_clicked'],
  ])('sai: %j', (body) => {
    expect(FunnelEventInput.safeParse(body).success).toBe(false);
  });
});
