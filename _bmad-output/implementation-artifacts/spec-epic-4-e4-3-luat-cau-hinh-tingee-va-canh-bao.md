---
title: 'E4-3 (phần A): luật cấu hình cho cảnh báo vận hành, Đối soát bù và Tingee ở local'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_commit: 'bdd326ce46a9123cc849736f535bb4273edb0783'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-11-20.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ba cấu hình sai vẫn cho api/worker khởi động mà không báo gì (retro Epic 4 D1, E5, E8/G4):
- Worker production thiếu `OPS_ALERT_EMAILS`: mọi cảnh báo vận hành chỉ ra log, mà dấu chống lặp vẫn ghi nên đặt biến sau cũng không gửi lại.
- `TINGEE_ORDER_STATUS_QUERY=true` chép từ `.env.example` lọt lên staging/production: worker gọi Tingee thật bằng hợp đồng tạm mà chỉ fake hiểu.
- `.env` local trỏ Tingee thật, trái AD-36 ("`local` không nhận IPN thật, dùng Tingee fake"); lỗi này đã xảy ra lại trong Epic 4.

**Approach:** Thêm ba `CrossRule` vào `config.schema.ts`, cùng mẫu `ADMIN_ALLOWED_CIDRS`:
1. `NODE_ENV=production`: worker bắt buộc có `OPS_ALERT_EMAILS`.
2. `NODE_ENV=production`: `TINGEE_ORDER_STATUS_QUERY` phải tắt.
3. `NODE_ENV=development`: api và worker từ chối `TINGEE_BASE_URL` có host không phải local, trừ khi bật cờ opt-in mới `TINGEE_ALLOW_REAL_IN_DEVELOPMENT=true`.

Đây chỉ là phần A của E4-3. Phần B (single-flight cho Token) và phần test của E4-10 đã ghi vào `deferred-work.md` ngày 20/11.

## Boundaries & Constraints

