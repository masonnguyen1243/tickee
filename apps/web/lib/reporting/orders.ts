import {
  EVENT_ORDERS_CSV_FALLBACK_FILENAME,
  EventOrderDetail,
  eventOrderApiPath,
  EventOrderFilter,
  EventOrderHistoryKind,
  eventOrderItemsText,
  EventOrderPage,
  eventOrdersApiPath,
  eventOrdersExportApiPath,
  EventOrderTicketStatus,
  eventPath,
  formatVnd,
  OrderPaidSource,
  parseOrderSearch,
  type EventOrderHistoryEntry,
  type EventOrderItem,
  type EventOrderRow,
  type EventOrdersExportPathQuery,
  type EventOrderTicket,
} from '@tickee/contracts';

import type { StatusTone } from '@/components/tickee/tone';
import { apiDownload, apiRequest } from '@/lib/api/client';

import { orderTimeLabel, REVIEW_TYPE_LABEL } from './overview';

/*
 * Tab Đơn của Sự kiện (Story 6.1, FR-31, UX-DR37): bộ lọc trên URL, nhãn chip, nhãn lịch sử, chuỗi "Vé theo Hạng vé",
 * hàm tải và khóa TanStack Query; xuất CSV theo bộ lọc (Story 6.3). Hàm thuần (trừ hàm tải), kiểm bằng Vitest môi trường
 * node; giờ theo giờ Việt Nam.
 */

// ---------------------------------------------------------------------------------------------------------------
// Bộ lọc trên URL: `?tab=don&trangThai=<slug>&tim=<chuỗi>`
// ---------------------------------------------------------------------------------------------------------------

/** Khóa `?tab=` của tab Đơn (trùng `EVENT_TABS`). */
export const ORDERS_TAB = 'don';
/** Tham số URL của chip trạng thái và ô tìm. Cursor không bao giờ lên URL. */
export const ORDERS_STATUS_PARAM = 'trangThai';
export const ORDERS_SEARCH_PARAM = 'tim';

/** Giá trị `trangThai` trên URL của từng chip. */
export const ORDER_FILTER_SLUG: Readonly<Record<EventOrderFilter, string>> = {
  [EventOrderFilter.PAID]: 'da-thanh-toan',
  [EventOrderFilter.PENDING]: 'cho-thanh-toan',
  [EventOrderFilter.NEEDS_ACTION]: 'can-xu-ly',
  [EventOrderFilter.CANCELLED]: 'da-huy',
  [EventOrderFilter.REFUNDED]: 'da-hoan-tay',
};

/** Chip lọc theo thứ tự hiện: Tất cả · Đã thanh toán · Chờ thanh toán · Cần xử lý · Đã hủy · Đã hoàn tay. */
export const ORDER_FILTER_CHIPS: readonly { status: EventOrderFilter | null; label: string }[] = [
  { status: null, label: 'Tất cả' },
  { status: EventOrderFilter.PAID, label: 'Đã thanh toán' },
  { status: EventOrderFilter.PENDING, label: 'Chờ thanh toán' },
  { status: EventOrderFilter.NEEDS_ACTION, label: 'Cần xử lý' },
  { status: EventOrderFilter.CANCELLED, label: 'Đã hủy' },
  { status: EventOrderFilter.REFUNDED, label: 'Đã hoàn tay' },
];

/** Bộ lọc của tab Đơn: chip (`null` = Tất cả) và chữ tìm như người dùng gõ (`null` = không tìm). */
export interface OrdersFilter {
  status: EventOrderFilter | null;
  search: string | null;
}

export const NO_ORDERS_FILTER: OrdersFilter = { status: null, search: null };

/** Có lọc (chip khác Tất cả hoặc có tìm). */
export const isFiltered = (filter: OrdersFilter): boolean => filter.status !== null || filter.search !== null;

/** Đọc bộ lọc từ URL; giá trị lạ (chip không có, chữ tìm không nhận ra) bị bỏ qua. */
export function ordersFilterFromParams(params: { get(name: string): string | null }): OrdersFilter {
  const slug = params.get(ORDERS_STATUS_PARAM);
  const status = (Object.keys(ORDER_FILTER_SLUG) as EventOrderFilter[]).find((s) => ORDER_FILTER_SLUG[s] === slug) ?? null;
  const raw = params.get(ORDERS_SEARCH_PARAM)?.trim() ?? '';
  const search = raw !== '' && parseOrderSearch(raw) !== null ? raw : null;
  return { status, search };
}

/** Query của URL tab Đơn: `tab=don`, rồi `trangThai`, `tim` khi có. */
export function ordersTabQuery(filter: OrdersFilter = NO_ORDERS_FILTER): string {
  const params = new URLSearchParams({ tab: ORDERS_TAB });
  if (filter.status !== null) params.set(ORDERS_STATUS_PARAM, ORDER_FILTER_SLUG[filter.status]);
  if (filter.search !== null) params.set(ORDERS_SEARCH_PARAM, filter.search);
  return params.toString();
}

