---
title: 'Story 2.6: Liên kết tài khoản nhận tiền'
type: 'feature'
created: '2026-11-03'
status: 'done'
superseded_by: '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '508c0f75e9f5cea976fba53a5a2b453d47b8d020'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

> **Đã bị thay (03/11/2026):** spec này làm theo mô hình Tickee là Master Merchant (Merchant con, `create-va`/`confirm-va` + OTP). Sprint Change Proposal 03/11/2026 đổi sang mô hình BTC dùng key Tingee của chính mình (`get-va-paging`). Story 2.6 làm lại bằng spec mới; code của spec này (commit `178bd2c`) chỉ dùng lại phần ghi "Giữ" ở §2 của đề xuất.

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BTC chưa có cách nhận tiền vé: chưa có adapter Tingee, chưa có Merchant con, chưa có trạng thái liên kết; trang "Tài khoản nhận tiền" vẫn là ComingSoon (FR-4, FR-5, AD-5, AD-6, AD-9, UX-DR40).

**Approach:** Dựng mô-đun `tingee` (client ký HMAC-SHA512, timeout, map lỗi) và Tingee fake. Owner gửi form → `organizer` gọi Tingee **ngoài transaction**: `POST /v1/merchant/create` (một lần cho mỗi BTC, lưu `tingee_merchant_id`) rồi `POST /v1/create-va` với `merchantId`. Nếu Tingee trả `confirmId` thì chuyển sang bước nhập OTP ngân hàng (`POST /v1/confirm-va`). Thành công thì lưu tài khoản nhận tiền hiện hành, audit, và banner "Chưa liên kết" biến mất.

## Boundaries & Constraints

**Always:**
- Chỉ `tingee` biết tên trường, host và mã lỗi Tingee. Header gồm `x-client-id`, `x-request-timestamp` (`yyyyMMddHHmmssSSS`, giờ `Asia/Ho_Chi_Minh`) và `x-signature` = hex thường của `HMAC_SHA512(ts + ':' + body, secret)`; `body` phải đúng là chuỗi JSON đã ký. Mọi phản hồi là HTTP 200, `code !== '00'` là lỗi. Timeout 15 giây qua `AbortSignal.timeout`. Secret lấy từ env `TINGEE_BASE_URL`, `TINGEE_CLIENT_ID`, `TINGEE_SECRET_TOKEN` (Zod, chỉ role api). Log không được chứa secret, chữ ký, số tài khoản, CCCD hay SĐT.
- Map lỗi Tingee sang lỗi miền (`packages/contracts`):
  - `PAYOUT_ACCOUNT_INVALID` (422) ← 400, 1043, 1057, 1083, 1084, 1130, 1011.
  - `BANK_NOT_SUPPORTED` (422) ← 1021, 1041, 1051, 1059, 1063; VietinBank `970415` bị chặn ngay ở server, không gọi Tingee.
  - `PAYOUT_ACCOUNT_IN_USE` (409) ← 1022, 1048, 1049, 1081.
  - `BANK_OTP_INVALID` (422) ← 1078, 1134.
  - `BANK_OTP_EXPIRED` (409) ← 1065, 1080, 1098.
  - `MERCHANT_SUSPENDED` (409) ← 1007, 1034.
  - `PAYMENT_PROVIDER_UNAVAILABLE` (503) ← timeout, lỗi mạng, 500, 1001, 1102, 1131, và mọi mã còn lại (ghi log `code` Tingee).
