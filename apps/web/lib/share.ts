import { copyWithToast } from '@/lib/clipboard';

/** Nội dung chia sẻ: tiêu đề (tên Sự kiện, "Vé k/N"…) và link. */
export type ShareTarget = { title: string; url: string };

/**
 * Chia sẻ một link: Web Share API nếu trình duyệt có (người dùng hủy bảng chia sẻ thì im lặng), không có hoặc lỗi khác
 * thì sao chép link kèm toast "Đã sao chép" (`copyWithToast`). Dùng cho trang Sự kiện và "Chia sẻ Vé".
 */
export async function shareLink({ title, url }: ShareTarget): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  await copyWithToast(url);
}
