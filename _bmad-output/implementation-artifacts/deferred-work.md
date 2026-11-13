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

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-2-lam-chac-bat-dau-dang-nhap-google.md`
  summary: Từ AI-2, chỉ vai `worker` dọn `verifications`/`sessions`/bộ đếm giới hạn. Checklist deploy Story 4.7 phải yêu cầu luôn có ít nhất một worker, và cảnh báo khi job `identity.purge-expired` lỗi hoặc lâu không chạy.
  evidence: Đã xóa `purgeExpired` khỏi `OtpRateLimiter.consume`. Môi trường chỉ chạy `api` sẽ giữ email dạng rõ (`verifications`) và IP/UA (`sessions`) vô thời hạn.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-2-lam-chac-bat-dau-dang-nhap-google.md`
  summary: Giới hạn theo IP (OTP và bắt đầu Google) nên gom IPv6 theo /64 để client giữ cả dải không vượt giới hạn.
  evidence: `ipHmac` băm nguyên địa chỉ. Mức độ medium nhưng chưa kiểm; muốn xác nhận thì thử gửi từ nhiều địa chỉ trong cùng một /64.

- source_spec: none
  summary: Story 2.1 phần B — khung dashboard responsive: dashboard-sidebar ≥ lg với BTC switcher ở đầu và "Tạo BTC mới" ở cuối, sidebar thu thành icon md–lg, bottom-tab-bar < md (Sự kiện · Cần xử lý · Quét vé · Thêm), ẩn mục chỉ dành cho Owner với Admin, đổi BTC về danh sách Sự kiện, empty-state "Chưa có Sự kiện nào." + "Tạo Sự kiện" (UX-DR34).
  evidence: Tách khỏi Story 2.1 khi chạy bmad-build (29/10/2026, Mason chọn Split). Phần A (tạo BTC, AccessResolver/@RequirePermission, orgScope, audit, bộ test cách ly, GET /v1/me/memberships) là nền quyền ship được riêng; gom cả hai thì spec vượt xa giới hạn kích thước.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-tao-btc-va-nen-tang-quyen.md`
  summary: Bộ test cách ly hiện mới kiểm ở mức guard. Khi có tài nguyên con (Story 2.7 Sự kiện), cần seed tài nguyên thật của BTC B và gọi qua đường dẫn của BTC A (`/v1/orgs/A/events/<id của B>`) để bắt IDOR ở các handler quên `orgScope`.
  evidence: `fill()` trong `apps/api/test/organizer/isolation.test.ts` thay mọi param con bằng UUID ngẫu nhiên (review B1, medium).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-tao-btc-va-nen-tang-quyen.md`
  summary: `POST /v1/orgs` chưa có giới hạn tần suất và idempotency key. Mất response rồi bấm "Thử lại" sẽ tạo BTC trùng; một tài khoản cũng có thể tạo hàng loạt BTC vào hàng duyệt Closed Beta (Story 2.5).
  evidence: Hiện chỉ chặn bấm đúp ở client (`isPending || isSuccess`) (review B7/E5, medium).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-tao-btc-va-nen-tang-quyen.md`
  summary: `PermissionGuard` và cổng `AccessResolver` đang gắn với `:orgId`. Epic 5 (`/v1/checkin/events/:eventId`) cần mở rộng cổng, ví dụ resolver theo phạm vi route. Kiểm `@Public()` + `@RequirePermission` nên chuyển lên lúc khởi động hoặc vào bộ test route.
  evidence: Review B3/B4/V3. Hiện lỗi cấu hình chỉ lộ khi có request.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Đổi BTC trong switcher làm khung dashboard unmount: sidebar/tab bar biến mất trong lúc tải, focus rơi về `<body>`, tab bar mobile nháy. Cân nhắc prefetch BTC đích khi mở menu, hoặc giữ khung với skeleton.
  evidence: `organizationQueryKey(orgId)` mới chưa có cache nên `DashboardShell` rơi vào nhánh loading (review B8, medium).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Padding `env(safe-area-inset-bottom)` của tab bar, vùng nội dung và Sheet đang bằng 0 vì viewport gốc không có `viewportFit: 'cover'`. Cần quyết định bật `cover` (và kiểm tra trang công khai ở landscape) trước Closed Beta.
  evidence: `app/layout.tsx` không đặt `viewportFit`; spec 2.1B cấm đổi (review B15, medium).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Repo chưa có cấu hình Prettier và bước kiểm định dạng, nên code mới có thể lệch kiểu (nháy kép, 80 cột) mà CI không bắt.
  evidence: Không có `.prettierrc`; pipeline `build typecheck lint:deps test` không kiểm định dạng (review B1).

## Deferred from: code review of spec-2-1-b-khung-dashboard-responsive.md (2026-10-30)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-b-khung-dashboard-responsive.md`
  summary: Mục "Cài đặt" của dashboard mô tả "Sửa tên và kênh liên hệ của BTC" nhưng gắn quyền `org.read`, và ma trận FR-4 chưa có quyền sửa BTC. Story nào làm sửa BTC phải thêm quyền mới vào FR-4 (và quyết định Admin có được sửa hay không).
  evidence: `apps/web/lib/organizer/nav.ts:63`; test "danh sách quyền đúng FR-4" khóa danh sách hiện tại. Chưa story nào trong Epic 2 sở hữu việc sửa BTC (code review 30/10, blind-hunter).

- source_spec: none
  summary: AI-5 phần web — tách `apps/web/app/(public)/dang-nhap/login-form.tsx` thành hook và gộp phần đổi lỗi thành câu báo bị lặp (retro Epic 1, B1/B4).
  evidence: Tách khỏi AI-5 khi chạy bmad-build ngày 2026-10-30; phần API (auth.ts + adapter internalAdapter) là điều kiện trước Story 2.2, phần web ship riêng được.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-5-tach-auth-va-adapter-better-auth.md`
  summary: `signInWithCode` tra `SignInOtpStore.has()` trước và `remainingAttempts()` sau `signInEmailOTP` bằng các lần đọc riêng; hai verify song song cho cùng email có thể báo số lượt còn lại lệch một hoặc `hadCode` cũ.
  evidence: Có từ trước AI-5 (cùng thứ tự gọi `internalAdapter` ở `identity.service.ts`); review AI-5 (blind-hunter) ngày 2026-10-30.

- source_spec: none
  summary: Story 2.2 phần B — Quản trị Tingee (đã step-up) "Đặt lại TOTP" cho một user ở `/admin`: bắt buộc lý do, xóa TOTP và mã khôi phục, hủy mọi phiên, buộc đăng ký lại; audit; email báo user và các Owner/Admin của BTC liên quan.
  evidence: Tách khỏi Story 2.2 khi chạy bmad-build ngày 2026-10-30 (Mason chọn Split). Cần khu `/admin`, step-up cho Quản trị Tingee và `ADMIN_ALLOWED_CIDRS` mà Story 2.5 dựng; làm cùng hoặc ngay sau 2.5.

## Deferred from: code review of spec-2-2-totp-cho-owner.md (2026-10-30)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-totp-cho-owner.md`
  summary: Chưa có test ghim việc trả lại lượt (`TotpAttemptLimiter.restore`) khi xác minh TOTP/mã khôi phục lỗi hệ thống; bỏ dòng `restore` trong `catch` của `TotpService` thì không test nào hỏng.
  evidence: Review 30/10 (verification-gap): chỉ nhánh `not_started` được test; cần stub `TotpStore.verify` ném lỗi rồi kiểm lần sai kế tiếp còn `remainingAttempts: 4`.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-totp-cho-owner.md`
  summary: Nhánh "step-up giữa thao tác rồi gửi lại mutation" của `Providers` mới chỉ test bằng e2e mock `POST /orgs` (API thật không đòi TOTP ở đó). Story đầu tiên có mutation thuộc BTC (2.4 mời/xóa Admin) phải thêm test API + e2e thật cho `TOTP_REQUIRED` → step-up → gửi lại.
  evidence: Review 30/10 (blind-hunter): route `@RequirePermission` duy nhất hiện là `GET /v1/orgs/:orgId`.

- source_spec: `_bmad-output/implementation-artifacts/spec-theme-toggle.md`
  summary: Khi thêm Content Security Policy (vd. cho script Tingee), phải cho phép script theme inline `THEME_SCRIPT` trong `<head>` mà vẫn giữ trang tĩnh prerender.
  evidence: Review 02/11 (blind-hunter). Hiện chưa có CSP nên chưa lỗi. Dùng nonce sẽ ép render động, trái quy tắc "không đọc theme ở server". Dùng hash thì hash đổi theo output của `applyTheme.toString()` sau mỗi lần đổi compiler hoặc minifier, nên phải tính hash lúc build.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-landing-btc.md`
  summary: Đăng nhập tài khoản khác trong cùng tab (không đăng xuất) chỉ invalidate `me`, nên cache memberships của tài khoản trước còn tới 30 giây; `AccountMenu` và CTA landing trỏ "Dashboard BTC"/"Vào dashboard" tới BTC của người khác.
  evidence: `apps/web/app/(public)/dang-nhap/login-form.tsx:164` chỉ gọi `invalidateQueries({ queryKey: ME_QUERY_KEY })`, `staleTime` 30 giây ở `providers.tsx:42`; có từ trước Story 2.3. Server vẫn trả lỗi quyền khi mở BTC không phải của mình. Sửa: xóa cache (như đăng xuất) hoặc invalidate cả `MEMBERSHIPS_QUERY_KEY` khi đăng nhập thành công.

