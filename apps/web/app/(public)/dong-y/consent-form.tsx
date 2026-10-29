'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode } from '@tickee/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { fetchMe, giveConsent, hasErrorCode, ME_QUERY_KEY, signOut } from '@/lib/auth/api';
import { LOGIN_PATH, withNotice, withReturnTo } from '@/lib/auth/return-to';
import type { NoticeCode } from '@/lib/notices';

const DECLINED: NoticeCode = 'consent-declined';

/*
 * VĂN BẢN TẠM — phải thay bằng bản pháp chế duyệt trước Closed Beta (Quyết định 28/10/2026, Story 1.3).
 * Giữ cấu trúc: tóm tắt dữ liệu thu thập, mục đích xử lý, quyền rút đồng ý, link chính sách, hai nút.
 */
export function ConsentForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_QUERY_KEY, queryFn: ({ signal }) => fetchMe(signal) });

  // Chưa đăng nhập → về màn đăng nhập; đã đồng ý rồi → đi tiếp.
  useEffect(() => {
    if (hasErrorCode(me.error, ErrorCode.UNAUTHENTICATED)) router.replace(withReturnTo(LOGIN_PATH, returnTo));
    else if (me.data?.consentedAt) router.replace(returnTo);
  }, [me.error, me.data, returnTo, router]);

  const accept = useMutation({
    mutationFn: giveConsent,
    onSuccess: (data) => {
      queryClient.setQueryData(ME_QUERY_KEY, data);
      router.replace(returnTo);
    },
  });

  const decline = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      router.replace(withNotice(returnTo, DECLINED));
    },
  });

  const failure = accept.error ?? decline.error;
  const busy = accept.isPending || accept.isSuccess || decline.isPending || decline.isSuccess;

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <h1 className="text-headline">Đồng ý xử lý dữ liệu cá nhân</h1>
        <p className="text-body text-muted-foreground">
          Theo Nghị định 13/2023/NĐ-CP, Tickee cần bạn đồng ý trước khi dùng tài khoản.
        </p>
      </div>

      <section aria-labelledby="consent-summary" className="flex flex-col gap-3 rounded-lg bg-card p-card-padding shadow-card">
        <h2 id="consent-summary" className="text-title">
          Tóm tắt
        </h2>
        <dl className="flex flex-col gap-3 text-body">
          <div>
            <dt className="font-bold">Dữ liệu Tickee thu thập</dt>
            <dd className="text-muted-foreground">Email, tên và lịch sử mua vé của bạn.</dd>
          </div>
          <div>
            <dt className="font-bold">Mục đích xử lý</dt>
            <dd className="text-muted-foreground">
              Tạo và quản lý tài khoản, gửi vé và thông báo về Đơn, hỗ trợ bạn khi có sự cố với Sự kiện.
            </dd>
          </div>
          <div>
            <dt className="font-bold">Quyền của bạn</dt>
            <dd className="text-muted-foreground">
              Bạn có thể rút lại đồng ý bất kỳ lúc nào; khi đó Tickee ngừng xử lý dữ liệu của bạn cho các mục đích trên.
            </dd>
          </div>
        </dl>
        <Link href="/chinh-sach-du-lieu" className="text-label text-brand-text underline underline-offset-4">
          Xem chính sách xử lý dữ liệu cá nhân
        </Link>
      </section>

      {failure ? (
        <StatusBanner
          tone="danger"
          title="Chưa lưu được lựa chọn của bạn"
          description={failure instanceof ApiError ? failure.message : 'Vui lòng thử lại.'}
        />
      ) : null}

      <div className="flex flex-col gap-stack">
        <Button
          type="button"
          className="w-full"
          loading={accept.isPending || accept.isSuccess}
          onClick={() => !busy && accept.mutate()}
        >
          Đồng ý
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          loading={decline.isPending || decline.isSuccess}
          onClick={() => !busy && decline.mutate()}
        >
          Không đồng ý
        </Button>
      </div>
    </div>
  );
}
