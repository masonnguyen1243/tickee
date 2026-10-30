import type { Metadata } from 'next';

import { RECOVERY_USED_PARAM } from '@/lib/auth/totp';

import { SecuritySettings } from './security-settings';

export const metadata: Metadata = {
  title: 'Bảo mật tài khoản · Tickee',
  robots: { index: false, follow: false },
};

type AccountSecurityPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Bảo mật tài khoản (FR-1, UX-DR42): bật/tắt xác thực hai lớp, dùng chung mọi vai. Vào từ menu tài khoản. */
export default async function AccountSecurityPage({ searchParams }: AccountSecurityPageProps) {
  const params = await searchParams;
  return <SecuritySettings recoveryUsed={params[RECOVERY_USED_PARAM] !== undefined} />;
}