**Always:**
- Lỗi đi qua `ConfigError` như các luật hiện có: nêu đủ mọi biến vi phạm trong một lượt, chỉ nêu tên biến và lý do, không bao giờ nêu giá trị.
- Mỗi vai chỉ kiểm biến nó đọc (`withCrossRules` tự bỏ luật thiếu biến): luật 1 và 2 chỉ áp cho worker; luật 3 áp cho cả api và worker.
- "Host local" dùng `isLocalHost` có sẵn: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`.
- Cờ opt-in là `z.stringbool().default(false)`, nằm trong `tingeeAndTickets`, và chỉ có tác dụng khi `NODE_ENV=development`.
- Luật 3 coi mọi host không phải local là Tingee thật, kể cả UAT. Lý do: AD-36 ghi local dùng fake, UAT dành cho staging; README "Hai bẫy" cũng ghi "UAT hay production".

**Never:**
- Không áp luật 3 cho `NODE_ENV=test`: test dùng URL UAT làm giá trị giả, và e2e full-stack chạy `test` với fake.
- Không thêm đường thoát cho luật 2 ở production. Story thay hợp đồng tạm bằng hợp đồng thật sẽ gỡ luật này.
- Không đổi hành vi runtime của kênh cảnh báo, job tra hay `TingeeClient`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Prod thiếu người nhận | worker, `production`, không có `OPS_ALERT_EMAILS` (hoặc để rỗng) | thoát 1 | issue `OPS_ALERT_EMAILS` (`thiếu`) |
| Prod bật tra đơn | worker, `production`, `TINGEE_ORDER_STATUS_QUERY=true` | thoát 1 | issue `TINGEE_ORDER_STATUS_QUERY`, lý do nêu "phải tắt khi NODE_ENV=production", không có giá trị |
| Dev trỏ Tingee thật | api hoặc worker, `development`, `TINGEE_BASE_URL=https://uat-open-api.tingee.vn` | thoát 1 | issue `TINGEE_BASE_URL`, lý do nêu cờ `TINGEE_ALLOW_REAL_IN_DEVELOPMENT`, không có URL |
| Dev opt-in | như trên + `TINGEE_ALLOW_REAL_IN_DEVELOPMENT=true` | khởi động bình thường | N/A |
| Dev dùng fake | `.env.example` nguyên trạng (`http://localhost:4010`) | khởi động như trước | N/A |
| Test dùng URL thật | `test`, URL UAT | khởi động như trước | N/A |
| Prod đặt cờ opt-in | `production`, cờ `true` | cờ bị bỏ qua; luật https vẫn áp như cũ | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/platform/config/config.schema.ts`:
  - `CROSS_RULES` (:309): thêm ba luật cạnh luật `ADMIN_ALLOWED_CIDRS` (:311-316).
  - `tingeeAndTickets` (:69): thêm cờ opt-in.
  - `OPS_ALERT_EMAILS` (:185) và `TINGEE_ORDER_STATUS_QUERY` (:422): sửa JSDoc theo luật mới.
- `apps/api/src/platform/config/production-rules.ts`: dùng lại `hostOf` và `isLocalHost`. Nếu cần một hàm thuần "URL có host local không" thì thêm ở đây.
- `apps/api/src/platform/config/index.ts`: export mọi hàm mới mà test cần.
- `apps/api/test/config.test.ts`:
  - `apiEnv`/`workerEnv` dùng `TINGEE_BASE_URL` UAT. Mọi ca `NODE_ENV: 'development'` (khoảng :473, :512, :587, :608, :626, :634, :646, :673, :791, :800, :819) sẽ đỏ, nên phải trỏ fake local hoặc bật cờ.
  - `workerProdEnv` (:63) phải thêm `OPS_ALERT_EMAILS`.
  - Sửa :155-162 (đang khẳng định biến tùy chọn): giữ ý đó cho `test`/`development`.
- `apps/api/test/roles.process.test.ts:214`: danh sách biến vi phạm của worker khi chạy production với `.env.example` thêm `OPS_ALERT_EMAILS` và `TINGEE_ORDER_STATUS_QUERY`.
- `.github/workflows/ci.yml:172-190`: bước "Chạy image vai worker ở production" phải giữ ý "mọi biến hợp lệ trừ `WEB_ORIGIN`", nên thêm `-e OPS_ALERT_EMAILS=…@example.test`.
- `.env.example`: comment đầu file (:4-11) liệt kê luật production; khối `TINGEE_BASE_URL` (:72-79) và `OPS_ALERT_EMAILS` (:123-130).
- `README.md`: bảng luật production (:360-365), mục "Hai bẫy" (:90-92), bảng biến (:555-565), mục "Cảnh báo vận hành" (:248).
- Không đổi: `alerts.module.ts`, `ops-alert-jobs.ts` (warn lúc khởi động vẫn đúng cho dev), `e2e-stack/main.ts` (đang dùng `NODE_ENV=test`).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/platform/config/config.schema.ts` -- thêm cờ `TINGEE_ALLOW_REAL_IN_DEVELOPMENT` và ba `CrossRule`; sửa JSDoc liên quan -- đây là phần lõi của E4-3 A
- [x] `apps/api/test/config.test.ts` -- thêm test cho từng dòng của I/O Matrix (gồm worker và api cho luật 3, và lỗi không chứa giá trị); sửa fixture `development` và `workerProdEnv` -- vừa chứng minh luật mới, vừa giữ các test cũ xanh
- [x] `apps/api/test/roles.process.test.ts` -- cập nhật danh sách biến vi phạm của worker -- `.env.example` ở production giờ vi phạm thêm hai luật
- [x] `.github/workflows/ci.yml` -- thêm `OPS_ALERT_EMAILS` vào bước kiểm image worker -- giữ đúng ý của bước kiểm
- [x] `.env.example`, `README.md` -- ghi ba luật và cờ opt-in (cách dùng: UAT qua đường hầm cho E3-3) -- tài liệu phải khớp code
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- thêm một dòng ngay sau mục :601-603 (thay hợp đồng tạm của API tra đơn): story nào làm mục đó cũng phải gỡ luật production của `TINGEE_ORDER_STATUS_QUERY` -- để luật 2 không bị bỏ quên khi có hợp đồng thật (bài học E4-8)

**Acceptance Criteria:**
- Given `.env.example` nguyên trạng, when chạy `pnpm dev`, then api và worker khởi động như trước.
- Given worker chạy production với `.env.example`, when khởi động, then output nêu cả `OPS_ALERT_EMAILS` và `TINGEE_ORDER_STATUS_QUERY` cùng các biến cũ trong một `ConfigError`.

## Design Notes

