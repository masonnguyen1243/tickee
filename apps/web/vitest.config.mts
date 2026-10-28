import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit test cho mã không cần trình duyệt (API client). Giao diện được kiểm bằng Playwright (e2e/).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
