---
title: 'Story 5.3-a: API quét Mã QR vé'
type: 'feature'
created: '2026-11-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '768f3161cb8eaaec7d6ffc39d18505efd9e75314'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chưa có API quét. Bảng `tickets` chưa có `checked_in_by`/`checkin_scan_id`, chưa có `ticketing.checkIn` hay `event.assertCheckinOpen`, nên chưa ai check-in được Vé (FR-27, FR-28, AD-15, AD-16, AD-35, NFR-2).

**Approach:**
- Thêm `POST /v1/checkin/events/:eventId/scans`: kiểm chữ ký trước, rồi gọi `ticketing.checkIn` và trả `ScanResult`.
- `GET /v1/checkin/events/:eventId` thêm số đã check-in và tổng số Vé hợp lệ.

**Quyết định (Mason, 23/11/2026):**
- Tách Story 5.3 thành hai spec. 5.3-a (spec này) làm API. 5.3-b làm Màn quét web.
- Người quét trước không có tên (tài khoản OTP) thì dùng nhãn theo vai trò: Owner, Admin, hoặc CTV khác. Có tên (tài khoản Google) thì hiện tên. Người quét trước là chính mình thì hiện "bạn". Không lộ email.

## Boundaries & Constraints

**Always:**
- Route quét:
  - `@RequirePermission(CHECKIN_SCAN)`, `cache-control: no-store`;
  - đặt ở `flows`, vì cần tên và vai trò người quét từ `identity`, `organizer` và `checkin`;
  - body `{code: chuỗi 1–512, scanId: uuid}`; sai schema → `400 VALIDATION_FAILED`.
- `verifyTicketQr` chạy trước mọi truy vấn DB. Mã sai dạng, sai chữ ký hoặc khóa `k` lạ → `invalid BAD_SIGNATURE`. Chữ ký đúng mà không có Vé cũng → `BAD_SIGNATURE`.
- `ticketing.checkIn(tx, {ticketId, eventId, organizationId, userId, scanId})` chạy trong một transaction:
  1. `event.assertCheckinOpen(tx, eventId)`: khóa Sự kiện `FOR SHARE`, trả lý do đóng thay vì ném lỗi HTTP.
     - Sự kiện đã hủy → `CANCELLED`.
     - Sự kiện đã kết thúc → `EVENT_ENDED`. "Đã kết thúc" theo định nghĩa của `checkin-gate.ts`: `ended_manually_at IS NOT NULL OR now() >= effective_end_at`.
  2. Chạy UPDATE có điều kiện theo AD-15, thêm điều kiện `organization_id`, `RETURNING` bản chụp. Được 1 dòng → `ok` và `realtime.notify(tx, EVENT_CHECKINS_CHANGED, {id: eventId, organizationId, eventId})` trong cùng transaction.
  3. Được 0 dòng → đọc lại Vé theo id, chỉ để phân loại; chỉ trả bản chụp khi Vé thuộc Sự kiện này.
     - Vé thuộc Sự kiện khác → `OTHER_EVENT`.
     - Vé `cancelled` → `VOIDED` nếu `cancel_reason = 'voided'`, còn lại `CANCELLED`.
     - Cùng `scanId` và cùng người quét → phát lại `ok`.
     - Cùng người quét, chưa tới 60 giây → `recent`.
     - Còn lại → `already`.
- `ScanResult` trong contracts là union theo `outcome`:
  - `ok {holderName, seq, count, ticketTypeName}`, lấy từ bản chụp trên Vé;
  - `recent {}`;
  - `already {checkedInAt, checkedBy}`, với `checkedBy` là `{kind:'self'}` | `{kind:'name', name}` | `{kind:'role', role: 'owner'|'admin'|'checker'}`. Thứ tự: chính mình → `self`; có `user.name` (đã trim) → `name`; còn lại → vai trò trong BTC, hoặc `checker` nếu không phải thành viên;
  - `invalid {reason: BAD_SIGNATURE | CANCELLED | VOIDED | OTHER_EVENT | EVENT_ENDED}`.