Thêm cờ thay vì chặn hẳn, vì vẫn có lúc cần gọi Tingee thật từ máy dev: lỗi 2023 của 4.2-d được phát hiện như vậy, và E3-3 có thể chạy UAT qua đường hầm. Bật cờ là ý định rõ ràng. Thiếu cờ thì dừng, đúng loại lỗi mà G4 đã gặp.

## Verification

**Commands:**
- `pnpm --filter @tickee/api typecheck` -- expected: không lỗi
- `pnpm --filter @tickee/api lint:deps` -- expected: không lỗi
- `pnpm --filter @tickee/api exec vitest run test/config.test.ts test/roles.process.test.ts` -- expected: xanh (cần Postgres local cho roles.process)
- `pnpm --filter @tickee/api test` -- expected: toàn bộ xanh

## Implementation Notes

- **Quyết định của agent:**
  - Thêm hàm thuần `isLocalUrl` vào `production-rules.ts`, dựng trên `hostOf` và `isLocalHost`.
  - Test dùng helper `inNodeEnv` để trỏ các ca `development` vào Tingee fake.
  - Lý do lỗi của luật 3 nêu cả cờ opt-in lẫn việc staging/production phải đặt `NODE_ENV=production` (review #1).
- **Ngoài Code Map:** sửa `apps/api/test/helpers.ts`. `apiConfig()` và `workerConfig()` dựng object có kiểu, nên phải có cờ mới (`false`), nếu không typecheck đỏ.
- **Bước CI kiểm image worker** giờ kiểm output có đúng một `"variable":"` (review #5). Đoạn shell đã chạy thử trên `node apps/api/dist/main.js` với cùng env:
  - có `OPS_ALERT_EMAILS`: đếm được 1;
  - không có `OPS_ALERT_EMAILS`: đếm được 2, in `::error::`.
- **Kiểm chứng (local, 20/11):**
  - typecheck, lint:deps và toàn bộ test api (97 file, 1605 test) đều xanh, chạy lại sau các patch của review.
  - Đã khởi động thử: với `.env.example` ở `development`, cả api và worker qua được bước đọc cấu hình. Với URL UAT, api thoát 1 và output không chứa URL.

## Spec Change Log

## Review Triage Log

Ba lớp review: Blind Hunter (BH, 12 phát hiện), Edge Case Hunter (EC, 5), Verification Gap (VG, không có gap, 1 mục khác).

| # | Phát hiện | Verdict | Bằng chứng / xử lý |
|---|---|---|---|
| 1 | BH: `NODE_ENV=development` bị chép lên staging/production với Tingee thật thì lỗi mới khuyên bật cờ opt-in; làm theo sẽ quay về trạng thái mọi luật production tắt | low | Có thật: lời khuyên duy nhất trong lỗi là bật cờ. Không tệ hơn trước thay đổi (trước đó chỉ có warn 4.7-f), nhưng sửa chỉ là đổi câu chữ. **patch**: thêm "staging/production phải đặt NODE_ENV=production" vào lý do. Phần tài liệu là false: README:360 và `.env.example:12` nói về các luật production, và các luật đó vẫn tắt mà không lỗi |
| 2 | BH: bật cờ opt-in mà `TINGEE_ORDER_STATUS_QUERY=true` (mặc định `.env.example`) thì worker gọi API tra đơn của Tingee thật bằng hợp đồng tạm | low | Có thật, nhưng chỉ ở máy dev với Tingee UAT, không có tiền thật; README và `.env.example` đã dặn tắt cờ tra đơn khi bật opt-in. Chỉ gặp khi cố ý bật opt-in, mà sửa phải thêm luật mới → reject |
| 3 | BH: cờ opt-in không có warn lúc khởi động; production/test bỏ qua cờ mà không báo | low | Cờ do dev tự đặt trong `.env`; thiếu warn không gây hỏng gì. Sửa phải thêm marker log mới → reject |
| 4 | BH: luật `OPS_ALERT_EMAILS` chỉ kiểm có đặt; địa chỉ `.local`/`.test` (vd. `van-hanh@tickee.local`) vẫn qua ở production | low | Có thật, nhưng phải chép `.env` local lên production mới gặp, mà khi đó các luật giá trị mẫu (secret) cũng chặn. Sửa phải thêm luật TLD dành riêng → reject |
| 5 | BH: bước CI kiểm image worker không kiểm `WEB_ORIGIN` là issue duy nhất; dòng `-e OPS_ALERT_EMAILS` thêm hay không bước vẫn xanh | low | Đúng: bước chỉ grep `"variable":"WEB_ORIGIN"` (`ci.yml:191-199`), nên ý "mọi biến hợp lệ trừ WEB_ORIGIN" mà spec yêu cầu giữ chưa được kiểm. **patch**: kiểm output có đúng một `"variable":` |
| 6 | BH: mục mới trong `deferred-work.md` trỏ `:739` và `:629-630` theo số dòng cũ, trong khi diff chèn một dòng ở 604 | low | Đúng: sau khi chèn, :739 là dòng `source_spec` của 4.5-a, :629 là dòng trống; nội dung muốn trỏ nằm ở :740 và :630-631. **patch** |
| 7 | BH: hai mục tách phạm vi ghi `source_spec: none`; dòng "Ghi thêm cho mục trên" lệch định dạng | false | `source_spec: none` là định dạng bắt buộc của bước tách phạm vi (cùng cách các mục tách 4.7 đã ghi). Dòng ghi thêm theo lối "Đã xử lý (ngày): …" đã có trong file. Spec sẽ được commit cùng nhánh |
| 8 | BH: `sprint-status.yaml` chưa cập nhật trong PR | false | Bước On Complete (`_bmad/custom/bmad-build.toml`) ghi `in-progress` + `note` cho E4-3 bằng commit riêng trên nhánh này. E4-10 vẫn `open` đúng thực tế; phần test đã có mục trong `deferred-work.md` |
| 9 | BH: vòng "không in giá trị" của `roles.process.test.ts` giờ khẳng định output không bao giờ chứa chuỗi `true` (giá trị của `TINGEE_ORDER_STATUS_QUERY`) | low | Đúng: vòng lặp kiểm mọi biến có giá trị, mà `true` không phải secret. Thêm một trường boolean vào log khởi động sau này sẽ làm test đỏ mà không vì lý do bảo mật nào. **patch**: bỏ qua biến cờ không bí mật |
| 10 | BH: không có test cấp tiến trình cho luật development | false | Mọi `ConfigError` đi chung đường thoát 1 của `main.ts`, đã có test tiến trình cho production. Logic riêng của luật có đủ test qua `loadConfig`; lớp VG cũng không thấy gap |
| 11 | BH, EC: `isLocalUrl` từ chối `0.0.0.0`, `host.docker.internal`, tên service compose; lý do bảo "gọi Tingee thật" | low | Intent đã chốt dùng `isLocalHost`. Compose không chạy api (chỉ postgres, mailpit, minio, otel-lgtm) nên dev không gặp ca này hằng ngày; sửa phải mở rộng danh sách host → reject |
| 12 | BH: test luật https bật cờ opt-in cho mọi biến, ở cả `development` lẫn `test` | low | Cờ chỉ cần cho `TINGEE_BASE_URL` ở `development`; bật cho mọi ca thì khó thấy ca nào thật sự cần. Không làm sai kết quả, sửa trực tiếp. **patch** |
| 13 | EC: cờ opt-in sai dạng ở production/test làm tiến trình dừng, dù tài liệu ghi "bỏ qua cờ" | false | Giá trị sai dạng báo lỗi có tên biến, giống mọi biến có kiểu khác của repo; tiến trình dừng ồn ào, không âm thầm làm sai. "Bỏ qua" nói về nghĩa của giá trị hợp lệ |
| 14 | EC: development + cờ + `TINGEE_ORDER_STATUS_QUERY=true` gọi hợp đồng tạm tới Tingee thật | low | Trùng #2 → reject |
| 15 | EC: `0.0.0.0`, `host.docker.internal`, tên service compose | low | Trùng #11 → reject |
| 16 | EC: bước CI không kiểm `WEB_ORIGIN` là issue duy nhất | low | Trùng #5 → patch |
| 17 | EC: số dòng trong `deferred-work.md` lệch một | low | Trùng #6 → patch |
| 18 | VG: bước CI xanh dù có hay không dòng `OPS_ALERT_EMAILS` | low | Trùng #5 → patch. VG không thấy gap kiểm chứng nào: mọi luật có test cả vế đỏ lẫn vế xanh |
