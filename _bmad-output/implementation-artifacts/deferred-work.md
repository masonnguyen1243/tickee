- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-he-thong-giao-dien-rap-toi-va-khung-web.md`
  summary: Thêm test cho `serverApiRequest` (chuyển tiếp cookie, `cache: 'no-store'`) và header mặc định `accept`/`content-type` của API client.
  evidence: `apps/web/test/api-client.test.ts` chỉ test `apiRequest`; bỏ vòng merge `extraHeaders` hay đảo thứ tự spread `cache` vẫn pass. Chưa có consumer — thêm ở story đầu tiên gọi `serverApiRequest` hoặc gửi body.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): `serverApiRequest` chưa có consumer (`apps/web/lib/api/server.ts:10`); phần header `content-type` đã có test (`apps/web/test/api-client.test.ts:111-128`).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Che IP và User-Agent trong log request của pino-http (`req.remoteAddress`, `req.headers["user-agent"]`, `req.headers["x-forwarded-for"]`).
  evidence: Serializer mặc định của pino-http (có từ Story 1.1) ghi các trường này dạng rõ ở mọi request. Story 1.3 đã khai báo `ip_address`/`user_agent` là PII, nhưng `buildRedactPaths` chỉ che theo tên khóa nên không khớp các đường dẫn này. Triage #7, #47.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-epic-1-ai-1-bit-ro-pii-trong-log.md`. Bằng chứng: `platform/logging/pino-options.ts:19-22` (`REQUEST_PII_PATHS` che IP, User-Agent và các header IP).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Redact PII theo đường dẫn cụ thể thay vì theo tên khóa trần, để khóa `name` không bị che ở mọi log.
  evidence: `PII_KEYS` sinh ra `name`, `*.name`, `*.*.name` cho mọi vai. `main.ts` đã phải đổi sang `context`; log job pg-boss (có `name`) ở Epic 3 cũng sẽ mất tên queue. Triage #8.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-epic-1-ai-1-bit-ro-pii-trong-log.md`. Bằng chứng: `platform/logging/pino-options.ts:16,39` (`GENERIC_PII_KEYS`; `buildRedactPaths` chỉ che `name` dưới `user`).
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: `ErrorFilter` không log nguyên `err` cho lỗi 5xx: `DrizzleQueryError` có params (email, token session) trong message.
  evidence: `error.filter.ts:40,48` log `{ err }` nguyên vẹn (có từ Story 1.1). Khi DB lỗi giữa luồng đăng nhập, params chứa email/identifier sẽ vào log. Nên chỉ log `{ type, code }` và câu SQL không kèm params. Triage #31.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-epic-1-ai-1-bit-ro-pii-trong-log.md`. Bằng chứng: `platform/http/error.filter.ts:25` (`loggableError` chỉ log `{ type, code }` cho lỗi DB).

## Deferred from: code review of spec-1-3-dang-nhap-bang-otp-qua-email.md (2026-10-29)

- pino-http log IP/User-Agent dạng rõ và che khóa `name` ở mọi log. Trùng hai mục đã ghi ở trên (Triage #7, #8), không phát sinh việc mới.
- Trùng (21/11/2026, E4-8): theo dõi ở mục "Che IP và User-Agent trong log request của pino-http" và mục "Redact PII theo đường dẫn cụ thể" (phần đầu file, trước heading đầu tiên); cả hai đã xử lý.
- `DrizzleQueryError` lọt tới `ErrorFilter` nên log cả params chứa email (`sign-in-otp-<email>`). Trùng mục đã ghi ở trên (Triage #31); review lần này xác nhận thêm đường đi qua `identity.service.ts`.
- Trùng (21/11/2026, E4-8): theo dõi ở mục "`ErrorFilter` không log nguyên `err` cho lỗi 5xx" (phần đầu file, trước heading đầu tiên); đã xử lý.

## Deferred from: code review of spec-1-4-dang-nhap-bang-google.md (2026-10-29)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-dang-nhap-bang-google.md`
  summary: e2e `login.spec.ts` "Không đồng ý khi session đã hết (sign-out 401)" lỗi lẻ (toast "Bạn cần đồng ý để dùng Tickee." không hiện), nhiều khả năng do đua giữa `queryClient.clear()` → refetch `me` 401 → chuyển sang màn đăng nhập và `router.replace(withNotice(...))`.
  evidence: Thấy 4 lần lỗi qua khoảng 12 lượt chạy toàn bộ e2e trên nhánh `feat/1-4-google-login` (vd. 1/420 khi `--repeat-each=5`, android-chromium). Story 1.4 không đổi `dong-y/`, `notice-toast`, `notices`, `providers`. Trùng kịch bản Triage #44 của Story 1.3 (khi đó maybe-false). CI có `retries: 1` nên hiếm khi đỏ, nhưng sẽ làm nhiễu. Xác nhận bằng trace Playwright của lần lỗi (URL cuối là `/dang-nhap` hay `/chinh-sach-du-lieu`).
- Story nhận (21/11/2026, E4-8): action item E2-8. Gom vào việc ghi các test chập chờn.

## Deferred from: retrospective Epic 1 (2026-10-29) — checklist cấu hình production cho Story 4.7

Các mục dưới đây bị reject trong triage của Epic 1 với lý do "chỉ gặp khi deploy" hoặc "thuộc epic sau". Retro Epic 1 (`epic-1-retro-2026-10-29.md`, mục D, AI-3) gom lại đây để Story 4.7 (staging/production, deploy) xử lý trước khi lên môi trường thật. Từ Epic 2: mục nào bị reject mà điều kiện xảy ra nằm ở tương lai thì ghi luôn vào file này.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Kiểm tra cấu hình production khi khởi động (`superRefine` trong `config.schema.ts`): `API_PUBLIC_URL` và `WEB_ORIGIN` phải là `https` khi `NODE_ENV=production`; từ chối `BETTER_AUTH_SECRET` mẫu của `.env.example` và placeholder Google; kiểm chéo `AUTH_COOKIE_DOMAIN` là miền cha của cả `API_PUBLIC_URL` lẫn `WEB_ORIGIN`.
  evidence: Cookie `Secure` theo scheme của `API_PUBLIC_URL` (`auth.ts:199`), nên đặt nhầm `http://` ở production thì session chạy không có `Secure`. `cookieDomain` chỉ kiểm dạng tên miền (`config.schema.ts:31-34`). `.env.example:17,31-32` có secret và placeholder dùng được ngay. Triage 1.3 #9 (phần secret mẫu), #10, #38; danh sách Rejected của code review PR #8.
- Đã xử lý (18/11/2026): mục ngay trên (kiểm cấu hình production lúc khởi động) được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-b-siet-cau-hinh-production.md`. Ở `NODE_ENV=production`, api và worker từ chối `http` ở `API_PUBLIC_URL`, `WEB_ORIGIN`, `TINGEE_BASE_URL`, `S3_ENDPOINT`, `S3_PUBLIC_BASE_URL`, và từ chối giá trị mẫu của `.env.example` ở `BETTER_AUTH_SECRET`, `REVALIDATE_SECRET`, Google, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, `TINGEE_CREDENTIAL_KEYS`, `TICKET_QR_KEYS`. `AUTH_COOKIE_DOMAIN` đặt thì phải là miền cha của host cả hai origin (mọi môi trường), và bắt buộc ở production khi hai host khác nhau. Luật nằm trong `config.schema.ts` (danh sách `CROSS_RULES`), hằng và hàm thuần ở `platform/config/production-rules.ts`. Mục `TRUST_PROXY_HOPS` ngay dưới vẫn mở.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-dang-nhap-bang-otp-qua-email.md`
  summary: Đặt đúng `TRUST_PROXY_HOPS` theo số proxy thật trước api, và có cách kiểm sau deploy (log IP đã che hoặc endpoint chẩn đoán chỉ cho admin).
  evidence: Mặc định 0 và không có cận trên (`config.schema.ts:49`); chỉ khi > 0 mới `trust proxy` (`roles/api.ts:22`). Sau load balancer mà để 0 thì mọi request mang IP của LB, nên giới hạn gửi OTP theo IP (20/giờ) trở thành giới hạn chung cho cả hệ thống. Triage 1.3 #1.
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-dung-monorepo-structural-seed.md`
  summary: Bảo đảm vai `migrate` chỉ chạy một lần mỗi lần deploy (pipeline tuần tự hoặc advisory lock trong migrate).
  evidence: Triage 1.1 #11: hai tiến trình migrate chạy cùng lúc chưa được chặn; spine (AD-36) giả định pipeline chạy migrate một lần trước deploy.
- Đã xử lý (19/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-e-khoa-migrate-mot-lan.md`. `runMigrations` giữ khóa advisory cấp session `tickee:migrate` (`platform/db/migration-lock.ts`) suốt ba bước, trên một kết nối riêng. Lượt thứ hai chờ lượt đầu xong rồi mới chạy. Khóa không sắp thứ tự deploy giữa hai phiên bản.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-he-thong-giao-dien-rap-toi-va-khung-web.md`
  summary: Quyết định server component của web gọi api qua URL công khai hay URL nội bộ, theo topology deploy.
  evidence: Triage 1.2 #5 (maybe-false): spine đặt api ở `api.<domain>` công khai; cần topology thật để biết có cần biến URL nội bộ riêng không.
- Story nhận (21/11/2026, E4-8): 9.1. Chọn URL nội bộ hay công khai theo topology deploy thật.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-dang-nhap-bang-google.md`
  summary: Chuyển ứng dụng Google OAuth khỏi chế độ Testing (publish, xác minh nếu cần) và khai báo redirect URI của staging/production; bổ sung README.
  evidence: README chỉ hướng dẫn chế độ Testing với Test users (`README.md:72`). Triage 1.4 #24.
- Story nhận (21/11/2026, E4-8): 9.1. Publish ứng dụng Google OAuth và khai báo redirect URI cần môi trường staging/production thật.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-dang-nhap-bang-google.md`
  summary: Smoke test trên staging: đăng nhập Google rồi `/me` phải 200 từ web origin. Cân nhắc hiện thông báo khi `/me` trả 401 ngay sau callback, thay vì quay về `/dang-nhap` im lặng.
  evidence: `dang-nhap/google/google-return.tsx:25` chuyển về `/dang-nhap` không kèm thông báo khi `/me` 401 (e2e `login-google.spec.ts:133` khẳng định hành vi này). Cookie hỏng do `AUTH_COOKIE_DOMAIN` sai hoặc web/api khác site sẽ làm mọi lần thử lại đều bị quay về như vậy. Retro Epic 1, C5.
- Story nhận (21/11/2026, E4-8): 9.1 (smoke đăng nhập Google trên staging). Phần báo lỗi khi `/me` 401 ở `dang-nhap/google/google-return.tsx:25` xét theo kết quả smoke.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-2-lam-chac-bat-dau-dang-nhap-google.md`
  summary: Từ AI-2, chỉ vai `worker` dọn `verifications`/`sessions`/bộ đếm giới hạn. Checklist deploy Story 4.7 phải yêu cầu luôn có ít nhất một worker, và cảnh báo khi job `identity.purge-expired` lỗi hoặc lâu không chạy.
  evidence: Đã xóa `purgeExpired` khỏi `OtpRateLimiter.consume`. Môi trường chỉ chạy `api` sẽ giữ email dạng rõ (`verifications`) và IP/UA (`sessions`) vô thời hạn.
- Story nhận (21/11/2026, E4-8): 9.1 và action item E4-10. 9.1 nhận phần luôn có ít nhất một worker (đã có trong AC 9.1); E4-10 nhận phần cảnh báo khi `identity.purge-expired` lỗi hoặc ngừng chạy (`defineCronQueue` chung kèm dead-letter).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-2-lam-chac-bat-dau-dang-nhap-google.md`
  summary: Giới hạn theo IP (OTP và bắt đầu Google) nên gom IPv6 theo /64 để client giữ cả dải không vượt giới hạn.
  evidence: `ipHmac` băm nguyên địa chỉ. Mức độ medium nhưng chưa kiểm; muốn xác nhận thì thử gửi từ nhiều địa chỉ trong cùng một /64.
- Story nhận (21/11/2026, E4-8): action item E4-4. Cùng nhóm giới hạn tốc độ trước Closed Beta.

- source_spec: none
  summary: Story 2.1 phần B — khung dashboard responsive: dashboard-sidebar ≥ lg với BTC switcher ở đầu và "Tạo BTC mới" ở cuối, sidebar thu thành icon md–lg, bottom-tab-bar < md (Sự kiện · Cần xử lý · Quét vé · Thêm), ẩn mục chỉ dành cho Owner với Admin, đổi BTC về danh sách Sự kiện, empty-state "Chưa có Sự kiện nào." + "Tạo Sự kiện" (UX-DR34).
  evidence: Tách khỏi Story 2.1 khi chạy bmad-build (29/10/2026, Mason chọn Split). Phần A (tạo BTC, AccessResolver/@RequirePermission, orgScope, audit, bộ test cách ly, GET /v1/me/memberships) là nền quyền ship được riêng; gom cả hai thì spec vượt xa giới hạn kích thước.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`. Bằng chứng: `apps/web/components/tickee/dashboard-shell.tsx`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-tao-btc-va-nen-tang-quyen.md`
  summary: Bộ test cách ly hiện mới kiểm ở mức guard. Khi có tài nguyên con (Story 2.7 Sự kiện), cần seed tài nguyên thật của BTC B và gọi qua đường dẫn của BTC A (`/v1/orgs/A/events/<id của B>`) để bắt IDOR ở các handler quên `orgScope`.
  evidence: `fill()` trong `apps/api/test/organizer/isolation.test.ts` thay mọi param con bằng UUID ngẫu nhiên (review B1, medium).
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): đã có test IDOR theo handler bằng tài nguyên thật của BTC khác (`apps/api/test/event/events.test.ts:302`, `apps/api/test/event/ticket-types.test.ts:171`).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-tao-btc-va-nen-tang-quyen.md`
  summary: `POST /v1/orgs` chưa có giới hạn tần suất và idempotency key. Mất response rồi bấm "Thử lại" sẽ tạo BTC trùng; một tài khoản cũng có thể tạo hàng loạt BTC vào hàng duyệt Closed Beta (Story 2.5).
  evidence: Hiện chỉ chặn bấm đúp ở client (`isPending || isSuccess`) (review B7/E5, medium).
- Story nhận (21/11/2026, E4-8): action item E4-4. Cùng nhóm giới hạn tốc độ trước Closed Beta, gồm cả idempotency key.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-tao-btc-va-nen-tang-quyen.md`
  summary: `PermissionGuard` và cổng `AccessResolver` đang gắn với `:orgId`. Epic 5 (`/v1/checkin/events/:eventId`) cần mở rộng cổng, ví dụ resolver theo phạm vi route. Kiểm `@Public()` + `@RequirePermission` nên chuyển lên lúc khởi động hoặc vào bộ test route.
  evidence: Review B3/B4/V3. Hiện lỗi cấu hình chỉ lộ khi có request.
- Story nhận (21/11/2026, E4-8): 5.1. `/v1/checkin/events/:eventId` là route đầu tiên cần cổng quyền theo Sự kiện.
- Story nhận (22/11/2026, 5.1): 5.2. Mason chốt ở 5.1: route của 5.1 vẫn dưới `/v1/orgs/:orgId`; 5.2 là story đầu tiên có route `/v1/checkin/events/:eventId` và cài `AccessResolver` cho CTV, nhận cả phần kiểm `@Public()` + `@RequirePermission` lúc khởi động.
- Đã xử lý (23/11/2026, 5.2-a): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-2-a-api-nhan-loi-moi-va-quyen-ctv.md`. Bằng chứng: `apps/api/src/platform/access/permission.guard.ts:105`; `apps/api/test/organizer/isolation.test.ts:192`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Đổi BTC trong switcher làm khung dashboard unmount: sidebar/tab bar biến mất trong lúc tải, focus rơi về `<body>`, tab bar mobile nháy. Cân nhắc prefetch BTC đích khi mở menu, hoặc giữ khung với skeleton.
  evidence: `organizationQueryKey(orgId)` mới chưa có cache nên `DashboardShell` rơi vào nhánh loading (review B8, medium).
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): chỉ nháy giao diện khi đổi BTC, không mất dữ liệu.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Padding `env(safe-area-inset-bottom)` của tab bar, vùng nội dung và Sheet đang bằng 0 vì viewport gốc không có `viewportFit: 'cover'`. Cần quyết định bật `cover` (và kiểm tra trang công khai ở landscape) trước Closed Beta.
  evidence: `app/layout.tsx` không đặt `viewportFit`; spec 2.1B cấm đổi (review B15, medium).
- Story nhận (21/11/2026, E4-8): 5.3. Màn quét Mã QR vé trên điện thoại là nơi đầu tiên cần safe-area.
- Story nhận (23/11/2026, 5.3-a): 5.3-b. Story 5.3 tách đôi; Màn quét (nơi đầu tiên cần safe-area) nằm ở 5.3-b, Mason duyệt.
- Đã xử lý (25/11/2026, 5.3-b): phần Màn quét (`viewportFit: 'cover'` chỉ cho route group `(checkin)`, padding safe-area bốn phía) của mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-3-b-man-quet-web.md`. Bằng chứng: `apps/web/app/(checkin)/layout.tsx:8`.
- Story nhận (25/11/2026, 5.3-b): 9.1. Phần còn lại (tab bar, Sheet, `purchase-bar`, kiểm tra trang công khai ở landscape): Mason chọn chỉ bật `cover` cho `(checkin)` ở 5.3-b, kiểm trên thiết bị thật ở staging trước Closed Beta.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Repo chưa có cấu hình Prettier và bước kiểm định dạng, nên code mới có thể lệch kiểu (nháy kép, 80 cột) mà CI không bắt.
  evidence: Không có `.prettierrc`; pipeline `build typecheck lint:deps test` không kiểm định dạng (review B1).
- Story nhận (21/11/2026, E4-8): action item E4-11. Thêm Prettier và bước kiểm định dạng trong CI; không story nào chạm.

## Deferred from: code review of spec-2-1-b-khung-dashboard-responsive.md (2026-10-30)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Mục "Cài đặt" của dashboard mô tả "Sửa tên và kênh liên hệ của BTC" nhưng gắn quyền `org.read`, và ma trận FR-4 chưa có quyền sửa BTC. Story nào làm sửa BTC phải thêm quyền mới vào FR-4 (và quyết định Admin có được sửa hay không).
  evidence: `apps/web/lib/organizer/nav.ts:63`; test "danh sách quyền đúng FR-4" khóa danh sách hiện tại. Chưa story nào trong Epic 2 sở hữu việc sửa BTC (code review 30/10, blind-hunter).
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): backlog không có story sửa BTC; story nào thêm sửa BTC thì thêm quyền mới vào FR-4.

- source_spec: none
  summary: AI-5 phần web — tách `apps/web/app/(public)/dang-nhap/login-form.tsx` thành hook và gộp phần đổi lỗi thành câu báo bị lặp (retro Epic 1, B1/B4).
  evidence: Tách khỏi AI-5 khi chạy bmad-build ngày 2026-10-30; phần API (auth.ts + adapter internalAdapter) là điều kiện trước Story 2.2, phần web ship riêng được.
- Story nhận (21/11/2026, E4-8): action item E4-11. Refactor web thuần (tách hook khỏi `login-form.tsx`), không story nào chạm.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-5-tach-auth-va-adapter-better-auth.md`
  summary: `signInWithCode` tra `SignInOtpStore.has()` trước và `remainingAttempts()` sau `signInEmailOTP` bằng các lần đọc riêng; hai verify song song cho cùng email có thể báo số lượt còn lại lệch một hoặc `hadCode` cũ.
  evidence: Có từ trước AI-5 (cùng thứ tự gọi `internalAdapter` ở `identity.service.ts`); review AI-5 (blind-hunter) ngày 2026-10-30.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): chỉ lệch số lượt còn lại hiển thị khi hai lần xác minh chạy song song.

- source_spec: none
  summary: Story 2.2 phần B — Quản trị Tingee (đã step-up) "Đặt lại TOTP" cho một user ở `/admin`: bắt buộc lý do, xóa TOTP và mã khôi phục, hủy mọi phiên, buộc đăng ký lại; audit; email báo user và các Owner/Admin của BTC liên quan.
  evidence: Tách khỏi Story 2.2 khi chạy bmad-build ngày 2026-10-30 (Mason chọn Split). Cần khu `/admin`, step-up cho Quản trị Tingee và `ADMIN_ALLOWED_CIDRS` mà Story 2.5 dựng; làm cùng hoặc ngay sau 2.5.
- Trùng (21/11/2026, E4-8): theo dõi ở mục "Story 2.5 phần sau — thao tác" (Đặt lại TOTP ở `/admin`; phần "Deferred from: tách phạm vi Story 2.5 khi build (2026-11-02) — phải xong trước Closed Beta"), Story nhận ở đó: 7.7.

## Deferred from: code review of spec-2-2-totp-cho-owner.md (2026-10-30)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-totp-cho-owner.md`
  summary: Chưa có test ghim việc trả lại lượt (`TotpAttemptLimiter.restore`) khi xác minh TOTP/mã khôi phục lỗi hệ thống; bỏ dòng `restore` trong `catch` của `TotpService` thì không test nào hỏng.
  evidence: Review 30/10 (verification-gap): chỉ nhánh `not_started` được test; cần stub `TotpStore.verify` ném lỗi rồi kiểm lần sai kế tiếp còn `remainingAttempts: 4`.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu test, không story nào chạm `TotpService`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-totp-cho-owner.md`
  summary: Nhánh "step-up giữa thao tác rồi gửi lại mutation" của `Providers` mới chỉ test bằng e2e mock `POST /orgs` (API thật không đòi TOTP ở đó). Story đầu tiên có mutation thuộc BTC (2.4 mời/xóa Admin) phải thêm test API + e2e thật cho `TOTP_REQUIRED` → step-up → gửi lại.
  evidence: Review 30/10 (blind-hunter): route `@RequirePermission` duy nhất hiện là `GET /v1/orgs/:orgId`.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 2.4 (mời/xóa Admin). Bằng chứng: `apps/web/e2e/members.spec.ts:190`; `apps/api/test/organizer/members.test.ts:205`.

- source_spec: `_bmad-output/implementation-artifacts/spec-theme-toggle.md`
  summary: Khi thêm Content Security Policy (vd. cho script Tingee), phải cho phép script theme inline `THEME_SCRIPT` trong `<head>` mà vẫn giữ trang tĩnh prerender.
  evidence: Review 02/11 (blind-hunter). Hiện chưa có CSP nên chưa lỗi. Dùng nonce sẽ ép render động, trái quy tắc "không đọc theme ở server". Dùng hash thì hash đổi theo output của `applyTheme.toString()` sau mỗi lần đổi compiler hoặc minifier, nên phải tính hash lúc build.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): repo chưa có CSP và không story nào trong backlog thêm CSP; story nào thêm CSP phải xử lý `THEME_SCRIPT`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-landing-btc.md`
  summary: Đăng nhập tài khoản khác trong cùng tab (không đăng xuất) chỉ invalidate `me`, nên cache memberships của tài khoản trước còn tới 30 giây; `AccountMenu` và CTA landing trỏ "Dashboard BTC"/"Vào dashboard" tới BTC của người khác.
  evidence: `apps/web/app/(public)/dang-nhap/login-form.tsx:164` chỉ gọi `invalidateQueries({ queryKey: ME_QUERY_KEY })`, `staleTime` 30 giây ở `providers.tsx:42`; có từ trước Story 2.3. Server vẫn trả lỗi quyền khi mở BTC không phải của mình. Sửa: xóa cache (như đăng xuất) hoặc invalidate cả `MEMBERSHIPS_QUERY_KEY` khi đăng nhập thành công.
- Story nhận (21/11/2026, E4-8): 5.2. CTV nhận lời mời là luồng đăng nhập kế tiếp chạm cache memberships.
- Story nhận (23/11/2026, 5.2-a): 5.2-b. Story 5.2 tách đôi; phần web (đăng nhập OTP để nhận lời mời) nằm ở 5.2-b, Mason duyệt.
- Đã xử lý (23/11/2026, 5.2-b): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-2-b-web-nhan-loi-moi-ctv.md` (`resetQueries()` thay cho invalidate `me`). Bằng chứng: `apps/web/app/(public)/dang-nhap/login-form.tsx:151`; `apps/web/e2e/login.spec.ts:344`.

## Deferred from: code review of spec-2-4-moi-va-xoa-admin.md (2026-11-02)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-moi-va-xoa-admin.md`
  summary: Giới hạn 20 lời mời/24 giờ chỉ tính theo BTC, mà một tài khoản tạo được không giới hạn BTC, nên email mời Admin (tiêu đề chứa nguyên tên BTC, gửi từ tên miền Tickee) có thể bị dùng để spam/phishing. Cần thêm giới hạn theo tài khoản mời và/hoặc theo người nhận, hoặc giới hạn số BTC mỗi tài khoản.
  evidence: Review 02/11 (blind-hunter). `organizer.service.ts` `createOrganization` không có giới hạn (có từ 2.1); `members.service.ts` `invite` chỉ đếm `organization_id`. Nên chốt trước Closed Beta, cùng lúc với giám sát 4.6.
