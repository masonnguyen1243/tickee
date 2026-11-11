---
title: 'E2-5 (API): helper queue pg-boss chung, hết gửi lại email cho mọi người khi retry, escapeHtml và formatter giờ Việt Nam dùng chung, bỏ MESSAGES chết'
type: 'refactor'
created: '2026-11-11'
status: 'done'
baseline_commit: '4cb9ff3082456fb260f727dcb80273ca573e9243'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-11-09.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Năm file `*-jobs.ts` của API chép tay cùng một khung pg-boss: tạo queue và dead-letter, enqueue bằng `tx`, `*Queues.ready()` cho vai api, vòng lặp worker. Hai job email gửi nhiều người (báo chuyển quyền Owner, cảnh báo đổi tài khoản nhận tiền mặc định) ném lỗi khi chỉ một địa chỉ lỗi, nên mỗi lần retry lại gửi cho mọi người (`deferred-work.md:305`). Ngoài ra `escapeHtml` bị chép 4 lần, có 4 nơi tự tạo `Intl.DateTimeFormat` giờ Việt Nam, và `MESSAGES` trong `error.filter.ts` có 55 câu nhưng chỉ 5 câu được đọc (retro Epic 2 D2). Story 3.5 sắp thêm queue mới nên phải gom trước.

**Approach:**
- `platform/jobs` có một helper dùng chung: định nghĩa queue, lớp cơ sở cho `ready()`, hàm đăng ký worker. Mỗi file job chỉ còn phần riêng của mình.
- Hai job email gửi nhiều người tách thành job gốc và job con. Job gốc tính danh sách người nhận rồi tạo mỗi người một job con; job con gửi đúng một người. Khi retry, chỉ người bị lỗi được gửi lại.
- `escapeHtml` chuyển vào `platform/email`. Formatter giờ Việt Nam chuyển vào contracts. `MESSAGES` chỉ giữ 5 mã được đọc.

## Boundaries & Constraints

**Always:**
- Ngoài phần tách gốc/con của hai job email, hành vi phải giữ nguyên:
  - tên queue; cấu hình retry, dead-letter và work options
  - enqueue bằng chính `tx` của thay đổi
  - payload hỏng thì sang dead-letter ngay, không retry
  - lỗi lưu vào job không chứa PII: chỉ tên lớp lỗi, hoặc `{type, code}` với lỗi DB
  - tiêu đề và nội dung email
  - chuỗi ngày giờ: `HH:mm dd/MM/yyyy` và `dd/MM/yyyy`
- Giữ các tên export mà service, module và test đang dùng: `*Queues` kèm `ready()`, `ensure*Queues`, `enqueue*`, `*_QUEUE_OPTIONS`, schema payload, `*Worker`, `*JobsModule`.
- Payload chỉ mang id. Job con mang thêm `recipientUserId`, không mang email hay tên. Job enqueue trước khi deploy (không có `recipientUserId`) được xử lý như job gốc.
- `platform/` không import `modules/` hay `flows/` (rule `platform-not-to-domain`). Không tạo cycle.
- Formatter trong contracts tính bằng offset +07:00 cố định, như `vnParts`. Không dùng `Intl`, để kết quả không phụ thuộc dữ liệu ICU của Node hay trình duyệt.

**Never:**
- Không thêm migration hay bảng (không làm nhật ký đã gửi theo job).
- Không đụng `identity-janitor.ts` (job lịch cron, khung khác), không tách `payout-account.service.ts`.
- Không thêm queue mới, không đổi `JobQueue`. Không sửa `formatEventDateTime` và `formatEventTimeRange`.

**Quyết định (Mason, 11/11/2026):** giữ một spec, một PR, dù spec dài khoảng 3.200 token (vượt ngưỡng 1.600).

## I/O & Edge-Case Matrix

