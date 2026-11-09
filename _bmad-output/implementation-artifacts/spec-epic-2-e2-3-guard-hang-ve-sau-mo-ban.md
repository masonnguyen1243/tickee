---
title: 'E2-3: Guard Hạng vé sau khi mở bán'
type: 'bugfix'
created: '2026-11-09'
status: 'done'
baseline_commit: '24a29003f3b0ebc0d6cd359cd69c3f5cb1a147d8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-11-09.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Điều kiện mở bán (2.10) chỉ được kiểm ở bước `draft` → `published`. Sau đó, các lệnh tạo, sửa, xóa Hạng vé (`apps/api/src/flows/ticket-types.flow.ts`) không xét trạng thái Sự kiện. Vì vậy Sự kiện đã mở bán có thể thêm Hạng vé có phí khi BTC chưa đủ điều kiện bán vé có phí, có thể mất Hạng vé cuối cùng, và trần 200 Vé miễn phí bị bỏ qua khi có thêm một Hạng vé có phí (retro Epic 2 C1, deferred 2.10).

**Approach:** Thêm các guard trong flow Hạng vé, dùng lại luật sẵn có `paidSalesAllowed`, rồi đóng mục deferred 2.10.

**Quyết định (Mason, 09/11):** Trần miễn phí tính theo **tổng số suất của mọi Hạng vé 0đ ≤ 200**, áp cho mọi Sự kiện ở mọi trạng thái, kể cả nháp và Sự kiện có cả Hạng vé có phí. Câu chữ FR-11 trong PRD và epics đổi theo. Câu báo lỗi nói về "suất miễn phí", không còn nói "Sự kiện miễn phí".

## Boundaries & Constraints

**Always:**
- Guard nằm trong transaction sẵn có, sau `lockEvent`. Lỗi thì không lưu gì và không enqueue revalidate.
- Không có luật nào thứ hai: điều kiện bán có phí lấy từ `paidSalesAllowed`, trần miễn phí lấy từ một hàm trong `packages/contracts`.
- Mã lỗi mới khai báo trong `packages/contracts/src/errors.ts`, kèm câu chữ trong `error.filter.ts`.

**Never:**
- Không đổi luật mở bán (`publishReadiness`).
- Không đổi guard sửa thông tin Sự kiện (`EventService.update`).
- Không đụng Sự kiện `draft` ngoài phần trần miễn phí.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Thêm Hạng vé có phí sau mở bán, chưa đủ điều kiện | Sự kiện `published`/`hidden`; BTC chưa duyệt Closed Beta hoặc chưa có tài khoản nhận tiền; tạo Hạng vé 2.000đ | 409 `PAID_TICKET_TYPE_NOT_ALLOWED`, `details.unmet` liệt kê `CLOSED_BETA_APPROVED`/`PAYOUT_ACCOUNT_LINKED` chưa đạt | Không lưu, không revalidate |
| Sửa giá 0đ → có phí sau mở bán, chưa đủ điều kiện | như trên, sửa Hạng vé | 409 như trên | — |
| Đủ điều kiện | BTC đã duyệt và có tài khoản nhận tiền | Tạo/sửa như hiện tại | — |
| Sự kiện nháp | `draft`, BTC chưa đủ điều kiện, tạo Hạng vé có phí | Như hiện tại (điều kiện kiểm lúc mở bán) | — |
| Xóa Hạng vé cuối | Sự kiện ≠ `draft`, còn đúng 1 Hạng vé | 409 `LAST_TICKET_TYPE` | Không xóa |
| Xóa Hạng vé cuối khi nháp | `draft`, 1 Hạng vé | Xóa như hiện tại | — |
| Trần miễn phí, Sự kiện hỗn hợp | Mọi trạng thái; Hạng vé 0đ 150 suất + Hạng vé có phí; thêm Hạng vé 0đ 60 suất (hoặc nâng lên 210, hoặc đổi Hạng vé có phí 100 suất thành 0đ) | 409 `FREE_EVENT_CAPACITY_EXCEEDED` `{limit: 200}` | Không lưu |
| Trần miễn phí, đúng 200 | Tổng suất 0đ = 200, kèm Hạng vé có phí bất kỳ số suất | Lưu được | — |
| Xóa Hạng vé có phí | Còn Hạng vé 0đ, tổng ≤ 200 | Xóa được (trần không phụ thuộc Hạng vé có phí) | — |

</frozen-after-approval>

## Code Map

- `apps/api/src/flows/ticket-types.flow.ts`:
  - `lockEvent` trả `event.status`.
  - `assertFreeCap` (72-81) và `deleteTicketType` (169-197) dùng `exceedsFreeEventCap`.
  - Thêm guard có phí trong `createTicketType` và `updateTicketType`, chỉ khi `event.status !== 'draft'` và giá sau thay đổi > 0. Gọi `paidSalesAllowed(tx, ctx)`, export từ `modules/event/index.ts`.
  - Thêm guard Hạng vé cuối trong `deleteTicketType`.
