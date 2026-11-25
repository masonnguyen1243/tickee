---
title: 'Story 5.3-b: Màn quét web'
type: 'feature'
created: '2026-11-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '7b5bfb8a7cfab50b6c488fc8f700915c49aa8e86'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** API quét của 5.3-a đã có, nhưng `/events/[eventId]` vẫn là trang tạm "Màn quét đang được hoàn thiện.", nên chưa ai quét được Vé (FR-27, FR-28, UX-DR28–30). Ngoài ra còn ba chỗ thiếu: tab "Quét vé" vẫn là `ComingSoon`, `/xem-ve` không giữ màn hình sáng, và padding safe-area đang bằng 0.

**Approach:**
- Thay trang tạm bằng Màn quét toàn màn hình:
  1. màn "Bật camera";
  2. camera chạy liên tục, giải mã Mã QR vé ngay trong trình duyệt;
  3. mỗi mã đọc được gửi `POST /v1/checkin/events/:eventId/scans` với một `scanId` mới;
  4. hiện overlay xanh, trung tính hoặc đỏ, có âm thanh.
- Làm luôn ba mục hoãn đã giao cho 5.3-b.

**Quyết định (Mason, 25/11/2026):**
- Giải mã bằng **jsQR 1.4.0**, ghim đúng phiên bản.
- Tab "Quét vé" (`/btc/[orgId]/quet-ve`) là **trang chọn Sự kiện**:
  - lấy các Sự kiện `published`/`hidden` chưa kết thúc (`fetchEvents` + `isEventEnded`), xếp theo giờ bắt đầu gần nhất;
  - không có Sự kiện nào → trạng thái trống có link về "Sự kiện";
  - đúng 1 → `router.replace` tới Màn quét;
  - từ 2 trở lên → danh sách để chọn.
- `viewportFit: 'cover'` **chỉ bật cho `(checkin)`**, qua `viewport` của layout.
- Giữ một spec, không tách.

## Boundaries & Constraints

**Always:**
- **Layout `(checkin)`:** toàn màn hình (`min-h-dvh`), dọc, không có `SiteHeader`, theo theme đang dùng. Padding `env(safe-area-inset-*)` ở cả bốn phía.
- **Luồng vào màn:**
  1. Tải `CheckinEvent`, giữ nguyên các nhánh 401, 403 và lỗi của trang tạm.
  2. Hiện màn "Bật camera" ở mọi lần vào. Chạm vào đây cũng mở khóa âm thanh trên Safari iOS.
  3. Gọi `getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false})`.
  - Bị từ chối (`NotAllowedError`): hướng dẫn bật lại quyền camera, một đoạn cho Safari iOS và một đoạn cho Chrome Android, kèm "Thử lại" và "Tra tay".
  - Không có camera hoặc không có `mediaDevices`: hiện "Không mở được camera" kèm "Tra tay".
- **`scanner-viewport`:**
  - Video `playsInline muted`. Khung ngắm vuông, bo `rounded-lg`, viền trắng 3px.
  - Đỉnh màn: tên Sự kiện và "Đã check-in {checkedInCount}/{validTicketCount}".
  - Đáy màn: nút "Tra tay" (`button-secondary`) ở vùng ngón cái.
- **Giải mã:**
  - Cắt vùng vuông giữa khung hình, thu về tối đa 480px, giải mã mỗi ~150ms.
  - Thư viện giải mã chỉ tải khi mở Màn quét (dynamic import).
  - Đọc được mã: khóa quét, gửi `{code, scanId: crypto.randomUUID()}`. Overlay đóng thì mở khóa.
  - Cùng mã đọc lại trong 2 giây sau khi overlay đóng thì bỏ qua.
  - Tab ẩn hoặc rời trang thì dừng mọi track camera; tab hiện lại thì bật lại.
  - `useScreenWakeLock(cameraRunning)`.
