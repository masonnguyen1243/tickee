'use client';

import type { Organization } from '@tickee/contracts';
import { createContext, useContext, type ReactNode } from 'react';

/*
 * BTC đang mở trong dashboard (`GET /v1/orgs/:orgId`, gồm vai của người xem). `DashboardShell` chỉ render trang con
 * sau khi tải xong, nên mọi trang dưới `/btc/[orgId]` đọc được BTC mà không phải tự xử lý trạng thái tải/lỗi.
 */
const CurrentOrganizationContext = createContext<Organization | null>(null);

export function CurrentOrganizationProvider({ value, children }: { value: Organization; children: ReactNode }) {
  return <CurrentOrganizationContext.Provider value={value}>{children}</CurrentOrganizationContext.Provider>;
}

export function useCurrentOrganization(): Organization {
  const organization = useContext(CurrentOrganizationContext);
  if (!organization) throw new Error('useCurrentOrganization phải nằm trong DashboardShell');
  return organization;
}
