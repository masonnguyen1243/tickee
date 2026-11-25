---
title: 'Story 5.7: Theo dõi check-in realtime'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'bd70455795d343cd8c6cb3f7db25c3422af9af34'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `ticketing.checkIn` đã phát `event_checkins_changed` trong cùng transaction (Story 5.3), nhưng chưa stream nào nhận tín hiệu này. Tab Check-in của Owner/Admin chưa có số liệu check-in. Số "Đã check-in k/N" ở đỉnh Màn quét chỉ đổi khi chính người đó quét xong. Chưa có số theo từng Hạng vé. Thiếu FR-30, UX-DR39, AD-17.

**Approach:**
- API: `CheckinEvent` (`GET /v1/checkin/events/:eventId`) thêm số theo từng Hạng vé. Thêm route SSE `GET /v1/checkin/events/:eventId/live` (`checkin.scan`), dùng chung cho Owner, Admin và CTV được giao, lọc `event_checkins_changed` theo Sự kiện.
- Web: khối `checkin-progress` ở đầu tab Check-in. Cả tab và Màn quét đọc `CheckinEvent` qua `useLiveResource`.

**Quyết định (Mason, 25/11/2026):**
- **Hiện mọi Hạng vé của Sự kiện**, kể cả Hạng vé chưa có Vé hợp lệ (hàng "0/0", thanh rỗng), để thứ tự không nhảy khi Hạng vé bán Vé đầu tiên.
- **Không gộp action item E3-4** (heartbeat có tên, watchdog client, đóng stream khi mất `LISTEN`): 5.7 dùng hub và hook như hiện có.
- **Giữ một spec**, không tách API/web (khoảng 4.000 token, Mason chấp nhận rủi ro).

## Boundaries & Constraints

**Always:**
- **Số liệu** (`CheckinEvent`, `no-store`):
  - thêm `ticketTypes: [{ticketTypeId, name, checkedInCount, validTicketCount}]`;
  - thứ tự Hạng vé theo `event.ticketTypesOf` (tạo trước đứng trước), dùng tên hiện tại của Hạng vé;
  - đếm bằng một câu `GROUP BY ticket_type_id` trên Vé `valid` (`orgScope` + `event_id`). Tổng `checkedInCount`/`validTicketCount` là tổng các nhóm, nên luôn khớp các thanh;
  - Vé đã hủy hoặc bị vô hiệu không tính, kể cả khi đã check-in (như 5.3).
- **Stream** `GET …/live`:
  - đặt trên `CheckinEventController` với `@RequirePermission(CHECKIN_SCAN)` và `@EventAccess()`. Guard nhánh Sự kiện quyết quyền trước khi mở stream, trả `403` JSON (`NOT_A_MEMBER`, `CHECKER_REVOKED`, và `EVENT_ENDED` cho CTV). Không thêm kiểm tra riêng;
  - bộ lọc: `type === event_checkins_changed`, cùng `eventId` và `organizationId` của ctx. Heartbeat, `resync` và lỗi `503` khi `LISTEN` chưa sẵn sàng đều do hub lo. Dữ liệu chỉ có `{type}`.
- **Web, `checkin-progress`** (`data-slot="checkin-progress"`, section đầu tiên của tab, trước "Màn quét"):
  - `StatCard` nhãn "Check-in", giá trị "k/N", thanh tiến độ nền `stage-line`, phần đầy `brand`;
  - caption: "Cập nhật liên tục". Khi số liệu có thể đã cũ (offline, hoặc lần tải lại lỗi mà vẫn còn dữ liệu cũ) thì đổi thành "Cập nhật lúc HH:MM:SS", như Tổng quan;
  - mỗi Hạng vé một hàng trên `card` sáng: tên, "k/N" tabular, thanh nền `surface-sunken`, phần đầy `text` (light) / `brand` (dark);
  - mỗi thanh có `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=N`, `aria-valuenow=k` và nhãn truy cập. N = 0 thì thanh rỗng, không chia cho 0;
  - tải lần đầu hiện skeleton; lỗi lần đầu hiện `StatusBanner` danger kèm "Thử lại"; `401` → đăng nhập (mẫu `EventOverviewLive`);
  - `useLiveResource` với `checkinEventQueryKey`, `fetchCheckinEvent`, đường live mới, polling 10 giây khi chưa kết nối.
