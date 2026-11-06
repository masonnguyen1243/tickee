---
title: 'Story 2.10: Điều kiện mở bán và mở bán Sự kiện'
type: 'feature'
created: '2026-11-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '674c57ef4fcdb14f6670a022a92984eddd97d4bc'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Wizard bước 4 "Xem trước & mở bán" còn "Sắp có". BTC không biết Sự kiện còn thiếu gì và chưa mở bán được. Nếu web và API xét điều kiện khác nhau, Sự kiện chưa sẵn sàng có thể bị mở bán (AD-34).

**Approach:** Thêm `event.publishReadiness(eventId)` trả `[{code, satisfied}]` và lệnh "Mở bán". Lệnh này gọi lại đúng hàm đó trong transaction rồi chuyển `draft` → `published` bằng compare-and-set, kèm audit. Bước 4 hiện các điều kiện còn thiếu với link sửa nhanh, nút "Mở bán" có lý do khi bị tắt, và sau khi mở bán thì hiện link Sự kiện + "Sao chép link". `ordering.sellability` đã tách sang deferred-work (Mason, 06/11/2026).

## Boundaries & Constraints

**Always:**
- Owner và Admin (`Permission.EVENTS_MANAGE`). Route dưới `/v1/orgs/:orgId/events/:eventId/…` có `@RequirePermission`, truy vấn qua `orgScope(ctx)`, tự vào bộ test cách ly. Sự kiện của BTC khác hoặc id sai dạng → `404 EVENT_NOT_FOUND`.
- Điều kiện (mã trong `packages/contracts`, theo thứ tự này):
  - Luôn có: `REFUND_POLICY` (chính sách hoàn vé không rỗng sau trim); `HAS_TICKET_TYPE` (có ít nhất một Hạng vé); `EVENT_NOT_ENDED` (`effective_end_at` còn ở tương lai); `ORGANIZATION_NOT_LOCKED`.
  - Chỉ khi có ít nhất một Hạng vé giá > 0: `CLOSED_BETA_APPROVED` (`closed_beta_status = 'approved'`); `PAYOUT_ACCOUNT_LINKED` (còn ít nhất một tài khoản nhận tiền chưa `retired_at`); `PAID_PRICE_MINIMUM` (mọi giá > 0 đều ≥ `MIN_PAID_PRICE`). Sự kiện miễn phí không trả ba mã này.
- Chưa có khóa BTC (Epic 7), nên `ORGANIZATION_NOT_LOCKED` luôn `satisfied: true`. Chỗ tính phải là một hàm riêng để Epic 7 thay vào.
- Mở bán: khóa dòng `events` `FOR UPDATE`, `status` khác `draft` → `409 EVENT_NOT_DRAFT`. Tính lại readiness trong cùng transaction; còn điều kiện chưa đạt → `409 EVENT_NOT_READY`, `details.unmet` là danh sách mã. Đạt hết thì `UPDATE … SET status='published' WHERE id=… AND status='draft'` và audit `event.published` trong cùng transaction.
- Khóa Sự kiện (`locked_at`) và trạng thái dịch vụ thanh toán không chặn mở bán (AD-34).
- Bước 4 chỉ liệt kê điều kiện **chưa đạt**, mỗi dòng có câu rõ và lối sửa:
  - `REFUND_POLICY` → "Thiếu chính sách hoàn vé — chưa mở bán được.", link về bước 1.
  - `HAS_TICKET_TYPE` → "Chưa có Hạng vé nào.", về bước 2.
  - `EVENT_NOT_ENDED` → "Sự kiện đã kết thúc.", về bước 1 để sửa giờ.
  - `PAID_PRICE_MINIMUM` → về bước 2.
  - `PAYOUT_ACCOUNT_LINKED` → trang `tai-khoan-nhan-tien`.
  - `CLOSED_BETA_APPROVED` → "Chờ duyệt Closed Beta", kèm hướng dẫn liên hệ Tingee (không có link sửa).
  - Đạt hết thì hiện "Đã đủ điều kiện mở bán."
