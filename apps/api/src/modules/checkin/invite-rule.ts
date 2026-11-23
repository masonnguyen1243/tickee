import { EventStatus } from '@tickee/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { CheckinEventRef } from '../event/index.js';
import { checkerInvites } from './schema.js';

/*
 * Luật "link mời CTV còn hiệu lực" (AD-30), một nơi duy nhất: badge của tab Check-in (`CheckerInviteService.latest`,
 * Story 5.1), xem trước và nhận lời mời (Story 5.2) đều đọc qua `inviteActiveSql`, nên không lệch nhau. Link còn hiệu lực
 * khi đủ ba điều kiện:
 * - chưa thu hồi (`revoked_at IS NULL`);
 * - `now()` của DB còn trước min(`expires_at`, `effective_end_at` hiện tại của Sự kiện) — so bằng đồng hồ DB, không theo
 *   đồng hồ máy chủ ứng dụng;
 * - Sự kiện chưa hủy và chưa bị bấm "Kết thúc" (mốc "Kết thúc" ghi bằng đồng hồ app có thể còn "tương lai" với DB).
 */

const ci = checkerInvites;

/** Mốc `effective_end_at` đọc từ `event`, gửi lại Postgres làm tham số `timestamptz`. */
export const timestamptzParam = (value: Date) => sql`${value.toISOString()}::timestamptz`;

/** Hạn hiệu lực của link: min(hạn lưu lúc tạo, `effective_end_at` hiện tại của Sự kiện). */
export const effectiveExpiresAt = (effectiveEndAt: Date) =>
  sql<Date>`LEAST(${ci.expiresAt}, ${timestamptzParam(effectiveEndAt)})`;

/** Phần Sự kiện mà luật cần (đọc qua `event`: `checkin` không đọc bảng `events`). */
export type InviteEventState = Pick<CheckinEventRef, 'status' | 'effectiveEndAt' | 'endedManually'>;

/**
 * Biểu thức SQL boolean "link còn hiệu lực" trên dòng `checker_invites` đang chọn, với Sự kiện `event` của link. Sự
 * kiện đã hủy hoặc đã bấm "Kết thúc" → `false` (không cần so giờ); còn lại so với `now()` của DB.
 */
export function inviteActiveSql(event: InviteEventState): SQL<boolean> {
  if (event.status === EventStatus.CANCELLED || event.endedManually) return sql<boolean>`false`;
  return sql<boolean>`(${ci.revokedAt} IS NULL AND now() < ${effectiveExpiresAt(event.effectiveEndAt)})`;
}
