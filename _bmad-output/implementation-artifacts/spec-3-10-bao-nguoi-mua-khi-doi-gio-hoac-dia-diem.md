---
title: 'Story 3.10: Báo Người mua khi Sự kiện đổi giờ hoặc địa điểm'
type: 'feature'
created: '2026-11-12'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1dd0d0ecc7a483a62b328d741c57b48a36c6ebc6'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BTC sửa thời gian hoặc địa điểm sau khi đã phát Vé, nhưng Người mua không được báo. Họ có thể đến sai giờ hoặc sai chỗ (FR-7). Spec 2.12 đã hoãn việc này sang 3.10.

**Approach:** Trước khi lưu, form sửa Sự kiện hỏi số Người mua sẽ nhận email và hiện `Dialog` "Email sẽ được gửi tới {n} Người mua.". Lệnh sửa chuyển sang `flows`, vì một lệnh vừa ghi `events` vừa enqueue job email của `ordering` trong cùng transaction (AD-12, AD-25). Khóa idempotent của job gồm phiên bản thời gian/địa điểm của Sự kiện. Job gốc chia mỗi Người mua một job con (mẫu fan-out của E2-5).

## Boundaries & Constraints

**Always:**
- **"Đổi giờ hoặc địa điểm"** = `startsAt`, `endsAt` (so theo mốc thời gian) hoặc `venue` khác giá trị hiện tại. Đổi tên, mô tả, chính sách hoàn vé hay giới hạn Vé/Đơn không tính.
- **Gửi email khi** lệnh `PATCH` commit và đủ cả bốn điều kiện sau:
  - Sự kiện không ở `draft` hay `cancelled`;
  - có đổi giờ hoặc địa điểm;
  - sau khi sửa, Sự kiện chưa kết thúc (`effective_end_at` mới > `now()` của DB);
  - có ít nhất một Người mua có Đơn `paid` của Sự kiện, tính cả Đơn 0đ.
- **"Người mua"** = một `user_id` có Đơn `paid` của Sự kiện. Mỗi Người mua nhận một email, dù có nhiều Đơn. Email gửi tới `buyer_email` của Đơn `paid` mới nhất của người đó.
- **Đếm `n`:** `GET /v1/orgs/:orgId/events/:eventId/buyer-count` → `{ buyers: n }`, dùng cùng định nghĩa "Người mua" ở trên.
  - Quyền `events.manage` (Owner/Admin).
  - Sự kiện lạ, sai dạng hoặc của BTC khác → `404 EVENT_NOT_FOUND`.
- **Phiên bản:** cột mới `events.time_venue_version` (int, mặc định 0). Cột tăng 1 trong cùng `UPDATE` mỗi khi đổi giờ hoặc địa điểm, ở mọi trạng thái.
- **Job:**
  - Job gốc mang `{ eventId, version }`, id = `derivedJobId(eventId, '<queue>:v<version>')`, enqueue bằng `tx` của lệnh sửa. Rollback thì không có job.
  - Job con mang thêm `userId`, id suy từ id job gốc và `userId`. Job gốc chạy lại không tạo thêm con.
  - Mỗi lần sửa có đổi giờ/địa điểm = đúng một lượt. Sửa hai lần là hai lượt.
- **Job con bỏ qua** (completed, không gửi) khi lúc gửi:
  - Sự kiện đã `cancelled` hoặc đã quá `effective_end_at` (theo đồng hồ DB);
  - hoặc người đó không còn Đơn `paid` của Sự kiện.
- **Nội dung email** đọc thời gian và địa điểm *hiện tại* của Sự kiện lúc gửi, có link tới "Vé của tôi" (`/tickets`) và kênh liên hệ BTC. Payload và log chỉ có id, không có email hay tên Người mua.
- **Web (`EventSettings` → `InfoForm`):**
  - Bấm "Lưu thay đổi" mà form đổi giờ/địa điểm trên Sự kiện không ở `draft`, và theo đồng hồ máy chưa kết thúc sau khi sửa: gọi `buyer-count` trước (nút đang tải).
    - `n > 0` → `ConfirmDialog`:
      - tiêu đề "Lưu thay đổi?", mô tả "Email sẽ được gửi tới {n} Người mua.";
      - nút "Lưu và gửi email" (không phải kiểu destructive) và "Hủy";
      - xác nhận → `PATCH` (spinner, chặn bấm lặp);
      - lỗi khi lưu hiện ngay trong `Dialog`.
    - `n = 0` → lưu luôn, không có `Dialog`.
  - Đếm lỗi → banner "Chưa lưu được thông tin" kèm "Thử lại", không lưu.
  - Mọi trường hợp khác giữ nguyên hành vi 2.12.
