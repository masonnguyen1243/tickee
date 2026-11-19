import type { Page, TestInfo } from '@playwright/test';

import { expect } from '../e2e/fixtures';
import { Mailbox } from './mailpit';

/**
 * Email Người mua riêng cho mỗi test, mỗi project, mỗi lần lặp (`--repeat-each`) và mỗi lần thử: api chỉ gửi một mã
 * OTP mỗi 60 giây cho một email, nên hai project, lần lặp hay lần chạy lại (retry) không được dùng chung. DB tạo lại
 * mỗi lượt nên lượt sau dùng lại được.
 */
export function buyerEmail(testInfo: TestInfo, flow: string): string {
  const { project, repeatEachIndex, retry } = testInfo;
  return `e2e-${flow}-${project.name}-x${repeatEachIndex}-r${retry}@tickee.local`;
}

/**
 * Ở màn đăng nhập: nhập email, "Gửi mã", lấy mã ở Mailpit rồi điền vào ô đầu như trình duyệt tự điền (6 ô điền đủ và tự
 * gửi). Tài khoản mới nên màn kế là "Đồng ý" (`/dong-y`).
 */
export async function signInWithOtp(page: Page, email: string): Promise<void> {
  const mailbox = await Mailbox.open(email);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Gửi mã' }).click();
  await expect(page.getByText(`Mã đã gửi tới ${email}`)).toBeVisible();
  const code = await mailbox.otp();
  await page.getByRole('group', { name: 'Mã đăng nhập 6 số' }).locator('input').first().fill(code);
}

/** `returnTo` của URL hiện tại (màn đăng nhập hoặc đồng ý). */
export function returnToOf(page: Page): string | null {
  return new URL(page.url()).searchParams.get('returnTo');
}
