import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MyTicketDetail, SharedTicketView } from '@tickee/contracts';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TICKET_QR_KEY_MISSING_ALERT, TicketQrKeys, verifyTicketQr } from '../../src/modules/ticketing/index.js';
import { EMAIL_TRANSPORT } from '../../src/platform/email/index.js';
import { REDACTED } from '../../src/platform/logging/index.js';
import { WorkerModule } from '../../src/worker.module.js';
import { TEST_TICKET_QR_KEY_V2, TEST_TICKET_QR_KEYS, TEST_WEB_ORIGIN, workerConfig } from '../helpers.js';
import { createHarness, FakeEmailTransport, signUp, type Harness } from '../identity/harness.js';
import {
  eventOnSale,
  orderBody,
  paidReadyOrg,
  parseOrder,
  postOrder,
  rejectingTingee,
  resetOrderRateLimit,
  type Org,
} from '../ordering/order-fixtures.js';

/*
 * E3-5 (retro Epic 3 D1), AD-16 + AD-29: Vé ký bằng khóa QR khác khóa của instance. Ba app api cùng DB, khác
 * `TICKET_QR_KEYS`:
 * - `hOld`: chỉ v1 (khóa test mặc định), phát Vé v1; cũng là instance "chưa có khóa mới" khi đang deploy dần;
 * - `hBoth`: v1 + v2 (đang xoay khóa): Vé mới ký v2, Vé v1 vẫn đọc đúng;
 * - `hNew`: chỉ v2 (khóa cũ đã gỡ).
 * Link chia sẻ của Vé có khóa không có trên instance → 404 chung + log `alert`. Một worker v1 + v2 chạy suốt file, để
 * mọi job email Vé (kể cả Vé v2) xong trong file này, không để lại cho file sau (worker chỉ có v1).
 * Trang Đơn, Chi tiết Vé và email khi thiếu khóa vẫn là lỗi cấu hình (runbook Story 4.7), ngoài phạm vi.
 */

const KEYS_BOTH = `${TEST_TICKET_QR_KEYS},${TEST_TICKET_QR_KEY_V2}`;
const qrKeysBoth = TicketQrKeys.parse(KEYS_BOTH);
const LINK = new RegExp(`${TEST_WEB_ORIGIN.replace(/[.]/g, '\\.')}/xem-ve#([A-Za-z0-9_-]{22})`, 'g');
const NOT_FOUND = {
  error: { code: 'SHARED_TICKET_NOT_FOUND', message: 'Link không đúng hoặc không còn hiệu lực.', details: null },
};

let hOld: Harness;
let hBoth: Harness;
let hNew: Harness;
let org: Org;
let worker: INestApplicationContext;
let workerEmail: FakeEmailTransport;

beforeAll(async () => {
  hOld = await createHarness({}, { overrides: [rejectingTingee] });
  hBoth = await createHarness({ TICKET_QR_KEYS: KEYS_BOTH }, { overrides: [rejectingTingee] });
  hNew = await createHarness({ TICKET_QR_KEYS: TEST_TICKET_QR_KEY_V2 }, { overrides: [rejectingTingee] });
  org = await paidReadyOrg(hOld, { name: 'CLB Bóng bàn Quận 5' });
  workerEmail = new FakeEmailTransport();
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot(workerConfig({ TICKET_QR_KEYS: KEYS_BOTH }))],
  })
    .overrideProvider(EMAIL_TRANSPORT)
    .useValue(workerEmail)
    .compile();
  moduleRef.useLogger(moduleRef.get(PinoNestLogger));
  worker = await moduleRef.init();
});
beforeEach(async () => {
  await resetOrderRateLimit(hOld);
});
afterAll(async () => {
  await worker?.close();
  await hNew?.close();
  await hBoth?.close();
  await hOld?.close();
});

/**
 * Người mua mới nhận `quantity` Vé 0đ ở Sự kiện mới, gửi Đơn qua app `h` (Vé ký bằng khóa hiện hành của `h`). Chờ worker
 * gửi xong email Vé của Đơn, trả cả email đó.
 */
async function freeTickets(h: Harness, quantity = 1) {
  const buyer = await signUp(h);
  const sale = await eventOnSale(org, [{ name: 'Vé tham dự', price: 0, capacity: 10 }]);
  const res = await postOrder(h, buyer, sale.event.slug, orderBody([{ ticketTypeId: sale.tiers[0]!.id, quantity }]));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = parseOrder(res.body);
  expect(order.tickets).toHaveLength(quantity);
  const sentTo = () => workerEmail.sent.filter((m) => m.to === buyer.email);
  await expect.poll(() => sentTo().length, { timeout: 15_000, interval: 100 }).toBe(1);
  return { buyer, order, eventId: sale.event.id, email: sentTo()[0]! };
}

async function keyVersionOf(ticketId: string): Promise<number> {
  const { rows } = await hOld.db.pool.query<{ qr_key_version: number }>(
    'SELECT qr_key_version FROM tickets WHERE id = $1',
    [ticketId],
  );
  return rows[0]!.qr_key_version;
}

/** nestjs-pino giữ một logger gốc cho cả process, nên gom log của cả ba app. */
const allLogs = () => [hOld, hBoth, hNew].flatMap((h) => h.logs.lines);
const alertLines = (ticketId: string) =>
  allLogs().filter((l) => l.alert === TICKET_QR_KEY_MISSING_ALERT && l.ticketId === ticketId);
/** Dòng log request (pino-http) của các lần mở link chia sẻ trả 404; đường dẫn đã che token. */
const sharedNotFoundRequests = () =>
  allLogs().filter(
    (l) =>
      (l.req as { url?: string } | undefined)?.url === `/v1/shared-tickets/${REDACTED}` &&
      (l.res as { statusCode?: number } | undefined)?.statusCode === 404,
  ).length;