- Luật "có báo hay không" (trừ phần đếm) là một hàm thuần trong `packages/contracts`, dùng chung cho api và web.
- **Quyết định của Mason (12/11):**
  - **Mẫu email (A): chỉ có thông tin mới.**
    - Tiêu đề: `Sự kiện đổi giờ hoặc địa điểm · {tên Sự kiện}`.
    - Thân, theo thứ tự:
      1. "BTC {tên BTC} vừa cập nhật thời gian hoặc địa điểm của {tên Sự kiện}."
      2. Thời gian hiện tại (khoảng giờ, giờ Việt Nam).
      3. Địa điểm hiện tại; trống thì ghi "BTC chưa công bố địa điểm".
      4. "Vé của bạn vẫn dùng được, không cần làm gì thêm."
      5. Link "Vé của tôi".
      6. Kênh liên hệ BTC.
    - Có bản text và bản HTML.
  - **Giữ cả spec** dù khoảng 5.400 token: API đếm, job email theo người và Dialog là cùng một mục tiêu của BTC.

**Never:**
- Không lộ `time_venue_version` hay số Người mua trong `EventDetail`.
- Không gửi email từ wizard Sự kiện nháp.
- Không đổi hành vi hoặc payload của queue `ordering.send-buyer-email` (3.8).
- Không gửi lại email khi Hủy/Ẩn/Kết thúc Sự kiện (7.1 lo email hủy).
- Không lưu giá trị cũ để làm email "trước → sau".
- Không hợp nhất các lượt gửi khi BTC sửa liên tiếp.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Đổi giờ, có Vé | Sự kiện `published`, 3 Người mua (một người 2 Đơn) | Dialog "…tới 3 Người mua."; lưu → 1 job gốc v1 → 3 job con → 3 email | SMTP lỗi: chỉ job con lỗi retry, rồi vào dead-letter |
| Chỉ sửa mô tả | Có Vé | Không gọi `buyer-count`, không Dialog, không job, version giữ nguyên | — |
| Chưa phát Vé | `published`, 0 Đơn `paid` | `n = 0` → lưu không Dialog; không job (version vẫn tăng) | — |
| Nháp | `draft` | Không Dialog, không job | — |
| Sửa hai lần | Đổi giờ rồi đổi địa điểm | Hai job gốc v1, v2 (id khác nhau), hai lượt email, mỗi email mang dữ liệu hiện tại | — |
| Lưu lặp cùng body | Request trùng | Không có trường đổi → không ghi, không job | — |
| Sửa thất bại | `VALIDATION_FAILED` / lỗi DB | Rollback: không job, version giữ nguyên | Dialog hiện lỗi |
| Sự kiện đã kết thúc | Sửa xong vẫn quá `effective_end_at`, hoặc đã bấm "Kết thúc" | Không Dialog, không job | — |
| Hủy trước khi gửi | Sự kiện `cancelled` trước khi job con chạy | Job con bỏ qua, không email | — |
| Ẩn | `hidden`, có Vé | Báo như `published` | — |

</frozen-after-approval>

## Code Map

Đường dẫn api tính từ `apps/api/src/`, web từ `apps/web/`, contracts từ `packages/contracts/src/`.

- **Ranh giới** (`apps/api/module-graph.cjs:7-19`, CI `pnpm lint:deps`):
  - `event` chỉ import được `organizer`, nên không đếm được Đơn hay enqueue job của `ordering`.
  - `flows` import được mọi mô-đun; mô-đun không import `flows`.