- **`scan-result-overlay`:**
  - Phủ toàn màn hình, đọc bằng `aria-live="assertive"`.
  - Chữ dùng `text-scan-result` và `text-scan-detail`.
  - Reduced motion: hiện ngay, không animation.

  | Kết quả | Nền | Icon | Nội dung | Âm thanh | Đóng |
  |---|---|---|---|---|---|
  | `ok` | `scan-success` | tích tròn 96px | "Thành công" · "{holderName} · Vé {seq}/{count} · {ticketTypeName}" | bíp nhẹ | tự đóng sau 1,5 giây, rồi tải lại `CheckinEvent` |
  | `recent` | `neutral-subtle` | i tròn | "Bạn vừa check-in Vé này" | không | tự đóng sau 1,5 giây |
  | `already` | `scan-danger` | X bát giác | "Đã check-in" · "lúc HH:MM · bởi {người}" | cảnh báo | chạm để đóng |
  | `invalid` | `scan-danger` | X bát giác | "Vé không hợp lệ" · một dòng lý do | cảnh báo | chạm để đóng |

  - `already`: giờ HH:MM tính theo `Asia/Ho_Chi_Minh`. "{người}" là "bạn" (`self`), tên (`name`), hoặc theo vai trò: "Owner", "Admin", "CTV khác" (`role`).
  - Lý do của `invalid`:
    - `BAD_SIGNATURE` → "Mã QR vé không đúng"
    - `CANCELLED` → "Vé đã hủy"
    - `VOIDED` → "Vé bị vô hiệu"
    - `OTHER_EVENT` → "Vé của Sự kiện khác"
    - `EVENT_ENDED` → "Sự kiện đã kết thúc"
  - Kết quả đỏ: chạm bất kỳ đâu để đóng. Có nút "Chạm để quét tiếp", chữ trắng viền trắng, ở vùng ngón cái.
- **Âm thanh:** dùng Web Audio, không dùng file âm thanh. `AudioContext` được tạo hoặc resume trong lần chạm "Bật camera". Âm thanh lỗi thì kết quả vẫn hiện bình thường.
- **Lỗi khi gửi quét:**
  - 401: sang đăng nhập kèm `returnTo`.
  - 403 `NOT_A_MEMBER` hoặc `CHECKER_REVOKED`: hiện màn hết quyền với câu của api, tắt camera.
  - Lỗi mạng, 5xx hoặc lỗi khác: không hiện đỏ. Hiện dải cảnh báo "Chưa gửi được kết quả quét. Quét lại mã." rồi mở khóa quét.
- **Nút "Tra tay":** luôn hiện nhưng bị tắt, kèm dòng lý do hiển thị "Tra tay sắp có" (5.5 sẽ nối).
- **`/xem-ve`:** gọi `useScreenWakeLock(Boolean(ticket.data))`. Xong mục hoãn "Story 5.3 (D5). `/xem-ve`… không giữ màn hình sáng".
- **Bảo mật:** web không log `code`.

**Never:**
- Không làm timeout 3 giây, thử lại cùng `scanId`, `offline-banner` hay theo dõi online/offline. Không xử lý mục hoãn BH1 (phát lại sau khi Sự kiện đóng). Tất cả thuộc 5.4.
- Không làm `manual-lookup` hay check-in tay (5.5), màn hết quyền do `403 EVENT_ENDED` (5.6), SSE hay số check-in theo Hạng vé (5.7).
- Không sửa API hay contracts. Không đổi `nav.ts` hay `bottom-tab-bar.tsx`, vì tab "Quét vé" đã có. Không dùng rung.
- Không bật `cover` ở `app/layout.tsx`. Phần còn lại của mục hoãn "Padding `env(safe-area-inset-bottom)`… đang bằng 0" (tab bar, Sheet, `purchase-bar`, kiểm tra trang công khai ở landscape) để lại cho 9.1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Vào màn | `CheckinEvent` 200 | Màn "Bật camera" có tên Sự kiện | 401 → đăng nhập; 403 → câu của api |
| Từ chối camera | `getUserMedia` ném `NotAllowedError` | Hướng dẫn Safari iOS/Chrome Android, "Thử lại", "Tra tay" | N/A |
| Quét xanh | Mã đọc được, api trả `ok` | Overlay xanh tự đóng; số đã check-in tải lại | N/A |
| Quét lặp | Cùng mã ngay sau khi overlay đóng | Không gửi request | N/A |
| Đỏ | `already` hoặc `invalid` | Overlay đỏ và âm thanh, giữ tới khi chạm | N/A |
| Mất quyền giữa chừng | `POST scans` → 403 | Màn hết quyền, camera tắt | N/A |
| Lỗi mạng/5xx | `POST scans` lỗi | Không đỏ; dải cảnh báo; quét tiếp được | N/A |
| Rời màn | Tab ẩn hoặc rời trang | Track camera dừng, nhả wake lock | N/A |
| Tab "Quét vé" | 0 / 1 / ≥2 Sự kiện còn quét được | Trạng thái trống / chuyển thẳng / danh sách | Lỗi tải → banner "Thử lại" |

