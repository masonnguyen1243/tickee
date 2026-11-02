import { test as base, type Page } from '@playwright/test';

export { expect } from '@playwright/test';

/** Chờ `Providers` đánh dấu đã hydrate (`html[data-hydrated]`, xem `app/providers.tsx`). */
export async function waitForHydration(page: Page): Promise<void> {
  await page.locator('html[data-hydrated]').waitFor({ state: 'attached' });
}

/*
 * `test` dùng chung cho mọi spec: `page.goto` và `page.reload` chờ hydrate xong mới trả về. Trang dựng sẵn từ server
 * nên ô nhập và nút hiện ra trước khi React gắn handler; trên runner chậm (ios-webkit ở CI), gõ hay bấm trong khoảng
 * đó thì mất chữ hoặc không có tác dụng.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    const reload = page.reload.bind(page);
    page.goto = async (...args) => {
      const response = await goto(...args);
      await waitForHydration(page);
      return response;
    };
    page.reload = async (...args) => {
      const response = await reload(...args);
      await waitForHydration(page);
      return response;
    };
    await use(page);
  },
});