- **Web, Màn quét:**
  - dùng `useLiveResource` thay `useQuery` (cùng key), polling 10 giây;
  - khi đã hiện màn hết quyền (403 lúc tải lại, khi quét, tra tay hay check-in tay) thì đóng stream và thôi polling. Để làm việc này, `useLiveResource` thêm tùy chọn `enabled` (mặc định `true`; `false` thì không SSE, không polling, không tải lại theo lời nhắc);
  - giữ việc tải lại số khi đóng overlay xanh.

**Never:**
- Không đổi `ticketing.checkIn`, payload hay chỗ phát `event_checkins_changed`. Không thêm topic.
- Không thêm route phía BTC (`/v1/orgs/:orgId/events/…`): số 28 ở `isolation.test.ts` giữ nguyên.
- Server không kiểm lại quyền trên stream đang mở: thu hồi hay hết giờ không đóng stream. Stream chỉ mang `{type}`, lần tải lại kế tiếp nhận 403, và web tự đóng stream.
- Màn quét không hiện số theo Hạng vé; vẫn chỉ hiện tổng ở đỉnh như 5.3. Không thêm `aria-live` cho số này, vì nó đổi liên tục.
- Không làm `stat-card` check-in trên Tổng quan (việc của 6.2).
- Không làm E3-4: việc này vẫn thuộc action item E3-4.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Quét ở cổng khác | Màn quét của CTV A đang mở; CTV B quét xanh | Số ở đỉnh màn của A tăng trong ~1 giây | N/A |
| Tab của Owner | Owner mở tab Check-in; CTV quét hoặc check-in tay | Tổng và hàng của đúng Hạng vé tăng trong ~1 giây | N/A |
| Sự kiện khác | Check-in ở Sự kiện khác (cùng hoặc khác BTC) | Stream không nhận tín hiệu | N/A |
| SSE lỗi | Stream `503` hoặc bị đóng | Polling 10 giây; tab hiện lại thì tải ngay | Nhãn "Cập nhật lúc…" khi số đã cũ |
| Thu hồi khi đang mở | CTV bị thu hồi, sau đó có tín hiệu | Tải lại nhận `403 CHECKER_REVOKED` → màn hết quyền, stream đóng, thôi polling | N/A |
| CTV quá hạn | CTV `active` mở stream sau `effective_end_at` | `403 EVENT_ENDED`, không mở stream | Màn hết quyền (5.6) |
| Chưa có Vé | Sự kiện chưa có Vé `valid` | "0/0", thanh rỗng | N/A |

</frozen-after-approval>

## Code Map

**API**
- `packages/contracts/src/realtime.ts:30` (`EVENT_CHECKINS_CHANGED` đã có), `packages/contracts/src/checkin.ts:138` (`checkinEventApiPath`; thêm `checkinEventLiveApiPath` cạnh nó), `:178-184` (`CheckinEvent`). Test: `packages/contracts/test/checkin.test.ts:101-146`.
- `apps/api/src/modules/ticketing/check-in.ts`:
  - `:94-96` đã `notify` trong tx của bên gọi; không đổi;
  - `:180` `checkinCountsOf`, nơi gọi duy nhất là controller. Thay bằng bản nhóm theo `ticket_type_id` (cột ở `ticketing/schema.ts:47`, index `:74`); export qua `ticketing/index.ts:6`.
- `apps/api/src/modules/event/ticket-type.service.ts:62` `ticketTypesOf` (export ở `event/index.ts:56`); `checkin → event` hợp lệ (`apps/api/module-graph.cjs`).
- `apps/api/src/modules/checkin/checkin-event.controller.ts`:
  - `get()` ghép các nhóm với `ticketTypesOf`; Hạng vé không có nhóm nào thì 0/0;
  - thêm `@Get('live')`, inject `RealtimeHub` (`platform/realtime/realtime-hub.ts:127` `open(req, res, filter)`, module `@Global()`);
  - mẫu: `modules/reporting/event-overview.controller.ts:28-47` (guard đã chuẩn hóa `eventId` về chữ thường, `permission.guard.ts:118`).
