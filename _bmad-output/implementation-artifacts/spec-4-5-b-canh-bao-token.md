---
title: 'Story 4.5-b: Cảnh báo Token'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '8e2e1117043317bdad5c586e7354a899779dcded'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-4-5-a-trang-token.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang Token (4.5-a) cho xem số dư, nhưng Owner phải tự vào xem. Không có gì báo trước khi Token cạn, nên Sự kiện có phí bị "Tạm ngừng bán" rồi Owner mới biết.

**Approach:**
- Owner đặt ngưỡng cảnh báo trên trang Token.
- Mỗi lần đọc Token thành công (lúc xem trang, hoặc job dò mỗi giờ), `organizer` so Token khả dụng với ngưỡng và ghi lại lần vượt ngưỡng.
- Mỗi lần vượt ngưỡng gửi đúng một email cho Owner và bật banner warning đóng được trên dashboard của Owner.

## Boundaries & Constraints

**Always:**
- **Cột mới trên `organizations`** (migration `0027`):
  - `token_alert_threshold`: `bigint`, null = chưa đặt, CHECK 1…10^12;
  - `token_below_threshold_since`: `timestamptz`, null = không dưới ngưỡng; chỉ khác null khi đã có ngưỡng.
- **`PUT /v1/orgs/:orgId/token/alert-threshold`** (quyền mới `TOKEN_ALERT_MANAGE`, chỉ Owner):
  - body `{ threshold: số nguyên 1…10^12 | null }`; null = tắt cảnh báo;
  - một transaction; giá trị không đổi thì không ghi;
  - audit `organization.token_alert_threshold_update` (`changedFields: ['token_alert_threshold']`, kèm `token_below_threshold_since` nếu đổi);
  - tắt cảnh báo thì đặt `token_below_threshold_since` = null và phát `org_status_changed`;
  - đổi sang ngưỡng khác (khác null) thì không đụng `token_below_threshold_since`.
- **Đánh giá ngưỡng** chạy sau mỗi lần đọc `ok`, ngoài lời gọi Tingee, dùng compare-and-set trong một câu UPDATE:
  - **Vượt ngưỡng:** cột đang null, có ngưỡng, khả dụng < ngưỡng → đặt `now()` của DB. Cùng `tx`: enqueue email với job id `derivedJobId(orgId, '<queue>:<since ISO>')` và phát `org_status_changed`.
  - **Về trên ngưỡng:** cột khác null và (khả dụng ≥ ngưỡng hoặc không còn ngưỡng) → đặt null, phát `org_status_changed`.

  Đọc `unavailable` hay `no_payout_account` thì không đổi gì.
- **`GET …/token`** (4.5-a) trả thêm `alert: { threshold, belowThresholdSince }`, là trạng thái sau lần đánh giá của chính request đó.
- **Job dò `TOKEN_ALERT_SCAN`:**
  - cron mỗi giờ (`0 * * * *`, hằng số trong `packages/contracts`), không retry;
  - duyệt lần lượt các BTC có ngưỡng và `payment_service_status = 'active'`;
  - mỗi BTC: đọc như GET rồi đánh giá; lỗi một BTC thì log và đi tiếp.
- **Email `TOKEN_ALERT_EMAIL`:**
  - payload `{ organizationId, belowThresholdSince }`, retry và dead-letter như email đổi tài khoản mặc định;
  - handler bỏ qua khi `token_below_threshold_since` hiện tại khác payload;
  - gửi cho Owner hiện tại;
  - nội dung: tên BTC, ngưỡng, link trang Token (`WEB_ORIGIN`) và portal Tingee; không có số dư.
- **Danh mục thông báo** (mới `packages/contracts/src/notifications.ts`): mục `token_below_threshold` với sự kiện kích hoạt, người nhận Owner, kênh email + banner, khóa chống gửi lặp `(organization, lần vượt ngưỡng)` = `(organizationId, token_below_threshold_since)`. Các thông báo khác thêm sau.
- **Banner** mã `token_below_threshold`:
  - `warning`, `dismissible: true`, `blocking: false`, audience chỉ Owner (theo danh mục);
  - `version` = `since` (ISO), `data.tingeePortalUrl`;
  - bậc 9 của `STATUS_NOTICE_PRIORITY` (đã ghi chú sẵn);
  - không hiện khi BTC đang `suspended` lý do `token`, vì banner 4.2 đã báo;
  - nội dung: "Token khả dụng dưới ngưỡng cảnh báo.", "Mua thêm Token trước khi Sự kiện có phí bị Tạm ngừng bán.", hành động "Mua thêm Token" (portal, tab mới);
  - không thuộc `PAID_SALES_CODES`;
  - khóa đóng banner trong `sessionStorage` thêm `orgId`.
