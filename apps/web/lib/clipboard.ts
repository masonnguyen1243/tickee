import { toast } from 'sonner';

/** Sao chép `text` rồi báo bằng toast "Đã sao chép"; trình duyệt chặn clipboard thì báo lỗi, không ném. */
export async function copyWithToast(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Đã sao chép');
  } catch {
    toast.error('Chưa sao chép được. Hãy chọn và sao chép thủ công.');
  }
}