- Tingee luôn được gọi ngoài `db.transaction`. Mỗi lần ghi trạng thái là một transaction riêng, có audit (`payout_account.link_started|linked|failed`, chỉ ghi tên trường). Chỉ Owner được gọi (`@RequirePermission(Permission.PAYOUT_ACCOUNT_MANAGE)`).
- Một lần thử liên kết là một dòng `payout_accounts` với trạng thái `linking → awaiting_otp → linked` hoặc `failed` (CAS). Mỗi BTC có tối đa một dòng `linked` (unique index một phần). Đã `linked` thì gửi liên kết mới bị chặn bằng `409 PAYOUT_ACCOUNT_ALREADY_LINKED`, vì đổi tài khoản là việc của 2.13. Lưu `bank_bin`, `account_type`, 4 số cuối tài khoản, `account_name`, `va_account_number`, `tingee_shop_id`, `confirm_id`, `failure_code`. Không lưu số tài khoản đầy đủ, CCCD hay số dư.
- Notices: thêm mã `PAYOUT_ACCOUNT_NOT_LINKED` (danger, không đóng được, thứ tự ưu tiên #5 theo comment sẵn có) và `PAYOUT_ACCOUNT_LINKING` (info, khi có dòng `awaiting_otp`). Cả hai gửi cho Owner và Admin. Web chọn câu theo vai:
  - Owner: "Liên kết tài khoản nhận tiền để bán Vé có phí." + nút "Liên kết ngay".
  - Admin: "Nhờ Owner liên kết tài khoản nhận tiền."
- Web `/btc/[orgId]/tai-khoan-nhan-tien` (đã có sẵn `OwnerOnly`):
  - Chưa liên kết: hiện form.
  - `awaiting_otp`: `status-badge` neutral "Đang liên kết" + ô OTP; quay lại trang vẫn nhập tiếp được; OTP hết hạn thì có nút "Gửi lại" để tạo lần thử mới.
  - `linked`: thẻ gồm tên ngân hàng, `•••• 1234` (`tabular-nums`), tên chủ tài khoản in hoa, số VA nhận tiền, `status-badge` success "Đã liên kết".
  - Lỗi: báo tại ô hoặc tại form, nêu lý do người dùng làm được gì, kèm "Thử lại", giữ nguyên dữ liệu đã nhập.

**Never:**
- Không làm đổi tài khoản, `REAUTH_REQUIRED` hay email cảnh báo (2.13). Không làm `publishReadiness` (2.10). Không gọi API QR động/tĩnh (AD-6).
- Không dùng nhánh liên kết qua webhook hay deeplink (VCB cá nhân, TPBank), Bảo Kim hay MSB.
- Test tự động không bao giờ gọi Tingee thật.

- **Quyết định 03/11/2026:**
  - **(1) Ngân hàng:** MVP chỉ nhận tài khoản **cá nhân** (`accountType: personal-account`) ở 5 ngân hàng dùng luồng form + OTP: BIDV `970418`, MB `970422`, ACB `970416`, VPBank `970432`, OCB `970448`. Danh sách là `SUPPORTED_PAYOUT_BANKS` trong `contracts`.
  - **(2) SĐT Merchant con:** form có trường "SĐT đăng ký Tingee" (10 số, bắt đầu bằng 0), điền sẵn từ `organizations.contact_phone`, Owner sửa được. Form gồm: ngân hàng, số tài khoản, tên chủ tài khoản (in hoa, không dấu), CCCD, SĐT đăng ký Tingee.
  - **(3) Loại QR:** không hiển thị loại QR và không có khuyến nghị "đổi sang QR động", vì Tingee không trả thông tin này và thanh toán đi qua Gateway (AD-6). Phải sửa epics/UX tương ứng bằng `bmad-correct-course`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Liên kết ngay | Tingee trả `merchantAccountNumberId` | 200 `linked`; banner biến mất | — |
| Cần OTP | Tingee trả `confirmId` | 200 `awaiting_otp`; nhập OTP đúng → `linked` | sai → `BANK_OTP_INVALID` tại ô |
| OTP hết hạn | `1065` | `failed`, form điền sẵn (trừ CCCD), "Gửi lại" | — |
| VietinBank | `bankBin=970415` | 422 `BANK_NOT_SUPPORTED`, không gọi Tingee | thông báo tại ô ngân hàng |
| Tingee timeout | — | 503 `PAYMENT_PROVIDER_UNAVAILABLE`; dòng `failed` | "Tingee tạm lỗi, thử lại sau ít phút" + "Thử lại" |
| Đã liên kết | gửi lại form | 409 `PAYOUT_ACCOUNT_ALREADY_LINKED` | — |
| Admin | gọi API | 403 `FORBIDDEN_ROLE`; web hiện `OwnerOnly` sẵn có | — |
| Hai tab gửi cùng lúc | — | tối đa một dòng `linked` | lần sau → 409 |

</frozen-after-approval>

## Code Map

- `apps/api/module-graph.cjs:9,19` -- đã có `organizer → tingee` và `tingee: []`, **không thêm cạnh**.
- `apps/api/src/modules/tingee/index.ts` -- hiện là stub. Thêm:
  - `tingee.client.ts`: token DI `TINGEE_CLIENT`, interface `createMerchant`/`createVa`/`confirmVa` trả kết quả miền hoặc ném `AppError`.
  - `signing.ts`: `tingeeTimestamp(now)` và `sign()`, export để fake dùng lại.
  - `errors.ts`: bảng mã.
  - `tingee.module.ts`: `forRoot(config)`, `@Global`, theo mẫu `platform/email/email.module.ts:14-25` và `smtp-transport.ts`.
- `apps/api/src/platform/config/config.schema.ts:40-68` -- thêm 3 khóa `TINGEE_*` vào `apiConfigSchema` (URL qua refinement `httpOrigin`). Thêm vào `test/helpers.ts:19-35` `apiConfig()`.
- `packages/contracts/src/`:
  - `organizer.ts`: `Permission.PAYOUT_ACCOUNT_MANAGE` và `OrganizationSection.PAYOUT_ACCOUNT` đã có. Thêm DTO `PayoutAccount`, `LinkPayoutAccountRequest`, `ConfirmPayoutOtpRequest`, `SUPPORTED_PAYOUT_BANKS` và `BLOCKED_BANK_BINS = ['970415']`.
  - `errors.ts`: thêm mã lỗi mới.
  - `reporting.ts:13-30`: thêm 2 mã và thứ tự ưu tiên.
  - `pii.ts:8`: thêm `account_name`, `account_last4`.
- `apps/api/src/platform/http/{app-error.ts,error.filter.ts}` -- map status cho mã mới. `platform/audit/audit.ts:5-32` -- thêm 3 action.
- `apps/api/src/modules/organizer/`:
  - `schema.ts`: `organizations.tingee_merchant_id bigint`; bảng `payout_accounts` (`organization_id NOT NULL`, `status` + CHECK, unique một phần `WHERE status='linked'`, `created_by`, `linked_at`). Migration `0008` sinh bằng `db:generate`.
  - `payout-account.service.ts`: luồng ngoài transaction, mẫu `members.service.ts:109-167`; CAS kiểu `closed-beta.ts:48-60`.
  - `payout-account.controller.ts`: `GET /v1/orgs/:orgId/payout-account`, `POST …/payout-account` (link), `POST …/payout-account/otp`; mẫu `members.controller.ts:11-42`.
  - Read model `payoutAccountStatusOf(db, scope)` xuất qua `index.ts`; đăng ký trong `organizer.module.ts:26-33`.
- `apps/api/src/modules/reporting/notices.service.ts:23-72` -- thêm builder `payoutNotices(state)`; `version` = mốc đổi gần nhất.
- `apps/api/test/tingee-fake/` -- server HTTP thật trên cổng ngẫu nhiên. Fake kiểm chữ ký và độ lệch timestamp, và chọn kịch bản theo số tài khoản: `…0000` → liên kết ngay; `…1111` → cần OTP (OTP đúng là `123456`, `000000` → 1065); `…4343` → 1043; `…8181` → 1081; `…5000` → treo quá timeout. Fake ghi lại các request. Thêm `pnpm --filter @tickee/api tingee:fake` để dev local chạy không cần credential UAT.
- Test: `test/identity/harness.ts:74` (`createHarness`). `test/organizer/isolation.test.ts` tự phủ route mới; `test/reporting/notices.test.ts`.
- Web:
  - `app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/page.tsx:11-17`: thay `ComingSoon` bằng `payout-account-manager.tsx`, theo mẫu form `thanh-vien/members-manager.tsx:87-130` (state có kiểm soát + `safeParse` + `useMutation`; không có react-hook-form).
  - `lib/organizer/api.ts:17-48`: thêm query và mutation.
  - `lib/reporting/status-notices.ts:11-21`: thêm `action?` và copy theo vai.
  - `components/tickee/status-banner-stack.tsx:19-29`: truyền `action` vào `StatusBanner` (prop đã có ở `status-banner.tsx:43`).
- e2e: `e2e/organizer-mock.ts:18-25` -- `statusNotice()` hỗ trợ mã mới; thêm `e2e/payout-account.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{organizer,errors,reporting,pii,index}.ts` (+ test) -- DTO, danh sách ngân hàng, mã lỗi, notice.
- [x] `apps/api/src/platform/{config,http,audit}` -- env Tingee, mirror mã lỗi, action audit.
- [x] `apps/api/src/modules/tingee/*` + `test/tingee/*.test.ts` -- client, ký, map lỗi; test ký theo vector cố định và timeout.
- [x] `apps/api/test/tingee-fake/*`, script `tingee:fake` trong `apps/api/package.json` -- fake.
- [x] `apps/api/src/modules/organizer/{schema,payout-account.*,index,organizer.module}.ts` + migration 0008 -- lưu trữ, service, controller.
- [x] `apps/api/src/modules/reporting/notices.service.ts` -- 2 notice mới.
- [x] `apps/api/test/organizer/payout-account.test.ts` -- phủ toàn bộ matrix trên fake; Tingee không bao giờ được gọi bên trong transaction (fake treo, DB vẫn ghi được); audit; hai request song song.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/*`, `lib/organizer/api.ts`, `lib/reporting/status-notices.ts`, `status-banner-stack.tsx` -- trang và banner.
- [x] `apps/web/e2e/{organizer-mock.ts,payout-account.spec.ts,status-banners.spec.ts}` -- matrix web, chạy cả hai project.

**Acceptance Criteria:**
- Given log api trong suốt test liên kết, then không có số tài khoản đầy đủ, CCCD, SĐT hay `TINGEE_SECRET_TOKEN`.
- Given BTC đã `linked`, when gọi `GET /v1/orgs/:orgId/notices`, then không còn `PAYOUT_ACCOUNT_NOT_LINKED`.
- Given `pnpm turbo build typecheck lint:deps test` và `pnpm --filter @tickee/web test:e2e`, then tất cả pass.

## Implementation Notes

- Subagent triển khai đã đoán tên trường Tingee; bước kiểm tra sửa theo developers.tingee.vn (đọc 03/11/2026): `merchant/create` gửi `phoneNumber` và trả `data.merchantId`; `create-va` thêm `appType: 'baas'`; phản hồi `confirm-va` không có `merchantAccountNumberId` nên `LinkedVa` chỉ còn `vaAccountNumber`, `shopId`. Fake trả mã xác thực thật (90/91/92/97). Test `client.test.ts` ghim body đúng tên trường. Vẫn cần test hợp đồng trên UAT.
- `PAYOUT_ACCOUNT_LINKING` dùng severity `neutral` (contract không có `info`); `PAYOUT_ACCOUNT_NOT_LINKED` `blocking: true`; LINKING thay NOT_LINKED (không hiện cả hai).
- Lần thử mới đánh dấu lần `awaiting_otp` cũ `failed` (`BANK_OTP_EXPIRED`). Xác nhận OTP gặp `BANK_OTP_INVALID` hoặc `PAYMENT_PROVIDER_UNAVAILABLE` thì giữ `awaiting_otp`.
- Không lưu số tài khoản đầy đủ nên tải lại trang không điền lại được số tài khoản.
- `.env` local cần thêm 3 biến `TINGEE_*` (giá trị mẫu trong `.env.example` trỏ vào fake `pnpm --filter @tickee/api tingee:fake`).

## Spec Change Log

- 03/11/2026 (lập kế hoạch): bỏ yêu cầu "dashboard hiện loại QR thanh toán dùng được; chỉ QR tĩnh thì kèm khuyến nghị" của AC epic 2.6 / FR-5 / UX-DR40 (quyết định 3). Lý do: API `create-va`/`confirm-va` không trả loại QR và AD-6 không gọi API QR. Tránh hiển thị thông tin đoán mò. Cần correct-course để đồng bộ `epics.md`, PRD FR-5 và EXPERIENCE.md:306.

## Review Triage Log

Pass 1 (03/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Timeout/lỗi mạng khi `create-va` hoặc `confirm-va` có thể xảy ra sau khi Tingee đã tạo VA: lần thử bị `failed`, lần sau nhận `PAYOUT_ACCOUNT_IN_USE`, BTC kẹt | maybe-false (nếu đúng: medium) | Khối frozen quy định timeout → `failed`. Chưa biết Tingee có tạo VA khi request timeout hay không, và có trả 1022/1081 cho cùng Merchant con hay không; phải thử trên UAT. Tài liệu Tingee không có API tra VA để đối soát | defer |
| 2 | EC, VG | Lần thử mới thay lần thử đang chờ OTP trong lúc `confirm-va` của lần cũ đang chạy → VA mồ côi ở Tingee | maybe-false (nếu đúng: medium) | Chung gốc với #1 (trạng thái Tingee lệch DB); cần hai tab thao tác cùng lúc. Gộp vào mục defer của #1 | defer |
| 3 | BH | Ba request liên kết song song đều gọi `create-va`: bên thua để lại VA mồ côi | low | Cùng số tài khoản thì Tingee trả lỗi "đã tồn tại", bên thua vẫn nhận 409; khác số tài khoản ở hai tab cùng giây là hiếm; sửa phải thêm khóa advisory | reject |
| 4 | EC | `merchant/create` thành công nhưng lưu `tingee_merchant_id` lỗi → lần sau tạo Merchant con thừa | low | `merchant/create` với cùng SĐT gắn lại Merchant sẵn có (theo tài liệu Tingee), không tạo bản sao | reject |
| 5 | BH, EC | Dòng `awaiting_otp` không bao giờ hết hạn: banner neutral "Đang liên kết" thay banner danger mãi | medium | `payoutAccountStatusOf` lọc `awaiting_otp` không theo tuổi; OTP ngân hàng hết hạn sau vài phút | patch |
| 6 | EC | Dòng `linking` đang gọi Tingee vẫn hiện banner NOT_LINKED | low | Đúng khối frozen (LINKING chỉ cho `awaiting_otp`); kéo dài tối đa 15 giây | reject |
| 7 | BH, EC | Lần thử `failed` (tải lại trang, hoặc lỗi cuối ở bước OTP) không hiện lý do, form trống | medium | `payout-account-manager.tsx:575-592` chỉ hiện `link.error`; khối frozen đòi lỗi nêu lý do hành động được | patch |
| 8 | BH | Không giới hạn số lần nhập OTP và số lần gửi liên kết | low | Chỉ Owner đã đăng nhập; ngân hàng và Tingee tự khóa (1131, 1001); sửa phải thêm bộ đếm | reject |
| 9 | EC | `z.coerce.string()` biến `null` thành chuỗi "null": `confirmId: null` → `awaiting_otp` với confirmId "null"; `vaAccountNumber: null` → liên kết VA "null" | medium | `tingee.client.ts:72-80`: coerce của Zod gọi `String(null)` | patch |
| 10 | VG, BH | Không có test cho phản hồi `00` sai dạng, body không phải JSON, HTTP 502 | medium | Gap đã kiểm sẵn; gộp với #9 | patch |
| 11 | VG, BH | Không có test `confirm-va` lỗi nhà cung cấp → giữ `awaiting_otp` rồi xác nhận lại thành công | medium | Gap đã kiểm sẵn: bỏ `PAYMENT_PROVIDER_UNAVAILABLE` khỏi `OTP_RETRYABLE` thì mọi test vẫn qua | patch |
| 12 | VG | Test song song không kiểm `merchantId` của các lần `create-va` và trạng thái các dòng thua | medium | Gap đã kiểm sẵn | patch |
| 13 | EC | Chuyển `linking → awaiting_otp` không ghi audit | low | Khối frozen: "Mỗi lần ghi trạng thái … có audit"; sửa trực tiếp (thêm một action) | patch |
| 14 | BH | `PayoutFieldErrorDetails` chen giữa JSDoc của `ErrorResponse` và `ErrorResponse` | low | `errors.ts:85-87`; sửa bằng cách dời chỗ | patch |
| 15 | BH | `OtpStep` viết cứng regex thay vì dùng `BANK_OTP_PATTERN` | low | `payout-account-manager.tsx:381` trùng `organizer.ts:323` | patch |
| 16 | BH | `pii.ts` không che `identity`, `mobile`, `otp` | low | Không chỗ nào log body; test log của AC đã phủ | reject |
| 17 | BH | `payout_accounts.created_by` FK `ON DELETE no action`, giữ PII của lần thử thất bại mãi | low | Theo quy ước sẵn có (`organization_invitations.invited_by`, 0006); việc xóa tài khoản thuộc Story 7.6 | reject → deferred-work (điều kiện tương lai) |
| 18 | BH | Chưa sửa epics/PRD/UX theo quyết định (3); sprint-status lệch status spec | false | Quyết định (3) giao việc này cho `bmad-correct-course`, không thuộc diff; sprint-status đồng bộ ở bước trình bày | reject |
| 19 | BH | Dòng `linking` mới: trang chỉ có nút "Tải lại", không tự làm mới | low | Chỉ kéo dài tới khi lời gọi Tingee xong (≤ 15 giây); dòng mồ côi hết sau 5 phút | reject |
| 20 | BH | `failureCode` là `z.string()`; kiểm `BLOCKED_BANK_BINS` thừa; nút banner trỏ về chính trang đang mở | low | Không gây lỗi người dùng gặp; khối frozen đòi chặn VietinBank tường minh | reject |
| 21 | EC | Gửi OTP hai lần: lần hai nhận 1080, báo lỗi dù đã liên kết | low | Nút bị tắt khi mutation đang chạy; sửa phải thêm nhánh đọc lại | reject |
| 22 | EC | Dán OTP 8 số có khoảng trắng bị `maxLength` cắt | low | OTP ngân hàng thường 6 số | reject |
| 23 | EC | Fake: `readBody` reject trong handler `void async` → unhandled rejection | low | Chỉ test; client không hủy giữa body | reject |
| 24 | VG | Không có gì chạy script dev `tingee:fake` | low | Công cụ dev; hành vi fake đã được test qua `startTingeeFake` | defer |
| 25 | VG | Vector chữ ký có thể vòng tròn (fake dùng chính `sign()`) | false | Đã tính độc lập bằng `openssl dgst -sha512 -hmac`: khớp vector trong `signing.test.ts` | reject |

## Design Notes

Gọi `merchant/create` lười, ở lần liên kết đầu tiên, và lưu `tingee_merchant_id` ngay sau khi thành công, trong một transaction riêng. Nhờ vậy lần thử sau không tạo Merchant con lần nữa. Tạo VA (`isNotifyAccountNumber: false`) là đường mọi ngân hàng hỗ trợ; Gateway sau này truyền `vaAccountNumber` để nhận tiền đúng chỗ (AD-35 chụp vào Đơn).

Thứ tự ghi: (1) tx chèn dòng `linking` + audit `link_started` → (2) gọi Tingee → (3) tx CAS sang `linked`/`awaiting_otp`/`failed`. Unique index một phần chỉ trên `linked` chặn đua; dòng `linking` mồ côi (api chết giữa chừng) bị coi là `failed` khi đọc sau 5 phút.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