</frozen-after-approval>

## Code Map

**Màn quét hiện có**
- `apps/web/app/(checkin)/layout.tsx`: khung tạm một cột có `SiteHeader`. Comment trong file đã ghi 5.3 đổi thành toàn màn hình.
- `app/(checkin)/events/[eventId]/checkin-event-screen.tsx`:
  - nhánh `noAccess` đặt trước `data`;
  - `handledByGateOrProviders`;
  - 401 → `withReturnTo(LOGIN_PATH, …)`.
  - Giữ các nhánh này, thay phần `data`.
- `lib/checkin/api.ts:50,77`: `checkinEventQueryKey`, `fetchCheckinEvent`. Chưa có hàm gửi quét.
- `lib/api/client.ts:92`: `apiRequest(path, {schema, init})`.
- `lib/api/errors.ts:35`: `isNetworkError`.
- `lib/auth/api.ts:41`: `hasErrorCode`.
- `lib/api/message-of.ts`: `messageOf`.

**Contracts (chỉ đọc)**
- `packages/contracts/src/checkin.ts:128-207`: `checkinScanApiPath`, `ScanRequest`, `ScanResult`, `ScanOutcome`, `ScanInvalidReason`, `ScanCheckedBy`, `checkinScanPath`.

**Tái dùng**
- `lib/tickets/wake-lock.ts:99`: `useScreenWakeLock(active)`. Mẫu dùng ở `app/(buyer)/tickets/[ticketId]/ticket-detail.tsx:144`.
- `app/(public)/xem-ve/shared-ticket.tsx`: `SharedTicket`. 200 luôn có `qr`.
- `app/globals.css`:
  - `--scan-success`, `--scan-danger`, `--scan-foreground` (:61-63, giống nhau ở cả hai theme);
  - `text-scan-result`, `text-scan-detail` (:206-211);
  - `--neutral-subtle`;
  - khối `prefers-reduced-motion` ở :314.
- `components/ui/button.tsx` (`loading`), `components/tickee/status-banner.tsx`.
- Tab "Quét vé":
  - `app/(dashboard)/btc/[orgId]/quet-ve/page.tsx` hiện là `ComingSoon`;
  - mẫu danh sách: `organization-home.tsx:160` (`useCurrentOrganization`, `eventsQueryKey`, `fetchEvents`);
  - `su-kien/event-status.ts`: `isEventEnded`.