- **Event:**
  - `modules/event/event.service.ts:186-218` `update`:
    - `publicPageQueues.ready()` ngoài transaction;
    - khóa `FOR UPDATE` theo `orgScope`;
    - `cancelled` → 409;
    - `columnsOf:86`, `changedFieldsOf:101`;
    - không đổi gì → trả luôn;
    - `UPDATE`, audit `event.updated` (`changedFields`), không phải `draft` → `enqueuePublicPageRevalidation`.

    Tách thân transaction thành hàm xuất qua `event/index.ts`. Hàm nhận `tx`, `boss`, `ctx`, `eventId`, `input`, trả dòng mới kèm `changedFields` và dòng trước khi sửa, đồng thời tăng `time_venue_version`. Hành vi 2.12 giữ nguyên.
  - `modules/event/events.controller.ts:50-54`: `PATCH` hiện tại. Gỡ khỏi đây và chuyển sang `flows`, cùng đường dẫn.
  - `modules/event/schema.ts:27-74` `events`: thêm cột. Migration mới `apps/api/drizzle/0022_*` (mới nhất là `0021_ticket_share_links.sql`).
  - `modules/event/public-event.ts:127-155` `TicketEventRef` / `ticketEventById`: có `ended` theo đồng hồ DB. Email cần thêm `endsAt` (thêm trường, hoặc làm hàm đọc riêng cho email).
  - `assertEventOfOrganization`: đã xuất, `flows/ticket-types.flow.ts:131` dùng.
- **Flows (mẫu):**
  - `flows/ticket-types.flow.ts` + `ticket-types.controller.ts`: controller nhận `DATABASE`, `BOSS`, `PublicPageQueues`, gọi `ready()` trước rồi mở `tx`.
  - `flows/flows.module.ts`: đăng ký controller và provider producer mới.
- **Ordering:**
  - Mẫu queue `modules/ordering/buyer-email-jobs.ts`:
    - `defineQueue` có dead-letter, retry 8;
    - `enqueue(boss, tx, payload, {id})`;
    - `QueueProducer` (`BuyerEmailQueues:169`);
    - worker `registerQueueWorker`;
    - link web `${WEB_ORIGIN}${MY_TICKETS_PATH}` (`:129`), `organizerContactOf` (`:135`).
  - Mẫu fan-out: `modules/organizer/payout-default-jobs.ts:208-231`. Không có `recipientUserId` → job gốc gọi `fanOut(boss, queue, job.id, …)`; có → gửi một email. `platform/jobs/queue.ts:65-90, 222-266` (`defineQueue`, `derivedJobId`, `fanOut`).
  - `modules/ordering/order-jobs.ts:200-212` `OrderingJobsModule.forRoot`: thêm worker mới.
  - `modules/ordering/schema.ts:98-160` `orders`: `user_id`, `event_id`, `status`, `buyer_email`, `paid_at`; index `(event_id, created_at)`.
  - `modules/ordering/buyer-email.ts`: `page()`, các style và `escapeHtml`. Thêm builder mới cùng kiểu, trả `Omit<EmailMessage,'to'>`.
- **Contracts:**
  - `jobs.ts:52-70`: tên queue và payload email Người mua. Thêm queue mới, dead-letter và payload `{ eventId, version, userId? }`.
  - `event.ts`:
    - `EventDraftInput:77-94`, `EVENT_DRAFT_FIELDS:93`, `effectiveEndAt:167`, `formatEventTimeRange:226`.
    - Thêm hàm thuần "có báo hay không".
    - Thêm schema `EventBuyerCount` và đường API.
- **Web:**
  - `app/(dashboard)/btc/[orgId]/su-kien/[eventId]/event-settings.tsx:61-153` `InfoForm`:
    - `onSubmit:84-95` hiện gọi `save.mutate` thẳng;
    - mẫu `ConfirmDialog` ở `StatusActions:303-318`.
  - `components/tickee/confirm-dialog.tsx`: nút xác nhận đang cố định `variant="destructive"`. Thêm prop chọn variant, mặc định giữ nguyên.
  - `lib/event/api.ts:46-47` `updateEvent`: thêm hàm gọi `buyer-count`.
