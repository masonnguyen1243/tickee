---
title: 'Story 4.2-b: Giao diện "Tạm ngừng bán" — banner, Kiểm tra lại, tab Quản trị'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '22fb1097a03c638e383a95570051468d37bf35ec'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 4.2-a đã có cờ dịch vụ thanh toán và API, nhưng BTC chỉ thấy một banner trơn không có hành động, không có chỗ bấm "Kiểm tra lại", banner không tự cập nhật khi cờ đổi, và Quản trị Tingee không có giao diện để xem hay mở lại BTC bị ngắt (FR-15, FR-34, UX-DR40, AD-17).

**Approach:** Banner của bốn mã notice có mô tả và một hành động theo vai; stream SSE cấp BTC làm banner tự tải lại khi có `org_status_changed`. Trang Tài khoản nhận tiền có khối "Dịch vụ thanh toán" (lý do, từ lúc nào, lần kiểm tra gần nhất, hướng dẫn, "Kiểm tra lại"). `/admin` thêm tab "Tạm ngừng bán" với "Mở lại".

## Boundaries & Constraints

**Always:**
- **Stream** `GET /v1/orgs/:orgId/live` (`reporting`, `ORG_READ`: Owner và Admin) chỉ đẩy `org_status_changed` của đúng BTC; mẫu `event-overview.controller.ts` (hub chưa sẵn sàng → 503). Banner dashboard (`StatusBannerStack`) dùng `useLiveResource`: mỗi tín hiệu tải lại `notices` và tổng quan Tài khoản nhận tiền; không có SSE thì poll 10 giây (AD-17).
- **Banner** (danger, không đóng được; một hành động; Owner/Admin theo bảng Open Question 1). Hành động "Mua thêm Token" là liên kết ngoài tới `notice.data.tingeePortalUrl` (tab mới, `noopener noreferrer`); các hành động khác dẫn tới trang Tài khoản nhận tiền. Mã lạ vẫn bị bỏ như hiện nay.
- **`POST …/payment-service/check`** trả `{ state: PaymentServiceState, outcome, retryAfterSeconds }`. `outcome`: `resumed` | `still_suspended` (gồm đổi lý do) | `unknown` | `no_target` | `cooldown` (lần trước chưa quá 30 giây; `retryAfterSeconds` = số giây còn lại) | `not_suspended`. `retryAfterSeconds` `null` trừ `cooldown`.
- **Khối "Dịch vụ thanh toán"** ở trang Tài khoản nhận tiền (đã `OwnerOnly`), chỉ hiện khi `paymentService.status = suspended`, đặt trên nội dung trang: `StatusBadge` danger, câu lý do, "Từ {since}", "Lần kiểm tra gần nhất: {checkedAt}" (chưa có → "Chưa kiểm tra"), hướng dẫn theo lý do, nút "Kiểm tra lại" (spinner, chặn bấm lặp) và toast theo `outcome`; `credential_invalid` kèm nút "Đổi key Tingee" mở đúng luồng thay key có sẵn (xác nhận lại). Giờ hiển thị theo `formatVnDateTime`.
- **Tab "Tạm ngừng bán"** ở `/admin`: bảng BTC đang ngắt (tên, lý do, từ lúc, lần kiểm tra gần nhất; ngắt lâu nhất trước, như API); "Mở lại" qua `ConfirmDialog` → 204 thì toast và tải lại; 409 `PAYMENT_SERVICE_NOT_SUSPENDED` xử lý như trạng thái đã đổi (toast + tải lại); cổng TOTP/đồng ý dùng lại cách xử lý của tab Closed Beta. Bảng trống: "Không có BTC nào đang Tạm ngừng bán."
- Mọi route mới qua bộ test cách ly (route SSE không được làm treo test đối chứng).

**Câu chữ (Mason chốt 13/11):** tiêu đề giữ của 4.2-a; mô tả nêu hậu quả hoặc nguyên nhân.

