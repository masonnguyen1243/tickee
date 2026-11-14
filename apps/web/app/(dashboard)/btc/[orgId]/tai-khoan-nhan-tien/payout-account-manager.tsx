'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, type PayoutAccountOptions, type PayoutAccountOverview } from '@tickee/contracts';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { useCurrentOrganization } from '@/components/tickee/current-organization';
import { PageHeading } from '@/components/tickee/page-heading';
import { StatusBanner } from '@/components/tickee/status-banner';
import { Button } from '@/components/ui/button';
import { handledElsewhere } from '@/lib/api/handled-elsewhere';
import { messageOf } from '@/lib/api/message-of';
import { hasErrorCode } from '@/lib/auth/api';
import { isReauthRequired, withReauth } from '@/lib/auth/reauth';
import { useGoToLogin } from '@/lib/auth/use-go-to-login';
import {
  beginTingeeKeyReplacement,
  fetchPayoutAccount,
  payoutAccountOptionsQueryKey,
  payoutAccountQueryKey,
} from '@/lib/organizer/api';

import { AccountChooser } from './account-chooser';
import { LinkedView } from './linked-view';
import { PaymentServiceBlock } from './payment-service-block';
import { ReplaceKeyFlow } from './replace-key-flow';
import { PageSkeleton, refreshOverview, TingeeGuide } from './shared';
import { ConnectForm } from './tingee-key-form';

/*
 * Trang Tài khoản nhận tiền (Story 2.6, FR-5, UX-DR40), chỉ Owner. BTC dùng tài khoản merchant Tingee của chính mình:
 * chưa kết nối (hoặc Owner bấm "Dùng key khác", chỉ có khi BTC chưa từng liên kết tài khoản nào) → hướng dẫn 3 bước +
 * form Client ID / Secret Token; đã kết nối chưa có tài khoản (hoặc đã hủy hết) → danh sách tài khoản đọc từ Tingee; đã
 * liên kết → danh sách tài khoản (badge "Mặc định", "Đặt làm mặc định", "Hủy liên kết" qua `Dialog`), "Thêm tài khoản",
 * URL IPN để sao chép và checklist cấu hình portal. Lỗi báo tại chỗ, dữ liệu đã nhập được giữ. Secret Token không bao
 * giờ quay lại trình duyệt. "Đặt làm mặc định" và "Hủy liên kết" đổi nơi nhận tiền nên api đòi xác nhận lại (Story
 * 2.13-a): gọi qua `withReauth`, gặp `REAUTH_REQUIRED` thì dialog "Xác nhận để tiếp tục" mở, xác nhận xong thao tác tự
 * chạy tiếp; đóng dialog đó thì không làm gì.
 *
 * "Đổi key Tingee" (Story 2.13-b, BTC đã từng liên kết tài khoản): bấm nút thì dialog xác nhận lại hiện ngay; xác nhận
 * xong thì form nhập key mới mở (giữ lần xác nhận) → danh sách tài khoản của key mới → chọn một tài khoản → "Lưu". Tới
 * lúc lưu, key và tài khoản cũ vẫn hiện hành (api không lưu gì ở bước xem trước); Secret Token chỉ nằm trong state của
 * luồng này. Lưu quá 5 phút sau khi xác nhận thì dialog hiện lại và lần lưu tự chạy tiếp.
 *
 * Dịch vụ thanh toán bị ngắt (Story 4.2-b): khối "Dịch vụ thanh toán" nằm trên nội dung trang, có "Kiểm tra lại"; lý do
 * `credential_invalid` kèm "Đổi key Tingee" mở đúng luồng đổi key ở trên. Tổng quan tải lại theo tín hiệu của stream cấp
 * BTC (dải banner của khung dashboard), nên khối hiện/biến mất mà không cần tải lại trang.
 */

