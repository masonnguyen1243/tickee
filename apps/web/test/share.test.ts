import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { shareLink } = await import('@/lib/share');

/* `shareLink` (Story 3.8, gom từ `shareEvent` của trang Sự kiện): Web Share API, hủy thì im lặng, không có thì sao chép. */

const TARGET = { title: 'Vé 1/2 · Giải Pickleball', url: 'https://tickee.vn/xem-ve#Zx9_aB3-kLm0Qr7Tu1Vw2y' };

describe('shareLink', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('có Web Share API → chia sẻ {title, url}, không sao chép', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await shareLink(TARGET);
    expect(share).toHaveBeenCalledWith(TARGET);
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('người dùng hủy bảng chia sẻ (AbortError) → im lặng: không sao chép, không toast', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('cancel', 'AbortError'));
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await shareLink(TARGET);
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Web Share lỗi khác → sao chép link + toast "Đã sao chép"', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await shareLink(TARGET);
    expect(writeText).toHaveBeenCalledWith(TARGET.url);
    expect(toast.success).toHaveBeenCalledWith('Đã sao chép');
  });

  it('không có Web Share API → sao chép link + toast "Đã sao chép"', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await shareLink(TARGET);
    expect(writeText).toHaveBeenCalledWith(TARGET.url);
    expect(toast.success).toHaveBeenCalledWith('Đã sao chép');
  });
});
