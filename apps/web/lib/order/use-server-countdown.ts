'use client';

import { useEffect, useState } from 'react';

/*
 * Đếm ngược Giữ chỗ theo đồng hồ máy chủ (Story 3.4, EXPERIENCE › `countdown-chip`): máy chủ trả `serverNow` cùng
 * `expiresAt`; web bù lệch giữa `serverNow` và đồng hồ máy lúc nhận phản hồi, nên đồng hồ máy sai giờ không làm sai số
 * giây còn lại. Độ lệch chốt theo lần đầu thấy một hạn (`expiresAt`): các lần hỏi lại sau đó (cùng hạn) không làm đồng
 * hồ nhảy vì độ trễ mạng; hạn đổi (vd. vừa gắn link, hạn thành 15 phút) thì tính lại.
 */

/** Đọc mốc trên màn hình mỗi chừng này ms (dưới 1 giây để không bị lỡ nhịp giây). */
const TICK_MS = 500;

/** Mốc báo cho trình đọc màn hình (giây còn lại): 5 phút và 1 phút. */
export const COUNTDOWN_MILESTONES = [300, 60] as const;
export type CountdownMilestone = (typeof COUNTDOWN_MILESTONES)[number];

/** Số giây còn lại (làm tròn lên, không âm) tới `expiresAt` khi đồng hồ máy là `now` và lệch máy chủ là `offsetMs`. */
export function remainingSeconds(expiresAt: string, now: number, offsetMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - (now + offsetMs)) / 1000));
}

/** Lệch đồng hồ = giờ máy chủ lúc trả lời − giờ máy lúc nhận phản hồi. */
export const clockOffset = (serverNow: string, receivedAt: number): number => Date.parse(serverNow) - receivedAt;

/** `mm:ss`, phút có thể quá 59 (không xảy ra với hạn 15 phút). */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Mốc vừa vượt qua khi số giây còn lại đi từ `previous` xuống `next` (vượt nhiều mốc một lúc, vd. máy ngủ dậy: mốc nhỏ
 * nhất, gần số giây hiện tại nhất); không vượt mốc nào, hoặc đã về 0 → `null`. `previous` `null` (giá trị đầu tiên lúc
 * gắn) → `null`: mở trang (hay gắn lại với dữ liệu cũ trong cache) khi đã dưới một mốc thì không báo mốc đó.
 */
export function crossedMilestone(previous: number | null, next: number): CountdownMilestone | null {
  if (previous === null || next <= 0) return null;
  const crossed = COUNTDOWN_MILESTONES.filter((milestone) => previous > milestone && next <= milestone);
  return crossed.length > 0 ? Math.min(...crossed) as CountdownMilestone : null;
}

/**
 * Số giây còn lại tới `expiresAt`, cập nhật mỗi `TICK_MS`. `serverNow`/`receivedAt`: giờ máy chủ của phản hồi và giờ máy
 * lúc nhận phản hồi đó (`dataUpdatedAt` của TanStack Query).
 */
export function useServerCountdown(expiresAt: string, serverNow: string, receivedAt: number): number {
  const [clock, setClock] = useState(() => ({ expiresAt, offset: clockOffset(serverNow, receivedAt) }));
  // Hạn đổi: chốt lại độ lệch theo phản hồi mang hạn mới (cập nhật state ngay trong lúc render, không qua effect).
  if (clock.expiresAt !== expiresAt) setClock({ expiresAt, offset: clockOffset(serverNow, receivedAt) });
  const offset = clock.expiresAt === expiresAt ? clock.offset : clockOffset(serverNow, receivedAt);

  // Giờ máy hiện tại ngay từ lần vẽ đầu: gắn lại với dữ liệu cũ trong cache (`receivedAt` đã qua vài phút) không vẽ
  // số giây cũ.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return remainingSeconds(expiresAt, now, offset);
}
