import { notFound } from 'next/navigation';

import { UiKit } from './ui-kit';

// Đọc env lúc chạy (không lúc build): production không đặt TICKEE_UI_KIT nên trang trả 404.
export const dynamic = 'force-dynamic';

export const metadata = { title: 'Bộ giao diện · Tickee', robots: { index: false, follow: false } };

export default function UiKitPage() {
  if (process.env.TICKEE_UI_KIT !== '1') notFound();
  return <UiKit />;
}
