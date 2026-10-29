- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-he-thong-giao-dien-rap-toi-va-khung-web.md`
  summary: Thêm test cho `serverApiRequest` (chuyển tiếp cookie, `cache: 'no-store'`) và header mặc định `accept`/`content-type` của API client.
  evidence: `apps/web/test/api-client.test.ts` chỉ test `apiRequest`; bỏ vòng merge `extraHeaders` hay đảo thứ tự spread `cache` vẫn pass. Chưa có consumer — thêm ở story đầu tiên gọi `serverApiRequest` hoặc gửi body.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Che IP và User-Agent trong log request của pino-http (`req.remoteAddress`, `req.headers["user-agent"]`, `req.headers["x-forwarded-for"]`).
  evidence: Serializer mặc định của pino-http (có từ Story 1.1) ghi các trường này dạng rõ ở mọi request. Story 1.3 đã khai báo `ip_address`/`user_agent` là PII, nhưng `buildRedactPaths` chỉ che theo tên khóa nên không khớp các đường dẫn này. Triage #7, #47.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Redact PII theo đường dẫn cụ thể thay vì theo tên khóa trần, để khóa `name` không bị che ở mọi log.
  evidence: `PII_KEYS` sinh ra `name`, `*.name`, `*.*.name` cho mọi vai. `main.ts` đã phải đổi sang `context`; log job pg-boss (có `name`) ở Epic 3 cũng sẽ mất tên queue. Triage #8.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: `ErrorFilter` không log nguyên `err` cho lỗi 5xx: `DrizzleQueryError` có params (email, token session) trong message.
  evidence: `error.filter.ts:40,48` log `{ err }` nguyên vẹn (có từ Story 1.1). Khi DB lỗi giữa luồng đăng nhập, params chứa email/identifier sẽ vào log. Nên chỉ log `{ type, code }` và câu SQL không kèm params. Triage #31.

## Deferred from: code review of spec-1-3-dang-nhap-bang-otp-qua-email.md (2026-10-29)

- pino-http log IP/User-Agent dạng rõ và che khóa `name` ở mọi log. Trùng hai mục đã ghi ở trên (Triage #7, #8), không phát sinh việc mới.
- `DrizzleQueryError` lọt tới `ErrorFilter` nên log cả params chứa email (`sign-in-otp-<email>`). Trùng mục đã ghi ở trên (Triage #31); review lần này xác nhận thêm đường đi qua `identity.service.ts`.

## Deferred from: code review of spec-1-4-dang-nhap-bang-google.md (2026-10-29)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-dang-nhap-bang-google.md`
  summary: e2e `login.spec.ts` "Không đồng ý khi session đã hết (sign-out 401)" lỗi lẻ (toast "Bạn cần đồng ý để dùng Tickee." không hiện), nhiều khả năng do đua giữa `queryClient.clear()` → refetch `me` 401 → chuyển sang màn đăng nhập và `router.replace(withNotice(...))`.
  evidence: Thấy 4 lần lỗi qua khoảng 12 lượt chạy toàn bộ e2e trên nhánh `feat/1-4-google-login` (vd. 1/420 khi `--repeat-each=5`, android-chromium). Story 1.4 không đổi `dong-y/`, `notice-toast`, `notices`, `providers`. Trùng kịch bản Triage #44 của Story 1.3 (khi đó maybe-false). CI có `retries: 1` nên hiếm khi đỏ, nhưng sẽ làm nhiễu. Xác nhận bằng trace Playwright của lần lỗi (URL cuối là `/dang-nhap` hay `/chinh-sach-du-lieu`).