- **UX trang Token**, khối "Ngưỡng cảnh báo" hiện ở mọi trạng thái đã tải:
  - Owner:
    - ô số (`inputMode="numeric"`, nhận dấu chấm phân cách) cùng nút "Lưu";
    - nút "Tắt cảnh báo" khi đã có ngưỡng;
    - lỗi tại chỗ "Nhập số Token nguyên từ 1 đến 1.000.000.000.000.";
    - toast "Đã lưu ngưỡng cảnh báo." hoặc "Đã tắt cảnh báo Token.";
    - lưu xong thì đọc lại Token.
  - Admin: "Ngưỡng cảnh báo: {n} Token" hoặc "Chưa đặt ngưỡng cảnh báo.", kèm "Chỉ Owner đặt ngưỡng cảnh báo."
  - `belowThresholdSince` khác null: `StatusBanner` warning "Token khả dụng dưới ngưỡng cảnh báo." ngay trên số, cho cả hai vai.
  - Màn 320px không cuộn ngang.

**Never:**
- Không lưu hay log số dư, hạn mức, Token khả dụng; email và payload job không chứa số dư.
- Không gọi Tingee trong transaction; không email Admin; không gửi lại email khi đổi ngưỡng mà vẫn dưới ngưỡng.
- Không lưu trạng thái đóng banner ở server; không đổi luật cờ dịch vụ thanh toán (4.2) hay hợp đồng tạm (4.5-a).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lưu ngưỡng | Owner PUT `500` | Ngưỡng 500, audit | N/A |
| Ngưỡng sai | `0`, `-1`, `1.5`, `"abc"`, > 10^12 | Không đổi | `400` |
| Admin đặt | Admin PUT | Không đổi | `403 FORBIDDEN_ROLE` |
| Vừa xuống dưới ngưỡng | ngưỡng 500, khả dụng 300, `since` null | `since` = now; đúng 1 job email; `org_status_changed`; banner Owner; warning trên trang | N/A |
| Vẫn dưới ngưỡng | `since` khác null, khả dụng 200 | Không email thêm; `since` giữ nguyên | N/A |
| Lên rồi xuống lại | 300 → 900 → 300 | `since` null rồi mới; email thứ hai; banner hiện lại dù đã đóng | N/A |
| Đọc đồng thời | Job và trang cùng thấy dưới ngưỡng | Đúng 1 job email | N/A |
| Đọc không được | `unavailable`, `no_payout_account` | Không đổi | N/A |
| Tắt khi đang dưới | PUT `null` | `since` null, banner tắt, audit | N/A |
| Đổi ngưỡng, vẫn dưới | 500 → 400, khả dụng 300 | Không email | N/A |
| Email đến muộn | `since` đã đổi trước khi job chạy | Job hoàn tất, không gửi | N/A |
| Tạm ngừng bán vì Token | `suspended` `token`, `since` khác null | Không có banner 4.5-b; job bỏ qua BTC | N/A |
| Admin ở dashboard | `since` khác null | Không có banner | N/A |
| Ngoài BTC | BTC khác hoặc CTV PUT | Không đổi | `403 NOT_A_MEMBER` |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/organizer/schema.ts:7-76` -- thêm hai cột cạnh `payment_service_*` (:36-52, CHECK :63-73); migration `0027_*` qua `pnpm --filter @tickee/api db:generate` (mới nhất `0026_match_review_item.sql`).
- `apps/api/src/modules/organizer/token.service.ts` (4.5-a):
  - `read()` là nơi gắn bước đánh giá;
  - tách phần "đọc + đánh giá" thành hàm hoặc lớp dùng chung cho GET và job;
  - cập nhật docblock "không ghi DB";
  - `token.controller.ts` thêm `@Put('alert-threshold')`.
- Mẫu ghi kèm audit: `event/event.service.ts:245-275` (`ready()`, tx, `FOR UPDATE`, bỏ qua khi không đổi, `audit.record(tx, …)`); controller `events.controller.ts:51-59` (`parseRequest(Schema, body)`).
- `AuditAction`: `platform/audit/audit.ts:6-160` (organization.* ở :36-58).
- Realtime: `import { realtime } from '../../platform/realtime/index.js'`, gọi `realtime.notifyOrganization(tx, RealtimeTopic.ORG_STATUS_CHANGED, orgId)` như `payment-service.ts:250,303`.
- Email:
  - mẫu `organizer/payout-default-jobs.ts` (queue :66-72 với `defineQueue`, dead-letter, retry; worker `registerQueueWorker` :204-233; Owner theo `members.role` :139-144; `userContacts` :162);
  - `payout-default-email.ts` (`escapeHtml`, `{subject,text,html}`);
  - `enqueue(boss, tx, payload, {id})` + `derivedJobId` (`platform/jobs/queue.ts:31-41,79-89,222`; mẫu `event-change-email-jobs.ts:52`);
  - `WEB_ORIGIN` qua `ORGANIZER_JOBS_CONFIG` (`invitation-jobs.ts:130-150`).
- Cron:
  - mẫu `PaymentServiceProbeWorker` (`payment-service.ts:562-617`: queue `retryLimit: 0`, `batchSize: 1`, `boss.schedule`, lặp từng BTC kèm try/catch);
  - query mẫu `suspendedOrganizationIds` (:548-559);
  - worker và queue email đăng ký ở `OrganizerJobsModule.forRoot` (`invitation-jobs.ts:175-190`) → `worker.module.ts:40-43`; producer `*Queues` ở `organizer.module.ts:55-65`.
- `reporting/notices.service.ts`:
  - builder thuần mới cạnh `paymentServiceNotices` (:103-117), lắp ở `notices()` (:133-143);
  - đọc qua read model mới của `organizer`, export ở `index.ts:13-24` như `paymentServiceStateOf` (`payment-service.ts:86-105`, `orgScope`);
  - audience Owner;
  - `tingeePortalUrl` lấy từ `NOTICES_SETTINGS` (:27-33).
- `packages/contracts/src`:
  - `organizer.ts`: `Permission` (:17-29) thêm `TOKEN_ALERT_MANAGE`, không thêm vào danh sách của Admin (:37-48); `TokenAlertThresholdInput`; `TokenOverview.alert`; hằng cron;
  - `reporting.ts:28-128`: mã mới, `STATUS_NOTICE_PRIORITY`;
  - `jobs.ts:4-88`: `TOKEN_ALERT_SCAN`, `TOKEN_ALERT_EMAIL` + dead-letter;
  - mới `notifications.ts` (export qua index).
- Web:
  - `btc/[orgId]/token/token-view.tsx` (4.5-a): thêm khối ngưỡng; mẫu form `su-kien/ticket-types-editor.tsx:456-554` (`OrderLimitField`: `Input`, `Label`, `FieldError`, `Button loading`, `useMutation`, `toast`, `hasErrorCode`/`handledElsewhere`/`messageOf`);
  - `lib/organizer/api.ts` thêm PUT (mẫu `lib/event/api.ts:111`);
  - `lib/organizer/token.ts`: câu chữ, parse ô số;
  - `lib/reporting/status-notices.ts`: nội dung mã mới (mẫu :42-52); khóa đóng banner :159-178 thêm `orgId`, sửa các nơi gọi ở `components/tickee/status-banner-stack.tsx:26-29,70,127,143,150-152`.
- Test:
  - `test/organizer/token.test.ts` (4.5-a, fake `token`/`tokenReplies`);
  - job: `boss.findJobs(JobQueue.X, {data})` (mẫu `test/payment/review-actions.test.ts:275`), `payout-default-job.test.ts:274-306` (`FakeEmailTransport`);
  - cron gọi thẳng như `payment-service.test.ts:152,578`; LISTEN realtime :149-153;
  - `isolation.test.ts` (route mới), `permission-guard.test.ts`;
  - web `e2e/token.spec.ts`, `e2e/organizer-mock.ts`, e2e banner (tìm spec đang kiểm `status-banner-stack`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{organizer,reporting,jobs,notifications,index}.ts` (+ test) -- quyền, schema, mã banner, queue, danh mục thông báo.
