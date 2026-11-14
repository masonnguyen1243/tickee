'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { EventSaleStatus, EventSaleStatusList } from '@tickee/contracts';

import { eventSaleStatusQueryKey, fetchEventSaleStatus } from './api';

/** Chu kỳ tải lại trạng thái bán khi trang đang hiện (không có tín hiệu realtime cho mọi thay đổi). */
export const EVENT_SALE_STATUS_REFETCH_MS = 60_000;

const byEventId = (list: EventSaleStatusList): ReadonlyMap<string, EventSaleStatus> =>
  new Map(list.events.map((event) => [event.eventId, event]));

/**
 * Trạng thái bán theo Sự kiện của BTC (Story 4.2-c): một query dùng chung cho thẻ Sự kiện ở trang chủ BTC và badge thẻ
 * "Thông tin" của tab Tổng quan. Chưa tải xong hoặc lần tải đầu lỗi → `undefined`: nơi dùng hiện nhãn dự phòng
 * (`eventSaleBadge`), không skeleton, không báo lỗi (401, 2FA, bị xóa khỏi BTC do khung dashboard xử lý). Lần tải lại
 * lỗi giữ kết quả gần nhất của api thay vì quay về nhãn tính ở máy khách. `enabled` = `false` (vd. Sự kiện nháp: nhãn
 * "Nháp" không cần api) thì không gọi api. Tải lại mỗi `EVENT_SALE_STATUS_REFETCH_MS` khi trang đang hiện (Sự kiện tự
 * qua `effective_end_at`, phiên khác Ẩn Sự kiện, Closed Beta đổi…), khi quay lại tab và ở các điểm làm mới của
 * `eventSaleStatusQueryKey`.
 */
export function useEventSaleStatus(orgId: string, enabled = true): ReadonlyMap<string, EventSaleStatus> | undefined {
  return useQuery({
    queryKey: eventSaleStatusQueryKey(orgId),
    queryFn: ({ signal }) => fetchEventSaleStatus(orgId, signal),
    select: byEventId,
    enabled,
    refetchInterval: EVENT_SALE_STATUS_REFETCH_MS,
  }).data;
}

/**
 * Làm mới trạng thái bán của BTC ở các điểm làm mới liệt kê tại `eventSaleStatusQueryKey`. Có `eventId` (người dùng vừa
 * đổi trạng thái hoặc mốc kết thúc của chính Sự kiện đó và đã có Sự kiện mới từ api): hủy lần tải đang chạy (nó có thể về
 * sau và ghi lại dòng cũ) rồi bỏ dòng cũ của Sự kiện khỏi cache, để trong lúc tải lại badge hiện nhãn dự phòng theo Sự
 * kiện vừa lưu thay vì nhãn cũ (vd. "Đang mở bán" ngay sau khi Ẩn).
 */
export async function refreshEventSaleStatus(queryClient: QueryClient, orgId: string, eventId?: string): Promise<void> {
  const queryKey = eventSaleStatusQueryKey(orgId);
  if (eventId) {
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<EventSaleStatusList>(
      queryKey,
      (list) => list && { events: list.events.filter((e) => e.eventId !== eventId) },
    );
  }
  void queryClient.invalidateQueries({ queryKey, exact: true });
}
