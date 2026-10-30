import type { Metadata } from 'next';

import { OrganizationHome } from './organization-home';

export const metadata: Metadata = { title: 'Sự kiện · Tickee', robots: { index: false, follow: false } };

/** Trang đích dashboard của một BTC: danh sách Sự kiện (khung và dữ liệu BTC do layout dựng). */
export default function OrganizationPage() {
  return <OrganizationHome />;
}