- Guard: `platform/access/permission.guard.ts:108-138` (`eventRoute`). Owner/Admin vẫn qua sau khi Sự kiện kết thúc.
- Test:
  - mới `apps/api/test/checkin/checkin-live.test.ts`:
    - `test/platform/sse-client.ts` (`listen` :15, `openSse` :57, `waitForMessages`);
    - mẫu đo dưới 1 giây và 404 không treo: `test/reporting/event-overview.test.ts:296-328`;
    - fixtures CTV: `checkerOf`/`freeEvent` ở `test/checkin/scan.test.ts:114-117`, `setChecker` ở `checkin-access.test.ts:91`; check-in tay ở `test/checkin/lookup.test.ts`;
  - `test/organizer/isolation.test.ts:338-373`: route CTV `/live` tự vào vòng 403 (`NOT_A_MEMBER`, `CHECKER_REVOKED`), rồi `isStreamRoute` bỏ qua ca đối chứng; không cần sửa;
  - dạng `CheckinEvent` cũ ở `checkin-access.test.ts:131` (`NO_TICKETS`) và `scan.test.ts:761` phải thêm `ticketTypes`.

**Web**
- `apps/web/lib/realtime/use-live-resource.ts:23` (options), `:61` (hook), `:124-170` (effect SSE): thêm `enabled`. Test helper thuần: `test/live-resource.test.ts`.
- Mẫu caller: `app/(dashboard)/btc/[orgId]/su-kien/[eventId]/event-overview.tsx:200-260` (`EventOverviewLive`: 401, toast offline, `stale`, banner lỗi); `updatedAtLabel` ở `lib/reporting/overview.ts:75`; poll 10 giây ở `:19-22`.
- `lib/checkin/api.ts:97` `checkinEventQueryKey`, `:124` `fetchCheckinEvent`. Câu chữ và hàm thuần đặt trong module mới `lib/checkin/progress-view.ts` (mẫu `checker-view.ts`, test ở `test/checker-view.test.ts`).
- `components/tickee/stat-card.tsx:22`: caption là `<p>`, nên thêm slot tùy chọn (vd. `meter`) giữa giá trị và caption để đặt thanh; caller cũ không đổi. Chưa có component progress nào (không có `role="progressbar"` trong repo). Thêm `components/tickee/progress-bar.tsx`: thanh cao 8px, bo tròn hết, theo mock `mockups/key-dashboard-event.html:120-121,178`. Token: `--stage-line`, `--muted` (= `surface-sunken`) trong `app/globals.css`; spec màu ở `DESIGN.md:350-353,690,700`.
- `checkin-tab.tsx:265` `CheckinTab`: thêm section đầu. Card dùng class `rounded-lg bg-card p-card-padding shadow-card` (:246).
- `app/(checkin)/events/[eventId]/checkin-event-screen.tsx`:
  - `:302` `useQuery` → `useLiveResource`;
  - `scanNoAccessError` và `eventNoAccess` (:450-461) cho `enabled=false`;
  - `closeResult` :412-417 giữ nguyên;
  - header ở `components/tickee/scanner-viewport.tsx:71-78`.