**e2e**
- `e2e/checkin-mock.ts`: mock bằng `page.route`, handler theo `"METHOD /path"`; thiếu handler thì trả 500.
- `e2e/checker-invite-accept.spec.ts:376-467`: test của trang tạm, phải sửa.
- `e2e/dashboard-shell.spec.ts:431-435`: test tab "Quét vé" đang chờ heading `ComingSoon`.
- `e2e/my-tickets.spec.ts:167`: `recordWakeLock`, mẫu cho `shared-ticket.spec.ts`.
- `e2e/qr-image.ts`: dùng `qrcode` trong Node.
- `playwright.config.ts`: hai project `ios-webkit` và `android-chromium`. Chưa có camera giả.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/package.json`: thêm `jsqr` `1.4.0`, ghim đúng phiên bản.
- [x] `apps/web/app/(checkin)/layout.tsx`: layout toàn màn hình, safe-area, `export const viewport` có `viewportFit: 'cover'`.
- [x] `apps/web/lib/checkin/api.ts`: thêm `submitScan(eventId, body)`, dùng `apiRequest(checkinScanApiPath(eventId), {schema: ScanResult, init: {method: 'POST', body: JSON.stringify(body)}})`.
- [x] `apps/web/lib/checkin/scan-view.ts`, kèm `test/scan-view.test.ts`: hàm thuần `ScanResult` → `{tone, title, detail, sound, autoCloseMs}`. Test mọi `outcome`, mọi lý do, mọi nhánh `checkedBy`, và giờ HH:MM theo giờ Việt Nam.
- [x] `apps/web/lib/checkin/scan-sound.ts`: bíp nhẹ và âm cảnh báo bằng Web Audio; có `unlock()` gọi trong lần chạm "Bật camera".
- [x] `apps/web/lib/checkin/use-qr-scanner.ts`: camera, vòng giải mã, khóa quét, bỏ qua mã lặp, dừng khi tab ẩn, wake lock.
- [x] `apps/web/components/tickee/{scanner-viewport,scan-result-overlay}.tsx`: hai component theo Boundaries.
- [x] `apps/web/app/(checkin)/events/[eventId]/checkin-event-screen.tsx`: các trạng thái tải → Bật camera → từ chối/lỗi camera → đang quét → overlay, và xử lý lỗi khi gửi quét.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/quet-ve/{page,scan-event-picker}.tsx`: trang chọn Sự kiện theo Quyết định.
- [x] `apps/web/app/(public)/xem-ve/shared-ticket.tsx`: gọi `useScreenWakeLock`.
- [x] e2e:
  - `e2e/checkin-camera.ts`: `addInitScript` thay `getUserMedia` bằng `canvas.captureStream()` vẽ QR do `qrcode` sinh; có chế độ từ chối.
  - `e2e/checkin-scan.spec.ts` mới: phủ mọi dòng Matrix.
  - Sửa test trang tạm trong `checker-invite-accept.spec.ts`.
  - `dashboard-shell.spec.ts`: thay test `ComingSoon` của tab "Quét vé" bằng các ca 0, 1 và ≥2 Sự kiện.
  - `shared-ticket.spec.ts`: thêm ca wake lock.

**Acceptance Criteria:**
- Given camera giả hiện một Mã QR vé, when chạy e2e ở cả `ios-webkit` và `android-chromium`, then body của `POST scans` có đúng `code` đó và `scanId` là uuid.
- Given hai mã khác nhau được quét liên tiếp, when mỗi overlay đóng, then mỗi request có một `scanId` riêng, và không có request thứ hai khi request đầu chưa xong.
- Given Màn quét rộng 320px, when ở bất kỳ trạng thái nào, then trang không cuộn ngang và nút ở đáy không bị che.
- Given mở `/xem-ve` với một Vé hợp lệ, when trang hiện Vé, then trang xin Wake Lock, và nhả khi tab ẩn.

## Implementation Notes

- **Đã làm (25/11/2026):** đủ 11 task.
  - Mới:
    - `lib/checkin/{scan-view,scan-sound,use-qr-scanner}.ts` (`scanView`, `checkedByText`, `createScanSound`, `useQrScanner`, `createScanGate`);
    - `components/tickee/{scanner-viewport,scan-result-overlay}.tsx` (`ManualLookupButton` dùng chung);
    - `quet-ve/{scan-event-picker.tsx,scannable-events.ts}`;
    - e2e: `checkin-camera.ts`, `checkin-scan.spec.ts`, `wake-lock-mock.ts` (`recordWakeLock` tách từ `my-tickets.spec.ts`);
    - unit test: `test/{scan-view,scan-gate,scannable-events}.test.ts`.
  - `checkin-mock.ts`: handler trả được `'abort'` (giả lỗi mạng); thêm `scanResult`.
- **Chọn khi spec chưa nói rõ:**
  - "Gần nhất" ở trang chọn hiểu là `abs(startsAt − now)` nhỏ nhất.
  - "Tra tay" (tắt) cũng hiện ở màn "Bật camera".
  - Lỗi mạng hay 5xx cũng tính cửa sổ bỏ qua 2 giây.
  - Mã dài hơn 512 ký tự vẫn gửi đi, api trả 400 và web hiện dải cảnh báo (review EC7 đã bác).
- **Sau review lượt 1 (P1–P9):**
  - `CameraUnavailable` có thêm "Thử lại".
  - jsQR tải lại ở vòng giải mã khi lần tải trước lỗi.
  - Track `ended` (hoặc thấy track đã chết khi tab hiện lại) thì xin camera lại.
  - Chạm đóng kết quả đỏ thì gọi lại `sound.unlock()`.
  - Gate mở khóa bằng effect sau khi overlay rời màn, không mở trong handler đóng.
  - Camera giả nhận kích thước khung (thêm hai ca 1280×720 và 720×1280).
  - Thêm test cho 403 khi tải lại, `pagehide`/`pageshow`, và mốc 2 giây của "quét lặp" (đo bằng timeline trong trang).
