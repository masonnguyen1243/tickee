'use client';

import { useEffect, useRef, useState } from 'react';

import { CONFIRMING_PAYMENT } from '@/lib/order/status-copy';
import { crossedMilestone, formatCountdown } from '@/lib/order/use-server-countdown';
import { cn } from '@/lib/utils';

type CountdownChipProps = {
  /** Số giây còn lại (`useServerCountdown`). */
  seconds: number;
  /** Đồng hồ về 0 mà Đơn đã có link vẫn chờ: "Đang xác nhận thanh toán" thay cho số giây (không dọa "Hết hạn"). */
  confirming?: boolean;
  /**
   * Nền đặt chip: `stage` (mặc định, màn thanh toán: chữ coral `primary`, vùng `aria-live` đọc mốc 5 phút / 1 phút) hoặc
   * `light` (`order-card` trên nền sáng của "Vé của tôi", Story 3.9: chữ `brand-text`, không có vùng `aria-live` — một
   * danh sách nhiều thẻ không đọc mốc của từng thẻ).
   */
  surface?: 'stage' | 'light';
  className?: string;
};

const MILESTONE_TEXT: Record<number, string> = {
  300: 'Giữ chỗ còn 5 phút.',
  60: 'Giữ chỗ còn 1 phút.',
};

/**
 * `countdown-chip` (DESIGN.md › payment-summary, order-card): "Giữ chỗ còn mm:ss" chữ thương hiệu, viền coral 50%, bo
 * tròn, số tabular. Coral (`primary`) chỉ trên stage; trên nền sáng (`surface="light"`) dùng `brand-text` (đạt AA). Không
 * đổi sang đỏ, không nhấp nháy khi sắp hết. Chip là `timer` (không đọc mỗi giây); trên stage, một vùng
 * `aria-live="polite"` riêng chỉ đọc ở mốc 5 phút và 1 phút còn lại (EXPERIENCE › Accessibility Floor).
 */
export function CountdownChip({ seconds, confirming = false, surface = 'stage', className }: CountdownChipProps) {
  const announce = surface === 'stage';
  const [announcement, setAnnouncement] = useState('');
  // Mốc đếm từ giá trị thật đầu tiên sau khi gắn (không báo mốc đã qua từ trước khi gắn).
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const milestone = crossedMilestone(previous.current, seconds);
    previous.current = seconds;
    if (announce && milestone !== null) setAnnouncement(MILESTONE_TEXT[milestone]!);
  }, [seconds, announce]);

  return (
    <>
      <span
        role="timer"
        data-slot="countdown-chip"
        data-state={confirming ? 'confirming' : 'counting'}
        data-surface={surface}
        className={cn(
          'inline-flex items-center rounded-full border border-brand-border px-3 py-1 text-label tabular-nums',
          surface === 'stage' ? 'text-primary' : 'text-brand-text',
          className,
        )}
      >
        {confirming ? CONFIRMING_PAYMENT : `Giữ chỗ còn ${formatCountdown(seconds)}`}
      </span>
      {announce ? (
        <span aria-live="polite" data-slot="countdown-announcement" className="sr-only">
          {announcement}
        </span>
      ) : null}
    </>
  );
}
