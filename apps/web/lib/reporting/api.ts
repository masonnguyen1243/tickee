import { StatusNotice } from '@tickee/contracts';
import { z } from 'zod';

import { apiRequest } from '@/lib/api/client';

/** Khóa TanStack Query: thông báo trạng thái (`status-banner`) của một BTC. */
export const statusNoticesQueryKey = (orgId: string) => ['reporting', 'status-notices', orgId] as const;

/**
 * Danh sách thông báo, đọc dễ dãi từng phần tử: phần tử không hợp lệ (vd. mã mới khi api triển khai trước web) bị bỏ,
 * các thông báo còn lại vẫn hiện — một mã lạ không được làm mất banner chặn bán. Bản thân response vẫn phải là mảng.
 */
export const StatusNoticesResponse = z
  .array(z.unknown())
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = StatusNotice.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  );

/** `GET /v1/orgs/:orgId/notices`: đã lọc theo vai người xem và sắp theo ưu tiên ở api. */
export const fetchStatusNotices = (orgId: string, signal?: AbortSignal) =>
  apiRequest(`/orgs/${encodeURIComponent(orgId)}/notices`, { schema: StatusNoticesResponse, init: { signal } });
