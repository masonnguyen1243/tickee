'use client';

import { useEffect, useRef, useState } from 'react';

import { crossedMilestone, formatCountdown } from '@/lib/order/use-server-countdown';
import { cn } from '@/lib/utils';

type CountdownChipProps = {
  /** Số giây còn lại (`useServerCountdown`). */
  seconds: number;
  /** Đồng hồ về 0 mà Đơn đã có link vẫn chờ: "Đang xác nhận thanh toán" thay cho số giây (không dọa "Hết hạn"). */
  confirming?: boolean;
  className?: string;
};

const MILESTONE_TEXT: Record<number, string> = {
  300: 'Giữ chỗ còn 5 phút.',
  60: 'Giữ chỗ còn 1 phút.',
};

/**
 * `countdown-chip` (DESIGN.md › payment-summary): "Giữ chỗ còn mm:ss" chữ coral, viền coral 50%, bo tròn, số tabular;
 * chỉ đặt trên stage. Không đổi sang đỏ, không nhấp nháy khi sắp hết. Chip là `timer` (không đọc mỗi giây); một vùng
 * `aria-live="polite"` riêng chỉ đọc ở mốc 5 phút và 1 phút còn lại (EXPERIENCE › Accessibility Floor).
 */
export function CountdownChip({ seconds, confirming = false, className }: CountdownChipProps) {
  const [announcement, setAnnouncement] = useState('');
  // Mốc đếm từ giá trị thật đầu tiên sau khi gắn (không báo mốc đã qua từ trước khi gắn).
  const previous = useRef<number | null>(null);
  useEffect(() => {
    const milestone = crossedMilestone(previous.current, seconds);
    previous.current = seconds;
    if (milestone !== null) setAnnouncement(MILESTONE_TEXT[milestone]!);
  }, [seconds]);

  return (
    <>
      <span
        role="timer"
        data-slot="countdown-chip"
        data-state={confirming ? 'confirming' : 'counting'}
        className={cn(
          'inline-flex items-center rounded-full border border-brand-border px-3 py-1 text-label text-primary tabular-nums',
          className,
        )}
      >
        {confirming ? 'Đang xác nhận thanh toán' : `Giữ chỗ còn ${formatCountdown(seconds)}`}
      </span>
      <span aria-live="polite" data-slot="countdown-announcement" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