- `apps/api/src/modules/event/sale-rules.ts` -- `paidSalesAllowed`: tái dùng, không sửa.
- `packages/contracts/src/ticket-type.ts:117-120` -- `exceedsFreeEventCap` đổi thành cộng suất các Hạng vé `price === 0` (bỏ điều kiện "mọi Hạng vé 0đ"), sửa docblock; thêm `PaidTicketTypeNotAllowedDetails { unmet: PublishConditionCode[] }`.
- `packages/contracts/src/errors.ts:95-101` -- thêm `PAID_TICKET_TYPE_NOT_ALLOWED`, `LAST_TICKET_TYPE`; `apps/api/src/platform/http/error.filter.ts:42` -- câu chữ.
- `apps/web/app/(dashboard)/btc/[orgId]/su-kien/ticket-types-editor.tsx`:
  - `capacityConflictMessage` (175) và `FREE_CAP_MESSAGE` (95): câu chữ trần miễn phí.
  - Lỗi mới hiện qua đường `failure` sẵn có, dùng message của server.
- Test: `apps/api/test/event/` (file test flow Hạng vé hiện có), `packages/contracts/test/ticket-type.test.ts:70-78`.
- `_bmad-output/implementation-artifacts/deferred-work.md:229-231` -- đánh dấu đã xử lý qua spec này.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/errors.ts`, `ticket-type.ts` -- mã lỗi mới, details, luật trần -- một nguồn luật.
- [x] `apps/api/src/flows/ticket-types.flow.ts`, `modules/event/index.ts`, `platform/http/error.filter.ts` -- ba guard -- đóng C1.
- [x] `apps/api/test/event/…`, `packages/contracts/test/ticket-type.test.ts` -- test từng dòng của bảng I/O và luật trần.
- [x] `ticket-types-editor.tsx` -- câu chữ trần: "Tối đa 200 suất miễn phí mỗi Sự kiện…".
- [x] `prds/prd-tickee-2026-10-27/prd.md:290,693`, `epics.md:44,751`, spine AD-2 (`:88`, "Kiểm trần 200 Vé của Sự kiện miễn phí") -- câu chữ FR-11 theo quyết định.
- [x] `deferred-work.md` -- đóng mục 2.10.

**Acceptance Criteria:**
- Given Sự kiện đã mở bán, when mọi lệnh Hạng vé bị guard từ chối, then dữ liệu Hạng vé, tồn kho và audit không đổi.
- Given toàn bộ test API/contracts/web, when chạy, then xanh.

## Implementation Notes

- `deleteTicketType` bỏ phép kiểm trần miễn phí: xóa không làm tăng tổng suất 0đ, nên với luật mới phép kiểm này không bao giờ chặn đúng (chỉ chặn nhầm trên dữ liệu cũ đã vượt trần). Hai test API cũ dựng "0đ 250 + có phí" (không còn tạo được) được thay bằng dòng "Xóa Hạng vé có phí" của bảng I/O.
- Guard có phí chỉ chặn khi Hạng vé trở thành có phí: tạo mới giá > 0, hoặc sửa từ 0đ sang giá > 0 (đúng hai dòng của bảng I/O). Hạng vé đã có phí sửa được như thường khi BTC mất điều kiện (`sellability` đã tạm ngừng bán).
- Trần miễn phí chỉ chặn thay đổi làm tổng suất 0đ vừa vượt 200 vừa tăng so với trước (luật vẫn ở `exceedsFreeEventCap`, flow so tổng trước/sau). Sự kiện đã vượt trần theo luật cũ (vd. 0đ 250 + có phí) vẫn giảm suất miễn phí, sửa, thêm Hạng vé có phí được.
- Thứ tự trong `updateTicketType`: không có trường đổi → trả về, không guard; rồi guard có phí, `changeCapacity`, trần miễn phí. Guard có phí và guard Hạng vé cuối áp cho mọi trạng thái khác `draft`, kể cả `cancelled`.
- `details.unmet` dựng bằng `unmetConditions` trên hai mã `CLOSED_BETA_APPROVED`, `PAYOUT_ACCOUNT_LINKED` từ kết quả `paidSalesAllowed`; câu báo chỉ nêu điều kiện còn thiếu. Sàn giá 2.000đ đã do `TicketTypeInput` chặn.
- Web: sau `409 LAST_TICKET_TYPE`, Dialog xóa tắt nút "Xóa" như `TICKET_TYPE_IN_USE` nhưng hiện câu của server.
- Ngoài Code Map: e2e mock `apps/web/e2e/ticket-types.spec.ts` đổi luật trần và câu chữ cho khớp; spine AD-25 ghi trần mới và hai guard; Story 2.8 trong `epics.md` thêm AC cho hai guard.

## Spec Change Log

- **Review lần 1 (09/11):** Code Map ghi guard có phí chạy khi "giá sau thay đổi > 0", nên mọi lần sửa Hạng vé có phí (đổi tên, giảm số suất…) của BTC đã mất điều kiện đều bị 409. Bảng I/O đã duyệt chỉ chặn *tạo* Hạng vé có phí và *đổi 0đ → có phí*. Sửa: guard chỉ chạy khi Hạng vé *trở thành* có phí (tạo giá > 0; sửa từ 0đ lên > 0). Trần miễn phí chỉ từ chối khi tổng suất 0đ sau thay đổi > 200 *và* lớn hơn trước thay đổi, để Sự kiện đã vượt trần theo luật cũ vẫn sửa giảm được. Không lặp lại: guard theo giá sau thay đổi; trần theo tổng tuyệt đối. KEEP: ba guard chạy trong transaction sau `lockEvent`, `exceedsFreeEventCap` là nguồn luật duy nhất, `snapshot` trong test kiểm không lưu/không audit/không job.

## Review Triage Log

| # | Nguồn | Phát hiện | Verdict | Xử lý |
|---|-------|-----------|---------|-------|
| 1 | BH | Guard có phí chặn cả đổi tên/giảm số suất Hạng vé có phí sẵn có | medium | Đúng: chặn mà không bảo vệ gì (sellability đã tạm dừng Hạng vé đó); sửa một điều kiện → **patch** (xem Spec Change Log) |
| 2 | EC, BH, VG | Trần tính theo tổng tuyệt đối: Sự kiện đã vượt trần theo luật cũ bị khóa mọi thay đổi | medium | Đúng (0đ 250 + có phí hợp lệ trước đây); chỉ chặn khi tổng 0đ tăng → **patch** |
| 3 | VG | Không test PATCH y nguyên trên Sự kiện đã mở bán, BTC chưa đủ điều kiện | low | Đúng; thêm test → **patch** |
| 4 | VG, BH, EC | Web không có test cho hai mã lỗi mới; dialog xóa không tắt nút sau `LAST_TICKET_TYPE` | low | Đúng → **patch** (tắt nút như `TICKET_TYPE_IN_USE`, 2 test e2e) |
| 5 | BH | Câu báo `PAID_TICKET_TYPE_NOT_ALLOWED` nêu cả hai điều kiện dù chỉ thiếu một | low | Đúng, sửa trực tiếp → **patch** (dựng câu từ `unmet`); câu theo vai trò (Admin/Owner) như `publish-panel` → reject (thêm nhánh, ít gặp) |
| 6 | BH | Hai luật mới chưa có trong epics/spine | low | Đúng, chính bài học C1 → **patch** (epics Story 2.8, AD-25) |
| 7 | BH | Tham số `org` của `audits` không dùng | low | Xóa → **patch** |
| 8 | BH | Sự kiện đã hủy vẫn thêm/xóa Hạng vé được; câu `LAST_TICKET_TYPE` không hợp với Sự kiện đã hủy | low | Có từ trước (spec 2.12 hoãn việc chặn sửa Hạng vé khi đã hủy) → **defer** |
| 9 | BH | Đường mua Hạng vé 0đ trong Sự kiện hỗn hợp (không Token? phát Vé ngay?) chưa quyết cho 3.3/3.4 | medium | Câu hỏi thiết kế Epic 3, không do diff này gây ra → **defer** |
| 10 | BH | Nửa còn lại của deferred 2.10 (sửa Sự kiện/form sau mở bán) không có người nhận | medium | Có từ trước → **defer** kèm người nhận |
| 11 | BH | Race xóa song song hai Hạng vé cuối | false | `lockEvent` khóa dòng `events` `FOR UPDATE` rồi mới đọc Hạng vé: hai lệnh chạy tuần tự, lệnh sau thấy còn 1 → 409 |
| 12 | BH, EC | `LAST_TICKET_TYPE` thắng `TICKET_TYPE_IN_USE` với Hạng vé duy nhất đã bán | low | Cả hai câu đều đúng sự thật; web xử lý hai mã như nhau sau patch #4 → **reject** |
| 13 | BH | Thiếu test guard có phí trên Sự kiện đã hủy | low | Cùng nhánh `status !== 'draft'` đã test với published/hidden → **reject** |
| 14 | BH | Schema `unmet` rộng hơn hai mã thực dùng | low | Mỹ thuật, không ai parse sai → **reject** |
| 15 | BH | Câu lỗi lặp ở flow và `MESSAGES` của `error.filter.ts` | low | Mẫu có sẵn, đã nằm trong E2-5 (bỏ `MESSAGES` chết) → **reject** |
| 16 | BH | Setup SQL Closed Beta/tài khoản nhận tiền chép lần thứ ba | low | Chỉ ảnh hưởng test khi đổi schema → **reject** |
| 17 | BH | Spec, deferred-work, sprint-status lệch trạng thái; Verification thiếu e2e | false | Cập nhật ở bước chốt; e2e chạy ở bước kiểm tra cuối |

## Verification

**Commands:**
- `pnpm --filter @tickee/api test`, `pnpm --filter @tickee/contracts test`, `pnpm --filter @tickee/web test` -- expected: xanh.
- `pnpm --filter @tickee/api typecheck`, `pnpm --filter @tickee/web typecheck`, `pnpm lint:deps` -- expected: sạch.
