import { createHash } from 'node:crypto';
import { ErrorResponse, SharedTicketView, TicketShareLink, type BuyerOrderView } from '@tickee/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { shareTokenOf, TicketQrKeys, verifyTicketQr } from '../../src/modules/ticketing/index.js';
import { SHARE_KEY_LABEL } from '../../src/modules/ticketing/share-token.js';
import { REDACTED } from '../../src/platform/logging/index.js';
import { TEST_TICKET_QR_KEYS } from '../helpers.js';
import { createHarness, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
  type User,
} from '../ordering/order-fixtures.js';

/*
 * Story 3.8, AD-29: link chia sẻ Vé. Token suy bằng HMAC (khóa con của `TICKET_QR_KEYS`), DB chỉ lưu hash; `GET
 * /v1/shared-tickets/:token` công khai, không PII, chỉ đọc, 404 chung; chủ Vé tạo lại link (link cũ chết, QR không đổi).
 * Vé lấy từ Đơn 0đ (`markPaid` nguồn `free`) trên Postgres thật.
 */

const qrKeys = TicketQrKeys.parse(TEST_TICKET_QR_KEYS);
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const errorOf = (body: unknown) => ErrorResponse.parse(body).error;

let h: Harness;
let org: Org;

beforeAll(async () => {
  h = await createHarness({}, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(h, { name: 'CLB Cầu lông Quận 3' });
});
beforeEach(async () => {
  await resetOrderRateLimit(h);
});
afterAll(async () => {
  await h.close();
});

interface Placed {
  buyer: User;
  eventId: string;
  order: BuyerOrderView;
}

/** Người mua mới nhận `quantity` Vé 0đ ở Sự kiện mới (có địa điểm). */
async function freeTickets(quantity = 2): Promise<Placed> {
  const buyer = await signUp(h);
  const sale = await eventOnSale(org, [{ name: 'Vé tham dự', price: 0, capacity: 10 }]);
  await h.db.pool.query("UPDATE events SET venue = 'Nhà thi đấu Phú Thọ' WHERE id = $1", [sale.event.id]);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  expect(order.tickets).toHaveLength(quantity);
  return { buyer, eventId: sale.event.id, order };
}

const shared = (token: string) => h.http.get(`/v1/shared-tickets/${token}`);
const regenerate = (user: User | null, ticketId: string) => {
  const req = h.http.post(`/v1/me/tickets/${ticketId}/share-link`);
  return user ? req.set('cookie', user.cookie) : req;
};

async function ticketRow(id: string) {
  const { rows } = await h.db.pool.query<{
    share_version: number;
    share_token_hash: string | null;
    updated_at: Date;
    qr_key_version: number;
  }>('SELECT share_version, share_token_hash, updated_at, qr_key_version FROM tickets WHERE id = $1', [id]);
  return rows[0]!;
}

async function auditRows(ticketId: string) {
  const { rows } = await h.db.pool.query<{ action: string; actor_user_id: string; organization_id: string; target_type: string }>(
    'SELECT action, actor_user_id, organization_id, target_type FROM audit_events WHERE target_id = $1 ORDER BY created_at',
    [ticketId],
  );
  return rows;
}

/** 404 chung: cùng mã, cùng câu, `details` null. */
async function expectNotFound(token: string, label: string): Promise<void> {
  const res = await shared(token);
  expect(res.status, label).toBe(404);
  expect(res.body, label).toEqual({
    error: { code: 'SHARED_TICKET_NOT_FOUND', message: 'Link không đúng hoặc không còn hiệu lực.', details: null },
  });
}

describe('token link chia sẻ (HMAC, AD-29)', () => {
  it('mỗi Vé một token 22 ký tự base64url, suy từ (id Vé, share_version 1, khóa QR); DB chỉ lưu sha256 hex, không lưu token', async () => {
    const { order } = await freeTickets(2);
    const tokens = order.tickets.map((t) => t.shareToken);
    expect(new Set(tokens).size).toBe(2);
    for (const ticket of order.tickets) {
      expect(ticket.shareToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(ticket.shareToken).toBe(shareTokenOf(qrKeys, ticket.id, 1, 1));
      const row = await ticketRow(ticket.id);
      expect(row).toMatchObject({ share_version: 1, share_token_hash: sha256(ticket.shareToken), qr_key_version: 1 });
      expect(row.share_token_hash).not.toContain(ticket.shareToken);
    }
    // Không trùng với chữ ký Mã QR (khóa con tách miền).
    const firstQr = order.tickets[0]!.qr;
    expect(firstQr.slice(firstQr.lastIndexOf('.') + 1)).not.toContain(order.tickets[0]!.shareToken);
    expect(SHARE_KEY_LABEL).not.toMatch(/^t\d+\./);
  });

  it('khóa khác hoặc phiên bản khác → token khác; cùng đầu vào → cùng token', () => {
    const id = '019a3b2c-0b00-7abc-8def-000000000001';
    const other = TicketQrKeys.parse(`v1:${Buffer.alloc(32, 3).toString('base64')}`);
    expect(shareTokenOf(qrKeys, id, 1, 1)).toBe(shareTokenOf(qrKeys, id.toUpperCase(), 1, 1));
    expect(shareTokenOf(qrKeys, id, 1, 2)).not.toBe(shareTokenOf(qrKeys, id, 1, 1));
    expect(shareTokenOf(other, id, 1, 1)).not.toBe(shareTokenOf(qrKeys, id, 1, 1));
    expect(() => shareTokenOf(qrKeys, id, 9, 1)).toThrow(/v9/);
  });

  it('chủ Đơn đọc lại Trang Đơn nhiều lần → cùng một token (bấm "Chia sẻ Vé" lặp ra cùng link)', async () => {
    const { buyer, order } = await freeTickets(1);
    const again = parseOrder((await h.http.get(`/v1/me/orders/${order.code}`).set('cookie', buyer.cookie).expect(200)).body);
    expect(again.tickets.map((t) => t.shareToken)).toEqual(order.tickets.map((t) => t.shareToken));
  });
});

describe('GET /v1/shared-tickets/:token', () => {
  it('không cookie → 200 no-store: QR, Sự kiện, địa điểm, Hạng vé, "Vé k/N", valid; không tên, SĐT, email, mã Đơn, id user', async () => {
    const { buyer, order } = await freeTickets(2);
    const second = order.tickets[1]!;
    const res = await shared(second.shareToken).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(SharedTicketView.parse(res.body)).toEqual({
      eventName: order.event.name,
      eventStartsAt: order.event.startsAt,
      venue: 'Nhà thi đấu Phú Thọ',
      ticketTypeName: 'Vé tham dự',
      seq: 2,
      count: 2,
      status: 'valid',
      qr: second.qr,
    });
    expect(Object.keys(res.body as object).sort()).toEqual(
      ['count', 'eventName', 'eventStartsAt', 'qr', 'seq', 'status', 'ticketTypeName', 'venue'].sort(),
    );
    expect(verifyTicketQr(qrKeys, (res.body as SharedTicketView).qr)).toEqual({ ticketId: second.id, keyVersion: 1 });
    for (const secret of [order.buyer.name, order.buyer.phone, order.buyer.email, buyer.email, order.code, buyer.userId]) {
      expect(res.text).not.toContain(secret);
    }
  });

  it('chỉ đọc: Vé không đổi (updated_at), không audit; gọi lại vẫn 200 cùng nội dung', async () => {
    const { order } = await freeTickets(1);
    const ticket = order.tickets[0]!;
    const before = await ticketRow(ticket.id);
    const first = await shared(ticket.shareToken).expect(200);
    const second = await shared(ticket.shareToken).expect(200);
    expect(second.body).toEqual(first.body);
    expect(await ticketRow(ticket.id)).toEqual(before);
    expect(await auditRows(ticket.id)).toEqual([]);
  });

  it('Vé đã check-in → status checked_in, vẫn có QR', async () => {
    const { order } = await freeTickets(1);
    const ticket = order.tickets[0]!;
    await h.db.pool.query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [ticket.id]);
    const view = SharedTicketView.parse((await shared(ticket.shareToken).expect(200)).body);
    expect(view).toMatchObject({ status: 'checked_in', qr: ticket.qr });
  });

  it('token sai dạng / không khớp / Vé hủy / Sự kiện hủy / quá effective_end_at → cùng 404 SHARED_TICKET_NOT_FOUND', async () => {
    const valid = (await freeTickets(1)).order.tickets[0]!.shareToken;
    await expectNotFound('ngan-qua', 'sai dạng');
    await expectNotFound(`${valid}A`, 'dài hơn 22');
    await expectNotFound(encodeURIComponent(`${valid.slice(1)}=`), 'ký tự lạ');
    await expectNotFound('AAAAAAAAAAAAAAAAAAAAAA', 'đúng dạng, không khớp');

    const cancelledTicket = (await freeTickets(1)).order.tickets[0]!;
    await h.db.pool.query("UPDATE tickets SET status = 'cancelled', cancel_reason = 'voided' WHERE id = $1", [
      cancelledTicket.id,
    ]);
    await expectNotFound(cancelledTicket.shareToken, 'Vé hủy');

    const cancelledEvent = await freeTickets(1);
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [cancelledEvent.eventId]);
    await expectNotFound(cancelledEvent.order.tickets[0]!.shareToken, 'Sự kiện hủy');

    const ended = await freeTickets(1);
    await shared(ended.order.tickets[0]!.shareToken).expect(200);
    await h.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = $1", [ended.eventId]);
    await expectNotFound(ended.order.tickets[0]!.shareToken, 'quá effective_end_at');
  });

  it('Vé phát trước 3.8 (hash NULL) → link 404 tới khi chủ Vé tạo lại', async () => {
    const { buyer, order } = await freeTickets(1);
    const ticket = order.tickets[0]!;
    await h.db.pool.query('UPDATE tickets SET share_token_hash = NULL WHERE id = $1', [ticket.id]);
    await expectNotFound(ticket.shareToken, 'chưa có hash');
    const { shareToken } = TicketShareLink.parse((await regenerate(buyer, ticket.id).expect(200)).body);
    await shared(shareToken).expect(200);
  });

  it('log request che token trong đường dẫn; token không xuất hiện ở log nào', async () => {
    const { order } = await freeTickets(1);
    const token = order.tickets[0]!.shareToken;
    await shared(token).expect(200);
    await shared(`${token.slice(0, 21)}x`).expect(404);
    const lines = h.logs.lines.filter((l) => {
      const req = l.req as { url?: string } | undefined;
      return typeof req?.url === 'string' && req.url.startsWith('/v1/shared-tickets/');
    });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect((line.req as { url: string; params?: unknown }).url).toBe(`/v1/shared-tickets/${REDACTED}`);
      expect((line.req as { params?: unknown }).params).toBeUndefined();
    }
    expect(h.logs.text).not.toContain(token);
  });
});

