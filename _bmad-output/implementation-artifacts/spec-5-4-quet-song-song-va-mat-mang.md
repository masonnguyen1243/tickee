---
title: 'Story 5.4: Quét song song và mất mạng'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '907a9559108fdba9c0ae097c1cf4133c95df8e1b'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Màn quét (5.3-b) gửi quét không có hạn chờ. Request treo thì gate khóa mãi, không báo gì. Lỗi mạng thì hiện "Chưa gửi được… Quét lại mã." rồi bỏ `scanId` cũ. Phía API chưa có test nào chứng minh quét song song chỉ một lần thành công (FR-28, AD-15, UX-DR31).

**Approach:**
- Web: mỗi lần gửi quét có hạn 3 giây. Hết hạn hoặc lỗi mạng thì hiện `offline-banner`, tạm dừng camera và tự gửi lại với cùng `scanId` cho tới khi có phản hồi.
- API: thêm test tích hợp quét song song trên Postgres thật.
- Xử lý hai mục hoãn đã giao cho 5.4.

**Quyết định (Mason, 25/11/2026):**
- **BH1 (review 5.3-a) — sửa:** trong `checkIn`, ở nhánh Sự kiện đóng và nhánh Vé đã hủy, nếu Vé đã check-in bởi chính người quét với đúng `scanId` thì trả `ok` của lần đầu. Chỉ thêm truy vấn ở nhánh đóng; đường quét thường không đổi.
- **BH6 (review 5.3-b) — thêm chỉ báo:** request chưa xong sau 1 giây thì hiện "Đang gửi…" trên khung camera (`aria-live="polite"`); ẩn khi có kết quả hoặc khi `offline-banner` hiện.
- Giữ một spec, không tách.

## Boundaries & Constraints

**Always:**
- **Hạn chờ:** mỗi lần gửi (kể cả gửi lại) hủy sau 3 giây và coi như lỗi mạng (`isNetworkError`). Dùng `AbortController` + `setTimeout`, không dùng `AbortSignal.timeout` (thiếu ở iOS 15).
- **Gửi lại:** chỉ khi lỗi mạng hoặc hết hạn, đúng `code` và `scanId` cũ, cách nhau 1 giây, không giới hạn số lần khi còn ở Màn quét. Rời Màn quét thì thôi gửi lại. Trình duyệt báo offline thì chờ có mạng rồi gửi ngay.
- **`offline-banner`:**
  - hiện khi một lần quét đang chờ gửi lại, hoặc khi trình duyệt báo offline (kể cả lúc không có lần quét nào);
  - đặt trên cùng Màn quét, trên tên Sự kiện; không có nút đóng;
  - nền `warning-subtle`, chữ `warning-text`, icon mất sóng, chữ "Mất kết nối — chưa quét được", `role="status"`;
  - khi banner hiện: khung camera phủ đen 50%, chữ trắng `text-meta` ở giữa đáy khung "Camera tạm dừng · tự thử lại", không giải mã mã mới; track camera vẫn chạy;
  - tự ẩn khi có phản hồi HTTP, hoặc khi trình duyệt báo có mạng mà không còn lần quét nào chờ gửi lại.
- Lần gửi lại nhận phản hồi thì xử lý như lần gửi thường: overlay theo kết quả, âm thanh, 401/403 như 5.3-b.
- `5xx` và lỗi khác có phản hồi: giữ nguyên hành vi 5.3-b (dải "Chưa gửi được kết quả quét. Quét lại mã.", lần sau là `scanId` mới). Hai dải không hiện cùng lúc; `offline-banner` thắng.
- "Tra tay" giữ nguyên như 5.3-b (vẫn hiện, vẫn tắt) khi banner hiện.
- **Test API song song:** giữ khóa dòng Vé bằng một kết nối riêng, gửi N request, chờ cả N đang chờ khóa, rồi nhả, để chắc các request thật sự tranh nhau.

