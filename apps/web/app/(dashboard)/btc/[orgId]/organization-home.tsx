'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorCode, organizationDashboardPath } from '@tickee/contracts';
import { CalendarDays, ShieldX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { EmptyState } from '@/components/tickee/empty-state';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { hasErrorCode } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { fetchOrganization, organizationQueryKey } from '@/lib/organizer/api';

/** Tên BTC + danh sách Sự kiện (Story 2.7 mới có Sự kiện: hiện trống). */
export function OrganizationHome({ orgId }: { orgId: string }) {
  const router = useRouter();
  const org = useQuery({
    queryKey: organizationQueryKey(orgId),
    queryFn: ({ signal }) => fetchOrganization(orgId, signal),
  });

  useEffect(() => {
    if (hasErrorCode(org.error, ErrorCode.UNAUTHENTICATED)) {
      router.replace(withReturnTo(LOGIN_PATH, organizationDashboardPath(orgId)));
    }
  }, [org.error, orgId, router]);

  // 401 chuyển sang đăng nhập ở effect trên; CONSENT_REQUIRED do `Providers` chuyển sang màn đồng ý.
  const redirecting =
    hasErrorCode(org.error, ErrorCode.UNAUTHENTICATED) || hasErrorCode(org.error, ErrorCode.CONSENT_REQUIRED);
  if (org.isPending || redirecting) {
    return (
      <div aria-busy="true" aria-label="Đang tải" className="flex flex-col gap-section pt-2">
        <div className="h-9 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (hasErrorCode(org.error, ErrorCode.NOT_A_MEMBER)) {
    return (
      <EmptyState
        icon={ShieldX}
        title="Bạn không có quyền xem BTC này."
        description="Kiểm tra lại đường link, hoặc mở BTC của bạn từ menu tài khoản."
      />
    );
  }

  if (org.error) {
    return (
      <div className="pt-2">
        <StatusBanner
          tone="danger"
          title="Chưa tải được BTC"
          description={org.error instanceof ApiError ? org.error.message : 'Vui lòng thử lại.'}
          action={
            <Button type="button" variant="link" size="sm" onClick={() => void org.refetch()}>
              Thử lại
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-eyebrow text-muted-foreground">Dashboard BTC</p>
        <h1 className="text-headline break-words">{org.data.name}</h1>
      </div>
      <section aria-labelledby="org-events" className="flex flex-col gap-stack">
        <h2 id="org-events" className="text-title">
          Sự kiện
        </h2>
        <EmptyState
          icon={CalendarDays}
          title="Chưa có Sự kiện nào."
          description="Sự kiện bạn tạo sẽ hiện ở đây."
          className="rounded-lg bg-card shadow-card"
        />
      </section>
    </div>
  );
}
