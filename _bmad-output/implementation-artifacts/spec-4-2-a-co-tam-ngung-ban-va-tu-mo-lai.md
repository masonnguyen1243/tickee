---
title: 'Story 4.2-a: Cờ dịch vụ thanh toán — tự "Tạm ngừng bán" và tự mở lại (lõi API)'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '4a62fee9b8daf0d2cb23bf85e22b706de330c4a6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi Tingee ngắt dịch vụ của BTC (hết Token, khóa merchant) hay key hiện hành không còn dùng được, mỗi lần tạo link chỉ làm hết hạn một Đơn (`sales_paused`); Sự kiện có phí vẫn "Đang bán" với mọi Người mua sau đó, và không có gì tự mở lại hay đối soát khi dịch vụ về (FR-15, FR-20, AD-32).

**Approach:** `organizer` giữ cờ `payment_service_status`. `create-link` bằng key hiện hành bị từ chối thì bật cờ trong transaction bù; `sellability` đọc cờ nên mọi Hạng vé > 0đ thành "Tạm ngừng bán" (trang công khai, TX1, chốt link E3-2). Cờ tắt qua job dò 5 phút, API "Kiểm tra lại" của Owner, API Quản trị Tingee, hay khi Owner lưu key mới; tắt thì Đối soát bù mọi Đơn còn mở. `notices` trả mã tương ứng. Giao diện là 4.2-b, nhãn C5 là 4.2-c.

## Boundaries & Constraints

**Always:**
- **Cờ** trên `organizations`: `payment_service_status` (`active` | `suspended`, mặc định `active`), `payment_service_reason` (`token` | `tingee_disabled` | `credential_invalid`, có đúng khi `suspended`), `payment_service_since`, `payment_service_checked_at`. Migration tương thích ngược.
- **Quyết định của Mason (13/11):** lý do theo mã Tingee: 1033 ("gói dịch vụ đã hết hạn") → `token`; 1007, 1034 (merchant bị khóa) → `tingee_disabled`; `TINGEE_CREDENTIAL_INVALID` → `credential_invalid`. Chỉ `tingee` biết mã.
- **Bật cờ** (CAS `active → suspended`; đã `suspended` thì chỉ đổi lý do, giữ `since`): trong cùng transaction hết hạn Đơn của `PaymentLinks` khi `create-link` bị từ chối `MERCHANT_SUSPENDED` hoặc `TINGEE_CREDENTIAL_INVALID`. `PAYMENT_ACCOUNT_NOT_ALLOWED` và credential cũ đã gỡ (Đối soát bù 4.1) không bật cờ. Audit (`actorUserId` null, lý do) và `org_status_changed` trong cùng `tx`.
- **Tắt cờ** (CAS `suspended → active`, xóa lý do và `since`): một hàm duy nhất của `organizer`; audit ghi đường (`probe` | `owner_check` | `platform_admin` | `new_key`) và người làm; phát `org_status_changed`; enqueue job "đã mở lại" (tên queue ở `contracts`) trong cùng `tx`. Worker của `payment` nhận job, enqueue job tra 4.1 tại đồng hồ DB cho mọi Đơn của BTC có link mà `pending`, hoặc `expired` với `expires_at` trong 24 giờ trước.
- **Quyết định của Mason (13/11) — dò:** `tingee.getMerchantServiceStatus(credential)` tạm gọi `get-va-paging` bằng key hiện hành: thành công → hoạt động; `MERCHANT_SUSPENDED` → ngắt kèm lý do theo mã; `TINGEE_CREDENTIAL_INVALID` → `credential_invalid`; lỗi khác → không biết. Ngoài transaction, có timeout. Có API thật thì chỉ sửa `tingee.client.ts` và fake.
- **Dò** ghi `payment_service_checked_at`: hoạt động → tắt cờ; vẫn ngắt → cập nhật lý do; không biết, hay BTC không có tài khoản mặc định → giữ cờ, chỉ log. Job cron mỗi 5 phút ở vai worker, tuần tự qua các BTC `suspended`. `POST /v1/orgs/:orgId/payment-service/check` (chỉ Owner) dò rồi trả `PaymentServiceState`; lần dò trước chưa quá 30 giây thì trả trạng thái hiện tại, không gọi Tingee.
- **Quản trị Tingee:** `GET /v1/admin/organizations/payment-service/suspended` (danh sách BTC `suspended`: id, tên, lý do, `since`, `checkedAt`) và `POST /v1/admin/organizations/:id/payment-service/resume` (204; BTC đang `active` → 409), `@RequirePlatformAdmin`.
- **Lưu key mới** hợp lệ (`replaceKey`, 2.13-b) khi lý do `credential_invalid` → tắt cờ trong cùng transaction thay key; lý do khác giữ cờ. Overview Tài khoản nhận tiền kèm `PaymentServiceState` (`status`, `reason`, `since`, `checkedAt`).
- **`sellability`:** thân `paymentServiceStatus` đọc cờ thật; Hạng vé 0đ không bị ảnh hưởng; Closed Beta là trục riêng; cờ không chặn `publishReadiness`.
- **`notices`:** ba mã mới ở `packages/contracts` (mỗi lý do một mã), danger, `blocking`, không đóng được, Owner và Admin, bậc 4 của thứ tự ưu tiên (ngay sau Closed Beta bị thu hồi); mã Token kèm `data.tingeePortalUrl`. Web chỉ thêm câu chữ tối thiểu để typecheck (`STATUS_NOTICE_CONTENT` bắt đủ mã): tiêu đề theo câu đã chốt, chưa có hành động.
- **`org_status_changed`:** `RealtimeSignal` nhận tín hiệu cấp BTC (không có Sự kiện); stream các Sự kiện không bị ảnh hưởng.
- Mọi route mới qua bộ test cách ly; Tingee fake giả lập được từng mã ngắt ở cả `create-link` và `get-va-paging`.
- **Quyết định của Mason (13/11, sau review lượt 1) — mã 1133:** lý do thứ tư `gateway_permission_missing` (key đúng nhưng chưa được cấp quyền "Cổng thanh toán"): 1133 → `gateway_permission_missing`; 92, 97, 1009 vẫn `credential_invalid`. `get-va-paging` không thấy được thiếu quyền này, nên job dò bỏ qua BTC có lý do này (không gọi Tingee). "Kiểm tra lại" của Owner trên lý do này tắt cờ không cần Tingee xác nhận (đường `owner_check`, tin Owner đã cấp quyền; còn thiếu thì lần tạo link kế bật lại). Lưu key mới hợp lệ tắt cờ cho cả `credential_invalid` và `gateway_permission_missing`; Quản trị Tingee mở được như mọi lý do. `notices` có mã thứ tư cùng bậc 4; tiêu đề web tối thiểu "Key Tingee chưa được cấp quyền Cổng thanh toán".