- Response quét không bao giờ chứa Mã QR vé, SĐT hay email. Log không ghi `code`.
- Metric riêng `tickee.checkin.scan.duration` qua `measured`, có thuộc tính `outcome` và `reason` (lực lượng thấp).
- `CheckinEvent` thêm `checkedInCount` và `validTicketCount`. Cả hai chỉ đếm Vé `valid` của Sự kiện; `checkedInCount` đếm thêm điều kiện `checked_in_at` có giá trị.

**Never:**
- Không làm web: Màn quét, camera, overlay, âm thanh, Wake Lock (cả mục hoãn "Story 5.3 (D5). `/xem-ve`… không giữ màn hình sáng"), safe-area (mục hoãn "Padding `env(safe-area-inset-bottom)`… đang bằng 0"), tab "Quét vé". Tất cả thuộc 5.3-b. Riêng helper `checkinEvent()` trong `e2e/checkin-mock.ts` được sửa để khớp contract mới.
- Không làm timeout phía client, thử lại cùng `scanId` từ client, hay test N request song song (5.4).
- Không làm tra tay (5.5), thu hồi CTV hay trả `403 EVENT_ENDED` cho CTV (5.6), đăng ký SSE và số theo Hạng vé (5.7).
- Không đổi `PermissionGuard`, `module-graph.cjs` hay migration cũ.
- Không chặn Vé của BTC hoặc Sự kiện bị khóa: khóa chỉ chặn bán.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Xanh | Vé `valid` của Sự kiện này, chưa check-in | `ok`; ghi `checked_in_at`, `checked_in_by`, `checkin_scan_id`; phát notify | N/A |
| Phát lại | Cùng `scanId`, cùng người, Vé đã check-in bởi lần quét đó | `ok` như lần đầu; không ghi gì | N/A |
| Trung tính | Cùng người, `scanId` khác, chưa tới 60 giây | `recent` | N/A |
| Đã check-in | Người khác; hoặc cùng người từ 60 giây trở lên | `already`; `checkedBy` theo thứ tự ở Boundaries | N/A |
| Sai mã | Sai dạng, sai chữ ký, khóa `k` lạ, hoặc Vé không tồn tại | `invalid BAD_SIGNATURE`; sai chữ ký thì không truy vấn DB | N/A |
| Sự kiện khác | Vé thuộc Sự kiện khác (cùng hoặc khác BTC) | `invalid OTHER_EVENT`; không lộ gì thêm | N/A |
| Vé đã hủy | Vé `cancelled` | `CANCELLED`, hoặc `VOIDED` nếu `cancel_reason = 'voided'` | N/A |
| Sự kiện đóng | Quá `effective_end_at`, đã bấm "Kết thúc", hoặc Sự kiện đã hủy | `EVENT_ENDED` hoặc `CANCELLED`; không ghi gì | N/A |
| Owner/Admin quét | Thành viên của BTC sở hữu, không có lời mời | Như CTV | N/A |
| Không quyền | CTV của Sự kiện khác, người lạ, CTV bị thu hồi | Không ghi gì | `403 NOT_A_MEMBER` / `CHECKER_REVOKED` |
| Body sai | Thiếu `code`, hoặc `scanId` không phải uuid | Không ghi gì | `400 VALIDATION_FAILED` |

</frozen-after-approval>

## Code Map

**Vé và mã QR**
- `apps/api/src/modules/ticketing/schema.ts:25-69`: bảng `tickets`.
  - Đã có `checked_in_at` (từ migration 0017), `status` (`valid|cancelled`), `cancel_reason` (text tự do; CHECK ở :64).
  - Bản chụp: `seq`, `order_ticket_count`, `holder_name`, `ticket_type_name`.
  - Chưa có `checked_in_by`, `checkin_scan_id`. Migration mới nhất là `0034`.