describe('POST /v1/me/tickets/:ticketId/share-link', () => {
  it('chủ Vé tạo lại → 200 token mới; link cũ 404 ngay, link mới mở được; QR không đổi; share_version 2; audit; Trang Đơn trả token mới', async () => {
    const { buyer, order } = await freeTickets(2);
    const [ticket, sibling] = order.tickets as [BuyerOrderView['tickets'][0], BuyerOrderView['tickets'][0]];
    const res = await regenerate(buyer, ticket.id).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { shareToken } = TicketShareLink.parse(res.body);
    expect(shareToken).not.toBe(ticket.shareToken);
    expect(shareToken).toBe(shareTokenOf(qrKeys, ticket.id, 1, 2));

    await expectNotFound(ticket.shareToken, 'link cũ');
    const view = SharedTicketView.parse((await shared(shareToken).expect(200)).body);
    expect(view).toMatchObject({ seq: 1, count: 2, qr: ticket.qr });
    // Vé khác của Đơn không bị ảnh hưởng.
    await shared(sibling.shareToken).expect(200);

    expect(await ticketRow(ticket.id)).toMatchObject({ share_version: 2, share_token_hash: sha256(shareToken) });
    expect(await auditRows(ticket.id)).toEqual([
      {
        action: 'ticket.share_link_regenerated',
        actor_user_id: buyer.userId,
        organization_id: org.orgId,
        target_type: 'ticket',
      },
    ]);
    const reloaded = parseOrder((await h.http.get(`/v1/me/orders/${order.code}`).set('cookie', buyer.cookie).expect(200)).body);
    expect(reloaded.tickets.map((t) => [t.shareToken, t.qr])).toEqual([
      [shareToken, ticket.qr],
      [sibling.shareToken, sibling.qr],
    ]);

    // Tạo lại lần nữa: link thứ hai cũng chết.
    const third = TicketShareLink.parse((await regenerate(buyer, ticket.id).expect(200)).body).shareToken;
    await expectNotFound(shareToken, 'link thứ hai');
    await shared(third).expect(200);
  });

  it('Vé của người khác, id lạ, id sai dạng → 404 TICKET_NOT_FOUND, không đổi gì; chưa đăng nhập → 401', async () => {
    const { order } = await freeTickets(1);
    const ticket = order.tickets[0]!;
    const before = await ticketRow(ticket.id);
    const stranger = await signUp(h);
    for (const id of [ticket.id, '019a3b2c-0b00-7abc-8def-0000000000ff', 'khong-phai-uuid']) {
      const res = await regenerate(stranger, id).expect(404);
      expect(errorOf(res.body).code, id).toBe('TICKET_NOT_FOUND');
    }
    expect(errorOf((await regenerate(null, ticket.id).expect(401)).body).code).toBe('UNAUTHENTICATED');
    expect(await ticketRow(ticket.id)).toEqual(before);
    expect(await auditRows(ticket.id)).toEqual([]);
    await shared(ticket.shareToken).expect(200);
  });

  it('Vé đã hủy, Sự kiện đã hủy, quá effective_end_at → 404 TICKET_NOT_FOUND', async () => {
    const cancelledTicket = await freeTickets(1);
    await h.db.pool.query("UPDATE tickets SET status = 'cancelled' WHERE id = $1", [cancelledTicket.order.tickets[0]!.id]);
    const cancelledEvent = await freeTickets(1);
    await h.db.pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [cancelledEvent.eventId]);
    const ended = await freeTickets(1);
    await h.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = $1", [ended.eventId]);
    for (const placed of [cancelledTicket, cancelledEvent, ended]) {
      const ticket = placed.order.tickets[0]!;
      const res = await regenerate(placed.buyer, ticket.id).expect(404);
      expect(errorOf(res.body).code).toBe('TICKET_NOT_FOUND');
      expect((await ticketRow(ticket.id)).share_version).toBe(1);
    }
  });

  it('tickee_app ghi được share_version, share_token_hash; DB chặn hash sai dạng, share_version < 1, hash trùng', async () => {
    const { order } = await freeTickets(2);
    const [a, b] = order.tickets as [BuyerOrderView['tickets'][0], BuyerOrderView['tickets'][0]];
    const update = (set: string, id: string) => h.db.pool.query(`UPDATE tickets SET ${set} WHERE id = $1`, [id]);
    await expect(update("share_token_hash = 'khong-phai-hex'", a.id)).rejects.toMatchObject({ code: '23514' });
    await expect(update('share_version = 0', a.id)).rejects.toMatchObject({ code: '23514' });
    await expect(update(`share_token_hash = '${sha256(b.shareToken)}'`, a.id)).rejects.toMatchObject({ code: '23505' });
    await update('share_version = 7', a.id);
    expect((await ticketRow(a.id)).share_version).toBe(7);
  });
});