- [x] `apps/api/src/modules/organizer/schema.ts` + `drizzle/0027_*` -- hai cột, CHECK.
- [x] `apps/api/src/modules/organizer/token*.ts` + email, job, `index.ts`, `organizer.module.ts`, `invitation-jobs.ts` -- PUT ngưỡng, đánh giá (CAS), job dò, email.
- [x] `apps/api/src/platform/audit/audit.ts` -- action mới.
- [x] `apps/api/src/modules/reporting/notices.service.ts` -- banner.
- [x] Test API -- mọi dòng I/O Matrix, cách ly, tín hiệu, email đúng một lần, job bỏ qua BTC `suspended`, không có số trong log hay job.
- [x] Web -- khối ngưỡng, warning trên trang, nội dung banner, khóa đóng banner có `orgId`.
- [x] Test web unit và e2e -- lưu/tắt/lỗi ngưỡng theo vai, warning, banner đóng được và hiện lại khi `version` mới, 320px.

**Acceptance Criteria:**
- Given `pnpm lint:deps`, then sạch.
- Given bộ test cách ly, then `PUT …/token/alert-threshold` được phát hiện và pass.
- Given 4.5-a, then mọi test của 4.5-a vẫn pass (BTC chưa đặt ngưỡng: đọc Token không ghi DB).

