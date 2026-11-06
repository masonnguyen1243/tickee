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