**Never:**
- Không làm giao diện của 4.2-b (hành động banner, stream `…/live` của BTC, khối "Kiểm tra lại", tab Quản trị) hay nhãn C5 (4.2-c).
- Không đọc số dư Token, ngưỡng hay email Token (4.5); không IP allowlist cho `/admin`.
- Không đổi luật IPN, `markPaid`, chuỗi mốc 4.1, hay trang công khai. Không gọi Tingee trong transaction; không log credential.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Hết Token khi tạo link | `create-link` trả 1033 | Đơn `expired` `sales_paused`; cờ `suspended` `token`; audit; `org_status_changed`; availability: Hạng vé > 0đ `paused`, 0đ `on_sale` | N/A |
| Merchant bị khóa | `create-link` trả 1007 hoặc 1034 | Như trên, lý do `tingee_disabled` | N/A |
| Key hỏng khi tạo link | `create-link` trả mã `TINGEE_CREDENTIAL_INVALID` | Như trên, lý do `credential_invalid` | N/A |
| VA chưa cho phép | `create-link` trả 2023 | Đơn `sales_paused`; cờ không đổi | N/A |
| Key cũ trong Đối soát bù | Credential đã gỡ trả `TINGEE_CREDENTIAL_INVALID` | Cờ không đổi | N/A |
| Tạo Đơn khi đang ngắt | BTC `suspended`, Người mua đặt Hạng vé có phí | TX1 từ chối như "Tạm ngừng bán"; Hạng vé 0đ vẫn đặt được | N/A |
| Dò thấy dịch vụ về | Job 5 phút, `get-va-paging` thành công | Cờ `active`; mỗi Đơn mở của BTC có job tra tại giờ DB; `notices` hết mã | N/A |
| Dò vẫn ngắt / lỗi tạm | Fake vẫn trả mã ngắt / timeout | Cờ giữ (đổi lý do nếu mã khác); `checked_at` cập nhật | Lỗi tạm chỉ log |
| "Kiểm tra lại" liên tục | Owner gọi 2 lần trong 30 giây | Lần 2 không gọi Tingee, trả trạng thái hiện tại | Admin → 403 |
| Quản trị mở lại | BTC `suspended` | 204, cờ `active`, Đối soát bù như dò | BTC `active` → 409 |
| Lưu key mới | Lý do `credential_invalid`, Owner thay key hợp lệ | Cờ `active` cùng transaction thay key; Đối soát bù | Lý do `token` → cờ giữ |
| Hai đường mở lại cùng lúc | Dò và Quản trị cùng tắt | Một lần đổi cờ, một job "đã mở lại" | Bên thua CAS không làm gì |
| Notices | BTC `suspended` lý do bất kỳ, gọi bởi Owner và Admin | Đúng một mã theo lý do, sau `CLOSED_BETA_REVOKED`, trước `PAYOUT_ACCOUNT_NOT_LINKED` | N/A |
| Key thiếu quyền Cổng thanh toán | `create-link` trả 1133 | Đơn `sales_paused`; cờ `suspended` `gateway_permission_missing`; job dò không gọi Tingee cho BTC này, cờ giữ | N/A |
| Owner báo đã cấp quyền | Lý do `gateway_permission_missing`, Owner "Kiểm tra lại" | Cờ `active` (đường `owner_check`), không gọi Tingee; Đối soát bù | Trong 30 giây sau lần trước → trả trạng thái hiện tại |