- **Test:**
  - api:
    - `test/event/events.test.ts:175-280` (PATCH 2.12, phải pass sau khi chuyển route);
    - `test/organizer/isolation.test.ts` tự tìm route mới (`:149-159`: id lạ → 404 `EVENT_NOT_FOUND`);
    - `test/ordering/buyer-email-job.test.ts`: `jobsOf` qua `boss.findJobs`, worker qua `WorkerModule.forRoot` + `FakeEmailTransport`, dead-letter;
    - `test/organizer/payout-default-job.test.ts:226-240` (test fan-out);
    - fixtures `test/ordering/order-fixtures.ts` (`paidReadyOrg`, `eventOnSale`, `postOrder`);
    - `freeTickets` cục bộ ở `test/ticketing/shared-tickets.test.ts:52`.
  - web:
    - `e2e/event-settings.spec.ts`: `mockOrganizerApi` (`e2e/organizer-mock.ts:79-105`), `State`, `eventOf`, PATCH `:80-87`, mẫu Dialog `:224`, `:254`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{event,jobs,index}.ts`, `packages/contracts/test/`:
  - hàm thuần "có báo hay không" (trạng thái, đổi giờ/địa điểm, chưa kết thúc sau khi sửa với `now` truyền vào);
  - `EventBuyerCount`;
  - queue `ordering.send-event-change-email` + dead-letter và payload;
  - test hàm thuần.
- [x] `apps/api/src/modules/event/{schema,event.service,events.controller,index}.ts`, `apps/api/drizzle/0022_*`:
  - cột `time_venue_version`;
  - tách lệnh sửa thành hàm nhận `tx`;
  - gỡ `PATCH` khỏi controller của `event`.
- [x] `apps/api/src/modules/ordering/{event-change-email-jobs,buyer-email,index,order-jobs}.ts` (`event-change-email-jobs` là file mới):
  - đếm và liệt kê Người mua `paid` của Sự kiện;
  - enqueue job gốc;
  - producer, worker gốc/con;
  - builder email.
- [x] `apps/api/src/flows/{event-update.flow,event-edit.controller,flows.module}.ts`: `PATCH …/events/:eventId` (sửa, rồi enqueue khi đủ điều kiện, cùng `tx`) và `GET …/buyer-count`.
- [x] `apps/api/test/event/event-change-email.test.ts` (mới): phủ từng dòng của Matrix, đếm `buyer-count` (Người mua hai Đơn, BTC khác → 404), idempotent khi job gốc chạy lại, mẫu email (text/HTML, `escapeHtml`). Sửa test cũ nếu đường import đổi.
- [x] `apps/web/components/tickee/confirm-dialog.tsx`, `apps/web/lib/event/api.ts`, `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/event-settings.tsx`: luồng đếm → `Dialog` → lưu.
- [x] `apps/web/e2e/event-settings.spec.ts`:
  - Dialog có `n` đúng: Hủy thì không `PATCH`, xác nhận thì `PATCH`;
  - `n = 0`, chỉ sửa mô tả, nháp, đã kết thúc → không Dialog;
  - đếm lỗi → banner;
  - `PATCH` lỗi trong Dialog.
- [x] `ARCHITECTURE-SPINE.md` (AD-25: flow `updateEvent`; AD-12: queue mới; route mới), `epic-3-context.md`, `deferred-work.md`: tài liệu khớp code.

**Acceptance Criteria:**
- Given `pnpm test`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:e2e`, when chạy, then tất cả pass, và `event` không import `ordering`/`ticketing`.
- Given lệnh sửa đổi giờ trên Sự kiện có Vé bị rollback, when transaction hủy, then không có job nào trong queue mới.
- Given Owner BTC A, when gọi `buyer-count` hoặc `PATCH` trên Sự kiện của BTC B, then `403 NOT_A_MEMBER` (bộ cách ly).

## Implementation Notes