- e2e:
  - `e2e/live-mock.ts` (`fakeEventSource` có `url`, `all()` để kiểm stream đã đóng `readyState 2`; `setVisibility`);
  - `e2e/organizer-mock.ts:170`: thêm mặc định cho `GET /v1/checkin/events/:id` và `…/live` (503, như `OVERVIEW_LIVE_KEY` :34/:100);
  - `e2e/checkin-mock.ts:51` (`checkinEvent` thêm `ticketTypes`), `:78`: live mặc định 503;
  - mẫu test live: `e2e/event-overview.spec.ts:283-341`;
  - thứ tự section ở `e2e/checkin-invite.spec.ts:385-388`;
  - số ở đỉnh Màn quét: `e2e/checkin-scan.spec.ts:~220-244`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/checkin.ts` (+ test) -- `CheckinTicketTypeProgress`, `CheckinEvent.ticketTypes`, `checkinEventLiveApiPath` -- hợp đồng chung.
- [x] `apps/api/src/modules/ticketing/check-in.ts`, `ticketing/index.ts` -- đếm theo Hạng vé, một câu -- tổng khớp các thanh.
- [x] `apps/api/src/modules/checkin/checkin-event.controller.ts` -- ghép `ticketTypesOf`; route `live` -- FR-30, AD-17.
- [x] `apps/api/test/checkin/checkin-live.test.ts` (mới), `checkin-access.test.ts`, `scan.test.ts` -- thứ tự và 0/0 của Hạng vé; Vé hủy không tính; Owner, Admin và CTV được giao nhận tín hiệu dưới 1 giây sau khi quét và sau check-in tay; Sự kiện khác và BTC khác không lọt; CTV quá hạn `403 EVENT_ENDED`; dữ liệu chỉ `{type}`.
- [x] `apps/web/lib/realtime/use-live-resource.ts` -- `enabled` -- đóng stream khi hết quyền.
- [x] `apps/web/lib/checkin/progress-view.ts` (+ `test/checkin-progress-view.test.ts`) -- nhãn "k/N", tỉ lệ (N = 0 → 0), caption, hằng polling.
- [x] `apps/web/components/tickee/progress-bar.tsx` (mới), `stat-card.tsx` -- thanh có ARIA, slot thanh trong `StatCard`.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checkin-progress.tsx` (mới), `checkin-tab.tsx` -- khối `checkin-progress` + `useLiveResource`.
- [x] `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx` -- Màn quét tự cập nhật; `enabled=false` khi hết quyền.
- [x] `apps/web/e2e/organizer-mock.ts`, `checkin-mock.ts`, `checkin-invite.spec.ts`, `checkin-scan.spec.ts` -- phủ các dòng Matrix phía web: tín hiệu → số đổi, 503 → polling 10 giây, tab hiện lại → tải ngay, 403 sau tín hiệu → stream đóng, 0/0.

**Acceptance Criteria:**
- Given tab Check-in ở màn 320px và tên Hạng vé dài, then hàng xuống dòng, không cuộn ngang, và "k/N" không bị đẩy ra ngoài.
- Given trình đọc màn hình, when tới một thanh, then đọc được tên Hạng vé và giá trị k trên N.
- Given hai CTV mở Màn quét của cùng Sự kiện trên hai máy, when một người quét xanh, then máy kia đổi số trong ~1 giây mà không cần tải lại (kiểm thủ công).

## Implementation Notes

- **Đã làm (25/11/2026):** đủ 10 task.
  - API:
    - `checkinCountsOf` đổi thành `checkinCountsByTicketType` (một câu `GROUP BY ticket_type_id`);
    - `CheckinEventController.get()` ghép với `ticketTypesOf`, tổng là tổng các nhóm; `@Get('live')` lọc `event_checkins_changed` theo `eventId` + `organizationId` của ctx.
  - Web:
    - `useLiveResource` thêm `enabled` (qua `effectivePollInterval` và `signalReload` ở `live-signal.ts`). Không tắt chính truy vấn, nên lần mount lại vẫn tải một lần;
    - khối mới ở `checkin-progress.tsx`, câu chữ và hàm thuần ở `lib/checkin/progress-view.ts`, thanh ở `components/tickee/progress-bar.tsx` (tone `stage`/`card`), `StatCard` thêm slot `meter`;
    - Màn quét đặt `enabled=false` qua state `liveStopped` khi màn hết quyền hiện.
- **Chọn khi spec chưa nói rõ:**
  - "Cập nhật lúc HH:MM:SS" theo đúng câu chữ của spec, nên có giây; Tổng quan (`updatedAtLabel`) chỉ có HH:MM;
  - tab không có toast offline (Tổng quan có); chỉ đổi caption;
  - Sự kiện chưa có Hạng vé nào (nháp): ẩn `card` Hạng vé, vẫn hiện tổng 0/0;
  - nhãn truy cập của thanh tổng: "Tổng đã check-in"; mỗi thanh đọc "k trên N Vé đã check-in" (`aria-valuetext`).
