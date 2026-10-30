import type { Metadata } from 'next';

import { CreateOrganizationForm } from './create-organization-form';

export const metadata: Metadata = { title: 'Tạo BTC · Tickee', robots: { index: false, follow: false } };

/** Tạo BTC: người tạo thành Owner rồi vào trang đích dashboard của BTC. */
export default function CreateOrganizationPage() {
  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <h1 className="text-headline">Tạo BTC</h1>
        <p className="text-body text-muted-foreground">
          Đặt tên Ban tổ chức để bắt đầu bán vé. Bạn sẽ là Owner của BTC này.
        </p>
      </div>
      <CreateOrganizationForm />
    </div>
  );
}