export function PayoutAccountManager() {
  const organization = useCurrentOrganization();
  const orgId = organization.id;
  const queryClient = useQueryClient();
  const goToLogin = useGoToLogin();
  /** Owner bấm "Dùng key khác" khi đã kết nối nhưng BTC chưa từng liên kết tài khoản nào. */
  const [replacingKey, setReplacingKey] = useState(false);
  /** Owner bấm "Thêm tài khoản" khi BTC đã có tài khoản nhận tiền. */
  const [adding, setAdding] = useState(false);
  /** "Đổi key Tingee" đã qua xác nhận lại: lần xác nhận mà luồng đổi key giữ. */
  const [changingKey, setChangingKey] = useState<{ reauthToken: string | undefined } | null>(null);

  const overview = useQuery({
    queryKey: payoutAccountQueryKey(orgId),
    queryFn: ({ signal }) => fetchPayoutAccount(orgId, signal),
  });
  // Hết tài khoản (hủy hết, kể cả ở tab khác): lần sau có tài khoản thì không tự mở danh sách thêm tài khoản.
  const noAccounts = overview.data?.accounts.length === 0;
  useEffect(() => {
    if (noAccounts) setAdding(false);
  }, [noAccounts]);

  // "Đổi key Tingee": dialog xác nhận lại hiện ngay (api trả `REAUTH_REQUIRED` cho lời gọi không mang lần xác nhận);
  // xác nhận xong api kiểm lần xác nhận (không tiêu) rồi luồng đổi key mở và giữ nó.
  const beginChangeKey = useMutation({
    mutationFn: () =>
      withReauth(async (reauthToken) => {
        await beginTingeeKeyReplacement(orgId, reauthToken);
        return reauthToken;
      }),
    onSuccess: (reauthToken) => {
      setAdding(false);
      setChangingKey({ reauthToken });
    },
    onError: (error) => {
      // Đóng dialog xác nhận: không làm gì.
      if (isReauthRequired(error)) return;
      if (handledElsewhere(error)) {
        if (hasErrorCode(error, ErrorCode.UNAUTHENTICATED)) goToLogin();
        return;
      }
      if (hasErrorCode(error, ErrorCode.PAYOUT_ACCOUNT_NOT_LINKED_YET)) {
        toast.info('BTC chưa liên kết tài khoản nhận tiền nào: nhập key Tingee ở form kết nối.');
        refreshOverview(queryClient, orgId);
      } else toast.error(messageOf(error));
    },
  });
  const changeKey = () => {
    if (!beginChangeKey.isPending) beginChangeKey.mutate();
  };

  const onConnected = (options: PayoutAccountOptions) => {
    // Danh sách vừa đọc từ Tingee dùng luôn, không gọi Tingee lần nữa; tổng quan đọc lại để có URL IPN.
    queryClient.setQueryData(payoutAccountOptionsQueryKey(orgId, options.credential.id), options);
    queryClient.setQueryData<PayoutAccountOverview>(payoutAccountQueryKey(orgId), (prev) =>
      prev ? { ...prev, credential: options.credential } : prev,
    );
    refreshOverview(queryClient, orgId);
    setReplacingKey(false);
  };

  let body: ReactNode;
  if (overview.isError && !overview.data) {
    body = handledElsewhere(overview.error) ? (
      <PageSkeleton />
    ) : (
      <StatusBanner
        tone="danger"
        title="Chưa tải được tài khoản nhận tiền"
        description={messageOf(overview.error)}
        action={
          <Button type="button" variant="link" size="sm" onClick={() => void overview.refetch()}>
            Thử lại
          </Button>
        }
      />
    );
  } else if (!overview.data) {
    body = <PageSkeleton />;
  } else if (changingKey && !overview.data.canReplaceKey) {
    body = (
      <ReplaceKeyFlow
        orgId={orgId}
        reauthToken={changingKey.reauthToken}
        portalUrl={overview.data.tingeePortalUrl}
        onDone={() => setChangingKey(null)}
        onCancel={() => setChangingKey(null)}
      />
    );
  } else {
    const { credential, accounts, ipnUrl, tingeePortalUrl, canReplaceKey } = overview.data;
    if (accounts.length > 0) {
      body = (
        <LinkedView
          orgId={orgId}
          credential={credential}
          accounts={accounts}
          ipnUrl={ipnUrl}
          portalUrl={tingeePortalUrl}
          adding={adding}
          onAdd={() => setAdding(true)}
          onAddDone={() => setAdding(false)}
          onChangeKey={changeKey}
          changeKeyPending={beginChangeKey.isPending}
        />
      );
    } else if (credential && !(replacingKey && canReplaceKey)) {
      // Chưa có tài khoản (hoặc đã hủy hết): chọn tài khoản. "Dùng key khác" chỉ khi BTC chưa từng liên kết tài khoản;
      // từ đó về sau là "Đổi key Tingee" (có xác nhận lại).
      body = (
        <AccountChooser
          key={credential.id}
          orgId={orgId}
          credential={credential}
          portalUrl={tingeePortalUrl}
          linkedVas={new Set()}
          adding={false}
          onReplaceKey={canReplaceKey ? () => setReplacingKey(true) : undefined}
          onChangeKey={canReplaceKey ? undefined : changeKey}
          changeKeyPending={beginChangeKey.isPending}
          onLinked={() => setAdding(false)}
        />
      );
    } else {
      body = (
        <>
          <TingeeGuide portalUrl={tingeePortalUrl} />
          <ConnectForm
            orgId={orgId}
            replacing={credential !== null}
            onConnected={onConnected}
            onCancel={credential ? () => setReplacingKey(false) : undefined}
          />
        </>
      );
    }
  }

  return (
    <div className="flex flex-col gap-section pt-2">
      <div className="flex flex-col gap-2">
        <PageHeading eyebrow={organization.name} title="Tài khoản nhận tiền" />
        <p className="text-body text-muted-foreground">
          Tài khoản ngân hàng nhận tiền bán Vé có phí, chọn từ tài khoản Tingee của BTC. Chưa liên kết thì chưa bán được
          Vé có phí.
        </p>
      </div>
      {overview.data ? (
        <PaymentServiceBlock
          orgId={orgId}
          state={overview.data.paymentService}
          portalUrl={overview.data.tingeePortalUrl}
          onChangeKey={changingKey ? undefined : changeKey}
          changeKeyPending={beginChangeKey.isPending}
        />
      ) : null}
      {body}
    </div>
  );
}
