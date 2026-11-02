import type { Metadata } from 'next';

import { ClosedBetaReview } from './closed-beta-review';

export const metadata: Metadata = { title: 'Duyệt Closed Beta · Tickee', robots: { index: false, follow: false } };

/** Màn "Duyệt Closed Beta" của Quản trị Tingee (FR-37). Quyền do api quyết (cờ `platform_admin`, 2FA, step-up). */
export default function AdminPage() {
  return <ClosedBetaReview />;
}
