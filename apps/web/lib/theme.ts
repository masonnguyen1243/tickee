/*
 * Giao diện sáng/tối (quyết định 02/11/2026): nút ở header đổi Sáng ↔ Tối, lựa chọn lưu trên trình duyệt; chưa chọn
 * thì theo hệ thống và đổi theo ngay khi hệ thống đổi. Theme đang dùng là `data-theme` ("light" | "dark") trên
 * `<html>`: script inline trong `<head>` (`THEME_SCRIPT`) đặt trước lần vẽ đầu, sau đó chỉ module này đổi. CSS chỉ
 * cần một selector `[data-theme='dark']` (globals.css). Không đọc theme ở server: trang tĩnh vẫn prerender được.
 *
 * Module không import React: root layout (Server Component) lấy `THEME_SCRIPT` từ đây. Hook React ở `use-theme.ts`.
 */

export type Theme = 'light' | 'dark';

const THEME_CONFIG = {
  /** Khóa `localStorage`, theo từng trình duyệt. Giá trị khác "light"/"dark" coi như chưa chọn. */
  storageKey: 'tickee:theme',
  systemDarkQuery: '(prefers-color-scheme: dark)',
  /** `<meta name="theme-color">`: màu nền trang (DESIGN.md `page`, `page-dark`); = `--background` ở app/globals.css. */
  themeColors: { light: '#F7F3F2', dark: '#0B0809' },
} as const;

type ThemeConfig = typeof THEME_CONFIG;

/**
 * Áp theme lên tài liệu: `choice` nếu có, không thì lựa chọn đã lưu, không thì theo hệ thống. Đặt `data-theme` trên
 * `<html>` và `content` của `<meta name="theme-color">` (tạo nếu chưa có). Đọc storage hay `matchMedia` lỗi thì coi như
 * "theo hệ thống" (hoặc sáng).
 *
 * Hàm phải tự đủ: chỉ dùng tham số và API trình duyệt, không dùng biến hay import nào khác, vì `THEME_SCRIPT` chính là
 * mã nguồn của hàm (`toString`). Nhờ vậy script trước lần vẽ đầu và app sau hydrate dùng cùng một logic.
 */
function applyTheme(config: ThemeConfig, choice: Theme | null): Theme {
  let theme: string | null = choice;
  if (theme === null) {
    try {
      theme = window.localStorage.getItem(config.storageKey);
    } catch {
      theme = null;
    }
  }
  if (theme !== 'light' && theme !== 'dark') {
    try {
      theme = window.matchMedia(config.systemDarkQuery).matches ? 'dark' : 'light';
    } catch {
      theme = 'light';
    }
  }
  const resolved: Theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', config.themeColors[resolved]);
  return resolved;
}

/**
 * Script chặn đặt trong `<head>` (app/layout.tsx): áp lựa chọn đã lưu hoặc theme hệ thống trước lần vẽ đầu, không
 * nhấp nháy sai màu. Bọc try/catch ngoài cùng: lỗi bất ngờ thì trang giữ giao diện sáng, không lỗi console.
 */
export const THEME_SCRIPT = `try{(${applyTheme.toString()})(${JSON.stringify(THEME_CONFIG)},null)}catch(e){}`;

/**
 * Lựa chọn trong phiên. Giữ lựa chọn của người dùng cả khi storage không ghi được (bị chặn, đầy): trong phiên vẫn
 * đổi được và không quay lại theo hệ thống.
 */
let sessionChoice: Theme | null = null;
const listeners = new Set<() => void>();
let systemQuery: MediaQueryList | null = null;

function sync(): void {
  applyTheme(THEME_CONFIG, sessionChoice);
  for (const listener of listeners) listener();
}

/** Tab khác đổi lựa chọn (hoặc xóa storage): theo giá trị đã lưu mới. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== THEME_CONFIG.storageKey) return;
  sessionChoice = null;
  sync();
}

function startListening(): void {
  try {
    systemQuery = window.matchMedia(THEME_CONFIG.systemDarkQuery);
    // Chưa chọn gì thì `sync` áp theme hệ thống mới; đã chọn thì giữ nguyên.
    systemQuery.addEventListener('change', sync);
  } catch {
    systemQuery = null;
  }
  window.addEventListener('storage', onStorage);
  // Bắt kịp thay đổi xảy ra giữa script inline và lúc hydrate.
  sync();
}

function stopListening(): void {
  systemQuery?.removeEventListener('change', sync);
  systemQuery = null;
  window.removeEventListener('storage', onStorage);
}

/**
 * Đăng ký theo dõi theme đang dùng (cho `useSyncExternalStore`). Người đăng ký đầu tiên bật nghe hệ thống và storage.
 */
export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) startListening();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) stopListening();
  };
}

/** Theme đang dùng, đọc từ `data-theme` trên `<html>`. */
export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * Server không biết theme (không đọc ở server); lúc hydrate dùng giá trị này rồi React render lại theo `data-theme`.
 */
export function getServerTheme(): Theme {
  return 'light';
}

/** Chọn theme: áp ngay (không tải lại trang) và lưu; từ đó không theo hệ thống nữa. Lưu lỗi thì chỉ giữ trong phiên. */
export function setTheme(theme: Theme): void {
  sessionChoice = theme;
  try {
    window.localStorage.setItem(THEME_CONFIG.storageKey, theme);
  } catch {
    // Storage bị chặn hoặc đầy: lựa chọn chỉ sống trong phiên này.
  }
  sync();
}

/** Đổi Sáng ↔ Tối. */
export function toggleTheme(): void {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