- Story nhận (21/11/2026, E4-8): action item E4-4. Cùng nhóm giới hạn tốc độ trước Closed Beta (theo tài khoản mời, theo người nhận, hoặc số BTC mỗi tài khoản).

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-moi-va-xoa-admin.md`
  summary: `organization_invitations` giữ `email` (PII) mãi mãi: lời mời đã nhận, đã thu hồi hay hết hạn không bao giờ bị xóa, và lời mời hết hạn nằm trong "Lời mời đang chờ" tới khi Owner thu hồi tay. Cần chốt thời hạn giữ rồi thêm job dọn (như `identity.purge-expired`).
  evidence: Review 02/11 (blind-hunter, edge-case-hunter). Chưa có janitor cho bảng này; thời hạn giữ dữ liệu cho audit/NĐ 13 chưa có trong PRD, liên quan Story 7.6 (xóa tài khoản, rút đồng ý).
- Story nhận (21/11/2026, E4-8): 7.6. Chốt thời hạn giữ dữ liệu và job dọn cùng việc xóa tài khoản, rút đồng ý.

## Deferred from: tách phạm vi Story 2.5 khi build (2026-11-02) — phải xong trước Closed Beta

- source_spec: none
  summary: Story 2.5 phần sau — giới hạn `/v1/admin/*` theo dải IP `ADMIN_ALLOWED_CIDRS` (kiểm bằng Zod khi khởi động, thiếu/sai ở production thì api không khởi động) cùng cấu hình trusted proxy để lấy đúng IP client (FR-4, AD-26).
  evidence: Tách khỏi Story 2.5 theo quyết định của Mason (02/11): chỉ có tác dụng khi đã deploy và dính `TRUST_PROXY_HOPS` đang nằm trong checklist Story 4.7 ở file này; không chặn 2.6/2.10. Phải xong trước khi mở `/admin` trên môi trường thật.
- Đã xử lý (18/11/2026): mục ngay trên (giới hạn `/v1/admin/*` theo IP) được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-a-gioi-han-ip-admin.md`. `ADMIN_ALLOWED_CIDRS` (CIDR IPv4/IPv6, kiểm bằng Zod, bắt buộc khi `NODE_ENV=production`) và `AdminIpMiddleware` chặn mọi đường dẫn `/v1/admin` và `/v1/admin/*` theo `req.ip` (`TRUST_PROXY_HOPS`) trước mọi guard: `403 ADMIN_IP_NOT_ALLOWED`, log `warn` marker `admin_ip_blocked` không có IP; `PlatformAdminGuard` ném lỗi cấu hình với route admin ngoài `/v1/admin/`; `/admin` hiện `EmptyState` mạng không được phép. Mục `TRUST_PROXY_HOPS` của checklist 4.7 (đặt đúng số hop, cách kiểm sau deploy) vẫn mở: spec này không làm endpoint chẩn đoán IP.
- source_spec: none
  summary: Story 2.5 phần sau — thao tác "Đặt lại TOTP" cho một user ở `/admin` (Quản trị Tingee đã step-up, lý do bắt buộc; xóa TOTP + mã khôi phục, hủy mọi phiên, 2FA về chưa bật; audit; email báo user và Owner/Admin của các BTC liên quan), chuyển từ Story 2.2 theo Sprint Change Proposal 30/10/2026.
  evidence: Tách khỏi Story 2.5 theo quyết định của Mason (02/11): chỉ cần khi đã có người dùng thật mất thiết bị; là mục tiêu độc lập (luồng hỗ trợ tài khoản), không story nào phụ thuộc. Phải xong trước Closed Beta.
- Story nhận (21/11/2026, E4-8): 7.7. Quản trị Tingee đặt lại TOTP.

## Deferred from: code review of spec-2-5-duyet-btc-vao-closed-beta.md (2026-11-02)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-duyet-btc-vao-closed-beta.md`
  summary: `StatusNotice` chưa có id đối tượng (BTC/Sự kiện): khóa đóng banner trong `sessionStorage` và React key chỉ là `code:version`, nên story đầu tiên phát thông báo phạm vi `event` hoặc `dismissible: true` phải thêm id đối tượng vào hợp đồng và vào cả hai khóa.
  evidence: Review 02/11 (blind-hunter, edge-case-hunter), triage #5. Hôm nay chưa với tới: hai mã Closed Beta đều không đóng được và đều phạm vi `organization`, `version` là mốc thời gian theo BTC. Hai thông báo Sự kiện cùng mã + version sẽ trùng React key và đóng một cái ẩn luôn cái kia; khóa đóng còn dính sang BTC khác trong cùng tab.
- Story nhận (21/11/2026, E4-8): 7.1. Notice Sự kiện đã hủy là thông báo phạm vi `event` đầu tiên; `reporting/notices.service.ts:146` đã có notice `dismissible`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-duyet-btc-vao-closed-beta.md`
  summary: `GET /v1/admin/organizations` (hàng duyệt Closed Beta) chưa phân trang; tab "Đã duyệt" tăng theo số BTC.
  evidence: Review 02/11, triage #9. Closed Beta chỉ vài chục BTC nên chưa thành vấn đề; thêm `limit` + cursor trước khi mở rộng ngoài Closed Beta.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): Closed Beta ít BTC; thêm phân trang trước khi mở rộng ngoài Closed Beta.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-duyet-btc-vao-closed-beta.md`
  summary: CLI Quản trị Tingee chưa có `admin:list` để xem ai đang có cờ, và README chỉ hướng dẫn chạy local; Story 4.7 cần ghi cách chạy `dist/roles/admin-cli.js` trong image ở staging/production (ai được chạy, cấp `MIGRATION_DATABASE_URL` thế nào).
  evidence: Review 02/11 (blind-hunter), triage #11. Hiện muốn xem danh sách admin phải chạy SQL bằng role migrator.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): không làm `admin:list`, chạy SQL bằng role migrator là đủ. Story nhận (21/11/2026, E4-8): 9.1 cho phần README cách chạy `dist/roles/admin-cli.js` trong image.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-1-bit-ro-pii-trong-log.md`
  summary: Worker gửi lời mời Admin (`invitation-jobs.ts:192-194`) log `err.message` và ghi nó vào `output` của job pg-boss; log khởi động `main.ts` (`bootLog.fatal({ err })`) cũng log nguyên lỗi. Cần dùng `isDatabaseError`/`dbErrorSummary` như `ErrorFilter`.
  evidence: Khi truy vấn Drizzle trong `sendAdminInvitation` lỗi, `DrizzleQueryError.message` là `Failed query: <sql>\nparams: <tokenHash>,<invitationId>` và đi thẳng vào log worker lẫn bảng job. Code có từ Story 2.4/1.1, nằm ngoài bốn đường AI-1. Review AI-1 #3.
- Story nhận (21/11/2026, E4-8): action item E4-11. Còn `bootLog.fatal({ err })` ở `apps/api/src/main.ts:83` log nguyên lỗi; phần worker mời Admin đã xong (`organizer/invitation-jobs.ts:112` chỉ ghi tên lớp lỗi).

## Deferred from: code review of spec-2-6-lien-ket-tai-khoan-nhan-tien.md (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien.md`
  summary: Trạng thái Tingee có thể lệch DB khi kết quả mơ hồ: `create-va`/`confirm-va` timeout sau khi Tingee đã tạo VA, hoặc lần thử mới thay lần thử đang xác nhận OTP. Lần thử bị `failed`, lần sau có thể nhận `PAYOUT_ACCOUNT_IN_USE` và BTC kẹt. Chưa có cách đối soát hay runbook.
  evidence: Review 03/11 #1, #2 (maybe-false; nếu đúng là medium). Kiểm trên UAT khi làm test hợp đồng: (a) request timeout có để lại VA không; (b) `create-va` lặp lại cho cùng Merchant con và cùng số tài khoản trả mã gì (1022/1048/1081); (c) có API tra VA của Merchant con không (`/v1/shop/get-paging`?). Nếu (a) và (b) đúng thì đọc `PAYOUT_ACCOUNT_IN_USE` của cùng Merchant con là "đã liên kết", hoặc thêm đối soát.
- Story nhận (21/11/2026, E4-8): action item E3-3. Cần UAT Tingee thật để biết timeout có để lại VA không và `create-va` lặp lại trả mã gì.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien.md`
  summary: Story 7.6 (xóa tài khoản) phải xử lý `payout_accounts.created_by` (FK `ON DELETE no action`) và PII (`account_name`, `account_last4`) của các lần thử thất bại; hiện giữ mãi.
  evidence: Review 03/11 #17. Cùng quy ước với `organization_invitations.invited_by` (0006).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien.md`
  summary: Script dev `pnpm --filter @tickee/api tingee:fake` (biên dịch riêng `test/tingee-fake/tsconfig.json`) chưa có bước CI nào chạy thử.
  evidence: Review 03/11 #24 (verification-gap). Sai `outDir`/`rootDir` sẽ làm hỏng cách chạy local ghi trong `.env.example`/README mà mọi test vẫn qua.
- Story nhận (21/11/2026, E4-8): action item E4-11. Thêm bước CI biên dịch `tingee:fake`; không story nào chạm.

## Deferred from: code review of spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md`
  summary: Hai BTC kết nối cùng một tài khoản merchant Tingee (cùng Client ID, hoặc cùng VA). Portal chỉ có một "Đường dẫn IPN" cho mỗi merchant, nên IPN của một BTC đổ về URL `ipnKey` của BTC kia; theo AD-7, IPN đó rơi vào nhánh "Tài khoản lệch".
  evidence: Review 03/11 pass 1 #1 (maybe-false; nếu đúng là medium). Cần biết hai điều: (a) Tingee có cho cấu hình IPN Cổng thanh toán theo shop hoặc VA không, hay chỉ một URL cho mỗi merchant; (b) Mason chọn chặn trùng Client ID giữa các BTC ở bước kết nối (Story 2.6/2.13), hay để Story 3.5 định tuyến theo credential đã chụp vào Đơn thay vì đòi Đơn thuộc BTC sở hữu `ipnKey`. Phải chốt trước khi làm Story 3.5.
- Trùng (21/11/2026, E4-8): theo dõi ở mục "Chặn hai BTC kết nối cùng một merchant Tingee" (phần "Deferred from: planning spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md (2026-11-11)"), Story nhận ở đó: action item E4-2.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md`
  summary: Bước kết nối chỉ chứng minh key có quyền "Tài khoản & Định danh" (`get-va-paging`). Key thiếu quyền "Cổng thanh toán" vẫn kết nối và chọn tài khoản được, tới `create-link` (Epic 3) mới lỗi 1133.
  evidence: Review 03/11 pass 1 #3 (medium). Không có API kiểm quyền Cổng thanh toán mà không tạo link. Đề xuất 03/11 đã đặt nút "Kiểm tra kết nối" (tạo link thử 2.000đ rồi hủy) ở Epic 3. Story 3.4 cần báo `TINGEE_CREDENTIAL_INVALID` kèm câu nhắc cấp quyền "Cổng thanh toán".
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 3.4 (mã 1133 → `TINGEE_CREDENTIAL_INVALID`) và 4.2-a/4.2-b (cờ `gateway_permission_missing` và banner nhắc cấp quyền Cổng thanh toán). Bằng chứng: `modules/tingee/errors.ts:18-19`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md`
  summary: Chưa biết `get-va-paging` trả gì cho merchant chưa liên kết tài khoản nào (`items: []`, `items: null` hay `data: null`). Adapter chỉ nhận mảng; nếu Tingee trả null thì bước kết nối thành 503 và không bao giờ tới được `empty-state`.
  evidence: Review 03/11 pass 1 #16 (maybe-false; nếu đúng là medium). Tài liệu và OpenAPI của Tingee chỉ có ví dụ có phần tử, và schema của `data` để trống. Cách chốt: gọi UAT bằng một merchant mới chưa liên kết ngân hàng (test hợp đồng, Story 4.7, hoặc thử tay bằng key UAT trong `.env` local).
- Story nhận (21/11/2026, E4-8): action item E3-3. Chốt bằng UAT với một merchant chưa liên kết ngân hàng (test hợp đồng).

## Deferred from: code review of spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md`
  summary: Thêm tài khoản và "Đặt làm mặc định" đổi nơi nhận tiền của Đơn mới mà không có xác nhận lại (`REAUTH_REQUIRED`) hay email cảnh báo. Story 2.13 hiện chỉ nói "đổi tài khoản nhận tiền / đổi key" theo mô hình một tài khoản.
  evidence: Review 03/11 #11. Tiền chỉ vào được các VA trong merchant Tingee của chính BTC, vì đổi key bị khóa từ lần liên kết đầu (quyết định Q2). Khi viết lại Story 2.13, phải chốt xem đặt mặc định có cần xác nhận lại và email cảnh báo không, và audit "4 số cuối cũ và mới" của tài khoản mặc định.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md`
  summary: Tài liệu kế hoạch vẫn theo mô hình một tài khoản nhận tiền mỗi BTC, cần chạy `bmad-correct-course`: AC Story 2.6 và 2.13 trong `epics.md`, quy tắc PRD (`prd.md:97`, "một tài khoản nhận tiền hiện hành"), AD-6 (tạo link bằng VA của tài khoản mặc định), AD-35, UX "Tài khoản nhận tiền" (danh sách, mặc định, hủy liên kết).
  evidence: Review 03/11 #12. Quyết định Q1–Q3 (03/11/2026) nằm trong khối frozen của spec này. Epic 3 (Story 3.4) đọc AD-6, nên phải sửa trước khi làm Epic 3.
- Đã xử lý (03/11/2026): hai mục trên (#11 bảo vệ "Đặt làm mặc định" và hủy liên kết; #12 tài liệu kế hoạch theo mô hình một tài khoản) được giải quyết bằng `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03-nhieu-tai-khoan-nhan-tien.md` (Mason duyệt). Story 2.13 viết lại thành "Đổi key Tingee và bảo vệ thao tác đổi nơi nhận tiền". Ngoài ra AD-7 và Story 3.5/3.6 bỏ điều kiện kiểm `vaAccountNumber`, vì IPN của Tingee không có trường VA.

## Deferred from: code review of spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md, cả nhánh (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md`
  summary: `vaAccountNumber` được trả về web và lưu ở `payout_accounts.va_account_number`. Nếu với một số loại tài khoản, VA của Tingee chính là số tài khoản ngân hàng gốc, AC "không lộ số tài khoản gốc" của Story 2.6 sẽ sai trên production.
  evidence: Review cả nhánh 03/11 (maybe-false; nếu đúng là high). Test "không lộ bí mật" chỉ qua được vì VA trong fake khác `accountNumber`. Cách chốt: so `vaAccountNumber` với `accountNumber` trên UAT cho từng `accountType`.
- Story nhận (21/11/2026, E4-8): action item E3-3. So `vaAccountNumber` với số tài khoản gốc trên UAT cho từng `accountType`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md`
  summary: Trang tài khoản nhận tiền đưa URL IPN `/v1/payments/tingee/ipn/{ipnKey}` cho BTC dán lên portal Tingee, trong khi route này chưa có (Story 3.5). Nếu portal gọi thử URL khi lưu, hoặc gửi IPN trước Epic 3, Tingee sẽ nhận 404.
  evidence: Review cả nhánh 03/11 (maybe-false; nếu đúng là medium). Cách chốt: lưu URL IPN trên portal UAT, xem Tingee có gọi thử không và có chặn lưu khi gọi lỗi không. Nếu có thì thêm route tạm trả thành công, hoặc ghi chú "chưa hoạt động".
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 3.5 (route IPN đã có). Bằng chứng: `apps/api/src/api.module.ts:78`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-tao-su-kien-nhap.md`
  summary: Story 2.7-b — ảnh Sự kiện: hạ tầng object storage S3 (MinIO trong docker-compose, biến `S3_*`, `@aws-sdk/client-s3` + presigner), API cấp presigned PUT (JPEG/PNG/WebP ≤ 5 MB, key `orgs/{orgId}/events/{uuid}.{ext}`, chỉ nhận key đúng tiền tố BTC), cột `events.image_key`, ô ảnh ở wizard bước 1 và thumbnail của `event-card` (AD-22).
  evidence: Spec 2.7 bản đầy đủ ~4.000 token; Mason chọn tách phần ảnh ra spec riêng (03/11/2026) vì đây là hạ tầng mới, review và merge riêng được mà không làm hỏng luồng tạo nháp.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.8 (`spec-4-8-a-ha-tang-va-api-anh-su-kien.md`, `spec-4-8-b-anh-su-kien-tren-web.md`). Bằng chứng: `event/schema.ts:54` (`image_key`).

## Deferred from: code review of spec-2-7-tao-su-kien-nhap.md (2026-11-05)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-tao-su-kien-nhap.md`
  summary: `EventService.update` (`PATCH /v1/orgs/:orgId/events/:eventId`) và trang `su-kien/{id}/thiet-lap` không kiểm `status`/`locked_at`, nên Owner/Admin sửa được Sự kiện đã mở bán, ẩn, hủy hoặc bị Quản trị Tingee khóa. Cần guard + mã lỗi riêng (vd. `EVENT_NOT_EDITABLE`) và test, cùng lúc với Story 2.10/2.12 (lần đầu có đường chuyển khỏi `draft`) hoặc Epic 7 (đặt `locked_at`).
  evidence: Review sau merge 05/11 (BH, EC, AA). Ở 2.7 chưa đạt tới được (triage #6), nhưng cảnh báo chỉ nằm trong spec 2.7, không có TODO trong code.
- Trùng (21/11/2026, E4-8): phần sửa sau mở bán theo dõi ở mục "Nửa còn lại của deferred 2.10" (phần "Deferred from: code review of spec-2-12-sua-an-va-ket-thuc-som-su-kien.md (2026-11-06)"), đã xử lý; phần Sự kiện đã hủy đã chặn (`event/event.service.ts:54`, `EVENT_CANCELLED`). Story nhận (21/11/2026, E4-8): 7.4 cho phần Sự kiện hoặc BTC bị khóa.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-tao-su-kien-nhap.md`
  summary: `publicBySlug` chỉ loại `status = 'draft'`; Sự kiện bị khóa (`locked_at`), `hidden`, `cancelled` vẫn trả cho người ẩn danh. Story 2.11 cần chốt luật hiển thị (FR-7: `hidden` vẫn mở bằng link) và thêm test cho từng trạng thái.
  evidence: Review sau merge 05/11 (BH, EC). Hiện chỉ test `published`.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 2.11 (luật hiển thị theo trạng thái, trạng thái bán do `sellability` quyết). Bằng chứng: `event/public-event.ts:12`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-9-cau-hinh-form-mua-ve.md`
  summary: "Các trường bổ sung khác" của FR-9 (trường dựng sẵn như Ngày sinh, CCCD, Size áo, mỗi trường có định dạng và cách xử lý PII riêng) chưa làm. Story 2.9 chỉ có trường mặc định và câu hỏi riêng dạng văn bản/lựa chọn một.
  evidence: Mason chọn bỏ qua ở 2.9 (05/11/2026): câu hỏi riêng đã đủ cho MVP. Trường dựng sẵn cần chốt danh sách, định dạng và xử lý PII (NĐ 13/2023).
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): trường dựng sẵn của FR-9 ngoài MVP (Mason, `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-09-doi-chieu-spec.md`).

## Deferred from: code review of spec-2-8-hang-ve-va-ton-kho.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-8-hang-ve-va-ton-kho.md`
  summary: Chưa có e2e cho nhánh server trả `400 VALIDATION_FAILED` với input đã qua kiểm phía web, ở form Hạng vé (`serverIssuePaths` → lỗi theo ô, fallback `UNMATCHED_SERVER_ERROR`) và ô giới hạn Vé/Đơn. Thêm một case trong `ticket-types.spec.ts` cho mock trả `issues:[{path:'price'}]` với input hợp lệ.
  evidence: Review sau merge 06/11 (VG). Web và API dùng chung schema nên hiện gần như không đạt tới được.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu e2e: `apps/web/e2e/ticket-types.spec.ts:126,135` là API giả từ chối input sai mà web đã chặn trước, chưa ca nào gửi input hợp lệ rồi nhận 400.

## Deferred from: code review of spec-2-9-cau-hinh-form-mua-ve.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-9-cau-hinh-form-mua-ve.md`
  summary: Chưa có test API cho `PUT …/form/order` với id câu hỏi viết hoa và `PATCH` câu hỏi với id phương án viết hoa (phải giữ id cũ, `changedFields` không có `options`). Bỏ `.toLowerCase()` trong `reorder`/`optionsOf` thì không test nào đỏ.
  evidence: Review sau merge 06/11 (VG, BH). Web chỉ gửi lại id chữ thường; thêm khi Epic 3 dùng id phương án.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu test API cho id viết hoa.

## Deferred from: tách phạm vi Story 2.10 (2026-11-06)

- source_spec: none
  summary: `ordering.sellability(eventId)` — trạng thái bán theo từng Hạng vé và `eventReason` (Đang bán / Chưa mở bán / Đã đóng bán / Hết vé / Tạm ngừng bán / Ẩn / Bị khóa / Đã hủy / Đã kết thúc), gồm AC "Closed Beta bị thu hồi → Hạng vé có phí Tạm ngừng bán, 0đ vẫn bán" (AD-21, FR-37). Làm trước hoặc đầu Story 2.11.
  evidence: Tách khỏi Story 2.10 theo lựa chọn của Mason (06/11/2026): là hàm backend ship độc lập, chưa có consumer cho tới 2.11/Epic 3. Phải dùng lại cùng luật điều kiện với `event.publishReadiness` (Closed Beta, tài khoản nhận tiền, chính sách hoàn vé, giá ≥ 2.000đ) để không lệch luật.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 2.11 (2.11-a). Bằng chứng: `modules/ordering/index.ts:64` (`sellability`, `saleStatusOf`).

## Deferred from: code review of spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: Sau khi mở bán, API sửa Sự kiện/Hạng vé/form vẫn chạy không xét `status`. Có thể xóa chính sách hoàn vé, hoặc thêm Hạng vé có phí khi BTC chưa duyệt Closed Beta hoặc chưa có tài khoản nhận tiền. Story 2.12 thêm guard; `ordering.sellability` phải xét lại chính sách hoàn vé, Closed Beta và tài khoản theo từng Hạng vé.
  evidence: Triage 2.10 #2 (BH, EC). `EventService.update` và `lockEventForTicketTypes` không kiểm `status`; `publishReadiness` chỉ chạy lúc `draft` → `published`. Wizard "Lưu nháp" vẫn PATCH được Sự kiện đã mở bán.
- Đã xử lý (09/11/2026): phần Hạng vé của mục trên (retro Epic 2 C1) được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`. Sự kiện khác nháp: tạo Hạng vé có phí hoặc đổi Hạng vé 0đ sang có phí khi BTC chưa đạt `paidSalesAllowed` → `409 PAID_TICKET_TYPE_NOT_ALLOWED`; xóa Hạng vé cuối → `409 LAST_TICKET_TYPE`. Trần miễn phí tính theo tổng suất các Hạng vé 0đ ở mọi Sự kiện. Phần sửa Sự kiện và form không thuộc spec này (không đổi `EventService.update`), đã ghi lại thành mục hoãn riêng ở cuối file; `ordering.sellability` (2.11-a) đã xét lại chính sách hoàn vé, Closed Beta và tài khoản nhận tiền khi bán.
- Trùng (21/11/2026, E4-8): phần còn lại (sửa Sự kiện và form sau mở bán) theo dõi ở mục "Nửa còn lại của deferred 2.10" (phần "Deferred from: code review of spec-2-12-sua-an-va-ket-thuc-som-su-kien.md (2026-11-06)"), đã xử lý.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: Link công khai sau khi mở bán dựng từ `window.location.origin`. Nếu deploy tách host dashboard và trang Sự kiện công khai, cần biến cấu hình origin công khai (gắn Story 4.7 / 2.11).
  evidence: Triage 2.10 #13 (BH). `publish-panel.tsx` `useOrigin()`; hiện chỉ có `NEXT_PUBLIC_API_BASE_URL`.
- Story nhận (21/11/2026, E4-8): 9.1. Biến origin công khai chỉ cần khi deploy tách host.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: Epic 7 (khóa BTC) phải thay thân `organizationLocked()` trong `apps/api/src/modules/event/publish.service.ts` (đang luôn `false`) và thêm test cho nhánh `ORGANIZATION_NOT_LOCKED` chưa đạt. `sellability` cũng cần xét khóa BTC.
  evidence: Triage 2.10 #19 (BH). Chưa có cột hay hàm khóa BTC; stub có chủ đích theo spec 2.10.
- Story nhận (21/11/2026, E4-8): 7.4. Khóa BTC thay stub `organizationLocked()` và thêm test nhánh `ORGANIZATION_NOT_LOCKED`.

## Deferred from: code review of spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: `publishReadiness` chỉ export từ `apps/api/src/modules/event/publish.service.ts`, chưa qua `apps/api/src/modules/event/index.ts`; chữ ký nhận dòng Sự kiện đã đọc, không nhận `eventId`. Khi làm `ordering.sellability`, export qua `index.ts` với chữ ký mô-đun `ordering` cần, để luật điều kiện nằm một chỗ (AD-10, AD-34).
  evidence: Code review 2.10 (AA, BH). `module-graph.cjs` chỉ cho import qua `index.ts`; hiện chưa có consumer ngoài mô-đun `event`.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 2.11 (luật điều kiện ở `sale-rules`, export qua `index.ts`). Bằng chứng: `event/index.ts:35`.

## Deferred from: tách phạm vi Story 2.11 khi build (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-a-sellability-va-availability.md`
  summary: Story 2.11-b — trang `/e/{slug}` trong `(public)`. Gồm SSR fetch không cookie với `next: {revalidate: 30, tags: ['event:{slug}']}`, `event-hero` (gradient coral vì chưa có ảnh 2.7-b, ngày-giờ "· 07:00 – 17:00", địa điểm mở Google Maps), hàng BTC, chia sẻ Web Share/`copyWithToast`, `status-banner` theo `eventReason` (copy theo EXPERIENCE), `ticket-tier-row` gọi `/availability` lúc tải và khi `visibilitychange`, 2 cột ≥ `lg`, `loading.tsx` Skeleton, empty-state 404, `generateMetadata` + `opengraph-image.tsx` (font tiếng Việt), `noindex` cho `hidden`. Revalidate on-demand: API enqueue job pg-boss bằng `tx` sau mỗi lần sửa Sự kiện/Hạng vé/mở bán, gọi `POST {WEB_INTERNAL_URL}/api/revalidate` kèm `REVALIDATE_SECRET`, web gọi `revalidateTag`. e2e cần mock HTTP server cho fetch SSR (`page.route` không chặn được).
  evidence: Mason chọn tách 2.11 thành 2.11-a (API) và 2.11-b (web) ngày 06/11/2026 vì spec gộp khoảng 4.000 token. Mason chọn cách revalidate qua pg-boss (AD-37) cùng ngày.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-2-11-b-trang-su-kien-cong-khai.md`. Bằng chứng: `apps/web/app/(public)/e/[slug]/page.tsx`.

## Deferred from: tách phạm vi Story 2.11-b khi build (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-b-trang-su-kien-cong-khai.md`
  summary: Story 2.11-c — revalidate ngay trang `/e/{slug}` khi BTC sửa: queue pg-boss `event.revalidate-public-page` (payload `{slug}`, retry + dead-letter) enqueue bằng `tx` ở `event.service.update`, `publish.service.publish`, `flows/ticket-types.flow.ts` (tạo/sửa/xóa); handler ở worker `POST {WEB_INTERNAL_URL}/api/revalidate` với `Authorization: Bearer {REVALIDATE_SECRET}`; route web so secret bằng `timingSafeEqual` (sai → 401, thiếu env → 503) rồi hết hạn tag `event:{slug}` ngay; thêm hai biến env cho worker. Mẫu: `modules/organizer/invitation-jobs.ts`.
  evidence: Spec 2.11-b gộp khoảng 3.000 token; Mason chọn tách ngày 06/11/2026 vì đây là hạ tầng riêng, merge riêng được. Khi chưa có 2.11-c, trang tự làm mới sau 30 giây (tag `event:{slug}` đã gắn sẵn ở 2.11-b).
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-2-11-c-revalidate-trang-su-kien.md`. Bằng chứng: `apps/web/app/api/revalidate/route.ts`.

## Deferred from: code review of spec-2-11-b-trang-su-kien-cong-khai.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-b-trang-su-kien-cong-khai.md`
  summary: Checklist deploy web (Story 4.7) phải đặt `WEB_ORIGIN` (origin công khai, dùng làm `metadataBase` cho `og:image`/`og:url`) và cân nhắc `API_INTERNAL_URL` (SSR gọi api qua mạng nội bộ); thiếu `WEB_ORIGIN` ở production thì nên báo lỗi khi khởi động thay vì âm thầm dùng localhost. Kiểm luôn font OG `apps/web/assets/fonts/*.ttf` có trong image.
  evidence: Review 2.11-b #2 (BH, EC): `page.tsx` `metadataBase()` trả `undefined` khi thiếu `WEB_ORIGIN`, Next fallback `http://localhost:…`, preview Facebook/Zalo mất ảnh. Chưa có cấu hình deploy web để sửa.
- Đã xử lý (19/11/2026), phần `WEB_ORIGIN`: mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-f-cau-hinh-production-web.md`. Web chạy thật (host của `NEXT_PUBLIC_API_BASE_URL` hoặc `WEB_ORIGIN` không phải local) mà thiếu `WEB_ORIGIN` hoặc `WEB_ORIGIN` không phải https thì server web không khởi động: `register()` của `apps/web/instrumentation.ts` nêu tên biến rồi thoát mã 1. `metadataBase()` của `/e/[slug]` giữ nguyên. Phần font OG `apps/web/assets/fonts/*.ttf` có trong image chuyển sang Story 9.1, lúc dựng image web (repo chưa có image web; Mason chốt 19/11/2026). `API_INTERNAL_URL` vẫn thuộc checklist deploy của 9.1.
- Đã có AC 9.1 (E4-7), ghi 21/11/2026 (phần font OG trong image). Story nhận (21/11/2026, E4-8): 9.1 cho `API_INTERNAL_URL`.

## Deferred from: build of spec-2-11-c-revalidate-trang-su-kien.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-c-revalidate-trang-su-kien.md`
  summary: Story 4.7 — `revalidateTag` ở `apps/web/app/api/revalidate/route.ts` chỉ xóa cache của instance web nhận request. Chạy nhiều instance web thì cần cache handler dùng chung (`cacheHandler`, vd. Redis) hoặc gọi revalidate tới từng instance; không thì instance khác vẫn trả bản cũ tới 30 giây. Checklist deploy cũng phải đặt cùng `REVALIDATE_SECRET` cho worker và web (web thiếu → route 503, im lặng chờ 30 giây) và cho worker tới được `WEB_ORIGIN` (nếu đi qua mạng nội bộ thì cân nhắc biến origin nội bộ riêng).
  evidence: Design Notes của spec 2.11-c. Hiện chạy một instance web; worker gọi `POST {WEB_ORIGIN}/api/revalidate`.
- Story nhận (21/11/2026, E4-8): 9.1. Cache handler dùng chung, `REVALIDATE_SECRET` chung cho worker và web, đường worker tới web đều theo topology deploy.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-c-revalidate-trang-su-kien.md`
  summary: Story 4.7 — nếu đặt CDN trước web, CDN vẫn giữ bản cũ của `/e/{slug}` (ISR, `Cache-Control: s-maxage=…`) bất kể `revalidateTag`; cần purge CDN theo đường dẫn khi revalidate, hoặc không cache `/e/*` ở CDN.
  evidence: Review 2.11-c #14 (BH): route handler chỉ xóa cache của Next; CDN không biết tag `event:{slug}`.
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-c-revalidate-trang-su-kien.md`
  summary: Story nào thêm đổi tên BTC hoặc khóa BTC (Epic 7) làm đổi phần tĩnh của trang Sự kiện phải enqueue `enqueuePublicPageRevalidation` cho mọi Sự kiện không còn nháp của BTC đó.
  evidence: Review 2.11-c #15 (BH): `publicEventDetail` trả `organizationName`; hiện chưa có endpoint đổi tên nên chưa có trigger.
- Story nhận (21/11/2026, E4-8): 7.4. Khóa/mở khóa BTC phải enqueue revalidate cho mọi Sự kiện không còn nháp; backlog chưa có story đổi tên BTC.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-sua-an-va-ket-thuc-som-su-kien.md`
  summary: Ẩn / Hiện lại / Kết thúc / sửa Sự kiện chưa xét khóa Sự kiện (`locked_at`) hay khóa BTC; UX yêu cầu nút "Mở bán"/"Ẩn" tắt kèm lý do khi bị khóa — làm cùng Epic 7.
  evidence: `event-status.service.ts` `transition` chỉ xét `status` và `effective_end_at`; hiện chưa có đường khóa nên chưa ai gặp (`sellability` vẫn trả `locked`). Review pass 2 #25.
- Story nhận (21/11/2026, E4-8): 7.4. Ẩn, Hiện lại, Kết thúc và sửa Sự kiện xét khóa Sự kiện và khóa BTC, kèm lý do tắt nút.

## Deferred from: code review of spec-2-12-sua-an-va-ket-thuc-som-su-kien.md (2026-11-06)

- Sự kiện `cancelled` chỉ bị chặn sửa thông tin (`PATCH …/events/:eventId` → `409 EVENT_CANCELLED`); Hạng vé, câu hỏi form mua vé và `PATCH …/order-limit` vẫn ghi được, tab Hạng vé/Form mua vẫn sửa được. `form.service.ts:30` ghi "2.10/2.12 thêm guard" nhưng chưa có. Chưa ai gặp vì chưa có đường hủy Sự kiện — làm cùng Epic 7 (cùng mục khóa Sự kiện đã hoãn).
- Story nhận (21/11/2026, E4-8): 7.1. Hủy Sự kiện là đường đầu tiên tạo Sự kiện `cancelled`; chặn sửa Hạng vé, form và giới hạn Đơn trong story đó.

- source_spec: none
  summary: Story 2.13-b — luồng "Đổi key Tingee": xác nhận lại, nhập key mới, chọn tài khoản; credential mới thành hiện hành, tài khoản của credential cũ gỡ mềm, credential cũ giữ (mã hóa), ipnKey không đổi; audit + email cảnh báo; key sai/Tingee lỗi giữ nguyên hiện trạng.
  evidence: Tách khỏi Story 2.13 lúc bmad-build (2026-11-08) để 2.13-a làm trước phần xác nhận lại (REAUTH_REQUIRED) dùng chung cho đặt mặc định/hủy liên kết, đổi key và 2.14.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 2.13-b (`spec-2-13-b-doi-key-tingee.md`). Bằng chứng: `organizer/payout-account.controller.ts:44-69`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Mã TOTP dùng lại được trong cửa sổ 30 giây (Better Auth `verifyTOTP` không lưu bước thời gian đã dùng), nên một mã bị lộ cấp được nhiều lần xác nhận lại (và step-up nhiều lần); cần lưu bước TOTP đã nhận theo user và từ chối bước ≤ bước cũ.
  evidence: Review 2.13-a #3 (BH, EC). Có từ step-up (2.2); `payout-account.test.ts` đang dựa vào việc dùng lại mã (`ownerTokens(6)`), sửa thì phải đổi test.
- Story nhận (21/11/2026, E4-8): 7.7. Cùng nhóm TOTP của Quản trị Tingee; sửa phải đổi `payout-account.test.ts` (`ownerTokens(6)`).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Xóa Admin (`DELETE /orgs/:orgId/members/:memberId`) không đòi xác nhận lại, nên phiên Owner bị lộ có thể xóa hết Admin trước khi đổi tài khoản mặc định, và email cảnh báo chỉ tới hộp thư của Owner; cân nhắc thêm xóa Admin vào danh sách thao tác nhạy cảm (AD xác nhận lại) hoặc báo Admin bị xóa.
  evidence: Review 2.13-a #6 (BH). Kiến trúc hiện chỉ liệt kê đổi key, đặt mặc định, hủy liên kết, chuyển Owner; xóa Admin có từ 2.4.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): không thêm xóa Admin vào danh sách thao tác cần xác nhận lại trong MVP; muốn đổi phải sửa danh sách thao tác nhạy cảm trong AD (bảo mật).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Story 2.13-b — `PayoutAccountService.select` biến tài khoản đầu tiên thành mặc định (`isDefault = linkedVas.size === 0`) mà không xác nhận lại và không gửi cảnh báo; đổi key xong chọn tài khoản đầu tiên chính là đường này, nên 2.13-b phải gửi cảnh báo (payload `previousAccountId` cần cho phép null hoặc mang 4 số cuối mặc định cũ).
  evidence: Review 2.13-a #7 (BH, EC, VG). Hành vi có từ 2.6; ở 2.13-a lần hủy tài khoản cuối đã gửi cảnh báo và tài khoản mới phải cùng merchant Tingee.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 2.13-b. Bằng chứng: `organizer/payout-account.service.ts:556-557` (`notifyDefaultChanged` khi chọn tài khoản sau đổi key).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Email bảo mật (TOTP, mã xác nhận, cảnh báo đổi tài khoản mặc định) khuyên "đăng xuất khỏi mọi thiết bị" nhưng Tickee chưa có tính năng đăng xuất mọi session; cần thêm tính năng hoặc đổi câu chữ.
  evidence: Review 2.13-a #12 (BH). Câu chữ có từ `totp-email.ts` (2.2); không có route revoke-all trong `apps/api/src` hay `apps/web`.
- Story nhận (21/11/2026, E4-8): action item E4-11. Đổi câu chữ email bảo mật (chưa có tính năng đăng xuất mọi thiết bị).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-b-doi-key-tingee.md`
  summary: Các route nhận key Tingee (`POST …/payout-account/credential` của BTC chưa liên kết, `POST …/credential/replacement/preview` sau một lần xác nhận lại) không giới hạn tần suất, nên dùng được để dò key Tingee và đốt hạn mức gọi Tingee; cần giới hạn theo user/BTC trước `listAccounts`.
  evidence: Review 2.13-b #3 (BH, EC). Không có throttle nào trong `modules/organizer`, `modules/tingee`, `platform/http`; `connect` cho dò như vậy từ 2.6, `preview` lặp lại cùng mức phơi bày trong 5 phút của một lần xác nhận.
- Story nhận (21/11/2026, E4-8): action item E4-4. Cùng nhóm giới hạn tốc độ trước Closed Beta.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-14-chuyen-quyen-owner.md`
  summary: Job email gửi nhiều người (báo chuyển quyền Owner, cảnh báo đổi tài khoản nhận tiền mặc định) gửi lại cho mọi người mỗi lần retry khi chỉ một địa chỉ lỗi.
  evidence: `notifyOwnershipTransferred` và `notifyDefaultPayoutChanged` ném lỗi khi có một email lỗi, pg-boss retry tới 8 lần và gửi lại cả danh sách; cần nhật ký đã gửi theo job hoặc tách job theo người nhận.
- Đã xử lý (11/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`, theo hướng tách job theo người nhận (không làm nhật ký đã gửi, không migration). Job gốc chốt danh sách người nhận rồi tạo mỗi người một job con trong cùng queue (`fanOut`, id con suy cố định từ id gốc và `userId`, nên job gốc chạy lại không nhân đôi con); job con gửi đúng một email, SMTP lỗi thì chỉ job con đó retry. Job enqueue trước khi deploy (không có `recipientUserId`) được xử lý như job gốc.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-1-xac-nhan-lai-khi-bat-2fa.md`
  summary: Chưa có đường khôi phục khi 2FA bị người khác bật trên tài khoản (chủ thật kẹt ở bước step-up, không có "Đặt lại TOTP" hay quy trình hỗ trợ).
  evidence: Retro Epic 2 ghi "Đặt lại TOTP" chưa có; email "2FA vừa được bật" chỉ dặn liên hệ hỗ trợ. Cần trước Closed Beta (quy trình hỗ trợ) hoặc Epic 7.
- Story nhận (21/11/2026, E4-8): 7.7. Đặt lại TOTP ở `/admin` là đường khôi phục.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-2-huy-session-khi-doi-2fa.md`
  summary: Dialog tắt 2FA và gợi ý dùng mã khôi phục trên web chưa báo trước rằng các thiết bị khác sẽ bị đăng xuất; EXPERIENCE.md (dòng tắt 2FA) cũng chưa ghi.
  evidence: E2-2 đăng xuất mọi session khác khi gỡ 2FA nhưng spec không đổi web; câu chữ hiện ở `security-settings.tsx` và `step-up-dialog.tsx` chỉ nói "chỉ còn được bảo vệ bằng email". Ảnh hưởng người dùng nhiều thiết bị (vd. Owner đang check-in trên vài điện thoại).
- Story nhận (21/11/2026, E4-8): action item E4-11. Sửa câu chữ dialog tắt 2FA và EXPERIENCE.md.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`
  summary: Sự kiện đã hủy vẫn thêm, sửa, xóa được Hạng vé (flow Hạng vé không chặn `cancelled` như `EventService.update`); câu `LAST_TICKET_TYPE` cũng không hợp với Sự kiện đã hủy.
  evidence: Review E2-3 #8. Spec 2.12 đã hoãn việc chặn sửa Hạng vé và câu hỏi form của Sự kiện đã hủy; nên làm cùng Story 7.1 (Hủy sự kiện) hoặc trước Epic 3 nếu checkout đọc Hạng vé của Sự kiện đã hủy.
- Trùng (21/11/2026, E4-8): theo dõi ở mục "Sự kiện `cancelled` chỉ bị chặn sửa thông tin" (phần "Deferred from: code review of spec-2-12-sua-an-va-ket-thuc-som-su-kien.md (2026-11-06)"), Story nhận ở đó: 7.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`
  summary: Chưa quyết Hạng vé 0đ trong Sự kiện hỗn hợp được mua theo đường nào (miễn phí: không Token, phát Vé ngay; hay theo đường có phí), và giỏ trộn dòng 0đ với dòng có phí.
  evidence: Review E2-3 #9. Từ E2-3 trần 200 suất áp cho cả Sự kiện hỗn hợp, nhưng Story 3.3 (epics) vẫn chỉ nói "Sự kiện miễn phí". Phải ghi vào spec 3.2/3.3/3.4 (checklist E2-6) trước khi làm checkout.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 3.3 (Đơn 0đ đi đường miễn phí, phát Vé ngay). Bằng chứng: `ordering/place-order.ts:206`.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`
  summary: Nửa còn lại của deferred 2.10: sau mở bán vẫn sửa được thông tin Sự kiện (kể cả xóa chính sách hoàn vé) và câu hỏi form mua.
  evidence: Review E2-3 #10. E2-3 chỉ đóng phần Hạng vé. Người nhận đề xuất: E2-6 (checklist sẵn sàng Epic 3, mục "snapshot chính sách hoàn vé") hoặc một story Epic 3 có tên trước 3.2.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở E2-6 và Story 3.2 (Đơn chụp chính sách hoàn vé và câu hỏi form lúc mua), email đổi giờ/địa điểm ở Story 3.10. Bằng chứng: `ordering/schema.ts:119,223`.

- source_spec: none
  summary: E2-5 phần API — helper queue/worker chung cho pg-boss (gom khung 4 file `*-jobs.ts`, sửa lỗi gửi lại email cho mọi người nhận khi retry), `escapeHtml` vào `platform/email`, formatter ngày giờ `Asia/Ho_Chi_Minh` chung trong contracts, bỏ phần `MESSAGES` không dùng trong `error.filter.ts`.
  evidence: Tách khỏi E2-5 (retro Epic 2 mục D2) theo quyết định của Mason ngày 09/11/2026: phần Web làm trước để gỡ chặn Story 3.1; phần API phải xong trước story Epic 3 đầu tiên thêm queue mới (3.5 / 3.8).
- Đã xử lý (11/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`. Năm file `*-jobs.ts` dùng khung chung ở `platform/jobs/queue.ts` (`defineQueue`, `QueueProducer`, `registerQueueWorker`, `jobErrorMessage`, `fanOut`); `escapeHtml` ở `platform/email/escape-html.ts`; `formatVnDateTime` / `formatVnDate` trong `packages/contracts/src/event.ts` thay 4 chỗ tự tạo `Intl.DateTimeFormat` (api và web); `MESSAGES` của `error.filter.ts` chỉ còn 5 mã `codeForStatus` trả. `identity-janitor.ts` (job lịch cron) giữ khung riêng theo spec.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-web.md`
  summary: Đăng xuất từ menu tài khoản (`components/tickee/account-menu.tsx`) thất bại thì không báo gì, người dùng tưởng đã đăng xuất.
  evidence: Review E2-5 #15. `useSignOut` ở account-menu không có `onError`, và bản trước refactor cũng không có, tức là lỗi có từ trước. Hướng sửa: `toast.error('Chưa đăng xuất được. Vui lòng thử lại.')`.
- Story nhận (21/11/2026, E4-8): action item E4-11. Thêm `onError` cho đăng xuất ở `account-menu.tsx`.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-web.md`
  summary: E2E `purchase-form.spec.ts:376` (sắp thứ tự câu hỏi, kiểm focus sang nút "Xuống") chập chờn trên cả android-chromium và ios-webkit.
  evidence: Chạy lặp 40 lần: baseline `14b9084` fail 4/40, bản E2-5 fail 2/40. Focus được đặt trong `requestAnimationFrame` sau `setQueryData` + `invalidateQueries` (`purchase-form-editor.tsx` ~:671-675), nên dễ đua với lần render của refetch. Nên gộp vào việc ghi các test webkit chập chờn ở E2-8.
- Đã xử lý (10/11/2026): mục trên được sửa tận gốc ở `purchase-form-editor.tsx`, không nới timeout hay thêm retry. Nguyên nhân không nằm ở refetch: TanStack Query báo cache đổi cho React qua `setTimeout(0)`, nên lần render thứ tự mới là một task riêng và có thể tới sau khung hình kế. Khi `requestAnimationFrame` chạy trước, nút "Xuống Trình độ" vẫn `disabled` theo thứ tự cũ nên `focus()` không có tác dụng. Đo bằng spec chẩn đoán tạm (ghi mỗi lần `focus()` và lúc danh sách đổi trong DOM): 6/6 lần fail đều focus trước khi đổi thứ tự, lúc nút còn `disabled`; 74/74 lần pass đều sau. Ép rAF chạy ngay thì fail 10/10. Cách sửa: `onSuccess` chỉ ghi nút đích vào ref; `useEffect` theo `questions` focus sau lần commit có thứ tự mới (cùng mẫu `pendingFocus` của form câu hỏi). Sau khi sửa: chạy lặp 40 lần pass 80/80 trên hai project; ép rAF chạy ngay thì pass 20/20.

## Deferred from: build of spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md (2026-11-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md`
  summary: Story 4.6 — giới hạn tốc độ theo IP cho `POST /v1/events/:slug/funnel-events` (`@Public`, không cần đăng nhập). Hiện ai cũng bơm được `buy_clicked` (mỗi lần một `funnelId` mới) làm lệch mẫu số SM-C2 và phình bảng append-only `checkout_funnel_events`; `login_completed` thì phải đi theo cặp với `buy_clicked`. Đếm trong Postgres theo HMAC IP như `google_start_events`, vượt ngưỡng thì vẫn trả 204 nhưng không ghi.
  evidence: Spec 3.1 § Never: "Không giới hạn tốc độ theo IP cho endpoint phễu ở story này (ghi vào `deferred-work.md`, gắn 4.6)". `apps/api/src/modules/ordering/funnel.service.ts` chưa có throttle.
- Story nhận (21/11/2026, E4-8): action item E4-4. E4-4 đã nêu giới hạn tốc độ theo IP cho funnel-events.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md`
  summary: (Chưa kiểm, nếu đúng thì medium) `useBuy` ở `ticket-tiers.tsx` đặt `pending = true` và không bao giờ trả về false. Nếu Checkout redirect server về `/e/{slug}` (lựa chọn hết hợp lệ) mà App Router giữ nguyên instance `TicketPicker`, nút "Mua" sẽ quay mãi tới khi tải lại trang.
  evidence: Review 3.1 (BH, EC, VG) triage #5. Cần thử trên trình duyệt: người đã đăng nhập chọn vé, BTC hạ giới hạn Vé/Đơn (hoặc đóng giờ bán), bấm "Mua", rồi xem nút có bấm lại được không. Đúng thì reset `pending` khi URL đổi, hoặc dùng `useTransition`. Nên làm cùng 3.2, lúc thanh mua được dùng lại ở Checkout.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 3.2. Bằng chứng: `apps/web/app/(public)/e/[slug]/ticket-tiers.tsx:97` (`useTransition`), có e2e hồi quy ở `purchase.spec.ts`.

## Deferred from: build of spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md (2026-11-10)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md`
  summary: Story 4.6 — dọn dòng cũ của `order_create_attempts` (bộ đếm giới hạn tốc độ tạo Đơn). Bảng chỉ cần các dòng trong cửa sổ 10 phút gần nhất nhưng hiện không có job nào xóa, nên phình theo mỗi lần thử tới được TX1 (kể cả lần hết vé của kịch bản NFR-3).
  evidence: Spec 3.2 § Design Notes: "Dọn `order_create_attempts` cũ để vào deferred (4.6)." `apps/api/src/modules/ordering/order-rate-limit.ts` chỉ INSERT; nên gộp vào quét định kỳ lưới an toàn của 4.6 (`DELETE … WHERE created_at < now() - interval '10 minutes'`).
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6-c. Bằng chứng: `ordering/safety-net-jobs.ts:117-122,231`; `test/ordering/safety-net.test.ts:384`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md`
  summary: (Đã kiểm ở 3.2) Deferred 3.1 #5 — nút "Mua" kẹt `pending` khi Checkout redirect về `/e/{slug}` — không tái hiện được trên trình duyệt: sau redirect App Router dựng lại `TicketPicker` (URL đổi từ `?items=…` thành không query), state về mặc định. 3.2 vẫn chuyển `useBuy` sang `useTransition` (spinner hết khi điều hướng xong) và thêm e2e `purchase.spec.ts` › "Mua" không kẹt; e2e đó cũng qua với mã cũ, nên chỉ là test hồi quy, không chứng minh lỗi cũ.
  evidence: Chạy e2e "Mua không kẹt khi Checkout redirect về lại trang Sự kiện" trên bản build dùng `useBuy` cũ (`setPending(true)` không bao giờ về false): 2/2 qua (ios-webkit, android-chromium).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md`
  summary: (Chưa kiểm, nếu đúng thì medium) TX1 tạo Đơn chờ khóa Sự kiện và tồn kho mà không có `lock_timeout`. Lúc tải cao, các TX1 đang chờ chiếm hết 10 kết nối pool, nên request khác có thể lỗi sau 3 giây chờ kết nối.
  evidence: Review 3.2 (EC) triage #16. `orders.service.ts` `placeOrder` chạy trong `db.transaction`, không đặt `SET LOCAL lock_timeout`. Muốn kết luận thì đo trong kiểm thử tải NFR-3 (Story 5.8): 5.000 người mua 300 Vé, xem có lỗi chờ kết nối pool hay không. Nếu có, đặt `lock_timeout` cho TX1 và map `55P03` sang 503 để thử lại.
- Story nhận (21/11/2026, E4-8): 9.2 (thay nhãn "5.8"). Đo trong kiểm thử tải NFR-3.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md`
  summary: (Chưa kiểm, nếu đúng thì medium) Trong flash sale, các TX1 giữ khóa `FOR SHARE` trên dòng `events` nối tiếp nhau liên tục, có thể bỏ đói lệnh `FOR UPDATE` của BTC (Ẩn, Kết thúc, sửa Hạng vé) tới khi hết người mua.
  evidence: Review 3.2 (EC) triage #17. `lockSaleEventBySlug` dùng `FOR SHARE`, và Postgres cho khóa tương thích vào trước người ghi đang chờ. Muốn kết luận thì viết test giữ `FOR SHARE` chồng nhau liên tục từ nhiều client, rồi đo thời gian chờ của một `FOR UPDATE`. Nếu đúng, cân nhắc đặt `lock_timeout` cho lệnh của BTC kèm câu báo rõ ràng, hoặc một khóa xếp hàng công bằng.
- Story nhận (21/11/2026, E4-8): 9.2. Đo thời gian chờ của `FOR UPDATE` trong kiểm thử tải NFR-3.

## Deferred from: build of spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md (2026-11-10)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 4.7. Kiểm cấu hình lúc deploy: `TICKET_QR_KEYS` phải khác `TINGEE_CREDENTIAL_KEYS`, và production không được dùng khóa mẫu trong `.env.example`. Lộ khóa ký thì ai cũng giả được Mã QR vé.
  evidence: Review 3.3 (BH) triage #9. `config.schema.ts` chỉ kiểm định dạng. Lỗ này có sẵn với mọi bí mật trong `.env.example`, kể cả `TINGEE_CREDENTIAL_KEYS`, nên gom vào checklist cấu hình production của 4.7: refine khóa khác nhau, chặn giá trị mẫu khi `NODE_ENV=production`.
- Đã xử lý (18/11/2026): mục ngay trên (triage #9) được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-b-siet-cau-hinh-production.md`. `TICKET_QR_KEYS` có khóa trùng byte với một khóa của `TINGEE_CREDENTIAL_KEYS` thì api/worker dừng ở mọi môi trường (`TICKET_QR_KEYS (dùng chung khóa với TINGEE_CREDENTIAL_KEYS)`). Ở `NODE_ENV=production`, hai biến này từ chối mọi khóa trùng byte với một trong hai khóa mẫu của `.env.example`, bất kể số phiên bản.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 4.7/4.6. Quy trình xoay khóa QR. Nếu gỡ khỏi `TICKET_QR_KEYS` một phiên bản khóa mà còn Vé đang dùng, thì `GET /v1/me/orders/:code` của các Đơn đó trả 500. Hiện chưa có lệnh tra phiên bản nào còn dùng, chưa kiểm lúc khởi động, cũng chưa có công cụ ký lại (`qr_key_version` vẫn sửa được để phục vụ việc này).
  evidence: Review 3.3 (BH) triage #8. `ticketsOfOrder` → `signTicketQr` ném lỗi khi thiếu khóa, đúng như thiết kế; README đã dặn giữ khóa cũ. Cần một runbook xoay khóa (`SELECT DISTINCT qr_key_version FROM tickets`), và tùy chọn kiểm lúc khởi động.
- Ghi thêm (13/11/2026, retro Epic 3 D1, E3-5): phạm vi xoay khóa rộng hơn Trang Đơn. Token link chia sẻ (AD-29, `ticketing/share-token.ts`) là HMAC bằng khóa con suy từ khóa `qr_key_version` của Vé. (1) Gỡ một phiên bản khóa: route công khai `GET /v1/shared-tickets/:token` 500, Chi tiết Vé 500, job email Vé retry rồi vào dead-letter. Spec nhỏ trước 4.1 sửa route công khai về `404` chung và thêm test Vé khóa cũ (Sprint Change Proposal 13/11/2026 §4.6); Chi tiết Vé, Trang Đơn và email vẫn là lỗi cấu hình. (2) Ký lại bằng `UPDATE tickets SET qr_key_version = 2`: QR đúng nhưng `share_token_hash` vẫn là hash của token cũ, nên mọi link, kể cả trong email đã gửi, 404 im lặng. Runbook của 4.7 phải chọn một trong ba: giữ khóa cũ trong `TICKET_QR_KEYS` tới khi mọi Vé của nó qua `effective_end_at` (chỉ ngừng ký Vé mới bằng khóa đó); công cụ ký lại tính lại `share_token_hash` và gửi lại email Vé (link cũ chết); hoặc tách khóa link chia sẻ khỏi khóa QR (đổi AD-29). Kèm lệnh tra `SELECT qr_key_version, count(*) FROM tickets WHERE status = 'valid' GROUP BY 1`.
- Story nhận (21/11/2026, E4-8): 9.1. Phần còn lại là runbook xoay khóa QR (chọn phương án ký lại); kiểm lúc khởi động đã có ở 4.7-g.
- Ghi thêm (26/11/2026, retro Epic 5 S2, S3, E5-4): AC 9.1 đã có khối runbook xoay khóa: khóa đã lộ không được giữ, quét ràng `qr_key_version`, marker `ticket_qr_key_missing` khi thiếu khóa. Spine AD-16 ghi luật ràng phiên bản.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 3.9/7.5. `BuyerTicket` chưa có `status`/`checkedInAt`, và `ticketsOfOrder` không lọc Vé `cancelled`. Khi đã có luồng hủy hoặc vô hiệu Vé, Vé đã hủy vẫn hiện thẻ với QR quét được.
  evidence: Review 3.3 (BH, EC) triage #11. Hiện chưa có đường nào đặt `tickets.status = 'cancelled'`. Story làm hủy Vé (7.1/7.5) hoặc hiển thị Vé (3.9: đã check-in hay đã hủy thì QR mờ .25 + badge) phải thêm `status` vào contract và render đúng.
- Đã xử lý phần hiển thị (12/11/2026): `_bmad-output/implementation-artifacts/spec-3-9-ve-cua-toi-va-chi-tiet-ve.md`. "Vé của tôi" và Chi tiết Vé có `status` của Vé phía Người mua (`MyTicketStatus`: `valid` | `checked_in` | `cancelled`; Vé hủy hoặc Sự kiện hủy → `cancelled`) với badge Hợp lệ/Đã check-in/Đã hủy; Chi tiết Vé chỉ có Mã QR vé khi Vé chưa hủy, Sự kiện chưa hủy và chưa quá `effective_end_at` (máy chủ không ký trong các trường hợp còn lại). Còn lại cho 7.1/7.5: `BuyerTicket` (Trang Đơn) giữ nguyên dạng theo spec 3.9 và `ticketsOfOrder` vẫn không lọc Vé `cancelled`, nên luồng hủy Vé phải xử lý Trang Đơn.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 3.7. Màn Thành công rung và chạy hiệu ứng trượt lên mỗi lần mount, kể cả khi tải lại hoặc mở lại Trang Đơn sau này. 3.7 nên chốt "khoảnh khắc" chỉ chạy khi Đơn vừa chuyển `paid` trong lúc đang xem, hoặc khi vừa từ Checkout sang.
  evidence: Review 3.3 (BH, EC) triage #15. `order-success.tsx` `useSuccessVibration` + `animate-ticket-rise` không có điều kiện. 3.3 không xử lý vì sửa phải thêm state, mà 3.7 sẽ dùng lại màn này cho chuyển trạng thái realtime.
- Đã xử lý (11/11/2026): Story 3.7 (`spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`). `OrderSuccess` nhận `celebrate`: chỉ trượt lên + rung khi trang đang mở thấy Đơn chuyển `paid`, hoặc lần vào đầu tiên có cờ một lần trong `sessionStorage` (Checkout đặt cho Đơn 0đ, nút "Thanh toán" đặt cho Đơn có phí). Mở lại hay tải lại thì hiện ngay (`lib/order/live.ts` › `nextMoment`, e2e `order-live.spec.ts`).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 3.7. Trang Đơn `paid` thay toàn bộ phần tóm tắt (dòng, tổng tiền, câu trả lời) bằng màn Thành công. Với Đơn 0đ thì ổn, nhưng Đơn có phí sẽ mất phần "đã trả bao nhiêu". `expiresAt` của Đơn 0đ bằng `createdAt`, chưa ghi vào contract.
  evidence: Review 3.3 (BH) triage #19. `order-view.tsx` trả `<OrderSuccess>` cho mọi `paid`. 3.7 quyết định có hiện tóm tắt hoặc biên nhận dưới các thẻ Vé hay không.
- Đã xử lý (11/11/2026): Mason chốt khi lập spec 3.7: không thêm biên nhận dưới thẻ Vé, giữ bố cục Thành công đã chốt (stage + thẻ Vé + Mã Đơn). Biên nhận ("đã trả bao nhiêu") để Story 3.9 (Chi tiết Vé / Vé của tôi). `BuyerOrderView` (contract) ghi rõ Đơn 0đ có `expiresAt` = `createdAt`.
- Đã xử lý (12/11/2026): `_bmad-output/implementation-artifacts/spec-3-9-ve-cua-toi-va-chi-tiet-ve.md`. Chi tiết Vé có khối "Biên nhận" (`MyTicketDetail.receipt`): mã Đơn, mỗi dòng "Hạng vé × SL · thành tiền", tổng đã trả (Đơn 0đ ghi "Miễn phí"), thời điểm thanh toán, "Tiền đã chuyển thẳng cho {BTC}" (chỉ Đơn có phí); hiện cả khi Vé đã sang lịch sử.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 3.8/4.1. `TicketingModule` và `TICKET_QR_KEYS` mới chỉ nối ở vai api. Email Vé (3.8, có QR) và Đối soát bù (4.1, gọi `markPaid` nguồn `reconciliation`) chạy trong worker, nên phải thêm khóa vào `workerConfigSchema` và nối DI cho worker.
  evidence: Review 3.3 (BH) triage #18. `config.test.ts` đang ghim "Vai worker chưa cần khóa này", đúng phạm vi 3.3.
- Đã xử lý (11/11/2026): `TICKET_QR_KEYS` và `TicketingModule.forRoot` đã nối ở vai worker từ Story 3.5 (`worker.module.ts`, `worker.test.ts` kiểm thiếu khóa → `ConfigError`). `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md` dùng nó cho worker email Vé (tính lại token link chia sẻ). Phần Đối soát bù (4.1) không cần nối thêm.

## Deferred from: build of spec-3-4-tao-link-thanh-toan-gateway-va-man-thanh-toan.md (2026-11-10)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-4-tao-link-thanh-toan-gateway-va-man-thanh-toan.md`
  summary: Story 4.2. BTC chưa được báo khi `create-link` bị Tingee từ chối vì cấu hình sai: key thiếu quyền "Cổng thanh toán" (`1133`), VA chưa được cho phép trên portal Gateway (`2023`), VA lỗi (`1023`/`1045`/`1024`/`1072`). Banner Owner của `payment_service_status` phải kèm câu nhắc cấp quyền hoặc cho phép VA tương ứng.
  evidence: Mason chốt 10/11 khi lập spec 3.4: 3.4 chỉ log cảnh báo (`organizationId`, mã Đơn, mã Tingee); Người mua thấy "Sự kiện tạm ngừng bán". Mục này đóng phần còn lại của deferred 2.6 ("Story 3.4 cần báo `TINGEE_CREDENTIAL_INVALID` kèm câu nhắc cấp quyền").
- Đã xử lý một phần (13/11/2026): Story 4.2-a (`spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`). `create-link` bằng key hiện hành trả `1133` bật cờ `payment_service_status` lý do riêng `gateway_permission_missing` (`notices` trả `PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING`; job dò bỏ qua lý do này, Owner "Kiểm tra lại" tắt cờ không cần Tingee); `92`/`97`/`1009` bật lý do `credential_invalid` (`PAYMENT_SERVICE_SUSPENDED_CREDENTIAL_INVALID`). Câu nhắc cấp quyền và "Nhập lại key" ở 4.2-b. Nhóm VA (`2023`, `1023`/`1045`/`1024`/`1072`) vẫn không bật cờ nên BTC chưa được báo: xem mục mới của 4.2-a.
- Đã xử lý (14/11/2026): phần nhóm VA đóng ở Story 4.2-d (`spec-4-2-d-tam-ngung-ban-khi-tingee-tu-choi-va.md`): lý do `payout_account_not_allowed`, banner "Tài khoản nhận tiền chưa dùng được với Cổng thanh toán" và hướng dẫn cho phép VA hoặc đổi tài khoản mặc định.

## Deferred from: code review of spec-epic-2-e2-5-refactor-api.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`
  summary: `errorName` (lấy tên lớp lỗi để lỗi lưu vào job không chứa PII) vẫn bị chép y hệt ở `organizer/ownership-transfer-jobs.ts` và `organizer/payout-default-jobs.ts`, có thêm bản inline trong `invitation-jobs.ts`. Phần tra tên BTC cũng lặp (`organizationName()` và truy vấn trong `loadChange()`). Nên gom `errorName` vào `platform/jobs` cạnh `jobErrorMessage`.
  evidence: Review E2-5 API #11 (BH). Phần lặp này có từ trước baseline `4cb9ff3`, không do E2-5 gây ra. Gom khi story kế tiếp thêm job email (3.8 email Vé) để nơi chặn PII chỉ còn một chỗ.
- Đã xử lý (11/11/2026): phần `errorName` của mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md`. `errorName` nằm ở `platform/jobs/queue.ts` cạnh `jobErrorMessage`; ba chỗ chép ở `organizer` (`invitation-jobs.ts`, `ownership-transfer-jobs.ts`, `payout-default-jobs.ts`) và job email Người mua mới của `ordering` đều dùng bản chung. Phần tra tên BTC lặp trong `organizer` chưa gom.
- Story nhận (21/11/2026, E4-8): action item E4-11. Còn phần tra tên BTC lặp ở ba job của `organizer`.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`
  summary: Chưa có test worker kiểm `PublicPageWorker` gộp theo slug (`dedupeBy`) và chạy song song (`parallel`): hai job cùng slug trong một lô phải chỉ gọi web một lần, và cả hai job đều `completed`.
  evidence: Review E2-5 API #19 (VG). Helper đã có unit test cho `parallel` và `dedupeBy` (`test/platform/jobs-queue.test.ts`), nhưng test của public-page chỉ gửi một job mỗi slug. Nếu bỏ hai option này khỏi `public-page-jobs.ts`, mọi test vẫn qua. Trước E2-5 cũng chưa có test này; hậu quả chỉ là gọi revalidate thừa hoặc chậm hơn.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu test worker cho `dedupeBy`/`parallel`.

## Deferred from: planning spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md`
  summary: Chặn hai BTC kết nối cùng một merchant Tingee (cùng Client ID hiện hành) ở bước kết nối (Story 2.6) và đổi key (Story 2.13-b), vd. unique một phần trên `tingee_credentials.client_id WHERE retired_at IS NULL` + lỗi 409. Làm trước khi mở bán Vé có phí.
  evidence: Mason chốt 11/11 khi lập spec 3.5 (phương án A): giữ AD-7, Đơn phải thuộc BTC sở hữu `ipnKey`. Portal Tingee chỉ có một URL IPN cho mỗi merchant, nên nếu hai BTC dùng chung merchant thì IPN của BTC thứ hai rơi vào nhánh Tài khoản lệch và không tự phát Vé. Mục này đóng câu hỏi ở mục "Deferred from: code review of spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md" (hai BTC chung merchant).
- Story nhận (21/11/2026, E4-8): action item E4-2. Phải xong trước khi bán Vé có phí thật.

## Deferred from: code review of spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md`
  summary: IPN có `status` khác chữ thường hay đánh vần khác (`SUCCESS`, `Success`, `cancelled`) bị coi là trạng thái lạ: chỉ lưu, không phát Vé, không hết hạn Đơn; IPN trạng thái cho Đơn của BTC khác hay Đơn không còn `pending` chỉ log mức info (`stored`).
  evidence: Review 3.5 vòng 1 #14 (BH, EC; maybe-false, nếu đúng là medium). Tài liệu Tingee chỉ ghi `success`/`expired`/`canceled` chữ thường. Cách chốt: lấy IPN thật từ Tingee UAT (test hợp đồng, Story 4.7, hoặc thử tay) và xem `status` đúng chữ nào; nếu khác thì chuẩn hóa `trim().toLowerCase()` và nhận cả `cancelled`.
- Story nhận (21/11/2026, E4-8): action item E3-3. Lấy IPN thật từ UAT để biết đúng chữ của `status`.

## Deferred from: build of spec-3-6-ipn-cho-cac-truong-hop-bien.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-ipn-cho-cac-truong-hop-bien.md`
  summary: Story 4.6. Nối kênh cảnh báo vận hành thật cho tiền về không khớp Đơn nào của BTC (`unmatched`: mã đúng định dạng mà không có Đơn, hoặc Đơn thuộc BTC khác). Hiện chỉ có log mức `error` kèm trường `alert: 'payment_unmatched'` (hằng `PAYMENT_UNMATCHED_ALERT` của `payment`) và mục Cần xử lý `unmatched`.
  evidence: `apps/api/src/modules/payment/ipn-processor.ts` (`process`, nhánh `order_not_found`/`other_organization`). Test ghim marker ở `apps/api/test/payment/ipn-edge.test.ts` ("Matrix: không khớp Đơn của BTC"). 4.6 nên bắt theo marker này (hoặc thay log bằng lời gọi kênh cảnh báo) để không ai phải đọc log mới biết tiền đã về.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6 (4.6-b). Bằng chứng: `payment/ipn-processor.ts:266-268` (`alerts.raise`), `platform/alerts/kinds.ts:11`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-ipn-cho-cac-truong-hop-bien.md`
  summary: Story 3.8. Email báo Người mua khi tiền về muộn cho Đơn đã hết hạn mà không phát được Vé (mục `orphan`, lý do `sold_out`): "BTC đã nhận tiền nhưng Hạng vé đã hết, BTC sẽ liên hệ hoàn tiền". Enqueue bằng chính `tx` của IPN, cùng hàng đợi email Người mua mà 3.8 dựng.
  evidence: Mason chốt 11/11 khi lập spec 3.6: 3.6 chỉ tạo mục `orphan`, không thêm hàng đợi hay mẫu email; lệch có chủ đích so với câu "enqueue email báo Người mua" trong AC 3.6 của epics. Chỗ gắn: `ordering/mark-paid.ts` (`settleIpn`, nhánh `sold_out`) hoặc `payment/ipn-processor.ts` (sau `openReviewItem` loại `orphan`).
- Đã xử lý (11/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md`. `settleIpn` (nhánh `sold_out`) enqueue job `orphan_sold_out` của hàng đợi `ordering.send-buyer-email` trong chính `tx` của IPN; worker gửi "BTC đã nhận tiền nhưng Hạng vé đã hết, BTC sẽ liên hệ hoàn tiền." kèm mã Đơn, tên Sự kiện và kênh liên hệ BTC tới `orders.buyer_email` (bỏ qua nếu Đơn không còn `review`). Các lý do `orphan` khác (`event_ended`, `event_locked`) vẫn không có email.

## Deferred from: build of spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: AI-6. Ca Playwright full-stack cho Trang Đơn tự chuyển "Thành công": web build thật + api thật + Postgres + Tingee fake, Người mua đặt Đơn có phí, tab ở nền, bắn IPN từ Tingee fake, quay lại tab thấy Thành công < 3 giây; kèm kiểm CORS và cookie của `EventSource` cross-origin (`withCredentials`).
  evidence: Mason chốt 11/11 khi lập spec 3.7: test chia hai tầng. Playwright (`apps/web/e2e/order-live.spec.ts`) giả API và luồng SSE bằng `page.route`; test tích hợp api (`apps/api/test/ordering/order-live.test.ts`) đo IPN → tín hiệu trên stream SSE thật < 1 giây. CORS và cookie của SSE thật mới kiểm bằng tay với `pnpm dev`. Lệch có chủ đích so với câu "test Playwright với Tingee fake" trong AC 3.7; gom vào phần e2e full-stack còn lại của AI-6.
- Đã xử lý (19/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-c-ci-e2e-full-stack.md`, trừ phần "tab ở nền … quay lại tab". Bộ Playwright full-stack `apps/web/e2e-fullstack/` (`apps/web/playwright.fullstack.config.ts`) chạy web build thật, api và worker từ `dist`, Tingee fake, Mailpit và DB `tickee_e2e` tạo lại mỗi lượt. `paid-order.spec.ts`: tab A giữ Trang Đơn mở và luôn hiện (Playwright không đưa trang xuống nền, nên đường `visibilitychange` không được kiểm); stream `/live` cross-origin trả 200 `text/event-stream` với `access-control-allow-origin` = origin web và `access-control-allow-credentials: true`; từ lúc stream mở tới ngay trước khi trả tiền, tab A không gửi GET Đơn nào trong hơn 2 giây (không polling, tức SSE còn kết nối); tab B trả trên trang của Tingee fake (IPN ký thật → `markPaid`), tab A sang Thành công trong ≤ 3 giây sau ACK của IPN, không tải lại; Mailpit nhận email Vé. Chạy trên `ios-webkit` và `android-chromium` trong job `ci` (bước "Playwright full-stack").
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): phần tab ở nền không kiểm full-stack (Playwright không đưa trang xuống nền); e2e giả lập đã phủ (`apps/web/e2e/live-mock.ts`).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: Story 3.8. Thêm "Đã gửi Vé tới {email}" vào stage của màn Thành công khi đã có email Vé (EXPERIENCE › Thanh toán & Trang Đơn › Thành công).
  evidence: Mason chốt 11/11 khi lập spec 3.7: không hứa trước khi có tính năng (cùng tiền lệ 3.3 hoãn nút "Xem Vé của tôi"). `order-success.tsx` chưa có dòng này; e2e `purchase.spec.ts` đang ghim `not.toContainText('Đã gửi Vé tới')`, 3.8 đổi lại.
- Đã xử lý (11/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md`. Stage của màn Thành công có "Đã gửi Vé tới {email}" (`order.buyer.email`); e2e `purchase.spec.ts` và `shared-ticket.spec.ts` kiểm dòng này. Dòng mất mạng (mục kế tiếp) chưa đổi, chờ 3.9.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: Story 3.8/3.9. Đổi dòng mất mạng của Trang Đơn về đúng copy AC: "Mất kết nối — vé vẫn được gửi qua email và Vé của tôi." khi đã có email Vé (3.8) và Vé của tôi (3.9).
  evidence: 3.7 dùng copy tạm "Mất kết nối — vé sẽ tự hiện khi có mạng lại." (`order-payment.tsx` › `OFFLINE_TEXT`, e2e `order-live.spec.ts` › `OFFLINE`) vì email Vé và Vé của tôi chưa có. Story nào làm xong phần sau cùng trong hai tính năng đó thì đổi copy và test.
- Đã xử lý (12/11/2026): `_bmad-output/implementation-artifacts/spec-3-9-ve-cua-toi-va-chi-tiet-ve.md`. `OFFLINE_TEXT` = "Mất kết nối — vé vẫn được gửi qua email và Vé của tôi."; e2e `order-live.spec.ts` › `OFFLINE` đổi theo. Cùng story: màn Thành công có nút chính "Xem Vé của tôi" → `/tickets` (hoãn từ 3.3, Mason chốt 10/11; e2e `purchase.spec.ts` hết ghim "Xem Vé của tôi" = 0), menu tài khoản có mục "Vé của tôi", email Vé có dòng link tới `/tickets`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: E2-8. Test api `test/organizer/payout-default-job.test.ts` › "gửi email lỗi → job gốc completed, mỗi job con sang retry…" chập chờn: đôi khi `sentForOrg()` có một email "MB Bank ••••1111 → ACB ••••2222" dù `workerEmail.failWith` đang đặt.
  evidence: Phát hiện khi kiểm chứng 3.7 (11/11). Chạy riêng file: bản 3.7 fail 2/5, baseline `bfd49bc` (trước 3.7) fail 2/6, nên lỗi có từ trước, không do 3.7. Nghi job còn lại của test trước (cùng BTC, cùng người nhận; comment ở đầu file đã nhắc) được worker gửi trước khi `failWith` có hiệu lực. Nên gộp vào việc ghi các test chập chờn ở E2-8.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: Trang Đơn đã có dữ liệu mà lần tải lại lỗi không phải lỗi mạng (401 phiên hết hạn, 5xx, body sai schema) thì vẫn hiện màn chờ cũ, không báo gì, và polling 2 giây cứ lỗi tiếp.
  evidence: Review 3.7 (EC) triage #29. `order-view.tsx` chỉ hiện banner lỗi khi `isError && !data`; hành vi này có từ 3.4 (polling 5 giây), 3.7 không đổi. Dòng mất mạng của 3.7 chỉ xét lỗi mạng (`isNetworkError`). Story nào chạm lại Trang Đơn hoặc dựng xử lý phiên hết hạn toàn cục thì thêm một dòng "Chưa cập nhật được" hoặc chuyển sang đăng nhập khi 401.
- Story nhận (21/11/2026, E4-8): 7.1. 7.1 chạm lại Trang Đơn (trạng thái Sự kiện đã hủy).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: Story 7.1. Khi hủy Sự kiện, phát `order_changed` (`realtime.notify` trong chính `tx` hủy) cho mọi Đơn bị ảnh hưởng của Sự kiện, kể cả Đơn mà `status` không đổi; hoặc thêm một tín hiệu cấp Sự kiện mà bộ lọc của `GET /v1/me/orders/:code/live` cũng nhận.
  evidence: `buyerStatus` của Đơn `paid`/`review`/`cancelled`/`refunded` thành `event_cancelled` chỉ vì `events.status = 'cancelled'` (`ordering/buyer-status.ts`), không có CAS nào trên `orders` nên không có `order_changed`. Trang Đơn đang mở (đã `paid` hay `under_review`: không polling) sẽ đứng ở trạng thái cũ, vẫn hiện Mã QR vé, tới khi tải lại hoặc tab visible lại. Bộ lọc hiện tại ở `orders.controller.ts` › `live` chỉ nhận `order_changed` có `id` trùng Đơn.
- Ghi thêm (12/11/2026, `_bmad-output/implementation-artifacts/spec-3-9-ve-cua-toi-va-chi-tiet-ve.md`): stream `GET /v1/me/tickets/live` của "Vé của tôi" cũng chỉ nhận `order_changed` (lọc theo tập id Đơn của người xem), nên Vé của Sự kiện vừa hủy vẫn hiện "Hợp lệ" trên danh sách đang mở tới lần tải sau (tab hiện lại, có mạng lại). Chi tiết Vé tải lại mỗi lần mở nên không bao giờ ký QR cho Sự kiện đã hủy. 7.1 phát tín hiệu thì cả hai trang tự đúng.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md`
  summary: Người mua đã trả tiền mà không có Vé vì lý do khác `sold_out` (mục Cần xử lý `orphan` `event_ended`/`event_locked`, `amount_mismatch`, `event_cancelled`) không nhận email nào; cần quyết có gửi email báo (vd. "BTC sẽ liên hệ") qua hàng đợi `ordering.send-buyer-email` hay để BTC tự liên hệ (Story 4.4/7.1).
  evidence: Review 3.8 (BH) triage #7. Có từ trước 3.8: AC 3.6 trong epics chỉ đòi email cho `sold_out`, 3.8 làm đúng phần đó. Các nhánh khác chỉ tạo `review_item`; Trang Đơn hiện `under_review` + kênh liên hệ BTC nhưng Người mua phải tự mở lại trang mới biết.
- Story nhận (21/11/2026, E4-8): 7.1, chưa quyết. 7.1 chốt có gửi email báo Người mua hay để BTC tự liên hệ (retro Epic 4 C4).

## Deferred from: build of spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md (2026-11-12)

- Đã xử lý (12/11/2026): phần spec 2.12 hoãn sang 3.10 (Boundaries › "email báo Người mua khi đổi giờ/địa điểm") được giải quyết bằng `_bmad-output/implementation-artifacts/spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md`. `PATCH /v1/orgs/:orgId/events/:eventId` chuyển sang `flows/event-edit.controller.ts` (flow `updateEvent`), cột `events.time_venue_version` (migration 0022), queue `ordering.send-event-change-email` (job gốc theo `(eventId, version)`, job con theo Người mua), `GET …/buyer-count`, `Dialog` "Email sẽ được gửi tới {n} Người mua." ở tab Cài đặt.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md`
  summary: Không giới hạn số lượt email đổi giờ/địa điểm: mỗi lệnh sửa có đổi giờ/địa điểm là một lượt gửi cho mọi Người mua (spec cấm hợp nhất), nên BTC sửa địa điểm nhiều lần liên tiếp (hoặc phiên BTC bị lộ) gửi bấy nhiêu email cho mỗi người. Cần chốt có giới hạn theo Sự kiện/giờ hay gom trong một khoảng ngắn (vd. job gốc `startAfter` vài phút, chỉ gửi bản mới nhất) không.
  evidence: `flows/event-update.flow.ts` enqueue mỗi phiên bản một job gốc; `Dialog` của web là chặn duy nhất. Spec 3.10 › Never: "Không hợp nhất các lượt gửi khi BTC sửa liên tiếp".
- Story nhận (21/11/2026, E4-8): action item E3-8. Chốt giới hạn hoặc gom lượt email đổi giờ/địa điểm.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md`
  summary: Lỗi lặp ở `e2e/event-settings.spec.ts` › "Kết thúc qua Dialog…" trên ios-webkit: bấm tab "Tổng quan" (`router.replace` bỏ `?tab=`) rồi `page.goto` ngay thì hai lần điều hướng đè nhau ("interrupted by another navigation"). Đã thêm `waitForURL` trước `goto` trong test này; các spec khác đổi tab rồi `goto` ngay có thể cùng kiểu.
  evidence: Kiểm chứng 3.10 (12/11): bản baseline `1dd0d0e` chạy riêng ca này 10 lần trên ios-webkit fail 2; sau khi chờ URL, 10/10 pass. Nên gộp vào việc ghi các test chập chờn ở E2-8.

## Deferred from: build of spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md (2026-11-12)

- Quyết định (12/11/2026): phần còn lại của E2-6 không làm ở 3.11. Mason quyết khi lập spec 3.11: nhãn trạng thái bán trên dashboard (đang tự tính ở `apps/web/app/(dashboard)/btc/[orgId]/su-kien/event-status.ts`, lệch `sellability`, retro Epic 2 C5) chuyển hẳn sang Story 4.2; 3.11 không đổi `event-status.ts`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: Story 4.2. Nhãn trạng thái bán của Sự kiện trên dashboard (danh sách Sự kiện, badge thẻ "Thông tin" của tab Tổng quan) đọc theo `sellability` thay vì tự tính từ `status`/`effectiveEndAt` ở web.
  evidence: Retro Epic 2 C5, E2-6 (`sprint-status.yaml`). Spec 3.11 › Boundaries › Quyết định của Mason (12/11).
- Đã xử lý (14/11/2026): Story 4.2-c (`spec-4-2-c-nhan-trang-thai-ban.md`). Badge thẻ Sự kiện ở trang chủ BTC và thẻ "Thông tin" của tab Tổng quan lấy từ `GET /v1/orgs/:orgId/event-sale-status` (`ordering.sellability`, đồng hồ DB); xem mục 4.2-c ở phần "build Story 4.2, tách phạm vi".
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: Story 4.4. Thao tác trên `review_items` mà không đổi trạng thái Đơn (vd. "Đã hoàn tay"/"Bỏ qua" mục `amount_mismatch` của Đơn vẫn ở `review`) phải phát `event_orders_changed` trong cùng `tx`, để dòng loại Cần xử lý của "Đơn gần đây" đổi theo mà không cần tải lại.
  evidence: 3.11 chỉ phát `event_orders_changed` ở các điểm phát `order_changed` (đổi trạng thái hoặc link của Đơn) và sau commit TX1. `review` của `RecentOrder` lấy từ mục `open` cũ nhất (`payment.openReviewsOf`), nên đóng mục mà Đơn không đổi trạng thái thì Tổng quan đang mở chỉ đúng lại ở lần tải sau (tín hiệu khác, tab hiện lại).
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.4. Bằng chứng: `payment/review-actions.ts:417-421` (`notifyOrderUnchanged`); `test/payment/review-actions.test.ts:602,665`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: Story 7.1. Chốt cách tính doanh thu trên Tổng quan sau khi hủy Sự kiện, và phát `event_orders_changed` khi hủy (cùng chỗ với `order_changed` của mục 7.1 ở phần 3.7 phía trên) để Tổng quan đang mở đổi theo.
  evidence: Spec 3.11 › Never: "Không đặt luật doanh thu riêng cho Sự kiện đã hủy (7.1 quyết)". Hiện `ordering.eventRevenueOf` cộng mọi Đơn `paid` bất kể Sự kiện đã hủy.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: `GET …/overview` đọc doanh thu và "Đơn gần đây" bằng hai câu độc lập (READ COMMITTED, chạy song song), nên một lần trả lời có thể lệch nhau đúng một Đơn vừa đổi giữa hai câu (vd. Đơn hiện "Đã thanh toán" mà "· n Đơn" chưa tăng). Tín hiệu của chính thay đổi đó làm web tải lại ngay sau, nên tự đúng. Nếu cần khớp tuyệt đối thì chạy cả ba câu trong một transaction `REPEATABLE READ READ ONLY`.
  evidence: `reporting/event-overview.service.ts` › `overview`. Chấp nhận ở 3.11 vì REST là sự thật và mỗi thay đổi đều kèm tín hiệu tải lại (AD-17).
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): đã chấp nhận ở 3.11; tín hiệu tải lại tự sửa lệch (AD-17).

## Deferred from: build E3-7, tách phạm vi (2026-11-12)

E3-7 (retro Epic 3) gom 4 việc ship riêng được. Mason chọn tách ngày 12/11/2026: làm D3 + gom điều kiện "Sự kiện còn dùng được" trước (`spec-epic-3-e3-7-trang-don-an-qr-sau-ket-thuc.md`); ba việc dưới đây vẫn thuộc E3-7, phải xong trước Epic 4. Gợi ý thứ tự: B6 + C7 chung một spec, rồi tới tách `orders.service.ts`.

- source_spec: none
  summary: E3-7 (B6). `PaymentLinks.expire` dùng `releaseOrderHeld` thay vì tự nhả chỗ, thêm test Đơn có 2 Hạng vé.
  evidence: Retro Epic 3 B6 (`payment-link.ts:242-258`, `order-jobs.ts:122-133`, `test/ordering/payment-link.test.ts:131-149`). Tách khỏi D3 vì là sửa độc lập ở luồng link thanh toán, không chạm Trang Đơn.
- source_spec: none
  summary: E3-7 (C7). Test "TX1 không `NOTIFY`" bảo vệ lại cả `event_orders_changed`, không chỉ `order_changed`.
  evidence: Retro Epic 3 C7: 3.11 thu hẹp `notificationsFor` về `order_changed` (`test/ordering/order-live.test.ts:126,189-202`). Chỉ sửa test, ship riêng được; nên gộp chung spec với B6.
- source_spec: none
  summary: E3-7 (E2, E3). Tách tối thiểu `ordering/orders.service.ts` (579 dòng, ≥ 6 trách nhiệm) trước Epic 4, và gom đồng hồ DB (`SELECT now()` 7 bản, `clock_timestamp()` ở `mark-paid.ts:74`) về một chỗ; cân nhắc helper `buyerScope` (AD-13, retro E4) khi tách.
  evidence: Retro Epic 3 E2, E3, E4. Refactor thuần, diff lớn nhất trong E3-7; tách khỏi D3 để không trộn thay đổi hành vi với refactor. Làm sau D3 vì cùng chạm `orders.service.ts`.

## Deferred from: code review of spec-epic-3-e3-7-trang-don-an-qr-sau-ket-thuc.md (2026-11-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-trang-don-an-qr-sau-ket-thuc.md`
  summary: E3-2. Đơn chưa trả (`awaiting_payment`/`confirming`) mà Sự kiện đã kết thúc (BTC bấm "Kết thúc") vẫn hiện màn thanh toán và checkout link; Người mua trả thì tiền vào `review` + `orphan` `event_ended`, BTC phải hoàn tay. `BuyerOrderView.event.ended` (đồng hồ DB) đã có sẵn cho web dùng khi E3-2 chốt luật.
  evidence: Review E3-7 (BH, EC) triage #9. Đúng retro Epic 3 B1, có từ trước; `order-view.tsx` chỉ đọc `event.ended` ở nhánh `paid`. Chờ Mason chốt luật cho Đơn đang có link khi "Kết thúc"/Ẩn/khóa (E3-2).
- Đã xử lý (13/11/2026): mục E3-2 ngay phía trên (Trang Đơn sau Kết thúc) được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md` (Mason chốt 13/11: giữ Đơn tới khi link tự hết hạn, thôi mời trả). Sau Kết thúc máy chủ trả `payment.checkoutUrl = null`; Trang Đơn của Đơn `awaiting_payment`/`confirming`/`expired` mà `event.ended` hiện "Sự kiện đã kết thúc. Đơn này không thanh toán được nữa." kèm liên hệ BTC, không màn thanh toán, không "Thử lại", không "Mua lại". "Thử lại" và gửi lại cùng khóa qua chốt `sellability` trong `PaymentLinks` (Kết thúc, Ẩn, khóa, hủy, mất điều kiện có phí → Đơn hết hạn `sales_paused`, không gọi Tingee). Dialog "Kết thúc" nêu Vé hết hiệu lực và số Đơn đang chờ thanh toán (`GET …/pending-payment-count`).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-trang-don-an-qr-sau-ket-thuc.md`
  summary: Không test nào chứng minh `ended` đi theo đồng hồ DB chứ không theo đồng hồ app: mọi test đẩy mốc bằng `effective_end_at = now() - 1s`, cả hai đồng hồ đều đã quá. Thêm một ca giả `Date` của app (vd. `vi.useFakeTimers({ toFake: ['Date'] })`) lùi về trước mốc rồi kiểm `ended: true`, `tickets: []` cho biểu thức chung `endedNow`.
  evidence: Review E3-7 (VG) triage #2. Yếu điểm chung của `event/public-event.ts` › `endedNow` (Trang Đơn, Chi tiết Vé, link chia sẻ, email); repo chưa có mẫu giả `Date` trong harness Nest/HTTP. Nên làm cùng mục gom đồng hồ DB của E3-7.
- Story nhận (21/11/2026, E4-8): action item E4-10. Phần test giả `Date` của E4-10.

## Deferred from: code review of spec-epic-3-e3-7-b6-c7-nha-cho-link-va-test-notify.md (2026-11-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-b6-c7-nha-cho-link-va-test-notify.md`
  summary: Chuyển `releaseOrderHeld` từ `ordering/order-jobs.ts` sang `ordering/inventory.service.ts` và thôi export `releaseHeld`. Khi đó "chỉ một chỗ nhả chỗ theo Đơn" được cấu trúc bảo đảm, không chỉ nằm trong comment. `payment-link.ts` và `mark-paid.ts` cũng thôi lấy một hàm tồn kho từ mô-đun job pg-boss.
  evidence: Review B6 (BH) triage #6. Hiện `releaseHeld` chỉ còn một người gọi (`releaseOrderHeld`), nhưng vẫn export nên đường mới có thể tự nhả chỗ lại như `PaymentLinks.expire` trước B6. Refactor chạm ba file ngoài phạm vi B6, nên làm cùng mục tách `orders.service.ts` của E3-7.

## Deferred from: build of spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md (2026-11-12)

- Đã xử lý (12/11/2026): mục E3-7 (E2, E3) ở "build E3-7, tách phạm vi" phía trên, phần tách `orders.service.ts` và gom đồng hồ DB, được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md`. TX1 chuyển sang `ordering/place-order.ts`, read model `BuyerOrderView` sang `ordering/order-view.ts`, đồng hồ DB về `platform/db/clock.ts` (`dbNow`/`dbClock`). Phần `buyerScope` hoãn, xem mục dưới.
- Đã xử lý (12/11/2026): mục review B6 triage #6 ngay phía trên (chuyển `releaseOrderHeld` sang `inventory.service.ts`, thôi export `releaseHeld`), cùng spec.
- Đã xử lý (12/11/2026): mục E3-7 (B6) và E3-7 (C7) ở "build E3-7, tách phạm vi" phía trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-b6-c7-nha-cho-link-va-test-notify.md` (PR #65).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md`
  summary: Helper `buyerScope` (AD-13, retro Epic 3 E4) cho truy vấn theo Người mua. Hiện có 13 bộ lọc `user_id` viết tay: `ordering/orders.service.ts` ×5 + `ordering/place-order.ts` ×1, `ordering/my-tickets.service.ts` ×3, `ticketing/my-tickets.ts` ×2, `ticketing/tickets.service.ts` ×1, và `ordering/event-change-email-jobs.ts` ×1 (job email, không phải đường request). Chưa có story nhận.
  evidence: Mason quyết ngày 12/11/2026 không làm trong E3-7. Lý do: helper chỉ đặt tên cho `eq(user_id)`, mỗi truy vấn vẫn phải tự nhớ gọi, nên không chặn được truy vấn quên lọc; lưới an toàn thật là test cách ly hai Người mua. Spec E3-7 (E2, E3) › Never.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): Mason đã hoãn ở E3-7 (12/11/2026); lưới an toàn là test cách ly hai Người mua.

## Deferred from: code review of spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md (2026-11-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md`
  summary: Không test nào ghim `markPaid` (`ordering/mark-paid.ts`, nhánh tiền về muộn) đọc đồng hồ bằng `dbClock` (`clock_timestamp()`) thay vì `dbNow`. Cần một test trong `test/ordering/mark-paid-ipn.test.ts` theo kiểu `pool.connect()` + `BEGIN` của các test `*-concurrency`: một client khác giữ `SELECT … FROM events WHERE id = $1 FOR UPDATE`, gọi IPN `paid` cho tới khi bị chặn, chuyển `effective_end_at` sang một mốc trôi qua trong lúc chờ rồi `COMMIT`, kiểm `{ outcome: 'orphan', reason: 'event_ended' }`; thêm biến thể không đổi giờ kết thúc, kiểm `issued_at` ≥ lúc nhả khóa.
  evidence: Review E3-7 (E2 + E3) VG triage #1 (medium). Sau khi gom, `dbNow` và `dbClock` cùng nằm trong barrel `platform/db`, chỉ khác một chữ. Đổi `mark-paid.ts` sang `dbNow` thì mọi test hiện có vẫn pass (`mark-paid-ipn.test.ts`, `ipn.test.ts`, `ipn-edge.test.ts` đều đọc đồng hồ ngay sau khi transaction bắt đầu). Hậu quả nếu đổi nhầm: IPN bắt đầu trước `effective_end_at` nhưng lấy được khóa sau mốc đó vẫn phát Vé cho Sự kiện đã kết thúc. Khoảng trống có từ trước refactor; hợp với phần chạm `markPaid` của Epic 4 (Story 4.1, 4.4).
- Story nhận (21/11/2026, E4-8): action item E4-10. Test ghim `dbClock` của `markPaid` thuộc phần test của E4-10.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md`
  summary: Mục hoãn của review D3 ở trên (test giả `Date` của app cho `event/public-event.ts` › `endedNow`, ghi "nên làm cùng mục gom đồng hồ DB của E3-7") vẫn mở. Việc gom đồng hồ DB của E3-7 chỉ gom câu `SELECT now()`/`SELECT clock_timestamp()` đứng riêng về `platform/db/clock.ts`; `endedNow` là `now()` viết nội tuyến, spec giữ nguyên nên test đó không thuộc phạm vi.
  evidence: Review E3-7 (E2 + E3) BH triage #3. Chưa có story nhận; nên làm khi một story Epic 4 chạm `endedNow` hoặc luật "Kết thúc" (E3-2, Story 4.2).
- Trùng (21/11/2026, E4-8): theo dõi ở mục "Không test nào chứng minh `ended` đi theo đồng hồ DB" (phần "Deferred from: code review of spec-epic-3-e3-7-trang-don-an-qr-sau-ket-thuc.md (2026-11-12)"), Story nhận ở đó: action item E4-10.

## Deferred from: retrospective Epic 3 (2026-11-12) — bàn giao có story nhận (E3-6)

Mỗi mục dưới đây có đúng một story nhận. Story nhận đọc mục này khi lập spec. Nguồn: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`; ghi theo `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-13-doi-chieu-spec-epic-3.md`.

- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.1 (B4). IPN `expired`/`canceled` nhả chỗ ngay, bỏ qua 5 phút ân hạn mà job (c) dành cho tiền về sát hạn. 4.1 quyết: giữ nhả ngay, hay để Đối soát bù tra lại trước khi nhả.
  evidence: `payment/ipn-processor.ts:293-297` so với job (c) trong `ordering/order-jobs.ts` (chạy ở `expires_at` + 5 phút). Retro Epic 3 B4 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.1 (B5). `IpnProcessor.process` hard-code nguồn `ipn`; Đối soát bù gọi `markPaid` nguồn `reconciliation` phải truyền nguồn vào. Chống lặp giữa IPN và Đối soát bù dựa vào việc API tra trạng thái trả đúng `providerTransactionCode` như IPN (unique `(organization_id, provider_transaction_code)` của `payment_events`).
  evidence: `payment/ipn-processor.ts:274`. Xác nhận dạng mã giao dịch bằng UAT Tingee (E3-3) hoặc câu trả lời của Tingee (action item Epic 4 về API tra trạng thái theo `orderId`). Retro Epic 3 B5 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.1 (C5). Trang Đơn thôi polling khi Đơn `expired`, trong khi `expired` còn chuyển được sang `paid`/`review` khi tiền về muộn. 4.1 tra tiếp Đơn `expired` tới 24 giờ, nên Trang Đơn (và thẻ "Hết hạn" của Vé của tôi, 30 phút) cần vẫn nhận được thay đổi trong cửa sổ đó.
  evidence: `apps/web/lib/order/live.ts:19-21`. Câu "Nếu bạn đã chuyển tiền, đừng chuyển lại — kiểm tra Vé của tôi hoặc email." giảm tác hại. Retro Epic 3 C5 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.4, 7.1, 7.2, 7.5 (C6). Mọi nơi mới ghi `orders.status` (4.4 "Từ chối" và "Duyệt tay phát Vé"; 7.1 hủy Sự kiện; 7.2 "Đã hoàn tay" → `refunded`) phải phát `order_changed` và `event_orders_changed` trong cùng `tx` (AD-17). Hiện việc này chỉ dựa vào quy ước. Cân nhắc hàm chung `transitionOrder(tx, …)` phát tín hiệu sẵn. Riêng 7.5: doanh thu Tổng quan phải bỏ Đơn có toàn bộ Vé `voided`.
  evidence: `eventRevenueOf` (`ordering/event-overview-read.ts:17-29`) cộng mọi Đơn `paid`, chưa biết Vé `voided`; `epics.md` Story 7.5. Các mục 4.4 (đóng `review_item` không đổi Đơn) và 7.1 (tín hiệu khi hủy) ở phần "build of spec-3-7" và "build of spec-3-11" là trường hợp riêng của mục này. Retro Epic 3 C6 (LOW).
- Đã xử lý (21/11/2026, E4-8): phần 4.4 của mục ngay trên đã làm ở Story 4.4. Bằng chứng: `ordering/order-review.ts:63,92`, `payment/review-actions.ts:285,420`. Phần 7.1, 7.2, 7.5 vẫn mở.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (C2). Đo trong bài test tải: commit có `NOTIFY` bị Postgres tuần tự hóa, và một số transaction vẫn `NOTIFY` khi đang giữ khóa dòng `ticket_type_inventory`; 3.11 thêm một commit `NOTIFY` cho mỗi Đơn. Nếu nghẽn thì dời `NOTIFY` ra sau khóa nóng hoặc gom.
  evidence: `ordering/order-changed.ts:36-40` (đã cấm `NOTIFY` trong TX1 vì lý do này); `notifyOrderChanged` ở `mark-paid.ts:134,336`, `order-jobs.ts:117,142`, `payment-link.ts:251`; `announceOrderCreated` ở `orders.service.ts:161`. Spec 3.11 triage #2 chỉ xét round trip. Chưa đo trên PG 18. Retro Epic 3 C2 (MEDIUM, chưa đo).
- Story nhận (21/11/2026, E4-8): 9.2 (thay nhãn "5.8"). Đo trong kiểm thử tải.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (D4). Fan-out email đổi giờ/địa điểm gửi tuần tự, SMTP không pool. Đo với N lớn trên Mailpit; nếu chậm thì bật pool hoặc chạy job con song song.
  evidence: vòng gửi ở `ordering/event-change-email-jobs.ts:203`, `createTransport` không pool ở `platform/email/smtp-transport.ts:15`. Retro Epic 3 D4 (LOW, chưa đo).
- Story nhận (21/11/2026, E4-8): 9.2 (thay nhãn "5.8"). Đo fan-out email với N lớn trong kiểm thử tải.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (NFR-1). AC 3.4 "p95 tạo link dưới 2 giây" chưa có test hay ghi chép nào. Đo trong 5.8 (Tingee fake có độ trễ cấu hình được, đo từ gửi Đơn tới khi có checkout URL) và ghi vào báo cáo tải.
  evidence: Spec 3.4 và các mục trước của file này không nhắc. Retro Epic 3 E5.
- Story nhận (21/11/2026, E4-8): 9.2 (thay nhãn "5.8"). Đo p95 tạo link và ghi vào báo cáo tải.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.6 và 5.8 (A2). Giữ chỗ hàng loạt bằng nhiều tài khoản OTP. Server tạo link ngay sau TX1, nên mỗi Đơn có phí giữ chỗ khoảng 20 phút (15 phút link + 5 phút ân hạn), không phải 60 giây. Giới hạn hiện có theo user và theo IP; chưa có trần số Vé đang giữ. Cần quyết trước 4.6: trần Vé đang giữ (theo IP hoặc theo Sự kiện), hay chỉ tạo link khi Người mua bấm "Thanh toán". 4.6 nhận phần cảnh báo, 5.8 đo.
  evidence: Retro Epic 3 A2 (MEDIUM) và câu hỏi mở 5. Chưa có trong bảng triage của 3.2/3.4.
- Story nhận (21/11/2026, E4-8): action item E4-6 (chốt cách chặn). Phần cảnh báo theo dõi ở mục "Cảnh báo giữ chỗ hàng loạt bằng nhiều tài khoản" (phần "Deferred from: build of spec-4-6-b-canh-bao-van-hanh.md (2026-11-17)"); phần đo → 9.2.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.7 (C4). Checklist deploy: edge phục vụ API bằng HTTP/2. Ba loại trang giữ SSE dài hạn tới cùng origin API (Trang Đơn, Vé của tôi, Tổng quan), mà HTTP/1.1 chỉ cho 6 kết nối mỗi origin.
  evidence: Spec 3.7 #8, #28 reject với tiền đề "≥ 6 tab Trang Đơn"; 3.9 và 3.11 thêm hai loại trang. Retro Epic 3 C4 (LOW).
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 7.4 (B7). Nối cờ "BTC bị khóa" thật vào `organizationLocked` và thêm ca test nhánh "BTC bị khóa" của AD-7 bước 6 tại `markPaid`.
  evidence: `event/sale-rules.ts:20-22` (`organizationLocked` luôn `false`), `ordering/mark-paid.ts:266`. Retro Epic 3 B7 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.3 (D5). `/xem-ve` (người nhận link chia sẻ) không giữ màn hình sáng, khác Chi tiết Vé. Người đi cùng thường là người đưa QR ở cổng. Khi làm màn quét, thêm Screen Wake Lock cho `/xem-ve` bằng hook của 3.9. Chấp nhận thiếu ở MVP nếu 5.3 không kịp.
  evidence: Hook Wake Lock ở `apps/web/lib/tickets/wake-lock.ts` (spec 3.9). Đúng phạm vi spec 3.8. Retro Epic 3 D5 (LOW).
- Story nhận (23/11/2026, 5.3-a): 5.3-b. Story 5.3 tách đôi; Wake Lock cho `/xem-ve` là phần web, nằm ở 5.3-b, Mason duyệt.
- Đã xử lý (25/11/2026, 5.3-b): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-3-b-man-quet-web.md`. Bằng chứng: `apps/web/app/(public)/xem-ve/shared-ticket.tsx:48`.

## Deferred from: code review of spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md (2026-11-13)

- Đã xử lý (13/11/2026): phần (1) "route công khai 500" của mục "Ghi thêm (13/11/2026, retro Epic 3 D1, E3-5)" ở phần "build of spec-3-3" được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md`. `GET /v1/shared-tickets/:token` của Vé có khóa QR không có trên instance trả `404 SHARED_TICKET_NOT_FOUND` chung (xét sau mọi lý do 404 khác), log `error` có marker `ticket_qr_key_missing`. Test xoay khóa ở `test/ticketing/qr-key-rotation.test.ts`. Phần (2) (runbook ký lại, chọn phương án) vẫn thuộc Story 4.7.
- Trùng (21/11/2026, E4-8): phần (2) theo dõi ở mục "Story 4.7/4.6. Quy trình xoay khóa QR" (phần "Deferred from: build of spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md (2026-11-10)"), Story nhận ở đó: 9.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md`
  summary: Story 4.6. Nối cảnh báo vận hành cho marker `alert: 'ticket_qr_key_missing'` (hằng `TICKET_QR_KEY_MISSING_ALERT` của `ticketing`) và gộp trùng theo `(qrKeyVersion, currentVersion)`. Lý do: route công khai không giới hạn tốc độ, nên mỗi lần mở link (kể cả bot xem trước link của app chat) là một dòng `error`.
  evidence: `ticketing/tickets.service.ts` › `sharedTicket`. Payload `{ ticketId, eventId, qrKeyVersion, currentVersion, alert }`. Nếu `qrKeyVersion < currentVersion` thì khóa cũ đã bị gỡ; nếu `qrKeyVersion > currentVersion` thì instance chưa có khóa mới (deploy dần, rollback). Test ghim marker: `test/ticketing/qr-key-rotation.test.ts`. Review E3-5 D1 #1 (low, bỏ khỏi spec vì throttle cần thêm state), #8.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6 (4.6-b). Bằng chứng: `ticketing/tickets.service.ts:205-213` (`alerts.raise`), `platform/alerts/kinds.ts:93-98` (`ticket_qr_key_missing`, gộp trùng `cooldown`).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md`
  summary: Story 4.6/4.7. Khi thiếu khóa QR, các đường còn lại (Chi tiết Vé `ownTicket`, Trang Đơn và email Vé qua `ticketsOfOrder`, "Tạo lại link") vẫn ném `Error` thường; `ErrorFilter` log "Lỗi không bắt được" không có marker. 4.6 nên gắn marker `ticket_qr_key_missing` cho các lỗi này (tại chỗ ném hoặc trong filter), mã trạng thái giữ nguyên. 4.7 nên thêm kiểm lúc khởi động: `SELECT DISTINCT qr_key_version FROM tickets WHERE status = 'valid'` so với `keys.has`, để bắt xoay khóa sai trước khi người dùng gặp.
  evidence: `ticketing/my-tickets.ts:128-129`, `ticketing/tickets.service.ts` › `ticketsOfOrder`/`regenerateShareLink`, `platform/http/error.filter.ts:57`. Có từ trước spec E3-5 D1; spec giữ các đường này là lỗi cấu hình (Sprint Change Proposal 13/11/2026 §4.6). Review E3-5 D1 #2 (medium, defer).
- Đã xử lý (20/11/2026), phần 4.7 (kiểm lúc khởi động) của mục ngay trên: `_bmad-output/implementation-artifacts/spec-4-7-g-kiem-khoa-qr-luc-khoi-dong.md`. Mỗi lần vai api hoặc worker khởi động, `TicketQrKeyCheck` (`ticketing/ticketing.module.ts`, chạy nền từ `onApplicationBootstrap`) gọi `missingQrKeyVersions` (`ticketing/qr-key-check.ts`): phiên bản khóa của Vé `valid` thuộc Sự kiện còn mở (`eventOpenForTickets`) mà `TICKET_QR_KEYS` không có. Mỗi phiên bản thiếu: log `error` marker `ticket_qr_key_missing` kèm `qrKeyVersion`, `currentVersion`, `tickets` (số Vé), rồi `OpsAlerts.raise` subject `qrKeyVersion:currentVersion`. Chỉ cảnh báo, không thoát (Mason chốt 20/11/2026); truy vấn lỗi thì log `warn`. Phần 4.6 (marker cho lỗi của Chi tiết Vé, Trang Đơn, email và "Tạo lại link") vẫn mở; các đường đọc Vé không đổi.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): không làm phần 4.6 (marker cho lỗi của Chi tiết Vé, Trang Đơn, email Vé và "Tạo lại link"); 4.7-g đã kiểm khóa lúc khởi động và cảnh báo trước khi người dùng gặp.

## Deferred from: code review of spec-epic-3-e3-9-moi-truong-dev-va-quy-trinh.md (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-9-moi-truong-dev-va-quy-trinh.md`
  summary: Hai nhánh story mở cùng lúc luôn xung đột ở dòng `last_updated` của `sprint-status.yaml` khi merge PR thứ hai. Cần một luật: hoặc không cập nhật `last_updated` trong commit trên nhánh, hoặc README ghi cách gỡ xung đột (giữ giá trị mới hơn) trên nhánh trước khi merge.
  evidence: Có từ trước E3-9. `sync-sprint-status.md` của bmad-build (step-03 đặt `in-progress`, step-05 đặt `review`) vốn đã cập nhật `last_updated` trên nhánh. Override `on_complete` của E3-9 thêm một lần cập nhật nữa. Review E3-9 #14 (BH, ECH; medium, defer).
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): gỡ xung đột `last_updated` bằng tay, giữ giá trị mới hơn.

## Deferred from: build of spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md (2026-11-13)

- Đã xử lý (13/11/2026): mục Story 4.1 (B4) ở "retrospective Epic 3 — bàn giao có story nhận" phía trên. Mason quyết (spec 4.1 › Quyết định của Mason 13/11): IPN `expired`/`canceled` vẫn nhả chỗ ngay (AD-4 (b)), `applyStatus` không đổi. Tiền về sát giờ được bắt bởi các mốc tra sau hết hạn (`expires_at` + 30 phút, + 2 giờ, + 24 giờ) và nhánh bán lại có điều kiện của `markPaid`.
- Đã xử lý (13/11/2026): mục Story 4.1 (B5) ở cùng phần. `IpnProcessor.process(organizationId, ipn, source)` nhận nguồn (`ipn` mặc định, `reconciliation`), `markPaid` nguồn `reconciliation` đi cùng khóa và bước 3–7, thêm kết quả `already_settled`. Phần "mã giao dịch trùng giữa IPN và kết quả tra" vẫn mở: xem mục "hợp đồng tạm" và mục "Thanh toán trùng giả" dưới đây.
- Đã xử lý (13/11/2026): mục Story 4.1 (C5) ở cùng phần. Trang Đơn poll 30 giây khi SSE mất với Đơn `expired` mà `serverNow < expiresAt + 24 giờ` (`apps/web/lib/order/live.ts`). Thẻ "Hết hạn" 30 phút của Vé của tôi giữ nguyên: SSE `liveOrderIds` đã gồm mọi Đơn nên Vé đến muộn vẫn hiện.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Thay hợp đồng tạm của API tra đơn Gateway bằng hợp đồng thật khi Tingee trả lời: đường dẫn, body, tên trường của `data`, mã "không tìm thấy" và cách ký. Chỉ sửa `apps/api/src/modules/tingee/tingee.client.ts` (`TINGEE_GET_ORDER_PATH`, `getGatewayOrder`), `tingee/errors.ts` (`TINGEE_ORDER_NOT_FOUND_CODE`) và Tingee fake (`apps/api/test/tingee-fake/server.ts`), rồi bật `TINGEE_ORDER_STATUS_QUERY` ở staging. Nếu `data` không dùng tên trường của IPN thì `getGatewayOrder` đổi sang dạng IPN trước khi trả (worker đưa kết quả qua `TingeeIpn`).
  evidence: Tài liệu công khai của Tingee đọc ngày 13/11/2026 chỉ có `create-link`. Hợp đồng tạm ở spec 4.1 › Design Notes: `POST /v1/payment-gateway/get-order` `{requestId, orderId}` → `00` + `data` tên trường IPN, `2004` không tìm thấy. Cờ worker mặc định tắt; `.env.example` và `workerConfig()` của test bật.
- Ghi thêm cho mục trên (20/11/2026, E4-3 phần A): story nào thay hợp đồng tạm của API tra đơn cũng phải gỡ luật production của `TINGEE_ORDER_STATUS_QUERY` (`CrossRule` trong `apps/api/src/platform/config/config.schema.ts`, lý do "phải tắt khi NODE_ENV=production…"), cùng test (`test/config.test.ts`, `test/roles.process.test.ts`) và tài liệu (`.env.example`, README › bảng luật production, bảng biến); không gỡ thì staging không bật được cờ, worker không khởi động.
- Story nhận (21/11/2026, E4-8): action item "Chốt với Tingee" (sprint-status, epic 4). Thay hợp đồng tạm khi Tingee trả lời.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Rủi ro "Thanh toán trùng" giả: Đối soát bù phát Vé trước, rồi IPN của cùng khoản tiền tới sau mang `providerTransactionCode` khác mã của kết quả tra → IPN đi bước 4 của AD-7 thành mục `duplicate_payment` dù Người mua chỉ trả một lần. Chỉ đóng được khi Tingee xác nhận mã giao dịch của kết quả tra trùng mã của IPN (khi đó unique `(organization_id, provider_transaction_code)` của `payment_events` chặn). Nếu Tingee xác nhận mã khác nhau thì cần khóa chống lặp khác (vd. `billId`, hoặc `(orderId, paidAmount)` cho Đơn đã `paid` qua `reconciliation`).
  evidence: Spec 4.1 › Design Notes "Vì sao `already_settled` thay vì `duplicate_payment`". Chiều ngược lại (IPN tới trước, kết quả tra mang mã khác) đã đóng bằng `already_settled` (`test/payment/reconciliation.test.ts` › "Đua khác mã"). Retro Epic 3 B5.
- Story nhận (21/11/2026, E4-8): action item "Chốt với Tingee" (sprint-status, epic 4). Cần Tingee xác nhận mã giao dịch của kết quả tra có trùng mã của IPN không.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Story 5.8. Đo tải tra trạng thái lên giới hạn 20 request/10 giây của Tingee (theo key merchant). Mỗi Đơn có link tạo tối đa 7 lần tra (dừng sớm khi Đơn đã chốt; thêm tối đa 3 lần tra lại mỗi mốc khi lỗi); worker tra tuần tự nhưng không có bộ hãm theo merchant, nên một đợt mở bán lớn của một BTC (nhiều Đơn cùng mốc + 2 phút) có thể dồn quá giới hạn. Nếu chạm giới hạn thì thêm hãm theo `clientId` hoặc giãn mốc theo nhóm.
  evidence: `ordering/reconciliation-jobs.ts` (lịch, `batchSize` 10, tuần tự), `payment/reconciliation-worker.ts`. Chưa đo. Lỗi do giới hạn tốc độ hiện đi nhánh "mã lạ" → tra lại sau 1, 2, 4 phút, nên tự giãn nhưng có thể chạm trần 4 lỗi và dừng kèm cảnh báo.
- Story nhận (21/11/2026, E4-8): 9.2 (thay nhãn "5.8"). Đo tải tra trạng thái trong kiểm thử tải.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Story 4.2/4.6. Chuỗi Đối soát bù dừng ở lỗi lần thứ 4 liên tiếp (gồm lúc BTC bị `MERCHANT_SUSPENDED` hay Tingee ngừng vài phút) thì mất luôn các mốc sau, kể cả `expires_at` + 2 giờ, + 24 giờ là các mốc bắt tiền về muộn. 4.2 khi mở lại dịch vụ ("Đối soát bù mọi Đơn còn mở của BTC") nên tra cả Đơn `expired` từng có link còn trong 24 giờ sau hết hạn, không chỉ Đơn `pending`; 4.6 nhận cảnh báo `payment_reconciliation_stopped` và quyết có cần lệnh tra lại tay theo mã Đơn không.
  evidence: Review 4.1 (BH, ECH; medium, defer). Dừng chuỗi đúng intent 4.1 (AC epics "job dừng và đẩy cảnh báo vận hành", spec 4.1 "lỗi lần thứ 4 liên tiếp → dừng chuỗi"), nên 4.1 không đổi. `apps/api/src/modules/payment/reconciliation-worker.ts` (`fail` → `stop`), `RECONCILE_MAX_FAILURES` ở `ordering/reconciliation-jobs.ts`.
- Đã xử lý phần 4.2 (13/11/2026): Story 4.2-a. Tắt cờ dịch vụ thanh toán (mọi đường) enqueue job `payment.service-resumed`; worker của `payment` enqueue job tra 4.1 tại đồng hồ DB cho mọi Đơn của BTC có link mà `pending`, hoặc `expired` với `expires_at` trong 24 giờ trước (`ordering.reconcilableOrderIdsOf`), nên chuỗi đã dừng vì `MERCHANT_SUSPENDED` được nối lại. Phần 4.6 (cảnh báo, lệnh tra lại tay) vẫn mở.
- Đã xử lý (21/11/2026, E4-8): phần cảnh báo của mục ngay trên đã làm ở Story 4.6. Bằng chứng: `payment/reconciliation-worker.ts:282-290`, `platform/alerts/kinds.ts:86-92`. Story nhận (21/11/2026, E4-8): action item E4-1 cho lệnh tra lại tay theo mã Đơn.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Khi thay hợp đồng tạm của API tra đơn Gateway, kiểm API tra thật có cần cấp quyền nhóm dịch vụ riêng cho key merchant không. Mã 1133 ("key chưa được cấp quyền nhóm dịch vụ") hiện ánh xạ `TINGEE_CREDENTIAL_INVALID`, nên nếu key chỉ có quyền "Cổng thanh toán" mà API tra thuộc nhóm khác thì mọi Đơn dừng ngay với lý do `credential_invalid`, đọc như BTC thu hồi key.
  evidence: Review 4.1 (BH; maybe-false, nếu đúng thì medium; chưa kiểm được). Cần Tingee xác nhận nhóm quyền của API tra. `apps/api/src/modules/tingee/errors.ts` (1133), `payment/reconciliation-worker.ts` (`lookup`).
- Story nhận (21/11/2026, E4-8): action item "Chốt với Tingee" (sprint-status, epic 4). Cần Tingee xác nhận nhóm quyền của API tra.

## Deferred from: build E3-2 + Story 4.2, tách phạm vi (2026-11-13)

Mason chọn tách ngày 13/11/2026: làm E3-2 trước (`spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`), Story 4.2 làm ngay sau và dùng lại chốt `sellability` trong `PaymentLinks.ensure` của E3-2.

- source_spec: none
  summary: Story 4.2. Cờ `payment_service_status` tự "Tạm ngừng bán" mọi Hạng vé > 0đ khi Tingee trả `MERCHANT_SUSPENDED` hoặc key hiện hành trả `TINGEE_CREDENTIAL_INVALID`, tự mở lại (job dò 5 phút, "Kiểm tra lại", Quản trị Tingee, lưu key mới) kèm Đối soát bù mọi Đơn còn mở; banner dashboard qua `notices`; nhãn trạng thái bán trên dashboard lấy từ `sellability` (C5 của E2-6). Tingee chưa xác nhận `getMerchantServiceStatus` gọi bằng key merchant, spec phải ghi phương án dự phòng và Tingee fake phải giả lập được.
  evidence: Gộp với E3-2 thành hai mục tiêu ship riêng được (hai PR độc lập); 4.2 riêng đã vượt ngưỡng spec. Hai phần chỉ dính ở chốt `sellability` trong `PaymentLinks.ensure`, nên làm E3-2 trước.
- Đã xử lý phần lõi API (13/11/2026): Story 4.2-a (`spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`). Cờ `organizations.payment_service_*` (migration `0023_payment_service_status`), bật trong transaction bù của `create-link`, `sellability` đọc cờ thật (trang công khai, TX1, chốt link), tắt qua job dò 5 phút, `POST /v1/orgs/:orgId/payment-service/check`, API Quản trị Tingee và lưu key mới (`credential_invalid`), kèm Đối soát bù mọi Đơn còn mở; `notices` trả ba mã mới. Giao diện (banner theo vai, stream BTC, khối "Kiểm tra lại", tab Quản trị) là 4.2-b; nhãn C5 là 4.2-c (hai mục bên dưới).

## Deferred from: code review of spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`
  summary: Story 4.2. Không test nào chứng minh chốt link (`PaymentLinks.attempt` → `paymentLinkBlock` với `dbNow`) và `BuyerOrderView.payment.checkoutUrl` (qua `endedNow`) đi theo đồng hồ DB chứ không theo đồng hồ app; gộp vào mục E3-7 VG #2 (test giả `Date` cho `endedNow`), làm cùng lúc khi 4.2 chạm lại chốt này.
  evidence: Review E3-2 #9 (VG, BH). Mọi test kết thúc Sự kiện bằng `POST …/end` rồi thử ngay, nên hai đồng hồ luôn cùng quá mốc; thay `dbNow` bằng `new Date()` không test nào đỏ. Harness Nest chưa có mẫu giả `Date`.
- Story nhận (21/11/2026, E4-8): action item E4-10. Phần test giả `Date` cho chốt link và `checkoutUrl`.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`
  summary: Lệnh "Kết thúc" (`EventStatusService.transition`) đặt `ended_manually_at` = `effective_end_at` bằng đồng hồ app (`new Date()`), trong khi chốt link, Trang Đơn và mọi `ended` so bằng `now()` của DB; app chạy nhanh hơn DB thì trong khoảng lệch đó vẫn tạo link và trả checkout URL. Nên lấy giờ bằng `dbNow(tx)` (cả Ẩn/Hiện lại dùng `now` cho `notEnded`).
  evidence: Review E3-2 #10 (ECH, low). Có từ Story 2.12 (`apps/api/src/modules/event/event-status.service.ts:110`); spec E3-2 cấm đổi `EventStatusService`. Lệch đồng hồ thường ở mức ms nhờ NTP.
- Story nhận (21/11/2026, E4-8): action item E4-10. Đổi `ended_manually_at` sang `dbNow(tx)` cùng phần đồng hồ DB của E4-10.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`
  summary: Story 7.1. Khi có đường hủy Sự kiện, Đơn chưa có link của Sự kiện đã hủy bị chốt link E3-2 hết hạn `sales_paused` và Trang Đơn hiện "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." + "Về trang Sự kiện" (`buyerStatusOf` trả `expired`, không phải `event_cancelled`). 7.1 phải chọn câu cho Đơn `expired` của Sự kiện đã hủy (vd. ưu tiên `event_cancelled` hoặc kiểm `event.status` trước câu `SALES_PAUSED`).
  evidence: Review E3-2 #11 (BH, ECH). Hiện chưa xảy ra: không code nào đặt `events.status = 'cancelled'` (Story 7.1 backlog). `apps/web/app/(buyer)/orders/[code]/order-view.tsx` › `StatusBlock`.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`
  summary: Thẻ Đơn ở "Vé của tôi" (`order-card` › `AwaitingPayment`) vẫn hiện đếm ngược + "Tiếp tục thanh toán" cho Đơn chờ tiền của Sự kiện đã kết thúc; nút dẫn tới Trang Đơn đang báo "Sự kiện đã kết thúc. Đơn này không thanh toán được nữa." Cần đổi thẻ theo `event.ended` cho cùng một câu ở mọi nơi.
  evidence: Review E3-2 #12 (BH, low). Spec E3-2 (Never) giữ nguyên `order-card`. `apps/web/components/tickee/order-card.tsx:48-56`.
- Story nhận (21/11/2026, E4-8): 7.1. 7.1 chạm thẻ Đơn và Trang Đơn theo trạng thái Sự kiện.

## Deferred from: build Story 4.2, tách phạm vi (2026-11-13)

Spec 4.2 đầy đủ khoảng 5.500 token. Mason chọn tách ba ngày 13/11/2026: làm 4.2-a lõi API trước (`spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`), rồi 4.2-b giao diện, rồi 4.2-c nhãn C5. Story `4-2-…` trong sprint-status chỉ `done` sau 4.2-c. Mason chốt cùng ngày: lý do 1033 → `token`, 1007/1034 → `tingee_disabled`; dò tạm bằng `get-va-paging`; "Kiểm tra lại" ở trang Tài khoản nhận tiền, Quản trị có tab riêng.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-b (giao diện). Banner dashboard cho ba mã notice của 4.2-a theo vai: Token → danger "Mọi Sự kiện có phí đang Tạm ngừng bán", Owner "Mua thêm Token" mở `data.tingeePortalUrl` (liên kết ngoài: `StatusBannerStack` hiện chỉ nhận `section`); `credential_invalid` → "Key Tingee không còn dùng được", Owner "Nhập lại key" tới trang Tài khoản nhận tiền, Admin "Nhờ Owner cập nhật key Tingee."; `tingee_disabled` → "Tingee đang tạm ngừng dịch vụ thanh toán của BTC. Mọi Sự kiện có phí đang Tạm ngừng bán.", Owner "Xem chi tiết" tới trang Tài khoản nhận tiền, Admin "Nhờ Owner liên hệ Tingee.". Stream `GET /v1/orgs/:orgId/live` (thành viên BTC, chỉ `org_status_changed` của BTC đó) và `StatusBannerStack` dùng `useLiveResource` (poll 10 giây khi không có SSE, AD-17). Trang Tài khoản nhận tiền (Owner) có khối "Dịch vụ thanh toán" khi `suspended`: lý do, từ lúc nào, lần dò gần nhất, "Kiểm tra lại" (spinner, toast kết quả), `credential_invalid` kèm lối "Đổi key Tingee" có sẵn. `/admin` thêm tab "Tạm ngừng bán": danh sách BTC `suspended`, "Mở lại" qua `Dialog`.
  evidence: Tách khỏi 4.2-a vì spec đầy đủ vượt ngưỡng; 4.2-a đã có mọi API (`notices`, `POST …/payment-service/check`, API Quản trị, `PaymentServiceState` trong overview Tài khoản nhận tiền) nên 4.2-b chỉ là web + một stream.
- Đã xử lý (13/11/2026): Story 4.2-b (`spec-4-2-b-giao-dien-tam-ngung-ban.md`). Bốn banner dịch vụ thanh toán theo vai (câu Mason chốt 13/11: Owner có mô tả + một hành động, "Mua thêm Token" là liên kết ngoài tới `data.tingeePortalUrl` mở tab mới, các hành động khác tới trang Tài khoản nhận tiền; Admin chỉ có câu nhờ Owner). Stream `GET /v1/orgs/:orgId/live` (`reporting`, `org.read`, chỉ `org_status_changed` của đúng BTC; hub chưa sẵn sàng → 503); `StatusBannerStack` dùng `useLiveResource` (tham số mới `onSignal` tải lại cả tổng quan Tài khoản nhận tiền; không có SSE thì polling 10 giây, banner dịch vụ thanh toán đổi thì tổng quan cũng tải lại). Khối "Dịch vụ thanh toán" (lý do, "Từ …", lần kiểm tra gần nhất, hướng dẫn theo lý do, "Kiểm tra lại" với toast theo `outcome`, `credential_invalid` kèm "Đổi key Tingee" mở luồng 2.13-b). `/admin` có tab "Tạm ngừng bán" (bảng, "Mở lại" qua `ConfirmDialog`, 409 `PAYMENT_SERVICE_NOT_SUSPENDED` → toast + tải lại, cổng TOTP như tab Closed Beta). `TingeeLink` chuyển về `components/tickee/tingee-link.tsx`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-c (C5 của E2-6). Nhãn trạng thái bán của Sự kiện trên dashboard (`apps/web/app/(dashboard)/btc/[orgId]/su-kien/event-status.ts` › `eventBadge`, dùng ở `organization-home.tsx` và badge thẻ "Thông tin" của `event-tabs.tsx`) lấy từ `sellability` (`eventReason`: hủy, khóa, đã kết thúc, Ẩn, "Tạm ngừng bán") thay vì tự tính từ `status`/`effectiveEndAt`. API tổ chức chưa trả `sellability`; `event` không import `ordering`, nên endpoint nằm ở `flows`.
  evidence: Tách khỏi 4.2-a: thay đổi độc lập (đường đọc riêng, chỉ hiển thị), ship riêng được. Thay cho mục deferred của spec 3.11 về C5.
- Đã xử lý (14/11/2026): Story 4.2-c (`spec-4-2-c-nhan-trang-thai-ban.md`). `GET /v1/orgs/:orgId/event-sale-status` (`ordering`, không phải `flows`: `ordering → event` hợp lệ; `events.manage`; ngoài tiền tố `…/events/`) trả `{ eventId, reason, partial }` cho mọi Sự kiện không còn nháp, gọi `saleStatusOf` cho từng Sự kiện, đọc theo lô trong một transaction chỉ đọc với `dbNow`. Web: `eventSaleBadge` ("Tạm ngừng bán" / "Tạm ngừng bán một phần" theo `partial`, "Bị khóa", "Đã kết thúc", "Ẩn", "Đã hủy", "Đang mở bán"; nháp không cần api; chưa có dữ liệu hay lỗi → `eventBadge` cũ), một query dùng chung cho `organization-home.tsx` và `event-tabs.tsx`, làm mới sau lưu/Ẩn/Hiện lại/Kết thúc/mở bán/đổi Hạng vé/đổi tài khoản nhận tiền/"Kiểm tra lại" và theo `onSignal` của dải banner (cả lúc polling khi banner về điều kiện bán Vé có phí đổi). `partial` chỉ khi còn Hạng vé `on_sale` (khớp trang công khai). Closed Beta và tài khoản nhận tiền vẫn chưa phát `org_status_changed` (mục review 4.2-b phía dưới), nên khi SSE cấp BTC đang nối, "Tạm ngừng bán" vì hai lý do đó do người khác gây ra chỉ cập nhật ở lần tải lại kế tiếp: mỗi 60 giây khi trang đang hiện, khi quay lại tab và ở các điểm làm mới đã nêu.

## Deferred from: build of spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Thay hợp đồng dò tạm khi Tingee có API trạng thái dịch vụ gọi bằng key merchant. `tingee.getMerchantServiceStatus` hiện gọi `get-va-paging` (1 dòng) bằng key hiện hành: `00` → hoạt động. Tingee chặn Cổng thanh toán mà vẫn cho `get-va-paging` thì cờ mở lại sai, lần tạo link kế bật lại, mỗi vòng dò 5 phút mất một Đơn của Người mua. Khi thay, chỉ sửa `tingee.client.ts` và Tingee fake (`accountReplies`).
  evidence: Quyết định của Mason (13/11/2026) trong spec 4.2-a. `apps/api/src/modules/tingee/tingee.client.ts` (`getMerchantServiceStatus`), `apps/api/src/modules/organizer/payment-service.ts` (`PaymentServiceProber`).
- Story nhận (21/11/2026, E4-8): action item "Chốt với Tingee" (sprint-status, epic 4). Thay hợp đồng dò tạm khi Tingee có API trạng thái dịch vụ gọi bằng key merchant.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Tingee xác nhận mã Token. `1033` ("gói dịch vụ đã hết hạn") đang ánh xạ lý do `token` (banner "Mọi Sự kiện có phí đang Tạm ngừng bán", "Mua thêm Token"); 1007/1034 → `tingee_disabled`. Nếu hết Token mang mã khác (hoặc 1033 không phải hết Token), sửa `paymentServiceReasonOf` ở `tingee/errors.ts` và bảng mã của test (`test/tingee/client.test.ts`, `test/ordering/payment-link.test.ts`).
  evidence: Quyết định của Mason (13/11/2026) trong spec 4.2-a; chưa có tài liệu Tingee nào nêu mã của "hết Token" khi gọi `create-link` bằng key merchant.
- Story nhận (21/11/2026, E4-8): action item "Chốt với Tingee" (sprint-status, epic 4). Cần Tingee xác nhận mã hết Token.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: `create-link` bị từ chối vì VA (`2023` VA chưa được cho phép trên Cổng thanh toán, `1023`/`1045`/`1024`/`1072` VA lỗi) vẫn chỉ hết hạn Đơn (`sales_paused`), không bật cờ dịch vụ thanh toán, nên BTC không có banner và mọi Người mua sau vẫn thử rồi hết hạn. Cần quyết: thêm lý do riêng (vd. `payout_account_not_allowed`, tắt khi Owner đổi tài khoản mặc định) hay chỉ báo BTC bằng banner/email không chặn bán.
  evidence: Spec 4.2-a (Always: "`PAYMENT_ACCOUNT_NOT_ALLOWED` … không bật cờ"). `apps/api/src/modules/ordering/payment-link.ts` (`serviceReason` `null` với nhóm VA), `apps/api/src/modules/tingee/errors.ts` (`paymentServiceReasonOf`).
- Đã xử lý (14/11/2026): Story 4.2-d (`spec-4-2-d-tam-ngung-ban-khi-tingee-tu-choi-va.md`, Mason chốt thêm lý do riêng). Mọi mã `PAYMENT_ACCOUNT_NOT_ALLOWED` của `create-link` (`createLinkServiceReasonOf`) bật cờ lý do `payout_account_not_allowed` (migration `0024`) trong transaction hết hạn Đơn, chỉ khi tài khoản vừa gọi Tingee vẫn là mặc định hiện hành và credential vẫn hiện hành (không thì `stale_account`/`stale_credential`, cờ không đổi). Lần dò (`get-va-paging`) vẫn coi nhóm VA là "không biết"; job dò bỏ qua lý do này, "Kiểm tra lại" của Owner tắt cờ không gọi Tingee (`owner_check`), đổi hoặc hủy tài khoản mặc định tắt cờ cùng transaction (đường mới `default_changed`), lưu key mới tắt cờ (`new_key`). `notices` trả `PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED` (bậc 4); web có banner, khối "Dịch vụ thanh toán" (kèm "Mở portal Tingee") và nhãn tab Quản trị.

## Deferred from: code review of spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-b. `POST /v1/orgs/:orgId/payment-service/check` chỉ trả `PaymentServiceState`, nên toast "Kiểm tra lại" không phân biệt được "đang chờ 30 giây", "Tingee không trả lời", "vẫn ngắt" và "không có tài khoản mặc định"; thêm `outcome` (kết quả dò của `PaymentServiceProber`) và có thể `retryAfterSeconds` vào response khi làm giao diện.
  evidence: Review 4.2-a #4 (BH, low). `organizer/payment-service.ts` › `PaymentServiceService.check` bỏ kết quả của `probe`.
- Đã xử lý (13/11/2026): Story 4.2-b (`spec-4-2-b-giao-dien-tam-ngung-ban.md`). `POST …/payment-service/check` trả `PaymentServiceCheckResult` `{ state, outcome, retryAfterSeconds }`: `outcome` `resumed` | `still_suspended` (gộp đổi lý do) | `unknown` | `no_target` | `cooldown` (kèm số giây còn chờ theo đồng hồ DB) | `not_suspended` (gồm lần dò thắng lượt nhưng đường khác vừa mở lại). Luật dò và mở lại của 4.2-a không đổi.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 5.8. Mở lại dịch vụ: `reconcilableOrderIdsOf` quét cả bảng `orders` (không có index nào theo `organization_id`), và worker "đã mở lại" enqueue mọi job tra của BTC cùng một mốc nên một BTC nhiều Đơn mở dồn lời gọi tra lên giới hạn 20 request/10 giây của Tingee. Đo khi chạy tải; nếu cần thêm index một phần `(organization_id) WHERE payment_link IS NOT NULL AND status IN ('pending','expired')` và giãn `startAfter`.
  evidence: Review 4.2-a #6, #7 (BH, ECH, low). `ordering/reconciliation-jobs.ts` › `reconcilableOrderIdsOf`, `payment/payment-service-resumed-worker.ts`. Cùng yếu điểm giới hạn tốc độ của 4.1 (mục 5.8 phía trên); `TINGEE_ORDER_STATUS_QUERY` hiện tắt ngoài local.
- Story nhận (21/11/2026, E4-8): 9.2 (thay nhãn "5.8"). Đo khi chạy tải rồi mới thêm index.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.6. Danh sách BTC bị ngắt của Quản trị không phân trang, và một lượt job dò tuần tự không có trần thời gian (mỗi BTC tới 5 giây timeout): nhiều BTC bị ngắt cùng lúc có thể làm lượt chạy dài hơn chu kỳ 5 phút. Thêm giới hạn số BTC hoặc ngân sách thời gian mỗi lượt khi có số liệu.
  evidence: Review 4.2-a #23 (BH, ECH, low). `organizer/payment-service.ts` › `listSuspendedPaymentServices`, `PaymentServiceProbeWorker.probeSuspended`. Lượt chồng nhau đã không gọi Tingee hai lần nhờ CAS `checked_at`.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): Closed Beta ít BTC; CAS `checked_at` đã chặn gọi Tingee trùng khi lượt chồng nhau.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: UAT Tingee thật (E3-3). `create-link` bị từ chối bằng HTTP ≠ 200 kèm mã ngắt (vd. 401/403 với 1133/1034/1033) hiện bị coi là kết quả mơ hồ (`timeout`, theo 3.4) nên không bật cờ dịch vụ; trong khi dò (`getMerchantServiceStatus`) coi HTTP 4xx kèm mã ngắt là kết luận. Kiểm Tingee trả mã ngắt kèm HTTP nào; nếu là 4xx thì cho `create-link` coi 4xx kèm mã ngắt đã biết là `rejected`.
  evidence: Review 4.2-a #26 (ECH, maybe-false; nếu đúng thì medium: BTC không bao giờ được báo, mọi Đơn có phí hết hạn `timeout`). `tingee/tingee.client.ts` › `createPaymentLink` / `CreateLinkError`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-b, bổ sung cho mục 4.2-b phía trên (viết trước khi có lý do thứ tư). Banner của mã `PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING` (lý do `gateway_permission_missing`, mã 1133): danger "Key Tingee chưa được cấp quyền Cổng thanh toán" (tiêu đề đã có ở 4.2-a), Owner có hành động tới trang Tài khoản nhận tiền, nơi khối "Dịch vụ thanh toán" nhắc cấp quyền "Cổng thanh toán" cho key trên portal Tingee (`TingeeGuide`) rồi bấm "Kiểm tra lại" (lý do này mở lại không cần Tingee xác nhận); Admin "Nhờ Owner cấp quyền Cổng thanh toán cho key Tingee.". Câu chữ cụ thể chốt khi lập spec 4.2-b.
  evidence: Mason chốt 13/11/2026 sau review 4.2-a lượt 1 (intent_gap #1): 1133 tách khỏi `credential_invalid` vì dò bằng `get-va-paging` không thấy thiếu quyền này. Đóng phần câu nhắc cấp quyền của mục 3.4 (1133).
- Đã xử lý (13/11/2026): Story 4.2-b (`spec-4-2-b-giao-dien-tam-ngung-ban.md`). Banner `PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING`: Owner "Mọi Sự kiện có phí đang Tạm ngừng bán." + "Xem cách xử lý" tới trang Tài khoản nhận tiền; Admin "… Nhờ Owner cấp quyền Cổng thanh toán cho key Tingee.". Khối "Dịch vụ thanh toán" nhắc cấp quyền “Cổng thanh toán” cho key (kèm liên kết trang API key của portal) rồi bấm "Kiểm tra lại", và nói rõ Tickee không tự kiểm tra được quyền này.

## Deferred from: code review of spec-4-2-b-giao-dien-tam-ngung-ban.md (2026-11-14)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-b-giao-dien-tam-ngung-ban.md`
  summary: Story 7.4 (hoặc story chạm Closed Beta/tài khoản nhận tiền kế tiếp). Chỉ cờ dịch vụ thanh toán phát `org_status_changed`; duyệt/thu hồi Closed Beta (`organizer/closed-beta.ts`) và liên kết/hủy liên kết tài khoản nhận tiền không phát, nên khi SSE cấp BTC đang nối (poll tắt) các banner `CLOSED_BETA_*`, `PAYOUT_ACCOUNT_NOT_LINKED` chỉ cập nhật khi mở trang hay quay lại tab. Thêm `realtime.notifyOrganization(tx, ORG_STATUS_CHANGED, orgId)` vào các transaction đó (AD-17: `org_status_changed` → `notices`, vai trò).
  evidence: Review 4.2-b #3 (ECH, BH, low). Không phải hồi quy: trước 4.2-b dải banner dùng `useQuery` không poll.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-b-giao-dien-tam-ngung-ban.md`
  summary: Story 4.7, bổ sung mục HTTP/2. Từ 4.2-b, shell dashboard giữ một SSE cấp BTC (`GET /v1/orgs/:orgId/live`) trên mọi trang dashboard, Tổng quan Sự kiện giữ thêm một stream: ba tab dashboard qua HTTP/1.1 đã gần trần 6 kết nối/origin và làm treo REST. Edge phục vụ API bằng HTTP/2, hoặc gộp tín hiệu trang vào một stream.
  evidence: Review 4.2-b #6 (ECH, BH, low). `components/tickee/status-banner-stack.tsx`, `su-kien/[eventId]/event-overview.tsx`.
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.

## Deferred from: code review of spec-4-2-d-tam-ngung-ban-khi-tingee-tu-choi-va.md (2026-11-14)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-d-tam-ngung-ban-khi-tingee-tu-choi-va.md`
  summary: Kiểm VA mặc định trước khi tắt cờ `payout_account_not_allowed`. Hiện "Kiểm tra lại" và đổi tài khoản mặc định tắt cờ mà không hỏi Tingee; nếu `get-va-paging` (`listAccounts`, chỉ trả VA `active`) không còn liệt kê VA bị từ chối thì có thể kiểm VA mặc định còn trong danh sách trước khi mở lại, tránh mất một Đơn của Người mua mỗi lần mở lại sai.
  evidence: Review 4.2-d #7 (BH, maybe-false; nếu đúng thì medium). Ca thật ở dev (Đơn `TKTDHEKF6W`): VA mặc định của BTC "test" được liên kết qua `listAccounts` mà `create-link` vẫn bị từ chối nhóm VA, nên nhiều khả năng `get-va-paging` không thấy lỗi này; fake 2023 chỉ mô phỏng. Cần UAT Tingee thật (E3-3): VA trả 2023 hoặc 1023/1045/1024/1072 ở `create-link` có còn trong `get-va-paging` `status: active` không. Phần đã khóa của 4.2-d cấm gọi Tingee ở hai đường này, nên đổi cần Mason chốt.

## Deferred from: build of spec-4-3-hang-can-xu-ly-cua-btc.md (2026-11-16)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-hang-can-xu-ly-cua-btc.md`
  summary: Phân trang hàng Cần xử lý khi một BTC có nhiều mục `open`. `GET …/review-items` trả mọi mục `open` (không phân trang, theo Design Notes), và `openReviewCount` của Tổng quan Sự kiện đọc mọi mục `open` của BTC rồi lọc theo Sự kiện của Đơn ở `reporting` (`review_items` không có `event_id`, `payment` không được join `orders`). Khi số liệu cho thấy BTC tích hàng trăm mục: thêm phân trang (con trỏ `created_at`, `id`) và một read model đếm theo Sự kiện (vd. `ordering` trả id Đơn theo lô, hoặc thêm `event_id` vào `review_items` bằng migration).
  evidence: Build 4.3. `reporting/review-queue.service.ts` › `queue`, `reporting/event-overview.service.ts` › `openReviewCountOf`; index `review_items_organization_id_status_created_at_idx` đã có.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): chỉ cần khi một BTC có hàng trăm mục `open`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-3-hang-can-xu-ly-cua-btc.md`
  summary: `useLiveResource` không cho `onSignal` biết topic của tin SSE, nên trên stream cấp BTC mỗi `org_review_items_changed` cũng tải lại `notices`, tổng quan Tài khoản nhận tiền và trạng thái bán, và mỗi `org_status_changed` cũng tải lại badge và hàng Cần xử lý. Rẻ (vài GET mỗi tín hiệu, đã gom 1 giây); nếu thành nhiễu thì truyền `type` của tin vào `onSignal` và chỉ làm mới tài nguyên đúng topic.
  evidence: Build 4.3. `components/tickee/status-banner-stack.tsx` › `refreshOnSignal`, `lib/realtime/use-live-resource.ts`.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): tải lại thừa rẻ và đã gom 1 giây.
- source_spec: none
  summary: Story 4.4-b "Ghép với Đơn" cho mục `unmatched` đang `open`: danh sách Đơn `expired`/`review` của cùng BTC có `total_amount` bằng số tiền nhận (trong `orgScope`, lọc theo số tiền và Sự kiện), transaction gắn `payment_events.order_id` rồi `markPaid(tx, orderId, 'manual', paidAmount)` theo quy tắc tồn kho và thứ tự kiểm của 3.6, audit ghi id giao dịch, Đơn được ghép và người ghép; hết chỗ hoặc Sự kiện đã hủy/kết thúc thì mục vẫn `open` kèm lý do.
  evidence: Mason chọn tách ở bước kiểm phạm vi của Build 4.4 (16/11/2026). Phần ghép cần route Đơn ứng viên, UI chọn Đơn và mutation riêng, giao được độc lập sau khi 4.4-a dựng nền thao tác chung (Idempotency-Key, audit `review_item.*`, tín hiệu, nút trong `Sheet`).
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.4-b (`spec-4-4-b-ghep-voi-don.md`). Bằng chứng: `payment/review-actions.controller.ts:102` (`POST …/match`).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-a-duyet-tay-tu-choi-va-hoan-tay.md`
  summary: Story 7.1/7.2. Đơn `review` chỉ có mục `event_cancelled` (tiền về sau khi Sự kiện bị hủy) giữ `review` sau khi BTC "Đã hoàn tay"/"Bỏ qua" mọi mục của nó, vì AD-3 không có `review → refunded` và 4.4-a chỉ đóng mục. Người mua thấy "BTC đang kiểm tra" mãi. Khi làm hủy Sự kiện, chốt chuyển Đơn này sang `cancelled` (`event_cancelled`) rồi `refunded`, hoặc để `flows.cancelEvent` chuyển cả Đơn `review`.
  evidence: Build 4.4-a. `payment/review-actions.ts` › `apply` (nhánh refund-only chỉ `closeItem`); test `review-actions.test.ts` "Sự kiện đã hủy: Đã hoàn tay đóng mục, Đơn giữ review". Hiện chưa xảy ra được: hủy Sự kiện là Story 7.1.
- Story nhận (26/11/2026, E5-4): 7.1. Mason chốt Đơn `review` và Đơn `expired` có tiền về sau khi hủy chuyển `cancelled` (`event_cancelled`); mục của chúng chỉ đóng. AC 7.1, AD-3, AD-7, AD-28 đã ghi.

## Deferred from: code review of spec-4-4-b-ghep-voi-don.md (2026-11-16)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-b-ghep-voi-don.md`
  summary: Đối soát bù dừng tra khi Đơn rời `pending`/`expired`, nên khoản trả qua link Gateway của chính Đơn đó (IPN bị mất) không bao giờ được ghi nhận nếu Đơn đã `paid` nhờ "Ghép với Đơn" (4.4-b) hoặc đã vào `review` vì một khoản khác (lệch tiền); tiền của Người mua không có mục Cần xử lý nào để hoàn. Hướng sửa: tiếp tục tra các mốc sau hết hạn với Đơn `review` và Đơn `paid` nguồn `manual`, kết quả `success` của giao dịch chưa có trong `payment_events` đi bước 4 (`duplicate_payment`).
  evidence: Review 4.4-b (ECH). `payment/reconciliation-worker.ts` › `reconcile` (:153-157, `not_open`). Cần IPN mất hẳn, Đơn có link, và khoản thứ hai được ghép hoặc tạo `review` trước mốc tra sau hết hạn (30 phút, 2 giờ, 24 giờ). Sửa đổi Đối soát bù, ngoài intent của 4.4-b (Never: không đổi Đối soát bù).
- Story nhận (21/11/2026, E4-8): action item E4-1. Cùng phần làm Đối soát bù bền hơn.

## Deferred from: build of spec-4-5-a-trang-token.md (2026-11-16)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-5-a-trang-token.md`
  summary: Story 4.5-b "Cảnh báo Token". Owner đặt ngưỡng `organizations.token_alert_threshold` (PUT, quyền mới chỉ Owner, audit). Mỗi lần đọc Token `ok` (lúc xem trang và job dò định kỳ) so Token khả dụng với ngưỡng. Lần vượt ngưỡng lưu bằng một cột thời điểm (CAS từ null), và lần vượt đó enqueue đúng một email cho Owner. Dashboard hiện banner warning đóng được "Token khả dụng dưới ngưỡng cảnh báo." + "Mua thêm Token" (bậc 9 của `STATUS_NOTICE_PRIORITY`, `version` = thời điểm vượt). Danh mục thông báo mới trong `packages/contracts` có khóa chống gửi lặp `(organization, lần vượt ngưỡng)`.
  evidence: Mason chọn tách ở bước kiểm phạm vi của Build 4.5 (16/11/2026): spec đầy đủ khoảng 3.100 token. Ngưỡng đi cùng phần cảnh báo, để không có ngưỡng "lưu mà không làm gì"; 4.5-a chỉ đọc và hiển thị. Bản nháp đầy đủ (cột `token_below_threshold_since`, job `TOKEN_ALERT_SCAN` 60 phút, email không chứa số dư, ẩn banner khi `suspended` lý do `token`, khóa đóng banner thêm `orgId`) được dựng lại khi lập spec 4.5-b.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.5-b (`spec-4-5-b-canh-bao-token.md`). Bằng chứng: `organizer/token-alert.ts:22-34`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-5-a-trang-token.md`
  summary: Thay hợp đồng tạm của `tingee.getTokenBalance` (`POST /v1/merchant/get-token-balance` → `{ balance, creditLimit }`) khi Tingee xác nhận API đọc Token và hạn mức bằng key merchant. Trước lúc đó, trang Token trên UAT/PROD luôn hiện "Chưa đọc được số dư". Khi thay: sửa `tingee.client.ts` và route của Tingee fake; xét lại việc lời gọi đọc Token trả `TINGEE_CREDENTIAL_INVALID` có bật cờ `credential_invalid` (AD-32) không.
  evidence: Quyết định của Mason (16/11/2026) trong spec 4.5-a. Đã tìm trong code và tài liệu công khai `developers.tingee.vn`: không có API nào như vậy. Action item E4 "Chốt với Tingee… API đọc Token" vẫn `open`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-5-a-trang-token.md`
  summary: Ánh xạ mã Tingee `402` ("Số dư tài khoản dịch vụ của Merchant trên TINGEE không đủ để thực hiện yêu cầu."). Hiện `create-link` coi mã này là `PAYMENT_PROVIDER_UNAVAILABLE` (chỉ hết hạn Đơn, không Tạm ngừng bán), còn job dò coi là `unknown`. Nếu Tingee xác nhận đây là mã hết Token, thêm `402` → lý do `token` ở `paymentServiceReasonOf` (`tingee/errors.ts`) và cập nhật bảng mã của test.
  evidence: Mason chọn không làm trong 4.5 (16/11/2026). Mã có trong bảng lỗi công khai của Tingee. 1033 (đang ánh xạ `token`) là "Gói dịch vụ đã hết hạn"; xem thêm mục "Tingee xác nhận mã Token" của spec 4.2-a.
- Story nhận (21/11/2026, E4-8): action item "Chốt với Tingee" (sprint-status, epic 4). Cần Tingee xác nhận `402` có phải mã hết Token không.

## Deferred from: code review of spec-4-5-a-trang-token.md (2026-11-16)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-5-a-trang-token.md`
  summary: Giới hạn số lời gọi Tingee của `GET /v1/orgs/:orgId/token`. Mỗi lần xem và mỗi lần bấm "Tải lại" là một request ký bằng key merchant của BTC, cũng là key dùng để `create-link`. Hiện không có single-flight theo BTC hay cooldown ngắn (khác `POST …/payment-service/check`, có `PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS`). Nếu Tingee giới hạn tần suất theo key, nhiều tab hay một script có thể làm key bị chặn và hỏng việc bán Vé có phí. Hướng sửa: dùng chung promise đang chạy theo `organizationId` (chỉ trong bộ nhớ, vẫn "không lưu"), hoặc thêm cooldown vài giây.
  evidence: Review 4.5-a #2/#18 (BH, ECH), verdict maybe-false; nếu đúng thì medium (chưa kiểm). Muốn kết luận cần chính sách rate limit của Tingee cho key merchant, hỏi cùng lúc với action item E4 về API đọc Token. `organizer/token.service.ts` › `read`.
- Đã xử lý (20/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-4-e4-3-b-gom-loi-goi-doc-token.md` (retro Epic 4 D2; tiền đề "chưa biết Tingee có giới hạn tần suất" đã có câu trả lời: 20 request/10 giây theo key merchant). `TokenReader` gộp lời gọi đọc Token theo `${organizationId}:${credentialId}`: các lần xem đồng thời dùng chung lời gọi Tingee đang chạy, và các lần xem sau dùng lại kết quả của nó (`ok` lẫn `unavailable`, `readAt` của lần đọc thật) thêm `TOKEN_READ_COOLDOWN_SECONDS` = 5 giây tính từ lúc lời gọi xong. Chỉ giữ trong bộ nhớ tiến trình: mỗi tiến trình api và worker giữ một bản riêng (trang Token ở api, job dò mỗi giờ ở worker), timer `unref()` xóa bản ghi khi hết cooldown nên không số nào nằm lại quá 5 giây, kể cả ở worker rảnh. Lời gọi ném lỗi bất ngờ thì mọi request đang chờ nhận cùng lỗi và bản ghi bị xóa ngay. Đọc DB và giải mã key vẫn chạy ở mọi request (đổi key gọi Tingee bằng key mới ngay); không chia sẻ giữa hai BTC dùng chung merchant. Không gộp hay hãm các lời gọi Tingee khác. Hạn mức còn lại: mỗi instance api giữ bản ghi riêng, nên với N instance api, lượt xem trang Token của một BTC vẫn có thể tạo tới N lời gọi Tingee mỗi `TOKEN_READ_COOLDOWN_SECONDS` (giả định hiện tại: một instance api); scale api theo chiều ngang thì lớp bảo vệ này yếu đi.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-5-a-trang-token.md`
  summary: `apps/api/test/payment/ipn-dev-checkout.test.ts` › "Đã thanh toán (giả lập)" lỗi lẻ khi chạy cả bộ test API: `POST` tạo Đơn trả 500 thay vì 201 (`placePaid`, :74). Log của lượt chạy không giữ lỗi phía server nên chưa rõ gốc.
  evidence: Gặp 1 lần trong lượt `pnpm --filter @tickee/api test` khi kiểm 4.5-a (16/11/2026). Chạy riêng file đó pass 3/3, chạy lại cả bộ pass 1272/1272. Đường tạo Đơn → `create-link` không đi qua code của 4.5-a. Lần sau gặp thì giữ log của harness (`h.logs`) để biết lỗi 500.
- Story nhận (21/11/2026, E4-8): action item E2-8. Gom vào việc ghi các test chập chờn.

## Deferred from: build of spec-4-6-a-nen-quan-sat.md (2026-11-17)

- source_spec: none
  summary: Story 4.6-b "Cảnh báo vận hành". Kênh gửi cảnh báo tới đội vận hành và 5 điều kiện của NFR-10: IPN lỗi chữ ký hoặc lỗi xử lý tăng, tỉ lệ phát Vé giảm bất thường, hàng đợi pg-boss ùn hoặc có dead-letter, Đơn `pending` quá hạn chưa xác nhận, p95 tạo link > 2 giây. Nối các marker log đang chờ kênh này: tiền về không khớp Đơn (`payment/ipn-processor.ts:149`), chuỗi Đối soát bù dừng (`payment/reconciliation-worker.ts:45`), thiếu khóa Mã QR (`ticketing/tickets.service.ts:29`, `TICKET_QR_KEY_MISSING_ALERT`). Phải chốt luật cảnh báo nằm trong app hay trong backend giám sát (backend "chọn cùng hạ tầng", chờ NĐ 53/2022), và phần cảnh báo giữ chỗ hàng loạt bằng nhiều tài khoản (epic-4-context, mục 4.6).
  evidence: Mason chọn tách ở bước kiểm phạm vi của Build 4.6 (17/11/2026). Dùng metrics của 4.6-a cho p95 và các điều kiện về tỉ lệ.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6-b (`spec-4-6-b-canh-bao-van-hanh.md`). Bằng chứng: `platform/alerts/ops-alert-scan.ts:22`.
- source_spec: none
  summary: Story 4.6-c "Lưới an toàn định kỳ". Job đối chiếu tồn kho định kỳ so `held` với tổng Vé của Đơn `pending`, `sold` với số Vé đã phát; lệch thì cảnh báo, không tự sửa (AD-2). Quét cấp phút tìm Đơn `pending` đã quá mốc hết hạn mà job hoãn bỏ sót và xử lý như AD-4 (lưới an toàn).
  evidence: Mason chọn tách ở bước kiểm phạm vi của Build 4.6 (17/11/2026). Phần cảnh báo lệch tồn kho dùng kênh cảnh báo của 4.6-b; phần quét Đơn `pending` độc lập.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6-c (`spec-4-6-c-luoi-an-toan-dinh-ky.md`). Bằng chứng: `ordering/safety-net-jobs.ts:66` (`sweepOverdueOrders`).
- source_spec: none
  summary: Story 4.6-d "Dead-letter ở `/admin`". Quản trị Tingee xem danh sách job lỗi trong dead-letter queue của pg-boss và requeue từng job; mọi thao tác ghi audit (AD-12). Route mới `/v1/admin/*` đi qua bộ test cách ly.
  evidence: Mason chọn tách ở bước kiểm phạm vi của Build 4.6 (17/11/2026). Độc lập với 4.6-a/b/c, làm lúc nào cũng được.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6-d (`spec-4-6-d-dead-letter-o-admin.md`). Bằng chứng: `admin/dead-letter.controller.ts:22`.

## Deferred from: code review of spec-4-6-a-nen-quan-sat.md (2026-11-17)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-a-nen-quan-sat.md`
  summary: Thêm test cho nhánh `startTelemetryIfConfigured` của `apps/api/src/main.ts` khi khởi SDK OpenTelemetry lỗi: phải log đúng một dòng `warn` "Không bật được OpenTelemetry" (không message), rồi vai api/worker vẫn khởi động và phục vụ request. Hiện chưa test nào làm `startTelemetry` ném, nên bỏ try/catch thì api sập lúc khởi mà không test nào fail.
  evidence: Review 4.6-a (VG), maybe-false; nếu nhánh hỏng thì là medium (chưa kiểm). Muốn kiểm cần một chỗ tiêm lỗi vào `dist/main.js`, vd. biến env chỉ dùng cho test làm `sdk.ts` ném, hoặc chạy một bản Node không có `module.registerHooks`.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu test nhánh `startTelemetry` ném lỗi.

## Deferred from: build of spec-4-6-b-canh-bao-van-hanh.md (2026-11-17)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-b-canh-bao-van-hanh.md`
  summary: Story 4.6-e "Luật cảnh báo nghiệp vụ". Thêm 4 luật NFR-10 trên kênh `platform/alerts` của 4.6-b, với ngưỡng là env có mặc định (Mason duyệt 17/11/2026). (1) `ipn_failures` ở api: từ `OPS_ALERT_IPN_FAILURES` (5) lần IPN trả 401 vì chữ ký, 400 vì chữ ký đúng nhưng body hỏng (E3-3), hoặc 5xx trong 5 phút, đếm trong tiến trình và nêu số lần theo lý do; `ipnKey` lạ (404) không đếm. (2) `payment_link_slow` ở api: p95 thời lượng `create_link` (mọi outcome, nạp tại `tingee.client.ts` cạnh histogram) trong 5 phút vượt `OPS_ALERT_LINK_P95_MS` (2000), khi có từ `OPS_ALERT_LINK_MIN_SAMPLES` (20) lần gọi. (3) `ticket_issuance_drop` ở worker: nhóm Đơn có `payment_link_attempt_at` trong (now−75 phút, now−15 phút] có từ `OPS_ALERT_ISSUANCE_MIN_ORDERS` (10) Đơn, mà tỉ lệ có `paid_source` dưới `OPS_ALERT_ISSUANCE_RATIO` (0,5) lần tỉ lệ của 7 ngày trước; 7 ngày trước không có Đơn thì bỏ qua. (4) `pending_order_overdue` ở worker: Đơn `pending` quá mốc hết hạn hiện có (không link: `expires_at`; có link: `expires_at` + 300 giây) thêm `OPS_ALERT_PENDING_GRACE_MINUTES` (5); báo một lần cho mỗi mã Đơn, mỗi email tối đa 20 mã. Luật (3) và (4) do `ordering` đăng ký vào registry quét của platform. Thêm partial index `orders (expires_at) WHERE status = 'pending'` và `orders (payment_link_attempt_at) WHERE payment_link_attempt_at IS NOT NULL`. Cửa sổ đếm của api nằm trong bộ nhớ, mỗi instance đếm riêng; chống lặp `cooldown` cho (1)–(3).
  evidence: Mason chọn tách ở bước kiểm phạm vi của Build 4.6-b (17/11/2026): spec đầy đủ khoảng 3.500 token. Cùng ngày Mason chốt luật nằm trong app, kênh email và bộ ngưỡng trên. 4.6-b giữ kênh, ba marker có sẵn và hai luật pg-boss; 4.6-e dựng trên kênh đó.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6-e (`spec-4-6-e-luat-canh-bao-nghiep-vu.md`). Bằng chứng: `platform/alerts/kinds.ts:37-47` (`ipn_failures`, `payment_link_slow`, `ticket_issuance_drop`).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-b-canh-bao-van-hanh.md`
  summary: Cảnh báo giữ chỗ hàng loạt bằng nhiều tài khoản (epic-4-context, mục 4.6: "4.6 nhận phần cảnh báo; 5.8 đo"). Làm sau khi chốt cách chặn: trần số Vé đang giữ (theo `ip_hmac` hoặc theo Sự kiện), hay chỉ tạo link khi Người mua bấm "Thanh toán". Luật có thể dùng tỉ lệ suất do Đơn `pending` giữ trên sức chứa của Sự kiện, hoặc số tài khoản giữ chỗ cùng Sự kiện từ một `ip_hmac` trong cửa sổ ngắn (`order_create_attempts`), và gửi qua kênh `platform/alerts`.
  evidence: Mason chọn hoãn ở Build 4.6-b (17/11/2026): luật cảnh báo phụ thuộc cách chặn, mà cách chặn chưa chốt (retro Epic 3, câu hỏi mở 5; ghi chú bảo mật `epic-3-retro-security-notes.local.md`).
- Story nhận (21/11/2026, E4-8): action item E4-6. Luật cảnh báo làm sau khi E4-6 chốt cách chặn.

## Deferred from: code review of spec-4-6-b-canh-bao-van-hanh.md (2026-11-17)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-b-canh-bao-van-hanh.md`
  summary: Cảnh báo job hết retry ở queue không có dead-letter. `event.revalidate-public-page` (retry 3, không có dead-letter) và các queue cron (`organizer.probe-payment-service`, `organizer.token-alert-scan`, `identity.purge-expired`, `platform.ops-alert-scan`) kết thúc ở `failed` mà không ai biết. Hai luật pg-boss của 4.6-b chỉ xét job chờ quá hạn và job trong `*.dead-letter`. Hướng sửa: thêm một luật vào registry `OpsAlertRules` báo job `failed` của queue không khai dead-letter (`pgboss.queue.dead_letter IS NULL`), chống lặp `once` theo id job, hoặc `cooldown` theo queue cho các queue cron. Gộp được với việc "báo khi `identity.purge-expired` lỗi hay ngừng chạy" của 4.7.
  evidence: Review 4.6-b (ECH). Có từ trước 4.6-b: các queue này vốn không khai dead-letter (`event/public-page-jobs.ts:29`, `organizer/payment-service.ts:568`, `organizer/token-alert-jobs.ts:138`, `identity/identity-janitor.ts:57`). Revalidate lỗi thì trang Sự kiện cũ thêm tối đa 30 giây (cache); cron lỗi thì lượt kế chạy lại. Nên mức độ thấp, nhưng job lỗi lặp lại liên tục thì không ai biết.
- Story nhận (21/11/2026, E4-8): action item E4-10 (`defineCronQueue` chung kèm dead-letter). Gồm cả `event.revalidate-public-page`.

## Deferred from: build of spec-4-6-c-luoi-an-toan-dinh-ky.md (2026-11-17)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-c-luoi-an-toan-dinh-ky.md`
  summary: Thu hẹp Story 4.6-e (mục "Luật cảnh báo nghiệp vụ" ở phần build của spec 4.6-b): bỏ luật (4) `pending_order_overdue` và partial index `orders (expires_at) WHERE status = 'pending'`, vì 4.6-c đã làm cả hai. Lưới an toàn `ordering.safety-sweep` (mỗi phút) cho hết hạn Đơn `pending` đã quá mốc hết hạn thêm 120 giây mà job hoãn bỏ sót, rồi `raise` loại `pending_order_overdue` (chống lặp `once` theo mã Đơn, details `{ orders: n }`); index là `orders_pending_expires_at_idx` (migration `0029`). 4.6-e còn luật (1)–(3); không cần `OPS_ALERT_PENDING_GRACE_MINUTES`; partial index `orders (payment_link_attempt_at)` vẫn thuộc luật (3) của 4.6-e.
  evidence: Mason chốt 17/11/2026, phương án (a) trong spec 4.6-c (mục "Báo vận hành"). `ordering/safety-net-jobs.ts` › `sweepOverdueOrders`, `platform/alerts/kinds.ts` (`PENDING_ORDER_OVERDUE`), `apps/api/drizzle/0029_pending_expires_at.sql`.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6-c. Bằng chứng: `platform/alerts/kinds.ts:27` (`pending_order_overdue`).

## Deferred from: code review of spec-4-6-c-luoi-an-toan-dinh-ky.md (2026-11-17)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-c-luoi-an-toan-dinh-ky.md`
  summary: Thêm test cho snapshot `REPEATABLE READ READ ONLY` của `checkInventory` (`apps/api/src/modules/ordering/safety-net-jobs.ts`): một Đơn được tạo, bán hoặc hết hạn và commit vào giữa các câu đọc tồn kho, tổng `pending` và số Vé đã phát thì không được báo `inventory_drift` giả.
  evidence: Review 4.6-c (VG), regression gap: bỏ `CHECK_TRANSACTION`, hoặc truyền `db` thay `tx` cho `issuedTicketCountsByType`, thì mọi test vẫn pass, vì không test nào ghi xen giữa các câu đọc. Muốn test tất định thì cần điểm chèn (hook giữa hai câu đọc). Test tải song song thì sẽ chập chờn.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu test snapshot (cần điểm chèn giữa các câu đọc).

## Deferred from: code review of spec-4-6-e-luat-canh-bao-nghiep-vu.md (2026-11-17)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-e-luat-canh-bao-nghiep-vu.md`
  summary: Cảnh báo `create-link` lỗi nhanh. Tingee từ chối `create-link` bằng mã thường thì `release()` (`ordering/payment-link.ts:286-292`) trả lượt về `NULL`, nên Đơn rời khung của `ticket_issuance_drop`; lỗi trả nhanh nên p95 vẫn thấp; không có link thì không có IPN. Một sự cố Tingee trả lỗi nhanh không bị luật nào trong ba luật của 4.6-e bắt. Hướng làm: tỉ lệ `outcome` khác `ok` của `create_link` trong 5 phút, dùng chung nguồn `onPaymentLinkDuration`.
  evidence: Review 4.6-e (BH), medium. Có từ trước 4.6-e: NFR-10 không liệt kê điều kiện này; ba luật mới không xét `outcome`.
- Story nhận (21/11/2026, E4-8): action item E3-3. Cần mã lỗi thật của Tingee để đặt ngưỡng.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-6-e-luat-canh-bao-nghiep-vu.md`
  summary: Thứ tự deploy cho loại cảnh báo mới (4.7). api của bản mới raise `ipn_failures`/`payment_link_slow`; nếu worker còn bản cũ thì `OpsAlertPayload` (enum `kind`) từ chối job, job vào `platform.ops-alert.dead-letter`, mà dấu chống lặp đã ghi nên loại đó im một cooldown. Checklist deploy của 4.7 phải đổi worker trước api khi thêm loại cảnh báo (hoặc thêm job), hoặc cho đường gửi nhận `kind` lạ.
  evidence: Review 4.6-e (ECH). Mối nguy chung của payload job khi rolling deploy; chưa có production nên chưa xảy ra.
- Story nhận (21/11/2026, E4-8): 9.1. Đổi worker trước api thuộc checklist deploy.

## Deferred from: build of spec-4-8-a-ha-tang-va-api-anh-su-kien.md (2026-11-18)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Story 4.8-b "Ảnh Sự kiện trên web". Ô chọn ảnh (`components/tickee/event-image-picker.tsx`) ở wizard bước 1 "Thông tin" và Cài đặt Sự kiện: kiểm JPEG/PNG/WebP ≤ 5 MB tại chỗ, upload ngay khi chọn file (presign 4.8-a rồi PUT thẳng lên storage, không credentials), preview, đổi ảnh và nút "Gỡ ảnh" (lưu `imageKey: null`); upload lỗi giữ dữ liệu đã nhập kèm "Thử lại"; đang upload thì nút lưu bận; Sự kiện `cancelled` thì ô ảnh chỉ đọc; web luôn gửi `imageKey`, kể cả `null`. `event-card` trên dashboard (`organization-home.tsx`) có thumbnail 56px `object-cover`; `event-hero` dùng `<img>` thay gradient; ảnh tải lỗi thì về giao diện không ảnh. Ảnh OG (`opengraph-image.tsx`): ảnh phủ cả khung 1200×630 (fetch timeout 3 giây, `sharp` resize cover sang JPEG vì Satori không đọc WebP), lớp tối phía dưới, giữ chữ tên, ngày giờ, BTC như hiện tại; không có ảnh hoặc lỗi thì giữ gradient. E2E giả storage bằng `page.route` theo host (`OPTIONS` 204 kèm CORS, `PUT` kiểm `content-type` và `postDataBuffer()`); `e2e/public-event-api.ts` phục vụ thêm byte ảnh cho OG.
  evidence: Mason chọn tách API / Web ở bước kiểm phạm vi của Build 4.8 (18/11/2026): spec đầy đủ khoảng 3.700 token. Cùng lúc Mason chốt: có nút "Gỡ ảnh"; ảnh OG phủ khung kèm chữ; thumbnail chỉ ở dashboard. 4.8-a giữ hạ tầng, API presign, cột `image_key` và `imageUrl` trong contract; 4.8-b dựng trên đó.
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-4-8-b-anh-su-kien-tren-web.md`. Bằng chứng: `apps/web/components/tickee/event-image-picker.tsx`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Thumbnail ảnh Sự kiện ở "Vé của tôi" (`components/tickee/ticket-row.tsx`). DESIGN.md › `event-card` nói card dùng cả ở lịch sử "Vé của tôi"; cần thêm `imageUrl` vào contract và read model Vé của Người mua (`ticketing`).
  evidence: Mason chọn chỉ làm thumbnail ở dashboard trong Story 4.8 (18/11/2026); AC 4.8 chỉ nêu `event-card` của dashboard.
- Story nhận (21/11/2026, E4-8): 8.1. Social ticket card cần ảnh Sự kiện trong read model Vé của Người mua.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Dọn object ảnh Sự kiện cũ và mồ côi. Đổi hoặc gỡ ảnh chỉ đổi `events.image_key`, không xóa object cũ; presign mà không lưu Sự kiện (bỏ wizard, upload lỗi giữa chừng, Sự kiện không bao giờ tạo) để lại object không dòng nào trỏ tới. Cần job dọn theo tiền tố `orgs/{orgId}/events/` (so với `image_key` còn dùng, chừa object mới hơn hạn presign) hoặc lifecycle rule của bucket.
  evidence: Spec 4.8-a › Never: "Không xóa object cũ hay object mồ côi."
- Story nhận (21/11/2026, E4-8): 9.1. Lifecycle rule hoặc job dọn đi cùng bucket thật.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Resize và CDN cho ảnh Sự kiện (NFR-1). Ảnh tới 5 MB được phục vụ nguyên bản từ bucket cho `event-card`, `event-hero` và ảnh OG; trang công khai trên 4G có thể chậm. Cần biến thể theo kích thước (resize khi upload xong hoặc qua image proxy) và CDN trước `S3_PUBLIC_BASE_URL`.
  evidence: 4.8-a chỉ kiểm loại và dung lượng khi presign; api không đọc byte ảnh.
- Story nhận (21/11/2026, E4-8): 9.2 đo tốc độ tải ảnh; resize để sau MVP.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Object storage ở staging/production (4.7). Tạo bucket ảnh; chỉ cho đọc ẩn danh từng object (`s3:GetObject` trên `<bucket>/*`), không cho `s3:ListBucket` ẩn danh (key có uuid nên ảnh Sự kiện nháp không đoán được; `mc anonymous set download` mở cả ListBucket nên local dùng policy JSON riêng); CORS `GET` và `PUT` chỉ cho origin web; credential của api chỉ có `PutObject` trên bucket; đặt đủ `S3_*` trong secret store (api dừng nếu thiếu).
  evidence: Spec 4.8-a › Never: "Không cấu hình bucket staging/production (Story 4.7)."
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Chọn nhà cung cấp object storage theo NĐ 53/2022 (lưu dữ liệu tại Việt Nam), cùng đợt chốt nhà cung cấp hạ tầng, email và giám sát trước Closed Beta. Code chỉ dùng API S3 chuẩn (AD-22) nên đổi nhà cung cấp chỉ đổi `S3_*`.
  evidence: Epic 4 › Phụ thuộc ngoài: nhà cung cấp hạ tầng chờ pháp chế (NĐ 53/2022).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Image MinIO cho local. `minio/minio` và `minio/mc` trên Docker Hub (và quay.io) không còn kéo được; `docker-compose.yml` ghim bản fork cộng đồng `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` và `pgsty/mc:RELEASE.2026-10-26T00-00-00Z`. Đã chạy được và qua kiểm tay của spec (presign, PUT, PUT sai số byte/loại bị 403, đọc ẩn danh, không liệt kê được, CORS). Còn lại: chốt có giữ fork này lâu dài không (nguồn bên thứ ba), hoặc đổi sang image S3 khác chạy được `mc` mà giữ nguyên `S3_*`.
  evidence: Build 4.8-a (18/11/2026): `docker manifest inspect minio/minio:…` → "requested access to the resource is denied"; quay.io/minio yêu cầu đăng nhập. Mason tự kéo image fork và chạy `docker compose up -d --wait`; kiểm tay 8/8 pass.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): image fork chỉ dùng ở local và đã ghim tag.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: E2-8. Test api `test/organizer/members.test.ts:434` › "Admin gọi mọi API thành viên → 403 FORBIDDEN_ROLE" chập chờn: một trong 5 request song song bằng cùng cookie Admin trả `401 UNAUTHENTICATED` thay vì `403`. Nghi đua khi Better Auth làm mới session trong lúc nhiều request dùng chung cookie, khi DB chậm lúc chạy cả bộ test.
  evidence: Kiểm chứng 4.8-a (18/11/2026): fail 1 lần trong lượt chạy toàn bộ test api (1459/1460 pass); chạy riêng file 3 lần đều pass; lượt chạy toàn bộ trước đó của cùng nhánh cũng pass. Diff 4.8-a không chạm identity hay members. Chưa chạy lặp trên baseline.

## Deferred from: code review of spec-4-8-a-ha-tang-va-api-anh-su-kien.md (2026-11-18)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Giới hạn presign ảnh Sự kiện, BẮT BUỘC trước khi tạo bucket production (4.7). `POST /v1/orgs/:orgId/event-images` chưa giới hạn tốc độ hay hạn mức, và không ghi ai xin key nào. Ai có tài khoản cũng tạo được BTC (`POST /v1/orgs` không cần duyệt) rồi xin vô hạn URL upload 5 MB vào bucket đọc công khai: thành nơi chứa file miễn phí dưới tên miền Tickee, chi phí tăng, không truy được người tải. Hướng làm: đếm theo BTC (và theo tài khoản) trong Postgres theo mẫu `ordering/order-rate-limit.ts`, vượt thì 429; log info `userId`, `organizationId`, `key` mỗi lần presign; cân nhắc chỉ cho BTC đã duyệt Closed Beta. Đi cùng mục dọn object cũ và mồ côi.
  evidence: Review 4.8-a (ECH, BH), medium, intent_gap. Mason chọn hoãn và chặn trước 4.7 (18/11/2026): hiện chỉ có MinIO local, chưa có bucket thật.
- Đã xử lý (19/11/2026): mục ngay trên (giới hạn presign ảnh Sự kiện) được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-d-gioi-han-presign-anh-su-kien.md`. `EventImagePresignLimiter` đếm mỗi lần cấp URL thành công ở bảng `event_image_presigns` (migration `0032`): 50 lần mỗi BTC và 100 lần mỗi tài khoản (gộp mọi BTC) trong 24 giờ trượt (`EVENT_IMAGE_PRESIGN_LIMITS` trong contracts), khóa advisory tài khoản rồi BTC nên request song song không lọt quá trần; vượt thì `429 EVENT_IMAGE_RATE_LIMITED` kèm `retryAfterSeconds` theo giới hạn chặn lâu nhất, log `warn` marker `event_image_presign_limited`. Mỗi lần cấp log `info` `userId`, `organizationId`, `key`. Mỗi lần presign xóa một lô (tối đa 500) dòng đã ra khỏi cửa sổ của mọi tài khoản và BTC (`FOR UPDATE SKIP LOCKED`). Ô ảnh trên web báo "Bạn đã tải quá nhiều ảnh. Thử lại sau {n} phút." (từ 60 phút trở lên thì "{n} giờ") kèm "Thử lại". Không đòi BTC đã duyệt Closed Beta (Mason, 19/11/2026: BTC chưa duyệt vẫn mở bán Sự kiện miễn phí). Mục dọn object cũ và mồ côi vẫn mở.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-a-ha-tang-va-api-anh-su-kien.md`
  summary: Thứ tự deploy api trước web khi contract thêm trường bắt buộc vào response (4.7). 4.8-a thêm `imageUrl` bắt buộc vào `EventSummary`, `EventDetail`, `PublicEvent` (và `imageKey` vào `EventDetail`); web kiểm mọi response bằng schema contract, nên web mới gặp api cũ thì dashboard, Cài đặt và `/e/{slug}` lỗi parse. Checklist deploy của 4.7 phải đổi api trước web, hoặc trường mới phía đọc dùng `.default(null)` trong thời gian rollout.
  evidence: Review 4.8-a (ECH, BH), medium. Mối nguy chung của rolling deploy, cùng loại mục thứ tự worker/api của 4.6-e; chưa có production nên chưa xảy ra.
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.

## Deferred from: code review of spec-4-8-b-anh-su-kien-tren-web.md (2026-11-18)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-b-anh-su-kien-tren-web.md`
  summary: Preview link đã chia sẻ giữ ảnh, tên và giờ cũ sau khi BTC sửa. URL `og:image` của `/e/{slug}` (`/opengraph-image-<hash>?<hash>`, file-based metadata) không đổi theo nội dung, mà Facebook/Zalo cache ảnh theo URL; đổi hoặc gỡ ảnh bìa (4.8-b), đổi tên hay giờ (2.11-b, 3.10) đều chỉ hiện ở preview mới khi nền tảng quét lại. Hướng làm: `generateMetadata` đặt `openGraph.images` kèm phiên bản (vd. `?v=` băm của `imageKey`, `name`, `startsAt`), hoặc ghi rõ cách nhờ quét lại (Facebook Sharing Debugger).
  evidence: Review 4.8-b (BH), medium. URL `og:image` cố định có từ 2.11-b; 4.8-b làm vấn đề dễ thấy hơn vì ảnh là phần nổi nhất của preview.
- Story nhận (21/11/2026, E4-8): action item E4-4. Cùng phần cache ảnh OG của E4-4.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-8-b-anh-su-kien-tren-web.md`
  summary: E2E cho gửi lại upload ảnh sau xác thực hai lớp: presign trả `TOTP_REQUIRED` một lần → không hiện "Chưa tải được ảnh.", hộp xác thực mở, nhập mã xong upload tự gửi lại và lưu Sự kiện gửi key mới. Chặn hồi quy khi chuyển `onSuccess`/`onError` của mutation upload vào `mutate(vars, {...})` (đường gửi lại của `Providers` không tới được) hoặc bỏ kiểm `handledElsewhere`.
  evidence: Review 4.8-b (VG), medium. Cần mất step-up giữa phiên; đường gửi lại chung của `Providers` đã có test ở `members.spec.ts:190`.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu e2e gửi lại upload sau `TOTP_REQUIRED`.

## Deferred from: tách phạm vi Story 4.7 khi build (2026-11-18)

Phần code của 4.7 không cần chọn nhà cung cấp hạ tầng được tách thành nhiều story con; 4.7-a làm giới hạn IP `/v1/admin/*` (`spec-4-7-a-gioi-han-ip-admin.md`). `/readyz` (DB + `LISTEN`), tắt êm khi `SIGTERM` (đóng SSE, `boss.stop` graceful) và `TRUST_PROXY_HOPS` đã có sẵn từ Epic 1–3, có test.

- source_spec: none
  summary: Story 4.7 con — siết cấu hình production lúc khởi động: `API_PUBLIC_URL` và `WEB_ORIGIN` bắt buộc `https`, chặn secret/placeholder mẫu của `.env.example` (gồm `BETTER_AUTH_SECRET`, Google, `TINGEE_CREDENTIAL_KEYS`, `TICKET_QR_KEYS`), `AUTH_COOKIE_DOMAIN` là miền cha của cả hai origin, `TICKET_QR_KEYS` khác `TINGEE_CREDENTIAL_KEYS`.
  evidence: Mục tiêu giao riêng được, tách khỏi 4.7-a theo quyết định của Mason (18/11/2026). Gom các mục checklist cấu hình production đã có trong file này (retro Epic 1 AI-3, review 3.3 triage #9).
- Đã xử lý (18/11/2026): story con ngay trên được làm bằng `_bmad-output/implementation-artifacts/spec-4-7-b-siet-cau-hinh-production.md`: `NODE_ENV` bắt buộc ở mọi vai, luật https, giá trị mẫu và khóa trùng cho api và worker, luật miền cookie cho api. Lỗi đi qua `ConfigError`, nêu đủ mọi biến trong một lượt, không nêu giá trị. CI bước Migrate đặt `NODE_ENV: test`; README có mục "Cấu hình staging/production".
- source_spec: none
  summary: Story 4.7 con — giới hạn presign ảnh Sự kiện (`POST /v1/orgs/:orgId/event-images`) theo BTC và theo tài khoản, vượt thì 429, log `userId`/`organizationId`/`key`; bắt buộc trước khi tạo bucket production.
  evidence: Mục tiêu giao riêng được, tách khỏi 4.7-a theo quyết định của Mason (18/11/2026). Chi tiết ở mục review 4.8-a trong file này.
- Đã xử lý (19/11/2026): story con ngay trên được làm bằng `_bmad-output/implementation-artifacts/spec-4-7-d-gioi-han-presign-anh-su-kien.md` (50 lần mỗi BTC, 100 lần mỗi tài khoản trong 24 giờ trượt; `429 EVENT_IMAGE_RATE_LIMITED`; log `info` mỗi lần cấp). Chi tiết ở mục review 4.8-a trong file này.
- source_spec: none
  summary: Story 4.7 con — CI chạy e2e full-stack: Playwright với api thật, Tingee fake, Mailpit và bộ test cách ly trong pipeline (AC 4.7, action item AI-6 của retro Epic 1).
  evidence: Mục tiêu giao riêng được, tách khỏi 4.7-a theo quyết định của Mason (18/11/2026). Hiện e2e web giả lập API bằng `page.route` (`.github/workflows/ci.yml`).
- Đã xử lý (19/11/2026): story con ngay trên được làm bằng `_bmad-output/implementation-artifacts/spec-4-7-c-ci-e2e-full-stack.md`: bước "Playwright full-stack" trong job `ci` (service Mailpit; khi lỗi upload kết quả, trace và log api/worker/Tingee fake), luồng đăng nhập OTP của AI-6 và luồng Đơn có phí trên hai project. Bộ test cách ly (`apps/api/test/organizer/isolation.test.ts`) vẫn chạy trong bước Vitest. Staging tự deploy chưa có (ngoài phạm vi).
- source_spec: none
  summary: Story 4.7 con — vai `migrate` chỉ chạy một lần mỗi lượt deploy (advisory lock trong migrate) để hai tiến trình migrate không chạy cùng lúc.
  evidence: Mục tiêu giao riêng được, tách khỏi 4.7-a theo quyết định của Mason (18/11/2026). Triage 1.1 #11, đã ghi ở checklist Story 4.7 trong file này.
- Đã xử lý (19/11/2026): story con ngay trên được làm bằng `_bmad-output/implementation-artifacts/spec-4-7-e-khoa-migrate-mot-lan.md`.
  - Khóa: `withMigrationLock` (`apps/api/src/platform/db/migration-lock.ts`) giữ khóa advisory cấp session `tickee:migrate` trên một kết nối riêng, bao trọn migration Drizzle, schema `pgboss` và cấp quyền. Kết nối này có `application_name` `tickee-migrate-lock`, bỏ `statement_timeout`/`lock_timeout`/`idle_session_timeout`, và bật keepalive phía client lẫn phía server.
  - Hành vi: lượt thứ hai log `info` marker `migrate_lock_wait` rồi chờ, không giới hạn thời gian. Mất kết nối giữ khóa giữa chừng thì log `error` marker `migrate_lock_lost` ngay, và lượt đó báo lỗi khi xong. Nhả khóa trả `false` (pooler chế độ transaction) cũng báo lỗi.
  - Bằng chứng: trước khi sửa, ba `runMigrations` song song làm một lượt lỗi `tuple concurrently updated`. Test ở `apps/api/test/migrate-lock.test.ts`.

## Deferred from: code review of spec-4-7-a-gioi-han-ip-admin.md (2026-11-18)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-a-gioi-han-ip-admin.md`
  summary: Chạy api mà không đặt `NODE_ENV` thì mặc định `development`, nên `ADMIN_ALLOWED_CIDRS` không bắt buộc và `/v1/admin/*` không giới hạn IP (chỉ có log `warn` lúc khởi động). Nên làm cùng story con "siết cấu hình production" của 4.7: bắt buộc đặt `NODE_ENV` tường minh ở môi trường deploy, hoặc chỉ cho chế độ không giới hạn khi env ghi rõ `development`/`test`.
  evidence: Review 4.7-a (BH), medium. `common.NODE_ENV` mặc định `development` có từ Story 1.1; `apps/api/Dockerfile` đặt `NODE_ENV=production` nên image chuẩn không dính, chỉ cách chạy ngoài image (VM, `node dist/main.js`, buildpack) mới dính.
- Đã xử lý (18/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-b-siet-cau-hinh-production.md`. `common.NODE_ENV` không còn mặc định: thiếu hoặc rỗng thì cả ba vai dừng với `NODE_ENV (thiếu)`, nên chạy ngoài image mà quên đặt biến thì api không lên, thay vì tắt giới hạn IP `/v1/admin/*` trong im lặng.

## Deferred from: review spec-4-7-b-siet-cau-hinh-production (2026-11-18)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-b-siet-cau-hinh-production.md`
  summary: Phía web của checklist cấu hình production: `apps/web/app/api/revalidate/route.ts` nhận mọi `REVALIDATE_SECRET` khác rỗng, kể cả giá trị mẫu của `.env.example` hay chuỗi ngắn; `apps/web/lib/build-env.ts` cho build production với `NEXT_PUBLIC_API_BASE_URL` là `http://`. Nên làm cùng mục `WEB_ORIGIN`/`metadataBase` của web (Story 4.7).
  evidence: Review 4.7-b (BH) triage #10, low. Có sẵn từ 2.11-c và 1.2; intent của 4.7-b loại phía web. Worker giờ từ chối giá trị mẫu nên web dùng giá trị mẫu thì revalidate của worker hỏng (trang chỉ tự làm mới sau 30 giây), và ai biết giá trị mẫu cũng gọi được revalidate.
- Đã xử lý (19/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-f-cau-hinh-production-web.md`. `next build` dừng khi `NEXT_PUBLIC_API_BASE_URL` trỏ host không phải local mà không phải https (`InvalidBuildEnvError`). Web chạy thật mà `REVALIDATE_SECRET` thiếu, ngắn hơn 32 ký tự hay là giá trị mẫu thì server web không khởi động, và route `/api/revalidate` trả 503. Luật nằm ở `apps/web/lib/production-env.ts`; local và e2e (mọi origin ở localhost) giữ hành vi cũ.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-b-siet-cau-hinh-production.md`
  summary: Env runtime đặt tường minh `NODE_ENV=development` (env file hay secret store chép từ `.env.example`) đè `ENV NODE_ENV=production` của image, nên mọi luật production (https, giá trị mẫu, `ADMIN_ALLOWED_CIDRS`, cookie) tắt mà không có lỗi. Hướng sửa: README/`.env.example` dặn không chép `NODE_ENV` lên môi trường thật, và api/worker log `warn` (hoặc từ chối) khi `NODE_ENV` khác `production` mà `API_PUBLIC_URL`/`WEB_ORIGIN` là https trên host không phải local.
  evidence: Review 4.7-b (BH, VG) triage #11–12, medium. Có từ trước 4.7-b: 4.7-b chỉ xử lý thiếu `NODE_ENV`, không xử lý giá trị sai. Luật phát hiện cấu hình "trông như production" chưa có trong intent.
- Đã xử lý (19/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-f-cau-hinh-production-web.md`. README và `.env.example` dặn không chép `NODE_ENV=development` lên môi trường thật. Vai api và worker log `warn` marker `node_env_not_production` kèm tên biến (không giá trị) khi `NODE_ENV` khác `production` mà `API_PUBLIC_URL` hoặc `WEB_ORIGIN` là https trên host không phải local (`productionLookingOrigins` ở `platform/config/production-rules.ts`). Chỉ cảnh báo, không chặn khởi động.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-b-siet-cau-hinh-production.md`
  summary: CI chưa kiểm image chạy vai api/worker ở `NODE_ENV=production` thật: đổi `ENV NODE_ENV` trong `apps/api/Dockerfile` thì mọi test vẫn xanh (test tiến trình tự đặt `NODE_ENV`; bước chạy image chỉ dùng vai migrate). Thêm bước chạy image vai worker với `WEB_ORIGIN` http, chờ exit 1 và tên biến trong output; làm cùng story con CI e2e full-stack của 4.7.
  evidence: Review 4.7-b (VG) triage #24, medium. Gap đã kiểm: chỉ có `.github/workflows/ci.yml` bước "Chạy image (APP_ROLE=migrate)"; sau 4.7-b, xóa dòng `ENV` sẽ làm bước đó đỏ (`NODE_ENV (thiếu)`) nhưng đổi giá trị thì không.
- Đã xử lý (19/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-c-ci-e2e-full-stack.md`. CI có bước "Chạy image vai worker ở production (WEB_ORIGIN http bị từ chối)": image không đặt `NODE_ENV`, mọi biến hợp lệ (secret sinh ngẫu nhiên mỗi lượt) trừ `WEB_ORIGIN=http://example.test`; bước đòi thoát mã 1, output có `"variable":"WEB_ORIGIN"` và không chứa giá trị secret nào. Đổi `ENV NODE_ENV` của `apps/api/Dockerfile` thì bước này đỏ.

## Deferred from: code review of spec-4-7-d-gioi-han-presign-anh-su-kien.md (2026-11-19)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-d-gioi-han-presign-anh-su-kien.md`
  summary: Một tài khoản dội nhiều request cùng lúc vào route có khóa advisory chặn (`EventImagePresignLimiter` khóa theo tài khoản rồi BTC, `OrderRateLimiter` khóa theo tài khoản): các transaction chạy tuần tự, nhưng mỗi request đang chờ khóa vẫn giữ một kết nối pool (`max` 10, `platform/db/database.ts:28`), nên request của người khác phải chờ pool. Hướng làm: chọn chung cho cả hai limiter giữa `pg_try_advisory_xact_lock` (không lấy được khóa thì trả `429` ngay; request song song hợp lệ cũng có thể bị `429`) và `SET LOCAL lock_timeout`, hoặc giới hạn tốc độ ở edge trong checklist production của 4.7; đo trong kiểm thử tải 5.8.
  evidence: Review 4.7-d (EC) triage #12, medium. Thiết kế khóa chặn chép từ `ordering/order-rate-limit.ts` theo intent đóng băng của 4.7-d; chỉ sửa một limiter thì hai route lệch nhau, còn đổi sang try-lock là đổi hành vi của dòng "Song song" trong I/O Matrix.
- Story nhận (21/11/2026, E4-8): 9.1 (giới hạn tốc độ ở edge) và 9.2 (đo).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-d-gioi-han-presign-anh-su-kien.md`
  summary: E2-8. E2E `apps/web/e2e/public-event-revalidate.spec.ts:15` › "BTC đổi tên: trang vẫn trả bản cache cho tới khi gọi /api/revalidate…" chập chờn khi chạy cả bộ: sau `revalidate` trả 204 và `page.reload()`, tiêu đề vẫn là tên cũ quá 5 giây (android-chromium).
  evidence: Kiểm chứng 4.7-d (19/11/2026): fail 1 lần trong lượt chạy toàn bộ e2e giả lập (1117/1118); chạy riêng `--repeat-each=3` 6/6 pass; lượt chạy toàn bộ của agent triển khai cùng nhánh 1118/1118. Diff 4.7-d không chạm trang Sự kiện công khai hay revalidate.

## Deferred from: code review of spec-4-7-e-khoa-migrate-mot-lan.md (2026-11-19)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-e-khoa-migrate-mot-lan.md`
  summary: Ghi luật mới của vai `migrate` vào AD-36 của `ARCHITECTURE-SPINE.md`. Vai `migrate` giữ khóa advisory cấp session `tickee:migrate`. Lượt chạy song song chờ chứ không bỏ qua. `MIGRATION_DATABASE_URL` phải là kết nối thẳng hoặc qua pooler chế độ session. Khóa không sắp thứ tự deploy giữa hai phiên bản, nên pipeline phải chặn deploy chồng nhau.
  evidence: Review 4.7-e (BH) #15, low. Hiện AD-36 chỉ giả định pipeline chạy migrate một lần. Luật bước Classify của Build không cho sửa spec/spine trong lượt sửa review. Nên gom vào lần cập nhật spine kế tiếp của 4.7 (deploy staging/production).
- Đã xử lý (19/11/2026): ghi vào AD-36 của `ARCHITECTURE-SPINE.md` qua `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-19-tach-story-4-7.md`.

## Deferred from: code review of spec-ci-cai-playwright-khong-treo.md (2026-11-19)

- source_spec: `_bmad-output/implementation-artifacts/spec-ci-cai-playwright-khong-treo.md`
  summary: Bỏ `~/.cache/ms-playwright` khỏi cache Playwright của CI, chỉ giữ gói `.deb`. Tải Chromium và WebKit từ CDN của Playwright chỉ mất khoảng 15 giây, trong khi thư mục trình duyệt khoảng 870 MB giải nén, tốn quota cache 10 GB của repo. Hướng dẫn CI của Playwright cũng khuyên không cache trình duyệt.
  evidence: Review CI (BH) #7, low. Quyết định trong Intent của spec chốt giữ cache trình duyệt "cho tiện", nên không sửa trong lượt review; người dùng quyết.
- Story nhận (21/11/2026, E4-8): action item E2-8. Người dùng quyết giữ hay bỏ cache trình duyệt.
- source_spec: `_bmad-output/implementation-artifacts/spec-ci-cai-playwright-khong-treo.md`
  summary: Đo lại thời gian job `ci` sau khi bước cài Playwright dùng cache gói `.deb`, rồi cân nhắc hạ `timeout-minutes: 60` của job (trước đây 30 phút, nâng ngày 18/11 vì apt chậm).
  evidence: Review CI (BH) #10. Comment ở đầu job trong `ci.yml` giữ trần 60 phút "tới khi có số đo mới"; cần vài run trên `main` có cache trúng.
- Story nhận (21/11/2026, E4-8): action item E2-8. Đo vài run trên `main` rồi hạ timeout.

## Bàn giao sau khi tách Story 4.7 (Sprint Change Proposal 2026-11-19)

Từ 19/11/2026, Story 4.7 chỉ còn phần không cần nhà cung cấp hạ tầng (4.7-a đến 4.7-g). Phần hạ tầng sang Story 9.1, Story 5.8 đổi thành Story 9.2 (`_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-19-tach-story-4-7.md`). Các mục cũ trong file này giữ nguyên chữ; đọc theo luật sau:

- Mục ghi "Story 4.7" là checklist deploy hoặc hạ tầng → Story 9.1.
- Mục ghi "5.8" → Story 9.2.

**4.7-f nhận** (không cần nhà cung cấp):

- Cấu hình production phía web: `REVALIDATE_SECRET` mẫu hoặc ngắn, `NEXT_PUBLIC_API_BASE_URL` là `http://` (review 4.7-b triage #10).
- `WEB_ORIGIN` bắt buộc ở production thay vì rơi về localhost; font OG có trong image (review 2.11-b #2).
- Đã xử lý (21/11/2026, E4-8): phần `WEB_ORIGIN` của mục ngay trên đã làm ở Story 4.7-f. Bằng chứng: `apps/web/lib/production-env.ts:99-100`. Đã có AC 9.1 (E4-7), ghi 21/11/2026 (phần font OG).
- `NODE_ENV` đặt sai giá trị trên môi trường thật (review 4.7-b triage #11–12).

**4.7-g nhận:** kiểm lúc khởi động mọi `qr_key_version` còn dùng có trong `TICKET_QR_KEYS` (mục review E3-5 D1 #2, phần 4.7). Tách khỏi 4.7-f ngày 19/11/2026, xem mục ngay dưới.

**Story 9.1 nhận** (cần nhà cung cấp): luôn có ít nhất một `worker` và cảnh báo `identity.purge-expired` (retro Epic 1); cách chạy `admin-cli` trong image; biến origin công khai khi tách host; revalidate với nhiều instance web và `REVALIDATE_SECRET` chung cho worker và web; purge CDN cho `/e/*`; runbook xoay khóa QR (phần 2); edge HTTP/2 (C4 và 4.2-b); thứ tự deploy worker trước api khi thêm loại cảnh báo; api trước web khi contract thêm trường bắt buộc; bucket ảnh staging/production; giới hạn tốc độ ở edge cho route có khóa advisory (đo ở 9.2); chốt IPN `status` và `get-va-paging` khi `data` rỗng qua test hợp đồng UAT.
- Ghi thêm (21/11/2026, E4-8): cảnh báo `identity.purge-expired` chuyển sang action item E4-10 (`defineCronQueue` kèm dead-letter); chốt IPN `status` và `get-va-paging` khi `data` rỗng chuyển sang action item E3-3 (UAT Tingee thật). 9.1 vẫn nhận phần còn lại của đoạn trên.

## Deferred from: tách phạm vi Story 4.7-f khi build (2026-11-19)

- source_spec: none
  summary: Story 4.7-g — lúc khởi động, kiểm mọi `qr_key_version` còn dùng ở bảng `tickets` có trong `TICKET_QR_KEYS`; thiếu thì báo kèm marker `ticket_qr_key_missing`, chốt dừng hay chỉ cảnh báo khi lập spec (AC 4.7, AD-29, mục review E3-5 D1 #2 phần 4.7).
  evidence: Tách khỏi 4.7-f theo quyết định của Mason (19/11/2026): giao riêng được, cần truy vấn DB lúc khởi động và quyết định dừng hay cảnh báo. 4.7-f chỉ làm cấu hình production phía web và cảnh báo `NODE_ENV` sai giá trị. Xong 4.7-f và 4.7-g thì 4.7 `done`.
- Đã xử lý (20/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-4-7-g-kiem-khoa-qr-luc-khoi-dong.md`. Mason chốt chỉ cảnh báo (instance thiếu khóa vẫn khởi động), và "còn dùng" là Vé `valid` của Sự kiện chưa kết thúc, chưa hủy. Log `error` marker `ticket_qr_key_missing` kèm `OpsAlerts.raise` cho từng phiên bản thiếu, cả hai chiều (khóa cũ đã gỡ, instance chưa có khóa mới). README có mục "Xoay khóa Mã QR vé" (thêm khóa mới cho mọi instance trước, chỉ gỡ khóa cũ khi lần khởi động không còn báo, câu SQL tra phiên bản còn dùng). Runbook chọn phương án xoay khóa vẫn thuộc Story 9.1.

## Deferred from: code review of spec-4-7-f-cau-hinh-production-web.md (2026-11-20)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-f-cau-hinh-production-web.md`
  summary: Web: `REVALIDATE_SECRET` có khoảng trắng hoặc dòng mới ở hai đầu (secret tạo từ file) qua được kiểm lúc khởi động. Nhưng route `/api/revalidate` so `Bearer ${secret}` thô, trong khi header HTTP bị bỏ khoảng trắng hai đầu, nên mọi lần worker gọi đều 401 và trang chỉ tự làm mới sau 30 giây. Secret toàn khoảng trắng dài ≥ 32 ký tự cũng được nhận. Hướng sửa: `trim()` secret trước khi kiểm và so (cả `usableRevalidateSecret` lẫn `revalidateSecretReason`).
  evidence: Review 4.7-f (BH, EC) #8–9, low. Có từ 2.11-c (route khi đó cũng so giá trị thô); 4.7-f không làm tệ hơn. `fetch` bỏ khoảng trắng hai đầu giá trị header (`"Bearer abc\n"` gửi đi thành `"Bearer abc"`).
- Story nhận (21/11/2026, E4-8): action item E4-11. Thêm `trim()` cho secret ở `apps/web/lib/production-env.ts:121` và route revalidate.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-f-cau-hinh-production-web.md`
  summary: Story 9.1, lúc dựng image web (nếu dùng `output: 'standalone'`): kiểm rằng server standalone vẫn gọi `register()` của `apps/web/instrumentation.ts` và vẫn nhúng `NEXT_PUBLIC_API_BASE_URL` vào bundle server, bằng cách chạy test tiến trình `apps/web/test/start.process.test.ts` (hoặc một bước CI tương đương) trên image. README và comment của 4.7-f đang khẳng định điều này nhưng chưa kiểm.
  evidence: Review 4.7-f (BH) #16, maybe-false; nếu sai thì medium (cổng "web chạy thật" tắt). Repo chưa có image web nên chưa kiểm được. Cách chốt: test tiến trình trên image standalone ở 9.1.
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-f-cau-hinh-production-web.md`
  summary: Next 16.4.3: khi build 4.7-f, Next CLI dừng một lần với "SecurityFatalError" báo phiên bản có lỗ hổng đã biết, và gợi ý chạy `next upgrade --agent=security`. Chạy lại đúng lệnh cũ thì qua. Cần đối chiếu với advisory chính thức rồi quyết định có nâng `next` không; CI có thể gặp cùng lần dừng này.
  evidence: Review 4.7-f (BH) #17, maybe-false; nếu đúng thì có thể high. Mới chỉ thấy qua output CLI, chưa đối chiếu nguồn chính thức. Cách chốt: tra GitHub Security Advisories của `vercel/next.js` cho 16.4.3, hoặc chạy `pnpm audit --prod`.
- Đã xử lý (20/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-4-e4-4-nang-next-16-4-6.md`. Advisory có thật: GitHub Advisory Database ghi 7 mục medium cho `next@16.4.3`, vá từ 16.4.5. `apps/web` đã nâng lên 16.4.6, bản này không còn advisory nào.

## Deferred from: code review of spec-4-7-g-kiem-khoa-qr-luc-khoi-dong.md (2026-11-20)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-g-kiem-khoa-qr-luc-khoi-dong.md`
  summary: Kiểm lúc khởi động (4.7-g) chỉ so phiên bản khóa (`keys.has`). Nếu một instance có cùng phiên bản `v1` nhưng khác byte khóa (sinh lại, chép nhầm), thì mọi Mã QR vé và link chia sẻ trên instance đó đều hỏng mà lần kiểm vẫn sạch. Hướng làm: mỗi phiên bản còn dùng lấy mẫu một Vé có `share_token_hash`, so `hashShareToken(shareTokenOf(...))` với hash đã lưu. Không cần thêm cột.
  evidence: Review 4.7-g (BH) #4, medium. Loại sai cấu hình này khác với việc thiếu phiên bản mà intent của 4.7-g nhắm tới, và đã có từ trước. Nên gom vào runbook xoay khóa của Story 9.1.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-7-g-kiem-khoa-qr-luc-khoi-dong.md`
  summary: Nhánh `statement_timeout` 30 giây của `TicketQrKeyCheck` chưa có test: bỏ dòng `set_config('statement_timeout', …)` thì mọi test vẫn xanh, và một lần kiểm bị khóa chặn sẽ chờ mãi mà không log `warn`.
  evidence: Review 4.7-g (VG) #21, medium (regression gap đã kiểm). Test thật phải chờ hơn 30 giây, hoặc phải biến timeout thành tham số; spec cấm thêm biến env. Trần chờ khi tắt (vá ở #8) đã giới hạn được hậu quả khi shutdown.
- Story nhận (21/11/2026, E4-8): action item E4-11. Chỉ thiếu test nhánh `statement_timeout`.

## Deferred from: code review of spec-epic-4-e4-4-nang-next-16-4-6.md (2026-11-20)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-4-e4-4-nang-next-16-4-6.md`
  summary: Không có gì tự báo khi một phụ thuộc production dính advisory. CI không có bước `pnpm audit --prod`, repo không có Dependabot/Renovate. Lỗ hổng của Next 16.4.3 chỉ lộ ra vì Next CLI dừng khi chạy dưới agent; CI và người chạy tay không bị dừng. Cần chốt cách theo dõi: bước audit trong CI (chặn hay chỉ cảnh báo, ngưỡng mức độ), Dependabot security updates, hoặc lịch kiểm định kỳ.
  evidence: Review E4-4 (BH) #5, medium. `.github/workflows/ci.yml` không có bước audit; không có `.github/dependabot.yml`. Bước chặn có thể làm đỏ CI vì advisory ở gói không liên quan, nên cần Mason quyết chính sách trước khi thêm.
- Story nhận (21/11/2026, E4-8): action item E4-4. Mason chốt chính sách theo dõi advisory (bước audit CI, Dependabot) trước khi thêm.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-4-e4-4-nang-next-16-4-6.md`
  summary: Web không dùng `next/image`, nhưng endpoint tối ưu ảnh `/_next/image` vẫn bật mặc định (có `sharp`), thành bề mặt cho advisory về sau (như GHSA-7qx7-33qx-rqx2). Có thể đặt `images: { unoptimized: true }` trong `apps/web/next.config.ts`, rồi kiểm `/_next/image` trả 404.
  evidence: Review E4-4 (BH) #7, low (hardening, không phải lỗi). Advisory hiện tại đã vá ở 16.4.6. Nên xét cùng phần cache ảnh OG của E4-4 (trước Closed Beta) hoặc AC edge của 9.1.
- Story nhận (21/11/2026, E4-8): action item E4-4. Xét cùng phần cache ảnh OG.

## Deferred from: tách phạm vi E4-3 khi build (2026-11-20)

- source_spec: none
  summary: E4-3 phần B — single-flight theo `organizationId` và cooldown vài giây cho `GET /v1/orgs/:orgId/token` (`organizer/token.service.ts:124`), để Owner/Admin mở nhiều tab hay bấm "Tải lại" không ăn hết hạn mức 20 request/10 giây của key merchant, vốn cũng là key `create-link`; cập nhật `deferred-work.md:740` (retro Epic 4 D2).
  evidence: Mục tiêu giao riêng được, tách khỏi phần luật cấu hình của E4-3 theo quyết định của Mason (20/11/2026). E4-3 giữ `in-progress` tới khi phần này xong.
- Đã xử lý (20/11/2026): mục ngay trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-4-e4-3-b-gom-loi-goi-doc-token.md`. Gộp lời gọi theo BTC và credential (không chỉ `organizationId`, để đổi key có hiệu lực ngay) cùng cooldown 5 giây tính từ lúc lời gọi Tingee xong, chỉ trong bộ nhớ của từng tiến trình (api và worker mỗi bên một bản, xóa bằng timer khi hết hạn); `deferred-work.md` mục 4.5-a "Giới hạn số lời gọi Tingee" đã ghi "Đã xử lý". Phần A của E4-3 đã xong trước ở `spec-epic-4-e4-3-luat-cau-hinh-tingee-va-canh-bao.md`.
- source_spec: none
  summary: E4-10 phần test — test giả `Date` chứng minh chốt link và `checkoutUrl` (`payment-link.ts:157`) cùng `dbClock` của `markPaid` đi theo đồng hồ DB, theo mẫu `test/ordering/event-sale-status.test.ts:214`; đóng `deferred-work.md:630-631` (retro Epic 4 B5).
  evidence: Retro ghi "test cùng E4-3"; tách khỏi E4-3 theo quyết định của Mason (20/11/2026) vì là phần test độc lập, giao riêng được.

## Deferred from: code review of spec-epic-4-e4-3-b-gom-loi-goi-doc-token.md (2026-11-20)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-4-e4-3-b-gom-loi-goi-doc-token.md`
  summary: Câu "mỗi lần xem một lần đọc" (đọc Token trực tiếp từ Tingee mỗi lần xem, không lưu) đã cũ sau E4-3 phần B: các lần xem cùng BTC, cùng credential dùng chung lời gọi đang chạy và kết quả của nó thêm 5 giây sau khi lời gọi xong (chỉ trong bộ nhớ tiến trình). Còn ở comment `packages/contracts/src/organizer.ts:516`, JSDoc của `TokenBalanceReading` ở `packages/contracts/src/organizer.ts:532-535` ("mỗi lần xem là một lần đọc mới"; `readAt` "lúc api đọc" giờ dễ hiểu nhầm khi lần đọc được dùng lại: đó là giờ của lần đọc thật từ Tingee), `apps/web/app/(dashboard)/btc/[orgId]/token/page.tsx:12`, `apps/web/app/(dashboard)/btc/[orgId]/token/token-view.tsx:73-74` ("Mỗi lần mở trang api đọc … một lần"), và AC Story 4.5 ở `_bmad-output/planning-artifacts/epics.md:1458`. Sửa cùng E4-7 (đối chiếu `epics.md`) hoặc story kế tiếp chạm các file đó. Spine (AD-32) đã sửa trong spec này.
  evidence: Review vòng 1 của spec E4-3 phần B, triage #7b (BH), low. Never của intent cấm đổi `@tickee/contracts` và web trong spec này. Code và JSDoc phía api (`token.service.ts`, `token.controller.ts`, `organizer.module.ts`) đã khớp.
- Story nhận (21/11/2026, E4-8): action item E4-10. Sửa comment cùng lúc tách `contracts/organizer.ts`.

## Deferred from: code review of spec-epic-4-e4-9-quy-trinh-pr-ci.md (2026-11-21)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-4-e4-9-quy-trinh-pr-ci.md`
  summary: Kiểm concurrency mới của `ci.yml` trên `main` (E6) ở lần đầu có hai PR merge vào `main` cách nhau dưới một khoảng thời gian chạy CI (20–30 phút). Chạy `gh run list --branch main --workflow CI --json headSha,conclusion,createdAt`: cả hai run phải chạy xong, không run nào `cancelled`. Nếu có run `cancelled` thì sửa biểu thức `group`/`cancel-in-progress` ở `.github/workflows/ci.yml`.
  evidence: Review vòng 1 của spec E4-9, triage #8 (VG), medium, chưa kiểm. Check sau merge trong Verification của spec vẫn qua với config cũ khi không có hai merge chồng nhau, nên chỉ lần merge chồng nhau mới chứng minh được bản sửa E6 có tác dụng. Concurrency là hành vi runtime của GitHub, repo không có harness để kiểm ở local.
- Story nhận (21/11/2026, E4-8): action item E2-8. Kiểm ở lần đầu có hai PR merge vào `main` chồng nhau.

## Deferred from: sprint change proposal 2026-11-21 (E4-7), ngoài phạm vi

- source_spec: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-21-doi-chieu-spec-epic-4.md`
  summary: F1. Hai import sâu trong `platform` bỏ qua `index.ts` (`telemetry/span-redaction.ts` → `logging/pino-options.ts`, `alerts/schema.ts` → `db/columns.ts`) mà không luật nào bắt, và chưa có test so khớp `module-graph.cjs` với sơ đồ mô-đun của spine.
  evidence: Retro Epic 4 F1 (`epic-4-retro-2026-11-20.md`, mục "F. Aggregate view"): `depcruise` 0 vi phạm, nhưng sự khớp giữa `module-graph.cjs` và sơ đồ trong `ARCHITECTURE-SPINE.md` giữ bằng tay, dù AD-10 ghi cấu hình "sinh từ sơ đồ". Sprint change proposal 21/11/2026 ghi mục này ngoài phạm vi E4-7, không action item nào nhận.
  story: E4-11
- source_spec: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-21-doi-chieu-spec-epic-4.md`
  summary: F2. `dedupeKey` trong danh mục thông báo (`packages/contracts/src/notifications.ts:54`) không có code nào đọc: bỏ trường này, hoặc cho đường chống gửi lặp đọc nó.
  evidence: Retro Epic 4 F2 (LOW, "Đối chiếu spec"). `git grep dedupeKey` chỉ thấy kiểu (`notifications.ts:39`), giá trị (`:54`) và một test ghim giá trị (`packages/contracts/test/token.test.ts:139`). Sprint change proposal 21/11/2026 ghi mục này ngoài phạm vi E4-7.
  story: E4-11
- source_spec: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-21-doi-chieu-spec-epic-4.md`
  summary: F4. Quy ước phân trang `cursor` + `limit` của spine (bảng quy ước API, `ARCHITECTURE-SPINE.md:438`) chưa có chỗ dùng; Epic 4 thêm bốn danh sách không phân trang (Cần xử lý, BTC đang tạm ngừng bán, dead-letter, Đơn ứng viên để ghép).
  evidence: Retro Epic 4 F4 ("Đối chiếu spec", lệch toàn dự án). Danh sách Đơn đầy đủ của Story 6.1 là danh sách lớn đầu tiên, nên là chỗ dùng đầu tiên của quy ước. Sprint change proposal 21/11/2026 ghi mục này ngoài phạm vi E4-7.
  story: 6.1
- Đã xử lý (26/11/2026, 6.1): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-6-1-tab-don-day-du.md`. Bằng chứng: `packages/contracts/src/event-orders.ts:101`; `packages/contracts/src/event-orders.ts:146`; `apps/api/src/modules/ordering/event-orders-read.ts:111`.

## Deferred from: code review of spec-epic-4-e4-8-ve-sinh-deferred-work.md (2026-11-21)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-4-e4-8-ve-sinh-deferred-work.md`
  summary: Các mục "Hoãn" của retro Epic 4 nằm ngoài action item chưa có trong file này: F2 (`new SecretBox(parseCredentialKeys(…))` lặp 6 chỗ; hai bộ giới hạn tốc độ cùng thuật toán với ba kiểu dọn; `isLocalHost`/`isLoopbackV4`/`isHttps` chép giữa `config/production-rules.ts` và `web/lib/production-env.ts` với hai định nghĩa "production"; fixture e2e không import `@tickee/contracts`), F3 (file trên 600 dòng ngoài danh sách E4-10: `review-actions.ts`, `purchase-form-editor.tsx` 903, `ticket-types-editor.tsx` 717, `payout-account.service.ts` 716), F5 (Code Map 4.7-d nói chỉ dọn dòng của tài khoản và BTC đang xin, code xóa tới 500 dòng của mọi tài khoản, `event-image-rate-limit.ts:50-59`).
  evidence: Review E4-8 (Blind Hunter, maybe-false; nếu đúng là medium). `epic-4-retro-2026-11-20.md:223-231, :250`: F2 ghi "Hoãn sang một story dọn nợ, trừ khi ghi khác", F3 ghi "Hoãn, tách trước khi mở rộng tiếp"; E4-10 chỉ nhận `payment-service.ts`, `review-queue.tsx`, `contracts/organizer.ts`, `defineCronQueue`. Grep `SecretBox`, `isLocalHost` trong file này ra 0. Chưa rõ retro cố ý chỉ đưa một phần vào E4-10 hay để rơi; Mason chốt đích.
  story: E4-10

## Deferred from: code review of spec-5-1-link-moi-ctv-va-tab-check-in.md (2026-11-22)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-link-moi-ctv-va-tab-check-in.md`
  summary: Sự kiện đã hủy thì tab Check-in hiện badge "Đã hết hạn" kèm "Hết hạn lúc <thời điểm còn ở tương lai>": `GET …/checker-invite` chỉ đặt `active:false`, `expiresAt` vẫn là `LEAST(expires_at, effective_end_at)`. Cần câu chữ riêng (vd. "Hết hiệu lực vì Sự kiện đã hủy") hoặc ẩn thời điểm.
  evidence: Review 5.1 (Blind Hunter BH1, low). `apps/api/src/modules/checkin/checker-invite.service.ts` (`latest`), `apps/web/lib/checkin/invite-view.ts` (`checkerInviteView`). Hiện chưa route nào đặt `events.status='cancelled'`, nên người dùng chưa gặp; luồng hủy Sự kiện của 7.1 sẽ làm nó xảy ra (7.1 cũng chặn sửa link mời CTV sau khi hủy).
  story: 7.1
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-link-moi-ctv-va-tab-check-in.md`
  summary: Luật "link mời CTV còn hiệu lực" (chưa thu hồi, `now()` trước `LEAST(expires_at, effective_end_at)`, Sự kiện chưa hủy và chưa bấm "Kết thúc") đang nằm một phần trong SQL, một phần trong JS của `CheckerInviteService.latest`. `flows.acceptCheckerInvite` của 5.2 phải dùng đúng luật này: tách một hàm dùng chung để badge ở tab Check-in và việc nhận lời mời không lệch nhau.
  evidence: Review 5.1 (Blind Hunter BH13, low). Hiện chỉ một nơi dùng nên chưa tách; 5.2 là nơi thứ hai.
  story: 5.2
- Đã xử lý (23/11/2026, 5.2-a): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-2-a-api-nhan-loi-moi-va-quyen-ctv.md`. Bằng chứng: `apps/api/src/modules/checkin/invite-rule.ts:32`; `apps/api/src/modules/checkin/checker-invite.service.ts:69`.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-1-link-moi-ctv-va-tab-check-in.md`
  summary: E2E `apps/web/e2e/event-image.spec.ts:346` › "presign bị giới hạn (429 EVENT_IMAGE_RATE_LIMITED)…" chập chờn: dòng 376 đọc `puts` ngay sau khi preview đổi `src` sang `blob:`, lúc PUT có thể chưa được mock ghi nhận. Sửa: `await expect.poll(() => puts.map((p) => p.key)).toEqual([...])` như dòng 224.
  evidence: Kiểm chứng 5.1 (22/11/2026): cả bộ e2e 1133 pass, 1 fail ở ca này (android-chromium); chạy riêng ca này 16 lần (`--repeat-each=8`) fail 1. Story 5.1 không chạm file ảnh Sự kiện; test có từ 4.7-d (`4aec00a`).
  story: E2-8

## Deferred from: tách phạm vi Story 5.2 khi build (2026-11-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-a-api-nhan-loi-moi-va-quyen-ctv.md`
  summary: Story 5.2 phần web (5.2-b). Trang `/loi-moi-ctv` theo mẫu `/loi-moi-btc`: token từ hash giữ trong sessionStorage, `returnTo=/loi-moi-ctv` không kèm hash; các nhánh xem trước (tên Sự kiện, tên BTC, "Nhận soát vé"), link hỏng ("Link mời đã hết hạn. Liên hệ BTC để nhận link mới."), `scanEventId` → chuyển thẳng, `CHECKER_REVOKED` ("Bạn không còn quyền soát vé cho Sự kiện này."). Trang tạm `/events/[eventId]` (route group `(checkin)`, `GET /v1/checkin/events/:eventId`): tên Sự kiện + "Màn quét đang được hoàn thiện."; 401 → đăng nhập, 403 → câu lỗi. Nút "Mở Màn quét" ở tab Check-in của Sự kiện (Mason chọn 23/11/2026; "Quét vé" ở tab bar để 5.3). Mục hoãn "Đăng nhập tài khoản khác trong cùng tab…" (`queryClient.clear()` khi đăng nhập OTP). Helper đường dẫn web trong contracts. e2e vòng OTP.
  evidence: Tách khỏi Story 5.2 khi chạy bmad-build (23/11/2026, Mason chọn Split): spec gộp API và web ước 4.500–5.500 token. 5.2-a (API) merge được riêng; tới khi 5.2-b xong, mở link mời vẫn ra 404.
  story: 5.2-b
- Đã xử lý (23/11/2026, 5.2-b): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-2-b-web-nhan-loi-moi-ctv.md`. Bằng chứng: `apps/web/app/(public)/loi-moi-ctv/checker-invite-acceptance.tsx:95`; `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx:59`; `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checkin-tab.tsx:252`; `packages/contracts/src/checkin.ts:66`; `apps/web/e2e/checker-invite-accept.spec.ts:66`.

## Deferred from: code review of spec-5-2-a-api-nhan-loi-moi-va-quyen-ctv.md (2026-11-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-a-api-nhan-loi-moi-va-quyen-ctv.md`
  summary: Bảng `checkers` không có CHECK ràng `status` với `revoked_at`/`revoked_by`: DB nhận cả dòng `revoked` không có người/lúc thu hồi lẫn dòng `active` còn `revoked_at`. Khi làm "Thu hồi"/"Khôi phục", chốt nghĩa của khôi phục (giữ hay xóa `revoked_*`) rồi thêm CHECK tương ứng bằng migration mới.
  evidence: Review 5.2-a (Blind Hunter BH4, Edge Case Hunter EC2, low). `apps/api/drizzle/0034_checkers.sql` chỉ có `checkers_status_check`. Chưa code nào ghi `revoked_*`; tiền lệ ràng cặp cột: `organizations_payment_service_status_check`.
  story: 5.6
- Đã xử lý (25/11/2026, 5.6): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-6-thu-hoi-khoi-phuc-ctv-va-het-quyen.md`. Bằng chứng: `apps/api/src/modules/checkin/schema.ts:66`; `apps/api/drizzle/0037_checkers_revoked_check.sql:1`; `apps/api/src/modules/checkin/checkers.ts:181`.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-2-a-api-nhan-loi-moi-va-quyen-ctv.md`
  summary: Route CTV (`PermissionGuard` nhánh Sự kiện, `GET /v1/checkin/events/:eventId`) vẫn cho CTV `active` vào khi Sự kiện đã hủy, và `CheckinEvent` không có trạng thái để Màn quét biết. Khi làm hủy Sự kiện, quyết route CTV trả gì (vd. màn hết quyền hay đỏ `CANCELLED` ở lượt quét) và thêm trạng thái vào response nếu cần.
  evidence: Review 5.2-a (Blind Hunter BH12, low). Hiện chưa route nào đặt `events.status='cancelled'`; 5.6 chỉ nhận ca quá `effective_end_at` (`EVENT_ENDED`).
  story: 7.1

## Deferred from: tách phạm vi Story 5.3 khi build (2026-11-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-a-api-quet-ma-qr-ve.md`
  summary: Story 5.3 phần web (5.3-b). Màn quét thật ở `/events/[eventId]` (route group `(checkin)`, toàn màn, dọc, theo theme), dùng API của 5.3-a (`POST /v1/checkin/events/:eventId/scans`, `ScanResult`, `checkedInCount`/`validTicketCount` trong `CheckinEvent`). Gồm: màn "Bật camera" trước khi trình duyệt hỏi quyền, hướng dẫn bật lại cho Safari iOS/Chrome Android kèm "Tra tay" (UX-DR28); `scanner-viewport` (camera liên tục, khung vuông, đỉnh: tên Sự kiện + "Đã check-in k/N", đáy: "Tra tay", khóa quét tới khi kết quả đóng, mỗi lần đọc một `scanId` mới) (UX-DR29); `scan-result-overlay` xanh/trung tính (`recent`)/đỏ, âm thanh, `aria-live="assertive"`, reduced motion (UX-DR30); đỏ "Đã check-in" ghi "bởi {tên | bạn | Owner | Admin | CTV khác}" theo `checkedBy` (Mason chốt 23/11/2026); lỗi mạng/5xx khi quét không hiện đỏ; giữ màn hình sáng khi camera chạy. Hai mục hoãn giao cho 5.3: "Padding `env(safe-area-inset-bottom)`… đang bằng 0" (`viewportFit: 'cover'`) và "Story 5.3 (D5). `/xem-ve`… không giữ màn hình sáng". Lối vào "Quét vé" ở `bottom-tab-bar` (hiện là trang `ComingSoon` `/btc/[orgId]/quet-ve`; 5.2-b để lại cho 5.3). Khi lập spec phải chốt: thư viện giải mã QR (repo chỉ có `qrcode` để sinh mã; BRD gợi ý ZXing/html5-qrcode), hành vi tab "Quét vé" khi không ở trang Sự kiện hoặc có nhiều Sự kiện đang diễn ra, bật `viewportFit: 'cover'` toàn app hay chỉ cho `(checkin)`. e2e stub `getUserMedia` (Playwright chưa có fake camera).
  evidence: Tách khỏi Story 5.3 khi chạy bmad-build (23/11/2026, Mason chọn Split): spec gộp API và web ước khoảng 4.500 token. 5.3-a (API) merge được riêng; tới khi 5.3-b xong, `/events/[eventId]` vẫn là trang tạm "Màn quét đang được hoàn thiện."
  story: 5.3-b
- Đã xử lý (25/11/2026, 5.3-b): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-3-b-man-quet-web.md`. Bằng chứng: `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx:228`; `apps/web/app/(dashboard)/btc/[orgId]/quet-ve/scan-event-picker.tsx:37`.

## Deferred from: code review of spec-5-3-a-api-quet-ma-qr-ve.md (2026-11-23)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-a-api-quet-ma-qr-ve.md`
  summary: Gửi lại cùng `scanId` (mất phản hồi) sau khi Sự kiện vừa đóng ("Kết thúc", quá `effective_end_at`, hủy) hoặc Vé vừa bị hủy thì nhận đỏ `EVENT_ENDED`/`CANCELLED` thay vì `ok` của lần đầu, vì `assertCheckinOpen` và nhánh Vé hủy chạy trước nhánh phát lại. Khi làm thử lại cùng `scanId` ở client, quyết có cần đọc lần quét (`checked_in_by = user AND checkin_scan_id = scanId`) trước cổng hay chấp nhận ca này.
  evidence: Review 5.3-a (Blind Hunter BH1, Edge Case Hunter EC1, low). `apps/api/src/modules/ticketing/check-in.ts` (`checkIn`): bước 1 `assertCheckinOpen`, bước 3 mới phát lại. Chỉ gặp khi lần đầu đã commit, phản hồi mất và Sự kiện đóng ngay trong vài giây thử lại.
  story: 5.4
- Đã xử lý (25/11/2026, 5.4): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-4-quet-song-song-va-mat-mang.md`. Bằng chứng: `apps/api/src/modules/ticketing/check-in.ts:77`; `apps/api/src/modules/ticketing/check-in.ts:115`; `apps/api/src/modules/ticketing/check-in.ts:147`.

## Deferred from: code review of spec-5-3-b-man-quet-web.md (2026-11-25)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-3-b-man-quet-web.md`
  summary: Màn quét không có dấu hiệu nào khi request quét đang chờ: gate đã khóa nhưng không có chữ hay `aria-live` báo "Đang gửi…", nên trên mạng chậm CTV tưởng camera bỏ qua Vé. Khi làm timeout 3 giây và `offline-banner`, quyết có thêm chỉ báo đang gửi trước mốc 3 giây không.
  evidence: Review 5.3-b (Blind Hunter BH6, low). `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx` không dùng `submit.isPending`. Request treo vô hạn (EC8) đã thuộc AC 5.4 "client timeout 3 giây".
  story: 5.4
- Đã xử lý (25/11/2026, 5.4): mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-5-4-quet-song-song-va-mat-mang.md`. Bằng chứng: `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx:316`; `apps/web/components/tickee/scanner-viewport.tsx:116`.

## Deferred from: code review of spec-5-4-quet-song-song-va-mat-mang.md (2026-11-25)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-4-quet-song-song-va-mat-mang.md`
  summary: Lần gửi quét bị client hủy ở mốc 3 giây vẫn chạy tiếp ở server (transaction quét không có `statement_timeout`/`lock_timeout`), trong khi Màn quét gửi lại cùng `scanId` mỗi ~1 giây không giới hạn; khi DB chậm hoặc có khóa dài trên Sự kiện/Vé, các lần gửi lại có thể chồng lên nhau, chiếm pool (`max: 10`) và làm hỏng request khác, màn kẹt ở `offline-banner`. Chưa kiểm chứng (maybe-false, nếu đúng thì medium).
  evidence: Review 5.4 (Edge Case Hunter EC3, Blind Hunter BH1). `apps/api/src/flows/checkin-scan.flow.ts` `scanTicket` mở `db.transaction` không đặt timeout; `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx` `retry` + `retryDelay: SCAN_RETRY_DELAY_MS`. Pool có `connectionTimeoutMillis: 3000` (`platform/db/database.ts:29`) nên request chờ kết nối tự lỗi sau 3 giây, chưa rõ có cạn pool thật không. Muốn chốt: trong kiểm thử tải check-in ở staging, giữ một khóa dài (vd. `SELECT … FOR UPDATE` trên dòng Sự kiện) hoặc làm DB chậm, cho 20 CTV quét, xem số kết nối đang dùng và lỗi của route khác; nếu cạn thì thêm `set_config('statement_timeout'/'lock_timeout', …, true)` trong transaction quét (mẫu ở `ticketing.module.ts:86`).
  story: 9.2

## Deferred from: code review of spec-5-6-thu-hoi-khoi-phuc-ctv-va-het-quyen.md (2026-11-25)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-6-thu-hoi-khoi-phuc-ctv-va-het-quyen.md`
  summary: Sự kiện `cancelled` đã quá `effective_end_at` (hoặc đã bấm "Kết thúc") lệch luật "đã kết thúc" giữa web và api ở hai chỗ. (1) Tab Check-in: `isEventEnded` của web trả `false` cho `cancelled`, nên "Khôi phục" CTV vẫn bật, trong khi `checkinEnded` của api bỏ qua `status` và trả `409 EVENT_ALREADY_ENDED`; bấm lần nào cũng 409, toast "Đã tải lại" mà nút vẫn bật. (2) Route CTV: guard trả `403 EVENT_ENDED`, nên Màn quét hiện "Sự kiện đã kết thúc." cho Sự kiện thực ra đã hủy. Khi làm hủy Sự kiện, chốt luật khôi phục CTV và câu màn hết quyền cho Sự kiện đã hủy (thêm lý do "Sự kiện đã hủy" cho nút, hoặc mã/câu riêng ở guard).
  evidence: Review 5.6 (Verification Gap VG-O1, Blind Hunter BH1, Edge Case Hunter EC6, EC8; low). `apps/web/app/(dashboard)/btc/[orgId]/su-kien/event-status.ts:25` (`isEventEnded` chỉ tính `published`/`hidden`), `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checker-list.tsx` (`eventEnded`), `apps/api/src/modules/checkin/checkers.ts` (`setCheckerStatus`), `apps/api/src/platform/access/permission.guard.ts` (`eventRoute`). Chưa route nào ghi `events.status='cancelled'`, nên người dùng chưa gặp; cùng chủ đề với mục "Route CTV … vẫn cho CTV `active` vào khi Sự kiện đã hủy" (story 7.1).
  story: 7.1
- source_spec: `_bmad-output/implementation-artifacts/spec-5-6-thu-hoi-khoi-phuc-ctv-va-het-quyen.md`
  summary: Unit test web `apps/web/test/dependency-rules.test.ts` › "mã nguồn thật không vi phạm" chập chờn: chạy dependency-cruiser bằng process con trong hạn mặc định 5 giây của Vitest, nên quá hạn khi máy đang bận (vd. build web và e2e chạy cùng lúc). Sửa: đặt `testTimeout` riêng cho ca này (vd. 30 giây) như các test gọi process con khác.
  evidence: Kiểm chứng 5.6 (25/11/2026): chạy `pnpm --filter @tickee/web test` 3 lần trong lúc build web và e2e chạy nền, fail 1 lần với "Test timed out in 5000ms" ở `dependency-rules.test.ts:16`; hai lần còn lại 469/469. `pnpm lint:deps` (cùng luật) pass. Story 5.6 không chạm file này; test có từ 4.7-f (`60e42df`).
  story: E2-8

## Deferred from: code review of spec-5-7-theo-doi-check-in-realtime.md (2026-11-25)

- source_spec: `_bmad-output/implementation-artifacts/spec-5-7-theo-doi-check-in-realtime.md`
  summary: Hủy Sự kiện chuyển Vé `valid` (kể cả đã check-in) sang `cancelled` thì phải phát `event_checkins_changed` cho Sự kiện trong cùng tx, vì tab Check-in và đỉnh Màn quét đang nối SSE không polling, nên giữ số k/N cũ tới lần check-in kế tiếp (mà Sự kiện đã hủy thì không còn check-in).
  evidence: Review 5.7 (Blind Hunter BH1, Edge Case Hunter EC1, low). Chỉ `apps/api/src/modules/ticketing/check-in.ts` (`checkIn`) phát `event_checkins_changed`; stream `GET /v1/checkin/events/:eventId/live` (`checkin/checkin-event.controller.ts`) chỉ lọc topic này; `effectivePollInterval` (`apps/web/lib/realtime/live-signal.ts`) tắt polling khi đã nối.
  story: 7.1
- source_spec: `_bmad-output/implementation-artifacts/spec-5-7-theo-doi-check-in-realtime.md`
  summary: Vô hiệu Vé đã phát (`voided`) phải phát `event_checkins_changed` cho Sự kiện trong cùng tx, để tab Check-in và đỉnh Màn quét đang nối SSE trừ Vé đó khỏi k/N ngay, không chờ lần check-in kế tiếp.
  evidence: Review 5.7 (Blind Hunter BH1, Edge Case Hunter EC1, low). Cùng bằng chứng với mục 7.1 ngay trên; `CheckinEvent` chỉ đếm Vé `valid`.
  story: 7.5
- source_spec: `_bmad-output/implementation-artifacts/spec-5-7-theo-doi-check-in-realtime.md`
  summary: Vé mới phát (Đơn `paid`, Đơn 0đ) chỉ phát `event_orders_changed`, nên khi SSE check-in đang nối thì mẫu số N (tổng và theo Hạng vé) ở tab Check-in và đỉnh Màn quét chỉ đúng lại ở lần check-in, lần hiện tab hay lần nối lại kế tiếp. Hướng sửa: stream `…/checkin/events/:eventId/live` lọc thêm `event_orders_changed` của cùng Sự kiện cho Owner/Admin (CTV không nhận topic Đơn theo AD-17), hoặc polling chậm cả khi đã nối.
  evidence: Review 5.7 (Blind Hunter BH1, Edge Case Hunter EC1, low). `ordering/order-changed.ts` (`notifyEventOrdersChanged`); test `apps/api/test/checkin/checkin-live.test.ts` khẳng định tạo Đơn không lọt vào stream check-in. Spec 5.7 (phần đóng băng) chốt bộ lọc chỉ `event_checkins_changed`.
  story: 6.2
- Đã xử lý (26/11/2026, 6.2): phần Owner/Admin (tab Check-in: stream check-in lọc thêm `event_orders_changed` của cùng Sự kiện cho người có quyền `orders.view`) của mục ngay trên đã làm ở `_bmad-output/implementation-artifacts/spec-6-2-so-lieu-ve-theo-hang-ve-tren-tong-quan.md`. Bằng chứng: `apps/api/src/modules/checkin/checkin-event.controller.ts:39`, `apps/api/test/checkin/checkin-live.test.ts` (ca "Story 6.2: Đơn mới của Sự kiện chuyển paid"). Phần CTV (đỉnh Màn quét của CTV) còn mở.
- Story nhận (26/11/2026, 6.2): E5-2. Phần CTV: CTV không được nhận topic Đơn (AD-17); giải pháp tạm của E5-2 (poll `CheckinEvent` 60 giây kể cả khi connected) chữa luôn N không theo Vé mới ở đỉnh Màn quét.
- source_spec: `_bmad-output/implementation-artifacts/spec-5-7-theo-doi-check-in-realtime.md`
  summary: Chưa đo (maybe-false, nếu đúng thì medium): mỗi check-in làm mọi client đang mở (mọi điện thoại CTV + tab Owner/Admin) tải lại `GET /v1/checkin/events/:eventId` (3 câu: Sự kiện, `ticket_types`, `GROUP BY ticket_type_id` trên mọi Vé của Sự kiện qua `tickets_event_id_idx`), gom 1 giây mỗi client; Màn quét trả phí số theo Hạng vé mà không hiện. Đo p95 của GET này và tải DB lúc cổng đông; nếu nặng thì thêm index một phần `(event_id, ticket_type_id) WHERE status = 'valid'` kèm `checked_in_at`, hoặc đường chỉ tổng cho Màn quét.
  evidence: Review 5.7 (Blind Hunter BH12). `checkin/checkin-event.controller.ts` (`get`), `ticketing/check-in.ts` (`checkinCountsByTicketType`). Design Notes của spec 5.7 đã ghi đo ở 9.2.
  story: 9.2
- Ghi thêm (26/11/2026, retro Epic 5 R7, E5-4): đếm thiếu. Mỗi lần tải lại tốn khoảng 7 câu SQL, không phải 3: tra session (không có `cookieCache`, `identity/auth.ts:59`), guard (`checkinEventById`, `checkerStatusOf`, tra membership), handler (`checkinEventById` lần nữa, `ticketTypesOf`, câu `GROUP BY`). Máy vừa quét xanh tải hai lần: một lần do tín hiệu SSE, một lần do `closeResult` invalidate (`checkin-event-screen.tsx:437`). Gợi ý: bỏ invalidate khi đang connected. AC 9.2 đã ghi phép đo.

## Deferred from: đối chiếu spec sau Epic 5 (E5-4, 2026-11-26)

- source_spec: `_bmad-output/implementation-artifacts/epic-5-retro-2026-11-26.md` (F6)
  summary: CTV đăng nhập bằng OTP không có tên, nên kết quả đỏ "đã check-in" hiện "bởi CTV khác" với mọi CTV. Khi nhiều CTV cùng cổng thì không biết ai quét trước. Cân nhắc cho CTV đặt tên hiển thị lúc nhận lời mời (Story 5.2).
  evidence: Spec 5.3-a (`:25`), quyết định nhãn vai trò; kiểm hành vi retro Epic 5. AC 5.3, 5.4 đã sửa theo nhãn vai trò (E5-4).
  story: chưa có; xét cùng E5-1 (luồng lời mời CTV).