| Mã | Tiêu đề | Owner: mô tả · hành động | Admin: mô tả |
|----|---------|--------------------------|--------------|
| Token | Mọi Sự kiện có phí đang Tạm ngừng bán | Tingee báo đã hết Token (gói dịch vụ hết hạn). · "Mua thêm Token" (portal) | Tingee báo đã hết Token. Nhờ Owner mua thêm Token. |
| `tingee_disabled` | Tingee đang tạm ngừng dịch vụ thanh toán của BTC | Mọi Sự kiện có phí đang Tạm ngừng bán. · "Xem chi tiết" | Mọi Sự kiện có phí đang Tạm ngừng bán. Nhờ Owner liên hệ Tingee. |
| `credential_invalid` | Key Tingee không còn dùng được | Mọi Sự kiện có phí đang Tạm ngừng bán. · "Nhập lại key" | Mọi Sự kiện có phí đang Tạm ngừng bán. Nhờ Owner cập nhật key Tingee. |
| `gateway_permission_missing` | Key Tingee chưa được cấp quyền Cổng thanh toán | Mọi Sự kiện có phí đang Tạm ngừng bán. · "Xem cách xử lý" | Mọi Sự kiện có phí đang Tạm ngừng bán. Nhờ Owner cấp quyền Cổng thanh toán cho key Tingee. |

Khối "Dịch vụ thanh toán" — hướng dẫn: Token → "Mua thêm Token trên portal Tingee rồi bấm Kiểm tra lại." (+ liên kết portal); `tingee_disabled` → "Liên hệ Tingee để mở lại dịch vụ. Tickee tự kiểm tra mỗi 5 phút; bạn cũng có thể bấm Kiểm tra lại."; `credential_invalid` → "Key có thể đã bị thu hồi hoặc đổi trên Tingee. Đổi key Tingee để bán lại." (+ "Đổi key Tingee"); `gateway_permission_missing` → "Cấp quyền "Cổng thanh toán" cho key trên portal Tingee rồi bấm Kiểm tra lại. Tickee không tự kiểm tra được quyền này; nếu vẫn thiếu, lần bán vé kế tiếp sẽ tạm ngừng lại." (+ liên kết trang API key của portal).
Toast "Kiểm tra lại": `resumed` → "Dịch vụ thanh toán đã hoạt động lại. Sự kiện có phí bán lại bình thường."; `still_suspended` → "Tingee vẫn đang ngắt dịch vụ thanh toán."; `unknown` → "Chưa kiểm tra được với Tingee. Thử lại sau ít phút."; `no_target` → "BTC chưa có tài khoản nhận tiền mặc định."; `cooldown` → "Vừa kiểm tra xong. Thử lại sau {n} giây."; `not_suspended` → "Dịch vụ thanh toán đang hoạt động.".
Dialog Quản trị: "Mở lại dịch vụ thanh toán cho {tên BTC}?" — "Mọi Hạng vé có phí của BTC bán lại ngay và Tickee đối soát các Đơn đang mở. Nếu Tingee vẫn ngắt, lần tạo link kế tiếp sẽ tạm ngừng bán lại." Nhãn lý do ở bảng: "Hết Token", "Tingee ngắt dịch vụ", "Key không còn dùng được", "Key thiếu quyền Cổng thanh toán".