</frozen-after-approval>

## Code Map

Gốc `apps/api/src` trừ khi ghi khác. `C` = `packages/contracts/src`.

- `modules/organizer/schema.ts` (`organizations` :7-40, mẫu `closed_beta_status` + CHECK :36); `apps/api/drizzle/` (mới nhất `0022_event_time_venue_version`, mẫu `0007_closed_beta.sql`, sinh bằng `pnpm db:generate`). Grants không đổi (`platform/db/grants.ts`).
- `modules/organizer/closed-beta.ts:48` (`changeClosedBetaStatus`: UUID, CAS, audit, 409) + `modules/admin/closed-beta.controller.ts:19-52` -- mẫu API Quản trị. `apps/api/module-graph.cjs`: `admin → organizer`; `organizer → identity, tingee`; `payment → ordering, organizer, tingee`; `reporting → … organizer`. `organizer`/`admin` không import `ordering`/`payment` → Đối soát bù khi mở lại đi qua job.
- `modules/organizer/payout-targets.ts:32` (`defaultPayoutTargetOf`: credential hiện hành đã giải mã) -- nguồn credential cho dò.
- `modules/organizer/payout-account.service.ts` -- `replaceKey` :422 (kiểm key mới bằng `listAccounts` :428 ngoài transaction, transaction :436 có `lockOrganization`), overview :88 (`tingeePortalUrl` từ `tingee/portal.ts`).
- `modules/tingee/tingee.client.ts` (`listAccounts` :223, `CreateLinkError.tingeeCode` :90-121, `dataOf` :340 mất mã gốc), `tingee/errors.ts:16-25` (1007/1033/1034 → `MERCHANT_SUSPENDED`; 92/97/1009/1133 → `TINGEE_CREDENTIAL_INVALID`).
- `apps/api/test/tingee-fake/server.ts` -- dispatch :687-699 (`behavior` `suspended` → 1007, `forbidden` → 1133), kịch bản theo merchant `linkReplies`/`orderReplies` :76-89; thêm kịch bản trả lời cho `get-va-paging` (vd. `accountReplies`) để dò trả 1033/1034/thành công.
- `modules/ordering/payment-link.ts` -- `SALES_PAUSED_CODES` :69, nhánh từ chối → `expire` :201; bật cờ trong transaction của `expire` (`ordering → organizer` hợp lệ).
- `modules/ordering/sellability.ts` -- stub `paymentServiceStatus` :38, `paidOkOf` :123 (`saleFactsOf`, `paymentLinkBlock`).
- `modules/ordering/reconciliation-jobs.ts` -- `enqueueReconciliation` :109 (chưa export qua `ordering/index.ts`), `reconcileJobId` :95. Worker 4.1 (`payment/reconciliation-worker.ts:158-168`) tự hẹn mốc kế khi Đơn `expired` chưa tới mốc sau hết hạn, nên job tra "ngay" an toàn và nối lại chuỗi đã dừng. Không có index `(organization_id, status)` trên `orders`.
- `platform/jobs/queue.ts` (`defineQueue` :65, `registerQueueWorker` :178, `QueueProducer.ready()` :100), `modules/identity/identity-janitor.ts:56-63` (mẫu cron `boss.schedule`, chỉ vai worker; `platform/jobs/boss.ts:31`), `C/jobs.ts:4`, `worker.module.ts`.
- `platform/realtime/notify.ts:6` (`realtime.notify(tx, topic, {id, organizationId, eventId})`), `C/realtime.ts:38-43` (`eventId` bắt buộc), `realtime-hub.ts:248` (lọc theo `filter`).
- `modules/reporting/notices.service.ts:93` (nguồn notices; thêm nguồn theo chú thích :87), `C/reporting.ts:15-39` (mã, `STATUS_NOTICE_PRIORITY`; bậc 4 chưa có mã), `apps/web/lib/reporting/status-notices.ts:19-37` (`Record` bắt đủ mã).
- Test: `test/ordering/payment-link.test.ts` (kịch bản `linkReplies`), `test/payment/reconciliation.test.ts`, `test/ordering/sellability.test.ts`, `test/organizer/isolation.test.ts`, `test/reporting/notices.test.ts`, test API Quản trị closed-beta (mẫu), `test/identity/identity-janitor*` (mẫu cron), `apps/web/test/status-notices.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `C/organizer.ts`, `C/reporting.ts`, `C/realtime.ts`, `C/jobs.ts`, `C/admin*` -- enum trạng thái/lý do, `PaymentServiceState`, overview kèm trạng thái, ba mã notice ở bậc 4, tín hiệu cấp BTC, queue dò (cron) và queue "đã mở lại" + dead-letter, kiểu danh sách Quản trị.
- [x] `apps/api/src/modules/organizer/schema.ts`, `apps/api/drizzle/0023_*.sql` -- bốn cột + CHECK.
- [x] `apps/api/src/modules/tingee/` -- `getMerchantServiceStatus` (tạm qua `get-va-paging`), lý do theo mã cho `CreateLinkError` và dò.
- [x] `apps/api/test/tingee-fake/server.ts` -- kịch bản trả lời `get-va-paging`, mã 1033/1034.
- [x] `apps/api/src/modules/organizer/payment-service.ts` (mới), `organizer/index.ts`, controller Owner -- đọc cờ, bật, tắt (audit, notify, job), dò + cooldown 30 giây, cron worker 5 phút, `POST …/payment-service/check`.
- [x] `apps/api/src/modules/ordering/payment-link.ts`, `sellability.ts`, `index.ts` -- bật cờ khi `create-link` bị từ chối; `sellability` đọc cờ; export đọc Đơn mở theo BTC và `enqueueReconciliation`.
- [x] `apps/api/src/modules/payment/` + `worker.module.ts` -- worker job "đã mở lại": fan-out job tra 4.1.
- [x] `apps/api/src/modules/organizer/payout-account.service.ts` -- tắt cờ `credential_invalid` khi thay key; overview kèm trạng thái.
- [x] `apps/api/src/modules/admin/` -- danh sách và mở lại.
- [x] `apps/api/src/modules/reporting/notices.service.ts`, `platform/realtime/` -- notices từ cờ; NOTIFY cấp BTC.
- [x] `apps/web/lib/reporting/status-notices.ts` (+ test) -- tiêu đề cho ba mã, chưa hành động.
- [x] Test API cho mọi dòng I/O Matrix (fake), unit hàm lý do theo mã, cách ly các route mới, bất biến tồn kho.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- đóng mục 4.2 (cờ; Đối soát bù khi mở lại gồm Đơn `expired` trong 24 giờ; banner cấu hình 1133 qua `credential_invalid`); ghi mới: hợp đồng dò tạm và mã Token chờ Tingee xác nhận; 2023/VA lỗi vẫn không bật cờ.

**Acceptance Criteria:**
- Given BTC `suspended`, when "Thử lại" tạo link, then chốt E3-2 hết hạn Đơn `sales_paused`, không gọi Tingee.
- Given BTC `active` và Tingee bình thường, then mọi test hiện có của tạo link, Đối soát bù và notices vẫn pass.
- Given mọi nhánh, then `expectInvariants` đúng và `pnpm lint:deps` không vi phạm module graph.

## Implementation Notes

- **Audit mang lý do/đường mà không có cột mới:** `audit_events` chỉ ghi tên trường. Lý do và đường mở lại nằm ở `target` (tiền lệ `platform_admin.read` → `closed_beta_queue`/`pending`): `organization.payment_service_suspended` / `…_reason_changed` có `target` `payment_service_reason`/`<lý do>`, `organization.payment_service_resumed` có `target` `payment_service_resume`/`<đường>`; BTC ở `organization_id`.
- **Bật cờ chỉ khi key còn hiện hành:** `PayoutTarget` thêm `credentialId`; `suspendPaymentService` khóa dòng BTC (`FOR NO KEY UPDATE`, không chặn INSERT tham chiếu BTC) rồi kiểm credential bằng câu mới, nên `replaceKey` commit trước transaction bù → `stale_credential`, cờ không đổi. Cờ vẫn bật khi job (a) đã hết hạn Đơn trước (Tingee vẫn đã báo ngắt).
- **Dò giành lượt bằng `payment_service_checked_at`:** CAS `suspended` + quá 30 giây ghi `checked_at` trước khi gọi Tingee, nên job dò và "Kiểm tra lại" chồng nhau chỉ gọi Tingee một lần. Hệ quả: "Kiểm tra lại" trên BTC `active` trả trạng thái hiện tại, không gọi Tingee (dò không bao giờ bật cờ).
- **`org_status_changed`:** `RealtimeSignal.eventId` thành tùy chọn, có refine (topic cấp BTC không có `eventId`, topic khác bắt buộc); `realtime.notifyOrganization(tx, topic, organizationId)` phát `{type, id: organizationId, organizationId}`.
- **`tingeePortalUrl` cho `notices`:** `ReportingModule.forRoot(config)`; `organizer/index.ts` re-export `tingeePortalUrl` (reporting không import `tingee`).
- **Test dùng chung BTC:** `payment-link.test.ts`, `order-live.test.ts` đặt lại cờ trong `beforeEach` (`resetPaymentService`), vì mã ngắt của test trước giờ bật cờ của BTC dùng chung.
- **Sau review lượt 1 (Mason chốt 1133, giữ code):** lý do `gateway_permission_missing` (enum, CHECK, `0023` sinh lại vì chưa commit; DB test local `tickee_test` đã gỡ tay bản `0023` cũ, DB dev `tickee` dừng ở `0022` không ảnh hưởng); job dò bỏ qua lý do này; "Kiểm tra lại" mở lại không gọi Tingee, CAS kèm lý do đã giành; `resumeAfterNewKey` chữa cả `credential_invalid` lẫn lý do này; mã notice thứ tư. Vá: bật cờ thì đặt lại `checked_at`; kết quả dò sau tranh chấp là `skipped`; `notifyOrganization`/`notify` gõ kiểu theo topic.
- **Sau review lượt 2:** lần dò ánh xạ mọi mã `TINGEE_CREDENTIAL_INVALID` (kể cả 1133) thành `credential_invalid` (1133 → `gateway_permission_missing` chỉ cho `create-link`); đổi lý do do Owner "Kiểm tra lại" ghi actor là Owner; test ghim cấu hình queue "đã mở lại" và so CHECK của DB với enum ở contracts.
- **Sprint-status:** spec này chỉ là phần a của Story 4.2 (còn 4.2-b, 4.2-c), nên story giữ `in-progress`, không đặt `review`/`done`.
- Kiểm (13/11): `pnpm typecheck`, `pnpm lint:deps` sạch; API 1140/1140 (70 file); web 228/228; contracts 287/287; e2e `payout-account`, `dashboard-shell`, `status-banners` 124/124 (trước lượt 2). Test chập chờn đã biết `payout-default-job.test.ts` (deferred E2-8) hỏng một lần ở lượt chạy đầy đủ giữa chừng, chạy lại pass.

## Spec Change Log

- **Lượt review 1 (13/11/2026), intent_gap #1 → Mason chốt lại phần đã khóa.** Phát hiện: 1133 gộp vào `credential_invalid` và dò tạm bằng `get-va-paging` luôn thấy hoạt động (key đã qua `get-va-paging` lúc liên kết), nên cờ tắt-bật mỗi 5 phút. Sửa: thêm lý do `gateway_permission_missing` cho 1133, job dò bỏ qua lý do này, "Kiểm tra lại" của Owner tắt cờ không cần Tingee, lưu key mới chữa cả lý do này, mã notice thứ tư; hai dòng mới ở I/O Matrix. Trạng thái tránh được: cờ nhấp nháy vô tận, audit và Đối soát bù mỗi 5 phút, BTC không biết lỗi thật là thiếu quyền. Mason chọn giữ code và vá có mục tiêu thay vì revert. KEEP: mọi phần khác của 4.2-a (bật cờ trong transaction hết hạn Đơn, kiểm credential hiện hành khi bật, lượt dò bằng CAS `checked_at`, job "đã mở lại" của `organizer` + worker `payment`, `notifyOrganization`, API Quản trị, test `payment-service.test.ts`).

## Review Triage Log

Lượt 1 (13/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH, ECH, VG (other) | Mã 1133 (key thiếu quyền "Cổng thanh toán") bật `credential_invalid`, nhưng dò tạm bằng `get-va-paging` luôn thấy hoạt động (key đã qua `get-va-paging` lúc liên kết) → cờ tắt trong 5 phút, lần tạo link kế bật lại, lặp mãi; banner nhấp nháy, audit và Đối soát bù chạy mỗi vòng; 4.2-b cũng không phân biệt được "thiếu quyền" với "key sai" | medium | intent_gap | `connect`/`replaceKey` kiểm key bằng `listAccounts` (`get-va-paging`); `paymentServiceReasonOf` gộp 1133 với 92/97/1009; quy tắc "dò hoạt động → tắt cờ" nằm trong phần đã khóa. |
| 2 | BH, ECH | Dò thấy hoạt động thì tắt cờ mà không kiểm key đã dò còn hiện hành (bật cờ thì có kiểm) | low | reject | Chỉ khi Owner thay key và key mới bị ngắt trong đúng khoảng ≤5 giây dò đang chờ Tingee; tự sửa ở lần tạo link kế. |
| 3 | BH | `payment_service_checked_at` giữ qua các đợt ngắt: thời gian chờ 30 giây của đợt trước có thể nuốt lần "Kiểm tra lại" đầu; `checkedAt` cũ hơn `since` | low | patch | `applySuspension` không đặt lại `checked_at` khi `active → suspended`; sửa một trường. |
| 4 | BH | `POST …/payment-service/check` chỉ trả trạng thái, không nói kết quả dò (chờ, Tingee không trả lời, vẫn ngắt) cho toast 4.2-b | low | defer | Toast thuộc 4.2-b; thêm `outcome` khi làm giao diện. |
| 5 | BH, ECH | Kết quả dò sau tranh chấp bị gán `still_suspended` và log "vẫn ngắt" khi BTC đã `active` hoặc key đã thay | low | patch | `probe` nhánh `suspended` đổi mọi kết quả khác `reason_changed` thành `still_suspended`; ánh xạ `unchanged`-trên-`active` và `stale_credential` thành `skipped`. |
| 6 | BH | `reconcilableOrderIdsOf` quét cả bảng `orders` (không có index nào theo `organization_id`) | low | defer | `orders` chỉ có index `(user_id, created_at)`, `(event_id, created_at)`; chạy một lần mỗi lần mở lại; đo ở 5.8. |
| 7 | BH, ECH | Mở lại enqueue mọi job tra cùng một mốc, có thể vượt 20 request/10 giây của Tingee | low | defer | Cùng yếu điểm giới hạn tốc độ của 4.1 (deferred 5.8); hiện `TINGEE_ORDER_STATUS_QUERY` tắt ngoài local. |
| 8 | BH | Đơn hết hạn quá 24 giờ trước lúc mở lại bị bỏ, không log số lượng | low | reject | Chuỗi các Đơn này đã dừng kèm cảnh báo `payment_reconciliation_stopped` của 4.1. |
| 9 | VG (gap) | Không test cờ vẫn bật khi job (a) đã hết hạn Đơn trước lúc Tingee từ chối | low | patch | Dòng `1007 (tạm ngừng)` của `payment-link.test.ts:518` không đọc cờ; bỏ nhánh này không test nào đỏ. |
| 10 | VG (gap) | Cửa sổ 24 giờ của Đơn `expired` khi mở lại không được thử (Đơn mẫu có `expires_at` ở tương lai) | low | patch | `payment-service.test.ts:387-418`; đổi cửa sổ thành 30 phút vẫn pass. |
| 11 | VG (gap) | `SecretBoxError` → `unknown` và `probeSuspended` đi tiếp sau lỗi một BTC không có test | low | patch | Bỏ hai `catch` không test nào đỏ. |
| 12 | VG (gap) | Thứ tự danh sách Quản trị (ngắt lâu nhất trước) không được kiểm | low | patch | Test chỉ dùng `find`. |
| 13 | VG (gap) | "Dò không bao giờ bật cờ" khi BTC vừa được mở lại trong lúc dò chưa có test | low | patch | Bỏ `if (!activate) return 'unchanged'` không test nào đỏ. |
| 14 | BH | Thiếu test: hai lần từ chối song song → một audit; worker "đã mở lại" chạy lại sau commit | low | reject | Đường `unchanged` đã có unit trong `applySuspension`; worker idempotent (id job theo Đơn + mốc). |
| 15 | BH | `PaymentServiceState` cho phép trạng thái không thể có (phẳng, không `discriminatedUnion`) | low | reject | CHECK của DB bảo đảm; đổi dạng contract là việc của 4.2-b nếu cần thu hẹp kiểu. |
| 16 | BH | Đọc `organizations` thêm trên đường nóng (availability, TX1, notices) | low | reject | Đọc theo khóa chính một dòng. |
| 17 | BH | `organizer` re-export `tingeePortalUrl` chỉ để `reporting` không import `tingee` | low | reject | Không có hại cụ thể; tránh được mũi tên mới trong module graph. |
| 18 | BH | Banner chỉ có tiêu đề, không nói nguyên nhân/hậu quả tới khi có 4.2-b | low | reject | Phần đã khóa: web chỉ tiêu đề, hành động ở 4.2-b. |
| 19 | BH | Không gửi email khi bị ngắt | low | reject | AC 4.2 không có email; email Token ở 4.5. |
| 20 | BH | Lưu key mới khi lý do `token`/`tingee_disabled` không dò ngay bằng key mới | low | reject | Phần đã khóa: lý do khác giữ cờ; job dò trong ≤5 phút. |
| 21 | BH | `notifyOrganization` nhận mọi topic, chỉ lỗi lúc chạy | low | patch | Khai báo `ORGANIZATION_REALTIME_TOPICS` `as const` và gõ kiểu tham số. |
| 22 | BH | Mỗi BTC còn ngắt log hai `warn` mỗi 5 phút | low | reject | Nhiễu vận hành; cảnh báo theo marker ở 4.6. |
| 23 | BH, ECH | Danh sách Quản trị không phân trang; một lượt cron không có trần thời gian | low | defer | Quy mô Closed Beta nhỏ; lượt chồng nhau đã được chặn bởi CAS `checked_at`. |
| 24 | BH | Diff thiếu journal/snapshot nên không kiểm được migration đã đăng ký | false | reject | `apps/api/drizzle/meta/_journal.json:170` có `0023_payment_service_status`; toàn bộ test chạy migration. |
| 25 | ECH | `get-va-paging` trả HTTP 5xx kèm mã ngắt vẫn bị coi là kết luận | low | reject | Tingee trả lỗi miền bằng HTTP 200/4xx; một `return` mới cho ca chưa thấy. |
| 26 | ECH | `create-link` bị từ chối bằng HTTP 401/403 kèm mã ngắt bị coi là mơ hồ (`timeout`), không bật cờ | maybe-false | defer | Phân loại HTTP ≠ 200 = mơ hồ có từ 3.4; cần UAT Tingee thật (E3-3) để biết Tingee trả mã ngắt kèm HTTP nào. Nếu đúng thì medium. |
| 27 | ECH | `org_review_items_changed` là topic cấp BTC nhưng không nằm trong `ORGANIZATION_REALTIME_TOPICS` | low | reject | Chưa có nơi phát; 4.3 phát lần đầu sẽ gặp lỗi refine ngay trong test. |

Lượt 2 (13/11/2026, sau vá intent_gap #1 và các patch lượt 1).

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 28 | BH, ECH | Dò nhận 1133 từ `get-va-paging` bị gán `gateway_permission_missing` (ánh xạ của `create-link`): lý do của BTC đang ngắt vì Token/merchant đổi thành lý do mà job dò bỏ qua và Owner tự mở lại không cần Tingee | medium | patch | `tingee.client.ts` › `getMerchantServiceStatus` dùng `paymentServiceReasonOf`; phần đã khóa (quyết định dò): `TINGEE_CREDENTIAL_INVALID` → `credential_invalid`, nên 1133 của lần dò phải là `credential_invalid`. |
| 29 | ECH | Lần dò nhận "hoạt động" bằng key cũ tắt cờ của đợt ngắt mới bằng key mới | low | reject | carried #2: cùng chỗ, cùng khẳng định; code không đổi. |
| 30 | BH, ECH | Lối tắt `gateway_permission_missing` của "Kiểm tra lại" tắt cờ mà CAS không kiểm lý do: lý do vừa đổi (Token/merchant) giữa lúc giành lượt và lúc tắt cũng bị mở lại không cần Tingee | low | patch | `probe` giành lượt rồi gọi `resumePaymentService` (CAS chỉ `status = 'suspended'`); thêm điều kiện lý do đã giành vào CAS. |
| 31 | BH | Đổi lý do do Owner "Kiểm tra lại" ghi audit với actor `null` | low | patch | `applySuspension` cố định `actorUserId: null`; truyền `actorUserId` của lần dò. |
| 32 | BH | Mở lại do Owner tự xác nhận (không có Tingee) ghi cùng đường `owner_check` với mở lại đã được Tingee xác nhận | low | reject | Phần đã khóa ghi đường `owner_check` cho lối tắt này. |
| 33 | BH | Chú thích ở `replaceKey` nói key mới "được Tingee chấp nhận" nên chữa được `gateway_permission_missing` | low | patch | `payout-account.service.ts:539`; `listAccounts` không thấy quyền Cổng thanh toán; sửa chú thích: tin Owner, lần tạo link kế sẽ kiểm. |
| 34 | BH | Tài liệu còn nói ba lý do / hai nguyên nhân | low | patch | `platform/audit/audit.ts:40-41`, chú thích `organizer/schema.ts:31`, doc `PaymentServiceStatus`/`PaymentServiceReason` ở contracts. |
| 35 | BH | Thiếu test: nhánh `stale_credential` → `skipped` của dò | low | patch | Hook `afterNextProbe` chỉ dùng cho ca Quản trị mở lại. |
| 36 | VG (gap) | Không test ghim retry/dead-letter của queue "đã mở lại" | low | patch | Các queue anh em có (`reconciliation.test.ts:268-277`); đổi `retryLimit: 0` không test nào đỏ. |
| 37 | BH | Danh sách trạng thái/lý do lặp ở contracts, drizzle `enum`, CHECK schema và migration, không gì kiểm khớp | low | patch | Thêm lý do ở contracts mà quên CHECK sẽ làm transaction hết hạn Đơn rollback (cờ ghi cùng `tx`); một test so CHECK với `Object.values(PaymentServiceReason)`. |
| 38 | ECH | `realtime.notify` vẫn nhận `ORG_STATUS_CHANGED` kèm id Sự kiện, chỉ lỗi lúc chạy | low | patch | Gõ kiểu `topic: Exclude<RealtimeTopic, OrganizationRealtimeTopic>`. |
| 39 | BH | Không chống nhấp nháy chung (dò mở lại sai, Owner tự xác nhận liên tục) | low | reject | Rủi ro của dò tạm Mason đã chấp nhận (Design Notes); Owner tự xác nhận là thao tác có chủ đích. |
| 40 | BH | Kết quả dò (`no_target`, `unknown`) không lưu; log adapter thiếu `organizationId` | low | reject | Hiển thị vận hành thuộc 4.6; log của prober có `organizationId`. |
| 41 | BH | Job "đã mở lại" không chống trùng, nhiều lần mở lại nhân lời tra | low | reject | Chỉ khi nhấp nháy; giới hạn tốc độ đã hoãn ở 5.8. |
| 42 | BH | Banner thiếu nguyên nhân/hậu quả | low | reject | carried #18. |
| 43 | BH | `checkedAt` đổi mà không có tín hiệu realtime | low | reject | Hiển thị `checkedAt` là việc của 4.2-b. |
| 44 | ECH | Lần từ chối `create-link` gửi trước khi mở lại, commit sau, bật lại cờ vừa mở | low | reject | Tingee vẫn từ chối bằng key hiện hành tại lúc đó; nếu dịch vụ đã về thì job dò mở lại trong ≤5 phút. |
| 45 | ECH | Worker "đã mở lại" vẫn fan-out khi BTC đã bị ngắt lại | low | reject | Hiếm; lần mở lại sau fan-out lại; chuỗi tra có trần lỗi của 4.1. |
| 46 | ECH | Tasks của spec còn ghi ba mã notice và 1133 qua `credential_invalid` | low | reject | Sửa là sửa spec; phần đã khóa và Spec Change Log đã ghi quyết định mới. |
| 47 | ECH | BTC ngắt vì 1133 không bao giờ tự mở lại | false | reject | Đúng quyết định của Mason (job dò bỏ qua lý do này). |
| 48 | ECH | `org_review_items_changed` không có `eventId` sẽ ném | low | reject | carried #27. |

## Design Notes

**Vì sao job "đã mở lại":** mọi đường tắt cờ nằm ở `organizer` hoặc `admin`, hai mô-đun không được import `ordering`/`payment`. `organizer` enqueue job theo tên ở `contracts` trong cùng transaction tắt cờ (rollback thì không có job); `payment` đăng ký worker và gọi `ordering` để enqueue job tra cho từng Đơn. Worker tra 4.1 idempotent và tự hẹn mốc kế, nên trùng với mốc đã hẹn cũng an toàn; khi cờ worker `TINGEE_ORDER_STATUS_QUERY` tắt thì job tra xong ngay như 4.1.

**Rủi ro của dò tạm:** Tingee chặn Cổng thanh toán mà vẫn cho `get-va-paging` thì cờ mở lại sai; lần tạo link kế bật lại (mỗi vòng 5 phút mất một Đơn của Người mua). Ghi deferred để thay khi Tingee có API trạng thái dịch vụ.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm module graph.
- `pnpm --filter @tickee/api test` -- expected: toàn bộ pass (Postgres của `docker-compose.yml`; migration mới chạy).
- `pnpm --filter @tickee/web test` -- expected: pass.
