---
title: 'Story 5.6: Thu hồi, khôi phục CTV và hết quyền'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '20662d4b731285c2716a8286120119bed8390a1f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Owner/Admin chưa thấy CTV nào đã nhận lời mời, và chưa thu hồi hay khôi phục được CTV. Bảng `checkers` đã có `status`/`revoked_*` nhưng chưa code nào ghi. CTV đã quá `effective_end_at` vẫn qua guard, nên vẫn mở Màn quét và tra tay được. Thiếu FR-26, UX-DR33, UX-DR39, AD-14, AD-30.

**Approach:**
- API: ba route phía BTC dưới `/v1/orgs/:orgId/events/:eventId/checkers`, gồm danh sách, thu hồi, khôi phục, cùng quyền `CHECKERS_MANAGE`.
- Guard route CTV trả `403 EVENT_ENDED` khi Sự kiện đã kết thúc.
- Web: thêm khối danh sách CTV ở tab Check-in. Màn quét hiện màn hết quyền khi gặp `EVENT_ENDED`.

**Quyết định (Mason, 25/11/2026):**
- **Giữ một spec**, không tách API/web (khoảng 3.900 token, Mason chấp nhận rủi ro).
- **Sau khi Sự kiện kết thúc:**
  - chặn "Khôi phục": nút tắt kèm lý do "Sự kiện đã kết thúc", API trả `409 EVENT_ALREADY_ENDED`, giống "Tạo link mới";
  - "Thu hồi" vẫn bấm được.

## Boundaries & Constraints

**Always:**
- **Danh sách** (`GET …/checkers`, `no-store`):
  - trả `{checkers: [{id, name, email, acceptedAt, status, revokedAt}]}`;
  - sắp theo `acceptedAt` tăng dần, để hàng không nhảy chỗ khi đổi trạng thái;
  - `name`/`email` đọc qua `identity.userContacts`, nên route nằm ở `flows`. Tài khoản không còn thì cả hai là `null`;
  - Sự kiện kiểm trước, qua `orgScope`: Sự kiện lạ hoặc của BTC khác → `404 EVENT_NOT_FOUND`.
- **Thu hồi / khôi phục:**
  - route: `POST …/checkers/:checkerId/revoke` và `POST …/checkers/:checkerId/restore`, không body, trả `204`;
  - thứ tự: khóa Sự kiện trước (`lockEventForCheckerInvite`, lỗi `404 EVENT_NOT_FOUND`), rồi UPDATE có điều kiện trên `status` trong `orgScope` và `event_id`. `checkerId` sai dạng hoặc không thuộc Sự kiện → `404 NOT_FOUND`;
  - thu hồi ghi `status='revoked'`, `revoked_by` = người bấm, `revoked_at=now()`. Khôi phục ghi `status='active'` và xóa `revoked_*`;
  - khôi phục khi Sự kiện đã kết thúc (`ended` của Sự kiện vừa khóa) → `409 EVENT_ALREADY_ENDED`. Thu hồi không bị chặn theo thời gian;
  - đã ở trạng thái đích → `204`, không ghi gì, không audit;
  - audit trong cùng transaction: `checker.revoked` / `checker.restored`, target `{type:'checker', id}`, `changedFields: ['status']`.
- **CHECK mới (migration `0037`):** `status='active'` thì `revoked_at` và `revoked_by` đều `NULL`; `status='revoked'` thì cả hai đều có giá trị. Đây là mục hoãn của 5.2-a.
- **Hết quyền theo thời gian (AD-14):**
  - cổng `CheckerAccessResolver` trả thêm `ended`, dùng cùng luật `checkinEnded`: đã bấm "Kết thúc", hoặc `now()` của DB ≥ `effective_end_at`;
  - guard `eventRoute` xử lý CTV theo thứ tự: `revoked` → `403 CHECKER_REVOKED`; `active` mà `ended` → `403 EVENT_ENDED` (mã mới, `DEFAULT_STATUS` 403, câu "Bạn không còn quyền soát vé cho Sự kiện này.");
  - Owner/Admin giữ nguyên: Màn quét vẫn mở, quét vẫn ra overlay đỏ `EVENT_ENDED`;
  - quyền đọc lại ở mỗi request, không cache.
