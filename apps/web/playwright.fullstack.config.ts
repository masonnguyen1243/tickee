import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { API_ORIGIN, WEB_ORIGIN, WEB_PORT, WEB_SERVER_ENV } from './e2e-fullstack/env';

const MOBILE_VIEWPORT = { width: 375, height: 667 };
const OUTPUT_DIR = path.join(__dirname, 'test-results-fullstack');

/*
 * Bộ Playwright full-stack (Story 4.7-c, AI-6): web build thật + api và worker từ `dist` + Tingee fake + Mailpit + DB
 * `tickee_e2e` tạo lại mỗi lượt. Tách khỏi bộ giả lập (`playwright.config.ts`, `e2e/`): thư mục test, cổng và
 * `outputDir` riêng. Không `page.route` nào chặn `/v1/*` hay Tingee fake.
 *
 * Cần `docker compose up -d postgres mailpit` và bản build của api lẫn web (web nhúng
 * `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`): `pnpm test:e2e:fullstack` ở gốc repo build rồi chạy. Không dùng
 * lại server đang chạy: đang chạy `pnpm dev` (cổng 3000/3001) thì Playwright báo cổng bận. Log của api, worker, Tingee
 * fake nằm ở `test-results-fullstack/stack-logs/`.
 */
export default defineConfig({
  testDir: './e2e-fullstack',
  outputDir: OUTPUT_DIR,
  globalSetup: './e2e-fullstack/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  // Đăng nhập OTP qua Mailpit, IPN thật và email Vé của worker: dài hơn mặc định 30 giây.
  timeout: 90_000,
  use: {
    baseURL: WEB_ORIGIN,
    locale: 'vi-VN',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ios-webkit',
      use: { ...devices['iPhone SE'], browserName: 'webkit', viewport: MOBILE_VIEWPORT },
    },
    {
      name: 'android-chromium',
      use: { ...devices['Pixel 5'], browserName: 'chromium', viewport: MOBILE_VIEWPORT },
    },
  ],
  // Chạy lần lượt: stack (DB → migrate → seed → Tingee fake, worker, api) xong rồi mới tới web.
  webServer: [
    {
      command: 'pnpm --filter @tickee/api e2e:stack',
      url: `${API_ORIGIN}/readyz`,
      env: { E2E_STACK_LOG_DIR: path.join(OUTPUT_DIR, 'stack-logs') },
      reuseExistingServer: false,
      // Biên dịch stack, tạo lại DB và migrate từ đầu.
      timeout: 180_000,
      // SIGTERM: api đóng SSE, worker dừng pg-boss; stack tắt hết rồi mới thoát.
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    },
    {
      command: `pnpm exec next start -p ${WEB_PORT}`,
      url: WEB_ORIGIN,
      env: WEB_SERVER_ENV,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