- **Sửa thêm khi chạy lại Verification:** chạy cả bộ spec thì test `pagehide`/`pageshow` hỏng ở `android-chromium`.
  - Nguyên nhân: `onPageShow` chỉ gọi `setVisible`. Khi `pagehide` và `pageshow` tới trước lúc React commit `visible=false`, hai lần cập nhật gộp thành "không đổi" nên effect không xin camera lại. Đây cùng lỗi với EC3, nhưng bản vá P7 chỉ sửa nhánh `visibilitychange`.
  - Sửa: `showAgain()` dùng chung cho `visibilitychange` (khi hiện) và `pageshow`.
  - Test: phát `pagehide` rồi `pageshow` trong cùng một lượt JS. Với handler cũ thì hỏng ở cả hai project; với code mới thì pass.

## Spec Change Log

## Review Triage Log

Lượt 1 (25/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Không test nào kiểm camera tắt khi tải lại Sự kiện trả 403 lúc đang quét | medium | Lớp VG đã kiểm: bỏ effect `eventNoAccess` → `stopScanner()` thì mọi test vẫn pass; test thu hồi ở `checker-invite-accept.spec.ts` không bật camera | patch (P1) |
| VG2 | Test thứ tự trang chọn không phân biệt được "gần bây giờ nhất" với tăng dần; hòa theo tên chưa test | medium | Lớp VG đã kiểm: mốc −1h/+3h/+7d cho cùng thứ tự với mọi cách sắp; `scannableEvents` không có unit test | patch (P2) |
| VG3 | Camera giả 640×480 không bao giờ chạy nhánh thu nhỏ và độ lệch dọc của vùng cắt | medium | Lớp VG đã kiểm: `side = size = 480`, lệch dọc luôn 0; đổi đích `drawImage` sang `side` vẫn pass. Máy thật trả 1280×720 hoặc khung dọc | patch (P3) |
| VG4 | `pagehide`/`pageshow` (bfcache) không test nào chạy | low | Lớp VG đã kiểm: test "rời trang" là điều hướng client; `setVisibility` chỉ phát `visibilitychange`; bỏ listener `pageshow` không test nào hỏng | patch (P4) |
| VG5 | Nhánh 2FA/đồng ý trong `onError` khi gửi quét chưa có test | low | Nhánh gần như không tới được: `GET /checkin/events/:id` bị `TotpGuard`/`ConsentGuard` chặn trước khi camera bật; step-up hiệu lực tới hết session (`totp.guard.ts:13`); đổi 2FA hủy session (E2-2) nên ra 401 | reject |
| BH1 | 2FA giữa lúc quét: `release()` khi `TOTP_REQUIRED` làm replay chồng nhiều overlay | low | Đúng về cơ chế (`providers.tsx` `mutation.execute` chạy lại callback của `useMutation`), nhưng không tới được như VG5. Sửa phải giữ khóa và biết lúc dialog bị hủy (`closeStepUp` bỏ retry), tức đổi API của `Providers` | reject |
| EC6 | Gate mở khi dialog step-up đang mở, retry phát lại lượt quét cũ | low | Trùng BH1 | reject (gộp BH1) |
| VG6 | (Other) quét không bị khóa khi overlay của lượt replay đang hiện | low | Trùng BH1 | reject (gộp BH1) |
| BH2 | Mã giữ trong khung: cứ ~3,5 giây gửi lại ra trung tính; quá 60 giây thì đỏ "bởi bạn" | low | Đúng: gate chỉ bỏ qua cùng mã 2 giây (luật trong Boundaries). Khách giữ QR trước camera hơn 60 giây là hiếm; trung tính vô hại. Sửa phải theo dõi mã rời khung | reject |
| EC9 | Mã giữ trong khung quá 60 giây ra đỏ | low | Trùng BH2 | reject (gộp BH2) |
| BH3 | Camera bận/lỗi (`NotReadableError`, `AbortError`) rơi vào "Không mở được camera" không có "Thử lại" | medium | Đúng: `use-qr-scanner.ts` gom mọi lỗi không phải quyền vào `unavailable` và `setWanted(false)`; `CameraUnavailable` chỉ có "Tra tay" (tắt). Quay lại tab sau khi dùng app camera khác thì phải tải lại trang | patch (P5) |
| EC5 | Lỗi tạm thời của `getUserMedia` không có "Thử lại" | medium | Trùng BH3 | patch (gộp P5) |
| BH4 | Tải chunk jsQR lỗi thì camera chạy mà không bao giờ giải mã, không báo, không thử lại | medium | Đúng: effect stream gọi `loadDecoder()` một lần, nuốt lỗi; `decode` giữ `null`. Deploy giữa buổi (hash chunk đổi) hay mạng chập chờn là gặp | patch (P6) |
| EC2 | Import jsQR lỗi → không giải mã, không thử lại | medium | Trùng BH4 | patch (gộp P6) |
| EC3 | Ẩn rồi hiện tab trước khi React commit `visible=false`: track đã dừng, effect không chạy lại, khung camera chết vẫn "running" | medium | Đúng về cơ chế: handler dừng track ngay, còn `setVisible` theo lô; iOS treo JS ngay sau khi ẩn nên lần render `false` có thể chưa commit. Lớp sửa chung với EC4 | patch (P7) |
| EC4 | Hệ điều hành kết thúc track khi tab đang hiện: khung chết, không phục hồi | medium | Đúng: không lắng nghe `ended` trên track; trạng thái giữ `running` | patch (gộp P7) |
| BH5 | Âm thanh chỉ mở khóa ở lần chạm "Bật camera"; sau cuộc gọi hay khóa màn hình iOS có thể im | low | Đúng: `AudioContext` bị `interrupted`, `resume()` ngoài cử chỉ có thể bị từ chối, trong khi camera tự bật lại. Sửa trực tiếp: gọi `unlock()` lại khi chạm đóng overlay | patch (P8) |
| BH6 | Không có dấu hiệu nào khi request quét đang chờ | low | Đúng, nhưng p95 < 1 giây nên bình thường không thấy; mạng chậm là việc của 5.4 (timeout 3 giây, `offline-banner`). Thêm UI mới ngoài spec | reject, để 5.4 xét (deferred-work) |
| EC8 | Request quét treo thì gate khóa mãi | low | Intent loại trừ: timeout 3 giây thuộc 5.4 (Never; AC 5.4 "client timeout 3 giây") | reject (5.4) |
| BH7 | Overlay đỏ đóng ngay khi có chạm lỡ; không có Escape; focus rơi về `<body>`; `role="alert"` thừa với `aria-live` | low | Chạm lỡ đúng lúc overlay hiện là hiếm, và đỏ còn có âm thanh; Escape không áp dụng trên điện thoại; sau khi đóng, màn chỉ còn nút "Tra tay" đã tắt; `role` thừa là vô hại. Sửa phải thêm thời gian chờ và xử lý focus | reject |
| BH8 | Không có lối ra trên route quét (bỏ `SiteHeader`) | low | Intent đã chọn bỏ `SiteHeader` (Boundaries, đã báo ở checkpoint); CTV không có bề mặt nào khác; Owner/Admin dùng Back | reject |
| EC15 | Màn lỗi và hết quyền không có lối ra | low | Trùng BH8 | reject (gộp BH8) |
| BH9 | Sắp theo `abs(startsAt − now)` đưa Sự kiện đã bắt đầu lâu xuống dưới Sự kiện sắp bắt đầu | low | Làm đúng quyết định đã duyệt "giờ bắt đầu gần nhất"; danh sách ngắn, người dùng vẫn chọn. Đổi nghĩa là đổi Quyết định | reject |
| EC12 | Sự kiện nhiều ngày đang diễn ra xếp sau Sự kiện sắp tới | low | Trùng BH9 | reject (gộp BH9) |
| BH10 | `scannableEvents` không có unit test, nằm trong file route | medium | Trùng phần test của VG2 | patch (gộp P2) |
| BH11 | Thiếu test: 403 khi tải lại (VG1), 2FA (VG5), Wake Lock `deny` ở Màn quét, trạng thái `stopped`, `unavailable` sau khi tab hiện lại | low | Phần 403 gộp P1; 2FA như VG5; `useScreenWakeLock` chế độ từ chối đã test ở `my-tickets.spec.ts`; `stopped` chỉ xảy ra cùng màn hết quyền đã test; `unavailable` sau tab hiện gộp P5 | gộp P1/P5; phần còn lại reject |
| BH12 | "lúc HH:MM" không có ngày khi check-in từ hôm trước | low | Sửa phải đổi Boundaries (HH:MM theo AC 5.3) | reject |
| EC10 | Thiếu ngày cho check-in khác ngày | low | Trùng BH12 | reject (gộp BH12) |
| BH13 | Test "quét lặp" chờ cố định 1 giây sau khi thấy overlay đóng, không đo mốc 2 giây; dễ chập chờn | low | Đúng: `toHaveCount(0)` có thể thấy muộn tới ~1 giây (nhịp poll), cộng 1 giây chờ là sát mốc 2 giây. Sửa trong test | patch (P9) |
| EC14 | Test quét lặp có thể chập chờn | low | Trùng BH13 | patch (gộp P9) |
| BH14 | `onError` lặp lại điều kiện của `handledByGateOrProviders`; `viewport` lặp `width`/`initialScale`; test chép chuỗi `SCAN_SEND_FAILED` | low | Trùng lặp vô hại; repo vẫn để test dùng chuỗi cố định để bắt đổi câu chữ | reject |
| EC1 | `crypto.randomUUID` thiếu (iOS Safari 15.0–15.3) thì gate khóa mãi | low | Thiết bị kẹt ở 15.0–15.3 rất hiếm (iPhone đời cũ lên được 15.8); camera cũng cần secure context. Sửa phải thêm dự phòng hoặc import chéo `lib/event/funnel` | reject |
| EC7 | Mã dài hơn 512 ký tự ra dải "Chưa gửi được" thay vì đỏ, gửi lại mỗi ~2 giây | low | Mã QR vé ~80 ký tự; QR lạ dài > 512 ký tự hiếm. Sửa phải thêm nhánh ở client | reject |
| EC11 | QR đảo màu không giải mã được (`dontInvert`) | low | `QrPlate` luôn vẽ QR đen trên tấm trắng kể cả theme tối; đảo màu hệ thống hiếm. `attemptBoth` gấp đôi chi phí giải mã | reject |
| EC13 | Trang chọn đang hiện danh sách, refetch còn 1 Sự kiện thì tự chuyển trang | low | Cần một Sự kiện kết thúc đúng lúc danh sách đang mở rồi refocus; sửa phải thêm cờ trạng thái | reject |

## Design Notes

- **Vì sao mỗi lần vào đều qua "Bật camera":** Safari iOS chỉ cho phát âm thanh sau một cử chỉ của người dùng. Tự bật camera khi quyền đã cấp thì âm cảnh báo của kết quả đỏ đầu tiên có thể không kêu.
- **Vì sao lỗi mạng không hiện đỏ:** đỏ nghĩa là Vé có vấn đề. Nếu lần gửi trước thực ra đã ghi, quét lại bằng `scanId` mới trong 60 giây sẽ ra `recent`, không ra đỏ. Thử lại cùng `scanId` là việc của 5.4.
- **Camera giả trong e2e:** vẽ QR lên canvas rồi dùng `captureStream()` làm `MediaStream`. Cách này kiểm cả vòng giải mã thật, không cần cờ trình duyệt.

## Verification

**Commands:**
- `pnpm --filter @tickee/web test`: expected pass.
- `pnpm typecheck && pnpm --filter @tickee/web lint:deps`: expected không lỗi.
- `sh scripts/dev-env.sh pnpm turbo build --filter=@tickee/web && pnpm --filter @tickee/web exec playwright test e2e/checkin-scan.spec.ts e2e/checker-invite-accept.spec.ts e2e/dashboard-shell.spec.ts e2e/shared-ticket.spec.ts`: expected pass ở cả hai project.

**Manual checks:**
- Trên iPhone (Safari) và Android (Chrome) thật qua HTTPS: quét một Vé thật thấy xanh, quét lại thấy trung tính, rồi để sau 60 giây thấy đỏ; kết quả đỏ có âm thanh.
