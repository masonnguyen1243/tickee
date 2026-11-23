import type { Metadata } from 'next';

import { CheckerInviteAcceptance } from './checker-invite-acceptance';

export const metadata: Metadata = {
  title: 'Lời mời soát vé · Tickee',
  robots: { index: false, follow: false },
  // Token nằm sau `#` nên vốn không vào `Referer`; vẫn không gửi đường dẫn trang này cho site khác.
  referrer: 'no-referrer',
};

/** Màn nhận lời mời CTV soát vé của một Sự kiện (Story 5.2); link Owner/Admin gửi là `/loi-moi-ctv#token`. */
export default function CheckerInvitePage() {
  return <CheckerInviteAcceptance />;
}