- `ticketing/qr.ts:78`: `verifyTicketQr(keys, qr)` trả `{ticketId, keyVersion}` hoặc `null`. Hàm kiểm `TICKET_QR_PATTERN` trước, rồi so bằng `timingSafeEqual`.
- Khóa QR: inject `@Inject(TICKET_QR_KEYS) TicketQrKeys`. `ticketing.module.ts:122-131` là `@Global` và export cả `TicketsService`.
- `ticketing/index.ts`: thêm export `checkIn` và hàm đếm. Mẫu hàm đếm: `issuedTicketCountsByType`.

**Sự kiện và quyền**
- `event/checkin-gate.ts`:
  - :49 định nghĩa "đã kết thúc" (`>=` cộng `ended_manually_at`);
  - :88 `lockCheckinEventByIdForShare` là mẫu cho `assertCheckinOpen`.
  - Không dùng định nghĩa `>` của `public-event.ts:24`.
- `checkin/checkin-event.controller.ts`: `GET` hiện trả `{eventId, eventName}`. Mẫu dùng `@EventAccess()`, `no-store` và kiểm `event.organizationId === ctx.organizationId`.

**Route trong `flows`**
- `flows/checker-invite.{flow,controller}.ts`: mẫu route `/v1/checkin/...` đặt trong `flows`, flow tự mở transaction. Guard chọn nhánh Sự kiện theo `:eventId`, không theo controller.
- Nguồn tên và vai trò người quét:
  - `identity/index.ts:13` `userContacts(db, ids)` trả `{email, name}`. `name` rỗng với tài khoản OTP (mọi `signUp` của test).
  - `organizer/index.ts:12` `memberRoleOf(db, userId, organizationId)`.
  - `checkin/index.ts` `checkerStatusOf(db, scope, eventId, userId)`.
- `module-graph.cjs:13-14`: cho phép `checkin → ticketing, event` và `ticketing → event`.

**Hạ tầng**
- `platform/realtime/notify.ts:21-41`. `EVENT_CHECKINS_CHANGED` đã có ở `packages/contracts/src/realtime.ts:27-33`.
- `platform/telemetry/measure.ts` `measured(...)`. Mẫu dùng: `tingee.client.ts:279,536`.
- `platform/db/grants.ts:50-63`: cột mới tự UPDATE được, không cần sửa.
- `packages/contracts/src/checkin.ts:66,75,111`: `checkinScanPath`, `checkinEventApiPath`, `CheckinEvent`.

