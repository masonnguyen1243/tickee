import { OctagonAlert } from 'lucide-react';

/**
 * Lỗi tại ô. Vùng `role="alert"` luôn có mặt (ẩn khi rỗng) để trình đọc màn hình thông báo khi lỗi xuất hiện; trỏ tới
 * nó bằng `aria-describedby={id}`.
 */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  return (
    <p id={id} role="alert" className="flex min-h-0 items-start gap-1.5 text-meta text-danger-text empty:hidden">
      {message ? (
        <>
          <OctagonAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{message}</span>
        </>
      ) : null}
    </p>
  );
}