| Kịch bản | Đầu vào / trạng thái | Kết quả | Xử lý lỗi |
|---|---|---|---|
| Job gốc (email gửi nhiều người) | Không có `recipientUserId`, BTC còn | Tạo mỗi người nhận một job con trong cùng queue. Id job con suy ra cố định từ id job gốc và `userId`. Job gốc `completed`, không tự gửi email | Tạo job con lỗi → job gốc `failed`, retry |
| Job gốc chạy lại | Job con đã được tạo ở lần chạy trước | Không có job con hay email nào bị nhân đôi (trùng id thì bỏ qua) | — |
| Job con | Có `recipientUserId` | Gửi đúng một email cho người đó | SMTP lỗi → chỉ job con đó retry. Lỗi chỉ ghi tên lớp |
| Không còn gì để gửi | BTC hoặc tài khoản nhận tiền không còn; người nhận không còn email | `skipped`, job `completed` | — |
| Payload hỏng | Bất kỳ queue nào | `deadletter`, `retryCount` 0, log error chỉ có `jobId` | — |
| Handler ném lỗi DB | Bất kỳ queue nào | `failed`, output `{type, code}` | — |

</frozen-after-approval>

## Code Map

Đường dẫn tính từ `apps/api/src/`, trừ khi ghi khác.

- `modules/organizer/invitation-jobs.ts`: đủ khung mẫu.
  - `*_QUEUE_OPTIONS`; `WORK_OPTIONS` (lô 10, burst, `perJobResults`)
  - `ensure*`: tạo dead-letter, rồi `createQueue` và `updateQueue` cho queue chính
  - `enqueue*`: `boss.send(…, { db: fromDrizzle(tx, sql) })`; không nhận được id thì ném lỗi
  - `*Queues.ready()`: start rồi ensure, nhớ promise, lỗi thì xóa để lần sau làm lại
  - `*Worker`: chạy job tuần tự
  - Cũng chứa `OrganizerJobsModule`.
- `modules/organizer/ownership-transfer-jobs.ts`, `payout-default-jobs.ts`: hai job email gửi nhiều người. `notify*` gom lỗi rồi ném `Không gửi được n/m …`. `DefaultPayoutChangedPayload` có `.default('default_changed')` và `.refine`; giữ cả hai.
- `modules/ordering/order-jobs.ts`: lô 20. Kết quả `not_yet` → `failed` với lý do `'Đơn chưa tới hạn'`. Lỗi DB ghi bằng `dbErrorSummary`. Enqueue có `startAfter`.
- `modules/event/public-page-jobs.ts`: không có dead-letter. Job trong lô chạy song song; cùng slug trong một lô chỉ gọi web một lần.
- `platform/jobs/` (`BOSS`, `createBoss`): helper mới đặt ở đây. `platform/logging` có `isDatabaseError`, `dbErrorSummary`.
- `escapeHtml` ×4: `modules/identity/otp-email.ts:3`, `modules/organizer/{invitation,payout-default,ownership-transfer}-email.ts`.
- `Intl` giờ Việt Nam:
  - giờ và ngày: `modules/organizer/invitation-email.ts:7`, `payout-default-email.ts:6`, `apps/web/app/(dashboard)/btc/[orgId]/thanh-vien/members-manager.tsx:44`
  - chỉ ngày: `apps/web/app/(admin)/admin/closed-beta-review.tsx:35`
- `packages/contracts/src/event.ts`: có `vnParts` và `pad` (riêng tư), nằm ở mục "Hàm dùng chung api và web".
- `platform/http/error.filter.ts`: `MESSAGES` chỉ được đọc qua `codeForStatus`, hàm này trả 5 mã.
- pg-boss 12.38: `insert(name, jobs, { db? })` nhận `id` tùy chọn và dùng `ON CONFLICT DO NOTHING`. Retry và dead-letter theo cấu hình queue.
- Test liên quan:
  - `apps/api/test/organizer/*-job*.test.ts`, `*-queues.test.ts`
  - `test/ordering/order-{expiry,queues}.test.ts`, `test/event/public-page-{job,queues}.test.ts`
  - `FakeEmailTransport` (`test/identity/harness.ts:26`): `failWith` hiện làm lỗi mọi địa chỉ.

