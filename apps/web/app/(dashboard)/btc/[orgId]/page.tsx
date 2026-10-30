import type { Metadata } from 'next';

import { OrganizationHome } from './organization-home';

export const metadata: Metadata = { title: 'Dashboard BTC · Tickee', robots: { index: false, follow: false } };

/** Trang đích dashboard của một BTC (tối thiểu; khung sidebar/switcher thuộc phần B của Story 2.1). */
export default async function OrganizationPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return <OrganizationHome orgId={orgId} />;
}
