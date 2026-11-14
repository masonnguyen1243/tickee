---
title: 'Story 4.2-d: Tạm ngừng bán khi Tingee từ chối tài khoản nhận tiền (nhóm VA)'
type: 'feature'
created: '2026-11-14'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '574a688fa25bf084f717badfc5fdcecd48e4bba1'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `create-link` bị Tingee từ chối vì tài khoản nhận tiền (`PAYMENT_ACCOUNT_NOT_ALLOWED`: 2023 VA chưa được cho phép trên Cổng thanh toán; 1023, 1045, 1024, 1072 VA lỗi) chỉ hết hạn từng Đơn (`sales_paused`), không bật cờ dịch vụ thanh toán. Sự kiện vẫn "Đang mở bán", BTC không có banner, mọi Người mua sau đều hỏng (Đơn `TKTDHEKF6W` ở dev với Tingee thật; deferred của 4.2-a).

**Approach:** Lý do ngắt thứ năm `payout_account_not_allowed`, đi như 1133: bật cờ khi `create-link` trả nhóm VA, job dò bỏ qua, "Kiểm tra lại" của Owner tắt cờ không gọi Tingee. Thêm: đổi hoặc hủy tài khoản mặc định tắt cờ. Mọi chỗ đã chia theo lý do (notices, banner, khối "Dịch vụ thanh toán", tab Quản trị; nhãn 4.2-c tự theo `sellability`) nhận lý do mới.

## Boundaries & Constraints

**Always:**
- **Quyết định của Mason (14/11):** mọi mã `PAYMENT_ACCOUNT_NOT_ALLOWED` của `create-link` → `payout_account_not_allowed`. Ở lần dò (`get-va-paging`) các mã này vẫn là "không biết".
- **Bật cờ** trong transaction hết hạn Đơn như các lý do khác (CAS, audit, `org_status_changed`), chỉ khi tài khoản vừa gọi Tingee vẫn là tài khoản mặc định hiện hành và credential vẫn hiện hành; không thì không đổi cờ.
- Job dò không giành lượt cho lý do này. "Kiểm tra lại" của Owner tắt cờ không gọi Tingee (đường `owner_check`, CAS kèm lý do), như 1133.
- **Tắt cờ khi đổi tài khoản mặc định** (đường mới `default_changed`, actor là Owner, cùng transaction, CAS kèm lý do): `setDefault` sang tài khoản khác, `unlink` tài khoản mặc định (còn hay hết tài khoản). `replaceKey` cũng tắt lý do này (đường `new_key`). Lý do khác không bị `default_changed` tắt.
- Migration mới thay CHECK lý do, tương thích ngược.
- `notices`: mã thứ năm `PAYMENT_SERVICE_SUSPENDED_PAYOUT_ACCOUNT_NOT_ALLOWED`, cùng bậc 4, danger, `blocking`, Owner và Admin.
- **Câu chữ.**
  - Banner: tiêu đề "Tài khoản nhận tiền chưa dùng được với Cổng thanh toán", mô tả `PAID_EVENTS_PAUSED`.
    - Owner có hành động "Xem cách xử lý" → Tài khoản nhận tiền.
    - Admin thêm câu "Nhờ Owner cho phép tài khoản trên Cổng thanh toán Tingee hoặc chọn tài khoản nhận tiền khác."
  - Khối "Dịch vụ thanh toán":
    - Lý do: "Tingee chưa cho tài khoản nhận tiền mặc định dùng Cổng thanh toán."
    - Hướng dẫn: "Cho phép tài khoản này trên Cổng thanh toán ở portal Tingee rồi bấm Kiểm tra lại, hoặc đặt tài khoản khác làm mặc định. Tickee không tự kiểm tra được; nếu vẫn chưa được cho phép, lần bán vé kế tiếp sẽ tạm ngừng lại."
    - Kèm liên kết "Mở portal Tingee".
  - Nhãn ở tab Quản trị: "Tài khoản chưa dùng được Cổng thanh toán".

