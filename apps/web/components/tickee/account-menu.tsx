'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CREATE_ORGANIZATION_PATH, organizationDashboardPath } from '@tickee/contracts';
import { CircleUserRound, LayoutDashboard, LogOut, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { fetchMe, ME_QUERY_KEY, signOut } from '@/lib/auth/api';
import { LOGIN_PATH, withReturnTo } from '@/lib/auth/return-to';
import { fetchMemberships, MEMBERSHIPS_QUERY_KEY } from '@/lib/organizer/api';

/**
 * Menu tài khoản ở header. Chưa đăng nhập: link "Đăng nhập" (kèm `returnTo` là trang hiện tại).
 * Đã đăng nhập: email, lối vào dashboard ("Dashboard BTC" mở BTC đầu tiên, chưa có BTC thì "Tạo BTC") và
 * "Đăng xuất" (hủy session ở server, xóa cache, về trang chủ).
 * Đặt trong `<Suspense>` vì dùng `useSearchParams`.
 */
export function AccountMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });
  // Chỉ hỏi khi đã đồng ý NĐ 13 (chưa đồng ý thì api trả CONSENT_REQUIRED và chuyển trang).
  const memberships = useQuery({
    queryKey: MEMBERSHIPS_QUERY_KEY,
    queryFn: ({ signal }) => fetchMemberships(signal),
    enabled: Boolean(me.data?.consentedAt),
  });
  const firstOrganization = memberships.data?.[0];

  const logout = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      router.replace('/');
      router.refresh();
    },
  });

  if (me.isPending) return <span aria-hidden="true" className="block h-10 w-24" />;

  if (!me.data) {
    if (pathname === LOGIN_PATH) return null;
    const query = searchParams.toString();
    const here = `${pathname}${query ? `?${query}` : ''}`;
    return (
      <Button asChild variant="ghost" size="sm">
        <Link href={withReturnTo(LOGIN_PATH, here)}>Đăng nhập</Link>
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[60vw] font-medium" aria-label={`Tài khoản: ${me.data.email}`}>
          <CircleUserRound aria-hidden="true" />
          <span className="truncate">{me.data.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="break-all">{me.data.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {firstOrganization ? (
          <DropdownMenuItem asChild>
            <Link href={organizationDashboardPath(firstOrganization.organizationId)}>
              <LayoutDashboard aria-hidden="true" />
              Dashboard BTC
            </Link>
          </DropdownMenuItem>
        ) : memberships.data ? (
          <DropdownMenuItem asChild>
            <Link href={CREATE_ORGANIZATION_PATH}>
              <Plus aria-hidden="true" />
              Tạo BTC
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          disabled={logout.isPending}
          onSelect={(event) => {
            event.preventDefault();
            logout.mutate();
          }}
        >
          <LogOut aria-hidden="true" />
          Đăng xuất
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
