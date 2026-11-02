'use client';

import { useQuery } from '@tanstack/react-query';
import { CREATE_ORGANIZATION_PATH, organizationDashboardPath } from '@tickee/contracts';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { fetchMe, ME_QUERY_KEY } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { fetchMemberships, MEMBERSHIPS_QUERY_KEY } from '@/lib/organizer/api';

const JOIN_LABEL = 'Đăng ký Closed Beta';

/**
 * CTA chính của landing (hero và cuối trang). Mặc định (SSR, khách, `me` chưa tải xong) → đăng nhập rồi về
 * `/tao-btc`. Đã đăng nhập mà chưa có BTC hoặc không hỏi được memberships → `/tao-btc` (màn đó tự lo đồng ý NĐ 13).
 * Đã thuộc BTC → "Vào dashboard" BTC đầu tiên. Query trùng khóa và điều kiện với `AccountMenu` nên dùng chung cache.
 * Lỗi tải không hiện gì, giữ đích theo trạng thái biết được.
 */
export function LandingCta({ className }: { className?: string }) {
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  const memberships = useQuery({
    queryKey: MEMBERSHIPS_QUERY_KEY,
    queryFn: ({ signal }) => fetchMemberships(signal),
    enabled: Boolean(me.data?.consentedAt),
  });
  const firstOrganization = memberships.data?.[0];

  let href = withReturnTo(LOGIN_PATH, CREATE_ORGANIZATION_PATH);
  let label = JOIN_LABEL;
  if (me.data) {
    if (firstOrganization) {
      href = organizationDashboardPath(firstOrganization.organizationId);
      label = 'Vào dashboard';
    } else {
      href = CREATE_ORGANIZATION_PATH;
    }
  }

  return (
    <Button asChild variant="primary" className={className}>
      <Link href={href}>{label}</Link>
    </Button>
  );
}
