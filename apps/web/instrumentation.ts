/**
 * Next gọi `register()` một lần lúc server khởi động (`next start`, server standalone, cả `next dev`), không gọi lúc
 * `next build`. Web chạy thật (Story 4.7-f, `lib/production-env.ts`) mà `WEB_ORIGIN` hoặc `REVALIDATE_SECRET` sai thì in
 * một thông báo nêu mọi biến vi phạm, mỗi biến một lý do, không giá trị, rồi thoát mã 1. Kiểm ở đây chứ không ở
 * `next.config.ts`: server standalone dùng config đã serialize lúc build nên không nạp lại `next.config.ts`.
 *
 * Chỉ ở runtime nodejs, theo mẫu của Next: điều kiện `=== 'nodejs'` kèm `import()` trong khối để bản biên dịch edge bỏ
 * hẳn khối này (runtime edge không có `process.exit`; viết `!== 'nodejs'` rồi `return` thì Turbopack vẫn cảnh báo).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runtimeEnvIssues, runtimeEnvMessage, webRuntimeEnv } = await import('./lib/production-env');
    const issues = runtimeEnvIssues(webRuntimeEnv());
    if (issues.length > 0) {
      console.error(runtimeEnvMessage(issues));
      process.exit(1);
    }
  }
}