**Never:**
- Không đổi luật cờ, dò hay mở lại của 4.2-a; không đọc số dư Token (4.5); không nhãn C5 (4.2-c).
- Không thêm thông báo cho Người mua; trang công khai không đổi.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Banner Owner | Mỗi mã notice dịch vụ, vai Owner | Tiêu đề + mô tả + hành động đúng bảng; "Mua thêm Token" mở portal ở tab mới | N/A |
| Banner Admin | Mỗi mã, vai Admin | Tiêu đề + câu nhờ Owner, không hành động | N/A |
| Cờ đổi khi đang mở dashboard | SSE nhận `org_status_changed` | Banner xuất hiện/biến mất không cần tải trang; khối ở trang Tài khoản nhận tiền cập nhật | SSE mất → poll 10 giây |
| Stream cấp BTC | Owner/Admin mở `…/live`; người ngoài BTC | 200 `text/event-stream`, chỉ tín hiệu của BTC đó | Người ngoài → 403 `NOT_A_MEMBER`; hub chưa sẵn sàng → 503 |
| "Kiểm tra lại" | Mỗi `outcome` | Toast đúng câu; `resumed` → khối biến mất, banner biến mất | Lỗi mạng/5xx → toast lỗi chung, nút bấm lại được |
| Đang chờ 30 giây | `outcome = cooldown` | Toast "Vừa kiểm tra xong. Thử lại sau {n} giây." | N/A |
| Đổi key từ khối | Lý do `credential_invalid`, Owner bấm "Đổi key Tingee" | Mở luồng xác nhận lại + thay key có sẵn | Như luồng 2.13-b |
| Quản trị mở lại | Tab "Tạm ngừng bán", "Mở lại" → xác nhận | 204 → toast, hàng rời bảng | 409 → toast "đã đổi", tải lại; cổng TOTP như Closed Beta |

</frozen-after-approval>

## Code Map

Gốc `apps/web` trừ khi ghi khác. API: `apps/api/src`; contracts: `packages/contracts/src`.