/** Trang Sự kiện ở tab Đơn kèm bộ lọc (link "Xem tất cả Đơn", `needs-action-card`). */
export const eventOrdersTabPath = (orgId: string, eventId: string, filter?: OrdersFilter): string =>
  `${eventPath(orgId, eventId)}?${ordersTabQuery(filter)}`;

/** Khóa ổn định của bộ lọc: đổi bộ lọc thì phân trang quay về trang đầu. */
export const ordersFilterKey = (filter: OrdersFilter): string => ordersTabQuery(filter);

// ---------------------------------------------------------------------------------------------------------------
// Nhãn
// ---------------------------------------------------------------------------------------------------------------

export const EMPTY_VALUE = '—';

/** Ô tìm: nhãn, chỗ gợi ý và lời nhắc khi chữ không nhận ra (không gọi API). */
export const ORDERS_SEARCH_LABEL = 'Tìm Đơn';
export const ORDERS_SEARCH_PLACEHOLDER = 'Mã Đơn, email hoặc SĐT';
export const ORDERS_SEARCH_INVALID = 'Nhập mã Đơn, email hoặc SĐT đầy đủ';

/** Khi trống. */
export const ORDERS_EMPTY_TITLE = 'Chưa có Đơn nào.';
export const ORDERS_EMPTY_DESCRIPTION = 'Gửi link Sự kiện để bắt đầu bán.';
export const ORDERS_EMPTY_DRAFT_DESCRIPTION = 'Mở bán Sự kiện để có link gửi Người mua.';
export const ORDERS_NO_MATCH_TITLE = 'Không có Đơn nào khớp bộ lọc.';

/** Link trong `Sheet` của Đơn có mục Cần xử lý `open`. */
export const ORDER_REVIEW_LINK = 'Xử lý ở trang Cần xử lý';
/** Link của `recent-orders-block` sang tab Đơn. */
export const ALL_ORDERS_LINK = 'Xem tất cả Đơn';

/** Cột Vé theo Hạng vé: "2 × VIP, 1 × Thường" (cùng chuỗi với cột "Vé" của CSV); không có dòng → "—". */
export const orderItemsLabel = (items: readonly EventOrderItem[]): string =>
  items.length === 0 ? EMPTY_VALUE : eventOrderItemsText(items);

/** Cột Thời gian: "Tạo HH:mm" (hoặc "dd/MM · HH:mm" khác ngày), thêm "Thanh toán …" khi đã thanh toán. */
export function orderTimeLines(order: Pick<EventOrderRow, 'createdAt' | 'paidAt'>, now: number | Date = Date.now()): string[] {
  const lines = [`Tạo ${orderTimeLabel(order.createdAt, now)}`];
  if (order.paidAt !== null) lines.push(`Thanh toán ${orderTimeLabel(order.paidAt, now)}`);
  return lines;
}

/** Số tiền trong `Sheet`: tổng, và "đã nhận …" khi số đã nhận khác tổng (vd. duyệt tay khi lệch tiền). */
export function orderAmountLines(order: Pick<EventOrderRow, 'totalAmount' | 'paidAmount'>): {
  total: string;
  received: string | null;
} {
  const received =
    order.paidAmount !== null && order.paidAmount !== order.totalAmount ? `đã nhận ${formatVnd(order.paidAmount)}` : null;
  return { total: formatVnd(order.totalAmount), received };
}

/** Nguồn thanh toán trong lịch sử Đơn. */
export const PAID_SOURCE_LABEL: Readonly<Record<OrderPaidSource, string>> = {
  [OrderPaidSource.IPN]: 'Cổng thanh toán',
  [OrderPaidSource.RECONCILIATION]: 'Đối soát bù',
  [OrderPaidSource.MANUAL]: 'Duyệt tay',
  [OrderPaidSource.FREE]: 'Miễn phí',
};

/** Một mục lịch sử Đơn: "Tạo Đơn", "Cần xử lý · Lệch số tiền", "Đã thanh toán · Duyệt tay", "Hết hạn", "Đã hủy"… */
export function orderHistoryLabel(entry: EventOrderHistoryEntry): string {
  switch (entry.kind) {
    case EventOrderHistoryKind.CREATED:
      return 'Tạo Đơn';
    case EventOrderHistoryKind.REVIEW_OPENED:
      return `Cần xử lý · ${REVIEW_TYPE_LABEL[entry.reviewType]}`;
    case EventOrderHistoryKind.PAID:
      return `Đã thanh toán · ${PAID_SOURCE_LABEL[entry.paidSource]}`;
    case EventOrderHistoryKind.EXPIRED:
      return 'Hết hạn';
    case EventOrderHistoryKind.CANCELLED:
      return 'Đã hủy';
    case EventOrderHistoryKind.REFUNDED:
      return 'Đã hoàn tay';
  }
}

/** "Vé k/N". */
export const ticketSeqLabel = (ticket: Pick<EventOrderTicket, 'seq' | 'orderTicketCount'>): string =>
  `Vé ${ticket.seq}/${ticket.orderTicketCount}`;

