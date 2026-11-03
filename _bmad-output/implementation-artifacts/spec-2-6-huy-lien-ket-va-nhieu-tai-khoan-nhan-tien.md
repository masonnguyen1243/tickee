---
title: 'Story 2.6 (tiếp): hủy liên kết và nhiều tài khoản nhận tiền'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '747aa7c0d24d3665b1b4a4af22500dbacbe17514'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Commit `747aa7c` cho mỗi BTC đúng một tài khoản nhận tiền và không gỡ được. Mason muốn hai việc: Owner hủy liên kết được, và một BTC liên kết được nhiều tài khoản trong số các tài khoản đã liên kết trên Tingee.

**Approach:** Bỏ ràng buộc "một tài khoản hiện hành mỗi BTC" và đổi thành "mỗi VA hiện hành tối đa một lần mỗi BTC". Owner thêm tài khoản từ danh sách Tingee và hủy liên kết từng tài khoản. Hủy liên kết là gỡ mềm (`retired_at`), không xóa dòng, để Đơn sau này vẫn trỏ được tới tài khoản cũ (AD-35). Khi BTC không còn tài khoản nào, banner `PAYOUT_ACCOUNT_NOT_LINKED` hiện lại.

## Boundaries & Constraints

**Always:**
- Giữ nguyên mọi quy tắc của spec `-2`: chỉ Owner, gọi Tingee ngoài transaction, khóa dòng BTC `FOR UPDATE` trước mỗi lần ghi, audit chỉ ghi tên trường, VietinBank không chọn được, Secret Token không bao giờ rời server.
- Thêm tài khoản: server đọc lại danh sách từ Tingee như bước chọn hiện tại. VA đã liên kết rồi → `409 PAYOUT_ACCOUNT_ALREADY_LINKED` "Tài khoản này đã được liên kết.". Danh sách trả kèm `linked: true` cho tài khoản đã liên kết; web hiện "Đã liên kết" thay cho nút.
- Hủy liên kết một tài khoản: Owner xác nhận qua `Dialog` nêu hậu quả. Server đặt `retired_at` và ghi audit `payout_account.unlinked`, không gọi Tingee. Tài khoản không có hoặc đã hủy → `404 NOT_FOUND`. Trang nhắc Owner bỏ chọn tài khoản đó trong "Các Tài khoản cho phép thanh toán" trên portal Tingee nếu không dùng nữa.
- Hủy hết tài khoản thì trang quay về trạng thái "Chọn tài khoản" và banner NOT_LINKED hiện lại.
- Admin gọi mọi route mới nhận `FORBIDDEN_ROLE`; các route mới tự vào bộ test cách ly.
- **Quyết định 03/11/2026 (Mason):**
  - **(Q1) Tài khoản mặc định.** Tài khoản liên kết đầu tiên tự thành mặc định. Owner bấm "Đặt làm mặc định" để đổi; thao tác này có audit `payout_account.default_changed`. Hủy tài khoản mặc định thì tài khoản liên kết sớm nhất còn lại thành mặc định. BTC còn ít nhất một tài khoản thì luôn có đúng một tài khoản mặc định. Epic 3 tạo link bằng VA của tài khoản mặc định.
  - **(Q2) Đổi key.** "Dùng key khác" chỉ hiện và chỉ được API nhận khi BTC **chưa từng** liên kết tài khoản nào (không có dòng `payout_accounts` nào, tính cả dòng đã hủy). Từ đó về sau, gửi key → `409 PAYOUT_ACCOUNT_ALREADY_LINKED`; đổi key là việc của Story 2.13.
  - **(Q3) Xác nhận khi hủy liên kết.** Hủy liên kết chỉ cần `Dialog` xác nhận nêu hậu quả, không xác nhận lại danh tính (để Story 2.13 làm).