- **Web, khối "CTV soát vé"** (`data-slot="checker-list"`, đặt sau `CheckerInviteBlock`, theo mẫu `MemberRow`):
  - mỗi hàng có:
    - tên (không có tên thì hiện email);
    - email ở dòng `text-meta`;
    - "Nhận lúc {formatVnDateTime}";
    - `StatusBadge`: "Đang hoạt động" (success) hoặc "Đã thu hồi" (neutral);
    - nút "Thu hồi" (`destructive`, `size="sm"`) hoặc "Khôi phục" (`secondary`, `size="sm"`);
    - Sự kiện đã kết thúc: "Khôi phục" tắt kèm lý do "Sự kiện đã kết thúc" (`ActionWithReason`, cùng nguồn "đã kết thúc" với nút "Tạo link mới");
  - chưa có CTV: "Chưa có CTV nào nhận lời mời.";
  - lỗi tải: dải lỗi kèm "Thử lại".
- **Web, hộp xác nhận** (`ConfirmDialog`):
  - Thu hồi:
    - hộp: tiêu đề "Thu hồi quyền soát vé của {tên}?", nút xác nhận `destructive` "Thu hồi";
    - mô tả: "{tên} không quét hay tra tay được nữa, có hiệu lực từ lượt quét kế tiếp. Link mời không cho người này nhận lại; bạn có thể khôi phục sau.";
    - toast sau khi xong: "Đã thu hồi quyền soát vé của {tên}.";
  - Khôi phục:
    - hộp: tiêu đề "Khôi phục quyền soát vé cho {tên}?", nút xác nhận `primary-on-light` "Khôi phục";
    - mô tả: "{tên} quét và tra tay lại được cho Sự kiện này tới khi Sự kiện kết thúc.";
    - toast sau khi xong: "Đã khôi phục quyền soát vé cho {tên}.";
  - mutation theo mẫu `RemoveDialog`:
    - handler đặt trên `useMutation`;
    - `404` → đóng, toast, tải lại danh sách;
    - `409 EVENT_ALREADY_ENDED` → đóng, toast, tải lại Sự kiện và danh sách (mẫu `isStale`);
    - `401` → đăng nhập;
    - lỗi khác hiện trong Dialog.
- **Web, Màn quét:** `EVENT_ENDED` vào nhóm mã hết quyền cùng `CHECKER_REVOKED` (lúc tải, khi quét, tra tay, check-in tay). Màn hết quyền có tiêu đề "Bạn không còn quyền soát vé cho Sự kiện này.", thêm dòng "Sự kiện đã kết thúc." khi mã là `EVENT_ENDED`. Câu chữ đặt trong một module thuần.

**Never:**
- Không đổi `joinChecker` hay luồng nhận lời mời: CTV bị thu hồi vẫn nhận `CHECKER_REVOKED` khi mở link.
- Không đổi `ticketing.checkIn`, `assertCheckinOpen`, `ScanInvalidReason`, hay unique `(event_id, user_id)`.
- Không đẩy realtime khi thu hồi. Màn quét đang mở chỉ đổi ở lượt request kế tiếp. SSE thuộc 5.7.
- Không xử lý Sự kiện đã hủy cho route CTV (mục hoãn giao 7.1). Không ẩn danh CTV đã xóa tài khoản (7.6).
- Không thêm `Idempotency-Key`, vì thu hồi/khôi phục vốn đã lặp lại an toàn theo trạng thái đích.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thu hồi | CTV `active`, Admin bấm | `204`; dòng `revoked` + `revoked_by/at`; 1 audit | N/A |
| Quét sau thu hồi | CTV vừa bị thu hồi quét hoặc tra tay | `403 CHECKER_REVOKED` | Màn hết quyền, không có dòng "Sự kiện đã kết thúc." |
| Thu hồi lặp | Dòng đã `revoked` (hai Admin bấm cùng lúc) | `204`, không thêm audit, `revoked_by` giữ người đầu | N/A |
| Khôi phục | CTV `revoked`, Sự kiện chưa kết thúc | `204`; `active`, `revoked_*` = NULL; quét lại được | N/A |
| Khôi phục sau khi kết thúc | CTV `revoked`, Sự kiện đã kết thúc | `409 EVENT_ALREADY_ENDED`, không ghi gì | Web: nút đã tắt kèm lý do; nếu tới API thì toast + tải lại |
| CTV quá hạn | CTV `active`, `now() ≥ effective_end_at` hoặc đã bấm "Kết thúc" | `403 EVENT_ENDED` ở GET Sự kiện, quét, tra tay, check-in tay | Màn hết quyền + "Sự kiện đã kết thúc." |
| Owner quá hạn | Owner quét Sự kiện đã kết thúc | `200 invalid EVENT_ENDED` như trước | Overlay đỏ |
| CTV của Sự kiện khác | `checkerId` của Sự kiện khác cùng BTC | `404 NOT_FOUND` | Toast, tải lại danh sách |
| Tài khoản không còn | `userContacts` không có id | Hàng có `name/email = null`; web hiện "Tài khoản đã xóa" | N/A |