## Deferred from: code review of spec-2-4-moi-va-xoa-admin.md (2026-11-02)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-moi-va-xoa-admin.md`
  summary: Giới hạn 20 lời mời/24 giờ chỉ tính theo BTC, mà một tài khoản tạo được không giới hạn BTC, nên email mời Admin (tiêu đề chứa nguyên tên BTC, gửi từ tên miền Tickee) có thể bị dùng để spam/phishing. Cần thêm giới hạn theo tài khoản mời và/hoặc theo người nhận, hoặc giới hạn số BTC mỗi tài khoản.
  evidence: Review 02/11 (blind-hunter). `organizer.service.ts` `createOrganization` không có giới hạn (có từ 2.1); `members.service.ts` `invite` chỉ đếm `organization_id`. Nên chốt trước Closed Beta, cùng lúc với giám sát 4.6.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-moi-va-xoa-admin.md`
  summary: `organization_invitations` giữ `email` (PII) mãi mãi: lời mời đã nhận, đã thu hồi hay hết hạn không bao giờ bị xóa, và lời mời hết hạn nằm trong "Lời mời đang chờ" tới khi Owner thu hồi tay. Cần chốt thời hạn giữ rồi thêm job dọn (như `identity.purge-expired`).
  evidence: Review 02/11 (blind-hunter, edge-case-hunter). Chưa có janitor cho bảng này; thời hạn giữ dữ liệu cho audit/NĐ 13 chưa có trong PRD, liên quan Story 7.6 (xóa tài khoản, rút đồng ý).

## Deferred from: tách phạm vi Story 2.5 khi build (2026-11-02) — phải xong trước Closed Beta

- source_spec: none
  summary: Story 2.5 phần sau — giới hạn `/v1/admin/*` theo dải IP `ADMIN_ALLOWED_CIDRS` (kiểm bằng Zod khi khởi động, thiếu/sai ở production thì api không khởi động) cùng cấu hình trusted proxy để lấy đúng IP client (FR-4, AD-26).
  evidence: Tách khỏi Story 2.5 theo quyết định của Mason (02/11): chỉ có tác dụng khi đã deploy và dính `TRUST_PROXY_HOPS` đang nằm trong checklist Story 4.7 ở file này; không chặn 2.6/2.10. Phải xong trước khi mở `/admin` trên môi trường thật.
- source_spec: none
  summary: Story 2.5 phần sau — thao tác "Đặt lại TOTP" cho một user ở `/admin` (Quản trị Tingee đã step-up, lý do bắt buộc; xóa TOTP + mã khôi phục, hủy mọi phiên, 2FA về chưa bật; audit; email báo user và Owner/Admin của các BTC liên quan), chuyển từ Story 2.2 theo Sprint Change Proposal 30/10/2026.
  evidence: Tách khỏi Story 2.5 theo quyết định của Mason (02/11): chỉ cần khi đã có người dùng thật mất thiết bị; là mục tiêu độc lập (luồng hỗ trợ tài khoản), không story nào phụ thuộc. Phải xong trước Closed Beta.

## Deferred from: code review of spec-2-5-duyet-btc-vao-closed-beta.md (2026-11-02)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-duyet-btc-vao-closed-beta.md`
  summary: `StatusNotice` chưa có id đối tượng (BTC/Sự kiện): khóa đóng banner trong `sessionStorage` và React key chỉ là `code:version`, nên story đầu tiên phát thông báo phạm vi `event` hoặc `dismissible: true` phải thêm id đối tượng vào hợp đồng và vào cả hai khóa.
  evidence: Review 02/11 (blind-hunter, edge-case-hunter), triage #5. Hôm nay chưa với tới: hai mã Closed Beta đều không đóng được và đều phạm vi `organization`, `version` là mốc thời gian theo BTC. Hai thông báo Sự kiện cùng mã + version sẽ trùng React key và đóng một cái ẩn luôn cái kia; khóa đóng còn dính sang BTC khác trong cùng tab.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-duyet-btc-vao-closed-beta.md`
  summary: `GET /v1/admin/organizations` (hàng duyệt Closed Beta) chưa phân trang; tab "Đã duyệt" tăng theo số BTC.
  evidence: Review 02/11, triage #9. Closed Beta chỉ vài chục BTC nên chưa thành vấn đề; thêm `limit` + cursor trước khi mở rộng ngoài Closed Beta.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-5-duyet-btc-vao-closed-beta.md`
  summary: CLI Quản trị Tingee chưa có `admin:list` để xem ai đang có cờ, và README chỉ hướng dẫn chạy local; Story 4.7 cần ghi cách chạy `dist/roles/admin-cli.js` trong image ở staging/production (ai được chạy, cấp `MIGRATION_DATABASE_URL` thế nào).
  evidence: Review 02/11 (blind-hunter), triage #11. Hiện muốn xem danh sách admin phải chạy SQL bằng role migrator.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-1-ai-1-bit-ro-pii-trong-log.md`
  summary: Worker gửi lời mời Admin (`invitation-jobs.ts:192-194`) log `err.message` và ghi nó vào `output` của job pg-boss; log khởi động `main.ts` (`bootLog.fatal({ err })`) cũng log nguyên lỗi. Cần dùng `isDatabaseError`/`dbErrorSummary` như `ErrorFilter`.
  evidence: Khi truy vấn Drizzle trong `sendAdminInvitation` lỗi, `DrizzleQueryError.message` là `Failed query: <sql>\nparams: <tokenHash>,<invitationId>` và đi thẳng vào log worker lẫn bảng job. Code có từ Story 2.4/1.1, nằm ngoài bốn đường AI-1. Review AI-1 #3.

## Deferred from: code review of spec-2-6-lien-ket-tai-khoan-nhan-tien.md (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien.md`
  summary: Trạng thái Tingee có thể lệch DB khi kết quả mơ hồ: `create-va`/`confirm-va` timeout sau khi Tingee đã tạo VA, hoặc lần thử mới thay lần thử đang xác nhận OTP. Lần thử bị `failed`, lần sau có thể nhận `PAYOUT_ACCOUNT_IN_USE` và BTC kẹt. Chưa có cách đối soát hay runbook.
  evidence: Review 03/11 #1, #2 (maybe-false; nếu đúng là medium). Kiểm trên UAT khi làm test hợp đồng: (a) request timeout có để lại VA không; (b) `create-va` lặp lại cho cùng Merchant con và cùng số tài khoản trả mã gì (1022/1048/1081); (c) có API tra VA của Merchant con không (`/v1/shop/get-paging`?). Nếu (a) và (b) đúng thì đọc `PAYOUT_ACCOUNT_IN_USE` của cùng Merchant con là "đã liên kết", hoặc thêm đối soát.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien.md`
  summary: Story 7.6 (xóa tài khoản) phải xử lý `payout_accounts.created_by` (FK `ON DELETE no action`) và PII (`account_name`, `account_last4`) của các lần thử thất bại; hiện giữ mãi.
  evidence: Review 03/11 #17. Cùng quy ước với `organization_invitations.invited_by` (0006).
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien.md`
  summary: Script dev `pnpm --filter @tickee/api tingee:fake` (biên dịch riêng `test/tingee-fake/tsconfig.json`) chưa có bước CI nào chạy thử.
  evidence: Review 03/11 #24 (verification-gap). Sai `outDir`/`rootDir` sẽ làm hỏng cách chạy local ghi trong `.env.example`/README mà mọi test vẫn qua.

## Deferred from: code review of spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md (2026-11-03)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md`
  summary: Hai BTC kết nối cùng một tài khoản merchant Tingee (cùng Client ID, hoặc cùng VA). Portal chỉ có một "Đường dẫn IPN" cho mỗi merchant, nên IPN của một BTC đổ về URL `ipnKey` của BTC kia; theo AD-7, IPN đó rơi vào nhánh "Tài khoản lệch".
  evidence: Review 03/11 pass 1 #1 (maybe-false; nếu đúng là medium). Cần biết hai điều: (a) Tingee có cho cấu hình IPN Cổng thanh toán theo shop hoặc VA không, hay chỉ một URL cho mỗi merchant; (b) Mason chọn chặn trùng Client ID giữa các BTC ở bước kết nối (Story 2.6/2.13), hay để Story 3.5 định tuyến theo credential đã chụp vào Đơn thay vì đòi Đơn thuộc BTC sở hữu `ipnKey`. Phải chốt trước khi làm Story 3.5.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md`
  summary: Bước kết nối chỉ chứng minh key có quyền "Tài khoản & Định danh" (`get-va-paging`). Key thiếu quyền "Cổng thanh toán" vẫn kết nối và chọn tài khoản được, tới `create-link` (Epic 3) mới lỗi 1133.
  evidence: Review 03/11 pass 1 #3 (medium). Không có API kiểm quyền Cổng thanh toán mà không tạo link. Đề xuất 03/11 đã đặt nút "Kiểm tra kết nối" (tạo link thử 2.000đ rồi hủy) ở Epic 3. Story 3.4 cần báo `TINGEE_CREDENTIAL_INVALID` kèm câu nhắc cấp quyền "Cổng thanh toán".
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md`
  summary: Chưa biết `get-va-paging` trả gì cho merchant chưa liên kết tài khoản nào (`items: []`, `items: null` hay `data: null`). Adapter chỉ nhận mảng; nếu Tingee trả null thì bước kết nối thành 503 và không bao giờ tới được `empty-state`.
  evidence: Review 03/11 pass 1 #16 (maybe-false; nếu đúng là medium). Tài liệu và OpenAPI của Tingee chỉ có ví dụ có phần tử, và schema của `data` để trống. Cách chốt: gọi UAT bằng một merchant mới chưa liên kết ngân hàng (test hợp đồng, Story 4.7, hoặc thử tay bằng key UAT trong `.env` local).

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
- source_spec: `_bmad-output/implementation-artifacts/spec-2-6-huy-lien-ket-va-nhieu-tai-khoan-nhan-tien.md`
  summary: Trang tài khoản nhận tiền đưa URL IPN `/v1/payments/tingee/ipn/{ipnKey}` cho BTC dán lên portal Tingee, trong khi route này chưa có (Story 3.5). Nếu portal gọi thử URL khi lưu, hoặc gửi IPN trước Epic 3, Tingee sẽ nhận 404.
  evidence: Review cả nhánh 03/11 (maybe-false; nếu đúng là medium). Cách chốt: lưu URL IPN trên portal UAT, xem Tingee có gọi thử không và có chặn lưu khi gọi lỗi không. Nếu có thì thêm route tạm trả thành công, hoặc ghi chú "chưa hoạt động".

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-tao-su-kien-nhap.md`
  summary: Story 2.7-b — ảnh Sự kiện: hạ tầng object storage S3 (MinIO trong docker-compose, biến `S3_*`, `@aws-sdk/client-s3` + presigner), API cấp presigned PUT (JPEG/PNG/WebP ≤ 5 MB, key `orgs/{orgId}/events/{uuid}.{ext}`, chỉ nhận key đúng tiền tố BTC), cột `events.image_key`, ô ảnh ở wizard bước 1 và thumbnail của `event-card` (AD-22).
  evidence: Spec 2.7 bản đầy đủ ~4.000 token; Mason chọn tách phần ảnh ra spec riêng (03/11/2026) vì đây là hạ tầng mới, review và merge riêng được mà không làm hỏng luồng tạo nháp.

## Deferred from: code review of spec-2-7-tao-su-kien-nhap.md (2026-11-05)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-tao-su-kien-nhap.md`
  summary: `EventService.update` (`PATCH /v1/orgs/:orgId/events/:eventId`) và trang `su-kien/{id}/thiet-lap` không kiểm `status`/`locked_at`, nên Owner/Admin sửa được Sự kiện đã mở bán, ẩn, hủy hoặc bị Quản trị Tingee khóa. Cần guard + mã lỗi riêng (vd. `EVENT_NOT_EDITABLE`) và test, cùng lúc với Story 2.10/2.12 (lần đầu có đường chuyển khỏi `draft`) hoặc Epic 7 (đặt `locked_at`).
  evidence: Review sau merge 05/11 (BH, EC, AA). Ở 2.7 chưa đạt tới được (triage #6), nhưng cảnh báo chỉ nằm trong spec 2.7, không có TODO trong code.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-7-tao-su-kien-nhap.md`
  summary: `publicBySlug` chỉ loại `status = 'draft'`; Sự kiện bị khóa (`locked_at`), `hidden`, `cancelled` vẫn trả cho người ẩn danh. Story 2.11 cần chốt luật hiển thị (FR-7: `hidden` vẫn mở bằng link) và thêm test cho từng trạng thái.
  evidence: Review sau merge 05/11 (BH, EC). Hiện chỉ test `published`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-9-cau-hinh-form-mua-ve.md`
  summary: "Các trường bổ sung khác" của FR-9 (trường dựng sẵn như Ngày sinh, CCCD, Size áo, mỗi trường có định dạng và cách xử lý PII riêng) chưa làm. Story 2.9 chỉ có trường mặc định và câu hỏi riêng dạng văn bản/lựa chọn một.
  evidence: Mason chọn bỏ qua ở 2.9 (05/11/2026): câu hỏi riêng đã đủ cho MVP. Trường dựng sẵn cần chốt danh sách, định dạng và xử lý PII (NĐ 13/2023).

## Deferred from: code review of spec-2-8-hang-ve-va-ton-kho.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-8-hang-ve-va-ton-kho.md`
  summary: Chưa có e2e cho nhánh server trả `400 VALIDATION_FAILED` với input đã qua kiểm phía web, ở form Hạng vé (`serverIssuePaths` → lỗi theo ô, fallback `UNMATCHED_SERVER_ERROR`) và ô giới hạn Vé/Đơn. Thêm một case trong `ticket-types.spec.ts` cho mock trả `issues:[{path:'price'}]` với input hợp lệ.
  evidence: Review sau merge 06/11 (VG). Web và API dùng chung schema nên hiện gần như không đạt tới được.

## Deferred from: code review of spec-2-9-cau-hinh-form-mua-ve.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-9-cau-hinh-form-mua-ve.md`
  summary: Chưa có test API cho `PUT …/form/order` với id câu hỏi viết hoa và `PATCH` câu hỏi với id phương án viết hoa (phải giữ id cũ, `changedFields` không có `options`). Bỏ `.toLowerCase()` trong `reorder`/`optionsOf` thì không test nào đỏ.
  evidence: Review sau merge 06/11 (VG, BH). Web chỉ gửi lại id chữ thường; thêm khi Epic 3 dùng id phương án.

## Deferred from: tách phạm vi Story 2.10 (2026-11-06)

- source_spec: none
  summary: `ordering.sellability(eventId)` — trạng thái bán theo từng Hạng vé và `eventReason` (Đang bán / Chưa mở bán / Đã đóng bán / Hết vé / Tạm ngừng bán / Ẩn / Bị khóa / Đã hủy / Đã kết thúc), gồm AC "Closed Beta bị thu hồi → Hạng vé có phí Tạm ngừng bán, 0đ vẫn bán" (AD-21, FR-37). Làm trước hoặc đầu Story 2.11.
  evidence: Tách khỏi Story 2.10 theo lựa chọn của Mason (06/11/2026): là hàm backend ship độc lập, chưa có consumer cho tới 2.11/Epic 3. Phải dùng lại cùng luật điều kiện với `event.publishReadiness` (Closed Beta, tài khoản nhận tiền, chính sách hoàn vé, giá ≥ 2.000đ) để không lệch luật.

## Deferred from: code review of spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: Sau khi mở bán, API sửa Sự kiện/Hạng vé/form vẫn chạy không xét `status`. Có thể xóa chính sách hoàn vé, hoặc thêm Hạng vé có phí khi BTC chưa duyệt Closed Beta hoặc chưa có tài khoản nhận tiền. Story 2.12 thêm guard; `ordering.sellability` phải xét lại chính sách hoàn vé, Closed Beta và tài khoản theo từng Hạng vé.
  evidence: Triage 2.10 #2 (BH, EC). `EventService.update` và `lockEventForTicketTypes` không kiểm `status`; `publishReadiness` chỉ chạy lúc `draft` → `published`. Wizard "Lưu nháp" vẫn PATCH được Sự kiện đã mở bán.
- Đã xử lý (09/11/2026): phần Hạng vé của mục trên (retro Epic 2 C1) được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`. Sự kiện khác nháp: tạo Hạng vé có phí hoặc đổi Hạng vé 0đ sang có phí khi BTC chưa đạt `paidSalesAllowed` → `409 PAID_TICKET_TYPE_NOT_ALLOWED`; xóa Hạng vé cuối → `409 LAST_TICKET_TYPE`. Trần miễn phí tính theo tổng suất các Hạng vé 0đ ở mọi Sự kiện. Phần sửa Sự kiện và form không thuộc spec này (không đổi `EventService.update`), đã ghi lại thành mục hoãn riêng ở cuối file; `ordering.sellability` (2.11-a) đã xét lại chính sách hoàn vé, Closed Beta và tài khoản nhận tiền khi bán.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: Link công khai sau khi mở bán dựng từ `window.location.origin`. Nếu deploy tách host dashboard và trang Sự kiện công khai, cần biến cấu hình origin công khai (gắn Story 4.7 / 2.11).
  evidence: Triage 2.10 #13 (BH). `publish-panel.tsx` `useOrigin()`; hiện chỉ có `NEXT_PUBLIC_API_BASE_URL`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: Epic 7 (khóa BTC) phải thay thân `organizationLocked()` trong `apps/api/src/modules/event/publish.service.ts` (đang luôn `false`) và thêm test cho nhánh `ORGANIZATION_NOT_LOCKED` chưa đạt. `sellability` cũng cần xét khóa BTC.
  evidence: Triage 2.10 #19 (BH). Chưa có cột hay hàm khóa BTC; stub có chủ đích theo spec 2.10.

## Deferred from: code review of spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-10-dieu-kien-mo-ban-va-mo-ban-su-kien.md`
  summary: `publishReadiness` chỉ export từ `apps/api/src/modules/event/publish.service.ts`, chưa qua `apps/api/src/modules/event/index.ts`; chữ ký nhận dòng Sự kiện đã đọc, không nhận `eventId`. Khi làm `ordering.sellability`, export qua `index.ts` với chữ ký mô-đun `ordering` cần, để luật điều kiện nằm một chỗ (AD-10, AD-34).
  evidence: Code review 2.10 (AA, BH). `module-graph.cjs` chỉ cho import qua `index.ts`; hiện chưa có consumer ngoài mô-đun `event`.

## Deferred from: tách phạm vi Story 2.11 khi build (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-a-sellability-va-availability.md`
  summary: Story 2.11-b — trang `/e/{slug}` trong `(public)`. Gồm SSR fetch không cookie với `next: {revalidate: 30, tags: ['event:{slug}']}`, `event-hero` (gradient coral vì chưa có ảnh 2.7-b, ngày-giờ "· 07:00 – 17:00", địa điểm mở Google Maps), hàng BTC, chia sẻ Web Share/`copyWithToast`, `status-banner` theo `eventReason` (copy theo EXPERIENCE), `ticket-tier-row` gọi `/availability` lúc tải và khi `visibilitychange`, 2 cột ≥ `lg`, `loading.tsx` Skeleton, empty-state 404, `generateMetadata` + `opengraph-image.tsx` (font tiếng Việt), `noindex` cho `hidden`. Revalidate on-demand: API enqueue job pg-boss bằng `tx` sau mỗi lần sửa Sự kiện/Hạng vé/mở bán, gọi `POST {WEB_INTERNAL_URL}/api/revalidate` kèm `REVALIDATE_SECRET`, web gọi `revalidateTag`. e2e cần mock HTTP server cho fetch SSR (`page.route` không chặn được).
  evidence: Mason chọn tách 2.11 thành 2.11-a (API) và 2.11-b (web) ngày 06/11/2026 vì spec gộp khoảng 4.000 token. Mason chọn cách revalidate qua pg-boss (AD-37) cùng ngày.

## Deferred from: tách phạm vi Story 2.11-b khi build (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-b-trang-su-kien-cong-khai.md`
  summary: Story 2.11-c — revalidate ngay trang `/e/{slug}` khi BTC sửa: queue pg-boss `event.revalidate-public-page` (payload `{slug}`, retry + dead-letter) enqueue bằng `tx` ở `event.service.update`, `publish.service.publish`, `flows/ticket-types.flow.ts` (tạo/sửa/xóa); handler ở worker `POST {WEB_INTERNAL_URL}/api/revalidate` với `Authorization: Bearer {REVALIDATE_SECRET}`; route web so secret bằng `timingSafeEqual` (sai → 401, thiếu env → 503) rồi hết hạn tag `event:{slug}` ngay; thêm hai biến env cho worker. Mẫu: `modules/organizer/invitation-jobs.ts`.
  evidence: Spec 2.11-b gộp khoảng 3.000 token; Mason chọn tách ngày 06/11/2026 vì đây là hạ tầng riêng, merge riêng được. Khi chưa có 2.11-c, trang tự làm mới sau 30 giây (tag `event:{slug}` đã gắn sẵn ở 2.11-b).

## Deferred from: code review of spec-2-11-b-trang-su-kien-cong-khai.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-b-trang-su-kien-cong-khai.md`
  summary: Checklist deploy web (Story 4.7) phải đặt `WEB_ORIGIN` (origin công khai, dùng làm `metadataBase` cho `og:image`/`og:url`) và cân nhắc `API_INTERNAL_URL` (SSR gọi api qua mạng nội bộ); thiếu `WEB_ORIGIN` ở production thì nên báo lỗi khi khởi động thay vì âm thầm dùng localhost. Kiểm luôn font OG `apps/web/assets/fonts/*.ttf` có trong image.
  evidence: Review 2.11-b #2 (BH, EC): `page.tsx` `metadataBase()` trả `undefined` khi thiếu `WEB_ORIGIN`, Next fallback `http://localhost:…`, preview Facebook/Zalo mất ảnh. Chưa có cấu hình deploy web để sửa.

## Deferred from: build of spec-2-11-c-revalidate-trang-su-kien.md (2026-11-06)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-c-revalidate-trang-su-kien.md`
  summary: Story 4.7 — `revalidateTag` ở `apps/web/app/api/revalidate/route.ts` chỉ xóa cache của instance web nhận request. Chạy nhiều instance web thì cần cache handler dùng chung (`cacheHandler`, vd. Redis) hoặc gọi revalidate tới từng instance; không thì instance khác vẫn trả bản cũ tới 30 giây. Checklist deploy cũng phải đặt cùng `REVALIDATE_SECRET` cho worker và web (web thiếu → route 503, im lặng chờ 30 giây) và cho worker tới được `WEB_ORIGIN` (nếu đi qua mạng nội bộ thì cân nhắc biến origin nội bộ riêng).
  evidence: Design Notes của spec 2.11-c. Hiện chạy một instance web; worker gọi `POST {WEB_ORIGIN}/api/revalidate`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-c-revalidate-trang-su-kien.md`
  summary: Story 4.7 — nếu đặt CDN trước web, CDN vẫn giữ bản cũ của `/e/{slug}` (ISR, `Cache-Control: s-maxage=…`) bất kể `revalidateTag`; cần purge CDN theo đường dẫn khi revalidate, hoặc không cache `/e/*` ở CDN.
  evidence: Review 2.11-c #14 (BH): route handler chỉ xóa cache của Next; CDN không biết tag `event:{slug}`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-11-c-revalidate-trang-su-kien.md`
  summary: Story nào thêm đổi tên BTC hoặc khóa BTC (Epic 7) làm đổi phần tĩnh của trang Sự kiện phải enqueue `enqueuePublicPageRevalidation` cho mọi Sự kiện không còn nháp của BTC đó.
  evidence: Review 2.11-c #15 (BH): `publicEventDetail` trả `organizationName`; hiện chưa có endpoint đổi tên nên chưa có trigger.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-12-sua-an-va-ket-thuc-som-su-kien.md`
  summary: Ẩn / Hiện lại / Kết thúc / sửa Sự kiện chưa xét khóa Sự kiện (`locked_at`) hay khóa BTC; UX yêu cầu nút "Mở bán"/"Ẩn" tắt kèm lý do khi bị khóa — làm cùng Epic 7.
  evidence: `event-status.service.ts` `transition` chỉ xét `status` và `effective_end_at`; hiện chưa có đường khóa nên chưa ai gặp (`sellability` vẫn trả `locked`). Review pass 2 #25.

## Deferred from: code review of spec-2-12-sua-an-va-ket-thuc-som-su-kien.md (2026-11-06)

- Sự kiện `cancelled` chỉ bị chặn sửa thông tin (`PATCH …/events/:eventId` → `409 EVENT_CANCELLED`); Hạng vé, câu hỏi form mua vé và `PATCH …/order-limit` vẫn ghi được, tab Hạng vé/Form mua vẫn sửa được. `form.service.ts:30` ghi "2.10/2.12 thêm guard" nhưng chưa có. Chưa ai gặp vì chưa có đường hủy Sự kiện — làm cùng Epic 7 (cùng mục khóa Sự kiện đã hoãn).

- source_spec: none
  summary: Story 2.13-b — luồng "Đổi key Tingee": xác nhận lại, nhập key mới, chọn tài khoản; credential mới thành hiện hành, tài khoản của credential cũ gỡ mềm, credential cũ giữ (mã hóa), ipnKey không đổi; audit + email cảnh báo; key sai/Tingee lỗi giữ nguyên hiện trạng.
  evidence: Tách khỏi Story 2.13 lúc bmad-build (2026-11-08) để 2.13-a làm trước phần xác nhận lại (REAUTH_REQUIRED) dùng chung cho đặt mặc định/hủy liên kết, đổi key và 2.14.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Mã TOTP dùng lại được trong cửa sổ 30 giây (Better Auth `verifyTOTP` không lưu bước thời gian đã dùng), nên một mã bị lộ cấp được nhiều lần xác nhận lại (và step-up nhiều lần); cần lưu bước TOTP đã nhận theo user và từ chối bước ≤ bước cũ.
  evidence: Review 2.13-a #3 (BH, EC). Có từ step-up (2.2); `payout-account.test.ts` đang dựa vào việc dùng lại mã (`ownerTokens(6)`), sửa thì phải đổi test.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Xóa Admin (`DELETE /orgs/:orgId/members/:memberId`) không đòi xác nhận lại, nên phiên Owner bị lộ có thể xóa hết Admin trước khi đổi tài khoản mặc định, và email cảnh báo chỉ tới hộp thư của Owner; cân nhắc thêm xóa Admin vào danh sách thao tác nhạy cảm (AD xác nhận lại) hoặc báo Admin bị xóa.
  evidence: Review 2.13-a #6 (BH). Kiến trúc hiện chỉ liệt kê đổi key, đặt mặc định, hủy liên kết, chuyển Owner; xóa Admin có từ 2.4.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Story 2.13-b — `PayoutAccountService.select` biến tài khoản đầu tiên thành mặc định (`isDefault = linkedVas.size === 0`) mà không xác nhận lại và không gửi cảnh báo; đổi key xong chọn tài khoản đầu tiên chính là đường này, nên 2.13-b phải gửi cảnh báo (payload `previousAccountId` cần cho phép null hoặc mang 4 số cuối mặc định cũ).
  evidence: Review 2.13-a #7 (BH, EC, VG). Hành vi có từ 2.6; ở 2.13-a lần hủy tài khoản cuối đã gửi cảnh báo và tài khoản mới phải cùng merchant Tingee.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-a-xac-nhan-lai-doi-noi-nhan-tien.md`
  summary: Email bảo mật (TOTP, mã xác nhận, cảnh báo đổi tài khoản mặc định) khuyên "đăng xuất khỏi mọi thiết bị" nhưng Tickee chưa có tính năng đăng xuất mọi session; cần thêm tính năng hoặc đổi câu chữ.
  evidence: Review 2.13-a #12 (BH). Câu chữ có từ `totp-email.ts` (2.2); không có route revoke-all trong `apps/api/src` hay `apps/web`.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-13-b-doi-key-tingee.md`
  summary: Các route nhận key Tingee (`POST …/payout-account/credential` của BTC chưa liên kết, `POST …/credential/replacement/preview` sau một lần xác nhận lại) không giới hạn tần suất, nên dùng được để dò key Tingee và đốt hạn mức gọi Tingee; cần giới hạn theo user/BTC trước `listAccounts`.
  evidence: Review 2.13-b #3 (BH, EC). Không có throttle nào trong `modules/organizer`, `modules/tingee`, `platform/http`; `connect` cho dò như vậy từ 2.6, `preview` lặp lại cùng mức phơi bày trong 5 phút của một lần xác nhận.

- source_spec: `_bmad-output/implementation-artifacts/spec-2-14-chuyen-quyen-owner.md`
  summary: Job email gửi nhiều người (báo chuyển quyền Owner, cảnh báo đổi tài khoản nhận tiền mặc định) gửi lại cho mọi người mỗi lần retry khi chỉ một địa chỉ lỗi.
  evidence: `notifyOwnershipTransferred` và `notifyDefaultPayoutChanged` ném lỗi khi có một email lỗi, pg-boss retry tới 8 lần và gửi lại cả danh sách; cần nhật ký đã gửi theo job hoặc tách job theo người nhận.
- Đã xử lý (11/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`, theo hướng tách job theo người nhận (không làm nhật ký đã gửi, không migration). Job gốc chốt danh sách người nhận rồi tạo mỗi người một job con trong cùng queue (`fanOut`, id con suy cố định từ id gốc và `userId`, nên job gốc chạy lại không nhân đôi con); job con gửi đúng một email, SMTP lỗi thì chỉ job con đó retry. Job enqueue trước khi deploy (không có `recipientUserId`) được xử lý như job gốc.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-1-xac-nhan-lai-khi-bat-2fa.md`
  summary: Chưa có đường khôi phục khi 2FA bị người khác bật trên tài khoản (chủ thật kẹt ở bước step-up, không có "Đặt lại TOTP" hay quy trình hỗ trợ).
  evidence: Retro Epic 2 ghi "Đặt lại TOTP" chưa có; email "2FA vừa được bật" chỉ dặn liên hệ hỗ trợ. Cần trước Closed Beta (quy trình hỗ trợ) hoặc Epic 7.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-2-huy-session-khi-doi-2fa.md`
  summary: Dialog tắt 2FA và gợi ý dùng mã khôi phục trên web chưa báo trước rằng các thiết bị khác sẽ bị đăng xuất; EXPERIENCE.md (dòng tắt 2FA) cũng chưa ghi.
  evidence: E2-2 đăng xuất mọi session khác khi gỡ 2FA nhưng spec không đổi web; câu chữ hiện ở `security-settings.tsx` và `step-up-dialog.tsx` chỉ nói "chỉ còn được bảo vệ bằng email". Ảnh hưởng người dùng nhiều thiết bị (vd. Owner đang check-in trên vài điện thoại).

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`
  summary: Sự kiện đã hủy vẫn thêm, sửa, xóa được Hạng vé (flow Hạng vé không chặn `cancelled` như `EventService.update`); câu `LAST_TICKET_TYPE` cũng không hợp với Sự kiện đã hủy.
  evidence: Review E2-3 #8. Spec 2.12 đã hoãn việc chặn sửa Hạng vé và câu hỏi form của Sự kiện đã hủy; nên làm cùng Story 7.1 (Hủy sự kiện) hoặc trước Epic 3 nếu checkout đọc Hạng vé của Sự kiện đã hủy.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`
  summary: Chưa quyết Hạng vé 0đ trong Sự kiện hỗn hợp được mua theo đường nào (miễn phí: không Token, phát Vé ngay; hay theo đường có phí), và giỏ trộn dòng 0đ với dòng có phí.
  evidence: Review E2-3 #9. Từ E2-3 trần 200 suất áp cho cả Sự kiện hỗn hợp, nhưng Story 3.3 (epics) vẫn chỉ nói "Sự kiện miễn phí". Phải ghi vào spec 3.2/3.3/3.4 (checklist E2-6) trước khi làm checkout.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-3-guard-hang-ve-sau-mo-ban.md`
  summary: Nửa còn lại của deferred 2.10: sau mở bán vẫn sửa được thông tin Sự kiện (kể cả xóa chính sách hoàn vé) và câu hỏi form mua.
  evidence: Review E2-3 #10. E2-3 chỉ đóng phần Hạng vé. Người nhận đề xuất: E2-6 (checklist sẵn sàng Epic 3, mục "snapshot chính sách hoàn vé") hoặc một story Epic 3 có tên trước 3.2.

- source_spec: none
  summary: E2-5 phần API — helper queue/worker chung cho pg-boss (gom khung 4 file `*-jobs.ts`, sửa lỗi gửi lại email cho mọi người nhận khi retry), `escapeHtml` vào `platform/email`, formatter ngày giờ `Asia/Ho_Chi_Minh` chung trong contracts, bỏ phần `MESSAGES` không dùng trong `error.filter.ts`.
  evidence: Tách khỏi E2-5 (retro Epic 2 mục D2) theo quyết định của Mason ngày 09/11/2026: phần Web làm trước để gỡ chặn Story 3.1; phần API phải xong trước story Epic 3 đầu tiên thêm queue mới (3.5 / 3.8).
- Đã xử lý (11/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`. Năm file `*-jobs.ts` dùng khung chung ở `platform/jobs/queue.ts` (`defineQueue`, `QueueProducer`, `registerQueueWorker`, `jobErrorMessage`, `fanOut`); `escapeHtml` ở `platform/email/escape-html.ts`; `formatVnDateTime` / `formatVnDate` trong `packages/contracts/src/event.ts` thay 4 chỗ tự tạo `Intl.DateTimeFormat` (api và web); `MESSAGES` của `error.filter.ts` chỉ còn 5 mã `codeForStatus` trả. `identity-janitor.ts` (job lịch cron) giữ khung riêng theo spec.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-web.md`
  summary: Đăng xuất từ menu tài khoản (`components/tickee/account-menu.tsx`) thất bại thì không báo gì, người dùng tưởng đã đăng xuất.
  evidence: Review E2-5 #15. `useSignOut` ở account-menu không có `onError`, và bản trước refactor cũng không có, tức là lỗi có từ trước. Hướng sửa: `toast.error('Chưa đăng xuất được. Vui lòng thử lại.')`.

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-web.md`
  summary: E2E `purchase-form.spec.ts:376` (sắp thứ tự câu hỏi, kiểm focus sang nút "Xuống") chập chờn trên cả android-chromium và ios-webkit.
  evidence: Chạy lặp 40 lần: baseline `14b9084` fail 4/40, bản E2-5 fail 2/40. Focus được đặt trong `requestAnimationFrame` sau `setQueryData` + `invalidateQueries` (`purchase-form-editor.tsx` ~:671-675), nên dễ đua với lần render của refetch. Nên gộp vào việc ghi các test webkit chập chờn ở E2-8.
- Đã xử lý (10/11/2026): mục trên được sửa tận gốc ở `purchase-form-editor.tsx`, không nới timeout hay thêm retry. Nguyên nhân không nằm ở refetch: TanStack Query báo cache đổi cho React qua `setTimeout(0)`, nên lần render thứ tự mới là một task riêng và có thể tới sau khung hình kế. Khi `requestAnimationFrame` chạy trước, nút "Xuống Trình độ" vẫn `disabled` theo thứ tự cũ nên `focus()` không có tác dụng. Đo bằng spec chẩn đoán tạm (ghi mỗi lần `focus()` và lúc danh sách đổi trong DOM): 6/6 lần fail đều focus trước khi đổi thứ tự, lúc nút còn `disabled`; 74/74 lần pass đều sau. Ép rAF chạy ngay thì fail 10/10. Cách sửa: `onSuccess` chỉ ghi nút đích vào ref; `useEffect` theo `questions` focus sau lần commit có thứ tự mới (cùng mẫu `pendingFocus` của form câu hỏi). Sau khi sửa: chạy lặp 40 lần pass 80/80 trên hai project; ép rAF chạy ngay thì pass 20/20.

## Deferred from: build of spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md (2026-11-09)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md`
  summary: Story 4.6 — giới hạn tốc độ theo IP cho `POST /v1/events/:slug/funnel-events` (`@Public`, không cần đăng nhập). Hiện ai cũng bơm được `buy_clicked` (mỗi lần một `funnelId` mới) làm lệch mẫu số SM-C2 và phình bảng append-only `checkout_funnel_events`; `login_completed` thì phải đi theo cặp với `buy_clicked`. Đếm trong Postgres theo HMAC IP như `google_start_events`, vượt ngưỡng thì vẫn trả 204 nhưng không ghi.
  evidence: Spec 3.1 § Never: "Không giới hạn tốc độ theo IP cho endpoint phễu ở story này (ghi vào `deferred-work.md`, gắn 4.6)". `apps/api/src/modules/ordering/funnel.service.ts` chưa có throttle.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md`
  summary: (Chưa kiểm, nếu đúng thì medium) `useBuy` ở `ticket-tiers.tsx` đặt `pending = true` và không bao giờ trả về false. Nếu Checkout redirect server về `/e/{slug}` (lựa chọn hết hợp lệ) mà App Router giữ nguyên instance `TicketPicker`, nút "Mua" sẽ quay mãi tới khi tải lại trang.
  evidence: Review 3.1 (BH, EC, VG) triage #5. Cần thử trên trình duyệt: người đã đăng nhập chọn vé, BTC hạ giới hạn Vé/Đơn (hoặc đóng giờ bán), bấm "Mua", rồi xem nút có bấm lại được không. Đúng thì reset `pending` khi URL đổi, hoặc dùng `useTransition`. Nên làm cùng 3.2, lúc thanh mua được dùng lại ở Checkout.

## Deferred from: build of spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md (2026-11-10)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md`
  summary: Story 4.6 — dọn dòng cũ của `order_create_attempts` (bộ đếm giới hạn tốc độ tạo Đơn). Bảng chỉ cần các dòng trong cửa sổ 10 phút gần nhất nhưng hiện không có job nào xóa, nên phình theo mỗi lần thử tới được TX1 (kể cả lần hết vé của kịch bản NFR-3).
  evidence: Spec 3.2 § Design Notes: "Dọn `order_create_attempts` cũ để vào deferred (4.6)." `apps/api/src/modules/ordering/order-rate-limit.ts` chỉ INSERT; nên gộp vào quét định kỳ lưới an toàn của 4.6 (`DELETE … WHERE created_at < now() - interval '10 minutes'`).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-chon-ve-va-dang-nhap-khi-bam-mua.md`
  summary: (Đã kiểm ở 3.2) Deferred 3.1 #5 — nút "Mua" kẹt `pending` khi Checkout redirect về `/e/{slug}` — không tái hiện được trên trình duyệt: sau redirect App Router dựng lại `TicketPicker` (URL đổi từ `?items=…` thành không query), state về mặc định. 3.2 vẫn chuyển `useBuy` sang `useTransition` (spinner hết khi điều hướng xong) và thêm e2e `purchase.spec.ts` › "Mua" không kẹt; e2e đó cũng qua với mã cũ, nên chỉ là test hồi quy, không chứng minh lỗi cũ.
  evidence: Chạy e2e "Mua không kẹt khi Checkout redirect về lại trang Sự kiện" trên bản build dùng `useBuy` cũ (`setPending(true)` không bao giờ về false): 2/2 qua (ios-webkit, android-chromium).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md`
  summary: (Chưa kiểm, nếu đúng thì medium) TX1 tạo Đơn chờ khóa Sự kiện và tồn kho mà không có `lock_timeout`. Lúc tải cao, các TX1 đang chờ chiếm hết 10 kết nối pool, nên request khác có thể lỗi sau 3 giây chờ kết nối.
  evidence: Review 3.2 (EC) triage #16. `orders.service.ts` `placeOrder` chạy trong `db.transaction`, không đặt `SET LOCAL lock_timeout`. Muốn kết luận thì đo trong kiểm thử tải NFR-3 (Story 5.8): 5.000 người mua 300 Vé, xem có lỗi chờ kết nối pool hay không. Nếu có, đặt `lock_timeout` cho TX1 và map `55P03` sang 503 để thử lại.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-checkout-va-giu-cho-khong-ban-qua-so-suat.md`
  summary: (Chưa kiểm, nếu đúng thì medium) Trong flash sale, các TX1 giữ khóa `FOR SHARE` trên dòng `events` nối tiếp nhau liên tục, có thể bỏ đói lệnh `FOR UPDATE` của BTC (Ẩn, Kết thúc, sửa Hạng vé) tới khi hết người mua.
  evidence: Review 3.2 (EC) triage #17. `lockSaleEventBySlug` dùng `FOR SHARE`, và Postgres cho khóa tương thích vào trước người ghi đang chờ. Muốn kết luận thì viết test giữ `FOR SHARE` chồng nhau liên tục từ nhiều client, rồi đo thời gian chờ của một `FOR UPDATE`. Nếu đúng, cân nhắc đặt `lock_timeout` cho lệnh của BTC kèm câu báo rõ ràng, hoặc một khóa xếp hàng công bằng.

## Deferred from: build of spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md (2026-11-10)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 4.7. Kiểm cấu hình lúc deploy: `TICKET_QR_KEYS` phải khác `TINGEE_CREDENTIAL_KEYS`, và production không được dùng khóa mẫu trong `.env.example`. Lộ khóa ký thì ai cũng giả được Mã QR vé.
  evidence: Review 3.3 (BH) triage #9. `config.schema.ts` chỉ kiểm định dạng. Lỗ này có sẵn với mọi bí mật trong `.env.example`, kể cả `TINGEE_CREDENTIAL_KEYS`, nên gom vào checklist cấu hình production của 4.7: refine khóa khác nhau, chặn giá trị mẫu khi `NODE_ENV=production`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-dang-ky-su-kien-mien-phi-va-nhan-ve-ngay.md`
  summary: Story 4.7/4.6. Quy trình xoay khóa QR. Nếu gỡ khỏi `TICKET_QR_KEYS` một phiên bản khóa mà còn Vé đang dùng, thì `GET /v1/me/orders/:code` của các Đơn đó trả 500. Hiện chưa có lệnh tra phiên bản nào còn dùng, chưa kiểm lúc khởi động, cũng chưa có công cụ ký lại (`qr_key_version` vẫn sửa được để phục vụ việc này).
  evidence: Review 3.3 (BH) triage #8. `ticketsOfOrder` → `signTicketQr` ném lỗi khi thiếu khóa, đúng như thiết kế; README đã dặn giữ khóa cũ. Cần một runbook xoay khóa (`SELECT DISTINCT qr_key_version FROM tickets`), và tùy chọn kiểm lúc khởi động.
- Ghi thêm (13/11/2026, retro Epic 3 D1, E3-5): phạm vi xoay khóa rộng hơn Trang Đơn. Token link chia sẻ (AD-29, `ticketing/share-token.ts`) là HMAC bằng khóa con suy từ khóa `qr_key_version` của Vé. (1) Gỡ một phiên bản khóa: route công khai `GET /v1/shared-tickets/:token` 500, Chi tiết Vé 500, job email Vé retry rồi vào dead-letter. Spec nhỏ trước 4.1 sửa route công khai về `404` chung và thêm test Vé khóa cũ (Sprint Change Proposal 13/11/2026 §4.6); Chi tiết Vé, Trang Đơn và email vẫn là lỗi cấu hình. (2) Ký lại bằng `UPDATE tickets SET qr_key_version = 2`: QR đúng nhưng `share_token_hash` vẫn là hash của token cũ, nên mọi link, kể cả trong email đã gửi, 404 im lặng. Runbook của 4.7 phải chọn một trong ba: giữ khóa cũ trong `TICKET_QR_KEYS` tới khi mọi Vé của nó qua `effective_end_at` (chỉ ngừng ký Vé mới bằng khóa đó); công cụ ký lại tính lại `share_token_hash` và gửi lại email Vé (link cũ chết); hoặc tách khóa link chia sẻ khỏi khóa QR (đổi AD-29). Kèm lệnh tra `SELECT qr_key_version, count(*) FROM tickets WHERE status = 'valid' GROUP BY 1`.
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

## Deferred from: code review of spec-epic-2-e2-5-refactor-api.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`
  summary: `errorName` (lấy tên lớp lỗi để lỗi lưu vào job không chứa PII) vẫn bị chép y hệt ở `organizer/ownership-transfer-jobs.ts` và `organizer/payout-default-jobs.ts`, có thêm bản inline trong `invitation-jobs.ts`. Phần tra tên BTC cũng lặp (`organizationName()` và truy vấn trong `loadChange()`). Nên gom `errorName` vào `platform/jobs` cạnh `jobErrorMessage`.
  evidence: Review E2-5 API #11 (BH). Phần lặp này có từ trước baseline `4cb9ff3`, không do E2-5 gây ra. Gom khi story kế tiếp thêm job email (3.8 email Vé) để nơi chặn PII chỉ còn một chỗ.
- Đã xử lý (11/11/2026): phần `errorName` của mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md`. `errorName` nằm ở `platform/jobs/queue.ts` cạnh `jobErrorMessage`; ba chỗ chép ở `organizer` (`invitation-jobs.ts`, `ownership-transfer-jobs.ts`, `payout-default-jobs.ts`) và job email Người mua mới của `ordering` đều dùng bản chung. Phần tra tên BTC lặp trong `organizer` chưa gom.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-2-e2-5-refactor-api.md`
  summary: Chưa có test worker kiểm `PublicPageWorker` gộp theo slug (`dedupeBy`) và chạy song song (`parallel`): hai job cùng slug trong một lô phải chỉ gọi web một lần, và cả hai job đều `completed`.
  evidence: Review E2-5 API #19 (VG). Helper đã có unit test cho `parallel` và `dedupeBy` (`test/platform/jobs-queue.test.ts`), nhưng test của public-page chỉ gửi một job mỗi slug. Nếu bỏ hai option này khỏi `public-page-jobs.ts`, mọi test vẫn qua. Trước E2-5 cũng chưa có test này; hậu quả chỉ là gọi revalidate thừa hoặc chậm hơn.

## Deferred from: planning spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md`
  summary: Chặn hai BTC kết nối cùng một merchant Tingee (cùng Client ID hiện hành) ở bước kết nối (Story 2.6) và đổi key (Story 2.13-b), vd. unique một phần trên `tingee_credentials.client_id WHERE retired_at IS NULL` + lỗi 409. Làm trước khi mở bán Vé có phí.
  evidence: Mason chốt 11/11 khi lập spec 3.5 (phương án A): giữ AD-7, Đơn phải thuộc BTC sở hữu `ipnKey`. Portal Tingee chỉ có một URL IPN cho mỗi merchant, nên nếu hai BTC dùng chung merchant thì IPN của BTC thứ hai rơi vào nhánh Tài khoản lệch và không tự phát Vé. Mục này đóng câu hỏi ở mục "Deferred from: code review of spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md" (hai BTC chung merchant).

## Deferred from: code review of spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-5-nhan-ipn-va-phat-ve-dung-mot-lan.md`
  summary: IPN có `status` khác chữ thường hay đánh vần khác (`SUCCESS`, `Success`, `cancelled`) bị coi là trạng thái lạ: chỉ lưu, không phát Vé, không hết hạn Đơn; IPN trạng thái cho Đơn của BTC khác hay Đơn không còn `pending` chỉ log mức info (`stored`).
  evidence: Review 3.5 vòng 1 #14 (BH, EC; maybe-false, nếu đúng là medium). Tài liệu Tingee chỉ ghi `success`/`expired`/`canceled` chữ thường. Cách chốt: lấy IPN thật từ Tingee UAT (test hợp đồng, Story 4.7, hoặc thử tay) và xem `status` đúng chữ nào; nếu khác thì chuẩn hóa `trim().toLowerCase()` và nhận cả `cancelled`.

## Deferred from: build of spec-3-6-ipn-cho-cac-truong-hop-bien.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-ipn-cho-cac-truong-hop-bien.md`
  summary: Story 4.6. Nối kênh cảnh báo vận hành thật cho tiền về không khớp Đơn nào của BTC (`unmatched`: mã đúng định dạng mà không có Đơn, hoặc Đơn thuộc BTC khác). Hiện chỉ có log mức `error` kèm trường `alert: 'payment_unmatched'` (hằng `PAYMENT_UNMATCHED_ALERT` của `payment`) và mục Cần xử lý `unmatched`.
  evidence: `apps/api/src/modules/payment/ipn-processor.ts` (`process`, nhánh `order_not_found`/`other_organization`). Test ghim marker ở `apps/api/test/payment/ipn-edge.test.ts` ("Matrix: không khớp Đơn của BTC"). 4.6 nên bắt theo marker này (hoặc thay log bằng lời gọi kênh cảnh báo) để không ai phải đọc log mới biết tiền đã về.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-6-ipn-cho-cac-truong-hop-bien.md`
  summary: Story 3.8. Email báo Người mua khi tiền về muộn cho Đơn đã hết hạn mà không phát được Vé (mục `orphan`, lý do `sold_out`): "BTC đã nhận tiền nhưng Hạng vé đã hết, BTC sẽ liên hệ hoàn tiền". Enqueue bằng chính `tx` của IPN, cùng hàng đợi email Người mua mà 3.8 dựng.
  evidence: Mason chốt 11/11 khi lập spec 3.6: 3.6 chỉ tạo mục `orphan`, không thêm hàng đợi hay mẫu email; lệch có chủ đích so với câu "enqueue email báo Người mua" trong AC 3.6 của epics. Chỗ gắn: `ordering/mark-paid.ts` (`settleIpn`, nhánh `sold_out`) hoặc `payment/ipn-processor.ts` (sau `openReviewItem` loại `orphan`).
- Đã xử lý (11/11/2026): mục trên được giải quyết bằng `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md`. `settleIpn` (nhánh `sold_out`) enqueue job `orphan_sold_out` của hàng đợi `ordering.send-buyer-email` trong chính `tx` của IPN; worker gửi "BTC đã nhận tiền nhưng Hạng vé đã hết, BTC sẽ liên hệ hoàn tiền." kèm mã Đơn, tên Sự kiện và kênh liên hệ BTC tới `orders.buyer_email` (bỏ qua nếu Đơn không còn `review`). Các lý do `orphan` khác (`event_ended`, `event_locked`) vẫn không có email.

## Deferred from: build of spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md (2026-11-11)

- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: AI-6. Ca Playwright full-stack cho Trang Đơn tự chuyển "Thành công": web build thật + api thật + Postgres + Tingee fake, Người mua đặt Đơn có phí, tab ở nền, bắn IPN từ Tingee fake, quay lại tab thấy Thành công < 3 giây; kèm kiểm CORS và cookie của `EventSource` cross-origin (`withCredentials`).
  evidence: Mason chốt 11/11 khi lập spec 3.7: test chia hai tầng. Playwright (`apps/web/e2e/order-live.spec.ts`) giả API và luồng SSE bằng `page.route`; test tích hợp api (`apps/api/test/ordering/order-live.test.ts`) đo IPN → tín hiệu trên stream SSE thật < 1 giây. CORS và cookie của SSE thật mới kiểm bằng tay với `pnpm dev`. Lệch có chủ đích so với câu "test Playwright với Tingee fake" trong AC 3.7; gom vào phần e2e full-stack còn lại của AI-6.
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
- source_spec: `_bmad-output/implementation-artifacts/spec-3-7-trang-don-tu-chuyen-thanh-cong-theo-thoi-gian-thuc.md`
  summary: Story 7.1. Khi hủy Sự kiện, phát `order_changed` (`realtime.notify` trong chính `tx` hủy) cho mọi Đơn bị ảnh hưởng của Sự kiện, kể cả Đơn mà `status` không đổi; hoặc thêm một tín hiệu cấp Sự kiện mà bộ lọc của `GET /v1/me/orders/:code/live` cũng nhận.
  evidence: `buyerStatus` của Đơn `paid`/`review`/`cancelled`/`refunded` thành `event_cancelled` chỉ vì `events.status = 'cancelled'` (`ordering/buyer-status.ts`), không có CAS nào trên `orders` nên không có `order_changed`. Trang Đơn đang mở (đã `paid` hay `under_review`: không polling) sẽ đứng ở trạng thái cũ, vẫn hiện Mã QR vé, tới khi tải lại hoặc tab visible lại. Bộ lọc hiện tại ở `orders.controller.ts` › `live` chỉ nhận `order_changed` có `id` trùng Đơn.
- Ghi thêm (12/11/2026, `_bmad-output/implementation-artifacts/spec-3-9-ve-cua-toi-va-chi-tiet-ve.md`): stream `GET /v1/me/tickets/live` của "Vé của tôi" cũng chỉ nhận `order_changed` (lọc theo tập id Đơn của người xem), nên Vé của Sự kiện vừa hủy vẫn hiện "Hợp lệ" trên danh sách đang mở tới lần tải sau (tab hiện lại, có mạng lại). Chi tiết Vé tải lại mỗi lần mở nên không bao giờ ký QR cho Sự kiện đã hủy. 7.1 phát tín hiệu thì cả hai trang tự đúng.

- source_spec: `_bmad-output/implementation-artifacts/spec-3-8-email-ve-va-link-chia-se-ve.md`
  summary: Người mua đã trả tiền mà không có Vé vì lý do khác `sold_out` (mục Cần xử lý `orphan` `event_ended`/`event_locked`, `amount_mismatch`, `event_cancelled`) không nhận email nào; cần quyết có gửi email báo (vd. "BTC sẽ liên hệ") qua hàng đợi `ordering.send-buyer-email` hay để BTC tự liên hệ (Story 4.4/7.1).
  evidence: Review 3.8 (BH) triage #7. Có từ trước 3.8: AC 3.6 trong epics chỉ đòi email cho `sold_out`, 3.8 làm đúng phần đó. Các nhánh khác chỉ tạo `review_item`; Trang Đơn hiện `under_review` + kênh liên hệ BTC nhưng Người mua phải tự mở lại trang mới biết.

## Deferred from: build of spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md (2026-11-12)

- Đã xử lý (12/11/2026): phần spec 2.12 hoãn sang 3.10 (Boundaries › "email báo Người mua khi đổi giờ/địa điểm") được giải quyết bằng `_bmad-output/implementation-artifacts/spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md`. `PATCH /v1/orgs/:orgId/events/:eventId` chuyển sang `flows/event-edit.controller.ts` (flow `updateEvent`), cột `events.time_venue_version` (migration 0022), queue `ordering.send-event-change-email` (job gốc theo `(eventId, version)`, job con theo Người mua), `GET …/buyer-count`, `Dialog` "Email sẽ được gửi tới {n} Người mua." ở tab Cài đặt.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md`
  summary: Không giới hạn số lượt email đổi giờ/địa điểm: mỗi lệnh sửa có đổi giờ/địa điểm là một lượt gửi cho mọi Người mua (spec cấm hợp nhất), nên BTC sửa địa điểm nhiều lần liên tiếp (hoặc phiên BTC bị lộ) gửi bấy nhiêu email cho mỗi người. Cần chốt có giới hạn theo Sự kiện/giờ hay gom trong một khoảng ngắn (vd. job gốc `startAfter` vài phút, chỉ gửi bản mới nhất) không.
  evidence: `flows/event-update.flow.ts` enqueue mỗi phiên bản một job gốc; `Dialog` của web là chặn duy nhất. Spec 3.10 › Never: "Không hợp nhất các lượt gửi khi BTC sửa liên tiếp".
- source_spec: `_bmad-output/implementation-artifacts/spec-3-10-bao-nguoi-mua-khi-doi-gio-hoac-dia-diem.md`
  summary: Lỗi lặp ở `e2e/event-settings.spec.ts` › "Kết thúc qua Dialog…" trên ios-webkit: bấm tab "Tổng quan" (`router.replace` bỏ `?tab=`) rồi `page.goto` ngay thì hai lần điều hướng đè nhau ("interrupted by another navigation"). Đã thêm `waitForURL` trước `goto` trong test này; các spec khác đổi tab rồi `goto` ngay có thể cùng kiểu.
  evidence: Kiểm chứng 3.10 (12/11): bản baseline `1dd0d0e` chạy riêng ca này 10 lần trên ios-webkit fail 2; sau khi chờ URL, 10/10 pass. Nên gộp vào việc ghi các test chập chờn ở E2-8.

## Deferred from: build of spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md (2026-11-12)

- Quyết định (12/11/2026): phần còn lại của E2-6 không làm ở 3.11. Mason quyết khi lập spec 3.11: nhãn trạng thái bán trên dashboard (đang tự tính ở `apps/web/app/(dashboard)/btc/[orgId]/su-kien/event-status.ts`, lệch `sellability`, retro Epic 2 C5) chuyển hẳn sang Story 4.2; 3.11 không đổi `event-status.ts`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: Story 4.2. Nhãn trạng thái bán của Sự kiện trên dashboard (danh sách Sự kiện, badge thẻ "Thông tin" của tab Tổng quan) đọc theo `sellability` thay vì tự tính từ `status`/`effectiveEndAt` ở web.
  evidence: Retro Epic 2 C5, E2-6 (`sprint-status.yaml`). Spec 3.11 › Boundaries › Quyết định của Mason (12/11).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: Story 4.4. Thao tác trên `review_items` mà không đổi trạng thái Đơn (vd. "Đã hoàn tay"/"Bỏ qua" mục `amount_mismatch` của Đơn vẫn ở `review`) phải phát `event_orders_changed` trong cùng `tx`, để dòng loại Cần xử lý của "Đơn gần đây" đổi theo mà không cần tải lại.
  evidence: 3.11 chỉ phát `event_orders_changed` ở các điểm phát `order_changed` (đổi trạng thái hoặc link của Đơn) và sau commit TX1. `review` của `RecentOrder` lấy từ mục `open` cũ nhất (`payment.openReviewsOf`), nên đóng mục mà Đơn không đổi trạng thái thì Tổng quan đang mở chỉ đúng lại ở lần tải sau (tín hiệu khác, tab hiện lại).
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: Story 7.1. Chốt cách tính doanh thu trên Tổng quan sau khi hủy Sự kiện, và phát `event_orders_changed` khi hủy (cùng chỗ với `order_changed` của mục 7.1 ở phần 3.7 phía trên) để Tổng quan đang mở đổi theo.
  evidence: Spec 3.11 › Never: "Không đặt luật doanh thu riêng cho Sự kiện đã hủy (7.1 quyết)". Hiện `ordering.eventRevenueOf` cộng mọi Đơn `paid` bất kể Sự kiện đã hủy.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-11-tong-quan-su-kien-thay-don-dau-tien-ngay-lap-tuc.md`
  summary: `GET …/overview` đọc doanh thu và "Đơn gần đây" bằng hai câu độc lập (READ COMMITTED, chạy song song), nên một lần trả lời có thể lệch nhau đúng một Đơn vừa đổi giữa hai câu (vd. Đơn hiện "Đã thanh toán" mà "· n Đơn" chưa tăng). Tín hiệu của chính thay đổi đó làm web tải lại ngay sau, nên tự đúng. Nếu cần khớp tuyệt đối thì chạy cả ba câu trong một transaction `REPEATABLE READ READ ONLY`.
  evidence: `reporting/event-overview.service.ts` › `overview`. Chấp nhận ở 3.11 vì REST là sự thật và mỗi thay đổi đều kèm tín hiệu tải lại (AD-17).

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

## Deferred from: code review of spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md (2026-11-12)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md`
  summary: Không test nào ghim `markPaid` (`ordering/mark-paid.ts`, nhánh tiền về muộn) đọc đồng hồ bằng `dbClock` (`clock_timestamp()`) thay vì `dbNow`. Cần một test trong `test/ordering/mark-paid-ipn.test.ts` theo kiểu `pool.connect()` + `BEGIN` của các test `*-concurrency`: một client khác giữ `SELECT … FROM events WHERE id = $1 FOR UPDATE`, gọi IPN `paid` cho tới khi bị chặn, chuyển `effective_end_at` sang một mốc trôi qua trong lúc chờ rồi `COMMIT`, kiểm `{ outcome: 'orphan', reason: 'event_ended' }`; thêm biến thể không đổi giờ kết thúc, kiểm `issued_at` ≥ lúc nhả khóa.
  evidence: Review E3-7 (E2 + E3) VG triage #1 (medium). Sau khi gom, `dbNow` và `dbClock` cùng nằm trong barrel `platform/db`, chỉ khác một chữ. Đổi `mark-paid.ts` sang `dbNow` thì mọi test hiện có vẫn pass (`mark-paid-ipn.test.ts`, `ipn.test.ts`, `ipn-edge.test.ts` đều đọc đồng hồ ngay sau khi transaction bắt đầu). Hậu quả nếu đổi nhầm: IPN bắt đầu trước `effective_end_at` nhưng lấy được khóa sau mốc đó vẫn phát Vé cho Sự kiện đã kết thúc. Khoảng trống có từ trước refactor; hợp với phần chạm `markPaid` của Epic 4 (Story 4.1, 4.4).
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-7-e2-e3-tach-orders-service-va-dong-ho-db.md`
  summary: Mục hoãn của review D3 ở trên (test giả `Date` của app cho `event/public-event.ts` › `endedNow`, ghi "nên làm cùng mục gom đồng hồ DB của E3-7") vẫn mở. Việc gom đồng hồ DB của E3-7 chỉ gom câu `SELECT now()`/`SELECT clock_timestamp()` đứng riêng về `platform/db/clock.ts`; `endedNow` là `now()` viết nội tuyến, spec giữ nguyên nên test đó không thuộc phạm vi.
  evidence: Review E3-7 (E2 + E3) BH triage #3. Chưa có story nhận; nên làm khi một story Epic 4 chạm `endedNow` hoặc luật "Kết thúc" (E3-2, Story 4.2).

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
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (C2). Đo trong bài test tải: commit có `NOTIFY` bị Postgres tuần tự hóa, và một số transaction vẫn `NOTIFY` khi đang giữ khóa dòng `ticket_type_inventory`; 3.11 thêm một commit `NOTIFY` cho mỗi Đơn. Nếu nghẽn thì dời `NOTIFY` ra sau khóa nóng hoặc gom.
  evidence: `ordering/order-changed.ts:36-40` (đã cấm `NOTIFY` trong TX1 vì lý do này); `notifyOrderChanged` ở `mark-paid.ts:134,336`, `order-jobs.ts:117,142`, `payment-link.ts:251`; `announceOrderCreated` ở `orders.service.ts:161`. Spec 3.11 triage #2 chỉ xét round trip. Chưa đo trên PG 18. Retro Epic 3 C2 (MEDIUM, chưa đo).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (D4). Fan-out email đổi giờ/địa điểm gửi tuần tự, SMTP không pool. Đo với N lớn trên Mailpit; nếu chậm thì bật pool hoặc chạy job con song song.
  evidence: vòng gửi ở `ordering/event-change-email-jobs.ts:203`, `createTransport` không pool ở `platform/email/smtp-transport.ts:15`. Retro Epic 3 D4 (LOW, chưa đo).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.8 (NFR-1). AC 3.4 "p95 tạo link dưới 2 giây" chưa có test hay ghi chép nào. Đo trong 5.8 (Tingee fake có độ trễ cấu hình được, đo từ gửi Đơn tới khi có checkout URL) và ghi vào báo cáo tải.
  evidence: Spec 3.4 và các mục trước của file này không nhắc. Retro Epic 3 E5.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.6 và 5.8 (A2). Giữ chỗ hàng loạt bằng nhiều tài khoản OTP. Server tạo link ngay sau TX1, nên mỗi Đơn có phí giữ chỗ khoảng 20 phút (15 phút link + 5 phút ân hạn), không phải 60 giây. Giới hạn hiện có theo user và theo IP; chưa có trần số Vé đang giữ. Cần quyết trước 4.6: trần Vé đang giữ (theo IP hoặc theo Sự kiện), hay chỉ tạo link khi Người mua bấm "Thanh toán". 4.6 nhận phần cảnh báo, 5.8 đo.
  evidence: Retro Epic 3 A2 (MEDIUM) và câu hỏi mở 5. Chưa có trong bảng triage của 3.2/3.4.
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 4.7 (C4). Checklist deploy: edge phục vụ API bằng HTTP/2. Ba loại trang giữ SSE dài hạn tới cùng origin API (Trang Đơn, Vé của tôi, Tổng quan), mà HTTP/1.1 chỉ cho 6 kết nối mỗi origin.
  evidence: Spec 3.7 #8, #28 reject với tiền đề "≥ 6 tab Trang Đơn"; 3.9 và 3.11 thêm hai loại trang. Retro Epic 3 C4 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 7.4 (B7). Nối cờ "BTC bị khóa" thật vào `organizationLocked` và thêm ca test nhánh "BTC bị khóa" của AD-7 bước 6 tại `markPaid`.
  evidence: `event/sale-rules.ts:20-22` (`organizationLocked` luôn `false`), `ordering/mark-paid.ts:266`. Retro Epic 3 B7 (LOW).
- source_spec: `_bmad-output/implementation-artifacts/epic-3-retro-2026-11-12.md`
  summary: Story 5.3 (D5). `/xem-ve` (người nhận link chia sẻ) không giữ màn hình sáng, khác Chi tiết Vé. Người đi cùng thường là người đưa QR ở cổng. Khi làm màn quét, thêm Screen Wake Lock cho `/xem-ve` bằng hook của 3.9. Chấp nhận thiếu ở MVP nếu 5.3 không kịp.
  evidence: Hook Wake Lock ở `apps/web/lib/tickets/wake-lock.ts` (spec 3.9). Đúng phạm vi spec 3.8. Retro Epic 3 D5 (LOW).

## Deferred from: code review of spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md (2026-11-13)

- Đã xử lý (13/11/2026): phần (1) "route công khai 500" của mục "Ghi thêm (13/11/2026, retro Epic 3 D1, E3-5)" ở phần "build of spec-3-3" được giải quyết bằng `_bmad-output/implementation-artifacts/spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md`. `GET /v1/shared-tickets/:token` của Vé có khóa QR không có trên instance trả `404 SHARED_TICKET_NOT_FOUND` chung (xét sau mọi lý do 404 khác), log `error` có marker `ticket_qr_key_missing`. Test xoay khóa ở `test/ticketing/qr-key-rotation.test.ts`. Phần (2) (runbook ký lại, chọn phương án) vẫn thuộc Story 4.7.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md`
  summary: Story 4.6. Nối cảnh báo vận hành cho marker `alert: 'ticket_qr_key_missing'` (hằng `TICKET_QR_KEY_MISSING_ALERT` của `ticketing`) và gộp trùng theo `(qrKeyVersion, currentVersion)`. Lý do: route công khai không giới hạn tốc độ, nên mỗi lần mở link (kể cả bot xem trước link của app chat) là một dòng `error`.
  evidence: `ticketing/tickets.service.ts` › `sharedTicket`. Payload `{ ticketId, eventId, qrKeyVersion, currentVersion, alert }`. Nếu `qrKeyVersion < currentVersion` thì khóa cũ đã bị gỡ; nếu `qrKeyVersion > currentVersion` thì instance chưa có khóa mới (deploy dần, rollback). Test ghim marker: `test/ticketing/qr-key-rotation.test.ts`. Review E3-5 D1 #1 (low, bỏ khỏi spec vì throttle cần thêm state), #8.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-5-link-chia-se-thieu-khoa-qr.md`
  summary: Story 4.6/4.7. Khi thiếu khóa QR, các đường còn lại (Chi tiết Vé `ownTicket`, Trang Đơn và email Vé qua `ticketsOfOrder`, "Tạo lại link") vẫn ném `Error` thường; `ErrorFilter` log "Lỗi không bắt được" không có marker. 4.6 nên gắn marker `ticket_qr_key_missing` cho các lỗi này (tại chỗ ném hoặc trong filter), mã trạng thái giữ nguyên. 4.7 nên thêm kiểm lúc khởi động: `SELECT DISTINCT qr_key_version FROM tickets WHERE status = 'valid'` so với `keys.has`, để bắt xoay khóa sai trước khi người dùng gặp.
  evidence: `ticketing/my-tickets.ts:128-129`, `ticketing/tickets.service.ts` › `ticketsOfOrder`/`regenerateShareLink`, `platform/http/error.filter.ts:57`. Có từ trước spec E3-5 D1; spec giữ các đường này là lỗi cấu hình (Sprint Change Proposal 13/11/2026 §4.6). Review E3-5 D1 #2 (medium, defer).

## Deferred from: code review of spec-epic-3-e3-9-moi-truong-dev-va-quy-trinh.md (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-9-moi-truong-dev-va-quy-trinh.md`
  summary: Hai nhánh story mở cùng lúc luôn xung đột ở dòng `last_updated` của `sprint-status.yaml` khi merge PR thứ hai. Cần một luật: hoặc không cập nhật `last_updated` trong commit trên nhánh, hoặc README ghi cách gỡ xung đột (giữ giá trị mới hơn) trên nhánh trước khi merge.
  evidence: Có từ trước E3-9. `sync-sprint-status.md` của bmad-build (step-03 đặt `in-progress`, step-05 đặt `review`) vốn đã cập nhật `last_updated` trên nhánh. Override `on_complete` của E3-9 thêm một lần cập nhật nữa. Review E3-9 #14 (BH, ECH; medium, defer).

## Deferred from: build of spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md (2026-11-13)

- Đã xử lý (13/11/2026): mục Story 4.1 (B4) ở "retrospective Epic 3 — bàn giao có story nhận" phía trên. Mason quyết (spec 4.1 › Quyết định của Mason 13/11): IPN `expired`/`canceled` vẫn nhả chỗ ngay (AD-4 (b)), `applyStatus` không đổi. Tiền về sát giờ được bắt bởi các mốc tra sau hết hạn (`expires_at` + 30 phút, + 2 giờ, + 24 giờ) và nhánh bán lại có điều kiện của `markPaid`.
- Đã xử lý (13/11/2026): mục Story 4.1 (B5) ở cùng phần. `IpnProcessor.process(organizationId, ipn, source)` nhận nguồn (`ipn` mặc định, `reconciliation`), `markPaid` nguồn `reconciliation` đi cùng khóa và bước 3–7, thêm kết quả `already_settled`. Phần "mã giao dịch trùng giữa IPN và kết quả tra" vẫn mở: xem mục "hợp đồng tạm" và mục "Thanh toán trùng giả" dưới đây.
- Đã xử lý (13/11/2026): mục Story 4.1 (C5) ở cùng phần. Trang Đơn poll 30 giây khi SSE mất với Đơn `expired` mà `serverNow < expiresAt + 24 giờ` (`apps/web/lib/order/live.ts`). Thẻ "Hết hạn" 30 phút của Vé của tôi giữ nguyên: SSE `liveOrderIds` đã gồm mọi Đơn nên Vé đến muộn vẫn hiện.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Thay hợp đồng tạm của API tra đơn Gateway bằng hợp đồng thật khi Tingee trả lời: đường dẫn, body, tên trường của `data`, mã "không tìm thấy" và cách ký. Chỉ sửa `apps/api/src/modules/tingee/tingee.client.ts` (`TINGEE_GET_ORDER_PATH`, `getGatewayOrder`), `tingee/errors.ts` (`TINGEE_ORDER_NOT_FOUND_CODE`) và Tingee fake (`apps/api/test/tingee-fake/server.ts`), rồi bật `TINGEE_ORDER_STATUS_QUERY` ở staging. Nếu `data` không dùng tên trường của IPN thì `getGatewayOrder` đổi sang dạng IPN trước khi trả (worker đưa kết quả qua `TingeeIpn`).
  evidence: Tài liệu công khai của Tingee đọc ngày 13/11/2026 chỉ có `create-link`. Hợp đồng tạm ở spec 4.1 › Design Notes: `POST /v1/payment-gateway/get-order` `{requestId, orderId}` → `00` + `data` tên trường IPN, `2004` không tìm thấy. Cờ worker mặc định tắt; `.env.example` và `workerConfig()` của test bật.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Rủi ro "Thanh toán trùng" giả: Đối soát bù phát Vé trước, rồi IPN của cùng khoản tiền tới sau mang `providerTransactionCode` khác mã của kết quả tra → IPN đi bước 4 của AD-7 thành mục `duplicate_payment` dù Người mua chỉ trả một lần. Chỉ đóng được khi Tingee xác nhận mã giao dịch của kết quả tra trùng mã của IPN (khi đó unique `(organization_id, provider_transaction_code)` của `payment_events` chặn). Nếu Tingee xác nhận mã khác nhau thì cần khóa chống lặp khác (vd. `billId`, hoặc `(orderId, paidAmount)` cho Đơn đã `paid` qua `reconciliation`).
  evidence: Spec 4.1 › Design Notes "Vì sao `already_settled` thay vì `duplicate_payment`". Chiều ngược lại (IPN tới trước, kết quả tra mang mã khác) đã đóng bằng `already_settled` (`test/payment/reconciliation.test.ts` › "Đua khác mã"). Retro Epic 3 B5.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Story 5.8. Đo tải tra trạng thái lên giới hạn 20 request/10 giây của Tingee (theo key merchant). Mỗi Đơn có link tạo tối đa 7 lần tra (dừng sớm khi Đơn đã chốt; thêm tối đa 3 lần tra lại mỗi mốc khi lỗi); worker tra tuần tự nhưng không có bộ hãm theo merchant, nên một đợt mở bán lớn của một BTC (nhiều Đơn cùng mốc + 2 phút) có thể dồn quá giới hạn. Nếu chạm giới hạn thì thêm hãm theo `clientId` hoặc giãn mốc theo nhóm.
  evidence: `ordering/reconciliation-jobs.ts` (lịch, `batchSize` 10, tuần tự), `payment/reconciliation-worker.ts`. Chưa đo. Lỗi do giới hạn tốc độ hiện đi nhánh "mã lạ" → tra lại sau 1, 2, 4 phút, nên tự giãn nhưng có thể chạm trần 4 lỗi và dừng kèm cảnh báo.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Story 4.2/4.6. Chuỗi Đối soát bù dừng ở lỗi lần thứ 4 liên tiếp (gồm lúc BTC bị `MERCHANT_SUSPENDED` hay Tingee ngừng vài phút) thì mất luôn các mốc sau, kể cả `expires_at` + 2 giờ, + 24 giờ là các mốc bắt tiền về muộn. 4.2 khi mở lại dịch vụ ("Đối soát bù mọi Đơn còn mở của BTC") nên tra cả Đơn `expired` từng có link còn trong 24 giờ sau hết hạn, không chỉ Đơn `pending`; 4.6 nhận cảnh báo `payment_reconciliation_stopped` và quyết có cần lệnh tra lại tay theo mã Đơn không.
  evidence: Review 4.1 (BH, ECH; medium, defer). Dừng chuỗi đúng intent 4.1 (AC epics "job dừng và đẩy cảnh báo vận hành", spec 4.1 "lỗi lần thứ 4 liên tiếp → dừng chuỗi"), nên 4.1 không đổi. `apps/api/src/modules/payment/reconciliation-worker.ts` (`fail` → `stop`), `RECONCILE_MAX_FAILURES` ở `ordering/reconciliation-jobs.ts`.
- Đã xử lý phần 4.2 (13/11/2026): Story 4.2-a. Tắt cờ dịch vụ thanh toán (mọi đường) enqueue job `payment.service-resumed`; worker của `payment` enqueue job tra 4.1 tại đồng hồ DB cho mọi Đơn của BTC có link mà `pending`, hoặc `expired` với `expires_at` trong 24 giờ trước (`ordering.reconcilableOrderIdsOf`), nên chuỗi đã dừng vì `MERCHANT_SUSPENDED` được nối lại. Phần 4.6 (cảnh báo, lệnh tra lại tay) vẫn mở.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-doi-soat-bu-khi-ipn-tre-hoac-mat.md`
  summary: Khi thay hợp đồng tạm của API tra đơn Gateway, kiểm API tra thật có cần cấp quyền nhóm dịch vụ riêng cho key merchant không. Mã 1133 ("key chưa được cấp quyền nhóm dịch vụ") hiện ánh xạ `TINGEE_CREDENTIAL_INVALID`, nên nếu key chỉ có quyền "Cổng thanh toán" mà API tra thuộc nhóm khác thì mọi Đơn dừng ngay với lý do `credential_invalid`, đọc như BTC thu hồi key.
  evidence: Review 4.1 (BH; maybe-false, nếu đúng thì medium; chưa kiểm được). Cần Tingee xác nhận nhóm quyền của API tra. `apps/api/src/modules/tingee/errors.ts` (1133), `payment/reconciliation-worker.ts` (`lookup`).

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
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`
  summary: Lệnh "Kết thúc" (`EventStatusService.transition`) đặt `ended_manually_at` = `effective_end_at` bằng đồng hồ app (`new Date()`), trong khi chốt link, Trang Đơn và mọi `ended` so bằng `now()` của DB; app chạy nhanh hơn DB thì trong khoảng lệch đó vẫn tạo link và trả checkout URL. Nên lấy giờ bằng `dbNow(tx)` (cả Ẩn/Hiện lại dùng `now` cho `notEnded`).
  evidence: Review E3-2 #10 (ECH, low). Có từ Story 2.12 (`apps/api/src/modules/event/event-status.service.ts:110`); spec E3-2 cấm đổi `EventStatusService`. Lệch đồng hồ thường ở mức ms nhờ NTP.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`
  summary: Story 7.1. Khi có đường hủy Sự kiện, Đơn chưa có link của Sự kiện đã hủy bị chốt link E3-2 hết hạn `sales_paused` và Trang Đơn hiện "Sự kiện tạm ngừng bán. Bạn thử lại sau nhé." + "Về trang Sự kiện" (`buyerStatusOf` trả `expired`, không phải `event_cancelled`). 7.1 phải chọn câu cho Đơn `expired` của Sự kiện đã hủy (vd. ưu tiên `event_cancelled` hoặc kiểm `event.status` trước câu `SALES_PAUSED`).
  evidence: Review E3-2 #11 (BH, ECH). Hiện chưa xảy ra: không code nào đặt `events.status = 'cancelled'` (Story 7.1 backlog). `apps/web/app/(buyer)/orders/[code]/order-view.tsx` › `StatusBlock`.
- source_spec: `_bmad-output/implementation-artifacts/spec-epic-3-e3-2-ket-thuc-va-link-dang-song.md`
  summary: Thẻ Đơn ở "Vé của tôi" (`order-card` › `AwaitingPayment`) vẫn hiện đếm ngược + "Tiếp tục thanh toán" cho Đơn chờ tiền của Sự kiện đã kết thúc; nút dẫn tới Trang Đơn đang báo "Sự kiện đã kết thúc. Đơn này không thanh toán được nữa." Cần đổi thẻ theo `event.ended` cho cùng một câu ở mọi nơi.
  evidence: Review E3-2 #12 (BH, low). Spec E3-2 (Never) giữ nguyên `order-card`. `apps/web/components/tickee/order-card.tsx:48-56`.

## Deferred from: build Story 4.2, tách phạm vi (2026-11-13)

Spec 4.2 đầy đủ khoảng 5.500 token. Mason chọn tách ba ngày 13/11/2026: làm 4.2-a lõi API trước (`spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`), rồi 4.2-b giao diện, rồi 4.2-c nhãn C5. Story `4-2-…` trong sprint-status chỉ `done` sau 4.2-c. Mason chốt cùng ngày: lý do 1033 → `token`, 1007/1034 → `tingee_disabled`; dò tạm bằng `get-va-paging`; "Kiểm tra lại" ở trang Tài khoản nhận tiền, Quản trị có tab riêng.

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-b (giao diện). Banner dashboard cho ba mã notice của 4.2-a theo vai: Token → danger "Mọi Sự kiện có phí đang Tạm ngừng bán", Owner "Mua thêm Token" mở `data.tingeePortalUrl` (liên kết ngoài: `StatusBannerStack` hiện chỉ nhận `section`); `credential_invalid` → "Key Tingee không còn dùng được", Owner "Nhập lại key" tới trang Tài khoản nhận tiền, Admin "Nhờ Owner cập nhật key Tingee."; `tingee_disabled` → "Tingee đang tạm ngừng dịch vụ thanh toán của BTC. Mọi Sự kiện có phí đang Tạm ngừng bán.", Owner "Xem chi tiết" tới trang Tài khoản nhận tiền, Admin "Nhờ Owner liên hệ Tingee.". Stream `GET /v1/orgs/:orgId/live` (thành viên BTC, chỉ `org_status_changed` của BTC đó) và `StatusBannerStack` dùng `useLiveResource` (poll 10 giây khi không có SSE, AD-17). Trang Tài khoản nhận tiền (Owner) có khối "Dịch vụ thanh toán" khi `suspended`: lý do, từ lúc nào, lần dò gần nhất, "Kiểm tra lại" (spinner, toast kết quả), `credential_invalid` kèm lối "Đổi key Tingee" có sẵn. `/admin` thêm tab "Tạm ngừng bán": danh sách BTC `suspended`, "Mở lại" qua `Dialog`.
  evidence: Tách khỏi 4.2-a vì spec đầy đủ vượt ngưỡng; 4.2-a đã có mọi API (`notices`, `POST …/payment-service/check`, API Quản trị, `PaymentServiceState` trong overview Tài khoản nhận tiền) nên 4.2-b chỉ là web + một stream.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-c (C5 của E2-6). Nhãn trạng thái bán của Sự kiện trên dashboard (`apps/web/app/(dashboard)/btc/[orgId]/su-kien/event-status.ts` › `eventBadge`, dùng ở `organization-home.tsx` và badge thẻ "Thông tin" của `event-tabs.tsx`) lấy từ `sellability` (`eventReason`: hủy, khóa, đã kết thúc, Ẩn, "Tạm ngừng bán") thay vì tự tính từ `status`/`effectiveEndAt`. API tổ chức chưa trả `sellability`; `event` không import `ordering`, nên endpoint nằm ở `flows`.
  evidence: Tách khỏi 4.2-a: thay đổi độc lập (đường đọc riêng, chỉ hiển thị), ship riêng được. Thay cho mục deferred của spec 3.11 về C5.

## Deferred from: build of spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Thay hợp đồng dò tạm khi Tingee có API trạng thái dịch vụ gọi bằng key merchant. `tingee.getMerchantServiceStatus` hiện gọi `get-va-paging` (1 dòng) bằng key hiện hành: `00` → hoạt động. Tingee chặn Cổng thanh toán mà vẫn cho `get-va-paging` thì cờ mở lại sai, lần tạo link kế bật lại, mỗi vòng dò 5 phút mất một Đơn của Người mua. Khi thay, chỉ sửa `tingee.client.ts` và Tingee fake (`accountReplies`).
  evidence: Quyết định của Mason (13/11/2026) trong spec 4.2-a. `apps/api/src/modules/tingee/tingee.client.ts` (`getMerchantServiceStatus`), `apps/api/src/modules/organizer/payment-service.ts` (`PaymentServiceProber`).
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Tingee xác nhận mã Token. `1033` ("gói dịch vụ đã hết hạn") đang ánh xạ lý do `token` (banner "Mọi Sự kiện có phí đang Tạm ngừng bán", "Mua thêm Token"); 1007/1034 → `tingee_disabled`. Nếu hết Token mang mã khác (hoặc 1033 không phải hết Token), sửa `paymentServiceReasonOf` ở `tingee/errors.ts` và bảng mã của test (`test/tingee/client.test.ts`, `test/ordering/payment-link.test.ts`).
  evidence: Quyết định của Mason (13/11/2026) trong spec 4.2-a; chưa có tài liệu Tingee nào nêu mã của "hết Token" khi gọi `create-link` bằng key merchant.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: `create-link` bị từ chối vì VA (`2023` VA chưa được cho phép trên Cổng thanh toán, `1023`/`1045`/`1024`/`1072` VA lỗi) vẫn chỉ hết hạn Đơn (`sales_paused`), không bật cờ dịch vụ thanh toán, nên BTC không có banner và mọi Người mua sau vẫn thử rồi hết hạn. Cần quyết: thêm lý do riêng (vd. `payout_account_not_allowed`, tắt khi Owner đổi tài khoản mặc định) hay chỉ báo BTC bằng banner/email không chặn bán.
  evidence: Spec 4.2-a (Always: "`PAYMENT_ACCOUNT_NOT_ALLOWED` … không bật cờ"). `apps/api/src/modules/ordering/payment-link.ts` (`serviceReason` `null` với nhóm VA), `apps/api/src/modules/tingee/errors.ts` (`paymentServiceReasonOf`).

## Deferred from: code review of spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md (2026-11-13)

- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-b. `POST /v1/orgs/:orgId/payment-service/check` chỉ trả `PaymentServiceState`, nên toast "Kiểm tra lại" không phân biệt được "đang chờ 30 giây", "Tingee không trả lời", "vẫn ngắt" và "không có tài khoản mặc định"; thêm `outcome` (kết quả dò của `PaymentServiceProber`) và có thể `retryAfterSeconds` vào response khi làm giao diện.
  evidence: Review 4.2-a #4 (BH, low). `organizer/payment-service.ts` › `PaymentServiceService.check` bỏ kết quả của `probe`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 5.8. Mở lại dịch vụ: `reconcilableOrderIdsOf` quét cả bảng `orders` (không có index nào theo `organization_id`), và worker "đã mở lại" enqueue mọi job tra của BTC cùng một mốc nên một BTC nhiều Đơn mở dồn lời gọi tra lên giới hạn 20 request/10 giây của Tingee. Đo khi chạy tải; nếu cần thêm index một phần `(organization_id) WHERE payment_link IS NOT NULL AND status IN ('pending','expired')` và giãn `startAfter`.
  evidence: Review 4.2-a #6, #7 (BH, ECH, low). `ordering/reconciliation-jobs.ts` › `reconcilableOrderIdsOf`, `payment/payment-service-resumed-worker.ts`. Cùng yếu điểm giới hạn tốc độ của 4.1 (mục 5.8 phía trên); `TINGEE_ORDER_STATUS_QUERY` hiện tắt ngoài local.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.6. Danh sách BTC bị ngắt của Quản trị không phân trang, và một lượt job dò tuần tự không có trần thời gian (mỗi BTC tới 5 giây timeout): nhiều BTC bị ngắt cùng lúc có thể làm lượt chạy dài hơn chu kỳ 5 phút. Thêm giới hạn số BTC hoặc ngân sách thời gian mỗi lượt khi có số liệu.
  evidence: Review 4.2-a #23 (BH, ECH, low). `organizer/payment-service.ts` › `listSuspendedPaymentServices`, `PaymentServiceProbeWorker.probeSuspended`. Lượt chồng nhau đã không gọi Tingee hai lần nhờ CAS `checked_at`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: UAT Tingee thật (E3-3). `create-link` bị từ chối bằng HTTP ≠ 200 kèm mã ngắt (vd. 401/403 với 1133/1034/1033) hiện bị coi là kết quả mơ hồ (`timeout`, theo 3.4) nên không bật cờ dịch vụ; trong khi dò (`getMerchantServiceStatus`) coi HTTP 4xx kèm mã ngắt là kết luận. Kiểm Tingee trả mã ngắt kèm HTTP nào; nếu là 4xx thì cho `create-link` coi 4xx kèm mã ngắt đã biết là `rejected`.
  evidence: Review 4.2-a #26 (ECH, maybe-false; nếu đúng thì medium: BTC không bao giờ được báo, mọi Đơn có phí hết hạn `timeout`). `tingee/tingee.client.ts` › `createPaymentLink` / `CreateLinkError`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-2-a-co-tam-ngung-ban-va-tu-mo-lai.md`
  summary: Story 4.2-b, bổ sung cho mục 4.2-b phía trên (viết trước khi có lý do thứ tư). Banner của mã `PAYMENT_SERVICE_SUSPENDED_GATEWAY_PERMISSION_MISSING` (lý do `gateway_permission_missing`, mã 1133): danger "Key Tingee chưa được cấp quyền Cổng thanh toán" (tiêu đề đã có ở 4.2-a), Owner có hành động tới trang Tài khoản nhận tiền, nơi khối "Dịch vụ thanh toán" nhắc cấp quyền "Cổng thanh toán" cho key trên portal Tingee (`TingeeGuide`) rồi bấm "Kiểm tra lại" (lý do này mở lại không cần Tingee xác nhận); Admin "Nhờ Owner cấp quyền Cổng thanh toán cho key Tingee.". Câu chữ cụ thể chốt khi lập spec 4.2-b.
  evidence: Mason chốt 13/11/2026 sau review 4.2-a lượt 1 (intent_gap #1): 1133 tách khỏi `credential_invalid` vì dò bằng `get-va-paging` không thấy thiếu quyền này. Đóng phần câu nhắc cấp quyền của mục 3.4 (1133).