/** `status-badge` của Vé (DESIGN.md): Hợp lệ → success · Đã check-in → neutral · Đã hủy → danger. */
export function ticketBadge(ticket: Pick<EventOrderTicket, 'status' | 'checkedInAt'>): { label: string; tone: StatusTone } {
  if (ticket.status === EventOrderTicketStatus.CANCELLED) return { label: 'Đã hủy', tone: 'danger' };
  if (ticket.checkedInAt !== null) return { label: 'Đã check-in', tone: 'neutral' };
  return { label: 'Hợp lệ', tone: 'success' };
}

// ---------------------------------------------------------------------------------------------------------------
// Hàm tải và khóa TanStack Query
// ---------------------------------------------------------------------------------------------------------------

/** Gốc khóa của tab Đơn một Sự kiện (danh sách mọi bộ lọc/trang và chi tiết). */
export const eventOrdersQueryPrefix = (orgId: string, eventId: string) =>
  ['reporting', 'event-orders', orgId, eventId] as const;

/** Một trang danh sách: bộ lọc và cursor (`null` = trang đầu). */
export const eventOrdersQueryKey = (orgId: string, eventId: string, filter: OrdersFilter, cursor: string | null) =>
  [...eventOrdersQueryPrefix(orgId, eventId), 'list', filter.status, filter.search, cursor] as const;

/** Chi tiết một Đơn (`Sheet`). */
export const eventOrderQueryKey = (orgId: string, eventId: string, code: string) =>
  [...eventOrdersQueryPrefix(orgId, eventId), 'detail', code] as const;

/** Bộ lọc của tab Đơn → query của api (`status`, `q`; bỏ tham số không có): danh sách và CSV dùng chung. */
const filterQuery = (filter: OrdersFilter): EventOrdersExportPathQuery => ({
  ...(filter.status !== null ? { status: filter.status } : {}),
  ...(filter.search !== null ? { q: filter.search } : {}),
});

/** `GET /v1/orgs/:orgId/events/:eventId/orders`: một trang Đơn khớp bộ lọc, mới nhất trước. */
export const fetchEventOrders = (
  orgId: string,
  eventId: string,
  filter: OrdersFilter,
  cursor: string | null,
  signal?: AbortSignal,
) =>
  apiRequest(
    eventOrdersApiPath(orgId, eventId, { ...filterQuery(filter), ...(cursor !== null ? { cursor } : {}) }),
    { schema: EventOrderPage, init: { signal } },
  );

/** `GET /v1/orgs/:orgId/events/:eventId/orders/:code`: chi tiết một Đơn. */
export const fetchEventOrder = (orgId: string, eventId: string, code: string, signal?: AbortSignal) =>
  apiRequest(eventOrderApiPath(orgId, eventId, code), { schema: EventOrderDetail, init: { signal } });

// ---------------------------------------------------------------------------------------------------------------
// Xuất CSV (Story 6.3)
// ---------------------------------------------------------------------------------------------------------------

/** Nút xuất ở hàng công cụ của tab Đơn. */
export const EXPORT_CSV_LABEL = 'Xuất CSV';
/** Toast khi api lỗi hoặc kết nối đứt giữa chừng. */
export const EXPORT_CSV_ERROR = 'Chưa xuất được CSV. Vui lòng thử lại.';

/**
 * Đường api xuất CSV theo bộ lọc đang áp dụng (chip và chữ tìm đã gửi, như trên URL), không theo chữ đang gõ dở.
 */
export const eventOrdersExportPath = (orgId: string, eventId: string, filter: OrdersFilter): string =>
  eventOrdersExportApiPath(orgId, eventId, filterQuery(filter));

/**
 * Tên file từ header `Content-Disposition` (`attachment; filename="don-….csv"`); thiếu hoặc lạ → `don.csv`. Chỉ lấy
 * phần tên (bỏ đường dẫn nếu có).
 */
export function csvFilenameOf(contentDisposition: string | null): string {
  const match = contentDisposition ? /filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(contentDisposition) : null;
  const name = (match?.[1] ?? match?.[2] ?? '').trim().split(/[/\\]/).at(-1) ?? '';
  return name === '' ? EVENT_ORDERS_CSV_FALLBACK_FILENAME : name;
}

/** File CSV đã tải về đủ: nội dung và tên file. */
export interface EventOrdersCsv {
  blob: Blob;
  filename: string;
}

/**
 * `GET /v1/orgs/:orgId/events/:eventId/orders/export`: tải trọn file CSV theo bộ lọc (kèm cookie). Lỗi của api (401, 500…)
 * → `ApiError`; kết nối đứt giữa chừng → `ApiError` lỗi mạng (không bao giờ trả file cụt).
 */
export async function downloadEventOrdersCsv(orgId: string, eventId: string, filter: OrdersFilter): Promise<EventOrdersCsv> {
  const { blob, headers } = await apiDownload(eventOrdersExportPath(orgId, eventId, filter));
  return { blob, filename: csvFilenameOf(headers.get('content-disposition')) };
}

/**
 * Lưu `blob` thành file `filename` trên máy: thẻ `<a download>` tạm, bấm rồi gỡ; thu hồi object URL sau `setTimeout(0)`
 * (thu hồi ngay sau `click()` có thể hủy tải xuống ở Safari/Firefox). Chỉ chạy trên trình duyệt.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