## Tasks & Acceptance

**Execution:**
- [x] `platform/jobs/queue.ts` (export qua `index.ts`): tạo khung pg-boss dùng chung.
  - `defineQueue({ name, deadLetter?, options, work, payload })` trả về `queueOptions`, `ensure(boss)`, và `enqueue(boss, tx, payload, { startAfter? })`; `enqueue` parse payload trước khi gửi.
  - Lớp cơ sở `QueueProducer` cho `ready()` của vai api.
  - `registerQueueWorker(boss, queue, { logger, label, logContext, handle, parallel?, dedupeBy? })`. `handle` trả `completed` hoặc `retry` kèm lý do.
  - `jobErrorMessage(err)`.
  - `fanOut(boss, queue, parentJobId, children)`: tạo job con bằng `insert`, id là UUID suy ra cố định từ `parentJobId` và khóa của từng con.
- [x] `invitation-jobs.ts`, `order-jobs.ts`, `public-page-jobs.ts`: chuyển sang helper.
  - `public-page` dùng `parallel` và `dedupeBy` theo slug.
  - `order-jobs` trả `retry` khi `not_yet`.
- [x] `ownership-transfer-jobs.ts`, `payout-default-jobs.ts`: chuyển sang helper.
  - Payload thêm `recipientUserId` (uuid, tùy chọn).
  - Tách hai hàm: tính người nhận (job gốc gọi `fanOut` theo `userId`) và gửi cho một người (job con).
  - Giữ quy tắc chọn người nhận và thứ tự hiện tại. Bỏ ghi chú "thà trùng còn hơn mất cảnh báo".
- [x] `platform/email/escape-html.ts` (export qua `index.ts`): bốn file email import bản này.
- [x] `packages/contracts/src/event.ts`: thêm `formatVnDateTime` (`HH:mm dd/MM/yyyy`) và `formatVnDate` (`dd/MM/yyyy`), nhận `Date | string`. Thay 4 chỗ dùng `Intl`; hậu tố ` (giờ Việt Nam)` vẫn do nơi gọi tự thêm.
- [x] `platform/http/error.filter.ts`: `MESSAGES` chỉ còn 5 mã mà `codeForStatus` trả, khai báo kiểu theo đúng 5 mã đó. Bỏ các import thừa.
- [x] Test:
  - Thêm `apps/api/test/platform/jobs-queue.test.ts`: `jobErrorMessage`; id job con cố định; `QueueProducer.ready()` chạy lại được sau khi lỗi.
  - Sửa test của hai job email theo hai hàm mới.
  - Thêm test worker cho trường hợp chỉ một địa chỉ lỗi. Mở rộng `FakeEmailTransport` để làm lỗi theo từng địa chỉ.
  - `packages/contracts/test/event.test.ts`: test formatter khi qua nửa đêm và qua năm mới.
- [x] Sổ theo dõi: trong `sprint-status.yaml`, chuyển E2-5 sang `done` kèm ghi chú. Trong `deferred-work.md`, ghi `Đã xử lý (…)` cho mục `:305` và `:326`, theo mẫu `:182`.

**Acceptance Criteria:**
- Given đã refactor xong, when grep `createQueue\(|\.work[<(]|pending \?\?=` trong `apps/api/src/modules`, then không còn kết quả nào.
- Given đã refactor xong, when grep `const escapeHtml|new Intl.DateTimeFormat` trong `apps/api/src` và các thư mục `app`, `lib`, `components` của `apps/web`, then chỉ còn định nghĩa trong `platform/email/escape-html.ts`.
- Given job báo chuyển quyền Owner có 3 người nhận và SMTP chỉ lỗi với một địa chỉ, when worker xử lý, then job con của người đó ở trạng thái `retry`, còn hai người kia mỗi người nhận đúng một email.
- Given bộ test hiện có, when chạy, then tất cả pass. Chỉ test của hai job email được sửa theo cấu trúc gốc/con.

