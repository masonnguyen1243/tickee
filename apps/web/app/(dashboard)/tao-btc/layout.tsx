import type { ReactNode } from 'react';

import { SiteHeader } from '@/components/tickee/site-header';

/** Màn tạo BTC: một cột với header như bề mặt công khai (chưa thuộc BTC nào nên chưa có điều hướng BTC). */
export default function CreateOrganizationLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-content-max-buyer px-gutter-mobile">
      <SiteHeader />
      <main className="pb-section">{children}</main>
    </div>
  );
}