**Test**
- Phát Vé thật: `apps/api/test/ticketing/shared-tickets.test.ts:52` `freeTickets()`; `test/ordering/order-fixtures.ts:97,160` (`paidReadyOrg`, `eventOnSale`).
- `test/checkin/checkin-access.test.ts:75,89`: `createEvent`, `setChecker`.
- `test/checkin/checker-accept.test.ts`: migrator `Database` để sửa cột bị khóa, như `effective_end_at`, `status`.
- `test/organizer/isolation.test.ts`: tự dò route CTV mới.
- `apps/web/e2e/checkin-mock.ts:36`: helper `checkinEvent()`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/checkin.ts` (+ `test/checkin.test.ts`) -- Thêm vào contracts:
  - `ScanRequest`, `ScanResult`, `checkinScanApiPath(eventId)`;
  - `checkedInCount` và `validTicketCount` trong `CheckinEvent`.
- [x] `apps/api/drizzle/0035_ticket_checkin.sql`, `ticketing/schema.ts` -- Lưu trữ:
  - cột `checked_in_by uuid` và `checkin_scan_id uuid`;
  - CHECK: hai cột này phải NULL khi `checked_in_at` NULL;
  - sinh bằng `pnpm --filter @tickee/api db:generate --name ticket_checkin`.
- [x] `apps/api/src/modules/event/{checkin-gate,index}.ts` -- `assertCheckinOpen`.
- [x] `apps/api/src/modules/ticketing/{check-in,index}.ts` -- `checkIn` theo Boundaries, và hàm đếm `{checkedInCount, validTicketCount}` theo Sự kiện.
- [x] `apps/api/src/flows/{checkin-scan.flow,checkin-scan.controller,flows.module}.ts` -- Route quét:
  - `verifyTicketQr`;
  - `checkIn`;
  - dựng `checkedBy`;
  - metric.
- [x] `apps/api/src/modules/checkin/checkin-event.controller.ts` -- Trả thêm hai trường đếm.
- [x] `apps/api/test/checkin/scan.test.ts` -- Test API:
  - mọi dòng Matrix;
  - sai chữ ký không truy vấn DB;
  - có notify;
  - response không có QR, SĐT hay email;
  - đủ ba nhánh `checkedBy`;
  - hai trường đếm.
- [x] `apps/web/e2e/checkin-mock.ts` -- `checkinEvent()` trả thêm hai trường đếm, để `checker-invite-accept.spec.ts` vẫn pass.

**Acceptance Criteria:**
- Given hai người lần lượt quét cùng một Vé, when cả hai xong, then người sau nhận `already` và `checked_in_at` giữ nguyên giá trị của lượt đầu.
- Given route quét mới, when chạy bộ test cách ly, then CTV của Sự kiện khác nhận `403 NOT_A_MEMBER` và CTV bị thu hồi nhận `403 CHECKER_REVOKED`.
- Given mọi kết quả quét, when ghi log request, then log không chứa `code`.

## Implementation Notes

- Đã làm (23/11/2026): đủ 8 task.
  - Mới: `ticketing/check-in.ts` (`checkIn`, `checkinCountsOf`, `CHECKIN_RECENT_SECONDS`), `flows/checkin-scan.{flow,controller}.ts` (`scanTicket`, `CHECKIN_SCAN_DURATION_METRIC`), `drizzle/0035_ticket_checkin.sql` (CHECK `tickets_checkin_check`), `test/checkin/scan.test.ts`.
  - `event/checkin-gate.ts`: `assertCheckinOpen` trả `'CANCELLED' | 'EVENT_ENDED' | null`; luật "đã kết thúc" gom thành hằng `checkinEnded`, dùng chung với `lockEventForCheckerInvite`. Sự kiện không tồn tại thì ném `Error` (guard đã kiểm trước).
  - contracts: `ScanRequest`, `ScanResult`, `ScanOutcome`, `ScanInvalidReason`, `ScanCheckerRole`, `ScanCheckedBy`, `checkinScanApiPath`, `SCAN_CODE_MAX`; `CheckinEvent` có hai trường đếm.
- Thêm ngoài spec:
  - `platform/telemetry/measure.ts`: `MeasuredOutcome.attributes` (tùy chọn), ghi lên span và histogram; đường để `reason` vào metric.
  - `scanId` chữ hoa được hạ thường trước khi ghi và so, nên phát lại vẫn khớp.
  - `ticketing/schema.ts`: hằng `TICKET_CANCEL_REASON` (`event_cancelled`, `voided`), không CHECK (sau review, P1).
- Hành vi cần biết: Sự kiện đóng thắng mọi phân loại Vé (kể cả Vé của Sự kiện khác, chữ ký đúng mà không có Vé, và phát lại); Sự kiện vừa hủy vừa quá giờ kết thúc → `CANCELLED`. Vé có `checked_in_at` mà không có `checked_in_by` (dữ liệu cũ) → `checkedBy` `{kind:'role', role:'checker'}`.
- Kiểm (23/11/2026, sau vá review):
  - contracts: 353 pass;
  - API `test/checkin test/ticketing test/organizer test/dependency-rules.test.ts test/telemetry`: 475 pass;
  - Playwright `checker-invite-accept.spec.ts`: 40 pass ở cả hai project;
  - `pnpm typecheck`, `pnpm lint:deps`: exit 0;
  - mỗi test mới được thử bằng cách làm hỏng code tương ứng: test hỏng, đã trả code về.

## Spec Change Log

## Review Triage Log

Lượt 1 (23/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| BH1 | Gửi lại cùng `scanId` sau khi Sự kiện vừa đóng (hoặc Vé vừa hủy) nhận đỏ thay vì `ok` của lần đầu | low | Đúng: `assertCheckinOpen` và nhánh Vé hủy chạy trước nhánh phát lại, theo đúng thứ tự Boundaries. Chỉ gặp khi lần đầu đã commit, phản hồi mất, và Sự kiện đóng ngay trong vài giây thử lại. Sửa phải thêm nhánh đọc trước cổng. Thử lại cùng `scanId` từ client là việc của 5.4 | reject, để 5.4 xét (deferred-work) |
| BH2 | `recent` chỉ theo tài khoản: một tài khoản dùng chung nhiều máy thì bản chụp QR ở cổng thứ hai ra trung tính | low | Đúng như thiết kế: AD-15 và epic định nghĩa "cùng người quét lại trong 60 giây". Màn trung tính vẫn báo "Bạn vừa check-in Vé này", không phải xanh. Sửa phải đổi intent | reject |
| BH3 | DB không ép "check-in một lần" (role app vẫn UPDATE được `checked_in_*`) | low | Đúng, nhưng chỉ `checkIn` ghi các cột này, bằng UPDATE có điều kiện. Thêm trigger set-once là cơ chế mới cho tình huống chưa có đường code nào | reject |
| BH4 | `'voided'` là chuỗi rời, 7.5 phải ghi khớp từng chữ | low | Đúng: `check-in.ts` so `cancel_reason === 'voided'`, không có hằng chung; epic ghi `event_cancelled` \| `voided`. Thêm hằng trong `ticketing/schema.ts` là sửa trực tiếp | patch (P1) |
| BH5 | Đếm check-in đọc mọi dòng Vé của Sự kiện ở mỗi `GET` | low | Đúng là quét theo `tickets_event_id_idx` rồi đọc heap; Sự kiện Closed Beta vài trăm tới vài nghìn Vé nên rẻ. Tải đếm khi 5.7 refetch được đo ở 9.2. Sửa phải thêm index/migration | reject |
| BH6 | Histogram quét bỏ lần quét lỗi, nên p95 lệch | low | Đúng: `measured` không ghi khi `fn` ném (thiết kế chung từ 4.6-a). Request lỗi vẫn có trong `http.server.request.duration` với mã 5xx | reject |
| BH7 | Test "riêng tư và đo lường" dựa vào trạng thái của các test trước | low | Đúng: `sentCodes`, `responses` và `reader` do các describe trước đổ vào; chạy riêng bằng `-t` thì `qrCodes.length > 10` hỏng. Sửa chỉ trong test | patch (P2) |
| BH8 | Thiếu test: `checkedInBy` null → `checker`; nhánh ném "lệch BTC"; phát lại cùng `scanId` sau 60 giây | low | Hai ca đầu và cuối đúng là chưa có test, thêm rẻ. Nhánh "lệch BTC" là phòng thủ, guard đã bảo đảm Sự kiện thuộc BTC của ctx nên không tới được | patch (gộp P4); phần "lệch BTC" reject |
| BH9 | `checkedByOf` hai câu tuần tự, đọc cả email, gọi Owner/Admin cũ là "CTV khác" | low | Hai câu tra theo PK/unique chỉ ở nhánh `already`; email không ra response. Nhãn "CTV khác" cho người không còn là thành viên đúng như quyết định đã duyệt | reject |
| BH10 | `ADD CONSTRAINT CHECK` không `NOT VALID`, khóa và quét cả bảng `tickets` lúc deploy | low | Đúng về cơ chế, nhưng chưa có production; bảng nhỏ và migrate chạy một lần trước khi mở. Sửa phải sửa tay migration sinh ra | reject |
| BH11 | Mốc 60 giây chỉ có ở API | low | Web không tự tính `recent` (server quyết), nên không có bên dùng thứ hai để lệch | reject |
| VG1 | Span `checkin scan` chưa có test cho `outcome`/`reason` | medium | Lớp VG đã kiểm: trả `measure.ts:80` về `setAttribute('outcome', …)` thì không test nào hỏng; test Tingee không truyền `attributes` | patch (P3) |
| VG2 | Thứ tự `checkedBy` (self → tên → vai trò) chỉ được test với người không tên | medium | Lớp VG đã kiểm: Owner/Admin/CTV của test đều là tài khoản OTP không tên; đảo thứ tự trong `checkedByOf` thì mọi ca vẫn pass | patch (P4) |
| VG3 | Thứ tự "hủy trước kết thúc" trong `assertCheckinOpen` chưa có test | low | Lớp VG đã kiểm: đổi hai dòng thì mọi ca vẫn pass. Boundaries liệt kê hủy trước; thêm một dòng `CLOSE` hủy + đã quá `effective_end_at` là đủ | patch (P5) |
| VG4 | Test phát lại: `expect.poll(...) > 0` qua ngay vì tín hiệu của test trước cùng Sự kiện | low | Đúng (`scan.test.ts:227`): mốc đếm chỉ dựa vào `sleep(150)`, có thể chập chờn. Sửa: lấy số đếm trước lần quét đầu, chờ `> before` | patch (P6) |
| EC1 | Phát lại cùng `scanId` sau khi Sự kiện đóng hoặc Vé hủy ra đỏ | low | Trùng BH1 | reject (gộp BH1) |
| EC2 | Admin bị gỡ hoặc CTV bị thu hồi giữa lúc guard đọc và lúc check-in, lần quét đang chạy vẫn ghi | low | Cửa sổ vài mili giây; epic định nghĩa thu hồi có hiệu lực ở lượt quét kế tiếp | reject |
| EC3 | Không có cận dưới: quét thử nhiều ngày trước Sự kiện là check-in thật | low | Đúng, nhưng AD-15 chỉ định nghĩa "mở" là chưa hủy và chưa quá `effective_end_at`; khách chưa ở cổng trước ngày diễn ra. Thêm cận dưới là quyết định sản phẩm mới | reject |
| EC4 | Khóa `k` bị gỡ khỏi `TICKET_QR_KEYS` thì Vé thật ra `BAD_SIGNATURE`, không cảnh báo lúc quét | low | Kiểm lúc khởi động của 4.7-g (`TicketQrKeyCheck`) đã cảnh báo `ticket_qr_key_missing` cho Vé `valid` của Sự kiện còn mở | reject |
| EC5 | Vai trò người quét trước đọc lúc hiện, không chụp lúc check-in | low | Trùng phần nhãn của BH9; đúng như quyết định đã duyệt | reject (gộp BH9) |
| EC6 | Web với contract mới lên trước API thì parse `CheckinEvent` hỏng | low | Chưa có production; web và api deploy cùng commit | reject |
| EC7 | Test riêng tư/histogram hỏng khi chạy riêng hoặc xáo thứ tự | low | Trùng BH7 | patch (gộp P2) |

## Design Notes

**Vì sao route đặt ở `flows`:** `checkin` và `ticketing` không được import `identity` hay `organizer`, mà kết quả `already` cần tên và vai trò người quét. `flows/checker-invite.*` đã là tiền lệ route `/v1/checkin/...` trong `flows`.

**Vì sao `ScanResult` bỏ hai lý do của AD-15:**
- `EXPIRED`: Vé hết hiệu lực đúng lúc Sự kiện kết thúc, nên trùng `EVENT_ENDED`.
- `CHECKER_REVOKED`: guard đã trả `403` trước khi tới handler.

**Phát lại theo `scanId`:** đòi cả cùng người quét, để `scanId` của người khác không lấy được kết quả xanh.

**Notify:** phát ngay từ story này để 5.7 chỉ cần đăng ký, không phải sửa `checkIn`.

## Verification

**Commands:**
- `pnpm --filter @tickee/contracts build && pnpm --filter @tickee/contracts test` -- expected: pass.
- `pnpm --filter @tickee/api exec vitest run test/checkin test/ticketing test/organizer test/dependency-rules.test.ts` -- expected: pass (cần Postgres từ docker compose).
- `sh scripts/dev-env.sh pnpm turbo build --filter=@tickee/web && pnpm --filter @tickee/web exec playwright test e2e/checker-invite-accept.spec.ts` -- expected: pass ở cả hai project.
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