## Implementation Notes

- AC grep đầu tiên (`createQueue\(|\.work[<(]|pending \?\?=` trong `apps/api/src/modules`) còn đúng 2 dòng, đều ở `identity/identity-janitor.ts` (`createQueue(queue)` và `work(queue, …)` của job lịch cron). Mục "Never" cấm đụng file này, nên giữ nguyên; mọi file `*-jobs.ts` đã sạch.
- `platform/jobs/queue.ts`:
  - `registerQueueWorker` tự gọi `queue.ensure(boss)` trước `boss.work` (worker nào cũng làm vậy), rồi log `Đã đăng ký job …`.
  - Kết quả `retry` không log (như `not_yet` của order-jobs trước đây); ném lỗi thì log warn `{label} thất bại; pg-boss sẽ thử lại` kèm `jobId` và `logContext`.
  - Payload hỏng log error `Payload job {queue} không hợp lệ` cho mọi queue (trước đây invitation và order không log).
  - `jobErrorMessage`: lỗi DB → `JSON.stringify({type, code})` như order-jobs trước đây; lỗi khác → message (handler tự lọc, chỉ tên lớp hay mã HTTP); không phải `Error` → `Lỗi không rõ`. Invitation, public-page và hai job email giờ cũng ghi lỗi DB dạng `{type, code}` thay vì message gốc.
  - `childJobId`: UUID dạng v5 (SHA-1 của byte id gốc + khóa). `fanOut` bỏ khóa trùng trước khi `insert` (pg-boss ném lỗi khi một lô có id trùng).
  - `enqueue` của public-page và invitation giờ parse payload (trước đây chỉ gán kiểu); slug và id lời mời luôn hợp lệ nên không đổi hành vi.
- Hai job email: hàm mới là `ownershipTransferRecipients` / `sendOwnershipTransferredEmail` và `defaultPayoutRecipients` / `sendDefaultPayoutChangedEmail` (thay `notify*`). Job con đọc lại tên BTC, tài khoản, tên người đổi lúc gửi; không kiểm lại người nhận còn là thành viên (danh sách chốt ở job gốc). `logContext` của hai job có `recipientUserId` (id, không PII).
- Kiểm (11/11): `pnpm typecheck` qua; `pnpm lint:deps` không vi phạm (api 197 module, web 197 module); `pnpm test` qua (contracts 246, web 177, api 805); e2e: `pnpm --filter @tickee/web test:e2e -- members admin-closed-beta` chuyển nguyên `--` cho Playwright nên chạy cả bộ, 688/688 qua.
- `FakeEmailTransport.failFor` (Map `to` → lỗi) làm lỗi riêng từng địa chỉ. Test worker của job chuyển quyền kéo lần retry của job con lên ngay bằng `boss.update(…, { id, startAfter: new Date() })` để kiểm lần thử lại chỉ gửi người bị lỗi.
- Sau review vòng 1 (11/11):
  - Patch #1, #3, #7, #8, #9, #18; defer #11, #19 vào `deferred-work.md`.
  - Kiểm lại: `pnpm typecheck` qua; `pnpm lint:deps` không vi phạm; `pnpm test` qua (contracts 246, web 177, api 807).
  - Build web rồi chạy `playwright test e2e/members.spec.ts e2e/admin-closed-beta.spec.ts`: 54/54 qua trên hai project. Lệnh e2e ghi ở Verification chuyển nguyên `--` cho Playwright nên không lọc được file; hãy gọi `playwright test <file>` trực tiếp.

## Spec Change Log

## Review Triage Log

Vòng 1 (blind-hunter BH, edge-case-hunter EC, verification-gap VG):