- **Quyết định 06/11/2026 (Mason):** (Q1) Sự kiện chưa có Hạng vé nào thì không mở bán được (`HAS_TICKET_TYPE`). (Q2) Sự kiện đã qua `effective_end_at` thì không mở bán được (`EVENT_NOT_ENDED`). (Q3) Giữ một spec cho cả API và web dù dài hơn khung token.
- Nút "Mở bán" tắt khi còn điều kiện thiếu, có lý do ngay cạnh nút (`aria-describedby`). Khi đang gọi API thì nút hiện spinner và chặn bấm lặp. Mở bán xong: hiện link `{origin}/e/{slug}` và nút "Sao chép link" (dùng `copyWithToast`, toast "Đã sao chép"). Sự kiện đã `published` mà mở lại bước 4 thì hiện ngay phần link.

**Never:**
- Không làm `ordering.sellability`, trang `/e/{slug}` (2.11), sửa/ẩn/kết thúc sau mở bán (2.12), cột hay luật khóa BTC (Epic 7). Không thêm guard `status` cho các API sửa Sự kiện/Hạng vé/form (2.12). Không dùng `Idempotency-Key` (giống 2.7–2.9).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Miễn phí, đủ | có chính sách, mọi Hạng vé 0đ, BTC chưa duyệt Closed Beta | readiness chỉ có 4 mã luôn-có, đều đạt; mở bán → `published`, audit | — |
| Thiếu chính sách | chính sách rỗng hoặc chỉ khoảng trắng | `REFUND_POLICY` chưa đạt | mở bán → 409 `EVENT_NOT_READY` `unmet: ['REFUND_POLICY']` |
| Có phí, BTC chưa duyệt | Hạng vé 100.000đ, `pending`/`revoked` | `CLOSED_BETA_APPROVED` chưa đạt | 409 `EVENT_NOT_READY` |
| Có phí, đã hủy hết tài khoản | mọi tài khoản đều có `retired_at` | `PAYOUT_ACCOUNT_LINKED` chưa đạt | 409 |
| Chưa có Hạng vé | 0 Hạng vé | `HAS_TICKET_TYPE` chưa đạt, không có mã của Hạng vé có phí | 409 `EVENT_NOT_READY` |
| Đã kết thúc | `effective_end_at` ≤ now | `EVENT_NOT_ENDED` chưa đạt | 409 `EVENT_NOT_READY` |
| Mở bán lần hai | `status = 'published'` | không đổi | 409 `EVENT_NOT_DRAFT` |
| Hai người bấm cùng lúc | 2 request song song | một bên 200, bên kia 409 `EVENT_NOT_DRAFT`; một dòng audit | — |
| Khác BTC | Sự kiện của BTC B qua `/orgs/{A}/…` | không thấy | 404 `EVENT_NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/event.ts` (hoặc file mới `publish.ts`, export qua `index.ts`): enum `PublishConditionCode`, `PublishReadiness` (`{conditions: {code, satisfied}[]}`). Dùng lại `MIN_PAID_PRICE` từ `ticket-type.ts:16`.
- `contracts/src/errors.ts:82`, `api/src/platform/http/app-error.ts:3` `DEFAULT_STATUS`, `error.filter.ts:7` `MESSAGES`: thêm `EVENT_NOT_READY` (409) và `EVENT_NOT_DRAFT` (409). Đây là `Record`, thiếu một chỗ là lỗi biên dịch.
- `apps/api/src/modules/event/publish.service.ts` (mới) hoặc thêm vào `event.service.ts`: `readiness(ctx, eventId)` và `publish(ctx, eventId)`.
  - Khóa và kiểm Sự kiện theo mẫu `updateOrderLimit` (`event.service.ts:203-229`: `UUID`, `notFound`, `.for('update')`, `audit.record`, `detailOf`).
  - Lấy Hạng vé qua `ticketTypesOf` (`ticket-type.service.ts:58`).
  - Closed Beta: `closedBetaStatusOf` (`organizer/closed-beta.ts:136`). Tài khoản: `payoutAccountStatusOf(...).status === 'linked'` (`organizer/payout-account.service.ts:454`). Cả hai lấy từ `organizer/index.ts`; `module-graph.cjs` đã cho `event → organizer`. Truyền `tx` để readiness trong lệnh mở bán đọc trong cùng transaction.
  - Ghi chỉ chạm bảng `events`, nên đặt trong `event`, không cần `flows/`.
