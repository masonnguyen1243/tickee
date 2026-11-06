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

export const TIER_FREE_ID = '019a3b2c-0800-7abc-8def-000000000001';
export const TIER_PAID_ID = '019a3b2c-0800-7abc-8def-000000000002';

export const SLUG_ON_SALE = 'giai-chay-ho-guom-a1b2';
export const SLUG_HIDDEN = 'dem-nhac-an-c3d4';
export const SLUG_DRAFT = 'su-kien-nhap-e5f6';

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

export const PUBLIC_EVENTS: Record<string, unknown> = {
  [SLUG_ON_SALE]: event(SLUG_ON_SALE, 'published'),
  [SLUG_HIDDEN]: event(SLUG_HIDDEN, 'hidden'),
};

function start(): void {
  const server = createServer((req, res) => {
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
