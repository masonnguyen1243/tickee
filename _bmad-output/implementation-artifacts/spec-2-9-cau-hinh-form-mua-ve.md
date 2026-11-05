---
title: 'Story 2.9: Cấu hình form mua vé'
type: 'feature'
created: '2026-11-05'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '9b9398ed2a142cc3d2ce0d8d61b1e98809c8288d'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Wizard bước 3 "Form mua" và tab "Form mua" của Sự kiện còn "Sắp có". BTC chưa thêm được câu hỏi riêng như "Trình độ", trong khi Checkout (Epic 3) cần form này để chụp câu trả lời kèm nhãn vào Đơn (AD-35).

**Approach:** Thêm bảng `event_form_questions` thuộc mô-đun `event`. Mỗi câu hỏi có id ổn định, dạng văn bản hoặc lựa chọn, cờ bắt buộc và thứ tự. Có API thêm, sửa, xóa và sắp thứ tự, mỗi lần ghi kèm audit. Web có một trình sửa form dùng chung cho wizard bước 3 và tab "Form mua". Trình sửa luôn hiện ba trường mặc định cố định (Tên, SĐT, email), danh sách câu hỏi riêng và phần xem trước giống form Người mua sẽ thấy.

## Boundaries & Constraints

**Always:**
- Owner và Admin (`Permission.EVENTS_MANAGE`). Route `/v1/orgs/:orgId/events/:eventId/form…` có `@RequirePermission`, truy vấn qua `orgScope(ctx)` và tự vào bộ test cách ly. Sự kiện của BTC khác hoặc id sai dạng → `404 EVENT_NOT_FOUND`. Câu hỏi lạ → `404 FORM_QUESTION_NOT_FOUND`.
- Mọi thao tác ghi khóa dòng `events` `FOR UPDATE` trước (giống 2.8), nên các thao tác trên form của cùng một Sự kiện chạy tuần tự.
- Câu hỏi gồm: `label` (bắt buộc, ≤ 200 ký tự), `kind` (`text` | `choice`), `required`. Câu dạng `choice` có 2–20 phương án; mỗi phương án có id ổn định, nhãn ≤ 100 ký tự, không trùng nhãn trong cùng câu (so sau khi trim, không phân biệt hoa thường). Mỗi Sự kiện tối đa 20 câu hỏi. Câu dạng `text` không có phương án.
- Id câu hỏi và id phương án không bao giờ đổi khi sửa nhãn hay đổi thứ tự. Phương án đã có giữ nguyên id. Phương án mới được server cấp id.
- Trường mặc định (Tên, SĐT, email) cố định, không lưu trong bảng và không sửa được. Trình sửa hiện chúng ở dạng chỉ đọc: SĐT ghi "Chỉ hỏi nếu tài khoản chưa có", email ghi "Tự điền từ tài khoản, không sửa được".
- Audit trong cùng transaction: `event_form.question_added`, `event_form.question_updated` (`changedFields` là tên trường: `label`, `kind`, `required`, `options`), `event_form.question_removed`, `event_form.reordered`. Không ghi nhãn hay giá trị.
- Xóa câu hỏi phải qua `Dialog` nêu hậu quả: "Đơn đã đặt vẫn giữ câu trả lời cũ."
- **Quyết định 05/11/2026 (Mason):**
  - **(Q1)** Câu hỏi `choice` chỉ chọn một phương án (radio). Không có cờ chọn nhiều.
  - **(Q2)** Chưa làm "các trường bổ sung khác" của FR-9 (đã ghi vào deferred-work).
  - **(Q3)** Khung xem trước nằm trong trình sửa (bước 3 và tab). Bước 4 của wizard hiện mục "Form mua" bằng cùng component xem trước. Phần điều kiện và nút mở bán của bước 4 vẫn "Sắp có" cho tới 2.10.