**Never:**
- Không đổi luật của bốn lý do cũ, IPN, Đối soát bù, hay xử lý mã VA ở `listAccounts`/`select`.
- Không gọi Tingee để kiểm VA khi "Kiểm tra lại" hay khi đổi mặc định; lần dò không bao giờ bật cờ.
- Không sửa dữ liệu dev.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| VA bị từ chối | BTC `active`, `create-link` trả 2023 (hay 1023/1045/1024/1072) | Đơn `sales_paused`; cờ `suspended` `payout_account_not_allowed`; audit; `org_status_changed`; Hạng vé > 0đ `paused`, 0đ vẫn bán | N/A |
| Mặc định vừa đổi | Tingee từ chối VA cũ nhưng Owner đã đặt tài khoản khác làm mặc định trước lúc ghi | Đơn `sales_paused`; cờ không đổi | N/A |
| Job dò | BTC `suspended` lý do này | Không gọi Tingee, cờ giữ | N/A |
| Owner "Kiểm tra lại" | Lý do này, quá 30 giây | Cờ `active` (`owner_check`), không gọi Tingee; Đối soát bù | Trong 30 giây → `cooldown` |
| Đặt mặc định khác | Lý do này, `setDefault` tài khoản khác | Cờ `active` (`default_changed`) cùng transaction; Đối soát bù | Đã là mặc định → không đổi |
| Hủy tài khoản mặc định | Lý do này, `unlink` tài khoản mặc định | Cờ `active` (`default_changed`) | N/A |
| Lý do khác | Lý do `token`, `setDefault` tài khoản khác | Cờ giữ | N/A |
| Notices | `suspended` lý do này, Owner và Admin | Đúng một mã mới ở bậc 4 | N/A |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/organizer.ts:398-417` -- `PaymentServiceReason` (+`PAYOUT_ACCOUNT_NOT_ALLOWED`), `PaymentServiceResumePath` (+`DEFAULT_CHANGED`). `reporting.ts:68` -- `StatusNoticeCode`, `PAYMENT_SERVICE_NOTICE_CODES` (Record bắt đủ lý do), thứ tự bậc 4.
- `apps/api/src/modules/organizer/schema.ts:39-62` -- enum và CHECK lý do. `apps/api/drizzle/0023_payment_service_status.sql:7` (đã merge, không sửa) -- sinh `0024` bằng `pnpm --filter @tickee/api db:generate`.
- `apps/api/src/modules/tingee/errors.ts:49` -- `paymentServiceReasonOf` (nhóm VA hiện trả `null`). `tingee.client.ts` `getMerchantServiceStatus` giữ nguyên.
- `apps/api/src/modules/ordering/payment-link.ts:203-219` -- `suspension` thêm `payoutAccountId` (`target.payoutAccountId`).
- `apps/api/src/modules/organizer/payment-service.ts`:
  - `SuspensionInput`/`applySuspension` :150-220 -- lý do này thì kiểm thêm tài khoản mặc định hiện hành (kết quả mới, vd. `stale_account`).
  - `notGatewayPermissionMissing` :315, `claim` :404, `suspendedOrganizationIds` :491, lối tắt Owner :349 -- đổi thành một tập "lý do Owner tự xác nhận" gồm 1133 và lý do mới.
  - `resumeAfterNewKey` :621 -- thêm lý do mới.
  - Hàm mới `resumeAfterDefaultChanged(boss, tx, ctx)`, đường `default_changed`.
- `apps/api/src/modules/organizer/payout-account.service.ts` -- gọi hàm mới ở `setDefault` :366 (khi thật sự đổi) và `unlink` :326 (khi hủy tài khoản mặc định). Gọi `paymentServiceQueues.ready()` trước transaction như `replaceKey` :441.
- `apps/api/src/platform/audit/audit.ts:40` -- doc lý do và đường.
- Web:
  - `apps/web/lib/reporting/status-notices.ts:75` -- mẫu 1133.
  - `apps/web/lib/organizer/payment-service.ts:19,31,40` -- lý do, hướng dẫn, nhãn Quản trị.
  - `apps/web/app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/payment-service-block.tsx:85-90` -- liên kết.
  - `status-banner-stack.tsx:37` tự nhận mã mới qua `PAYMENT_SERVICE_NOTICE_CODES`.
- Test:
  - API:
    - `apps/api/test/ordering/payment-link.test.ts:99-110` -- bảng mã → lý do; nhóm VA hiện là `null`.
    - `test/organizer/payment-service.test.ts` -- mẫu 1133.
    - `test/tingee/client.test.ts:548-559`, `test/reporting/notices.test.ts`.
    - Fake trả 2023 khi VA không thuộc merchant (`test/tingee-fake/server.ts:511`).
  - Contracts: `packages/contracts/test/admin-reporting.test.ts`.
  - Web unit: `apps/web/test/status-notices.test.ts`, `payment-service.test.ts`.
  - e2e: `status-banners`, `payout-account`, `admin-closed-beta`; mocks `organizer-mock.ts`, `admin-mock.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/organizer.ts`, `reporting.ts` (+ test) -- lý do, đường, mã notice bậc 4.
- [x] `apps/api/src/modules/organizer/schema.ts`, `apps/api/drizzle/0024_*.sql` -- CHECK lý do mới.
- [x] `apps/api/src/modules/tingee/errors.ts` -- nhóm VA → lý do mới cho `create-link`.
- [x] `apps/api/src/modules/ordering/payment-link.ts` -- truyền tài khoản đã dùng vào bật cờ.
- [x] `apps/api/src/modules/organizer/payment-service.ts`, `payout-account.service.ts`, `platform/audit/audit.ts` -- bật cờ có kiểm tài khoản, dò bỏ qua, lối tắt Owner, tắt khi đổi mặc định và khi đổi key.
- [x] `apps/web/lib/reporting/status-notices.ts`, `apps/web/lib/organizer/payment-service.ts`, `payment-service-block.tsx` -- câu chữ và liên kết theo phần đã khóa.
- [x] Test API cho mọi dòng I/O Matrix (fake 2023); cập nhật bảng mã cũ; web unit; e2e banner, khối và tab Quản trị theo mẫu 1133.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- đóng mục "`create-link` bị từ chối vì VA … Cần quyết".

**Acceptance Criteria:**
- Given BTC `suspended` lý do này, when mở trang công khai và trang chủ BTC, then Hạng vé có phí "Tạm ngừng bán" và nhãn Sự kiện "Tạm ngừng bán".
- Given mọi nhánh, then `expectInvariants` đúng, `pnpm lint:deps` sạch, và test hiện có của bốn lý do cũ vẫn pass.

## Implementation Notes

- `story_key` để trống: Story 4.2 đã `done` và đã merge (#71, #72); 4.2-d đóng một mục deferred, không mở lại story trong sprint-status.
- Nhóm VA chỉ đổi lý do ở `create-link` (`createLinkServiceReasonOf`); lần dò vẫn dùng `paymentServiceReasonOf` (VA → "không biết").
- Bật cờ lý do VA kiểm thêm tài khoản đã gọi còn là mặc định hiện hành (`stale_account`); bốn lý do cũ chỉ kiểm credential như trước.
- `OWNER_CONFIRMED_REASONS` (1133 và lý do VA) thay điều kiện "khác `gateway_permission_missing`" ở job dò và lối tắt "Kiểm tra lại".
- Migration `0024_payout_account_not_allowed.sql`: bỏ và thêm lại CHECK lý do.

## Spec Change Log

## Review Triage Log

Lượt 1 (14/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | VG (gap) | Không test ghim chốt `stale_account` chỉ áp cho lý do VA: mã khác (1033) về lúc Owner đổi mặc định vẫn phải bật cờ | low | patch | Bỏ điều kiện lý do ở `applySuspension` không test nào đỏ; các test đổi mặc định chỉ dùng 2023 hoặc đổi sau khi cờ đã bật. |
| 2 | VG (other) | Chú thích `status-banner-stack.tsx:33` còn ghi "bốn mã dịch vụ thanh toán" | low | patch | Giờ có năm mã; code không đổi vì tập dựng từ `PAYMENT_SERVICE_NOTICE_CODES`. |
| 3 | BH | Hướng dẫn "Cho phép tài khoản này trên Cổng thanh toán…" chỉ hợp 2023, không hợp VA lỗi (1023/1045/1024/1072) | low | reject | Câu chữ thuộc phần đã khóa, Mason duyệt; câu đã có lựa chọn "đặt tài khoản khác làm mặc định" cho VA lỗi. |
| 4 | BH | Khối không nêu tài khoản bị từ chối (deferred 2.6 nói "VA tương ứng") | low | reject | Khối nằm ở trang Tài khoản nhận tiền, danh sách có nhãn tài khoản mặc định; lý do ghi rõ "tài khoản nhận tiền mặc định". |
| 5 | BH | Khối không có nút đặt tài khoản khác làm mặc định hay thêm tài khoản | low | reject | Hai thao tác này có sẵn trong danh sách tài khoản ngay trên cùng trang. |
| 6 | BH | Toast "đã hoạt động lại… bán lại bình thường" khi không kiểm Tingee; toast đổi mặc định/hủy không nói mở bán lại | low | reject | Cùng câu với lối tắt 1133 đã chốt ở 4.2-b; banner và nhãn tự cập nhật qua `org_status_changed`. |
| 7 | BH | Chú thích nói `get-va-paging`/`listAccounts` không thấy lỗi VA, nhưng `listAccounts` chỉ trả VA `active`: kiểm VA mặc định còn trong danh sách có thể bắt được 2023 | maybe-false | defer | Ca thật ở dev: VA mặc định của BTC "test" được liên kết qua `listAccounts` mà `create-link` vẫn bị từ chối nhóm VA; fake 2023 chỉ mô phỏng. Cần UAT Tingee thật; nếu đúng thì medium. |
| 8 | BH, ECH | Nhánh `reason_changed` cho lý do VA ghi đè lý do dò được (`token`…): BTC rời job dò, Owner tự mở lại; `checked_at` cũ gây `cooldown` | low | reject | Cần hai `create-link` đang bay với hai mã khác nhau cho cùng BTC; cùng yếu điểm có từ 1133 (4.2-a); lần tạo link kế bật lại lý do thật; sửa là thêm nhánh chặn. |
| 9 | ECH | Lần dò lý do dò được thấy `active` tắt cờ không kèm lý do: `create-link` đang bay đổi lý do sang VA giữa lúc dò thì `get-va-paging` tắt cờ VA nó không thấy được | low | patch | `payment-service.ts:421-427` gọi `resumePaymentService` không có `expectedReason`; sửa một dòng: truyền lý do đã giành. |
| 10 | ECH | `isOwnerConfirmed` là type predicate: nhánh sai thu hẹp `claimed.reason` thành `null` | low | patch | `payment-service.ts:355`; đọc `claimed.reason` sau `if` (vá #9) bị gõ kiểu sai. |
| 11 | BH | Nhánh `stale_account` của lần dò không bao giờ chạy; `payoutAccountId` bắt buộc cho mọi lý do | low | reject | Lần dò không trả lý do VA (`paymentServiceReasonOf`), nhánh chỉ để đủ kiểu; doc của trường nói chỉ dùng cho lý do VA. |
| 12 | BH | Quay về bản cũ khi đã có dòng lý do mới; migration khóa bảng | low | reject | `organizations` nhỏ; như mọi lần thêm giá trị enum, Quản trị "Mở lại" trước khi rollback. |
| 13 | BH | Không truy được VA bị từ chối: audit và log bật cờ thiếu tài khoản và mã Tingee | false | reject | `PaymentLinks.attempt` log `warn` "Tingee từ chối tạo link" kèm `tingeeCode`, `domainCode`, mã Đơn và BTC trước khi hết hạn Đơn. |
| 14 | BH | Thiếu test: `unlink` đua `create-link`, tín hiệu và `changed_fields` của `unlink`, Đối soát bù khi hết tài khoản, `replaceKey` đua, Quản trị mở lại lý do này, e2e "Chưa kiểm tra" | low | reject | Chốt `stale_account` kiểm `is_default` và `retired_at` (đổi hay hủy như nhau); `resumePaymentService` và Quản trị mở lại không phụ thuộc lý do, đã có test ở 4.2-a. |
| 15 | BH | `payment-link.test.ts` mất ca "tạm ngừng mà không bật cờ"; không kiểm khóa `SERVICE_REASON` khớp `PAUSE_CODES` | low | reject | Mọi mã tạm ngừng giờ đều bật cờ (ca không bật chỉ còn `stale_*`, có test); mã thiếu khóa thì `toMatchObject` với `undefined` đỏ. |
| 16 | BH | Doc `PaymentServiceStatus` (contracts) và `schema.ts` nói cả năm lý do là "bằng key hiện hành" | false | reject | Câu nói `create-link` (luôn gọi bằng key hiện hành và VA mặc định) bị từ chối vì một trong năm lý do; lý do thứ năm nêu riêng là tài khoản nhận tiền. |
| 17 | BH | Helper `addAccount` chèn SQL thô, cứng `bank_bin`, `account_type` | low | reject | Helper test; chỉ cần VA thuộc merchant fake. |

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass (migration `0024` chạy).
- `pnpm --filter @tickee/web test`, `pnpm --filter @tickee/contracts test` -- expected: pass.
- `pnpm --filter @tickee/web build` rồi `pnpm --filter @tickee/web exec playwright test e2e/status-banners.spec.ts e2e/payout-account.spec.ts e2e/admin-closed-beta.spec.ts` -- expected: pass.
