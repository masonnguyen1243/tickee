'use client';

import type { QueryClient } from '@tanstack/react-query';
import type { PayoutAccountOverview } from '@tickee/contracts';

import { TingeeLink } from '@/components/tickee/tingee-link';
import { refreshEventSaleStatus } from '@/lib/event/sale-status';
import { payoutAccountQueryKey } from '@/lib/organizer/api';
import { statusNoticesQueryKey } from '@/lib/reporting/api';

export type Draft = { clientId: string; secretToken: string };

export const PROVIDER_DOWN = 'Tingee tạm lỗi, thử lại sau ít phút.';
export const CREDENTIAL_INVALID = 'Client ID hoặc Secret Token không đúng.';
export const CREDENTIAL_REVOKED = 'Client ID hoặc Secret Token không còn đúng. Bấm “Dùng key khác” để nhập key mới.';
/** Key bị thu hồi khi BTC đã từng liên kết tài khoản: nhập key mới qua luồng "Đổi key Tingee" (Story 2.13-b). */
export const CREDENTIAL_REVOKED_LOCKED =
  'Client ID hoặc Secret Token không còn đúng. Bấm “Đổi key Tingee” để nhập key mới.';
export const CHANGE_KEY = 'Đổi key Tingee';
/** Lưu đổi key thất bại: không có gì đổi. */
export const KEY_UNCHANGED = 'Key và tài khoản nhận tiền hiện tại vẫn giữ nguyên.';
export const ACCOUNT_ALREADY_LINKED = 'Tài khoản này đã được liên kết.';
export const PORTAL_UNSELECT_HINT =
  'Không dùng tài khoản này nữa thì bỏ chọn nó trong “Các Tài khoản cho phép thanh toán” trên portal Tingee.';
export const UNAVAILABLE = 'Tài khoản này không còn dùng được trên Tingee. Tải lại danh sách rồi chọn tài khoản khác.';
export const VIETINBANK = 'Chưa hỗ trợ VietinBank';

/**
 * Đọc lại tổng quan (không gọi Tingee), dải banner và nhãn trạng thái bán của Sự kiện (Story 4.2-c); danh sách tài khoản
 * giữ nguyên cache.
 */
export function refreshOverview(queryClient: QueryClient, orgId: string) {
  void queryClient.invalidateQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
  void queryClient.invalidateQueries({ queryKey: statusNoticesQueryKey(orgId) });
  void refreshEventSaleStatus(queryClient, orgId);
}

/**
 * Tổng quan mới do api trả (hủy liên kết, đặt mặc định, đổi key Tingee) thay cache; dải banner và nhãn trạng thái bán của
 * Sự kiện (Story 4.2-c) đọc lại. Hủy lần đọc tổng quan đang chạy trước: nó có thể về sau và ghi đè bằng dữ liệu cũ.
 */
export async function applyOverview(queryClient: QueryClient, orgId: string, overview: PayoutAccountOverview) {
  await queryClient.cancelQueries({ queryKey: payoutAccountQueryKey(orgId), exact: true });
  queryClient.setQueryData(payoutAccountQueryKey(orgId), overview);
  void queryClient.invalidateQueries({ queryKey: statusNoticesQueryKey(orgId) });
  void refreshEventSaleStatus(queryClient, orgId);
}

export const accountLabel = (account: { bankName: string; accountLast4: string }) =>
  `${account.bankName} •••• ${account.accountLast4}`;

export const cardClass = 'flex flex-col gap-stack rounded-lg bg-card p-card-padding shadow-card';

/** Hướng dẫn cho BTC chưa có tài khoản Tingee: đăng ký merchant, liên kết ngân hàng, lấy API key. */
export function TingeeGuide({ portalUrl }: { portalUrl: string }) {
  return (
    <section className={cardClass} data-slot="tingee-guide">
      <h2 className="text-title">Chưa có tài khoản Tingee?</h2>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-body">
        <li>
          Đăng ký tài khoản merchant trên <TingeeLink href={portalUrl}>portal Tingee</TingeeLink> và hoàn tất xác minh.
        </li>
        <li>Liên kết tài khoản ngân hàng của CLB trên Tingee.</li>
        <li>
          Tạo API key ở mục <TingeeLink href={`${portalUrl}/api-credentials`}>API Credentials</TingeeLink>, cấp quyền
          “Cổng thanh toán” và “Tài khoản &amp; Định danh”, rồi dán Client ID và Secret Token vào form bên dưới.
        </li>
      </ol>
    </section>
  );
}

export function ListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải danh sách tài khoản</span>
      <div aria-hidden="true" className="h-32 animate-pulse rounded-md bg-muted" />
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-stack">
      <span className="sr-only">Đang tải</span>
      <div aria-hidden="true" className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