- **Contracts:** `timeOrVenueChanged(before, after)` và `notifiesBuyers(before, after, now)` (`event.ts`). Đã bấm "Kết thúc" (`endedManuallyAt` có) → luôn `false`, không so đồng hồ (như `isEventEnded` của web); còn lại so `effectiveEndAt(endsAt mới) > now`. `EventBuyerCount`, `eventBuyerCountApiPath`. `JobQueue.ORDERING_SEND_EVENT_CHANGE_EMAIL` (+ dead-letter), `SendEventChangeEmailPayload` (`version` ≥ 1).
- **Event:** cột `time_venue_version` (+ CHECK `>= 0`, migration `0022_event_time_venue_version`). `applyEventEdit(tx, boss, ctx, eventId, input)` → `{ before, after, changedFields }` thay `EventService.update` (đã gỡ). `TicketEventRef` thêm `endsAt`. `index.ts` xuất `applyEventEdit`, `eventDetailOf`, `EventRow`, `EventDraftValues`, `EventEditResult`.
- **Ordering:** `event-change-email-jobs.ts`: `paidBuyerCount`, `enqueueEventChangeEmail`, `eventChangeEmailJobId`, `fanOutEventChangeEmail` (job gốc), `sendEventChangeEmail` (job con), `EventChangeEmailQueues` (producer, đăng ký ở `FlowsModule`), `EventChangeEmailWorker` (ở `OrderingJobsModule`). `buildEventChangeEmail` ở `buyer-email.ts`; dòng liên hệ BTC tách thành `organizerContactLines` dùng chung với email `orphan_sold_out` (nội dung không đổi).
- **Flows:** `event-update.flow.ts` (`updateEvent`, `eventBuyerCount`), `event-edit.controller.ts` (`EventEditController`: `PATCH orgs/:orgId/events/:eventId`, `GET …/buyer-count`). Lệnh sửa kiểm body trước, rồi `ready()` cả `PublicPageQueues` lẫn `EventChangeEmailQueues`. Đồng hồ DB = `now()` của transaction.
- **Web:** `ConfirmDialog` có `confirmVariant` (mặc định `destructive`); `fetchEventBuyerCount`; `InfoForm` đếm qua một mutation riêng, `Dialog` nằm ngoài `<form>`.
- **Lựa chọn khi làm** (ngoài chữ của spec):
  - "Đơn `paid` mới nhất" = theo `paid_at`, rồi `created_at`, `id` giảm dần.
  - Job gốc cũng bỏ qua (không tạo job con) khi Sự kiện không còn, đã hủy hoặc đã kết thúc lúc chạy; job con vẫn tự kiểm lại. BTC không còn (không có kênh liên hệ) → job con bỏ qua.
  - `400 VALIDATION_FAILED` khi lưu từ `Dialog`: banner trong `Dialog` "Thông tin chưa hợp lệ. Bấm "Hủy" để sửa các ô được đánh dấu.", lỗi tại ô nằm sau `Dialog`. `409 EVENT_CANCELLED` đóng `Dialog`, toast và tải lại như 2.12.
  - `n` hiển thị bằng `toLocaleString('vi-VN')`.
  - E2e "Kết thúc qua Dialog…" (có từ 2.12) chập chờn trên ios-webkit cả ở baseline (2/10): thêm `waitForURL` trước `page.goto`. Ghi ở `deferred-work.md`.
- **Kiểm chứng (agent code):** `pnpm typecheck`, `pnpm lint:deps` pass; `pnpm test`: contracts 275, web 218, api 968 pass (`event-change-email.test.ts` 24 ca). `event-settings.spec.ts` 168/168 (3 lần lặp, cả hai project). `pnpm test:e2e`: 819 pass, 1 fail ở `order-live.spec.ts` › "không có SSE → polling 2 giây…" (ios-webkit, phép đo thời gian của 3.7, file không đổi); chạy riêng 5/5 pass.

