'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleUserRound, LogOut } from 'lucide-react';
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

/**
 * Menu tài khoản ở header. Chưa đăng nhập: link "Đăng nhập" (kèm `returnTo` là trang hiện tại).
 * Đã đăng nhập: email + "Đăng xuất" (hủy session ở server, xóa cache, về trang chủ).
 * Đặt trong `<Suspense>` vì dùng `useSearchParams`.
 */
export function AccountMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });

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
