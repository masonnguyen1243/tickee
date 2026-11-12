import { describe, expect, it } from 'vitest';
import {
  EXPIRED_ORDER_VISIBLE_MINUTES,
  MY_TICKETS_API_PATH,
  MY_TICKETS_LIVE_API_PATH,
  MY_TICKETS_PATH,
  MyPendingOrder,
  MyTicketDetail,
  MyTicketHistoryItem,
  MyTicketItem,
  MyTicketsView,
  myTicketApiPath,
  myTicketPath,
} from '../src/my-tickets.js';

const TICKET = '019a3b2c-0b00-7abc-8def-000000000001';
const QR = `t1.${TICKET}.${'q'.repeat(43)}`;
const TOKEN = 'Zx9_aB3-kLm0Qr7Tu1Vw2y';
const EVENT = { name: 'Giải Pickleball mùa thu', startsAt: '2099-11-16T07:00:00+07:00', venue: 'Sân Phú Nhuận' };
const ORGANIZER = { name: 'CLB ABC', contactPhone: '0901234567', contactEmail: null };

const item = {
  id: TICKET,
  event: EVENT,
  ticketTypeName: 'Đơn nam',
  seq: 1,
  count: 2,
  orderCode: 'TK8F3Q2AXM',
  status: 'valid',
};

const pending = {
  code: 'TK8F3Q2AXN',
  buyerStatus: 'awaiting_payment',
  event: { ...EVENT, venue: null },
  items: [{ name: 'Đôi nam', quantity: 2 }],
  totalAmount: 400_000,
  expiresAt: '2099-11-10T08:15:00.000Z',
  organizer: ORGANIZER,
};

const history = {
  id: TICKET,
  eventName: EVENT.name,
  eventStartsAt: EVENT.startsAt,
  ticketTypeName: 'Đơn nam',
  seq: 2,
  count: 2,
  attended: true,
};

const detail = {
  id: TICKET,
  event: EVENT,
  ticketTypeName: 'Đơn nam',
  seq: 1,
  count: 2,
  holderName: 'Nguyễn Văn An',
  status: 'valid',
  attended: false,
  eventCancelled: false,
  ended: false,
  qr: QR,
  shareToken: TOKEN,
  organizer: ORGANIZER,
  receipt: {
    orderCode: 'TK8F3Q2AXM',
    items: [{ name: 'Đơn nam', unitPrice: 200_000, quantity: 2, amount: 400_000 }],
    totalAmount: 400_000,
    paidAt: '2099-11-10T08:05:00.000Z',
  },
};

describe('đường dẫn Vé của tôi', () => {
  it('web: /tickets và /tickets/:ticketId; API tương đối với /v1', () => {
    expect(MY_TICKETS_PATH).toBe('/tickets');
    expect(myTicketPath(TICKET)).toBe(`/tickets/${TICKET}`);
    expect(myTicketPath('a/b')).toBe('/tickets/a%2Fb');
    expect(MY_TICKETS_API_PATH).toBe('/me/tickets');
    expect(MY_TICKETS_LIVE_API_PATH).toBe('/me/tickets/live');
    expect(myTicketApiPath(TICKET)).toBe(`/me/tickets/${TICKET}`);
  });

  it('Đơn hết hạn còn hiện 30 phút sau expires_at', () => {
    expect(EXPIRED_ORDER_VISIBLE_MINUTES).toBe(30);
  });
});

describe('MyTicketsView', () => {
  it('ba nhóm + serverNow; danh sách không có trường QR hay token chia sẻ', () => {
    const view = { serverNow: '2099-11-10T08:00:00.000Z', active: [item], pending: [pending], history: [history] };
    expect(MyTicketsView.parse(view)).toEqual(view);
    for (const shape of [MyTicketItem.shape, MyPendingOrder.shape, MyTicketHistoryItem.shape]) {
      expect(Object.keys(shape)).not.toContain('qr');
      expect(Object.keys(shape)).not.toContain('shareToken');
    }
  });

  it('trạng thái Vé: valid | checked_in | cancelled', () => {
    for (const status of ['valid', 'checked_in', 'cancelled']) {
      expect(MyTicketItem.parse({ ...item, status }).status).toBe(status);
    }
    expect(MyTicketItem.safeParse({ ...item, status: 'expired' }).success).toBe(false);
  });

  it('Đơn chờ: nhận buyerStatus lạ (máy chủ mới hơn web), cần ít nhất một dòng, mã Đơn đúng mẫu', () => {
    expect(MyPendingOrder.parse({ ...pending, buyerStatus: 'refund_pending' }).buyerStatus).toBe('refund_pending');
    expect(MyPendingOrder.safeParse({ ...pending, items: [] }).success).toBe(false);
    expect(MyPendingOrder.safeParse({ ...pending, code: 'TK123' }).success).toBe(false);
    expect(Object.keys(MyPendingOrder.shape)).not.toContain('reviewType');
    expect(Object.keys(MyPendingOrder.shape)).not.toContain('paidAmount');
  });
});

describe('MyTicketDetail', () => {
  it('Vé hợp lệ: có QR và token chia sẻ, kèm biên nhận', () => {
    expect(MyTicketDetail.parse(detail)).toEqual(detail);
  });

  it('Vé hủy / đã sang lịch sử: QR và token null; Đơn 0đ có tổng 0', () => {
    const cancelled = {
      ...detail,
      status: 'cancelled',
      eventCancelled: true,
      qr: null,
      shareToken: null,
      receipt: { ...detail.receipt, items: [{ name: 'Vé tham dự', unitPrice: 0, quantity: 1, amount: 0 }], totalAmount: 0 },
    };
    expect(MyTicketDetail.parse(cancelled)).toEqual(cancelled);
    expect(MyTicketDetail.parse({ ...detail, ended: true, qr: null, shareToken: null }).ended).toBe(true);
    expect(MyTicketDetail.safeParse({ ...detail, qr: 'abc' }).success).toBe(false);
    expect(MyTicketDetail.safeParse({ ...detail, shareToken: 'ngan' }).success).toBe(false);
    expect(MyTicketDetail.parse({ ...detail, receipt: { ...detail.receipt, paidAt: null } }).receipt.paidAt).toBeNull();
  });
});