- **Bước 3 chạy lại (12/11):**
  - Diff đối chiếu đủ 8 task.
  - Lệnh kiểm:
    - `pnpm typecheck`, `pnpm lint:deps`: pass.
    - api `event-change-email.test.ts`, `events.test.ts`, `isolation.test.ts`, `buyer-email-job.test.ts`, `dependency-rules.test.ts`: 73/73.
    - contracts `event.test.ts`: 30/30.
    - Playwright `event-settings.spec.ts`: 56/56 trên ios-webkit và android-chromium.
    - `order-live.spec.ts` lặp 2 lần: 76/76, nên ca fail lúc chạy cả bộ là do tải máy.
  - Mỗi dòng Matrix có test đã chạy và pass:
    - Đổi giờ, có Vé: worker "3 Người mua…" và e2e Dialog 3 Người mua.
    - Chỉ sửa mô tả: api và e2e.
    - Chưa phát Vé: api (version vẫn tăng) và e2e `n = 0`.
    - Nháp: api và e2e.
    - Sửa hai lần: api v1/v2 và worker hai lượt.
    - Lưu lặp: api.
    - Sửa thất bại: api 400 và rollback sau enqueue; e2e lỗi trong Dialog.
    - Đã kết thúc: api (giờ mới trong quá khứ, đã bấm "Kết thúc") và e2e.
    - Hủy trước khi gửi: job con bỏ qua và worker.
    - Ẩn: api.

- **Sau review vòng 1** (P1–P8 trong Review Triage Log):
  - P1: `notifiesBuyers` coi đã bấm "Kết thúc" là đã kết thúc (`endedManuallyAt !== null` → `false`), cùng luật với `isEventEnded`.
  - P2: flow chỉ đọc đồng hồ DB khi đổi giờ/địa điểm.
  - P3: `flows/events.controller.ts` đổi thành `flows/event-edit.controller.ts`.
  - P4–P8: e2e đổi tên một ca; thêm ca `409 EVENT_CANCELLED` từ Dialog, ca `401` khi đếm, ca nút "Kết thúc" vẫn `destructive`, ca pha đếm (nút đang tải, không đếm lặp).
  - **Kiểm chứng sau patch:**
    - `pnpm typecheck`, `pnpm lint:deps`: pass.
    - `pnpm test`: contracts 275, web 218, api 968, đều pass.
    - `pnpm test:e2e`: 826/826 pass, không fail, không flaky.

## Spec Change Log

## Review Triage Log