**Never:**
- Không gọi API nào của Tingee để hủy hay xóa VA: chỉ Tickee ngừng dùng tài khoản.
- Không làm `REAUTH_REQUIRED` hay email cảnh báo (Story 2.13); không làm tạo link (Epic 3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Thêm tài khoản thứ hai | Đã có MB, chọn ACB `active` | 200; overview có 2 tài khoản | — |
| Thêm trùng | Chọn lại VA MB đang liên kết | 409 `PAYOUT_ACCOUNT_ALREADY_LINKED`, không lưu | Toast "Tài khoản này đã được liên kết." rồi đọc lại tổng quan (chỉ gặp khi hai tab tranh nhau, vì nút thêm của VA đã liên kết bị ẩn) |
| Hủy một trong hai | Hủy MB | 200; còn ACB; banner vẫn không có | — |
| Hủy tài khoản cuối | Hủy ACB | 200; `accounts: []`; banner NOT_LINKED hiện lại | — |
| Hủy lại | Id đã hủy hoặc id của BTC khác | 404 `NOT_FOUND` | — |
| Liên kết lại | Chọn lại VA đã hủy | 200, tạo dòng mới | — |
| Đặt mặc định | ACB khi MB đang là mặc định | 200; ACB thành mặc định, MB không còn | — |
| Hủy tài khoản mặc định | Còn tài khoản khác | Tài khoản liên kết sớm nhất còn lại thành mặc định | — |
| Đổi key sau khi từng liên kết | Hủy hết tài khoản, rồi gửi key mới | 409 `PAYOUT_ACCOUNT_ALREADY_LINKED`, không gọi Tingee; web ẩn "Dùng key khác" | — |
| Admin | Mọi route | 403 `FORBIDDEN_ROLE` | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/organizer/schema.ts` (`payoutAccounts`):
  - Bỏ index `payout_accounts_one_current_per_organization_key`.
  - Thêm unique một phần `(organization_id, va_account_number) WHERE retired_at IS NULL`.
  - Thêm `is_default boolean NOT NULL DEFAULT false` và unique một phần `organization_id WHERE is_default AND retired_at IS NULL`.
  - Migration mới `0009` sinh bằng `pnpm --filter @tickee/api db:generate --name payout_accounts_multi`. Không viết lại `0008`, vì DB local đã chạy bản `0008` mới.
- `apps/api/src/modules/organizer/payout-account.service.ts`:
  - `select` (:226) đổi thành "thêm tài khoản": bỏ chặn `hasCurrentAccount` (:227, :240), kiểm trùng VA, tài khoản đầu tiên thì `is_default = true`; bắt 23505 của index mới → `PAYOUT_ACCOUNT_ALREADY_LINKED`.
  - `connect` (:170): `hasCurrentAccount` đổi thành "BTC đã từng có dòng `payout_accounts`" (quyết định Q2), kiểm cả trước khi gọi Tingee lẫn trong transaction.
  - Thêm `unlink(ctx, accountId)` và `setDefault(ctx, accountId)`. Id không phải UUID → 404 (như mẫu `attemptNotFound` cũ).
  - `overview` (:146) trả `accounts[]` theo `linked_at` tăng dần, kèm `canReplaceKey`.
  - `options` (:213) đánh dấu `linked`.
  - `payoutAccountStatusOf` (:327) giữ nguyên chữ ký, đọc "có ít nhất một tài khoản hiện hành".
- `payout-account.controller.ts`: thêm `DELETE /v1/orgs/:orgId/payout-account/:accountId` và `POST …/payout-account/:accountId/default` (mẫu `members.controller.ts`: `DELETE …/members/:memberId`).
- `apps/api/src/platform/audit/audit.ts`: thêm `payout_account.unlinked`, `payout_account.default_changed`.
- `packages/contracts/src/organizer.ts`:
  - `PayoutAccount` thêm `isDefault`.
  - `PayoutAccountOption` thêm `linked`.
  - `PayoutAccountOverview`: `account` đổi thành `accounts: PayoutAccount[]`, thêm `canReplaceKey: boolean`.
- Web `payout-account-manager.tsx`:
  - `LinkedView` (:491) thành danh sách tài khoản. Mỗi dòng có badge "Mặc định" và các nút "Đặt làm mặc định", "Hủy liên kết".
  - "Hủy liên kết" mở `Dialog` xác nhận (mẫu xóa Admin ở `thanh-vien/members-manager.tsx`).
  - Thêm nút "Thêm tài khoản" mở `AccountChooser` (:317). Trong danh sách, tài khoản `linked` hiện "Đã liên kết".
  - Checklist bước 2: chọn mọi tài khoản đã liên kết.
  - Nút "Dùng key khác" hiện theo `canReplaceKey`.
  - Sửa `lib/organizer/api.ts` cho phù hợp.
- Test:
  - `apps/api/test/organizer/payout-account.test.ts`: phủ cả matrix và luật Q1/Q2.
  - `apps/web/e2e/payout-account.spec.ts`, `e2e/dashboard-shell.spec.ts`: mock overview theo dạng mới.
  - `packages/contracts/test/payout-account.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/organizer.ts` + test -- DTO nhiều tài khoản, `linked`, `isDefault`, `canReplaceKey`.
- [x] `apps/api/src/modules/organizer/{schema,payout-account.service,payout-account.controller}.ts`, `platform/audit/audit.ts`, migration `0009` + `test/organizer/payout-account.test.ts` -- thêm, hủy, đặt mặc định, luật đổi key; test phủ matrix, hai tab thêm cùng VA, hủy song song.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/payout-account-manager.tsx`, `lib/organizer/api.ts` -- danh sách đã liên kết, thêm, hủy kèm `Dialog`, đặt mặc định.
- [x] `apps/web/e2e/{payout-account,dashboard-shell}.spec.ts` -- thêm tài khoản thứ hai, hủy (kể cả tài khoản cuối), đặt mặc định, 375px không cuộn ngang.

**Acceptance Criteria:**
- Given BTC có hai tài khoản, when Owner hủy cả hai, then `GET …/notices` lại có `PAYOUT_ACCOUNT_NOT_LINKED`, và audit có hai dòng `payout_account.unlinked`.
- Given mọi lúc, then mỗi BTC có tối đa một tài khoản mặc định hiện hành, và có đúng một khi BTC còn ít nhất một tài khoản.

### Review Findings

Code review cả nhánh `feat/2-6-lien-ket-tai-khoan-nhan-tien` so với `main` (2026-11-03). Phạm vi là code và test, không gồm `_bmad-output` và `drizzle/meta`. Bốn lớp review: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor (đối chiếu spec này và `spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md`).

- [x] [Review][Decision] Thêm trùng VA báo bằng toast, không báo tại chỗ — Matrix dòng "Thêm trùng" ghi "Báo tại chỗ". `AccountChooser` lại bắt `PAYOUT_ACCOUNT_ALREADY_LINKED` thành `toast.info` kèm `refreshOverview`, bỏ nó khỏi `selectFailure`, và e2e đang kiểm toast. Việc này chỉ xảy ra khi hai tab tranh nhau, vì nút thêm của VA đã liên kết bị ẩn. Hai cách: sửa code thành `StatusBanner` trong thẻ, hoặc giữ toast và sửa matrix. Đã chốt (Mason, 03/11): giữ toast, matrix dòng "Thêm trùng" đã sửa theo.
- [x] [Review][Patch] Thông điệp và JSDoc của mã lỗi vẫn theo mô hình một tài khoản [apps/api/src/platform/http/error.filter.ts:35] — Thông điệp mặc định "BTC đã có tài khoản nhận tiền." và JSDoc ở `packages/contracts/src/errors.ts:69` chưa nói tới hai nghĩa mới: VA đã liên kết, và key bị khóa theo Q2. JSDoc `PAYOUT_ACCOUNT_NOT_LINKED` ở `packages/contracts/src/reporting.ts` thiếu trường hợp "đã hủy hết".
- [x] [Review][Patch] Chưa có e2e cho form kết nối nhận 409 `PAYOUT_ACCOUNT_ALREADY_LINKED` [apps/web/e2e/payout-account.spec.ts] — Nhánh `onError` riêng của `TingeeConnectForm` (toast "không đổi key ở đây được", `refreshOverview`, không có banner tại chỗ) không có test nào chạy qua. Cần một test mở form, đặt `state.everLinked = true` kèm một tài khoản, gửi key, rồi kiểm toast, kiểm form nhường chỗ cho danh sách đã liên kết, và kiểm không có banner lỗi.
- [x] [Review][Defer] Số VA có thể trùng số tài khoản ngân hàng gốc [apps/api/src/modules/tingee/tingee.client.ts:123] — deferred: maybe-false, nếu đúng là high. `vaAccountNumber` được trả về web và lưu DB, còn AC "không lộ số tài khoản gốc" chỉ qua được vì VA trong fake khác `accountNumber`. Cách chốt: so `vaAccountNumber` với `accountNumber` trên UAT cho từng `accountType`.
- [x] [Review][Defer] Đưa URL IPN cho BTC dán trước khi có route IPN (Story 3.5) — deferred: maybe-false, nếu đúng là medium. Nếu portal Tingee gọi thử URL khi lưu thì sẽ nhận 404. Cách chốt: lưu URL IPN trên portal UAT, xem Tingee có gọi thử không và có chặn lưu khi gọi lỗi không.

**Rejected:**
- Owner kẹt khi key bị thu hồi (`canReplaceKey` false) và không có banner "Key Tingee không còn dùng được": đã có Story 2.13 (đổi key) và Story 4.2 (`credential_invalid`, banner, "Nhập lại key").
- `POST credential` chưa giới hạn tốc độ: đã reject ở `spec-2-6-lien-ket-tai-khoan-nhan-tien-2.md` #8; chỉ Owner của BTC đã được duyệt mới gọi được.
- Danh sách tài khoản cắt ở 200 dòng: Design Notes của spec A đã quyết, và lần review trước (#9) đã reject.
- AES-GCM không có AAD: đã reject ở review trước (#4); phải có quyền ghi DB mới khai thác được.
- `SecretBoxError` thành 500, chưa có công cụ xoay khóa: low, chỉ xảy ra khi vận hành bỏ khóa khỏi env. Lý do ở review trước (#5) "Owner vẫn bấm được Dùng key khác" không còn đúng sau Q2; giờ lối thoát là Story 2.13.
- Số > 2^53 trong `Text`, `shopId` dạng chuỗi 16 chữ số, `code` dạng số `0`: low, Tingee trả chuỗi; sửa là thêm guard.
- VA trùng trong danh sách Tingee, `accountNumber` ngắn hơn 4 ký tự: low, khó xảy ra; sửa là thêm nhánh.
- `0008` bị viết lại sau `178bd2c`: spec A đã quyết (xóa bản cũ, sinh lại); chỉ ảnh hưởng DB local.
- Gộp `0008` và `0009`: low; spec này quyết không viết lại `0008` vì DB local đã chạy bản mới.
- `va_account_number` thiếu trong `PII_COLUMNS.organizer`: false. Danh sách chỉ dùng để che log, và khóa này đã có trong `ALWAYS_REDACTED`.
- `secretTokenCiphertext` và `tingee_ipn_key` không bị che trong log: low, không có chỗ nào log dòng credential hay organization. `client_id` che luôn Client ID Google: low.
- Audit chưa ghi credential bị retire và chưa nối "hủy" với "đổi mặc định": low; spec đã định nghĩa các dòng audit như hiện có.
- `version` banner đổi theo `linked_at` và `retired_at`: low; banner không đóng được.
- `connect` không idempotent khi gửi lại cùng key: low; chỉ thêm dòng audit và làm mới cache.
- `select` báo `PAYOUT_ACCOUNT_UNAVAILABLE` khi credential đổi ở tab khác: low; thông điệp vẫn bảo tải lại danh sách, và tải lại là đủ.
- Đường bắt 23505 trong `select` chưa có test đi qua: low; khóa dòng BTC chặn trước, và kiểm đột biến ở Implementation Notes đã chứng minh đường bắt chạy được.
- `replacingKey` còn `true` khi `canReplaceKey` thành false: false; form đã được `canReplaceKey` chặn.
- Client ID ngắn bị che hết, `changedAt` trong Implementation Notes ghi sai nghĩa: muốn sửa thì phải sửa spec.

## Implementation Notes

- API:
  - `DELETE …/payout-account/:accountId` và `POST …/:accountId/default` trả `200` kèm `PayoutAccountOverview` (không phải `204` như `members`): matrix ghi "200; `accounts: []`", và web thay cache bằng tổng quan mới, không đọc lại. `POST …/payout-account` (thêm) vẫn trả `PayoutAccount`.
  - Hủy liên kết đặt cả `retired_at` lẫn `is_default = false`: dòng đã hủy không bao giờ là mặc định, nên truy vấn "tài khoản mặc định" của Epic 3 không lỡ lấy dòng cũ.
  - Hủy tài khoản mặc định mà còn tài khoản khác: tài khoản liên kết sớm nhất còn lại (`linked_at`, rồi `id`) thành mặc định và có thêm một dòng audit `payout_account.default_changed` (actor là Owner vừa hủy). Đặt mặc định cho tài khoản đang là mặc định: `200`, không đổi gì, không audit.
  - Thêm trùng VA bị chặn ba lớp: kiểm trước khi gọi Tingee (không gọi Tingee), kiểm trong transaction sau khi khóa dòng BTC, và bắt `23505` của `payout_accounts_current_va_per_organization_key`.
  - Q2: `connect` từ chối khi BTC có bất kỳ dòng `payout_accounts` nào (kể cả đã hủy), kiểm trước Tingee và trong transaction. Message: "BTC đã liên kết tài khoản nhận tiền bằng key Tingee này. Đổi key Tingee là thao tác riêng."
  - `payoutAccountStatusOf`: `linked` khi có ít nhất một tài khoản hiện hành; `changedAt` là `min(linked_at)` của các tài khoản hiện hành (mốc BTC chuyển sang `linked` gần nhất).
- Migration `0009_payout_accounts_multi`: sinh bằng `db:generate`, thêm tay một câu `UPDATE … SET is_default = true WHERE retired_at IS NULL` để tài khoản hiện hành có sẵn (tối đa một mỗi BTC theo index cũ) thành mặc định.
- Web:
  - "Đã liên kết" trong danh sách chọn tính lúc render từ VA của `accounts` trong tổng quan, không từ cờ `linked` của danh sách đang cache (cờ đó cũ đi khi tab khác hủy liên kết). Mở lại "Thêm tài khoản" không gọi lại Tingee. Trước khi ghi tổng quan mới vào cache (thêm, hủy, đặt mặc định) thì hủy lần đọc tổng quan đang chạy.
  - Key bị thu hồi khi `canReplaceKey` là `false`: banner chỉ có link "Mở portal Tingee", câu "Kiểm tra API key trên portal Tingee.".
  - Lời nhắc bỏ chọn tài khoản trong "Các Tài khoản cho phép thanh toán" có ở ba chỗ: `Dialog` hủy liên kết, mô tả của toast sau khi hủy, và dòng ghi chú dưới checklist.
  - Nút hủy trong `Dialog` là "Giữ tài khoản" (không dùng "Hủy" vì dễ lẫn với "Hủy liên kết").
- Test: `isolation.test.ts` thêm hai route mới vào danh sách kiểm. Kiểm đột biến: bỏ bước chuyển mặc định, bỏ kiểm Q2 trong transaction, hay bỏ khóa dòng BTC khi hủy liên kết đều làm test fail. Bỏ kiểm trùng VA trong transaction thì test vẫn qua vì unique index bắt được (cùng kết quả 409).

## Spec Change Log

## Review Triage Log

Pass 1 (03/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, VG | Cờ `linked` trong cache danh sách bị cũ: tab khác hủy liên kết, hoặc 404 khi hủy/đặt mặc định, không bỏ cờ; chưa có test xem lại danh sách sau khi thêm | medium | `markOptionLinked` chỉ chạy khi chính tab này thêm hoặc hủy thành công. Query danh sách không tự đọc lại, nên VA đã hủy vẫn hiện "Đã liên kết" và không có nút. Overview luôn có danh sách VA hiện hành mới nhất | patch |
| 2 | BH, EC | `applyOverview` bị một GET overview cũ đang chạy ghi đè | medium | `refreshOverview` (sau khi thêm) khởi động refetch. Nếu Owner bấm "Đặt làm mặc định" ngay, GET cũ trả về sau `setQueryData` và đưa mặc định cũ trở lại | patch |
| 3 | BH, EC | `adding` không về `false` khi hủy hết tài khoản; sau đó danh sách chọn tự mở | low | `:845`: chỉ `onAddDone`/`onLinked` đặt lại. Sửa một dòng | patch |
| 4 | EC | `Dialog` hủy liên kết dùng `isDefault` cũ | low | Dialog giữ object tài khoản lúc mở; trong lúc đó "đặt mặc định" hoặc refetch làm đổi cờ. Sửa bằng cách tìm tài khoản theo id trong danh sách hiện tại | patch |
| 5 | BH | Câu trong `Dialog` "Đơn mới sẽ không nhận tiền vào X" sai với tài khoản không mặc định | low | `:661`: chỉ tài khoản mặc định nhận tiền của Đơn mới. Sửa câu theo `isDefault` | patch |
| 6 | BH | Comment `notices.service.ts:63` và doc `PayoutAccountState.changedAt` chưa theo mô hình nhiều tài khoản | low | Comment thiếu trường hợp "đã hủy hết". `changedAt` đổi khi hủy tài khoản sớm nhất dù trạng thái vẫn `linked` | patch |
| 7 | VG | Hai unique index mới và đường 23505 → 409 chưa có test | — | Gap đã kiểm sẵn: khóa dòng BTC luôn chặn trước khi tới index | patch |
| 8 | VG | Web: "Đặt làm mặc định" gặp `NOT_FOUND` chưa có e2e | — | Gap đã kiểm sẵn | patch |
| 9 | VG | Web: thêm tài khoản gặp `TINGEE_CREDENTIAL_INVALID` ở chế độ thêm (không đổi key được) chưa có e2e | — | Gap đã kiểm sẵn | patch |
| 10 | BH | Chưa có test cho trường hợp tab khác liên kết rồi hủy trong lúc `connect` đang chờ Tingee | low | Làm yếu kiểm Q2 trong transaction thành "có tài khoản hiện hành" thì mọi test vẫn qua. Thêm test là rẻ | patch |
| 11 | BH | "Đặt làm mặc định" và thêm tài khoản là đổi nơi nhận tiền của Đơn mới mà không xác nhận lại hay gửi email (Story 2.13) | low | Khối frozen loại `REAUTH_REQUIRED` và email khỏi story này. Tiền chỉ vào được các VA trong merchant Tingee của chính BTC, vì đổi key đã bị khóa từ lần liên kết đầu (Q2). Story 2.13 phải viết lại để phủ thao tác đặt mặc định | defer |
| 12 | BH | Tài liệu kế hoạch vẫn là mô hình một tài khoản | low | Design Notes đã giao cho `bmad-correct-course`, nhưng chưa có mục nào theo dõi | defer |
| 13 | VG | Câu backfill `is_default` trong `0009` chưa có test | low | Đọc là kiểm được: index cũ bảo đảm tối đa một tài khoản hiện hành mỗi BTC, nên `UPDATE … WHERE retired_at IS NULL` cho đúng một mặc định. `0008` chưa nằm trên `main` | reject |
| 14 | BH | `linked_at = now()` tính từ đầu transaction có thể lệch thứ tự chèn khi hai tab thêm cùng lúc | low | Cần hai tab trong cùng một giây, và mặc định vẫn đúng một. Sửa thì phải đổi nguồn thời gian | reject |
| 15 | BH | Không có CHECK ở DB chặn dòng đã hủy làm mặc định | low | Service luôn đặt `is_default = false` khi hủy; truy vấn mặc định của Epic 3 lọc `retired_at IS NULL`. Thêm CHECK là thêm ràng buộc và migration | reject |
| 16 | BH | Audit không ghi tài khoản mặc định cũ | low | Dòng `default_changed` trước đó cho biết mặc định cũ. Story 2.13 lo audit "4 số cuối cũ và mới" | reject |
| 17 | BH | Regex UUID bị chép lần thứ tư | low | Không gây lỗi. Gom về một chỗ là refactor ngoài phạm vi | reject |
| 18 | BH | `PAYOUT_ACCOUNT_ALREADY_LINKED` dùng cho hai nghĩa | low | Quyết định Q2 (frozen) chọn mã này. Web phân biệt theo endpoint | reject |
| 19 | BH | Tên hàm vẫn là `select` trong khi nghĩa đã là "thêm" | low | Không ai gặp lỗi; đổi tên chỉ là xáo trộn code | reject |
| 20 | BH | Chế độ thêm không có trạng thái "đã liên kết hết"; không nhắc tick tài khoản mặc định mới trên portal | low | Chân danh sách đã có "Tải lại" và link portal; checklist đã nhắc chọn mọi tài khoản đã liên kết | reject |

## Design Notes

- **Gỡ mềm, không xóa:** Đơn của Epic 3 sẽ chụp `orders.payout_account_id` (AD-35). Dòng đã hủy vẫn giữ để IPN và Đối soát bù của Đơn cũ tìm được credential.
- **Migration `0009` thay vì viết lại `0008`:** DB local và `tickee_test` đã chạy `0008` mới; thêm `0009` thì không phải dọn DB lần nữa.
- **Lệch tài liệu kế hoạch:** cần sửa bằng `bmad-correct-course` theo quyết định Q1–Q3:
  - AC Story 2.6 trong `epics.md` ("tối đa một tài khoản nhận tiền hiện hành");
  - quy tắc PRD;
  - AD-6 (tạo link bằng VA của tài khoản mặc định) và AD-35.
- **Tài liệu Tingee:** `create-link` nhận `vaAccountNumber` (tùy chọn); IPN không có trường cho biết tiền vào VA nào. Vì vậy Đơn phải chụp tài khoản mặc định lúc tạo link (Epic 3).

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build && pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