- **Ngoài danh sách file của spec:**
  - `e2e/checkin-mock.ts` thêm `hasCheckinMock`; `organizer-mock.ts` nhường mọi `/v1/checkin/**` cho API CTV giả khi trang có nó, vì `dashboard-shell.spec.ts` cài `mockCheckinApi` trước `mockOrganizerApi` (4 ca fail trước khi sửa);
  - `e2e/checker-invite-accept.spec.ts` ("tải lại sau khi đã hiện"): đổi sang `setVisibility`, vì `useLiveResource` nghe `visibilitychange` trên `document` và tắt focus refetch của TanStack.
- **Verification (25/11/2026, phiên chính chạy lại):** contracts 367, API (`test/checkin test/ticketing isolation realtime`) 224/224, web unit 478/478, `typecheck`, `lint:deps` pass. Subagent đã chạy toàn bộ e2e web ở hai project (1336 pass, 4 fail ở `dashboard-shell.spec.ts`, đã sửa như trên), rồi 5 file của spec + `dashboard-shell.spec.ts`: 312/312. Phiên chính build web và chạy lại 6 file đó: 312/312.
  - Chưa làm: kiểm thủ công hai điện thoại.
- **Sau review lượt 1 (P1–P6):**
  - P1: ca "mất quyền giữa chừng: POST scans → 403 CHECKER_REVOKED" của `checkin-scan.spec.ts` cài `fakeEventSource`, kiểm stream đóng (`readyState 2`), hiện lại tab không tải lại và không mở stream mới. Subagent đã thử bỏ nhánh `scanNoAccessError` thì ca này fail ở cả hai project;
  - P2: tổng của `CheckinEvent` cộng từ các hàng Hạng vé đã ghép, không cộng từ `groups`;
  - P3: bỏ `expect(liveLoads(calls)).toBe(0)` (không bao giờ fail khi có `fakeEventSource`);
  - P4: `progressRatio` chuyển sang `apps/web/lib/progress.ts` (module chung), `progress-bar.tsx` và test import từ đó;
  - P5: sửa hai comment cũ ở `checkin-event-screen.tsx` (chỉ mount lại mới bật lại tự cập nhật; tải lại không còn phụ thuộc `staleTime`);
  - P6: bỏ hai dòng kiểm `checkinEventLiveApiPath` trùng ở ca đường dẫn của 5.2.
  - Verification sau review (25/11/2026, phiên chính): contracts 367, API 224/224, web unit 478/478, `typecheck`, `lint:deps` pass; build web + e2e 6 file (5 file của spec + `dashboard-shell.spec.ts`): 312/312 ở hai project.
  - Mục hoãn mới trong `deferred-work.md`: phát `event_checkins_changed` khi hủy Sự kiện (7.1) và khi vô hiệu Vé (7.5); mẫu số N khi có Vé mới (chưa có đích); đo tải `GET` khi cổng đông (9.2).

## Spec Change Log

## Review Triage Log

