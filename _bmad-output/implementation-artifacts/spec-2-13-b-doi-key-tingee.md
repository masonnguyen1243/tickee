---
title: 'Story 2.13-b: Đổi key Tingee'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '383e762a5ea532a0e8d278995da3dc75199deda2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BTC đã từng liên kết tài khoản nhận tiền thì không đổi được key Tingee (`connect` trả `PAYOUT_ACCOUNT_ALREADY_LINKED`), nên CLB thay key trên Tingee là kẹt, không bán được Vé có phí.

**Approach:** Thêm luồng "Đổi key Tingee" chỉ cho Owner: xác nhận lại (`consumeReauth` của 2.13-a), nhập key mới, xem danh sách tài khoản của key mới, chọn một tài khoản. Lúc lưu, trong một transaction: credential mới thành hiện hành, credential cũ `retired_at` (giữ ciphertext), mọi tài khoản hiện hành gỡ mềm, tài khoản đã chọn thành mặc định; audit và email cảnh báo Owner + mọi Admin. `ipnKey` không đổi.

## Boundaries & Constraints

**Always:**
- Kiểm quyền trước (Admin → `FORBIDDEN_ROLE`), rồi mới xác nhận lại. Lần xác nhận bị tiêu trong transaction ghi; lỗi sau đó thì rollback, lần xác nhận còn dùng được.
- Gọi Tingee ngoài transaction. Lúc lưu, đọc lại danh sách bằng key mới (không tin danh sách web giữ). Key sai, Tingee lỗi, VA không còn `active` hoặc VietinBank → không ghi gì, key và tài khoản cũ vẫn hiện hành.
- Secret Token mới chỉ lưu ciphertext; không có trong response, log, audit, lỗi hay payload job.
- Audit không chứa PII: `tingee_credential.replaced` (target credential mới), `payout_account.unlinked` cho từng tài khoản cũ, `payout_account.linked` + `default_changed` cho tài khoản mới. 4 số cuối cũ/mới truy được qua id các dòng `payout_accounts`.
- Email dùng lại job `ORGANIZER_NOTIFY_DEFAULT_PAYOUT_CHANGED`, enqueue bằng chính `tx`. `previousAccountId` cho phép `null` (BTC đã hủy hết tài khoản trước khi đổi key); email hiện "chưa có tài khoản nhận tiền → ••••mới".
- Một lần đổi key chọn đúng một tài khoản; thêm tài khoản khác sau đó đi đường `select` có sẵn.
- Quyết định đã chốt khi lập spec: (1) dialog xác nhận lại hiện ngay khi bấm "Đổi key Tingee" (đúng AC epics): `begin` và `preview` chỉ kiểm lần xác nhận còn hiệu lực (`assertReauth`, không tiêu), `replacement` mới tiêu (`consumeReauth`); quá 5 phút thì lúc lưu dialog hiện lại và thao tác tự chạy tiếp. (2) Không sửa đường `select` sau khi đã hủy hết tài khoản (mục deferred từ review 2.13-a #7 giữ nguyên).

**Never:**
- Không xóa dòng `tingee_credentials` hay `payout_accounts`. Không đổi `organizations.tingee_ipn_key`.
- Không đổi luồng `connect` lần đầu (BTC chưa từng liên kết vẫn dùng "Dùng key khác", không cần xác nhận lại).
- Không làm Đối soát bù hay IPN bằng credential cũ (Epic 3/4), không làm chuyển quyền Owner (2.14), không sửa chuyện dùng lại mã TOTP trong 30 giây (đã ghi deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bắt đầu đổi key | Owner bấm "Đổi key Tingee": `POST …/credential/replacement/begin` | Thiếu/hết hạn token → dialog; đúng → `204`, web mở form key, giữ token | `403 REAUTH_REQUIRED {method}` |
| Xem trước key mới | Token còn hiệu lực, `POST …/credential/replacement/preview {clientId, secretToken}` | Danh sách tài khoản của key mới (`selectable`, `linked: false`); không ghi gì | Key sai → `TINGEE_CREDENTIAL_INVALID`; Tingee lỗi → `PAYMENT_PROVIDER_UNAVAILABLE`, merchant bị khóa → `MERCHANT_SUSPENDED` (lỗi tại chỗ) |
| Đổi key thành công | Token xác nhận hợp lệ, `POST …/credential/replacement {clientId, secretToken, vaAccountNumber}`; A mặc định, B hiện hành | Credential mới hiện hành, cũ `retired_at`; A, B gỡ mềm; C (mới) mặc định; trả tổng quan mới; job cảnh báo ••••A → ••••C | — |
| Đổi key khi đã hủy hết | Không còn tài khoản hiện hành | C mặc định; job cảnh báo "chưa có" → ••••C | — |
| Thiếu xác nhận | Không có header `X-Reauth-Token`, token đã tiêu hoặc quá 5 phút, ở bất kỳ route nào | Không đổi gì | `403 REAUTH_REQUIRED {method}` |
| Key sai / Tingee lỗi lúc lưu | Key bị thu hồi giữa xem trước và lưu | Không đổi gì, lần xác nhận không bị tiêu | `TINGEE_CREDENTIAL_INVALID` / `PAYMENT_PROVIDER_UNAVAILABLE` |
| VA không hợp lệ | VA không có trong danh sách hoặc VietinBank | Không đổi gì | `PAYOUT_ACCOUNT_UNAVAILABLE` / `BANK_NOT_SUPPORTED` |
| BTC chưa từng liên kết | Gọi preview hoặc replacement | Không đổi gì | `409 PAYOUT_ACCOUNT_NOT_LINKED_YET` → web dùng `connect` |
| Admin | Gọi bất kỳ route nào | Không đổi gì | `FORBIDDEN_ROLE` |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/organizer/payout-account.service.ts` -- `connect` (:177, mẫu lưu credential + `ipnKey`), `select` (:240, mẫu đọc lại danh sách và chèn tài khoản), `unlink` (:310, mẫu `defaultPayoutQueues.ready()` → tx → `lockOrganization` → `consumeReauth`), `notifyDefaultChanged` (:375, đổi `previousAccountId` sang nullable), `makeDefault`, `hasEverLinked` (:469), `overviewOf` (`canReplaceKey` giữ nghĩa cũ). Bắt `isUniqueViolation(CURRENT_VA_KEY)` như `select`.
- `apps/api/src/modules/organizer/payout-account.controller.ts` -- mẫu `reauthProof(req, header)`; thêm 3 route dưới `credential/replacement` (`begin`, `preview`, gốc).
- `apps/api/src/modules/organizer/payout-default-jobs.ts` (`DefaultPayoutChangedPayload`, `notifyDefaultPayoutChanged`), `payout-default-email.ts` (`previous` nullable, nhãn "chưa có tài khoản nhận tiền").
- `apps/api/src/platform/audit/audit.ts:37` -- thêm action `tingee_credential.replaced`.
- `apps/api/src/modules/identity/reauth.service.ts:84` `consumeReauth`; thêm `assertReauth(db, {userId, sessionId, token})` cùng điều kiện nhưng `SELECT` (không đặt `used_at`), export qua `index.ts`.
- `packages/contracts/src/organizer.ts:274` (`ConnectTingeeRequest`, thêm `ReplaceTingeeKeyRequest = ConnectTingeeRequest + vaAccountNumber`), `errors.ts` (thêm `PAYOUT_ACCOUNT_NOT_LINKED_YET`), `app-error.ts` + `error.filter.ts` (409, message).
- Web: `app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/payout-account-manager.tsx` -- `ConnectForm` (:164) và `AccountChooser` (:353) để dùng lại, `LinkedView` (:725) thêm nút "Đổi key Tingee", nhánh `credential && accounts.length === 0 && !canReplaceKey` (:936) cũng có nút; `CREDENTIAL_REVOKED_LOCKED` (:65) đổi thành gợi ý bấm "Đổi key Tingee". `lib/organizer/api.ts:80-101` fetchers; `lib/auth/reauth.ts` `withReauth`.
- Test: `apps/api/test/organizer/payout-account.test.ts` (helper lấy token xác nhận từ 2.13-a, fake Tingee), `test/organizer/payout-default-job.test.ts`, `test/organizer/isolation.test.ts`, fake Tingee ở `test/tingee-fake/`; `apps/web/e2e/payout-account.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{organizer,errors}.ts`, `apps/api/src/platform/http/{app-error,error.filter}.ts` -- `ReplaceTingeeKeyRequest`, `PAYOUT_ACCOUNT_NOT_LINKED_YET` (409) -- hợp đồng chung.
- [x] `apps/api/src/modules/identity/{reauth.service,index}.ts` -- `assertReauth` -- kiểm không tiêu cho `begin`/`preview`.
- [x] `apps/api/src/modules/organizer/payout-account.{service,controller}.ts` -- `beginReplacement`, `previewReplacement`, `replaceKey` theo matrix (quyền → `hasEverLinked` → reauth); tx: `lockOrganization` → `consumeReauth` → kiểm `hasEverLinked` → retire credential cũ → gỡ mềm tài khoản hiện hành (`is_default=false`) → chèn credential + tài khoản mặc định → audit → enqueue cảnh báo.
- [x] `apps/api/src/modules/organizer/payout-default-{jobs,email}.ts` -- `previousAccountId` nullable; worker và email xử lý "chưa có tài khoản".
- [x] `apps/api/src/platform/audit/audit.ts` -- action mới.
- [x] Web `lib/organizer/api.ts`, `payout-account-manager.tsx` -- nút "Đổi key Tingee" (chỉ Owner), bấm thì `withReauth(begin)` mở dialog, giữ token; form key → `preview` → danh sách → "Lưu" gửi token qua `withReauth`; lỗi tại chỗ; "Hủy" quay về màn cũ; xong thì `applyOverview`.
- [x] Test API: matrix trên; credential cũ còn ciphertext, `ipnKey` không đổi; rollback không tiêu token; job/email với `previous` null; route mới vào `isolation.test.ts`.
- [x] `apps/web/e2e/payout-account.spec.ts` -- luồng đổi key với mock `REAUTH_REQUIRED`, key sai hiện lỗi tại chỗ.

**Acceptance Criteria:**
- Given đổi key xong, when xem trang, then chỉ thấy tài khoản mới (mặc định) và Client ID mới dạng che; URL IPN giữ nguyên.
- Given Admin, when mở trang Tài khoản nhận tiền, then không thấy nút "Đổi key Tingee".
- Given lưu thất bại vì key sai, when Owner xem lại trang, then key, tài khoản và tài khoản mặc định cũ không đổi.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-11-09). Lớp: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Email cảnh báo không nói key Tingee vừa đổi; thay key cùng merchant thì hiện "MB ••••1111 → MB ••••1111", trông như không có gì đổi | medium | `buildDefaultPayoutChangedEmail` chỉ có tiêu đề "Tài khoản nhận tiền mặc định … vừa đổi"; test "key mới của cùng merchant" cho ra cùng VA | patch |
| 2 | BH | Lần xác nhận chưa tiêu (begin/preview) còn dùng được 5 phút cho thao tác khác sau khi "Hủy" | low | Token chỉ nằm trong bộ nhớ tab, không có trong cookie; 2.13-a đã chọn không gắn token với loại thao tác | reject |
| 3 | BH, EC | `preview` không giới hạn tần suất: một lần xác nhận cho dò key Tingee không giới hạn trong 5 phút | medium | Không có throttle nào ở `organizer`/`tingee`/`platform/http`; `connect` của BTC chưa liên kết đã cho dò y như vậy từ 2.6 | defer |
| 4 | BH, EC | "Nhập key khác" giữ `selected`/`missingChoice`: VA chọn ở key cũ tự được chọn, lỗi "Chọn một tài khoản" hiện sẵn | low | `otherKey()` chỉ reset `save`, `load`, `preview` | patch |
| 5 | BH, EC | "Hủy"/"Nhập key khác" bấm được khi đang lưu: người dùng tưởng đã hủy nhưng server vẫn đổi key | low | Hai nút không có `disabled={save.isPending}` | patch |
| 6 | BH, EC | Banner lỗi tải lại danh sách với `TINGEE_CREDENTIAL_INVALID` chỉ có "Thử lại" gửi lại đúng key bị từ chối | low | Nhánh `loadFailure` luôn gắn `reload` | patch |
| 7 | BH | Câu "URL IPN giữ nguyên" không nhắc phải dán lại URL IPN khi key mới thuộc merchant khác | low | Checklist IPN có ở LinkedView nhưng câu hậu quả ở `ReplaceKeyFlow` gợi ý không cần làm gì | patch |
| 8 | BH | Form đổi key không có link portal; banner key bị thu hồi bỏ link "Mở portal Tingee" | low | Owner đổi key đã dùng portal Tingee; sửa phải thêm prop cho `TingeeKeyForm` | reject |
| 9 | BH | Xem trước không đánh dấu VA đang là mặc định | low | Danh sách có tên ngân hàng + 4 số cuối; sửa phải thêm trường vào hợp đồng | reject |
| 10 | BH | Audit không ghi id credential cũ | low | Giống mẫu `tingee_credential.connected` có từ 2.6; `retired_at` của dòng cũ trùng `now()` của transaction nên vẫn truy được | reject |
| 11 | BH | `replaceKey` không kiểm credential mong đợi: tab cũ có lần xác nhận riêng ghi đè lần đổi vừa xong | low | Mỗi lần đổi đều là thao tác Owner đã xác nhận lại và có email cảnh báo riêng | reject |
| 12 | BH | Test cách ly không còn chứng minh `REAUTH_REQUIRED` ở route mới | low | `payout-account.test.ts` đã có "thiếu xác nhận ở mọi bước" và "Admin → FORBIDDEN_ROLE không tiêu token" | reject |
| 13 | BH | `assertReauth` không có unit test riêng trong `reauth.test.ts` | low | Dùng chung điều kiện `usableGrant` với `consumeReauth` (đã có test); test payout phủ không header, sai, đã dùng, hết hạn, session khác và "không bị tiêu" | reject |
| 14 | VG, BH | e2e chỉ kiểm nút khôi phục ("Nhập key khác", "Tải lại") hiện ra, không bấm; không có ca lưu lỗi `PAYOUT_ACCOUNT_UNAVAILABLE` | medium | VG đã xác minh: test lưu lỗi chỉ `toBeVisible()` rồi bấm "Hủy" | patch |
| 15 | VG | Test không kiểm các cột của tài khoản mà `replaceKey` chèn (`tingee_shop_id`, `account_last4`, `account_name`, `bank_bin`) | medium | VG đã xác minh: chỉ kiểm `tingee_credential_id`, `created_by` | patch |
| 16 | BH | Comment/câu chữ cũ: `lib/auth/reauth.ts:16` "sau này đổi key Tingee", doc `applyOverview`, `keyLocked`/`connect` JSDoc "Story 2.13" | low | Đã grep thấy ở `reauth.ts:16`, `payout-account-manager.tsx:115`, `payout-account.service.ts:133,184` | patch |
| 17 | BH | `canReplaceKey` đọc ngược | low | Đổi tên là đổi hợp đồng; spec chọn giữ nghĩa cũ | reject |
| 18 | BH | Vi phạm unique index trả lỗi sai hoặc 500 | false | Mọi lần ghi tài khoản nhận tiền đều khóa `organizations FOR UPDATE` trước, nên không có ghi song song tới unique index | reject |
| 19 | EC | Đổi sang đúng key hiện tại vẫn gỡ mọi tài khoản khác | low | Màn chọn tài khoản nói rõ mọi tài khoản hiện tại bị hủy liên kết; Owner đã xác nhận lại | reject |
| 20 | EC | Có tài khoản nhưng không cái nào mặc định thì email ghi "chưa có" | false | Bất biến "còn tài khoản thì đúng một mặc định" do service giữ dưới khóa dòng BTC | reject |
| 21 | EC | Deploy lệch phiên bản: worker cũ dead-letter payload `previousAccountId: null` | low | Chưa có môi trường deploy (Story 4.7) | reject |
| 22 | EC | Mock e2e: credential sau khi đổi key có cùng id với credential ban đầu | low | `connections` bắt đầu từ 0 dù `state.credential` đã có sẵn | patch |
| 23 | EC | Kiểm body (400) chạy trước `hasEverLinked`/reauth | low | Web luôn kiểm body trước khi gửi; không ai gặp | reject |

## Design Notes

- **Một lệnh ghi duy nhất:** xem trước không ghi gì, nên giữa hai bước key và tài khoản cũ vẫn hiện hành (AC "không gián đoạn bán Vé"). Web giữ Secret Token trong state của form tới lúc lưu rồi gửi lại; api không cất key tạm ở đâu.
- **Không dùng lại `connect`:** `connect` không cần xác nhận lại và retire credential ngay lúc gửi key, nên dùng cho đổi key thì khoảng giữa hai bước BTC không còn tài khoản dùng được.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint && pnpm lint:deps` -- expected: sạch.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `payout-account.test.ts`, test job cảnh báo, `isolation.test.ts`.
- `pnpm --filter @tickee/web test && pnpm --filter @tickee/web test:e2e payout-account` -- expected: pass.