- API stream: `modules/reporting/event-overview.controller.ts:26-45` (mẫu `@Get('live')`, `realtime.open(req,res,filter)`), `platform/realtime/realtime-hub.ts:36,127` (`SignalFilter`, 503 khi chưa `LISTEN`), `reporting/notices.controller.ts:12` (`ORG_READ`); contracts `realtime.ts:20-35`, mẫu đường `eventOverviewLiveApiPath` (`reporting.ts:178`). Test: `apps/api/test/platform/sse-client.ts` (`openSse`), `apps/api/test/reporting/event-overview.test.ts:96-100,229-280`.
- Cách ly: `apps/api/test/organizer/isolation.test.ts:38-42,128-137` gọi mọi route có guard trên BTC của chính người gọi và chờ hết body — route SSE sẽ treo hoặc 503; cần ca riêng (bỏ route `…/live` ở test đối chứng, kiểm bằng `openSse`) và `permissionOf('/v1/orgs/:orgId/live')` = `ORG_READ` (:102-109).
- API check: `modules/organizer/payment-service.controller.ts:18-23`, `PaymentServiceService.check` (`organizer/payment-service.ts:438`, bỏ kết quả `probe`), `PaymentServiceProbeOutcome` (:298; `skipped` gồm cả BTC `active` lẫn đang chờ), `PAYMENT_SERVICE_CHECK_COOLDOWN_SECONDS` (`organizer.ts:426`), `paymentServiceCheckApiPath` (:443). Admin API: `modules/admin/payment-service.controller.ts` (`GET …/payment-service/suspended`, `POST …/:id/payment-service/resume`), contracts `admin.ts:76-87`, `errors.ts:64` (`PAYMENT_SERVICE_NOT_SUSPENDED`).
- Notices web: `lib/reporting/status-notices.ts:9-51` (action chỉ `{label, section}`, nội dung tĩnh → cần biến thể liên kết ngoài lấy URL từ `notice.data`), `components/tickee/status-banner-stack.tsx:21-53,80-98` (`useQuery`, action `Link`), `lib/reporting/api.ts:7-23`; liên kết ngoài có sẵn `TingeeLink` (`app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/shared.tsx:50-62`, cục bộ) — chuyển về `components/tickee` để dùng chung.
- Realtime web: `lib/realtime/use-live-resource.ts:17-29,48` (một query; không có hook theo tín hiệu → thêm `onSignal` tùy chọn để tải lại tổng quan Tài khoản nhận tiền), `lib/realtime/live-signal.ts` (`effectivePollInterval`: poll chỉ khi chưa nối SSE), mẫu dùng `su-kien/[eventId]/event-overview.tsx:166-171`.
- Trang Tài khoản nhận tiền: `app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/payout-account-manager.tsx` (`useQuery` :58, `beginChangeKey` :70-92, `changeKey()` :93, trang :184-195 — khối đặt trước `{body}`), `shared.tsx` (`refreshOverview` :29, `applyOverview` :38, `TingeeGuide` :65), `lib/organizer/api.ts` (`payoutAccountQueryKey` :30; thêm fetcher "Kiểm tra lại").
- Admin web: `app/(admin)/admin/page.tsx`, `closed-beta-review.tsx` (`TABS` :36-55 theo `ClosedBetaStatus`, `isGateError`/`isStale` :61-68, `handleActionError` :217-234, `RevokeDialog` :159-187, `QueueTable` :91-153), `lib/admin/api.ts` (`changeClosedBeta` với `z.undefined()` cho 204).
- UI chung: `components/tickee/status-badge.tsx`, `confirm-dialog.tsx:10-43`, `formatVnDateTime` (contracts `event.ts:304`), `toast` của `sonner`, `messageOf`, `hasErrorCode`, `handledElsewhere`.
- Test web: `test/status-notices.test.ts:27-46` (đang khẳng định bốn mã KHÔNG có hành động — đổi), `e2e/status-banners.spec.ts` (`openDashboard` :21-31), `e2e/organizer-mock.ts` (`statusNotice` :64, `NOTICE_DEFAULTS` :57-61 thiếu bốn mã; thêm mặc định `GET /orgs/:id/live` → 503 như `OVERVIEW_LIVE_KEY` :24,51), `e2e/live-mock.ts` (`fakeEventSource`: thao tác lên stream MỚI NHẤT — stream cấp BTC của shell sẽ chen vào `e2e/event-overview.spec.ts:270`; cần lọc theo URL), `e2e/payout-account.spec.ts` (`overviewOf` :153-161 cố định `paymentService` active), `e2e/admin-mock.ts:41-90`, `e2e/admin-closed-beta.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/` -- `PaymentServiceCheckResult` (`state`, `outcome`, `retryAfterSeconds`), đường stream cấp BTC, đường API Quản trị.
- [x] `apps/api/src/modules/organizer/payment-service.ts`, `payment-service.controller.ts` -- `check` trả `outcome` (tách `skipped` thành `cooldown`/`not_suspended`, gộp `reason_changed` vào `still_suspended`), `retryAfterSeconds`.
- [x] `apps/api/src/modules/reporting/` -- controller stream `GET /v1/orgs/:orgId/live`.
- [x] `apps/api/test/` -- stream (Owner, Admin, người ngoài 403, chỉ tín hiệu của BTC), `check` theo từng `outcome`, cách ly.
- [x] `apps/web/lib/realtime/use-live-resource.ts` -- `onSignal` tùy chọn (+ unit test).
- [x] `apps/web/lib/reporting/status-notices.ts`, `components/tickee/status-banner-stack.tsx`, `components/tickee/tingee-link.tsx` (chuyển từ `shared.tsx`) -- câu chữ theo vai, hành động liên kết ngoài, SSE + poll 10 giây, tải lại tổng quan Tài khoản nhận tiền khi có tín hiệu.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/` + `lib/organizer/api.ts` -- khối "Dịch vụ thanh toán", "Kiểm tra lại", toast, "Đổi key Tingee" gọi `changeKey()`.
- [x] `apps/web/app/(admin)/admin/` + `lib/admin/api.ts` -- tab "Tạm ngừng bán", bảng, `ConfirmDialog` "Mở lại".
- [x] Test web: unit `status-notices`; e2e banner theo vai và mã (liên kết ngoài, mở tab mới), banner tự cập nhật qua SSE giả, khối + "Kiểm tra lại" theo từng `outcome`, tab Quản trị (mở lại, 409, cổng TOTP); sửa mock cho stream mới.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- đóng hai mục 4.2-b và mục `outcome` của 4.2-a.

**Acceptance Criteria:**
- Given Owner đang xem dashboard và cờ bật, when `org_status_changed` tới, then banner hiện trong vài giây mà không tải lại trang; cờ tắt thì banner biến mất.
- Given mọi test e2e hiện có (`event-overview`, `status-banners`, `payout-account`, `admin-closed-beta`, `dashboard-shell`), then vẫn pass sau khi shell mở stream cấp BTC.
- Given `pnpm lint:deps`, then không vi phạm module graph.

## Implementation Notes

- `check`: lần dò trả `skipped` (không giành được lượt, hoặc giành được mà kết quả đã cũ) → đọc lại cờ: `active` → `not_suspended`; `suspended` và đã có lần dò → `cooldown`, số giây còn chờ theo đồng hồ DB, làm tròn lên, tối thiểu 1 (kể cả ngay mốc 30 giây); `checked_at` NULL (vừa bị ngắt lại giữa lúc giành lượt và lúc đọc) → `unknown`. `PaymentServiceProbeOutcome` và job dò không đổi.
- Stream cấp BTC: `reporting/organization-live.controller.ts`. Test cách ly nhận diện route SSE theo đuôi `/live`: ca đối chứng bỏ qua chúng, ca riêng mở bằng `openSse` (BTC A: stream hoặc 4xx JSON, không `NOT_A_MEMBER`, stream cấp BTC luôn 200; BTC B: 403).
- `onSignal` chạy theo nhịp gom của `createSignalCoalescer` (`signalReload`, phần thuần có unit test); polling không gọi `onSignal`. Để khối "Dịch vụ thanh toán" theo kịp banner khi không có SSE, `StatusBannerStack` tải lại tổng quan Tài khoản nhận tiền khi khóa của các banner dịch vụ thanh toán đổi giữa hai lần polling (chỉ khi chưa nối SSE, tránh tải hai lần).
- Liên kết ngoài của banner: `{ label, urlKey: 'tingeePortalUrl' }`, `statusNoticeLink` chỉ nhận URL http(s) từ `notice.data`; thiếu hay sai dạng thì banner không có hành động.
- Khối: chưa có lần kiểm tra → cả dòng "Chưa kiểm tra". Câu lý do lấy ý tiêu đề banner của mã. Liên kết "Mở portal Tingee" (Token) và "Mở trang API key trên Tingee" (`{portal}/api-credentials`, thiếu quyền Cổng thanh toán). "Đổi key Tingee" ẩn khi luồng đổi key đang mở.
- `/admin`: tab thứ tư dùng chung cổng quyền (đọc theo danh sách của tab đang mở) và `handleActionError`; `PAYMENT_SERVICE_NOT_SUSPENDED` nằm trong `isStale`. Tiêu đề trang giữ "Duyệt Closed Beta".
- e2e: `fakeEventSource(page, { url })` chỉ điều khiển stream khớp URL (spec dashboard dùng `/overview/live$/` hoặc `ORG_LIVE_URL`); mock BTC mặc định trả 503 cho `GET /orgs/:id/live`.

## Spec Change Log

## Review Triage Log

Lượt 1 (14/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap. Lượt đầu của BH và VG treo khi máy ngủ, đã chạy lại.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | VG (gap), BH | Nhánh `skipped` + vẫn `suspended` + hết thời gian chờ → `unknown` của `check` không có test | low | patch | `payment-service.ts:471-478`; đổi sang `NOT_SUSPENDED` không test nào đỏ. |
| 2 | ECH, VG (other) | Ở mép 30 giây (giành lượt thất bại, đọc lại thì đã hết chờ) `check` trả `unknown` ("Chưa kiểm tra được với Tingee") dù chỉ là vừa hết chờ | low | patch | `claim` và câu đọc `cooldownLeft` là hai câu, `now()` khác nhau; còn `checked_at` thì trả `cooldown` tối thiểu 1 giây, chỉ `checked_at` null mới là `unknown`. |
| 3 | ECH, BH | Banner Closed Beta / chưa liên kết tài khoản không cập nhật trực tiếp khi SSE đang nối (chỉ cờ dịch vụ phát `org_status_changed`, poll tắt khi đã nối) | low | defer | Không phải hồi quy: trước 4.2-b các banner này cũng chỉ tải lại khi mở trang/quay lại tab (vẫn giữ). Thiếu nhà phát ở `closed-beta.ts` và liên kết/hủy tài khoản nhận tiền. |
| 4 | BH | Doc của stream nói phát "khi trạng thái của BTC đổi" | low | patch | Hiện chỉ cờ dịch vụ thanh toán phát; sửa câu doc ở controller và contracts. |
| 5 | ECH, BH | "Lần kiểm tra gần nhất" cũ khi trang đang mở (ghi `checked_at` không phát tín hiệu) | low | reject | Chỉ hiển thị; tải lại khi quay lại tab; mỗi lần dò phát tín hiệu là thêm tải cho một dòng chữ. |
| 6 | ECH, BH | Shell mở thêm một SSE mỗi tab dashboard; Tổng quan giữ hai stream: ngân sách 6 kết nối/origin của HTTP/1.1 | low | defer | Thêm vào mục HTTP/2 của 4.7 (`deferred-work.md`). |
| 7 | ECH | Tranh chấp giữa `probe` và lần đọc lại làm toast lệch với trạng thái | low | reject | Hiếm; khối và banner theo `state` trả về (nguồn đúng). |
| 8 | BH | Test cố định `retryAfterSeconds: 12` có thể ra 11 khi CI chậm | low | patch | `ceil(... - now())` tính ở câu sau `UPDATE`; kiểm khoảng 11–12. |
| 9 | BH | `OPEN_STREAM_ROUTES` viết cứng; route SSE mới làm test đối chứng treo | low | patch | Nhận route stream theo hậu tố `/live` trong `isolation.test.ts`. |
| 10 | BH | Liên kết ngoài không báo mở tab mới cho trình đọc màn hình | low | patch | `tingee-link.tsx` icon `aria-hidden`, không có chữ ẩn; thêm "(mở trong tab mới)" `sr-only`. |
| 11 | BH | "Kiểm tra lại" thành công huỷ lần tải tổng quan đang chạy rồi chỉ vá `paymentService` | low | patch | `payment-service-block.tsx` `onSuccess`: `setQueryData` xong thì `invalidateQueries` tổng quan. |
| 12 | BH | Contract kết quả chặt (`max`, enum đóng) trong khi web có nhánh dự phòng `?? 30` không bao giờ tới | low | reject | Bản web cũ gặp outcome mới chỉ hiện toast lỗi chung; nhánh dự phòng vô hại. |
| 13 | BH | Hai nút "Đổi key Tingee" cùng tên trên trang khi `credential_invalid` | low | reject | Phần đã khóa đặt nút trong khối; nút ở `LinkedView` là của 2.13-b; cùng một mutation. |
| 14 | BH | Tab Quản trị không có số đếm, không tự làm mới, tab không lưu trên URL | low | reject | Tiện ích; 409 đã xử lý khi hàng đã được mở lại nơi khác. |
| 15 | BH | Hai e2e chờ thật 10 giây thay vì `page.clock` | low | reject | Tốc độ test, không phải đúng sai; đổi sang `page.clock` với SSE giả tốn công. |
| 16 | BH | Stream cấp BTC vẫn mở sau khi Admin bị gỡ khỏi BTC | low | reject | Hành vi chung của `RealtimeHub` cho mọi stream; payload chỉ `{type}`; lần tải `notices` sau trả 403. |

## Design Notes

**Vì sao `outcome` ở response:** toast phải phân biệt "Tingee chưa trả lời" với "vẫn ngắt" và "đang chờ 30 giây" (deferred 4.2-a #4); `PaymentServiceState` trước/sau không đủ.

**Vì sao `onSignal`:** một stream cấp BTC phục vụ cả banner lẫn khối ở trang Tài khoản nhận tiền; mở hai stream cho cùng tín hiệu là thừa.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass (Postgres của `docker-compose.yml`).
- `pnpm --filter @tickee/web test` -- expected: pass.
- `pnpm --filter @tickee/web exec playwright test e2e/status-banners.spec.ts e2e/payout-account.spec.ts e2e/admin-closed-beta.spec.ts e2e/event-overview.spec.ts e2e/dashboard-shell.spec.ts` -- expected: pass.