| # | Nguồn | Phát hiện | Verdict | Bằng chứng / Route |
|---|---|---|---|---|
| 1 | BH, EC | Chú thích `ownershipTransferRecipients` / `defaultPayoutRecipients` ghi "theo thứ tự gửi", nhưng job con chèn cùng một câu lệnh (cùng `created_on`) và pg-boss 12 lấy job theo `priority, created_on`, nên thứ tự gửi thật không xác định | low | Có thật: tất cả job con có chung `created_on`. Không ai cần thứ tự gửi, nhưng chú thích sai. → patch (đổi thành "thứ tự liệt kê") |
| 2 | BH | Job con không kiểm lại người nhận còn là thành viên. Admin bị xóa trong lúc job con đang retry (≤ ~2 giờ) vẫn nhận cảnh báo | low | Có thật, nhưng hiếm: phải SMTP lỗi đúng địa chỉ đó và người đó bị xóa trong khoảng retry. Người này là Admin lúc thay đổi xảy ra, và Design Notes đã chọn chốt danh sách ở job gốc. Muốn sửa thì phải thêm guard. Loại |
| 3 | BH | `enqueueOwnershipTransferred` / `enqueueDefaultPayoutChanged` nhận cả `recipientUserId`, nên nơi gọi có thể enqueue thẳng job con và bỏ qua bước chọn người nhận | low | Kiểu hiện tại cho phép, nhưng chưa nơi gọi nào truyền trường này. Sửa trực tiếp bằng kiểu `Omit`. → patch |
| 4 | BH | `childJobId` cho trùng id khi id job gốc không phải hex | false | Không xảy ra được: `job.id` do pg-boss cấp, cột `id` có kiểu `uuid`. Chỉ test giả dùng `job-0`, và test đó không gọi `fanOut` |
| 5 | BH | Handler hoặc `logContext` ném lỗi đồng bộ làm hỏng cả lô | false | Mọi `handle` đều là hàm `async`, nên lỗi luôn thành promise reject. Mọi `logContext` chỉ destructure payload đã parse |
| 6 | BH, EC | `enqueue` parse slug, nên slug sai pattern sẽ ném lỗi trong `tx` và rollback thao tác của BTC | false | Slug chỉ sinh một lần ở `event.service.ts:120-122` = `slugBase(name)` + `-` + 4 ký tự, dài ≤ 65 và luôn khớp `EVENT_SLUG_PATTERN`. Không có đường nào sửa slug |
| 7 | BH, VG | Test "id cố định giữa các lần chạy" chỉ so `childJobId` với chính nó, nên không bắt được thay đổi thuật toán (sẽ gửi trùng email khi job gốc retry qua một lần deploy) | low | Có thật: assertion tự so với chính nó. → patch (ghim một UUID cố định) |
| 8 | BH | Test worker: ca tuần tự không kiểm số lần và thứ tự gọi `handle`; không test nào kiểm `parallel` chạy song song thật | low | Có thật: nếu `parallel` bị đổi thành tuần tự, test vẫn qua. → patch |
| 9 | BH | Chưa test với pg-boss thật rằng job con (tạo bằng `insert`) thừa hưởng retry và dead-letter của queue | low | Hành vi đúng (`insertJobs` lấy `COALESCE(…, q.retry_limit / q.dead_letter)`), nhưng test chỉ kiểm trạng thái `retry`, mà giá trị mặc định 2 cũng cho ra trạng thái đó. → patch (kiểm `retryLimit` và `deadLetter` của một job con) |
| 10 | BH | Queue cảnh báo đổi tài khoản thiếu test worker cho trường hợp chỉ một địa chỉ lỗi | low | Đã có test phủ cơ chế này: test worker của job chuyển quyền đi cùng đường `fanOut`/`registerQueueWorker`; unit test của payout có ca "người khác vẫn gửi được"; test worker của payout cho thấy từng job con retry riêng. Loại |
| 11 | BH | `errorName` vẫn bị chép ở hai file job email; phần tra tên BTC cũng lặp | low | Có từ trước baseline: cả hai file đã có `errorName` y hệt, `invitation-jobs.ts` có bản inline. → defer |
| 12 | BH, EC | `formatVnDateTime` / `formatVnDate` trả `NaN…` khi ngày không hợp lệ, trong khi `Intl` trước đây ném lỗi | false | Mọi đầu vào đều hợp lệ: timestamp từ DB, `changedAt` đã qua `z.iso.datetime`, và các trường `z.iso.datetime()` của contract. `formatEventDateTime` có sẵn cũng theo cùng contract |
| 13 | BH | Sổ theo dõi ghi `done` / "Đã xử lý" trước khi review | false | Các dòng này ship cùng thay đổi; spec chuyển sang `done` ở bước present |
| 14 | BH, EC | AC grep đầu tiên vẫn khớp 2 dòng ở `identity-janitor.ts` | low | Có thật, nhưng phạm vi đúng là vậy: mục Never cấm đụng file đó, và Implementation Notes đã ghi. Muốn sửa thì phải sửa spec. Loại |
| 15 | BH | Job dạng cũ đang `retry` lúc deploy sẽ fan-out lại cho mọi người, kể cả người đã nhận | false | Chưa có môi trường deploy nào (`4-7` vẫn là backlog), nên lần deploy đầu tiên đã mang sẵn code này |
| 16 | BH | `JOB_COMPLETED` là object dùng chung và sửa được | false | Không chỗ nào ghi vào nó: `registerQueueWorker` chỉ đọc `status` |
| 17 | EC | Worker bản cũ chạy chồng lúc deploy sẽ bỏ `recipientUserId` và gửi cho mọi người (N×N email) | false | Chưa có môi trường deploy nào (`4-7` backlog), nên không có worker bản cũ nào chạy chồng với bản mới |
| 18 | VG | Chuỗi hết hạn trong email mời và trang Thành viên chưa được ghim đúng `HH:mm dd/MM/yyyy` (đổi sang `formatVnDate` thì test vẫn qua) | low | Gap đã kiểm chứng. → patch (assert chuỗi chính xác) |
| 19 | VG | Chưa có test worker kiểm public-page dùng `dedupeBy` và `parallel` cho cùng slug trong một lô | low | Gap đã kiểm chứng; trước thay đổi cũng chưa có test này. → defer |

