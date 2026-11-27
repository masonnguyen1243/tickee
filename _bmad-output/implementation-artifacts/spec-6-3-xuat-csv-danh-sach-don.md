---
title: 'Story 6.3: Xuất CSV danh sách Đơn'
type: 'feature'
created: '2026-11-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '3745d309df9d24c6837eda353a2c375c7d777efd'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Tab Đơn (6.1) đã xem và lọc được Đơn trên dashboard, nhưng BTC chưa đưa được danh sách ra Excel để đối chiếu hay gửi kế toán (FR-31, UX-DR37, `EXPERIENCE.md:74`). Story 7.2 sẽ dùng lại chuẩn CSV của story này cho danh sách hoàn tiền.

**Approach:**
- **API (`reporting`, `orders.view`):** `GET /v1/orgs/:orgId/events/:eventId/orders/export?status=&q=` trả `text/csv`, stream theo cursor, cùng bộ lọc với danh sách 6.1. Mỗi lần xuất ghi audit trước khi stream.
- **Read model mới:** `ordering` (câu trả lời form theo lô, cột câu hỏi của Sự kiện), `ticketing` (đếm check-in theo lô Đơn).
- **Contracts:**
  - chuẩn CSV dùng chung `csv.ts` (BOM, thoát ô, dòng);
  - query và đường API xuất;
  - nhãn trạng thái Đơn và loại Cần xử lý chuyển từ web sang contracts, để api và web dùng chung.
- **Web:** nút "Xuất CSV" ở tab Đơn. Tải bằng `fetch` + `Blob` theo bộ lọc trên URL.

**Quyết định (Mason, 26/11/2026):**
- **Cột câu hỏi form theo id câu hỏi:**
  - mỗi `question_id` có trong câu trả lời của Sự kiện là một cột;
  - tiêu đề là nhãn lúc đặt của Đơn mới nhất có câu đó; thứ tự theo `position` của lần đặt đó;
  - đổi nhãn vẫn chỉ một cột (nhãn mới nhất). Câu đã xóa vẫn có cột vì Đơn cũ còn câu trả lời.
- **SĐT dạng "0912 345 678"** (nhóm 4-3-3): Excel và Google Sheets giữ là chữ, không mất số 0 đầu. Số không phải di động Việt Nam 10 chữ số thì giữ như `localBuyerPhone`.
- **Phân cách bằng dấu phẩy `,`** (RFC 4180). Máy đặt Region Việt Nam (List separator `;`) phải mở qua Data › From Text/CSV. Không thêm dòng `sep=`.
- **Giữ spec một file** dù khoảng 6.000 token, trên ngưỡng 5.000.