</frozen-after-approval>

## Code Map

**API**
- `apps/api/src/modules/checkin/schema.ts:46-64` (`checkers`), `drizzle/0034_checkers.sql`:
  - CHECK mới viết trong schema rồi `pnpm db:generate` → `0037_*` (+ snapshot, journal);
  - mẫu CHECK cặp cột: `0023_payment_service_status.sql:6`;
  - `platform/db/grants.ts:93` đã cho UPDATE `status`/`revoked_*`.
- `modules/checkin/checkers.ts`: thêm hàm revoke/restore. Giữ `checkerStatusOf`, `joinChecker` (:62, :81). Thêm controller mới trong `checkin.module.ts` theo mẫu `checker-invite.controller.ts` (`@RequirePermission(CHECKERS_MANAGE)`, `no-store`); export qua `index.ts`.
- `modules/event/checkin-gate.ts`:
  - `checkinEnded` (:33, chưa export) là luật duy nhất cho `ended`: thêm vào cột của `checkinEventById` (:81), không chép SQL;
  - `lockEventForCheckerInvite` (:46) trả `ended`, dùng lại cho thu hồi/khôi phục;
  - `checkinEventOf` (:63) dùng cho danh sách.
- `platform/access/access-resolver.ts:23-30` (cổng, thêm `ended`), `modules/checkin/checker-access-resolver.impl.ts`, `platform/access/permission.guard.ts:105-134` (`eventRoute`).
- `packages/contracts/src/errors.ts` (`EVENT_ENDED`), `apps/api/src/platform/http/app-error.ts:3` (`DEFAULT_STATUS` exhaustive).
- `packages/contracts/src/checkin.ts` (cạnh `checkerInviteApiPath`, :40-50): path và schema `CheckerListItem`/`CheckerList`. Quyền đã có: `organizer.ts:28-51` (`CHECKERS_MANAGE` cho Owner, Admin).
- Danh sách:
  - code ở `flows/checkers.flow.ts` + `flows/checkers.controller.ts`, đăng ký ở `flows/flows.module.ts`;
  - mẫu dùng `userContacts`: `flows/checkin-scan.flow.ts:10`, `organizer/members.service.ts:86`;
  - lý do phải ở `flows`: `apps/api/module-graph.cjs:14` chỉ cho `checkin` gọi `ticketing` và `event`.
- `platform/audit/audit.ts:6` (union, cạnh `checker.joined` :189); mẫu ghi: `flows/checker-invite.flow.ts:88-93`.
- Mẫu xóa thành viên: `organizer/members.service.ts:196-212` (`.returning()`, 404 `memberNotFound`).
- Test:
  - `test/organizer/isolation.test.ts`:
    - thêm 3 route vào `expect(guarded)` và `permissionOf` (:158-181);
    - đổi số route ở :390 (25 → 28);
    - thêm `revoke|restore` vào regex `hasBody`;
    - dòng CTV chèn bằng SQL ở :328-368 phải hợp CHECK mới;
  - fixtures:
    - `checkerOf`, `freeEvent`: `test/checkin/scan.test.ts:114-117`;
    - `setChecker`: `checkin-access.test.ts:91`;
  - mọi chỗ thu hồi bằng SQL (vd. `checker-accept.test.ts:147`) phải ghi thêm `revoked_by/at`.

**Web**
- `app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checkin-tab.tsx`:
  - `CheckinTab` (:277): thêm section thứ ba sau `CheckerInviteBlock` (:75). Giữ thứ tự và `data-slot` cũ;
  - mẫu lỗi: `isStale`/`ActionWithReason` (:46, :61).