**Never:**
- Không làm Checkout, lưu câu trả lời hay bản chụp vào Đơn (Epic 3). Không làm điều kiện mở bán hay nút "Mở bán" (2.10). Không làm API công khai cho form. Không dùng `Idempotency-Key`.
- Không kiểm `status`/khóa Sự kiện (giống 2.8 triage #2; 2.10/2.12 sẽ thêm guard).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Thêm câu lựa chọn | "Trình độ", `choice`, bắt buộc, ["Mới chơi","Trung bình","Khá"] | 201; nằm cuối danh sách; mỗi phương án có id; audit `question_added` | — |
| Lựa chọn thiếu phương án | `choice` với 1 phương án | không lưu | 400 `VALIDATION_FAILED` path `options` |
| Phương án trùng | ["Khá"," khá "] | không lưu | 400 path `options` |
| Vượt 20 câu | Sự kiện đã có 20 câu | không lưu | 409 `FORM_QUESTION_LIMIT_REACHED` |
| Sửa nhãn | đổi "Trình độ" → "Trình độ cầu lông" | id câu hỏi và id phương án giữ nguyên; audit `changedFields: ['label']` | — |
| Sửa không đổi gì | gửi lại đúng giá trị | 200, không ghi audit | — |
| Sắp thứ tự | `PUT …/form/order` với đúng tập id | thứ tự mới; audit `reordered` | thiếu, thừa hoặc trùng id → 400 path `questionIds` |
| Xóa câu hỏi | id hợp lệ | 204; audit `question_removed` | — |
| Khác BTC | câu hỏi của BTC B qua `/orgs/{A}/…` | không thấy, không sửa được | 404 `EVENT_NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/form.ts` (mới, export qua `index.ts`): `FormQuestionInput` (`label`, `kind`, `required`, `options: {id?, label}[]`; refine 2–20 phương án cho `choice`, không trùng nhãn, `text` thì `options` rỗng), `FormQuestion` (có `id`, `position`, `options: {id,label}[]`), `EventForm` (`{questions}`), `FormOrderInput` (`questionIds: uuid[]`), hằng `FORM_QUESTIONS_MAX = 20`, `FORM_QUESTION_FIELDS`. Dùng lại `optionalText`/mẫu `ticket-type.ts`.
- `contracts/src/errors.ts`, `api/src/platform/http/app-error.ts` `DEFAULT_STATUS`, `error.filter.ts` `MESSAGES`: thêm `FORM_QUESTION_NOT_FOUND` (404) và `FORM_QUESTION_LIMIT_REACHED` (409). Đây là `Record`, thiếu chỗ nào sẽ báo lỗi biên dịch.
- `apps/api/src/modules/event/schema.ts`: bảng `event_form_questions` (`id`, `organization_id`, `event_id` FK, `position int`, `kind` + CHECK, `label`, `required bool`, `options jsonb` mặc định `[]`, `created_at`, `updated_at`), index `(event_id, position)`. Migration `0012`: `pnpm --filter @tickee/api db:generate --name event_form_questions`.
- `apps/api/src/modules/event/form.service.ts` (mới) + `form.controller.ts` (`orgs/:orgId/events/:eventId/form`: `GET`, `POST questions`, `PATCH questions/:questionId`, `DELETE questions/:questionId`, `PUT order`). Chỉ chạm `event`, nên đặt trong mô-đun (không cần `flows`). Khóa Sự kiện theo mẫu `event.service.ts` `updateOrderLimit` (`UUID`, `notFound`, `.for('update')`). Xóa thì dồn lại `position`. Đăng ký trong `event.module.ts`.
- `platform/audit/audit.ts` `AuditAction`: thêm 4 action `event_form.*`.
- Web (`W` = `apps/web/app/(dashboard)/btc/[orgId]/su-kien`):
  - `W/purchase-form-editor.tsx` (mới): theo mẫu `ticket-types-editor.tsx` (`Dialog` Thêm/Sửa, `DeleteDialog`, `FieldError`, `useGoToLogin`, `stopPropagation` khi submit trong wizard). Sắp thứ tự bằng nút "Lên"/"Xuống" có `aria-label`, không kéo thả. Ô phương án: danh sách ô nhập có nút "Thêm phương án"/"Xóa".
  - `apps/web/components/tickee/purchase-form-preview.tsx` (mới): render chỉ đọc ba trường mặc định và câu hỏi theo thứ tự (`Input`/`Textarea` cho `text`, radio cho `choice`, dấu `*` cho câu bắt buộc). Epic 3 Checkout sẽ dùng lại component này.
  - `W/event-wizard.tsx`: bước 3 render trình sửa thay cho `COMING_SOON[2]` (:51, :299). Bước 4 render mục "Form mua" (`purchase-form-preview` đọc `fetchEventForm`) và giữ `EmptyState` "Sắp có" cho phần mở bán. `W/[eventId]/event-tab-list.ts`: bỏ `soon` của `form-mua`. `W/[eventId]/event-tabs.tsx`: render trình sửa.
  - `apps/web/lib/event/api.ts`: `eventFormQueryKey`, `fetchEventForm`, `addFormQuestion`, `updateFormQuestion`, `deleteFormQuestion`, `reorderFormQuestions`.
- Test: `apps/api/test/event/form.test.ts` (mới, theo mẫu `ticket-types.test.ts`); `test/organizer/isolation.test.ts:74` thêm 5 route; `apps/web/e2e/purchase-form.spec.ts` (mới) + `e2e/organizer-mock.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{form,errors,index}.ts` + `packages/contracts/test/form.test.ts` -- schema và refine (phương án 1/2/20/21, trùng nhãn, `text` có phương án).
- [x] `apps/api/src/modules/event/{schema,form.service,form.controller,event.module}.ts`, migration `0012`, `platform/audit/audit.ts`, `platform/http/{app-error,error.filter}.ts` -- bảng, API, audit.
- [x] `apps/api/test/event/form.test.ts`, `test/organizer/isolation.test.ts` -- phủ matrix và truy cập chéo BTC bằng id câu hỏi thật của BTC B.
- [x] Web: `purchase-form-editor.tsx`, `purchase-form-preview.tsx`, `event-wizard.tsx`, `event-tab-list.ts`, `event-tabs.tsx`, `lib/event/api.ts`.
- [x] `apps/web/e2e/purchase-form.spec.ts`, `e2e/organizer-mock.ts` -- thêm, sửa, xóa qua `Dialog`, sắp thứ tự, lỗi phương án, 320px không cuộn ngang.

**Acceptance Criteria:**
- Given wizard bước 3, when xem form, then thấy Tên, SĐT (ghi chú chỉ hỏi nếu tài khoản chưa có), email (tự điền, không sửa) ở dạng chỉ đọc.
- Given thêm "Trình độ" (lựa chọn, bắt buộc), when lưu, then câu hỏi hiện trong danh sách và trong phần xem trước mà không tải lại trang; tab "Form mua" của cùng Sự kiện thấy đúng câu hỏi đó.
- Given form đã có câu hỏi, when sang bước 4, then mục "Form mua" hiện đúng các trường và câu hỏi như phần xem trước ở bước 3.
- Given hai câu hỏi, when bấm "Lên" ở câu thứ hai, then thứ tự đổi ở cả danh sách lẫn phần xem trước, và vẫn đúng sau khi tải lại.

## Implementation Notes

- Id phương án do server cấp bằng `randomUUIDv7()` của Node. Phương án gửi `id` chỉ giữ id khi id đó đang thuộc chính câu hỏi; id lạ hoặc của câu khác được coi là phương án mới (server cấp id mới), không tin id từ client. `POST` luôn cấp id mới.
- `FormQuestionInput.options` thiếu thì là `[]`. Mọi lỗi danh sách phương án (số lượng, trùng nhãn, trùng id, câu `text` có phương án) chỉ báo một issue tại `options`; nhãn phương án trống/quá dài báo tại `options.<i>.label`. So trùng nhãn: trim + NFC + chữ thường.
- `PUT …/form/order`: trùng id lỗi ở contracts; thiếu/thừa id (so với câu hỏi hiện có, kể cả id câu hỏi của Sự kiện/BTC khác) do service kiểm, cùng `400 VALIDATION_FAILED` tại `questionIds`. Thứ tự không đổi → 200, không audit.
- Audit: `question_added`/`question_updated`/`question_removed` có đối tượng `event_form_question`; `reordered` có đối tượng `event`.
- DB: CHECK `kind`, `position >= 0`, `jsonb_typeof(options) = 'array'`. Index `(event_id, position)` không unique vì sắp thứ tự cập nhật từng dòng (đã tuần tự nhờ khóa dòng `events`).
- Web: nút "Lên" ở câu đầu và "Xuống" ở câu cuối bị tắt; câu vừa lên đầu/xuống cuối thì focus chuyển sang nút còn lại của hàng, kèm vùng `aria-live` báo vị trí mới. "Thêm câu hỏi" tắt khi đủ 20 câu, có dòng lý do ngay dưới.
- `PurchaseFormPreview` (`components/tickee`) xuất cả `PURCHASE_FORM_DEFAULT_FIELDS` để trình sửa và Checkout (Epic 3) dùng chung nhãn/ghi chú của ba trường mặc định.
- `e2e/organizer-mock.ts`: mặc định `GET …/form` → `{ questions: [] }` (wizard bước 3–4 và tab luôn tải form) và thêm `PUT` vào `access-control-allow-methods`.

## Spec Change Log

## Review Triage Log

Pass 1 (05/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH, EC | Bấm "Xuống" khi câu hỏi chưa xuống tới cuối thì mất focus bàn phím | medium | Khi xếp lại danh sách có key, React dời DOM của hàng được bấm (`[A,B,C]` → `[B,A,C]` thì `insertBefore` dời A), nên nút đang focus bị gỡ khỏi DOM và focus về `body`. `move.onSuccess` chỉ trả focus khi câu hỏi chạm đầu/cuối (`atEdge`). WCAG 2.2 AA là yêu cầu của UX | patch |
| 2 | BH | Nhấn Enter trong ô chỉ đọc của phần xem trước sẽ submit form wizard; mỗi ô xem trước là một điểm dừng Tab vô ích | low | Bước 3–4 nằm trong `<form onSubmit>` của wizard (`event-wizard.tsx:240`). `Input readOnly` vẫn nhận focus, và trình duyệt vẫn submit ngầm khi nhấn Enter trong ô readonly → "Tiếp" (PATCH Sự kiện, sang bước 4). Sửa trực tiếp được | patch |
| 3 | BH, EC | Hai người cùng sửa một câu hỏi (PATCH thay toàn bộ) hoặc sắp thứ tự từ bản cũ thì người sau ghi đè người trước | low | Có thật, nhưng hiếm: hai người phải cùng mở một câu. Event và Hạng vé (2.7, 2.8) cũng theo kiểu người lưu sau thắng. Sửa cần thêm điều kiện phiên bản vào public contract | reject |
| 4 | BH | Xóa cứng mâu thuẫn với "join theo id" | false | Câu trả lời của Đơn chụp kèm nhãn lúc đặt (AD-35, intent: "Đơn đã đặt vẫn giữ câu trả lời cũ"), nên không cần join ngược về câu đã xóa. Hiện chưa có code nào đọc | reject |
| 5 | BH | Audit câu hỏi không ghi `eventId`; xóa xong thì không biết câu hỏi thuộc Sự kiện nào | low | Giống 2.8 triage #7: có thật, nhưng chưa có ai đọc audit theo Sự kiện; sửa phải mở rộng `AuditEvent` | reject |
| 6 | BH | Không chặn hai câu hỏi trùng nhãn, hoặc câu hỏi trùng trường mặc định ("Email") | low | Có thật, nhưng là BTC tự đặt nhãn; sửa phải thêm luật và mã lỗi mới ở service. Intent không yêu cầu | reject |
| 7 | BH | `lockEvent` và kiểm Sự kiện trong `FormService.get` chép nguyên từ `lockEventForTicketTypes`/`assertEventOfOrganization` | low | Đã đọc `ticket-type.service.ts:37-56`: giống từng dòng. 2.10/2.12 phải thêm guard `status`/khóa (deferred-work của 2.7), nên với bản chép phải thêm hai lần. Sửa: import hàm sẵn có trong cùng mô-đun, xóa bản chép | patch |
| 8 | BH | Helper web (`FieldError`, `useGoToLogin`, `messageOf`, `serverIssuePaths`) chép lần thứ tư | low | Có thật, nhưng là kiểu chép đã có từ 2.7/2.8; gom lại phải sửa cả `ticket-types-editor.tsx` và `event-wizard.tsx` | reject |
| 9 | BH, EC | Escape hoặc bấm nền đóng `Dialog` khi đang lưu: lỗi bị nuốt; `onDone` đến muộn đóng `Dialog` vừa mở | low | Giống 2.8 triage #9: phải đóng trong lúc lưu chưa tới một giây; sửa phải đưa `isPending` lên trên | reject |
| 10 | BH, VG | Web chưa có e2e cho các nhánh lỗi: 404 `FORM_QUESTION_NOT_FOUND` khi sửa/xóa, 400 khi sắp thứ tự (tải lại), 409 vượt 20 câu, `VALIDATION_FAILED` của server gắn vào đúng ô, nút "Thử lại" của banner sắp thứ tự | — | Gap đã xác minh (VG): mock đã trả các lỗi này nhưng chưa test nào chạm tới. `ticket-types.spec.ts:285-313` có test tương đương cho Hạng vé | patch |
| 11 | VG | Chưa có e2e thêm câu "Văn bản" (body `options: []`) hoặc đổi câu lựa chọn sang văn bản | — | Gap đã xác minh: mọi lần "Thêm" trong e2e đều chọn "Lựa chọn" trước; nếu `inputOf` gửi nhầm hai ô phương án ẩn, nút "Thêm" sẽ không làm gì và không báo lỗi | patch |
| 12 | BH | Trạng thái spec (`in-review`) và sprint-status (`in-progress`) lệch nhau | false | Bước trình bày của workflow đồng bộ sprint-status sang `review` (`step-05-present.md:17`) | reject |
| 13 | BH | `PURCHASE_FORM_DEFAULT_FIELDS` chỉ ở web, API không dùng được | low | Hiện chưa có ai ở API cần. Epic 3 (Checkout) sẽ chuyển key/required sang contracts khi cần; làm bây giờ là thêm public surface | reject |
| 14 | BH | Snapshot migration không có trong diff được review | false | Đã chạy `drizzle-kit check` ("Everything's fine") và `db:generate` ("No schema changes"): `schema.ts` và snapshot `0012` khớp nhau | reject |
| 15 | BH | Sắp thứ tự chạy một UPDATE cho mỗi dòng; `add` đọc mọi dòng chỉ để đếm | low | Tối đa 20 dòng, chạy trong cùng transaction; không có hại đo được | reject |
| 16 | EC | Sắp thứ tự xong trong lúc một lần GET form (do invalidate trước đó) chưa về: GET cũ ghi đè cache, danh sách hiện thứ tự cũ | low | Có thật: `move.onSuccess` chỉ `setQueryData` mà không invalidate, nên GET cũ về sau sẽ ghi đè. Sửa một dòng: invalidate sau `setQueryData` (refetch hủy lần fetch đang chạy), giống các mutation khác | patch |
| 17 | EC | Sửa ô trước của cặp phương án trùng thì lỗi "trùng" ở ô sau vẫn còn | low | `clearOptionErrors(index)` chỉ xóa lỗi của ô đang sửa. Sửa trực tiếp: đổi bất kỳ ô phương án nào thì xóa hết lỗi theo ô (lần lưu sau kiểm lại) | patch |

## Design Notes

- **Bảng riêng thay vì cột JSON trên `events`:** id câu hỏi ổn định, khóa và audit theo từng câu, và Epic 3/6 có thể join theo id. `options` để jsonb vì luôn đọc và ghi cùng câu hỏi.
- **API theo từng câu, không `PUT` cả form:** hai người cùng sửa không ghi đè lên nhau, và cách làm khớp với trình sửa Hạng vé (mỗi `Dialog` lưu ngay). Vì vậy "Tiếp" ở bước 3 không cần lưu gì thêm.

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass (Postgres chạy bằng `docker compose up -d`).
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build && pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
