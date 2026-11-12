'use client';

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

import { StatusBanner } from './status-banner';

type ConfirmDialogProps = {
  open: boolean;
  /** Gọi với `false` khi Esc, lớp phủ, nút "Đóng" hoặc nút hủy; không gọi khi đang `pending`. */
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  titleClassName?: string;
  /** Hậu quả của thao tác. */
  description: ReactNode;
  descriptionClassName?: string;
  /** `description` là một phần tử khối (vd. nhiều đoạn `<p>`): render thay cho `DialogDescription` qua `asChild`. */
  descriptionAsChild?: boolean;
  /** Phần thân thêm, giữa phần đầu và lỗi (vd. ô gõ tên để xác nhận). */
  children?: ReactNode;
  confirmLabel: string;
  /**
   * Kiểu nút xác nhận: mặc định `destructive` (thao tác không hoàn tác được); `primary-on-light` cho xác nhận thường
   * (vd. "Lưu và gửi email").
   */
  confirmVariant?: 'destructive' | 'primary-on-light';
  /** Nhãn nút hủy, mặc định "Hủy". */
  cancelLabel?: string;
  onConfirm: () => void;
  /** Thao tác đang chạy: nút xác nhận quay spinner, Dialog không đóng được. */
  pending: boolean;
  confirmDisabled?: boolean;
  failureTitle: string;
  /** Câu báo lỗi của lần thử gần nhất; rỗng thì không có banner. */
  failure?: string | null | false;
  /**
   * Thân và footer nằm trong `<form>`: nút xác nhận là `submit`, Enter trong ô nhập của `children` cũng xác nhận (trừ
   * khi `confirmDisabled` hoặc đang `pending`).
   */
  asForm?: boolean;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus'];
};

type HeldContent = Pick<ConfirmDialogProps, 'title' | 'description' | 'children' | 'confirmLabel' | 'cancelLabel'>;

/**
 * `Dialog` xác nhận thao tác (thường là không hoàn tác được): tiêu đề, hậu quả, lỗi của lần thử bằng
 * `StatusBanner tone="danger"`, nút xác nhận (`destructive`, trừ khi `confirmVariant` khác) và nút hủy. Nội dung của lần mở gần nhất (trừ lỗi) được giữ
 * trong lúc đóng (hiệu ứng thoát), nên nơi gọi chỉ cần `open={target !== null}` mà nội dung không trống. Logic thao tác
 * (gọi api, xác nhận lại, toast) ở nơi gọi.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  titleClassName,
  descriptionClassName,
  descriptionAsChild = false,
  onConfirm,
  pending,
  confirmDisabled,
  confirmVariant = 'destructive',
  failureTitle,
  asForm = false,
  onCloseAutoFocus,
  failure,
  ...content
}: ConfirmDialogProps) {
  const held = useRef<HeldContent>(content);
  useLayoutEffect(() => {
    if (open) held.current = content;
  });
  const { title, description, children, confirmLabel, cancelLabel = 'Hủy' } = open ? content : held.current;

  const requestClose = () => {
    if (!pending) onOpenChange(false);
  };

  // Đang đóng thì bỏ banner lỗi: nơi gọi đã reset thao tác.
  const banner = open && failure ? <StatusBanner tone="danger" title={failureTitle} description={failure} /> : null;
  const footer = (
    <DialogFooter>
      <Button
        type={asForm ? 'submit' : 'button'}
        variant={confirmVariant}
        className="w-full"
        loading={pending}
        disabled={confirmDisabled}
        onClick={asForm ? undefined : onConfirm}
      >
        {confirmLabel}
      </Button>
      <Button type="button" variant="secondary" className="w-full" onClick={requestClose}>
        {cancelLabel}
      </Button>
    </DialogFooter>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className={titleClassName}>{title}</DialogTitle>
          <DialogDescription asChild={descriptionAsChild} className={descriptionClassName}>
            {description}
          </DialogDescription>
        </DialogHeader>
        {asForm ? (
          <form
            noValidate
            className="flex flex-col gap-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmDisabled && !pending) onConfirm();
            }}
          >
            {children}
            {banner}
            {footer}
          </form>
        ) : (
          <>
            {children}
            {banner}
            {footer}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