- `lib/checkin/api.ts` (query key :28-61): hàm danh sách, thu hồi, khôi phục, `checkersQueryKey`. Câu chữ và hàm thuần đặt ở module mới `lib/checkin/checker-view.ts`, theo mẫu `lib/checkin/invite-view.ts` + `test/checker-invite-view.test.ts`.
- Mẫu hàng và Dialog:
  - `thanh-vien/members-manager.tsx`: `RemoveDialog` :149, `MemberRow` :410;
  - `components/tickee/confirm-dialog.tsx`;
  - `ResumeDialog` trong `suspended-payment-services.tsx:73` (xác nhận không phá hủy);
  - `formatVnDateTime` (`contracts/src/event.ts:392`).
- `app/(checkin)/events/[eventId]/checkin-event-screen.tsx`:
  - `NO_ACCESS_CODES` :45, `Screen` :61 (thêm dòng mô tả), `handleAccessError` :373, render :437-440;
  - tra tay đi qua `isScreenHandledError` → `manual-lookup.tsx:176/198`;
  - không đổi câu `CHECKER_REVOKED` (e2e đang kiểm).
- e2e:
  - `e2e/checkin-invite.spec.ts` (`openApi` :70, `mockOrganizerApi` ở `organizer-mock.ts:167`);
  - `e2e/checkin-mock.ts` (`checkerRevoked`, `checkinError`);
  - ca 403 lúc tải: `checker-invite-accept.spec.ts:378-410`;
  - ca thu hồi khi quét/tra: `checkin-scan.spec.ts:576-613`, `checkin-lookup.spec.ts:597-608`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/checkin.ts`, `errors.ts` (+ test) -- path, `CheckerListItem`/`CheckerList`, `EVENT_ENDED` -- hợp đồng chung.
- [x] `apps/api/src/modules/checkin/schema.ts`, `drizzle/0037_*` -- CHECK `status` ↔ `revoked_*`. Làm mục hoãn "Bảng `checkers` không có CHECK ràng `status` với `revoked_at`/`revoked_by`" (5.2-a BH4): khôi phục xóa `revoked_*`, lịch sử nằm ở audit.
- [x] `modules/event/checkin-gate.ts`, `platform/access/*`, `checker-access-resolver.impl.ts`, `app-error.ts` -- `ended` trên cổng, `403 EVENT_ENDED` cho CTV -- AD-14.
- [x] `modules/checkin/checkers.ts`, controller mới, `checkin.module.ts`, `index.ts`, `platform/audit/audit.ts` -- thu hồi/khôi phục + audit -- FR-26, AD-30.
- [x] `flows/checkers.flow.ts`, `flows/checkers.controller.ts`, `flows.module.ts` -- danh sách CTV.
- [x] `apps/api/test/checkin/checkers.test.ts` (mới), `isolation.test.ts`, các test chèn `revoked` -- phủ mọi dòng Matrix phía API, Admin thu hồi được, CHECK chặn dòng lệch, CTV quá hạn bị `403` ở cả 4 route CTV.
- [x] `apps/web/lib/checkin/api.ts`, `lib/checkin/checker-view.ts` (+ `test/checker-view.test.ts`) -- gọi API, câu chữ, nhãn, hậu quả.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checkin-tab.tsx` (khối mới có thể tách file `checker-list.tsx`) -- danh sách + hai Dialog.
- [x] `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx` -- `EVENT_ENDED` vào màn hết quyền, kèm dòng mô tả.
- [x] `apps/web/e2e/checkin-invite.spec.ts`, `checkin-mock.ts`, `checkin-scan.spec.ts`, `checkin-lookup.spec.ts`, `checker-invite-accept.spec.ts` -- phủ dòng Matrix phía web.

**Acceptance Criteria:**
- Given CTV bị thu hồi rồi được khôi phục, when quét lại, then lượt quét chạy như CTV mới (không cần link mới), và audit có đủ `checker.revoked`, `checker.restored`.
- Given tab Check-in ở màn 320px, then hàng CTV có email dài không cuộn ngang và nút "Thu hồi" không bị đẩy ra ngoài.
- Given Màn quét đang mở khi CTV bị thu hồi, when CTV quét hoặc tra tay lần kế tiếp, then hiện màn hết quyền và camera dừng.

## Implementation Notes

- **Đã làm (25/11/2026):** đủ 10 task.
  - API:
    - migration `0037_checkers_revoked_check.sql`;
    - thu hồi/khôi phục là `setCheckerStatus` trong `modules/checkin/checkers.ts`, nối qua `checkers.controller.ts`;
    - danh sách là `checkersOf` trong `checkin`, ghép tên/email ở `flows/checkers.flow.ts` + `flows/checkers.controller.ts`.
  - Web:
    - khối mới ở `checker-list.tsx`, câu chữ ở `lib/checkin/checker-view.ts`;
    - `ActionWithReason` tách sang `action-with-reason.tsx` để tab Check-in và danh sách CTV dùng chung.
- **Chọn khi spec chưa nói rõ:**
  - khôi phục khi Sự kiện đã kết thúc: kiểm mốc kết thúc trước `checkerId`, nên `checkerId` sai trên Sự kiện đã kết thúc ra `409`, không ra `404`;
  - hàng không có tên: email lên dòng chính, không lặp ở dòng `text-meta`;
  - tài khoản không còn: hàng hiện "Tài khoản đã xóa", Dialog gọi là "CTV này";
  - tên rỗng hoặc chỉ có khoảng trắng: api trả `name: null`, contract không nhận chuỗi rỗng;
  - web xử lý `NOT_FOUND` và `EVENT_NOT_FOUND` như nhau: đóng Dialog, toast, tải lại;
  - cột nút giới hạn `max-w-32`, để lý do "Sự kiện đã kết thúc" không bóp nội dung hàng.
- **Test cũ phải đổi:**
  - `scan.test.ts` ("Sự kiện đóng khi lần đầu còn chạy…") chạy bằng Admin, vì CTV gửi lại sau khi Sự kiện đóng giờ nhận `403` (Design Notes);
  - `checker-accept.test.ts`:
    - dòng `revoked` chèn bằng SQL có thêm `revoked_*`;
    - ca `paused` nhận một trong hai tên CHECK, vì Postgres chỉ báo ràng buộc đầu tiên.
- **DB test cục bộ:** `tickee_test` còn 18 dòng `revoked` thiếu `revoked_*` (do test nhận lời mời cũ chèn), làm migration `0037` lỗi. Đã điền giá trị giả cho các dòng này. CI dùng DB mới; DB dev `tickee` không có dòng `checkers` nào.
- **Verification (25/11/2026, phiên chính):**
  - contracts 364, web unit 469, `typecheck`, `lint:deps` pass;
  - API `test/checkin test/ticketing test/organizer/isolation.test.ts`: 208/208;
  - build web + e2e `checkin-invite`, `checkin-scan`, `checkin-lookup`, `checker-invite-accept`: 188/188 ở hai project.
  - Chưa làm: manual check trên điện thoại thật.
- **Sau review lượt 1 (P1–P3):**
  - P1: test mới trong `checkers.test.ts`: khôi phục phải chờ khóa Sự kiện khi "Kết thúc" đang chạy, rồi ra `409`, dòng không đổi, không audit;
  - P2: JSDoc của route CTV (api, web `api.ts`) và `ScanInvalidReason` nói rõ CTV nhận `403 EVENT_ENDED`;
  - P3: sửa comment ở `scan.test.ts`;
  - mục hoãn mới trong `deferred-work.md`: Sự kiện đã hủy (giao 7.1), unit test `dependency-rules` chập chờn (giao E2-8).
- **Verification sau review (25/11/2026, phiên chính):**
  - contracts 364, `typecheck`, `lint:deps` pass;
  - API: 209/209;
  - build web + e2e 4 file: 188/188 ở hai project;
  - web unit: 469/469 ở 2 trên 3 lần chạy. Lần còn lại, `dependency-rules.test.ts` quá hạn 5 giây trong lúc build web và e2e chạy nền; đã ghi mục hoãn, giao E2-8.

## Spec Change Log

## Review Triage Log

Lượt 1 (25/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Không test "Khôi phục" phải chờ khóa Sự kiện khi "Kết thúc" đang chạy | medium | Lớp VG đã kiểm: đổi `lockEventForCheckerInvite` thành đọc không khóa thì mọi test trong `checkers.test.ts` vẫn pass. Ca hai lần thu hồi song song pass nhờ UPDATE có điều kiện, không nhờ khóa | patch (P1) |
| VG-O1 | Sự kiện `cancelled` đã quá giờ kết thúc: "Khôi phục" ở web vẫn bật (`isEventEnded` bỏ qua `cancelled`), còn api trả `409`, nên bấm lần nào cũng 409 | low | Đúng, nhưng chưa route nào ghi `events.status='cancelled'` (chỉ có trong `event/schema.ts:36`), nên người dùng chưa gặp. Sửa phải chốt luật khôi phục cho Sự kiện đã hủy, việc của 7.1 | reject, để 7.1 xét (deferred-work) |
| BH1 | Như VG-O1, thêm: câu "cùng nguồn với Tạo link mới" không đúng cho Sự kiện đã hủy | low | Trùng VG-O1 | reject (gộp VG-O1) |
| BH2 | Khôi phục kiểm "đã kết thúc" trước `checkerId` và trước nhánh không đổi gì: CTV đã `active` hoặc `checkerId` sai trên Sự kiện đã kết thúc ra `409`, không ra `204`/`404` | low | Đúng. Chỉ gặp khi tab cũ còn hiện "Khôi phục" cho CTV đã được người khác khôi phục trước lúc kết thúc (toast rồi tải lại, ra đúng trạng thái), hoặc khi gọi API tay. Thứ tự đã ghi ở Implementation Notes. Sửa phải thêm nhánh đọc dòng trước | reject |
| BH3 | Migration `0037` chỉ `ADD CONSTRAINT`, không chuẩn hóa dữ liệu cũ, nên lỗi trên DB còn dòng `revoked` thiếu `revoked_*` | low | Đúng với DB test cục bộ (đã sửa trên máy duy nhất). CI dùng DB mới; chưa code đã ship nào ghi `revoked`; chưa có staging (9.1). Điền `revoked_by` cho dòng cũ là bịa dữ liệu | reject |
| BH4 | JSDoc route CTV (`checkin-scan.controller.ts`, `checkin-lookup.controller.ts`, `checkin-event.controller.ts`), `submitScan`/tra tay ở web `api.ts` và `ScanInvalidReason` chưa nhắc `403 EVENT_ENDED` | low | Đúng: các chỗ này chỉ liệt kê `NOT_A_MEMBER`/`CHECKER_REVOKED`; `ScanInvalidReason` không nói CTV giờ nhận 403. Người làm 5.7 sẽ đọc sai. Sửa trực tiếp | patch (P2) |
| BH5 | Comment mới ở `scan.test.ts` nói "ca CTV ở `checkers.test.ts`", nhưng file đó không có ca gửi lại cùng `scanId` | low | Đúng: `checkers.test.ts` chỉ kiểm 403 với `scanId` mới. Sửa câu comment | patch (P3) |
| BH6 | Như VG1 | medium | Trùng VG1 | patch (gộp P1) |
| BH7 | `revokedAt` có trong response nhưng web không hiện | false | Spec bắt response có `revokedAt` (Boundaries), còn hàng web theo đúng danh sách trường UX-DR39. Không có hại cụ thể | reject |
| BH8 | Thu hồi CTV về sau thành Owner/Admin không có tác dụng, Dialog nói sai | low | Đúng theo AD-26: Owner/Admin luôn quét được. Hiếm (CTV được mời làm Admin cùng BTC); sửa phải đánh dấu hàng | reject |
| BH9 | `CheckerStatus` có ba nguồn (contracts, `platform/access`, cột schema) | false | Lệch sẽ bị TypeScript bắt ở `flows/checkers.flow.ts` (`status: row.status` gán vào `CheckerListItem`) và ở guard (`event.checker === 'revoked'`); không có caller nào lệch mà không lỗi compile | reject |
| BH10 | Tên `EVENT_ENDED` dễ lẫn với `ScanInvalidReason.EVENT_ENDED` và `EVENT_ALREADY_ENDED`; câu màn hết quyền nằm ở cả api và web | false | Tên mã do spine chốt (AD-26: mã lỗi quyền có `EVENT_ENDED`). Web dùng câu riêng cho `EVENT_ENDED` vì UX-DR33 thêm dòng mô tả | reject |
| BH11 | `lockEventForCheckerInvite` giờ sai tên | low | Tên cũ nhưng JSDoc đã nói rõ hai nơi dùng. Đổi tên chạm nhiều file, không có hại cụ thể | reject |
| BH12 | e2e chưa có ca `401` và `404 EVENT_NOT_FOUND` của Dialog; mock chỉ coi "Kết thúc" sớm là đã kết thúc | low | Nhánh `401` theo mẫu `RemoveDialog`; `EVENT_NOT_FOUND` có unit test `isCheckerGone`; nhánh đồng hồ của `isEventEnded` có ở `test/event-status.test.ts` | reject |
| BH13 | Snapshot `0037_snapshot.json` không có trong diff review | false | Diff review cố ý bỏ snapshot sinh tự động; file có trên đĩa, có CHECK, sẽ commit cùng migration | reject |
| EC1 | Đồng hồ máy khách chậm: nhận `409` rồi `isEventEnded` vẫn `false`, nên "Khôi phục" bật lại | low | Đúng, nhưng chỉ khi lệch giờ quanh đúng mốc kết thúc theo giờ; "Kết thúc" sớm không phụ thuộc đồng hồ (`endedManuallyAt`). Sửa phải thêm trạng thái cục bộ | reject |
| EC2 | Như BH2 | low | Trùng BH2 | reject (gộp BH2) |
| EC3 | Mock e2e kiểm `NOT_FOUND` trước "đã kết thúc", ngược thứ tự server | low | Thứ tự mock không ảnh hưởng hành vi web đang kiểm; không ca e2e nào phụ thuộc thứ tự này | reject |
| EC4 | `now()` là giờ bắt đầu transaction: khôi phục chờ khóa qua mốc `effective_end_at` vẫn qua | low | Cửa sổ chỉ bằng thời gian chờ khóa (mili giây) ở đúng mốc kết thúc theo giờ. "Kết thúc" sớm được đọc lại sau khi có khóa nên vẫn ra 409. CTV vẫn bị guard chặn. Cùng mẫu với "Tạo link mới" | reject |
| EC5 | CTV gửi lại cùng `scanId` sau khi Sự kiện đóng không thấy kết quả `ok` | false | Đánh đổi đã chấp nhận trong Design Notes, trình bày ở lúc duyệt spec | reject |
| EC6 | Sự kiện `cancelled` đã quá giờ kết thúc: CTV thấy "Sự kiện đã kết thúc." thay vì "đã hủy" | low | Chưa đường nào hủy Sự kiện. Route CTV khi Sự kiện đã hủy đã giao 7.1 (mục hoãn của 5.2-a BH12) | reject, để 7.1 xét (gộp mục deferred của VG-O1) |
| EC7 | CTV `active` mở lại link sau khi Sự kiện kết thúc: xem trước chuyển sang Màn quét rồi mới hiện màn hết quyền | false | Kết quả cuối là đúng màn hết quyền kèm "Sự kiện đã kết thúc."; không lộ dữ liệu, không kẹt | reject |
| EC8 | Như VG-O1 | low | Trùng VG-O1 | reject (gộp VG-O1) |

## Design Notes

- **Vì sao chặn `EVENT_ENDED` ở guard thay vì ở từng flow:** AD-14 coi quyền CTV là quyền tính tại request. Chặn ở guard thì mọi route CTV sau này (vd. SSE của 5.7) đều được phủ mặc định.
- **Cái giá:** CTV gửi lại cùng `scanId` sau khi Sự kiện vừa đóng sẽ nhận màn hết quyền, không nhận lại `ok` như 5.4. Owner/Admin vẫn được phát lại. Ca này chỉ xảy ra khi phản hồi mất đúng lúc BTC bấm "Kết thúc", hoặc ở mốc `effective_end_at`.
- **Vì sao khôi phục xóa `revoked_*`:** CHECK đơn giản hơn, và hàng "Đang hoạt động" không mang dấu cũ. Ai thu hồi, lúc nào vẫn còn trong `audit_events`.
- **CTV đang ở màn hết quyền sau khi được khôi phục:** tải lại trang là vào lại được. Không thêm nút, vì UX-DR33 không có.

## Verification

**Commands:**
- `pnpm --filter @tickee/contracts test` -- expected: pass.
- `pnpm --filter @tickee/api exec vitest run test/checkin test/ticketing test/organizer/isolation.test.ts` -- expected: pass (cần Postgres từ docker compose).
- `pnpm --filter @tickee/web test` -- expected: pass.
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
- `sh scripts/dev-env.sh pnpm turbo build --filter=@tickee/web && pnpm --filter @tickee/web exec playwright test e2e/checkin-invite.spec.ts e2e/checkin-scan.spec.ts e2e/checkin-lookup.spec.ts e2e/checker-invite-accept.spec.ts` -- expected: pass ở cả hai project.

**Manual checks:**
- Trên điện thoại thật: thu hồi một CTV đang mở Màn quét; lượt quét kế tiếp ra màn hết quyền.
