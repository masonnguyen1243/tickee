import type { ReactNode } from 'react';

/**
 * Nhóm dashboard BTC (Epic 2+). Mỗi nhánh tự dựng khung: `/tao-btc` có header như bề mặt công khai,
 * `/btc/[orgId]` có khung responsive (sidebar, BTC switcher, bottom-tab-bar).
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
