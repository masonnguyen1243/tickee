import type { ReactNode } from 'react';

import { DashboardShell } from '@/components/tickee/dashboard-shell';

/** Khung dashboard của một BTC: tải BTC + memberships, sidebar / bottom-tab-bar, BTC switcher (UX-DR34). */
export default async function OrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return <DashboardShell orgId={orgId}>{children}</DashboardShell>;
}
