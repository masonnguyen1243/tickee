'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type RemovedFromOrganizationDialogProps = {
  open: boolean;
  organizationName: string;
  /** Đang tải danh sách BTC còn lại để chuyển đi. */
  leaving: boolean;
  onConfirm: () => void;
};

/**
 * `Dialog` khi bị xóa khỏi BTC giữa phiên (UX: "Bạn không còn là thành viên của {BTC}."). Không đóng được bằng Esc,
 * lớp phủ hay nút đóng: mọi thao tác trên BTC này đều đã bị api chặn, lối ra duy nhất là "Đồng ý".
 */
export function RemovedFromOrganizationDialog({
  open,
  organizationName,
  leaving,
  onConfirm,
}: RemovedFromOrganizationDialogProps) {
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-0">
          <DialogTitle className="break-words">Bạn không còn là thành viên của {organizationName}.</DialogTitle>
          <DialogDescription>Owner của BTC đã xóa bạn. Bạn không xem hay thao tác được trên BTC này nữa.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" className="w-full" loading={leaving} onClick={onConfirm}>
            Đồng ý
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
