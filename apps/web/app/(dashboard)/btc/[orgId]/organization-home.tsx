'use client';

import { useQuery } from '@tanstack/react-query';
import { ACCOUNT_SECURITY_PATH, OrganizationSection, organizationSectionPath, Role } from '@tickee/contracts';
import { CalendarDays, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { EmptyState } from '@/components/tickee/empty-state';
import { PageHeading } from '@/components/tickee/page-heading';
import { Button } from '@/components/ui/button';
import { fetchMe, ME_QUERY_KEY } from '@/lib/auth/api';

/** Khóa `localStorage` ghi nhớ Owner đã đóng thẻ gợi ý bật 2FA, theo từng tài khoản trên trình duyệt này. */
const hintDismissedKey = (userId: string) => `tickee:goi-y-2fa:da-dong:${userId}`;

/** Đọc trạng thái đóng; storage bị chặn (chế độ riêng tư…) thì coi như chưa đóng: thẻ vẫn hiện. */
function readHintDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(hintDismissedKey(userId)) === '1';
  } catch {
    return false;
  }
}

function saveHintDismissed(userId: string): void {
  try {
    window.localStorage.setItem(hintDismissedKey(userId), '1');
  } catch {
    // Không lưu được: lần tải sau thẻ hiện lại.
  }
}

/**
 * Thẻ gợi ý bật 2FA (UX-DR42): chỉ Owner chưa bật 2FA thấy; không chặn thao tác, đóng được (nhớ theo user trên
 * trình duyệt này). Không dùng `status-banner` vì banner chỉ đi qua `reporting.notices`.
 */
function TwoFactorHint() {
  const organization = useCurrentOrganization();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const [closed, setClosed] = useState(false);

  if (organization.role !== Role.OWNER || !me.data || me.data.twoFactorEnabled) return null;
  const userId = me.data.id;
  if (closed || readHintDismissed(userId)) return null;

  return (
    <section
      aria-label="Gợi ý bảo mật"
      data-slot="two-factor-hint"
      className="flex items-start gap-3 rounded-lg bg-card p-card-padding shadow-card"
    >
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-text" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <p className="text-body">Bật xác thực hai lớp để bảo vệ tài khoản nhận tiền.</p>
        <Button asChild variant="link" size="sm">
          <Link href={ACCOUNT_SECURITY_PATH}>Bật ngay</Link>
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Đóng gợi ý"
        className="-my-2.5 -mr-2.5"
        onClick={() => {
          saveHintDismissed(userId);
          setClosed(true);
        }}
      >
        <X aria-hidden="true" />
      </Button>
    </section>
  );
}

/** Tên BTC + danh sách Sự kiện (Story 2.7 mới có Sự kiện: hiện trống). */
export function OrganizationHome() {
  const organization = useCurrentOrganization();
  return (
    <div className="flex flex-col gap-section pt-2">
      <PageHeading eyebrow="Dashboard BTC" title={organization.name} />
      <TwoFactorHint />
      <section aria-labelledby="org-events" className="flex flex-col gap-stack">
        <h2 id="org-events" className="text-title">
          Sự kiện
        </h2>
        <EmptyState
          icon={CalendarDays}
          title="Chưa có Sự kiện nào."
          description="Sự kiện bạn tạo sẽ hiện ở đây."
          className="rounded-lg bg-card px-card-padding shadow-card"
          action={
            <Button asChild variant="primary-on-light">
              <Link href={organizationSectionPath(organization.id, OrganizationSection.CREATE_EVENT)}>Tạo Sự kiện</Link>
            </Button>
          }
        />
      </section>
    </div>
  );
}
