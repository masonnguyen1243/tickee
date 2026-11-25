'use client';

import { useEffect, useState } from 'react';

/**
 * Giá trị `value` sau khi đứng yên `delayMs` mili giây (vd. ô tra tay, Story 5.5: gõ từng ký tự không gửi từng request).
 * Đổi `value` trước hạn thì đếm lại từ đầu. Lần render đầu trả ngay `value`.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(value, debounced)) return;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, debounced, delayMs]);
  return debounced;
}
