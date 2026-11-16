'use client';

import { createContext, useContext, type ReactNode } from 'react';

/*
 * Stream SSE cấp BTC (`GET /v1/orgs/:orgId/live`) của khung dashboard đang kết nối hay không (Story 4.3). Khung chỉ giữ
 * đúng một EventSource cấp BTC (trong `StatusBannerStack`); tài nguyên khác dùng tín hiệu của stream đó (badge và hàng Cần
 * xử lý) đọc trạng thái này để chỉ polling khi chưa có stream, như `notices`.
 */
const OrganizationLiveContext = createContext(false);

export function OrganizationLiveProvider({ connected, children }: { connected: boolean; children: ReactNode }) {
  return <OrganizationLiveContext.Provider value={connected}>{children}</OrganizationLiveContext.Provider>;
}

/** Stream cấp BTC đang kết nối (ngoài khung dashboard: luôn `false`). */
export function useOrganizationLiveConnected(): boolean {
  return useContext(OrganizationLiveContext);
}