**Never:**
- Không có hàng đợi quét offline, không ghi nhận cục bộ.
- Không đổi schema DB, contracts hay luồng `ticketing.checkIn` ở đường quét thường (không thêm truy vấn khi Sự kiện mở và Vé hợp lệ).
- Không làm tra tay (5.5), màn hết quyền `403 EVENT_ENDED` của CTV (5.6), SSE (5.7). Không đo p95 hay kiểm thử tải (9.1, 9.2).
- Không đổi `Providers` hay `MutationCache`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chậm 1–3 giây | Phản hồi tới ở giây 1,5 | "Đang gửi…" hiện từ giây 1, ẩn khi overlay hiện; không banner | N/A |
| Gửi lại sau khi đóng | Lần đầu `ok`, rồi Sự kiện đóng hoặc Vé bị hủy; gửi lại cùng `scanId` | `ok` như lần đầu; `scanId` mới hoặc người khác → lý do đóng | N/A |
| Treo > 3 giây | Lần gửi đầu không phản hồi | Banner + camera tạm dừng lúc 3 giây; gửi lại cùng `scanId`; phản hồi tới thì banner ẩn, overlay theo kết quả | N/A |
| Lỗi mạng | `fetch` lỗi ngay | Banner ngay; gửi lại mỗi 1 giây cùng `scanId` | N/A |
| Offline khi rảnh | Trình duyệt báo offline, không có quét chờ | Banner + tạm dừng; mã hiện trước camera không gửi; có mạng lại thì ẩn và quét tiếp | N/A |
| Mất phản hồi lần đầu | Lần đầu đã ghi, gửi lại cùng `scanId` | API trả `ok` như lần đầu | N/A |
| Hai người cùng Vé | N request song song, khác người, khác `scanId` | Đúng 1 `ok`; còn lại `already` với `checkedInAt` của lượt đầu | N/A |
| 5xx | API 503 | Dải "Chưa gửi được…", không banner | Quét lại bằng `scanId` mới |

</frozen-after-approval>

## Code Map

**API**
- `apps/api/src/modules/ticketing/check-in.ts:65-127` `checkIn`: `assertCheckinOpen` (:67) trả lý do đóng trước mọi thứ; UPDATE có điều kiện; 0 dòng thì đọc lại Vé (:89), nhánh Vé hủy (:104) đứng trước nhánh phát lại (:114-123). Chỗ sửa BH1.
- `apps/api/src/flows/checkin-scan.flow.ts` `scanTicket`: `scanId.toLowerCase()`; không đổi.
- `apps/api/test/checkin/scan.test.ts`: fixtures `issue`, `scan`, `scanOk`, `checkerOf`, `user`, `ticketRow`, `checkinSignals`/`signalsSettled`, `okOf`, `invalid`, `CLOSE` (:447, các trạng thái đóng Sự kiện bằng SQL), Vé hủy bằng SQL (:427). Test phát lại tuần tự đã có (:218).
- Pool của app `max: 10` (`platform/db/database.ts:28`): N ≤ 8. Kết nối giữ khóa dùng `pg.Client` riêng như `listener`. Request đang chờ khóa thấy qua `pg_stat_activity` (`wait_event_type = 'Lock'`, câu `update "tickets"`).

**Web**
- `app/(checkin)/events/[eventId]/checkin-event-screen.tsx`: `submit` (`useMutation`, :245), `onError` đặt `sendFailed` (:265), `onCode` sinh `scanId` (:272), `ScanFlow` (:182) truyền `notice` cho viewport.
- `lib/checkin/api.ts:87` `submitScan`: thêm hạn 3 giây ở đây.
- `lib/api/client.ts:60-67`: hủy (`AbortError`) bị ném nguyên trạng, không thành lỗi mạng. `lib/api/errors.ts:19,35`: `serviceUnavailableError`, `isNetworkError`.
- `lib/checkin/use-qr-scanner.ts:244`: điều kiện giải mã (`!gateRef.current.locked`). Thêm tùy chọn `paused`.
- `components/tickee/scanner-viewport.tsx`: prop `notice` (dưới tên Sự kiện). Thêm vị trí banner trên cùng và trạng thái tạm dừng của khung camera.
- TanStack Query 5.105: `useMutation` có `retry`/`retryDelay` (gửi lại cùng biến), `failureReason`, `isPaused`; `onlineManager` (`subscribe`, `isOnline`) theo sự kiện `online`/`offline`.
- Token: `bg-warning-subtle`, `text-warning-text` (`app/globals.css:147-148`). Icon `WifiOff` của lucide.

