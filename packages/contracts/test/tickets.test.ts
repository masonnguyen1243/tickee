import { describe, expect, it } from 'vitest';
import { BuyerEmailKind, JobQueue, SendBuyerEmailPayload } from '../src/jobs.js';
import { SHARE_TOKEN_PATTERN } from '../src/order.js';
import { PII_KEYS } from '../src/pii.js';
import {
  SHARED_TICKET_PATH,
  SharedTicketView,
  sharedTicketApiPath,
  sharedTicketUrl,
  TicketShareLink,
  ticketShareLinkApiPath,
} from '../src/tickets.js';

const TICKET = '019a3b2c-0b00-7abc-8def-000000000001';
const ORDER = '019a3b2c-0c00-7abc-8def-000000000001';
const QR = `t1.${TICKET}.${'q'.repeat(43)}`;
const TOKEN = 'Zx9_aB3-kLm0Qr7Tu1Vw2y';

const view = {
  eventName: 'Giải Pickleball mùa thu',
  eventStartsAt: '2099-11-16T07:00:00+07:00',
  venue: 'Sân Phú Nhuận',
  ticketTypeName: 'Đơn nam',
  seq: 1,
  count: 2,
  status: 'valid',
  qr: QR,
};

describe('link chia sẻ Vé (AD-29)', () => {
  it('token: đúng 22 ký tự base64url không đệm', () => {
    expect(SHARE_TOKEN_PATTERN.test(TOKEN)).toBe(true);
    for (const bad of ['', TOKEN.slice(1), `${TOKEN}A`, `${TOKEN.slice(1)}=`, `${TOKEN.slice(1)}+`, `${TOKEN.slice(1)}/`]) {
      expect(SHARE_TOKEN_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('URL công khai: token sau `#` của /xem-ve, bỏ `/` thừa của origin; không có query', () => {
    expect(SHARED_TICKET_PATH).toBe('/xem-ve');
    expect(sharedTicketUrl('https://tickee.vn', TOKEN)).toBe(`https://tickee.vn/xem-ve#${TOKEN}`);
    expect(sharedTicketUrl('https://tickee.vn//', TOKEN)).toBe(`https://tickee.vn/xem-ve#${TOKEN}`);
    expect(new URL(sharedTicketUrl('https://tickee.vn', TOKEN)).search).toBe('');
  });

  it('đường API tương đối với /v1', () => {
    expect(sharedTicketApiPath(TOKEN)).toBe(`/shared-tickets/${TOKEN}`);
    expect(ticketShareLinkApiPath(TICKET)).toBe(`/me/tickets/${TICKET}/share-link`);
  });

  it('SharedTicketView: đủ trường hiển thị, trạng thái valid | checked_in, venue có thể null', () => {
    expect(SharedTicketView.parse(view)).toEqual(view);
    expect(SharedTicketView.parse({ ...view, venue: null, status: 'checked_in' }).status).toBe('checked_in');
    expect(SharedTicketView.safeParse({ ...view, status: 'cancelled' }).success).toBe(false);
    expect(SharedTicketView.safeParse({ ...view, qr: 'abc' }).success).toBe(false);
    expect(SharedTicketView.safeParse({ ...view, seq: 0 }).success).toBe(false);
  });

  it('SharedTicketView không có trường nào là PII hay mã Đơn', () => {
    const keys = Object.keys(SharedTicketView.shape);
    for (const key of keys) expect(PII_KEYS, key).not.toContain(key);
    for (const key of ['holderName', 'buyerName', 'buyerEmail', 'buyerPhone', 'orderCode', 'userId', 'code']) {
      expect(keys).not.toContain(key);
    }
  });

  it('TicketShareLink: chỉ token đúng mẫu', () => {
    expect(TicketShareLink.parse({ shareToken: TOKEN })).toEqual({ shareToken: TOKEN });
    expect(TicketShareLink.safeParse({ shareToken: 'ngan' }).success).toBe(false);
  });
});

describe('job email Người mua', () => {
  it('tên queue và dead-letter', () => {
    expect(JobQueue.ORDERING_SEND_BUYER_EMAIL).toBe('ordering.send-buyer-email');
    expect(JobQueue.ORDERING_SEND_BUYER_EMAIL_DEAD_LETTER).toBe('ordering.send-buyer-email.dead-letter');
  });

  it('payload chỉ { kind, orderId }: loại lạ, id sai dạng → không nhận; trường thừa bị bỏ', () => {
    expect(SendBuyerEmailPayload.parse({ kind: BuyerEmailKind.TICKETS, orderId: ORDER })).toEqual({
      kind: 'tickets',
      orderId: ORDER,
    });
    expect(SendBuyerEmailPayload.parse({ kind: 'orphan_sold_out', orderId: ORDER, email: 'a@b.vn' })).toEqual({
      kind: 'orphan_sold_out',
      orderId: ORDER,
    });
    expect(SendBuyerEmailPayload.safeParse({ kind: 'receipt', orderId: ORDER }).success).toBe(false);
    expect(SendBuyerEmailPayload.safeParse({ kind: 'tickets', orderId: 'TK8F3Q2AXM' }).success).toBe(false);
  });
});
