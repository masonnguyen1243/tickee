'use client';

import { formatVnDateTime, type SuspendedPaymentServiceOrganization } from '@tickee/contracts';

import { ConfirmDialog } from '@/components/tickee/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { messageOf } from '@/lib/api/message-of';
import { PAYMENT_SERVICE_REASON_LABEL } from '@/lib/organizer/payment-service';

/*
 * Tab "Tạm ngừng bán" của `/admin` (Story 4.2-b, AD-32): bảng BTC đang bị ngắt dịch vụ thanh toán và `Dialog` "Mở lại".
 * Gọi api, cổng quyền và toast ở `ClosedBetaReview` (dùng chung cách xử lý với ba tab Closed Beta).
 */

export const SUSPENDED_EMPTY = 'Không có BTC nào đang Tạm ngừng bán.';
export const SUSPENDED_EMPTY_DESCRIPTION = 'BTC bị Tingee ngắt dịch vụ thanh toán sẽ hiện ở đây.';

/** Bảng BTC đang ngắt, theo thứ tự api trả (ngắt lâu nhất trước). Giờ theo giờ Việt Nam. */
export function SuspendedTable({
  organizations,
  onResume,
}: {
  organizations: SuspendedPaymentServiceOrganization[];
  onResume: (organization: SuspendedPaymentServiceOrganization) => void;
}) {
  return (
    <div className="rounded-lg bg-card px-card-padding shadow-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Tên BTC</TableHead>
            <TableHead>Lý do</TableHead>
            <TableHead>Từ lúc</TableHead>
            <TableHead>Lần kiểm tra gần nhất</TableHead>
            <TableHead>
              <span className="sr-only">Thao tác</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((organization) => (
            <TableRow key={organization.id} data-slot="suspended-payment-service-row">
              <TableCell className="font-medium whitespace-normal break-words">{organization.name}</TableCell>
              <TableCell>{PAYMENT_SERVICE_REASON_LABEL[organization.reason]}</TableCell>
              <TableCell>{formatVnDateTime(organization.since)}</TableCell>
              <TableCell>
                {organization.checkedAt ? (
                  formatVnDateTime(organization.checkedAt)
                ) : (
                  <span className="text-muted-foreground">Chưa kiểm tra</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  size="sm"
                  aria-label={`Mở lại ${organization.name}`}
                  onClick={() => onResume(organization)}
                >
                  Mở lại
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Xác nhận "Mở lại": nêu hậu quả; lỗi của lần thử hiện trong `Dialog`. */
export function ResumeDialog({
  organization,
  pending,
  failure,
  onConfirm,
  onClose,
}: {
  organization: SuspendedPaymentServiceOrganization | null;
  pending: boolean;
  failure: unknown;
  onConfirm: (organization: SuspendedPaymentServiceOrganization) => void;
  onClose: () => void;
}) {
  return (
    <ConfirmDialog
      open={organization !== null}
      onOpenChange={(open) => !open && onClose()}
      title={organization ? `Mở lại dịch vụ thanh toán cho ${organization.name}?` : null}
      titleClassName="break-words"
      description="Mọi Hạng vé có phí của BTC bán lại ngay và Tickee đối soát các Đơn đang mở. Nếu Tingee vẫn ngắt, lần tạo link kế tiếp sẽ tạm ngừng bán lại."
      confirmLabel="Mở lại"
      confirmVariant="primary-on-light"
      onConfirm={() => organization && onConfirm(organization)}
      pending={pending}
      failureTitle="Chưa mở lại được"
      failure={Boolean(failure) && messageOf(failure)}
    />
  );
}
