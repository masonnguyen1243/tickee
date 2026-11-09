import { createServer } from 'node:http';

/*
 * API giả cho phần SSR của trang Sự kiện công khai (Story 2.11-b): `GET /v1/events/:slug`. Server Next gọi API từ
 * server (không qua trình duyệt) nên `page.route` không chặn được; server Next riêng của e2e đặt `API_INTERNAL_URL` trỏ
 * vào đây. `/availability` gọi từ trình duyệt nên spec giả bằng `page.route`.
 *
 * Chạy: `node --no-warnings e2e/public-event-api.ts` (Node tự bỏ kiểu TS). Spec import dữ liệu từ file này; server chỉ khởi động khi
 * file là entry point.
 */

export const PUBLIC_EVENT_API_PORT = 3199;

/** `REVALIDATE_SECRET` của server Next cho trang công khai (Story 2.11-c); spec gọi `/api/revalidate` bằng giá trị này. */
export const E2E_REVALIDATE_SECRET = 'e2e-only-revalidate-secret-0123456789abcdef';

/**
 * Chỉ có ở API giả: `POST` với body `{ name }` đặt tên Sự kiện `slug` (chưa có thì tạo Sự kiện đang bán) — giả lập BTC
 * đổi tên để thử cache của trang `/e/{slug}`.
 */
export const renameEventPath = (slug: string) => `/__test/events/${encodeURIComponent(slug)}/name`;

export const TIER_FREE_ID = '019a3b2c-0800-7abc-8def-000000000001';
export const TIER_PAID_ID = '019a3b2c-0800-7abc-8def-000000000002';

export const SLUG_ON_SALE = 'giai-chay-ho-guom-a1b2';
export const SLUG_HIDDEN = 'dem-nhac-an-c3d4';
export const SLUG_DRAFT = 'su-kien-nhap-e5f6';
/**
 * Sự kiện cho luồng mua (Story 3.1), diễn ra năm 2099: Checkout kiểm mốc tự kết thúc theo giờ thật nên không dùng
 * `SLUG_ON_SALE` (kết thúc 15/11/2026). `SLUG_BUY` có cùng hai Hạng vé với `SLUG_ON_SALE`; `SLUG_FREE` là Sự kiện miễn
 * phí (mọi Hạng vé 0đ: "Miễn phí" + "Đăng ký").
 */
export const SLUG_BUY = 'giai-chay-dem-i9j0';
export const SLUG_FREE = 'workshop-mien-phi-g7h8';
export const TIER_FREE_ONLY_ID = '019a3b2c-0800-7abc-8def-000000000003';

/** Giới hạn Vé/Đơn của mọi Sự kiện giả (Story 3.1). */
export const MAX_TICKETS_PER_ORDER = 4;

const event = (slug: string, status: 'published' | 'hidden') => ({
  slug,
  name: 'Giải chạy Hồ Gươm mùa thu 2026',
  status,
  startsAt: '2026-11-15T07:00:00+07:00',
  endsAt: '2026-11-15T17:00:00+07:00',
  venue: 'Hồ Hoàn Kiếm, Hà Nội',
  description: 'Cung đường 5 km quanh hồ.\nNhận bib tại nhà văn hóa phường.',
  refundPolicy: 'Hoàn 100% nếu hủy trước 7 ngày.',
  organizationName: 'CLB Chạy Bộ Phố Cổ',
  maxTicketsPerOrder: MAX_TICKETS_PER_ORDER,
  ticketTypes: [
    {
      id: TIER_FREE_ID,
      name: 'Vé phổ thông',
      description: 'Áo + bib',
      price: 0,
      saleStartsAt: null,
      saleEndsAt: null,
    },
    {
      id: TIER_PAID_ID,
      name: 'Vé VIP',
      description: null,
      price: 300_000,
      saleStartsAt: null,
      saleEndsAt: null,
    },
  ],
});

const FAR_FUTURE = { startsAt: '2099-11-15T07:00:00+07:00', endsAt: '2099-11-15T17:00:00+07:00' };

const freeEvent = (slug: string) => ({
  ...event(slug, 'published'),
  ...FAR_FUTURE,
  name: 'Workshop pha cà phê miễn phí',
  ticketTypes: [
    {
      id: TIER_FREE_ONLY_ID,
      name: 'Vé tham dự',
      description: null,
      price: 0,
      saleStartsAt: null,
      saleEndsAt: null,
    },
  ],
});

export const PUBLIC_EVENTS: Record<string, unknown> = {
  [SLUG_ON_SALE]: event(SLUG_ON_SALE, 'published'),
  [SLUG_HIDDEN]: event(SLUG_HIDDEN, 'hidden'),
  [SLUG_BUY]: { ...event(SLUG_BUY, 'published'), ...FAR_FUTURE },
  [SLUG_FREE]: freeEvent(SLUG_FREE),
};

function start(): void {
  const server = createServer((req, res) => {
    const rename = /^\/__test\/events\/([^/?]+)\/name$/.exec(req.url ?? '');
    if (rename && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
      req.on('end', () => {
        const slug = decodeURIComponent(rename[1]!);
        const { name } = JSON.parse(raw) as { name: string };
        PUBLIC_EVENTS[slug] = { ...event(slug, 'published'), name };
        res.writeHead(204).end();
      });
      return;
    }
    const match = /^\/v1\/events\/([^/?]+)$/.exec(req.url ?? '');
    const body = match && req.method === 'GET' ? PUBLIC_EVENTS[decodeURIComponent(match[1]!)] : undefined;
    res.setHeader('content-type', 'application/json');
    if (body) {
      res.writeHead(200).end(JSON.stringify(body));
      return;
    }
    // Nháp (`SLUG_DRAFT`) và slug lạ: cùng 404 như API thật.
    res
      .writeHead(404)
      .end(JSON.stringify({ error: { code: 'EVENT_NOT_FOUND', message: 'Không tìm thấy Sự kiện', details: null } }));
  });
  server.listen(PUBLIC_EVENT_API_PORT, () => {
    console.log(`public-event-api: http://localhost:${PUBLIC_EVENT_API_PORT}`);
  });
}

// Không dùng `import.meta.main`: Playwright nạp spec dạng CommonJS.
if (process.argv[1]?.endsWith('public-event-api.ts')) start();
