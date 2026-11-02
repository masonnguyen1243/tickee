import type { Metadata } from 'next';

import { InvitationAcceptance } from './invitation-acceptance';

export const metadata: Metadata = {
  title: 'Lời mời làm Admin · Tickee',
  robots: { index: false, follow: false },
  // Token nằm sau `#` nên vốn không vào `Referer`; vẫn không gửi đường dẫn trang này cho site khác.
  referrer: 'no-referrer',
};

/** Màn nhận lời mời làm Admin của một BTC (Story 2.4); link trong email là `/loi-moi-btc#token`. */
export default function InvitationPage() {
  return <InvitationAcceptance />;
}
