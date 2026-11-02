import { useSyncExternalStore } from 'react';

import { getServerTheme, getTheme, subscribeTheme, type Theme } from './theme';

/**
 * Theme đang dùng (lib/theme.ts); render lại khi người dùng đổi, khi hệ thống đổi (chưa chọn gì) hoặc tab khác đổi
 * lựa chọn. Tách khỏi `theme.ts` vì root layout (Server Component) import module đó, mà hook React chỉ dùng ở client.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
}
