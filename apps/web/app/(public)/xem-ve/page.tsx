import type { Metadata } from 'next';

import { SharedTicket } from './shared-ticket';

export const metadata: Metadata = {
  title: 'Vé · Tickee',
  robots: { index: false, follow: false },
  // Token nằm sau `#` nên vốn không vào `Referer`; vẫn không gửi đường dẫn trang này cho site khác.
  referrer: 'no-referrer',
};

/**
 * Trang xem Vé được chia sẻ (Story 3.8, AD-29); link là `/xem-ve#<token>` (trong email Vé hoặc do chủ Vé gửi). Không
 * cần đăng nhập, không SSR: token chỉ được đọc ở trình duyệt nên không vào log web, `Referer` hay ảnh xem trước của
 * Zalo/Messenger.
 */
export default function SharedTicketPage() {
  return <SharedTicket />;
}