Lượt 1 (25/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Màn quét: nhánh `scanNoAccessError` (403 khi quét, tra tay, check-in tay) đóng stream và thôi polling không có test; bỏ nhánh này thì mọi test vẫn pass | medium | Lớp VG đã kiểm: chỉ `checkin-scan.spec.ts` ca "403 … khi tải lại sau tín hiệu" kiểm stream đóng, và ca đó đi nhánh `eventNoAccess`; các ca 403 khi quét/tra tay không cài `fakeEventSource`, không đếm lần tải | patch (P1) |
| BH1 | Mẫu số N cũ khi SSE đang nối: Vé mới phát, Vé hủy/vô hiệu, Hạng vé đổi tên không phát `event_checkins_changed`, mà đang nối thì không polling | low | Đúng: chỉ `ticketing/check-in.ts` phát topic này. Số đã check-in luôn mới; N tự đúng lại ở lần check-in, lần hiện tab hay nối lại kế tiếp. Sửa phải lọc thêm topic hoặc phát thêm topic, mà phần đóng băng của spec chốt bộ lọc chỉ `event_checkins_changed` và không thêm topic | defer (7.1, 7.5, mục Vé mới chờ Mason chọn đích) |
| BH2 | Tổng cộng từ `groups` còn hàng lấy từ `types`, hai câu chạy song song trên hai kết nối: nhóm của Hạng vé vừa tạo giữa hai câu có trong tổng mà không có hàng | low | Đúng ở `checkin-event.controller.ts` (`Promise.all`, cộng `groups`). Cửa sổ mili giây và tự đúng ở lần tải sau, nhưng sửa là đổi chỗ cộng (cộng từ hàng đã ghép) | patch (P2) |
| BH3 | `ticketTypes` bắt buộc: web mới gặp api cũ khi rolling deploy thì Màn quét không parse được | low | Chưa có môi trường triển khai (9.1). Các story trước cũng thêm trường bắt buộc vào contract (vd. 5.3 thêm `checkedInCount`) | reject |
| BH4 | `expect(liveLoads(calls)).toBe(0)` trong ca 403 của `checkin-scan.spec.ts` không bao giờ fail, vì `fakeEventSource` thay `EventSource` nên `/live` không qua `page.route` | low | Đúng: `live-mock.ts` thay `window.EventSource`. Ca đó đã kiểm `sse.count()` không đổi | patch (P3) |
| BH5 | Test polling dùng giờ thật (`waitForTimeout` 6–11 giây, `Date.now()`), chậm và dễ chập chờn | low | Theo đúng mẫu đang chạy ổn ở `event-overview.spec.ts` (ca 503 → polling 10 giây dùng `test.setTimeout(45_000)` + `Date.now()`); 312/312 pass ở cả hai project | reject |
| BH6 | Tên `enabled` dễ lẫn với `enabled` của TanStack (ở đây truy vấn vẫn chạy) | false | Tên do phần đóng băng của spec chốt; JSDoc của tùy chọn nói rõ "Không tắt chính truy vấn" | reject |
| BH7 | `components/tickee/progress-bar.tsx` (component chung) import `progressRatio` từ module tính năng `lib/checkin/progress-view` | low | Đúng; 6.2 sẽ dùng lại thanh trên Tổng quan và kéo theo module check-in. Sửa là chuyển hàm sang module chung | patch (P4) |
| BH8 | `aria-valuenow` không kẹp như phần đầy; `{...props}` trải sau `aria-*` nên caller ghi đè được | false | k ≤ N theo cách đếm (đã check-in là tập con của Vé `valid`), schema chặn số âm/không nguyên; không caller nào truyền `aria-*` | reject |
| BH9 | Chép từ Tổng quan (chuyển đăng nhập khi 401, công thức `stale`, hằng 10 giây); `vnTimeWithSeconds` nên ở contracts | low | Đúng là lặp, nhưng mỗi khối live trong repo tự giữ phần này (mẫu `EventOverviewLive`); gom lại là refactor, không có hại cụ thể | reject |
| BH10 | Comment cũ ở `checkin-event-screen.tsx`: "quay lại tab sau `staleTime`" không còn đúng; comment của `liveStopped` nói tự cập nhật bật lại khi lần tải sau thành công, nhưng trong cùng instance không xảy ra | low | Đúng: `useLiveResource` tải lại mỗi lần hiện tab; `scanNoAccessError` không bao giờ xóa, chỉ mount lại mới bật lại | patch (P5) |
| BH11a | Không test `enabled` ở mức hook (đóng/mở lại SSE, bật lại) | low | Nhánh bật lại không có caller nào dùng trong một instance; nhánh tắt có e2e. Test hook cần môi trường DOM mà bộ unit web (node) chưa có | reject |
| BH11b | `checkinEventLiveApiPath` được kiểm hai lần trong `packages/contracts/test/checkin.test.ts` | low | Đúng (:116-117 và :403-404). Sửa là xóa hai dòng thêm vào ca của 5.2 | patch (P6) |
| BH12 | Mỗi check-in làm mọi client tải lại `CheckinEvent` (3 câu, có `GROUP BY` trên mọi Vé của Sự kiện); Màn quét trả phí số theo Hạng vé mà không hiện | maybe-false | Chưa đo. Nếu đúng ở cổng đông thì là medium. Cần đo trong kiểm thử tải (p95 GET và tải DB với 20 CTV + vài tab) | defer (9.2) |
| BH13a | `/live` cho CTV mở mà hub không giới hạn số stream mỗi người | false | Mọi tài khoản đã đăng nhập vốn mở được stream (Vé của tôi); CTV còn phải được BTC mời. Route mới không nới thêm ai | reject |
| BH13b | Caption "Cập nhật liên tục" vẫn hiện khi SSE rớt và đang polling 10 giây | false | Spec (phần đóng băng) chốt caption chỉ đổi khi offline hoặc lần tải lại lỗi, như Tổng quan; polling giữ số cũ tối đa 10 giây | reject |
| BH13c | Màn quét không có dấu hiệu số đã cũ khi tải lại nền lỗi | low | Spec giữ Màn quét chỉ hiện tổng; mất mạng đã có `offline-banner` (5.4). Thêm dấu hiệu là thêm UI ngoài spec | reject |
| EC1 | Như BH1 (Đơn trả tiền, Vé hủy/vô hiệu, đổi tên Hạng vé không phát tín hiệu) | low | Trùng BH1 | defer (gộp BH1) |
| EC2 | Như BH2 | low | Trùng BH2 | patch (gộp P2) |
| EC3 | N = 0 → `aria-valuemax=0` bằng `aria-valuemin`, công nghệ hỗ trợ tính phần trăm chia cho 0 | low | Thanh có `aria-valuetext` ("0 trên 0 Vé đã check-in") nên trình đọc đọc câu này; ARIA cho phép min = max; spec chốt `aria-valuemax=N` | reject |
| EC4 | Như BH3 | low | Trùng BH3 | reject (gộp BH3) |
| EC5 | Tab dashboard: tải lại cứ trả 403 mà `enabled` không tắt, nên polling và mở lại SSE cứ gọi 403 | false | Owner/Admin chỉ nhận 403 `NOT_A_MEMBER` (bị xóa khỏi BTC), mà `DashboardShell` xử lý bằng `Dialog` (`handledElsewhere`); `CHECKER_REVOKED`/`EVENT_ENDED` không áp cho Owner/Admin | reject |

## Design Notes

- **Một stream cho cả ba vai:** guard nhánh Sự kiện đã xử lý Owner/Admin lẫn CTV, kể cả `EVENT_ENDED` từ 5.6. Tab dashboard dùng chung `CheckinEvent`, nên chỉ cần một tài nguyên REST và một stream, không thêm route phía BTC. Stream Tổng quan đòi `orders.view` mà CTV không có (AD-17).
- **Tải:** mỗi check-in làm mỗi client đang mở tải lại `GET` một lần (gom 1 giây), tức không quá 1 `GET`/giây cho mỗi client. Đo trong 9.2 cùng mục `NOTIFY` của retro Epic 3.
- **Số kết nối:** dashboard vẫn tối đa hai stream (cấp BTC + tab đang mở), vì tab không active bị unmount (`event-tabs.tsx:121`).

## Verification

**Commands:**
- `pnpm --filter @tickee/contracts test` -- expected: pass.
- `pnpm --filter @tickee/api exec vitest run test/checkin test/ticketing test/organizer/isolation.test.ts test/platform/realtime.test.ts` -- expected: pass (cần Postgres từ docker compose).
- `pnpm --filter @tickee/web test` -- expected: pass.
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
- `sh scripts/dev-env.sh pnpm turbo build --filter=@tickee/web && pnpm --filter @tickee/web exec playwright test e2e/checkin-invite.spec.ts e2e/checkin-scan.spec.ts e2e/checkin-lookup.spec.ts e2e/checker-invite-accept.spec.ts e2e/event-overview.spec.ts` -- expected: pass ở cả hai project.

**Manual checks:**
- Hai điện thoại thật mở Màn quét của cùng Sự kiện, cùng một tab Check-in trên máy tính: quét ở một máy, hai màn kia đổi số trong khoảng 1 giây.