**e2e**
- `e2e/checkin-scan.spec.ts`: helper `openScanScreen`, `startCamera`, `scans(calls)`, `overlay`, `viewport`. Test :282 giữ request ~1 giây (dưới 3 giây, giữ nguyên). Test :319 gộp 5xx và `'abort'`, phải tách: 5xx giữ dải cũ, `'abort'` thành banner.
- `e2e/checkin-mock.ts`: handler trả `'abort'` → `route.abort('failed')`. Handler treo quá 3 giây thì `route.fulfill` sau khi client hủy có thể ném, cần bắt.
- `e2e/order-live.spec.ts:547`: mẫu `page.context().setOffline(true/false)`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/ticketing/check-in.ts` -- phát lại cùng `scanId` thắng cổng đóng và Vé hủy; cập nhật doc comment -- AD-15 khi gửi lại kéo dài.
- [x] `apps/api/test/checkin/scan.test.ts` -- thêm: (1) 8 người, 8 `scanId`, song song có khóa chặn → đúng 1 `ok`, 7 `already` có `checkedInAt` bằng `checked_in_at` của lượt đầu; dòng Vé giữ người và `scanId` của người thắng; đúng 1 tín hiệu; quét thêm sau đó không đổi `checked_in_at`; (2) cùng người, cùng `scanId`, 2 request song song có khóa chặn → cả hai `ok` giống nhau, 1 tín hiệu; (3) mỗi trạng thái `CLOSE` và Vé hủy/vô hiệu sau lần `ok` → gửi lại cùng `scanId` ra `ok`; `scanId` mới hoặc người khác dùng `scanId` đó ra lý do đóng -- FR-28, AD-15.
- [x] `apps/web/lib/checkin/api.ts` -- `submitScan` có hạn `SCAN_TIMEOUT_MS = 3000`, hết hạn ném `serviceUnavailableError`, luôn xóa timer -- hạn chờ.
- [x] `apps/web/test/submit-scan.test.ts` -- hết hạn → `isNetworkError`; phản hồi trước 3 giây → kết quả, timer đã xóa.
- [x] `apps/web/lib/checkin/use-qr-scanner.ts` -- tùy chọn `paused`: không giải mã khi `true`.
- [x] `apps/web/components/tickee/offline-banner.tsx` (mới), `scanner-viewport.tsx` -- banner và khung tạm dừng theo Boundaries; dòng "Đang gửi…" (BH6).
- [x] `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx` -- `retry` cho lỗi mạng (dừng khi rời màn), `retryDelay` 1 giây, trạng thái offline từ mutation và `onlineManager`, ẩn dải 5.3-b khi banner hiện.
- [x] `apps/web/e2e/checkin-scan.spec.ts`, `checkin-mock.ts` -- phủ các dòng Matrix phía web, tách test :319, ca 320px ở trạng thái offline; ca "Đang gửi…" (request giữ ~1,5 giây).

**Acceptance Criteria:**
- Given lần gửi treo rồi lần gửi lại trả `ok`, when chạy e2e ở `ios-webkit` và `android-chromium`, then mọi body `POST scans` có cùng `code` và `scanId`, banner hiện từ ~3 giây tới lúc có overlay xanh.
- Given banner đang hiện, when camera giả đổi sang mã khác, then không có request nào cho mã đó tới khi banner ẩn và overlay đóng.
- Given Màn quét rộng 320px ở trạng thái offline, then không cuộn ngang và "Tra tay" không bị che.

## Implementation Notes

- **Đã làm (25/11/2026):** đủ 8 task.
  - API: `checkIn` thêm `replayOf` (chỉ chạy ở nhánh Sự kiện đóng); ở nhánh UPDATE 0 dòng, kiểm phát lại được đưa lên trước nhánh Vé hủy, không thêm truy vấn. Đường quét thường không đổi.
  - Test API mới trong `scan.test.ts`: `whileTicketLocked` giữ `FOR UPDATE` dòng Vé bằng `pg.Client` riêng, chờ `pg_stat_activity` thấy đủ N request chờ khóa ở `update "tickets"` rồi mới COMMIT. Thêm 2 ca song song và 6 ca phát lại sau khi đóng (4 trạng thái `CLOSE`, Vé `event_cancelled`/`voided`). 6 ca phát lại hỏng với `checkIn` cũ, pass với bản mới.
  - Web mới: `components/tickee/offline-banner.tsx`, `test/submit-scan.test.ts`.
  - e2e: tách test 5xx khỏi lỗi mạng. Thêm các ca chậm 1,5 giây, treo quá 3 giây, lỗi mạng ngay (kèm AC đổi mã khi banner hiện), offline khi rảnh, và 320px offline. `recordScanTimeline` ghi thêm body của từng lần gửi và giờ hiện/ẩn của `offline-banner`, "Đang gửi…". `checkin-mock.ts` bắt lỗi `fulfill`/`abort` khi client đã hủy.
- **Chọn khi spec chưa nói rõ:**
  - "Dừng khi rời màn": `submitScan` nhận thêm `signal` tùy chọn. Màn quét tạo một `AbortController` trong effect, hủy khi unmount. Kết quả: lần gửi đang chạy bị hủy, `retry` trả `false` và `onError` bỏ qua. Hủy từ nơi gọi ném lại `AbortError` nguyên trạng, không thành lỗi mạng.
  - Banner chỉ hiện trong `scanner-viewport` (camera `starting`/`running`), không hiện ở các màn "Bật camera", bị từ chối hay không mở được camera.
  - Trạng thái offline = (`isPending` và `failureReason` là lỗi mạng) hoặc `!onlineManager.isOnline()`. Banner và việc tạm dừng gửi lại dùng cùng một nguồn.
  - Dải 5.3-b chỉ bị ẩn khi banner hiện, không bị xóa. Có phản hồi `ok` thì dải mất như cũ.
  - "Đang gửi…" là chip nền đen 60% để đọc được trên hình camera. Vùng `aria-live="polite"` ở đáy khung luôn có mặt và dùng chung cho dòng "Camera tạm dừng · tự thử lại".
  - Banner: `rounded-md`, `p-card-padding`, chữ `text-body` đậm theo mockup `key-checkin.html`, icon `WifiOff`.
  - Tab ẩn thì TanStack tạm dừng gửi lại (`focusManager`), hiện lại thì gửi tiếp. Hành vi có sẵn của TanStack, không thêm code.
- **Sau review lượt 1:**
  - API: `replayOf` chỉ lọc theo `id`, `event_id`, BTC rồi khóa `FOR SHARE`; so người quét và `scanId` trong JS. Nhờ vậy, lần đầu còn giữ dòng Vé (chưa commit) thì lần gửi lại chờ lần đó commit. Trước đây lọc trong WHERE nên không chờ, và lần gửi lại nhận đỏ `EVENT_ENDED`.
  - Test API thêm ca lần đầu chưa commit lúc Sự kiện quá `effective_end_at`. Ca này hỏng với bản cũ, pass với bản mới. Hai dòng `cancelled` của ca gửi lại sau khi đóng giờ hủy cả Vé.
  - Unit test thêm ca hết hạn lúc đang đọc body.
  - e2e:
    - ca offline khi rảnh bỏ mã khỏi khung trước khi có mạng; ca này hỏng khi bỏ `paused`;
    - ca 5xx thêm bước offline, kiểm banner thắng dải 5.3-b;
    - thêm ca rời Màn quét khi đang gửi lại (helper `openViaScanTab` dùng chung với ca "rời trang");
    - thêm ca gửi lại hai lần rồi nhận `403`;
    - sửa chú thích ca 320px.
- **Verification (25/11/2026):** cả 4 lệnh pass:
  - API `test/checkin test/ticketing`: 154 test;
  - web unit: 443 test;
  - `pnpm typecheck` và `pnpm lint:deps`;
  - `checkin-scan.spec.ts`: 52/52 ở cả hai project. Chạy các ca mới `--repeat-each=4` cũng pass (56/56).
  - Chạy thêm `checker-invite-accept`, `dashboard-shell`, `checkin-invite`: 134/134.
  - Manual check trên điện thoại thật chưa làm.

## Spec Change Log

## Review Triage Log

Lượt 1 (25/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Không test nào kiểm "offline khi rảnh thì không giải mã": bỏ `paused` thì mã hiện lúc offline thành mutation tạm dừng và được gửi khi có mạng (hàng đợi offline ngầm) | medium | Lớp VG đã kiểm: TanStack (`networkMode: 'online'`) tự tạm dừng mutation khi offline, nên test :545/:552 vẫn pass khi bỏ `paused` | patch (P1) |
| VG2 | Rời Màn quét giữa lúc đang gửi lại chưa có test (hủy request, thôi gửi lại) | medium | Lớp VG đã kiểm: test "rời trang" không gửi quét nào; bỏ `screenAbort` hay `hasLeft()` không test nào hỏng | patch (P2) |
| BH6 | Như VG2 | medium | Trùng VG2 | patch (gộp P2) |
| VG3 | "Banner thắng dải 5.3-b" chưa có test | low | Lớp VG đã kiểm: trả về `notice={sendFailed ? …}` thì mọi test vẫn pass; sửa chỉ là mở rộng test 5xx | patch (P3) |
| VG4 | Phát lại khi Sự kiện đóng mà Vé cũng đã hủy (`replayOf` không lọc `status`) chưa có test | medium | Lớp VG đã kiểm: `CLOSE.cancelled` không hủy Vé; thêm `status = 'valid'` vào `replayOf` không test nào hỏng. 7.1 sẽ hủy Vé khi hủy Sự kiện | patch (P4) |
| EC1 | Lần đầu còn giữ khóa dòng Vé (UPDATE chưa commit) mà Sự kiện qua `effective_end_at`: lần gửi lại vào nhánh đóng, `replayOf` đọc bản đã commit không chờ khóa → đỏ `EVENT_ENDED`, rồi lần đầu commit check-in | low | Đúng: `replayOf` là SELECT thường (READ COMMITTED), lọc `checked_in_by`/`checkin_scan_id` trong WHERE nên không chờ dòng đang bị khóa. Chỉ xảy ra khi hết giờ theo đồng hồ (Kết thúc/Hủy tay lấy `FOR UPDATE` trên Sự kiện nên phải chờ). Sửa trực tiếp trong `replayOf`: khóa `FOR SHARE` theo id rồi so trong JS | patch (P5) |
| EC9 | Doc comment nói gửi lại "cũng chờ khóa đó rồi rơi vào nhánh phát lại", sai ở nhánh đóng | low | Trùng EC1 | patch (gộp P5) |
| BH8 | Gửi lại nhiều lần rồi nhận 401/403/503 chưa có test | low | Đúng: `onError` sau chuỗi lỗi mạng (gate khóa suốt) không test nào chạy. Sửa chỉ là thêm một ca e2e | patch (P6) |
| BH9 | Hạn 3 giây lúc đang đọc body chưa có test (`readJson` ném `invalidResponseError`, chỉ cờ `timedOut` đổi lại thành lỗi mạng) | low | Đúng: `submit-scan.test.ts` chỉ có ca `fetch` không bao giờ trả. Sửa chỉ là thêm một unit test | patch (P7) |
| BH13 | Comment trong test 320px offline nói "một lần quét vẫn chờ gửi lại" nhưng test kiểm banner ẩn trước khi quét | low | Đúng: comment không khớp thân test. Sửa câu chữ | patch (P8) |
| EC3 | Server reachable nhưng mỗi lần quá 3 giây: các lần đã hủy vẫn chạy ở server, gửi lại chồng lên, màn kẹt offline | maybe-false | Đúng là client hủy không dừng transaction ở server và scan không có `statement_timeout`/`lock_timeout`. Chưa rõ có chồng tới mức cạn pool không: pool `max: 10`, `connectionTimeoutMillis: 3000` nên request chờ kết nối tự lỗi sau 3 giây. Cần kiểm thử tải với DB chậm hoặc khóa dài (9.2) | defer (9.2) |
| BH1 | Như EC3 (thêm: cạn pool làm hỏng request khác) | maybe-false | Trùng EC3 | defer (gộp EC3) |
| EC2 | Mất kết nối lúc đang đọc body (trước 3 giây) → `invalidResponseError`, không gửi lại cùng `scanId` | low | Đúng trong `performApiRequest` (`readJson` lỗi). Body ~200 byte thường đến cùng gói với header nên rất hiếm; quét lại ra trung tính (không đỏ). Sửa phải đổi client dùng chung | reject |
| EC4 | `pausedRef` cập nhật trong effect: một vòng giải mã giữa sự kiện offline và lúc commit có thể `mutate` khi offline | low | Cửa sổ chỉ là một lần render; vòng giải mã 150ms phải đọc được mã đúng lúc đó. Sửa phải thêm guard trong `onCode` | reject |
| BH11 | Như EC4, thêm "Đang gửi…" tính từ `submittedAt` của mutation tạo lúc offline | low | Trùng EC4: chỉ xảy ra khi `mutate` trong cửa sổ đó | reject (gộp EC4) |
| EC5 | Offline trước khi `onlineManager` đăng ký sự kiện → banner rảnh không hiện | low | `onlineManager` đăng ký khi app khởi động; trang không tải được khi offline. Sửa phải thêm effect đọc `navigator.onLine` | reject |
| EC6 | `role="status"` gắn cùng lúc với chữ nên trình đọc màn hình có thể không đọc banner | low | Trạng thái offline vẫn được đọc qua vùng `aria-live="polite"` luôn có mặt ("Camera tạm dừng · tự thử lại"); overlay 5.3-b cũng gắn kèm chữ. Sửa phải đổi cấu trúc viewport | reject |
| BH5 | Như EC6, thêm hai thông báo tranh nhau | low | Trùng EC6 | reject (gộp EC6) |
| EC7 | `checkin-mock.ts` nuốt mọi lỗi `fulfill`/`abort` | low | Chỉ hại khi viết mock sai (test treo thay vì báo lỗi rõ). Sửa phải so khớp thông báo lỗi của Playwright | reject |
| BH10 | Như EC7 | low | Trùng EC7 | reject (gộp EC7) |
| EC8 | `whileTicketLocked`: request reject khi đang poll thì thành unhandled rejection | low | supertest chỉ reject khi lỗi kết nối tới server trong tiến trình, gần như không xảy ra. Chỉ ảnh hưởng chẩn đoán khi test hỏng | reject |
| BH14 | `whileTicketLocked` bỏ response khi poll hết giờ nên khó chẩn đoán | low | Trùng EC8 (chẩn đoán khi test hỏng); sửa phải thêm xử lý chờ có hạn và gắn response vào lỗi | reject (gộp EC8) |
| BH2 | Gửi lại cố định 1 giây, không jitter → các máy dồn vào API khi hồi phục | false | Các máy không cùng pha: mỗi máy bắt đầu theo lúc quét và lúc nhận lỗi của riêng nó; mỗi Sự kiện chỉ vài chục CTV. Spec chốt "cách nhau 1 giây" | reject |
| BH3 | Telemetry không phân biệt `ok` phát lại với check-in mới | low | Đúng, nhưng histogram chỉ đo thời gian quét (NFR-2), không dùng đếm check-in (DB là nguồn). Sửa phải thêm cờ vào `CheckInResult` | reject |
| BH4 | Proxy 502/504 hay 503 body không phải JSON coi như có phản hồi → "Quét lại mã", `scanId` mới | low | Đúng theo mapping lỗi, nhưng intent chốt "5xx… giữ nguyên hành vi 5.3-b"; quét lại ra trung tính, không đỏ | reject |
| BH7 | Offline khi đang có lần gửi lại chờ, rồi có mạng thì gửi ngay: chưa có test | low | Đường này là hành vi có sẵn của TanStack (retryer dừng khi `onlineManager` offline, chạy tiếp khi online); phần banner (`!online`) đã có test offline khi rảnh | reject |
| BH12 | Camera rơi về `unavailable`/`denied` khi đang gửi lại: không thấy gì, kết quả tới thì không có overlay | low | Cần camera hỏng đúng lúc mất mạng; overlay hiện lại khi bấm "Thử lại". Sửa phải thêm nhánh hiển thị hoặc bỏ lần quét chờ | reject |

## Design Notes

- **Vì sao gửi lại cùng `scanId` mà không lo ghi hai lần:** lần đầu bị client hủy lúc 3 giây vẫn có thể đang chạy ở server. Lần gửi lại chờ khóa dòng Vé, rồi rơi vào nhánh phát lại (cùng người, cùng `scanId`) nên trả `ok`. Test (2) ở trên chứng minh ca này.
- **Vì sao dùng `retry` của TanStack:** gửi lại đúng biến cũ, tự dừng khi trình duyệt offline và tiếp khi có mạng. `onError` chỉ chạy khi hết gửi lại, nên nhánh 401/403/5xx của 5.3-b giữ nguyên.

## Verification

**Commands:**
- `pnpm --filter @tickee/api exec vitest run test/checkin test/ticketing` -- expected: pass (cần Postgres từ docker compose).
- `pnpm --filter @tickee/web test` -- expected: pass.
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
- `sh scripts/dev-env.sh pnpm turbo build --filter=@tickee/web && pnpm --filter @tickee/web exec playwright test e2e/checkin-scan.spec.ts` -- expected: pass ở cả hai project.

**Manual checks:**
- Trên điện thoại thật qua HTTPS: bật chế độ máy bay giữa lúc quét thấy banner và khung mờ; tắt chế độ máy bay thì thấy kết quả của lần quét đó.