describe('khóa của Vé có trên instance', () => {
  it('Vé ký v1: Trang Đơn, Chi tiết Vé và link chia sẻ trên app có v1 + v2 trả đúng QR v1 và cùng token', async () => {
    const { buyer, order } = await freeTickets(hOld, 2);
    const page = parseOrder(
      (await hBoth.http.get(`/v1/me/orders/${order.code}`).set('cookie', buyer.cookie).expect(200)).body,
    );
    expect(page.tickets.map(({ qr, shareToken }) => ({ qr, shareToken }))).toEqual(
      order.tickets.map(({ qr, shareToken }) => ({ qr, shareToken })),
    );
    for (const ticket of order.tickets) {
      expect(await keyVersionOf(ticket.id)).toBe(1);
      expect(verifyTicketQr(qrKeysBoth, ticket.qr)).toEqual({ ticketId: ticket.id, keyVersion: 1 });
      const detail = MyTicketDetail.parse(
        (await hBoth.http.get(`/v1/me/tickets/${ticket.id}`).set('cookie', buyer.cookie).expect(200)).body,
      );
      expect(detail).toMatchObject({ qr: ticket.qr, shareToken: ticket.shareToken });
      const shared = SharedTicketView.parse((await hBoth.http.get(`/v1/shared-tickets/${ticket.shareToken}`).expect(200)).body);
      expect(shared.qr).toBe(ticket.qr);
    }
  });

  it('Vé ký v1 → email Vé (worker v1 + v2) có link tính bằng khóa v1, đúng token của Trang Đơn; mỗi link mở ra đúng Vé', async () => {
    const { order, email } = await freeTickets(hOld, 2);
    const tokens = [...email.text.matchAll(LINK)].map((m) => m[1]!);
    expect(tokens).toEqual(order.tickets.map((t) => t.shareToken));
    for (const [i, token] of tokens.entries()) {
      const shared = SharedTicketView.parse((await hBoth.http.get(`/v1/shared-tickets/${token}`).expect(200)).body);
      expect(shared).toMatchObject({ seq: i + 1, count: 2, qr: order.tickets[i]!.qr });
    }
  });

  it('Vé mới phát trên app có v1 + v2 ký bằng v2 (phiên bản lớn nhất); email và link mở được cả khi chỉ còn v2', async () => {
    const { order, email } = await freeTickets(hBoth, 1);
    const ticket = order.tickets[0]!;
    expect(await keyVersionOf(ticket.id)).toBe(2);
    expect(ticket.qr.startsWith('t2.')).toBe(true);
    expect(verifyTicketQr(qrKeysBoth, ticket.qr)).toEqual({ ticketId: ticket.id, keyVersion: 2 });
    expect([...email.text.matchAll(LINK)].map((m) => m[1]!)).toEqual([ticket.shareToken]);
    for (const h of [hBoth, hNew]) {
      const shared = SharedTicketView.parse((await h.http.get(`/v1/shared-tickets/${ticket.shareToken}`).expect(200)).body);
      expect(shared.qr).toBe(ticket.qr);
    }
  });
});

describe('khóa của Vé không có trên instance', () => {
  it('khóa cũ đã gỡ: link của Vé v1 trên app chỉ có v2 → 404 chung; log error có marker, Vé, Sự kiện, hai phiên bản, không có token', async () => {
    const { order, eventId } = await freeTickets(hOld, 1);
    const ticket = order.tickets[0]!;
    const res = await hNew.http.get(`/v1/shared-tickets/${ticket.shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    await expect.poll(() => alertLines(ticket.id).length).toBe(1);
    expect(alertLines(ticket.id)[0]).toMatchObject({
      level: 50,
      context: 'TicketsService',
      ticketId: ticket.id,
      eventId,
      qrKeyVersion: 1,
      currentVersion: 2,
      alert: TICKET_QR_KEY_MISSING_ALERT,
    });
    expect(JSON.stringify(allLogs())).not.toContain(ticket.shareToken);
  });

  it('instance chưa có khóa mới (deploy dần, rollback): link của Vé v2 trên app chỉ có v1 → 404 chung + log alert', async () => {
    const { order } = await freeTickets(hBoth, 1);
    const ticket = order.tickets[0]!;
    const res = await hOld.http.get(`/v1/shared-tickets/${ticket.shareToken}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
    await expect.poll(() => alertLines(ticket.id).length).toBe(1);
    expect(alertLines(ticket.id)[0]).toMatchObject({ qrKeyVersion: 2, currentVersion: 1 });
  });

  it('Vé đã hủy, Sự kiện đã kết thúc → vẫn 404 chung nhưng không log alert (các lý do 404 khác được xét trước)', async () => {
    const cancelled = (await freeTickets(hOld, 1)).order.tickets[0]!;
    await hOld.db.pool.query("UPDATE tickets SET status = 'cancelled' WHERE id = $1", [cancelled.id]);
    const ended = await freeTickets(hOld, 1);
    await hOld.db.pool.query("UPDATE events SET effective_end_at = now() - interval '1 second' WHERE id = $1", [
      ended.eventId,
    ]);
    const endedTicket = ended.order.tickets[0]!;

    const before = sharedNotFoundRequests();
    for (const ticket of [cancelled, endedTicket]) {
      const res = await hNew.http.get(`/v1/shared-tickets/${ticket.shareToken}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    }
    // Đối chứng dương: log của hai request đã vào capture, nên "không có alert" dưới đây không rỗng nghĩa.
    await expect.poll(() => sharedNotFoundRequests() - before).toBe(2);
    expect(alertLines(cancelled.id)).toEqual([]);
    expect(alertLines(endedTicket.id)).toEqual([]);
  });
});