**Quyết định sau review (Mason, 27/11/2026):**
- **Check-in thành hai cột số** (Review Triage #1): "Đã check-in" (k, số Vé `valid` đã check-in) và "Số Vé" (N, số Vé `valid` của Đơn), thay cho một ô "k/N". Lý do: Excel và Google Sheets đổi "2/3", "1/1" thành ngày. Đơn không có Vé `valid` thì cả hai ô trống. Đây là lệch có chủ đích so với chữ "k/N" của AC 6.3; lần đối chiếu spec sau retro Epic 6 gom về `epics.md`.
- **Câu trả lời form toàn chữ số** (Review Triage #2): câu trả lời chỉ gồm chữ số, bắt đầu bằng `0` hoặc dài từ 12 chữ số, được thêm `'` ở đầu như ô bị thoát. Excel giữ đủ chữ số (vd. CCCD `001203004567`), ô hiện dấu `'`.
- **Giữ code đã làm, sửa đúng chỗ**: không revert để chạy lại bước 2–4 như quy trình intent_gap.

## Boundaries & Constraints

**Always:**
- **Quyền và phạm vi:**
  - Route `export` nằm trong `EventOrdersController`, khai báo trước `@Get(':code')`, có `@RequirePermission(Permission.ORDERS_VIEW)`. CTV nhận `403 NOT_A_MEMBER` từ guard.
  - Query sai (status lạ, `q` không nhận ra) trả `400 VALIDATION_FAILED`. Sự kiện lạ hoặc của BTC khác trả `404 EVENT_NOT_FOUND`. Cả hai trả JSON trước khi gửi header CSV.
  - Không chặn theo trạng thái khóa của BTC hay Sự kiện: không gọi `organizationLocked`, không xét `events.locked_at`. BTC bị khóa vẫn xuất được (7.4).
- **Bộ lọc:**
  - `EventOrderExportQuery` gồm `status?` và `q?`, cùng nghĩa và cùng cách parse với `EventOrderListQuery`, không có `cursor` và `limit`.
  - `needs_action` lọc theo id các Đơn có mục `open`, như `list`. Code chuyển bộ lọc dùng chung với `list`, không chép.
- **Stream:**
  - lặp `eventOrdersPageOf` theo cursor, mỗi lô 500 Đơn, thứ tự `created_at DESC, code DESC`;
  - số câu truy vấn mỗi lô cố định: Đơn + items, câu trả lời, đếm check-in, `openReviewsOf`;
  - ghi theo backpressure: `write` trả `false` thì chờ `drain`. Client ngắt thì dừng đọc DB;
  - lỗi giữa chừng: log (không dữ liệu cá nhân) rồi `destroy` kết nối, không ghi dòng lỗi vào file;
  - header: `content-type: text/csv; charset=utf-8`, `content-disposition: attachment; filename="don-<slug>-<yyyyMMdd-HHmm>.csv"` (giờ Việt Nam), `cache-control: no-store`;
  - CORS thêm `exposedHeaders: ['Content-Disposition']` để web đọc được tên file.
- **Định dạng** (`packages/contracts/src/csv.ts`, 7.2 dùng lại):
  - file bắt đầu bằng BOM U+FEFF (byte `EF BB BF`), phân cách `,`, xuống dòng `\r\n`;
  - ô bắt đầu bằng `=`, `+`, `-`, `@`, tab hoặc CR được thêm `'` ở đầu. Sau đó, ô chứa `"`, ký tự phân cách, CR hoặc LF được bọc `"…"`, và `"` bên trong nhân đôi;
  - `null` thành ô trống.
- **Cột**, theo thứ tự, tên cột tiếng Việt:
  1. Mã Đơn (`TK…`);
  2. Tên người mua · Email · SĐT (dạng "0912 345 678", theo Quyết định);
  3. Vé: dạng "2 × VIP, 1 × Thường", cùng chuỗi với tab Đơn;
  4. Số tiền (`total_amount`) · Đã nhận (`paid_amount`, trống khi null). Cả hai là số nguyên VND, không dấu chấm, không "đ";
  5. Trạng thái: nhãn tiếng Việt như badge · Cần xử lý: tên loại của mục `open` cũ nhất, ở mọi trạng thái Đơn, trống nếu không có;
  6. Thời gian tạo · Thời gian thanh toán: `yyyy-MM-dd HH:mm:ss` theo `Asia/Ho_Chi_Minh` (offset +07:00 cố định như `vnParts`);
  7. Đã check-in · Số Vé: hai cột số, theo Quyết định sau review. Đơn không có Vé `valid` thì cả hai ô trống;
  8. mỗi câu hỏi form một cột, theo Quyết định. Tập cột tính trên mọi Đơn của Sự kiện, không theo bộ lọc, nên mọi lần xuất của một Sự kiện có cùng cột.
- **Không lộ:** không có id nội bộ, Mã QR hay token chia sẻ.
- **Audit:**
  - mỗi lần xuất ghi một `event_orders.exported` (actor, BTC, target `{type:'event', id: eventId}`), trong transaction riêng, sau khi kiểm query và Sự kiện, trước byte đầu tiên;
  - bộ lọc ghi vào `changedFields` dạng `status:<chip>` và `q:<code|email|phone>`. Không bao giờ ghi giá trị `q`.
- **Log:** không log `q`, email, SĐT hay tên.
- **Web, tab Đơn:**
  - nút "Xuất CSV" `variant="secondary"`, icon `Download`, đặt ở hàng công cụ cùng chip và ô tìm; từ `md` căn phải;
  - xuất theo bộ lọc đang áp dụng trên URL (`trangThai`, `tim` đã gửi), không theo chữ đang gõ dở trong ô tìm;
  - khi bấm: nút `loading` (spinner, chặn bấm lặp) tới khi tải xong. `fetch` kèm cookie, nhận `Blob`, rồi tạo `<a download>` tạm và thu hồi URL sau `setTimeout(0)` (mẫu `enroll-form.tsx:150-161`). Tên file lấy từ `Content-Disposition`, thiếu thì dùng `don.csv`;
  - `401` thì chuyển sang đăng nhập (`useGoToLogin`). Lỗi khác hoặc đứt giữa chừng thì toast "Chưa xuất được CSV. Vui lòng thử lại.";
  - nút luôn hiện, kể cả khi danh sách trống (file khi đó chỉ có hàng tiêu đề).

**Never:**
- Không migration, không thêm index.
- Không thêm giới hạn tốc độ cho route này, nên không kích hoạt vế helper của `epic-5-retro-e5-5-no-ky-thuat`. Lý do: chỉ Owner/Admin đã đăng nhập gọi được, và mỗi lô có số truy vấn cố định.
- Không nạp mọi Đơn vào bộ nhớ ở server, không đếm tổng trước khi stream.
- Không sửa `contracts/organizer.ts`, `organizer/payment-service.ts`, `can-xu-ly/review-queue.tsx` (E4-10). Dùng quyền `orders.view` có sẵn, không thêm quyền mới.
- Không thêm dòng `sep=` (Excel sẽ bỏ qua BOM). Không dùng công thức `="…"` để giữ số 0 đầu.
- Không có cột lịch sử trạng thái hay danh sách Vé từng người; Vé chỉ có hai cột số "Đã check-in" và "Số Vé".
- Không làm Google Sheets (6.4–6.6) hay CSV hoàn tiền (7.2).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Lọc trạng thái | `status=paid`; 3 Đơn `paid`, 2 `pending` | BOM, hàng tiêu đề, 3 dòng | N/A |
| Nhiều lô | 1.201 Đơn, có Đơn trùng `created_at` ở ranh giới lô | 1.201 dòng, mới nhất trước, không mất, không lặp | N/A |
| Ô nguy hiểm | tên `=HYPERLINK("x")`, câu trả lời `-1`, `@a`, `\tb` | `'=HYPERLINK(""x"")` (bọc ngoặc kép), `'-1`, `'@a`, `'\tb` | N/A |
| Ô có phân cách, ngoặc kép, xuống dòng | câu trả lời `A, "B"` + xuống dòng | bọc `"…"`, `"` nhân đôi, giữ nguyên xuống dòng | N/A |
| Duyệt tay lệch tiền | Đơn 300.000đ, nhận 250.000đ | Số tiền `300000`, Đã nhận `250000`, Trạng thái "Đã thanh toán" | N/A |
| Đơn chờ thanh toán | `pending` | Đã nhận, Thời gian thanh toán, Đã check-in, Số Vé trống | N/A |
| Check-in | Đơn 3 Vé `valid`, 2 đã check-in | Đã check-in `2`, Số Vé `3` | N/A |
| Câu trả lời toàn chữ số | `001203004567`, `0987654321`, `123456789012`, `42` | `'001203004567`, `'0987654321`, `'123456789012`, `42` | N/A |
| Không Đơn nào khớp | `q` là email không có Đơn | BOM + hàng tiêu đề | N/A |
| Query sai | `status=abc` hoặc `q=0912` | — | `400 VALIDATION_FAILED` (JSON) |
| Sự kiện lạ hoặc của BTC khác | id ngẫu nhiên | — | `404 EVENT_NOT_FOUND` (JSON) |
| CTV gọi | CTV được giao Sự kiện | — | `403 NOT_A_MEMBER` |
| Client ngắt giữa chừng | đóng kết nối sau lô đầu | api dừng đọc DB, không lỗi 500, không log lỗi | N/A |

</frozen-after-approval>

## Code Map

**API**
- `apps/api/src/modules/reporting/event-orders.controller.ts`: `@Get(':code')` ở :29; route `export` phải khai báo trước. Ghi raw response bằng `@Res()` Express, theo mẫu SSE ở `event-overview.controller.ts:37-56` và `platform/realtime/realtime-hub.ts:128-150` (`flushHeaders`, kiểm `res.destroyed`/`writableEnded`).
- `apps/api/src/modules/reporting/event-orders.service.ts`:
  - `FILTER_STATUSES` :36. `list` :126 dựng `EventOrdersPageFilter`, và `needs_action` gọi `eventOpenReviewItemsOf` (`reporting/event-open-reviews.ts:12`). Tách phần này thành hàm dùng chung cho `list` và `export`;
  - `rowOf` :47 là mẫu dòng.
- `apps/api/src/modules/ordering/event-orders-read.ts`:
  - `eventOrdersPageOf` :79. `limit` không bị chặn bên trong (chặn 100 chỉ nằm ở schema zod). Mỗi trang 2 truy vấn (`itemsOfOrders` :183). Keyset :92;
  - thêm `answerColumnsOf(db, scope, eventId)` (`DISTINCT ON (question_id)`, lấy nhãn và `position` của Đơn mới nhất) và `answersOfOrders(db, orderIds)`. Xuất qua `ordering/index.ts`.
- `apps/api/src/modules/ordering/schema.ts:214-234`: `order_answers` có `question_id` (NOT NULL), `position`, `label`, `kind`, `answer`, `option_id`; unique `(order_id, question_id)`.
- `apps/api/src/modules/ticketing/`:
  - thêm `checkinCountsOfOrders(db, scope, eventId, orderIds)`: `GROUP BY order_id` trên Vé `valid`, đếm `checked_in_at IS NOT NULL`;
  - mẫu: `checkinCountsByTicketType` (`check-in.ts:187`). `validTicketsOfOrders` (`lookup-read.ts:25`) trả từng Vé nên không dùng. Xuất qua `ticketing/index.ts`.
- `apps/api/src/modules/event/ticket-type.service.ts:52`: `assertEventOfOrganization` trả `void`. Cần một biến thể trả `slug` (cột `event/schema.ts:34`) cho tên file, xuất qua `event/index.ts`, không đọc thêm lần nữa.
- `apps/api/src/platform/audit/audit.ts`:
  - union `AuditAction` :6-199: thêm `'event_orders.exported'`;
  - `audit.record(tx, …)` :224. Bảng không có cột metadata, chỉ `changed_fields text[]`;
  - mẫu audit một lần đọc: `platform/access/platform-admin-scope.ts:19-31`.
- `apps/api/src/roles/api.ts:24`: `enableCors` thêm `exposedHeaders`.
- `apps/api/src/platform/logging/pino-options.ts:85` `redactUrlQuery` đã che giá trị query.
- Test:
  - `apps/api/test/reporting/event-orders.test.ts` là mẫu dựng dữ liệu;
  - `apps/api/test/organizer/isolation.test.ts`: `guarded` :84 và :140-141, `permissionOf` :167 và :180-181, số route `toHaveLength(30)` :406. Test ở :403-420 gọi mọi route bằng id Sự kiện ngẫu nhiên và chờ JSON 404.

**Contracts**
- `packages/contracts/src/event-orders.ts`: chú thích :16 (CSV dùng lại bộ lọc), `EventOrderListQuery` :133, `eventOrdersApiPath` :296.
- `packages/contracts/src/event.ts`: `vnParts` :258 (private), `formatVnDateTime` :392. Thêm hàm xuất dạng `yyyy-MM-dd HH:mm:ss` cạnh đó.
- `packages/contracts/src/order.ts:95` `localBuyerPhone` (`+84912345678` → `0912345678`).
- Nhãn đang nằm ở `apps/web/lib/reporting/overview.ts:35-55` (`ORDER_STATUS_BADGE`, `REVIEW_TYPE_LABEL`). Chuyển nhãn sang contracts (`order.ts`, `payment.ts`). Web giữ `ORDER_STATUS_BADGE` (thêm tone) và re-export `REVIEW_TYPE_LABEL`, để `orders.ts` và `lib/reporting/review-queue.ts` không phải sửa.

**Web** (gốc `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/`)
- `orders-tab.tsx`:
  - `OrdersTab` :513-534 đọc bộ lọc từ URL (`ordersFilterFromParams`);
  - hàng công cụ :521-524 (`FilterChips`, `SearchForm`);
  - 401 dùng `useGoToLogin` :374-384.
- `apps/web/lib/reporting/orders.ts:190-204` `fetchEventOrders`: chuyển bộ lọc thành `{status, q}`. Thêm hàm tải CSV.
- `apps/web/lib/api/client.ts`: `apiBaseUrl` :16-20, `fetch(…, {credentials:'include'})` :62. `performApiRequest` parse JSON mọi response, nên CSV cần `fetch` riêng, nhưng vẫn đổi lỗi JSON thành `ApiError` như cũ.
- `apps/web/app/(public)/bao-mat/totp/enroll-form.tsx:150-161`: mẫu tải `Blob`.
- `apps/web/components/ui/button.tsx:46-84`: prop `loading`.
- Test:
  - `apps/web/e2e/event-orders.spec.ts`;
  - `mockOrganizerApi` (`e2e/organizer-mock.ts:210-238`) ép mọi response thành JSON, nên route CSV phải dùng `page.route` riêng;
  - mẫu test tải file: `e2e/totp.spec.ts:131-136`;
  - vitest: `apps/web/test/event-orders.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/csv.ts` (+ `index.ts`, `packages/contracts/test/csv.test.ts`) -- `CSV_BOM`, `csvCell`, `csvRow` -- chuẩn dùng chung cho 6.3 và 7.2; test mọi ký tự thoát của I/O Matrix.
- [x] `packages/contracts/src/event-orders.ts` (+ test) -- `EventOrderExportQuery`, `eventOrdersExportApiPath`, tên file `don-<slug>-<yyyyMMdd-HHmm>.csv`, định dạng SĐT cho CSV -- hợp đồng chung api/web.
- [x] `packages/contracts/src/event.ts`, `order.ts`, `payment.ts` -- hàm giờ `yyyy-MM-dd HH:mm:ss`, `ORDER_STATUS_LABEL`, `REVIEW_TYPE_LABEL` -- api và web dùng chung nhãn và giờ.
- [x] `apps/web/lib/reporting/overview.ts` -- lấy nhãn từ contracts, giữ nguyên export của file -- không đổi hành vi web.
- [x] `apps/api/src/modules/ordering/event-orders-read.ts` (+ `index.ts`) -- `answerColumnsOf`, `answersOfOrders` -- cột form theo Quyết định.
- [x] `apps/api/src/modules/ticketing/` (file read mới + `index.ts`) -- `checkinCountsOfOrders` -- cột "k/N".
- [x] `apps/api/src/modules/event/ticket-type.service.ts` (+ `index.ts`) -- biến thể kiểm Sự kiện trả `slug` -- tên file.
- [x] `apps/api/src/platform/audit/audit.ts` -- `event_orders.exported` -- AC audit.
- [x] `apps/api/src/modules/reporting/event-orders-csv.ts` (mới) -- hàm thuần dựng hàng tiêu đề và dòng từ dữ liệu một lô -- tách định dạng khỏi stream để test.
- [x] `apps/api/src/modules/reporting/event-orders.service.ts`, `event-orders.controller.ts` -- bộ lọc dùng chung, `export` (kiểm, audit, header, stream theo lô, backpressure, ngắt) -- AC 6.3.
- [x] `apps/api/src/roles/api.ts` -- `exposedHeaders: ['Content-Disposition']` -- web đọc tên file.
- [x] `apps/api/test/reporting/event-orders-export.test.ts` (mới) -- mọi dòng của I/O Matrix; audit (không chứa giá trị `q`); header và tên file; cột form khi đổi nhãn và xóa câu hỏi; số truy vấn mỗi lô không đổi theo số Đơn; không có id, QR hay token -- khóa hành vi API.
- [x] `apps/api/test/organizer/isolation.test.ts` -- thêm route vào `guarded` và `permissionOf`, đổi số route thành 31 -- cách ly BTC.
- [x] `apps/web/lib/reporting/orders.ts` (+ `apps/web/test/event-orders.test.ts`) -- dựng đường xuất từ bộ lọc, tải `Blob`, đọc tên file -- dùng chung, có test.
- [x] `…/[eventId]/orders-tab.tsx` -- nút "Xuất CSV" như ở Always.
- [x] `apps/web/e2e/event-orders.spec.ts` (+ `organizer-mock.ts` nếu cần) -- tải file theo bộ lọc trên URL; lỗi 500 hiện toast và bấm lại được; 375px không cuộn ngang -- khóa UI.

**Acceptance Criteria:**
- Given tab Đơn đang lọc "Đã thanh toán" và tìm theo một email, when bấm "Xuất CSV", then request mang `status=paid` và `q` là email đó, nút hiện spinner, và file tải về có tên `don-<slug>-….csv`.
- Given một file đã xuất, when đọc các byte đầu, then file bắt đầu bằng `EF BB BF`, tiếp theo là hàng tiêu đề, rồi mỗi Đơn một dòng.
- Given một lần xuất có tìm theo SĐT, when đọc `audit_events`, then có đúng một `event_orders.exported` với actor, BTC và Sự kiện, `changedFields` có `q:phone` và không chứa SĐT.
- Given API trả 500 hoặc kết nối đứt giữa chừng, when bấm "Xuất CSV", then hiện toast lỗi và nút bấm lại được.

## Implementation Notes

- **Thứ tự cột form khi trùng `position`:** câu của Đơn mới hơn đứng trước (vd. câu mới chiếm vị trí của câu đã xóa đứng trước câu đã xóa), rồi theo id câu hỏi. `answerColumnsOf` sắp trong SQL (`DISTINCT ON` trong subquery, rồi `position`, `created_at DESC`, `code DESC`, `question_id`).
- **Lỗi do nơi khác xử lý:** 2FA (`TOTP_REQUIRED`), đồng ý NĐ 13 và `NOT_A_MEMBER` không hiện toast "Chưa xuất được CSV…", theo `handledElsewhere` như các mutation khác của dashboard; nút dùng `useMutation` nên qua 2FA xong tự xuất lại. 401 → `useGoToLogin`.
- **Bố cục hàng công cụ:** grid; dưới `md` theo thứ tự chip → ô tìm → "Xuất CSV" (căn trái); từ `md` nút nằm cùng hàng chip, căn phải. Thứ tự DOM (và Tab) vẫn là chip → ô tìm → nút.
- **Lỗi trước byte đầu tiên:** phần đầu file (BOM + tiêu đề) không đọc DB nên thực tế mọi lỗi đọc lô đều sau khi đã gửi header → log + `destroy`. Nhánh "chưa gửi header" trong controller ném lại cho `ErrorFilter` (JSON) để phòng.
- **Ngoài Code Map:** `assertEventOfOrganization` gọi `eventSlugOfOrganization` (một câu, chọn `slug`); chuỗi "2 × VIP, 1 × Thường" chuyển sang contracts (`eventOrderItemsText`), web `orderItemsLabel` dùng lại; `apps/web/lib/api/client.ts` tách `fetchApi`/`errorOf` dùng chung cho `performApiRequest` và `apiDownload` mới; thêm test ở `packages/contracts/test/{event,order,payment}.test.ts`, `apps/web/test/api-client.test.ts`.
- **Kiểm chứng (27/11/2026):** `pnpm typecheck`, `pnpm lint:deps` sạch; `pnpm test` xanh (contracts 395, web 501, api 1828; sau đó thêm ca lỗi DB giữa chừng: `event-orders-export.test.ts` 20/20); `pnpm test:e2e` 1394 xanh trên `ios-webkit` và `android-chromium`. Kiểm đột biến: bỏ dừng khi client ngắt → test ngắt đỏ (đọc 3 lô thay vì 1); log nguyên lỗi DB → test lỗi giữa chừng đỏ. Ảnh chụp hàng công cụ ở 375, 768, 1024, 1280px bằng mock e2e. Chưa làm bước kiểm thủ công (mở file bằng Excel/Sheets trên dev stack).
- **Sau review (27/11/2026):** cột "Check-in" tách thành hai cột số "Đã check-in", "Số Vé" (cùng vị trí; không có Vé `valid` → cả hai trống); câu trả lời form toàn chữ số bắt đầu bằng `0` hoặc từ 12 chữ số thêm `'` (`csvDigitsAsText` ở `csv.ts`, chỉ cho ô câu trả lời); `CSV_BOM` viết bằng escape `\uFEFF` trong nguồn; nhánh lỗi trước byte đầu tiên gỡ cả `content-type`, `content-disposition`, `cache-control`. Test thêm: câu trả lời toàn chữ số; backpressure (client tạm dừng đọc, có `write` trả `false`, file đủ và đúng thứ tự); client ngắt thì generator đã kết thúc; 404 không sinh audit. Kiểm đột biến: bỏ guard `res.destroyed` ở `writeChunk` → test ngắt đỏ; `drain` coi như đóng → test backpressure đỏ. `event-orders-export.test.ts` 22/22, `csv.test.ts` 10/10.
- **Kiểm chứng lại sau review (27/11/2026):** `pnpm typecheck`, `pnpm lint:deps` sạch; `pnpm test` xanh (contracts 397, web 501, api 1831); `pnpm test:e2e` 1392 xanh, 2 đỏ ở spec không dính 6.3: `event-image.spec.ts` (chạy lại 3 lần: 108/108 xanh) và `public-event-revalidate.spec.ts` (chạy tuần tự 10/10 xanh; đỏ khi hai project chạy song song vì dùng chung cache Next). Thuộc nhóm test chập chờn của action item E2-8.
- **Quy trình:** review ra hai intent_gap (Triage #1, #2); Mason chốt cách sửa và chọn giữ code, sửa tại chỗ thay cho revert rồi chạy lại bước 2–4 (Quyết định sau review).

## Spec Change Log

## Review Triage Log

| # | Lớp | Phát hiện | Verdict | Route | Bằng chứng |
|---|-----|-----------|---------|-------|------------|
| 1 | BH | Ô Check-in "k/N" (vd. `2/3`, `1/1`) bị Excel và Google Sheets đổi thành ngày theo Region; `0/1` giữ là chữ, nên một cột lẫn hai kiểu | medium | intent_gap | `event-orders-csv.ts` (`eventOrderCsvLine`, ô check-in) ghi đúng dạng "k/N" mà phần frozen chốt (AC 6.3). Excel nhận `d/m` hay `m/d` là ngày khi mở CSV trực tiếp; Implementation Notes đã ghi rủi ro này. Đổi dạng ô là đổi intent. Mason chốt 27/11/2026: hai cột số "Đã check-in", "Số Vé"; giữ code, sửa tại chỗ. |
| 2 | BH | Câu trả lời form toàn chữ số (CCCD 12 số, SĐT người thân) mất số 0 đầu hoặc hiện dạng khoa học khi mở bằng Excel | medium | intent_gap | Chỉ SĐT người mua có `csvBuyerPhone`; câu trả lời đi thẳng qua `csvCell`. Giải chạy thường hỏi CCCD (`001…`). Intent chỉ chốt thoát chống injection và dạng SĐT người mua, không nói về câu trả lời dạng số. Mason chốt 27/11/2026: thêm `'` cho câu trả lời toàn chữ số bắt đầu bằng 0 hoặc từ 12 chữ số; giữ code, sửa tại chỗ. |
| 3 | BH | Hai cột cùng tiêu đề khi xóa rồi tạo lại câu hỏi cùng nhãn | low | reject | Có thật (`answerColumnsOf` theo `question_id`), nhưng hiếm (xóa rồi tạo lại đúng nhãn sau khi đã có Đơn), dữ liệu mỗi cột vẫn đúng; thêm hậu tố là thêm nhánh và lệch Quyết định "tiêu đề là nhãn lúc đặt". |
| 4 | BH | Lỗi trước byte đầu tiên trả JSON mà vẫn mang `content-type: text/csv` | low | patch | `send` đặt `content-type`/`cache-control` trước vòng lặp, nhánh lỗi chỉ gỡ `content-disposition`; Express 5 `res.json` giữ `Content-Type` đã đặt (`express/lib/response.js:245`). Hôm nay khó tới (phần đầu file không đọc DB), nhưng nhánh này sai đúng mục đích chú thích của nó; sửa thẳng: gỡ cả hai header. |
| 5 | BH | Xuất đồng thời chiếm hết pool DB (3 kết nối mỗi lô, `max: 10`) trong thời gian dài | false | reject | Mỗi câu lấy rồi trả kết nối ngay (`db.orm` trên pool); giữa hai lô (chờ `drain`, ghi) không giữ kết nối nào. Ba câu `Promise.all` chỉ giữ 3 kết nối trong vài ms, như `overview` của 6.2. |
| 6 | BH | `answersOfOrders` (xuất ở `ordering/index.ts`) không lọc `orgScope`/`event_id` | low | reject | Đúng như chú thích đầu file: hàm theo lô id Đơn nhận id đã lọc ở câu trước; cùng kiểu `openReviewsOf` (`payment`). Chỉ hại khi một nơi gọi tương lai truyền id chưa lọc; thêm join là thêm tham số. |
| 7 | BH | `CSV_BOM` là ký tự U+FEFF vô hình viết thẳng trong nguồn | low | patch | `packages/contracts/src/csv.ts`: người đọc và review không thấy ký tự; công cụ xóa nó thì Excel hỏng tiếng Việt. Sửa thẳng thành `'\uFEFF'`. |
| 8 | BH | `apiDownload` lưu mọi response 2xx thành CSV, không kiểm `content-type` | low | reject | Chỉ gặp khi proxy/captive portal trả 200 HTML cho request có cookie tới api: hiếm; sửa là thêm nhánh. |
| 9 | BH | Không hủy hay timeout được lần tải; rời tab vẫn `saveBlob` | low | reject | `onSuccess` đặt trên `useMutation` nên file vẫn tải khi người dùng sang tab khác: đúng ý (họ đã bấm xuất). Server treo không trả là hiếm; thêm timeout là thêm nhánh. |
| 10 | BH | e2e không thử file cụt giữa chừng trên trình duyệt thật | low | reject | `apiDownload` đã có test luồng thân lỗi (`api-client.test.ts`), api có test cắt kết nối giữa chừng; Playwright `route.fulfill` không gửi được thân dở. Fetch reject khi thân chunked bị cắt là hành vi chuẩn. |
| 11 | BH | `HEAD …/orders/export` chạy trọn lần xuất (audit + đọc mọi lô) | low | reject | Express cho `HEAD` đi vào handler `GET`. Cần cookie Owner/Admin và một client gửi `HEAD`: trình duyệt và web không gửi. Chặn riêng là thêm nhánh. |
| 12 | BH | Audit ghi "exported" cả khi lần xuất đứt; không có log hoàn tất | false | reject | Phần frozen chốt audit "trước byte đầu tiên": ghi lần xuất được yêu cầu, không phải lần tải trọn. Lỗi giữa chừng đã có log `error` kèm id BTC và Sự kiện. |
| 13 | BH | Nhánh `handledElsewhere` của nút (2FA, đồng ý, `NOT_A_MEMBER`) chưa có test | low | reject | Cơ chế dùng chung: `providers.tsx:66-88` giữ mutation bị `TOTP_REQUIRED` và gửi lại sau 2FA, đã có test ở các màn khác; nút chỉ dùng lại `handledElsewhere`. |
| 14 | BH | `eventOrdersExportApiPath` lặp code dựng query của `eventOrdersApiPath`; không test dòng của `needs_action` + `q` | low | reject | Kiểu `EventOrdersExportPathQuery` là `Pick` của query danh sách nên tham số mới không tự vào CSV dù có dùng chung code; `needs_action` + `q` đi qua `ordersFilterOf` dùng chung với `list`, đã có test ở 6.1. |
| 15 | VG | Nhánh chờ `drain` của `writeChunk` chưa test nào chạy tới | — (gap) | patch | Theo bằng chứng của lớp: lô lớn nhất ~52 KB < 64 KiB, mọi client đọc ngay; bỏ `res.on('drain')` vẫn xanh. |
| 16 | VG | Test client ngắt không phân biệt dừng sạch với handler treo mãi | — (gap) | patch | Theo bằng chứng của lớp: xóa guard `res.destroyed` ở `writeChunk` thì handler treo nhưng test vẫn xanh (`listen().close()` cắt hết kết nối). |
| 17 | VG | Không test nào khẳng định Sự kiện lạ (404) không sinh dòng audit | — (gap) | patch | Theo bằng chứng của lớp: chuyển `audit.record` lên trước `eventSlugOfOrganization` vẫn xanh. |
| 18 | ECH | Lỗi trước byte đầu tiên mang `text/csv` | low | patch (gộp #4) | Cùng gốc với #4. |
| 19 | ECH | Client ngừng đọc (cửa sổ TCP 0): không `drain`, không `close`, handler treo | low | reject | Không giữ kết nối DB (câu đã xong trước `yield`), chỉ giữ một lô trong bộ đệm; trình duyệt luôn đọc. Stream SSE hiện có cùng tính chất. Thêm timer là thêm nhánh. |
| 20 | ECH | `HEAD` chạy trọn lần xuất | low | reject (như #11) | Cùng gốc với #11. |
| 21 | ECH | Đơn đặt giữa `answerColumnsOf` và lô đầu, trả lời câu hỏi mới chưa ai trả lời → mất câu trả lời đó | low | reject | Cần câu hỏi mới và Đơn đầu tiên trả lời nó rơi đúng vào vài ms giữa hai câu: rất hiếm; chặn trên theo giờ là thêm tham số. |
| 22 | ECH | Hai cột cùng tiêu đề | low | reject (như #3) | Cùng gốc với #3. |
| 23 | ECH | Thu hồi object URL ở `setTimeout(0)` có thể hủy tải ở Safari/Firefox với file lớn | maybe-false | defer | Mẫu `enroll-form.tsx` và e2e `ios-webkit` tải được file nhỏ. Chưa rõ với file vài MB trên Safari thật (FileSaver.js giữ 40 giây vì lỗi này). Cần thử tải CSV vài MB trên Safari/Firefox thật; nếu đúng: medium. |

## Design Notes

**`fetch` + `Blob` thay cho link thẳng tới api:** api khác origin với web. Nếu dùng `<a href>`, lỗi JSON (401, 500) sẽ thay cả trang, và nút không có spinner hay báo lỗi. `Blob` tốn bộ nhớ trình duyệt, nhưng Sự kiện CLB vài nghìn Đơn chỉ vài MB, còn server vẫn stream. Kết nối đứt giữa chừng làm `res.blob()` reject, nên web báo lỗi chứ không lưu file cụt.

**Không bọc stream trong một transaction:** keyset theo `(created_at, code)`, hai cột không đổi, nên một Đơn không bị lặp hay mất giữa các lô. Đơn đổi trạng thái trong lúc xuất có thể ra file với trạng thái cũ, hoặc rời bộ lọc. Giống như xem tab Đơn ở hai thời điểm; chấp nhận.

**Audit dùng `changedFields` để ghi bộ lọc:** bảng audit không có cột metadata. Luật "không ghi giá trị" là để không lưu dữ liệu cá nhân. Ghi tên chip và loại `q` (`code`/`email`/`phone`) đủ trả lời "xuất với bộ lọc nào" mà không lưu email hay SĐT.

**Thoát ô bằng `'`:** theo khuyến nghị OWASP cho CSV injection. Excel hiện dấu `'` ở ô bị thoát. Chỉ gặp với tên hoặc câu trả lời bắt đầu bằng `=`, `+`, `-`, `@` (hiếm); đổi lại, file không bao giờ chạy công thức.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: 0 lỗi
- `pnpm test` -- expected: mọi test xanh, kể cả `csv.test.ts`, `event-orders-export.test.ts` mới và `isolation.test.ts`
- `pnpm lint:deps` -- expected: 0 vi phạm (`reporting` → `ordering`, `ticketing`, `payment`, `event`)
- `pnpm test:e2e` -- expected: `event-orders.spec.ts` xanh trên `ios-webkit` và `android-chromium`

**Manual checks (if no CLI):**
- Trên dev stack: xuất CSV của một Sự kiện có Đơn thật, có câu hỏi form và check-in. Mở bằng Excel (hoặc Numbers/Google Sheets): tiếng Việt đúng, SĐT giữ số 0, giờ Việt Nam, số tiền là số, cột form và "k/N" đúng.