- `events.controller.ts`: `GET :eventId/publish-readiness`, `POST :eventId/publish` (không body, trả `EventDetail`).
- `platform/audit/audit.ts:5`: thêm `'event.published'` (đối tượng `event`, không có `changedFields`).
- Web (`W` = `apps/web/app/(dashboard)/btc/[orgId]/su-kien`):
  - `W/publish-panel.tsx` (mới): danh sách điều kiện thiếu, nút "Mở bán", phần link sau khi mở bán. Chuyển bước bằng callback `onGoToStep(i)` từ wizard.
  - `W/event-wizard.tsx:53, 299-308`: thay `PUBLISH_COMING_SOON`/`EmptyState` bằng `PublishPanel`, giữ `PurchaseFormReview`.
  - `apps/web/lib/event/api.ts`: `eventReadinessQueryKey`, `fetchPublishReadiness`, `publishEvent`. Mở bán xong thì invalidate `eventQueryKey` và `eventsQueryKey`.
  - Copy câu và link sửa của từng mã nằm trong một bảng ánh xạ ở web (AD-34: web chỉ ánh xạ `code` sang nội dung).
- Test:
  - `apps/api/test/event/publish.test.ts` (mới): theo mẫu `ticket-types.test.ts`. Fixture `insertCredential`, `insertPayoutAccount`, `closedBeta('approve')` chép từ `test/reporting/notices.test.ts:22-65`.
  - `test/organizer/isolation.test.ts`:
    - :49-80 thêm 2 route.
    - :112 sửa `toHaveLength(14)` thành 16.
    - Đổi luật `hasBody` để `POST …/publish` (không body) được mong đợi 404 `EVENT_NOT_FOUND`.
  - `apps/web/e2e/publish.spec.ts` (mới) + `e2e/organizer-mock.ts`. Sửa `e2e/purchase-form.spec.ts:584-601` (đang kiểm chữ "Sắp có").

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{event|publish,errors,index}.ts` + test contracts -- mã điều kiện, schema, 2 mã lỗi.
- [x] `apps/api/src/modules/event/{publish.service,events.controller,event.module}.ts`, `platform/audit/audit.ts`, `platform/http/{app-error,error.filter}.ts` -- readiness + mở bán CAS + audit.
- [x] `apps/api/test/event/publish.test.ts`, `test/organizer/isolation.test.ts` -- phủ matrix, gồm cả mở bán song song.
- [ ] Web: `publish-panel.tsx`, `event-wizard.tsx`, `lib/event/api.ts`.
- [x] `apps/web/e2e/publish.spec.ts`, `organizer-mock.ts`, `purchase-form.spec.ts` -- thiếu điều kiện thì nút tắt có lý do, link sửa nhanh về bước 1, mở bán thành công rồi sao chép link, 409 `EVENT_NOT_READY` từ server thì tải lại danh sách điều kiện, 320px không cuộn ngang.

**Acceptance Criteria:**
- Given Sự kiện thiếu chính sách hoàn vé, when tới bước 4, then thấy "Thiếu chính sách hoàn vé — chưa mở bán được.", nút "Mở bán" tắt và có lý do; bấm link sửa thì về bước 1 mà không mất dữ liệu.
- Given đủ điều kiện, when bấm "Mở bán", then thấy link Sự kiện và "Sao chép link"; bấm sao chép thì toast "Đã sao chép"; badge của Sự kiện ở danh sách và tab Tổng quan chuyển thành "Đang mở bán".
- Given web đang hiện "đủ điều kiện" nhưng server đã đổi (vd. Closed Beta bị thu hồi), when bấm "Mở bán", then server trả 409 `EVENT_NOT_READY`, web báo lỗi và tải lại danh sách điều kiện.

## Implementation Notes

- Contracts: `src/publish.ts` (mới) chứa `PublishConditionCode` (thứ tự là thứ tự trả về), `PublishReadiness`, `unmetConditions`, `EventNotReadyDetails`.
- API: `publishReadiness(db, ctx, event)` là hàm thuần trong `publish.service.ts`, nhận `db`/`tx` để lệnh mở bán đọc trong cùng transaction. `organizationLocked()` là stub trả `false` cho tới Epic 7. `detailOf` được export từ `event.service.ts`.
- Bộ test cách ly: `POST …/publish` không có body nên được loại khỏi luật `hasBody` và kỳ vọng 404 `EVENT_NOT_FOUND`.
- Web: `PublishPanel` luôn tải lại readiness khi vào bước 4 (`staleTime: 0`, `refetchOnMount: 'always'`). Link sửa nhanh bị bỏ qua khi wizard đang lưu (`busy`). Link công khai lấy origin bằng `useSyncExternalStore` (server render ra chuỗi rỗng).
- `purchase-form.spec.ts:375` (sắp thứ tự, `toBeFocused`) lỗi lẻ trên cả hai project trong lúc chạy e2e. Test đó chạy ở tab "Form mua", không render `PublishPanel`.

## Spec Change Log

## Review Triage Log

Pass 1 (06/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | EC, BH | Closed Beta bị thu hồi hoặc tài khoản bị gỡ commit đúng lúc lệnh mở bán đang đọc → Sự kiện có phí vẫn mở bán | low | Có thật: chỉ khóa dòng `events`, còn `closedBetaStatusOf`/`payoutAccountStatusOf` đọc không khóa. Nhưng kết quả giống hệt việc thu hồi ngay sau khi mở bán, vốn là luồng đã thiết kế ("Tạm ngừng bán" qua `sellability`, FR-37). Sửa phải khóa dòng `organizations` ở cả ba lối ghi | reject |
| 2 | BH, EC | Sau khi mở bán vẫn sửa được: xóa chính sách hoàn vé, thêm Hạng vé có phí khi chưa duyệt Closed Beta | medium | Có thật, nhưng đã có từ 2.7–2.9 (không API sửa nào kiểm `status`). Intent loại guard sửa sau mở bán (2.12); `sellability` (deferred) xét chính sách, Closed Beta và tài khoản theo từng Hạng vé | defer |
| 3 | EC | So `effective_end_at` với giờ máy app thay vì `now()` của DB | low | Lệch chỉ xảy ra khi đồng hồ server lệch đúng ở mốc kết thúc; sửa phải thêm truy vấn | reject |
| 4 | EC | Mọi Hạng vé có số suất 0 hoặc đã đóng bán mà `HAS_TICKET_TYPE` vẫn đạt | low | Quyết định Q1 chỉ yêu cầu "có Hạng vé"; trạng thái theo cửa sổ bán và tồn kho là việc của `sellability` | reject |
| 5 | EC, BH, VG | Mở bán nhận `409 EVENT_NOT_DRAFT` thì không có thông báo nào; web chưa có test cho nhánh này | low | `EventGate` đọc `eventQueryKey`, nên invalidate làm panel chuyển sang link, nhưng không có câu giải thích. VG: không e2e nào gửi lỗi này. Sửa: thêm toast + e2e | patch |
| 6 | VG | Chưa có e2e cho banner lỗi 5xx của readiness và mở bán (nút "Thử lại") | — | Gap đã xác minh (VG): mock chỉ trả 200 hoặc 409 | patch |
| 7 | BH | `ConditionRow` ép kiểu `copy.fix as { step: number }` | low | Bỏ qua thu hẹp kiểu của union; sửa trực tiếp bằng biến cục bộ | patch |
| 8 | EC, BH | Bấm link sửa nhanh khi wizard đang lưu thì không có gì xảy ra | low | Phải bấm trong lúc lưu chưa tới một giây; cùng lớp với 2.9 triage #9 | reject |
| 9 | EC | Sự kiện `hidden`/`cancelled` thì panel chỉ có tiêu đề và nút tắt | false | Panel vẫn hiện lý do "Chỉ mở bán được Sự kiện nháp." cạnh nút; trong story này chưa có lối nào ẩn hay hủy Sự kiện | reject |
| 10 | EC | Lỗi readiness thuộc `handledElsewhere` thì panel trống, không có "Thử lại" | false | `handledElsewhere` là lỗi đã có nơi khác xử lý (401 chuyển trang đăng nhập, `EventGate`), giống mọi trình sửa khác | reject |
| 11 | VG, BH | `PAID_PRICE_MINIMUM` không bao giờ chưa đạt, chưa có test cho nhánh chưa đạt | false | CHECK `price = 0 OR price >= 2000` chặn ngay ở DB nên không ghi được dữ liệu để test. Giữ mã này theo AD-34 (Design Notes) | reject |
| 12 | BH | Link `/e/{slug}` trả 404 | low | Đã ghi trong Design Notes; trang này thuộc 2.11 | reject |
| 13 | BH | Link dùng origin của dashboard; sai nếu dashboard và trang công khai khác host | low | Hiện cùng một app Next.js, cùng origin. Chỉ sai khi topology deploy đổi | defer |
| 14 | BH | Readiness không xét `status`; client không phân biệt "đủ điều kiện" với "đã mở bán" | low | Web chỉ gọi readiness khi Sự kiện là nháp (`enabled`), và đã có `status` từ `EventDetail` | reject |
| 15 | BH | Chưa test vai không có `events.manage` bị 403 | false | Chỉ có `owner` và `admin`, cả hai đều có `events.manage` (`ROLE_PERMISSIONS`) | reject |
| 16 | BH | `disabled={!ready && !publish.isPending}` mở khóa nút khi đang gửi | false | `Button` có `loading` thì `preventDefault` và bỏ qua click (`button.tsx:64`), kèm `aria-busy` | reject |
| 17 | BH | Bộ test cách ly ghi cứng đường dẫn `…/publish` | low | Chỉ một route; tổng quát hóa phải đổi metadata route | reject |
| 18 | BH | Audit `event.published` không chụp các điều kiện lúc mở bán | low | Spec quy định audit không có `changedFields`; chưa có ai đọc | reject |
| 19 | BH | Stub `ORGANIZATION_NOT_LOCKED` luôn đạt, dễ bị quên ở Epic 7 | low | Có thật; intent cho phép stub tới Epic 7. Ghi deferred để Epic 7 thay thân hàm và thêm test nhánh chưa đạt | defer |

## Design Notes

- **Readiness chỉ trả mã áp dụng:** Sự kiện miễn phí không có mã của Hạng vé có phí, nên web không phải tự biết luật "chỉ khi > 0đ". `PAID_PRICE_MINIMUM` gần như luôn đạt nhờ CHECK `price = 0 OR price >= 2000`, nhưng vẫn giữ theo AD-34 để luật nằm ở một chỗ khi `sellability` dùng lại.
- **Link công khai:** web dựng từ `window.location.origin` + `/e/{slug}` (chưa có biến origin web). Trang `/e/{slug}` thuộc 2.11, nên trước khi có 2.11 link này sẽ trả 404.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass (Postgres chạy bằng `docker compose up -d`).
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build && pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