## Design Notes

**Tách job theo người nhận, không làm nhật ký đã gửi:**
- Không cần migration.
- Mỗi người nhận có retry và dead-letter riêng.
- Dùng lại được cho Story 3.10, khi phải báo tới hàng trăm Người mua.

Id job con cố định, nên nếu job gốc lỗi sau khi đã tạo con rồi chạy lại, cũng không tạo thêm con. Đánh đổi: thêm một chu kỳ poll (khoảng 2 giây) trước khi gửi. Danh sách người nhận được chốt khi job gốc chạy, nghĩa là vẫn chốt lúc xử lý như hiện nay.

```ts
export const ADMIN_INVITATION_QUEUE = defineQueue({
  name: JobQueue.ORGANIZER_SEND_ADMIN_INVITATION,
  deadLetter: JobQueue.ORGANIZER_SEND_ADMIN_INVITATION_DEAD_LETTER,
  options: { retryLimit: 8, retryDelay: 30, retryBackoff: true, retryDelayMax: 3600 },
  work: { batchSize: 10, burstWhenBatchFull: true, perJobResults: true },
  payload: SendAdminInvitationPayload,
});
export const ensureAdminInvitationQueues = (boss: PgBoss) => ADMIN_INVITATION_QUEUE.ensure(boss);
```

## Verification

**Commands:**
- `pnpm typecheck`: pass
- `pnpm test`: pass, gồm các test mới
- `pnpm lint:deps`: không vi phạm, không có cycle
- `pnpm --filter @tickee/web test:e2e -- members admin-closed-beta`: pass (trang có ngày giờ đổi sang formatter mới)
