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

## Deferred from: retrospective Epic 1 (2026-10-29) — checklist cấu hình production cho Story 4.7

Các mục dưới đây bị reject trong triage của Epic 1 với lý do "chỉ gặp khi deploy" hoặc "thuộc epic sau". Retro Epic 1 (`epic-1-retro-2026-10-29.md`, mục D, AI-3) gom lại đây để Story 4.7 (staging/production, deploy) xử lý trước khi lên môi trường thật. Từ Epic 2: mục nào bị reject mà điều kiện xảy ra nằm ở tương lai thì ghi luôn vào file này.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Kiểm tra cấu hình production khi khởi động (`superRefine` trong `config.schema.ts`): `API_PUBLIC_URL` và `WEB_ORIGIN` phải là `https` khi `NODE_ENV=production`; từ chối `BETTER_AUTH_SECRET` mẫu của `.env.example` và placeholder Google; kiểm chéo `AUTH_COOKIE_DOMAIN` là miền cha của cả `API_PUBLIC_URL` lẫn `WEB_ORIGIN`.
  evidence: Cookie `Secure` theo scheme của `API_PUBLIC_URL` (`auth.ts:199`), nên đặt nhầm `http://` ở production thì session chạy không có `Secure`. `cookieDomain` chỉ kiểm dạng tên miền (`config.schema.ts:31-34`). `.env.example:17,31-32` có secret và placeholder dùng được ngay. Triage 1.3 #9 (phần secret mẫu), #10, #38; danh sách Rejected của code review PR #8.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Đặt đúng `TRUST_PROXY_HOPS` theo số proxy thật trước api, và có cách kiểm sau deploy (log IP đã che hoặc endpoint chẩn đoán chỉ cho admin).
  evidence: Mặc định 0 và không có cận trên (`config.schema.ts:49`); chỉ khi > 0 mới `trust proxy` (`roles/api.ts:22`). Sau load balancer mà để 0 thì mọi request mang IP của LB, nên giới hạn gửi OTP theo IP (20/giờ) trở thành giới hạn chung cho cả hệ thống. Triage 1.3 #1.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-dung-monorepo-structural-seed.md`
  summary: Bảo đảm vai `migrate` chỉ chạy một lần mỗi lần deploy (pipeline tuần tự hoặc advisory lock trong migrate).
  evidence: Triage 1.1 #11: hai tiến trình migrate chạy cùng lúc chưa được chặn; spine (AD-36) giả định pipeline chạy migrate một lần trước deploy.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-he-thong-giao-dien-rap-toi-va-khung-web.md`
  summary: Quyết định server component của web gọi api qua URL công khai hay URL nội bộ, theo topology deploy.
  evidence: Triage 1.2 #5 (maybe-false): spine đặt api ở `api.<domain>` công khai; cần topology thật để biết có cần biến URL nội bộ riêng không.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-dang-nhap-bang-google.md`
  summary: Chuyển ứng dụng Google OAuth khỏi chế độ Testing (publish, xác minh nếu cần) và khai báo redirect URI của staging/production; bổ sung README.
  evidence: README chỉ hướng dẫn chế độ Testing với Test users (`README.md:72`). Triage 1.4 #24.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-dang-nhap-bang-google.md`
  summary: Smoke test trên staging: đăng nhập Google rồi `/me` phải 200 từ web origin. Cân nhắc hiện thông báo khi `/me` trả 401 ngay sau callback, thay vì quay về `/dang-nhap` im lặng.
  evidence: `dang-nhap/google/google-return.tsx:25` chuyển về `/dang-nhap` không kèm thông báo khi `/me` 401 (e2e `login-google.spec.ts:133` khẳng định hành vi này). Cookie hỏng do `AUTH_COOKIE_DOMAIN` sai hoặc web/api khác site sẽ làm mọi lần thử lại đều bị quay về như vậy. Retro Epic 1, C5.
