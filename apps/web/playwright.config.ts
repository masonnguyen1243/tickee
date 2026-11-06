import { defineConfig, devices } from '@playwright/test';

import { PUBLIC_EVENT_API_PORT } from './e2e/public-event-api';

/** Server chính: bật trang /ui-kit. Server phụ: tắt, để kiểm /ui-kit trả 404 như production. */
export const PORT = 3100;
export const PORT_UI_KIT_OFF = 3101;
/** Server cho trang Sự kiện công khai: SSR gọi API giả (`e2e/public-event-api.ts`) qua `API_INTERNAL_URL`. */
export const PORT_PUBLIC_EVENT = 3102;

const MOBILE_VIEWPORT = { width: 375, height: 667 };

// Chạy trên bản build sẵn (`pnpm turbo build`), không phải `next dev`. Bản build phải có NEXT_PUBLIC_API_BASE_URL
// (biến được nhúng lúc build; CI đặt ở bước build): e2e không chạy api thật mà giả lập `/v1/identity/*` bằng
// `page.route` theo mẫu `**/v1/identity/**`, nên giá trị nào cũng được miễn là có.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
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
  webServer: [
    {
      command: `pnpm exec next start -p ${PORT}`,
      url: `http://localhost:${PORT}`,
      env: { TICKEE_UI_KIT: '1' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next start -p ${PORT_UI_KIT_OFF}`,
      url: `http://localhost:${PORT_UI_KIT_OFF}`,
      env: { TICKEE_UI_KIT: '0' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'node --no-warnings e2e/public-event-api.ts',
      // API giả trả 404 cho mọi đường dẫn lạ nên chờ theo cổng, không theo URL.
      port: PUBLIC_EVENT_API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `pnpm exec next start -p ${PORT_PUBLIC_EVENT}`,
      url: `http://localhost:${PORT_PUBLIC_EVENT}`,
      env: {
        API_INTERNAL_URL: `http://localhost:${PUBLIC_EVENT_API_PORT}`,
        WEB_ORIGIN: `http://localhost:${PORT_PUBLIC_EVENT}`,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