Vòng 1 (review_loop_iteration 0). Nguồn: BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap (đã kiểm sẵn).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | VG | Lưu từ Dialog gặp `409 EVENT_CANCELLED` chưa có test (`setNotice(null)` là chỗ duy nhất đóng Dialog) | low | Gap đã kiểm: bỏ `setNotice(null)` ở nhánh `EVENT_CANCELLED` thì Dialog kẹt mở mà mọi test vẫn pass | patch (P5) |
| 2 | VG | `buyer-count` trả 401 → chuyển đăng nhập chưa có test | low | Gap đã kiểm: mock `buyer-count` chỉ trả 200/500; `countFailure` ẩn 401 nên `goToLogin()` là phản hồi duy nhất | patch (P6) |
| 3 | VG | Nút xác nhận `destructive` mặc định của `ConfirmDialog` chưa được ghim | low | Gap đã kiểm: bỏ mặc định `'destructive'` thì mọi Dialog hủy/xóa thành nút thường mà test vẫn pass | patch (P7) |
| 4 | VG | Wizard `/thiet-lap` của Sự kiện đã mở bán PATCH giờ/địa điểm không qua Dialog, server vẫn gửi email | low | Đúng: `event-setup.tsx` không chặn theo trạng thái, `event-wizard.tsx:69` gọi `updateEvent` thẳng. Chỉ tới được bằng URL gõ tay/bookmark, hoặc "Quay lại" ngay sau khi mở bán (lúc đó gần như chưa có Người mua); email vẫn mang thông tin đúng. Sửa phải chặn wizard theo trạng thái mà không phá màn sau khi mở bán, hoặc dựng Dialog trong wizard | reject |
| 5 | BH | Web (cache `event`, đồng hồ máy) và server (dòng đã khóa, đồng hồ DB) có thể quyết khác nhau: có email mà không Dialog, hoặc ngược lại; PATCH không báo đã gửi | low | Chỉ xảy ra khi hai Admin sửa cùng lúc, hoặc lệch đồng hồ đúng lúc gần mốc kết thúc; email vẫn đúng thông tin. Sửa phải đổi giao thức (cờ xác nhận/409 hoặc trường mới trong response) | reject |
| 6 | BH | `notifiesBuyers` so `endedManuallyAt` với `now` thay vì coi đã bấm "Kết thúc" là đã kết thúc (khác `isEventEnded`) | low | Đúng: "Kết thúc" chỉ bấm được khi Sự kiện đã bắt đầu và ghi mốc bấm ≤ now, nên `endedManuallyAt > now` chỉ do lệch đồng hồ (máy BTC chậm → Dialog hứa gửi mà server không gửi). Sửa trực tiếp: đã bấm → `false` | patch (P1) |
| 7 | BH | Biên "đã kết thúc": `notifiesBuyers` coi `end <= now` là kết thúc, `ticketEventById.ended` dùng `now() > effective_end_at` | false | Hai phép so chỉ khác ở đúng tích tắc `end == now`. Lúc đó flow không enqueue, nên worker không bao giờ nhận ca đó; flow enqueue (`end > now`) thì worker chạy sau, `now()` lớn hơn, bỏ qua đúng khi đã kết thúc | reject |
| 8 | BH | Email ghi "Vé của bạn vẫn dùng được" nhưng người nhận chọn theo Đơn `paid`, không theo Vé còn hiệu lực | low | Chưa có đường nào hủy Vé khi Đơn vẫn `paid` (7.5 backlog; 4.4 đổi trạng thái Đơn nên Đơn rời `paid`). 7.5 cần lọc Người mua còn Vé `valid` | reject |
| 9 | BH | Không kiểm Sự kiện/BTC bị khóa (`locked_at`) khi sửa và gửi email | low | Không có code nào ghi `locked_at` (khóa là 7.4, backlog); sửa Sự kiện bỏ qua khóa là hành vi có từ 2.12 | reject |
| 10 | BH | Pha đếm Người mua chưa có e2e cho nút đang tải và chặn bấm lặp | low | Gap đúng: không test nào giữ phản hồi `buyer-count`; code chặn bằng `busy` nhưng chưa được ghim | patch (P8) |
| 11 | BH | Gõ thêm vào form trong lúc đang đếm thì chữ mới không được lưu mà form vẫn hiện | low | Cửa sổ chỉ bằng thời gian một request đếm; lưu (2.12) vốn có cùng hành vi khi đang lưu. Sửa phải khóa form khi bận, đổi cả hành vi lưu cũ | reject |
| 12 | BH | `dbNow(tx)` chạy ở mọi PATCH, kể cả nháp và chỉ sửa mô tả | low | Đúng: là đối số của `notifiesBuyers` nên luôn chạy, thêm một truy vấn. Sửa trực tiếp: chỉ đọc đồng hồ DB khi đổi giờ/địa điểm | patch (P2) |
| 13 | BH | Không có audit ghi lượt báo Người mua; toast sau khi lưu giống mọi lần lưu | low | Ngoài intent; sửa phải thêm hành động audit và copy mới | reject |
| 14 | BH | `sprint-status.yaml` ghi 3.10 `in-progress` trong khi spec `in-review` | false | Bước 5 của build đồng bộ sprint-status sang `review`; trạng thái spec là trạng thái nội bộ của build | reject |
| 15 | BH | Diff lật 3.9 sang `done` không liên quan | false | Cố ý: PR #60 đã merge, spec 3.9 `done`; cùng cách commit 3.9 đã lật 3.7/3.8 | reject |
| 16 | BH | Mục mới ở `deferred-work.md` mở đầu bằng dòng "Đã xử lý" không theo định dạng `source_spec/summary/evidence` | false | Quy ước có sẵn của file: dòng "Đã xử lý (…)" ở `deferred-work.md:182`, `:232`, `:307`, `:330`, `:339` | reject |
| 17 | BH | Tên e2e "đã kết thúc (đã bấm "Kết thúc", hoặc giờ mới vẫn trong quá khứ)" chỉ thử ca đã bấm | low | Đúng: ca giờ trong quá khứ là test kế tiếp. Sửa trực tiếp: đổi tên | patch (P4) |
| 18 | BH | Dòng Matrix "Ẩn" không có e2e web | false | Web không có nhánh riêng cho `hidden`: chỉ gọi `notifiesBuyers`, mà contracts test `hidden` → `true`; api test "Ẩn, có Vé → báo như published" phủ dòng Matrix | reject |
| 19 | BH | Test dead-letter dùng job gửi tay `retryLimit: 0` thay vì job con thật hết lượt retry | low | Cấu hình retry/dead-letter của queue đã được assert; chạy hết 8 lượt backoff thật cần giả thời gian; cùng mẫu test 3.8 | reject |
| 20 | BH | Hai file `events.controller.ts` (`modules/event/` và `flows/`) dễ nhầm khi tìm | low | Đúng: file ở `flows/` xuất `EventEditController`. Sửa trực tiếp: đổi tên file | patch (P3) |
| 21 | BH | Câu mở đầu email viết hai lần (text và HTML) nên có thể lệch nhau | low | Bản HTML cần bọc tên Sự kiện bằng `<strong>`; test mẫu email ghim cả hai bản; cùng kiểu các builder có sẵn trong `buyer-email.ts` | reject |
| 22 | EC | Như #5 (web đoán `notifiesBuyers` sai so với server) | low | Như #5 | reject |
| 23 | EC | `buyer-count` trả 0, rồi một Đơn `paid` trước khi PATCH commit → có email mà không Dialog | low | Cửa sổ vài giây giữa lúc đếm và lúc lưu, chỉ với Sự kiện chưa có Người mua nào; email đúng thông tin. Cùng gốc #5 | reject |
| 24 | EC | Như #11 | low | Như #11 | reject |
| 25 | EC | Như #4 | low | Như #4 | reject |
| 26 | EC | Như #7 | false | Như #7 | reject |
| 27 | EC | (claim) Server gửi theo luật riêng, không gắn với việc Dialog đã hiện/xác nhận | low | Đúng như khối frozen ("Gửi email khi lệnh PATCH commit và đủ cả bốn điều kiện"); hệ quả là #4, #5, #23 | reject |