## Implementation Notes

- `story_key`: `4-5-token-và-cảnh-báo-token`. 4.5-b xong thì story `done`. Nhánh `feat/4-5-b-canh-bao-token`, cắt từ `feat/4-5-a-trang-token` (8e2e111).

## Spec Change Log

## Review Triage Log

Lượt 1 (16/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH | `GET …/token` vẫn đánh giá ngưỡng khi BTC đang `suspended` lý do `token`, nên email "trước khi bị Tạm ngừng bán" có thể gửi khi đã ngừng bán | low | reject | Trên UAT/PROD lời gọi đọc Token luôn `unavailable` (hợp đồng tạm), nên chưa thể xảy ra. Phần đã khóa chỉ ẩn banner và cho job bỏ qua; chặn thêm phải thêm điều kiện vào CAS. |
| 2 | BH | Banner cũ còn hiện khi BTC `suspended` vì lý do khác `token`, vì job bỏ qua mọi BTC `suspended` | low | reject | Cần đủ ba điều kiện: ngừng bán vì lý do khác, đang dưới ngưỡng, và đã mua Token trong lúc ngừng. Mở trang Token là đánh giá lại. Đổi phải sửa luật đã khóa (job chỉ dò BTC `active`). |
| 3 | BH | Email ghi ngưỡng lúc gửi; Owner hạ ngưỡng trước khi job chạy thì email ghi ngưỡng mới | low | reject | Job thường chạy trong vài giây sau lần vượt. Lần đọc kế về trên ngưỡng thì xóa `since` và job bị bỏ qua. Sửa phải thêm trường vào payload. |
| 4 | BH | Job dò tuần tự, không `expireInSeconds`; quá 900 giây thì pg-boss đánh dấu lỗi | low | reject | Chỉ gặp khi có hơn 300 BTC đặt ngưỡng mà Tingee treo; Closed Beta còn xa quy mô đó. Cùng mẫu với `PaymentServiceProbeWorker` (`payment-service.ts:568`). |
| 5 | BH | Log tổng của job dò chỉ có số BTC, log bỏ qua email gộp nhiều lý do | low | reject | Giám sát và cảnh báo vận hành thuộc 4.6. Từng BTC lỗi đã có log `warn` riêng. |
| 6 | BH | Owner thấy cảnh báo hai lần trên trang Token (banner + warning trên trang); bản trên trang không tự cập nhật theo `org_status_changed` | low | reject | Phần đã khóa yêu cầu cả hai: banner cho Owner và warning trên trang cho cả hai vai. Mở lại trang là đọc mới (`gcTime: 0`). |
| 7 | BH | `TokenOverview.alert` bắt buộc: web lên trước api thì trang Token lỗi parse | low | reject | Chưa có production (4.7). web và api ra cùng một commit. |
| 8 | BH | `NOTIFICATION_CATALOG` có trường không ai đọc (`emailQueue`, `channels`, `dedupeKey`), nên danh mục có thể lệch với code | low | patch | `TOKEN_ALERT_EMAIL_QUEUE` và `tokenAlertEmailJobId` ghi cứng `JobQueue.TOKEN_ALERT_EMAIL`; lấy từ `emailQueue` của danh mục là sửa trực tiếp. |
| 9 | BH | Thiếu test đua PUT ngưỡng với đánh giá; thiếu nhánh không có Owner; web gặp `FORBIDDEN_ROLE` thì hiện lỗi chung | low | reject | PUT khóa dòng `FOR NO KEY UPDATE`, câu UPDATE đánh giá phải chờ khóa, nên hai bên tuần tự. Mỗi BTC có đúng một Owner (unique, `organizer/schema.ts:90-95`). Lỗi chung vẫn kèm câu của api. |
| 10 | BH | Index một phần `organizations_token_alert_idx` không khớp câu dò | low | reject | Điều kiện `token_alert_threshold IS NOT NULL` của index khớp `WHERE` của câu dò; bảng nhỏ. Đổi phải sửa migration `0027`. |
| 11 | BH | Verification của spec không chạy `e2e/status-banners.spec.ts`; Code Map còn ghi "tìm spec" | low | reject | Sửa thì phải sửa spec của build này. Lượt kiểm của build đã chạy `status-banners.spec.ts` (138 e2e pass). |
| 12 | BH | "Tắt cảnh báo" không hỏi xác nhận; tắt rồi bật lại khi vẫn dưới ngưỡng thì gửi email thứ hai | low | reject | Phần đã khóa: tắt cảnh báo xóa `since`, lần vượt sau là lần mới. Hộp xác nhận là UX ngoài spec. |
| 13 | BH | Khóa đóng banner đổi định dạng, nên banner đã đóng trước khi deploy hiện lại một lần | false | reject | Trước 4.5-b không có banner nào `dismissible: true` (mọi builder của `notices.service.ts` đặt `false`), nên chưa từng có khóa cũ. |
| 14 | VG | Cấu hình email của worker thật (`webOrigin`, `tingeePortalUrl`) chưa được kiểm; test chỉ khẳng định tiêu đề | low | patch | Gap đã kiểm: test nội dung tự dựng notifier (`token-alert.test.ts:608-613`). |
| 15 | VG | Retry và dead-letter của queue email chưa được ghim | low | patch | Gap đã kiểm: các queue email anh em có test `boss.getQueue` (`payout-default-job.test.ts:241-254`). |
| 16 | VG | Đầu file `status-banners.spec.ts:23` nói banner 4.5-b không làm tải lại nhãn trạng thái bán, nhưng không test nào khẳng định | low | patch | Gap đã kiểm. Test polling thật tốn khoảng 12 giây (VG đề xuất defer); sửa câu đầu file là sửa trực tiếp. |
| 17 | VG | e2e "đóng ở BTC khác…" không fail được (khóa gieo sẵn cũng không khớp định dạng cũ) | low | patch | Đã kiểm `status-banners.spec.ts:587-600`. Gieo khóa không `orgId` của chính BTC này để test có nghĩa. |
| 18 | ECH | Lần đọc cũ được đánh giá sau lần đọc mới (không so `readAt`) | low | reject | Cần hai lần đọc chồng nhau đúng lúc Owner vừa mua Token. Sửa phải thêm cột và điều kiện. |
| 19 | ECH | Đánh giá lỗi (DB, pg-boss chưa sẵn sàng) sau khi đọc Tingee thành công → `GET` trả 500 | low | reject | Theo quy ước lỗi DB thì ném (4.5-a); lỗi báo rõ. Sửa phải thêm nhánh nuốt lỗi. |
| 20 | ECH | Như #2 | low | reject | Như #2. |
| 21 | ECH | Như #4 | low | reject | Như #4. |
| 22 | ECH | Giao email "ít nhất một lần": gửi xong mà job chưa chốt thì pg-boss gửi lại | low | reject | Mọi queue email của dự án đều như vậy. "Đúng một email" của spec là chống enqueue trùng, đã có test. |
| 23 | ECH | Test 4.5-a bị sửa: `TokenOverview` đổi hợp đồng | low | reject | Spec nêu `GET …/token` "trả thêm `alert`"; test chỉ thêm trường đó, khẳng định "không ghi DB" giữ nguyên. |
| 24 | ECH | Như #13 | false | reject | Như #13. |

## Design Notes

- **Vì sao lưu `token_below_threshold_since`.** pg-boss chỉ chống trùng theo job id tới khi xóa job (mặc định 7 ngày). Lần vượt ngưỡng cần một khóa bền: `since` vừa là khóa email, vừa là `version` của banner. Cột chỉ ghi thời điểm, không ghi số.
- **CAS trong một câu UPDATE** (điều kiện ngưỡng nằm trong `WHERE`), nên trang và job đọc cùng lúc, hay Owner đổi ngưỡng giữa chừng, đều không gửi hai email.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `isolation.test.ts`, `token.test.ts`.
- `pnpm --filter @tickee/contracts test`, `pnpm --filter @tickee/web test` -- expected: pass.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build` rồi `pnpm --filter @tickee/web exec playwright test e2e/token.spec.ts e2e/dashboard-shell.spec.ts` -- expected: pass.