## Design Notes

- **Vì sao `flows`:** AD-25 đặt luồng ghi nhiều mô-đun trong một `tx` ở `flows`. AD-12 đòi enqueue bằng chính `tx` của thay đổi. `event` không được gọi `ordering`. Cách này đã có tiền lệ: `ticket-types.flow.ts` ghi `event` + `ordering` trong một transaction.
- **Vì sao fan-out:** E2-5 đã tách job gốc/job con để dùng cho 3.10. Một Sự kiện có thể có hàng trăm Người mua, và SMTP lỗi với một người chỉ làm job của người đó retry.
  - Danh sách Người mua chốt khi job gốc chạy, vài giây sau commit. Người vừa mua trong khoảng đó có thể nhận email mang thông tin đúng; chấp nhận được.
- **Vì sao cột phiên bản riêng:** `updated_at` đổi ở mọi lệnh và lấy từ đồng hồ ứng dụng. Cột riêng chỉ tăng khi đổi giờ/địa điểm, nên test ghim được id job v1/v2.
- **Gợi ý:**
  ```ts
  // flows/event-update.flow.ts (trong db.transaction)
  const r = await applyEventEdit(tx, boss, ctx, eventId, input);
  if (r.changed && notifiesBuyers(r.before, r.after, await dbNow(tx)) && (await paidBuyerCount(tx, eventId)) > 0)
    await enqueueEventChangeEmail(boss, tx, { eventId, version: r.after.timeVenueVersion });
  ```

## Verification

**Commands:**
- `pnpm test` -- expected: pass (contracts, api với Postgres thật, web).
- `pnpm typecheck && pnpm lint:deps` -- expected: pass.
- `pnpm test:e2e` -- expected: pass trên ios-webkit và android-chromium.

**Manual checks (if no CLI):**
- `pnpm dev`, BTC demo: mua Vé 0đ bằng hai tài khoản, rồi sửa giờ Sự kiện ở tab Cài đặt. Dialog phải báo "…tới 2 Người mua.". Lưu xong, Mailpit nhận 2 email. Sửa mô tả thì không có Dialog và không có email.
