---
title: 'E4-3 (phần B): gộp lời gọi đọc Token theo BTC và cooldown vài giây'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_commit: '22c1da5779ffd6069ad1cbcf61f2ddbfc0bec834'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-11-20.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `GET /v1/orgs/:orgId/token` gọi Tingee ở mọi request, không gộp lời gọi và không có cooldown (retro Epic 4 D2). Key merchant dùng để đọc Token cũng là key ký `create-link`, mà Tingee giới hạn 20 request/10 giây theo key. Owner/Admin mở nhiều tab hay bấm "Tải lại" liên tục, hoặc một script gọi endpoint này, có thể ăn hết hạn mức. Khi đó `create-link` của Người mua bị từ chối (`payment-link.ts:231`) và Đơn hết hạn.

**Approach:** Bọc lời gọi Tingee trong `TokenReader.read` bằng một bản ghi trong bộ nhớ tiến trình, khóa theo `organizationId` + `credentialId`. Các request đồng thời dùng chung lời gọi đang chạy (single-flight). Sau khi lời gọi xong, các lần đọc tiếp theo trong cooldown dùng lại kết quả đó thay vì gọi Tingee.

**Quyết định của Mason (20/11/2026):**
- "Tải lại" trong cooldown trả lại lần đọc vừa có. "Đọc lúc" (`readAt`) giữ giờ của lần đọc thật.
- Cooldown là 5 giây.
- Luật "không cache server" của 4.5-a và chữ "mỗi lần xem" của AD-32 được nới thành: chỉ giữ trong bộ nhớ tiến trình, tối đa 5 giây.
- Giữ nguyên spec dù dài hơn mức gợi ý.

## Boundaries & Constraints

**Always:**
- Chỉ giữ trong bộ nhớ tiến trình. Không ghi số dư, hạn mức hay Token khả dụng vào DB, Redis, audit hay log.
- Khóa gồm `credentialId`: đổi key (2.13-b) hay đổi tài khoản mặc định thì lần đọc sau gọi Tingee bằng key mới ngay.
- Vẫn đọc DB và giải mã key ở mỗi request. `no_payout_account` và "không giải mã được key" không gọi Tingee, nên không giữ lại.
- Giữ cả kết quả `ok` lẫn `unavailable` của một lời gọi Tingee. Lời gọi ném lỗi bất ngờ thì mọi request đang chờ nhận cùng lỗi đó, và kết quả không được giữ lại.
- Mỗi request vẫn tự chạy `evaluateTokenAlert` như hiện nay. Trang Token và job dò mỗi giờ trong cùng một tiến trình dùng chung bản ghi.

**Never:**
- Không đổi `TokenReading`, `@tickee/contracts`, web hay e2e.
- Không gộp hay hãm các lời gọi Tingee khác (`create-link`, "Kiểm tra lại", tra đơn).
- Không chia sẻ kết quả đọc giữa hai BTC, kể cả khi chúng dùng chung một merchant (E4-2 sẽ chặn trường hợp đó).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nhiều tab cùng lúc | 2 GET đồng thời, cùng BTC | 1 lời gọi Tingee; hai response có cùng `reading` | N/A |
| Tải lại trong cooldown | GET thứ hai 1 giây sau GET thứ nhất | 0 lời gọi mới; cùng `readAt` | N/A |
| Hết cooldown | GET sau ≥ cooldown | 1 lời gọi mới, `readAt` mới | N/A |
| Tingee lỗi hay treo | lần đọc `unavailable`, rồi tải lại trong cooldown | `unavailable`, không gọi thêm | N/A |
| Đổi key | key mới lưu trong cooldown | gọi Tingee ngay bằng key mới | N/A |
| Hai BTC | BTC A và B đọc cùng lúc | mỗi BTC một lời gọi | N/A |
| Lỗi bất ngờ | client ném lỗi | các request đang chờ nhận cùng lỗi; lần sau gọi lại ngay | 500 như hiện nay |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/organizer/token.service.ts`:
  - `TokenReader.read` (:109-142): bọc đoạn từ lời gọi `getTokenBalance` (:124) tới khi dựng `TokenReading`. Đoạn đọc DB và giải mã (:110-122) giữ nguyên, chạy ở mọi request.
  - `TokenSettings` (:49) và `tokenSettings()` (:57): thêm `readCooldownMs`, lấy từ hằng `TOKEN_READ_COOLDOWN_SECONDS = 5`.
  - Comment đầu file (:31-44): sửa câu "mỗi lần xem một lần đọc".
- `apps/api/src/modules/organizer/token.controller.ts:17-18`: JSDoc "không lưu, không cache" → mô tả việc gộp lời gọi và cooldown.
- `apps/api/src/modules/organizer/organizer.module.ts:70-71`: chỉ sửa comment "mỗi lần xem". Provider `TOKEN_SETTINGS` (:75) và `invitation-jobs.ts:197` không đổi: cả hai dựng qua `tokenSettings(config)`, nên tự nhận giá trị mặc định. Lưu ý: production chạy trang Token ở tiến trình api, job dò mỗi giờ ở tiến trình worker; mỗi tiến trình một Map riêng.
- `apps/api/test/organizer/token.test.ts`:
  - Harness hiện dùng `createHarness({ TINGEE_BASE_URL })`. Các test cũ đọc lại cùng BTC và mong số mới (:137-140, vòng :176-195), nên phải ghi đè `TOKEN_SETTINGS` với `readCooldownMs: 0` qua `options.overrides` (`test/identity/harness.ts:80`). Tên test :176 ("mỗi lần xem đúng một lời gọi") phải nói rõ là với cooldown 0.
  - Các ca của I/O Matrix nằm trong describe mới, dùng cooldown thật.
  - Chờ request nhập vào lời gọi đang chạy: spy phương thức private `sharedRead` (qua cast) và poll số lần gọi tới đủ số request, rồi mới mở cổng. Không dùng `sleep` cố định: request đến muộn sẽ gọi Tingee lần hai và làm test chập chờn.
  - Test nào giữ lời gọi ở cổng phải mở cổng trong `finally` (hoặc `afterEach`), để lỗi giữa chừng không để lại lời gọi treo.
- `apps/api/test/organizer/token-alert.test.ts`: cũng ghi đè cooldown 0 (các chuỗi 300 → 900 → 300 trên cùng BTC). Test "đọc đồng thời" (:415) có rào chặn chờ 4 lời gọi Tingee; giờ bốn lần đọc chỉ ra 1 lời gọi, nên phải đổi sang cổng mở sau khi spy `sharedRead` đủ 4 lần.
- `apps/api/test/tingee-fake/server.ts`: `fake.calls(TOKEN_BALANCE_PATH)` đếm lời gọi; merchant `behavior: 'hang'` giữ lời gọi khoảng 3 giây.
- Mẫu giả `Date`: `test/ordering/event-sale-status.test.ts:214` (`vi.useFakeTimers({ toFake: ['Date'] })`; timer vẫn thật).
- Không đổi (Never của intent): comment "mỗi lần xem" ở `packages/contracts/src/organizer.ts:516`, `apps/web/app/(dashboard)/btc/[orgId]/token/page.tsx:12`, `token-view.tsx:73-74`, và AC ở `epics.md:1458`. Ghi một mục hoãn thay vì sửa.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/modules/organizer/token.service.ts` -- thêm single-flight + cooldown trong `TokenReader`, xóa bản ghi bằng timer `unref()` khi hết cooldown (Design Notes), `readCooldownMs` trong `TokenSettings`, sửa comment đầu file -- phần lõi của D2, giữ đúng "tối đa 5 giây"
- [x] `apps/api/src/modules/organizer/token.controller.ts` -- sửa JSDoc -- để tài liệu khớp code
- [x] `apps/api/src/modules/organizer/organizer.module.ts` -- sửa comment :70-71 (cùng BTC, cùng key, 5 giây) -- để tài liệu khớp code
- [x] `apps/api/test/organizer/token.test.ts` -- ghi đè cooldown 0 cho các test cũ và sửa tên test :176; thêm một test cho mỗi dòng của I/O Matrix; thêm test cooldown tính từ lúc lời gọi xong (giả `Date`, giữ lời gọi ở cổng, tiến đồng hồ 4 giây rồi mới mở; tải lại ở lúc xong + 5 giây − 1 ms thì dùng lại, ở lúc xong + 5 giây thì gọi mới); thêm test bản ghi bị xóa mà không cần lần đọc kế (dựng `TokenReader` bằng các provider của harness với cooldown nhỏ, poll `sharedReadCount` về 0) -- chứng minh D2 đã đóng
- [x] `apps/api/test/organizer/token-alert.test.ts` -- ghi đè cooldown 0; đổi test "đọc đồng thời" sang cổng + spy `sharedRead`, khẳng định đúng 1 lời gọi Tingee -- giữ các chuỗi đọc cũ xanh, không chập chờn
- [x] `_bmad-output/planning-artifacts/architecture/architecture-tickee-2026-10-28/ARCHITECTURE-SPINE.md:370` -- sửa câu "đọc trực tiếp … mỗi lần xem … không lưu" thành: đọc trực tiếp từ Tingee; các lần xem cùng BTC, cùng credential dùng chung lời gọi đang chạy và kết quả của nó thêm 5 giây sau khi lời gọi xong (chỉ trong bộ nhớ, mỗi tiến trình một bản, xóa khi hết hạn); không lưu -- spine phải khớp code theo quyết định của Mason
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- ghi "Đã xử lý (20/11/2026)" cho :740 và :975 (nêu rõ mỗi tiến trình api và worker giữ một bản riêng); thêm một mục hoãn mới (`source_spec` là spec này): comment "mỗi lần xem" ở `packages/contracts/src/organizer.ts:516`, `apps/web/app/(dashboard)/btc/[orgId]/token/page.tsx:12`, `token-view.tsx:73-74` và AC `epics.md:1458` đã cũ, sửa cùng E4-7 hoặc story kế tiếp chạm các file đó -- đóng mục hoãn và không để comment cũ rơi mất (bài học E4-8)

**Acceptance Criteria:**
- Given log của một lần đọc Token, when kiểm, then không có số dư, hạn mức hay Token khả dụng, kể cả khi kết quả được dùng lại.
- Given một lần đọc đã xong và không có request nào sau đó, when hết cooldown, then bản ghi bị xóa khỏi bộ nhớ: không số nào nằm lại quá 5 giây sau khi lời gọi xong, kể cả ở tiến trình rảnh.
- Given lời gọi Tingee chạy lâu (vd. 4 giây), when tải lại, then cooldown tính từ lúc lời gọi xong, không phải lúc bắt đầu.

## Design Notes

Bản ghi đang chạy có `expiresAt = null`. Khi lời gọi xong:
- đặt `expiresAt = Date.now() + cooldown`;
- hẹn `setTimeout(…, cooldown).unref()` để xóa bản ghi, chỉ khi Map vẫn trỏ tới đúng bản ghi đó.

Lúc tra vẫn kiểm `expiresAt > Date.now()`, nên test giả `Date` (`toFake: ['Date']`, timer vẫn thật) kiểm được ranh giới cooldown. Timer bảo đảm số không nằm trong bộ nhớ quá 5 giây kể cả khi tiến trình rảnh: worker chỉ đọc mỗi giờ, và nếu chỉ dọn khi có lần đọc trượt thì số nằm lại khoảng một giờ. `unref()` để timer không giữ tiến trình sống. Khi lời gọi ném lỗi thì xóa bản ghi ngay. Không cần quét toàn Map.

```ts
const hit = this.shared.get(key);
if (hit && (hit.expiresAt === null || hit.expiresAt > Date.now())) return hit.promise;
// khi lời gọi xong:
entry.expiresAt = Date.now() + cooldownMs;
setTimeout(() => { if (this.shared.get(key) === entry) this.shared.delete(key); }, cooldownMs).unref();
```

## Verification

**Commands:**
- `pnpm --filter @tickee/api typecheck` -- expected: không lỗi
- `pnpm --filter @tickee/api lint:deps` -- expected: không lỗi
- `pnpm --filter @tickee/api exec vitest run test/organizer/token.test.ts test/organizer/token-alert.test.ts` -- expected: xanh (cần Postgres local)
- `pnpm --filter @tickee/api test` -- expected: toàn bộ xanh

## Implementation Notes

- **Ngoài Code Map:**
  - `token-alert.test.ts` › "đọc đồng thời": rào chặn cũ chờ 4 lời gọi Tingee, mà bốn lần đọc đồng thời của một BTC giờ chỉ còn 1 lời gọi, nên test treo. Đã thay bằng cổng: chờ cả bốn lần đọc vào `readAndEvaluate` và lời gọi duy nhất tới fake, chờ thêm 200 ms rồi mới mở. Test giờ khẳng định thêm là đúng 1 lời gọi Tingee.
  - `organizer.module.ts:70`: sửa comment "mỗi lần xem" cho khớp. Spec ghi "không đổi" là nói về provider, không phải comment.
- **Quyết định của agent:**
  - `TokenReader.sharedReadCount` chỉ dùng cho test, theo mẫu `AvailabilityMemo.size`.
  - Test của I/O Matrix chạy trên harness thứ hai cấu hình như production (cooldown 5 giây thật). Harness chính ghi đè cooldown 0.
  - `afterAll` của `token.test.ts` cũng xóa ngưỡng cảnh báo, để job dò của file khác không đọc các BTC tạo trong file này.
- **Rủi ro còn lại:** hai test đồng thời đợi 200 ms vì không có tín hiệu công khai báo một request đã nhập vào lời gọi đang chạy. Ở `token.test.ts`, cooldown thật vẫn phục vụ request đến muộn, nên test không thể sai. Ở `token-alert.test.ts` (cooldown 0), test chỉ chập chờn nếu một lần đọc DB mất hơn 200 ms.
- **Kiểm chứng (local, 20/11):**
  - Subagent: typecheck và lint:deps sạch; hai file token xanh 4 lượt liền; toàn bộ test api (97 file, 1616 test) xanh. Đã cố ý làm hỏng code theo 6 cách (bỏ gom lời gọi, khóa thiếu `credentialId`, khóa chỉ theo `clientId`, giữ bản ghi khi lỗi, không dọn bản ghi, không cooldown), và cách nào cũng làm ít nhất một test đỏ.
  - Kiểm lại sau khi sửa comment module: typecheck sạch, hai file token 42/42 xanh.
- **Vòng review 1 (20/11):** toàn bộ code trên đã revert để làm lại theo Spec Change Log. Các ghi chú ở trên mô tả bản đã revert.

- **Làm lại sau vòng review 1 (20/11):**
  - Code giữ phần KEEP. Bản ghi giờ bị xóa bằng `setTimeout(forget, cooldownMs).unref()` khi lời gọi xong. Không còn `sweepExpired`.
  - Test chờ request nhập lời gọi đang chạy bằng spy `sharedRead`; không còn `sleep` cố định. `afterEach` luôn mở cổng (`held`).
  - Thêm test: cooldown tính từ lúc xong (giả `Date`, `fake.waitFor` rồi tiến đồng hồ 4 giây); bản ghi bị xóa khi rảnh (`readerWith(real, 1_000)`); DB và giải mã chạy ở mọi request kể cả khi còn bản ghi.
  - `newOrg`, `tokenOf` và `overviewOf` lấy harness từ `org.h`.
  - Log của hai app Nest có thể rơi vào capture của `h` (logger Nest dùng chung tiến trình), nên test log đọc cả hai capture.
  - **Kiểm bằng cách làm hỏng code** (subagent; mỗi cách ít nhất một test đỏ, sau đó khôi phục nguyên byte):
    - bỏ gom lời gọi: 3 test đỏ
    - khóa thiếu `credentialId`: 1
    - khóa chỉ theo `clientId`: 10
    - giữ bản ghi khi lỗi: 1
    - không cooldown: 6
    - cooldown tính từ lúc bắt đầu: 2
    - không xóa bản ghi khi rảnh: 1
  - **Kiểm chứng (local, 20/11):** typecheck và lint:deps sạch; hai file token 44/44 xanh. Subagent chạy toàn bộ test api: 97 file, 1618 test xanh.

- **Vá sau review vòng 2 (20/11):** subagent đã làm lại vá 10 mục (#19–#21, #23–#29). Thêm test "timer của bản ghi cũ không xóa bản ghi mới cùng khóa" (`sleepUntil` theo `performance.now()`). Test xóa khi rảnh có cận trên. Test worker thật ghi đè cooldown 0, dùng credential riêng `SCANNED`, khẳng định 2 lời gọi. Comment dùng tên `TOKEN_READ_COOLDOWN_SECONDS`. AD-32 có lý do ở dòng Prevents. `deferred-work.md` thêm JSDoc `TokenBalanceReading` và phần hạn mức còn lại. Bỏ phép kiểm `=== entry` hay trả cooldown của worker về 5 giây đều làm test mới đỏ.
- **Kiểm chứng cuối (local, 20/11):** typecheck và lint:deps sạch; hai file token 45/45 xanh; toàn bộ test api 97 file, 1619 test xanh.

## Spec Change Log

- **Vòng 1 (20/11/2026)**
  - **Phát hiện kích hoạt:** triage #1 (BH, ECH). Bản ghi hết cooldown nằm trong Map tới lần đọc trượt kế tiếp, nên worker giữ số của mọi BTC đã dò khoảng một giờ. Điều này trái quyết định "chỉ giữ trong bộ nhớ tiến trình, tối đa 5 giây". Gốc nằm ở Design Notes: chọn "không dùng timer" và chỉ quét khi tạo bản ghi mới.
  - **Đã sửa:**
    - Design Notes: timer `unref()` xóa bản ghi lúc hết hạn, bỏ quét toàn Map.
    - Code Map: comment `organizer.module.ts`, tiến trình api/worker, chờ bằng spy `sharedRead`, mở cổng trong `finally`, tên test :176, các comment không được đổi.
    - Tasks: thêm `organizer.module.ts`, test cooldown tính từ lúc xong (triage #5), test bản ghi bị xóa không cần lần đọc kế, bỏ `sleep` cố định (#6), mở cổng trong `finally` (#18), câu chữ spine/deferred chính xác hơn (#9), mục hoãn cho comment ở contracts/web/epics (#7b).
    - AC: thay AC "Map không phình" bằng AC xóa lúc hết hạn; thêm AC cooldown tính từ lúc xong.
  - **Trạng thái xấu tránh được:** số dư và hạn mức nằm lại trong bộ nhớ của tiến trình rảnh lâu hơn 5 giây, có khi tới một giờ.
  - **KEEP** (bản trước làm tốt, phải giữ khi làm lại):
    - **Khóa và phạm vi:** khóa `${organizationId}:${credentialId}`. Chỉ bọc từ lời gọi Tingee tới khi dựng `TokenReading`, tách thành `readFromTingee(organizationId, credential)`. DB và giải mã chạy ở mọi request. `no_payout_account` và lỗi giải mã không tạo bản ghi.
    - **Lỗi bất ngờ:** mọi request đang chờ nhận đúng đối tượng lỗi đó. Chỉ xóa bản ghi khi Map vẫn trỏ đúng bản ghi.
    - **API của `token.service.ts`:** export `TOKEN_READ_COOLDOWN_SECONDS = 5`; thêm `TokenSettings.readCooldownMs`; getter `sharedReadCount` chỉ cho test, theo mẫu `AvailabilityMemo.size`.
    - **Harness của `token.test.ts`:** harness chính ghi đè `TOKEN_SETTINGS` bằng `{ ...tokenSettings(apiConfig({ TINGEE_BASE_URL: fake.url })), readCooldownMs: 0 }`. Describe mới dùng harness thứ hai `real`, cấu hình như production.
    - **Helper của `token.test.ts`:**
      - `holdTokenReads(fail?)`: spy `getTokenBalance` của client thật lấy từ `real`, giữ lời gọi sau khi fake đã phản hồi, ném `fail` khi được thả.
      - `overviewOf` và `tokenOf` nhận harness.
      - Merchant `NEXT` cho ca đổi key: gỡ mềm tài khoản và credential bằng SQL, rồi `linkPayoutAccount(org, NEXT, payout)`.
      - `afterAll` xóa ngưỡng cảnh báo của các BTC tạo trong file.
    - **Test của `token.test.ts`:** mỗi dòng I/O Matrix một test. Thêm "mỗi request vẫn tự đánh giá ngưỡng" (đặt ngưỡng trong cooldown, lần xem kế thấy dưới ngưỡng), "log không có số kể cả khi dùng lại", và "lần đọc không gọi Tingee không tạo bản ghi".
    - **`token-alert.test.ts`:** client bọc dùng `gate: Promise<void> | null` thay rào chặn đếm lời gọi.
    - **Câu chữ:** JSDoc của controller, header `token.service.ts`, các câu "Đã xử lý" trong `deferred-work.md`.
    - **Kiểm bằng cách làm hỏng code:** bỏ gom lời gọi, khóa thiếu `credentialId`, khóa chỉ theo `clientId`, giữ bản ghi khi lỗi, không cooldown. Mỗi cách phải làm ít nhất một test đỏ. Thêm hai cách mới: tính cooldown từ lúc bắt đầu, và không xóa bản ghi khi rảnh.

## Review Triage Log

Vòng 1. Ba lớp: Blind Hunter (BH, 15 phát hiện), Edge Case Hunter (ECH, 7), Verification Gap (VG, 1 gap).

| # | Phát hiện | Verdict | Bằng chứng / xử lý |
|---|---|---|---|
| 1 | BH, ECH: bản ghi hết cooldown chỉ bị dọn khi có lần đọc trượt; tiến trình rảnh giữ số lâu hơn 5 giây (worker dò mỗi giờ: khoảng 1 giờ) | medium | Có thật: `sweepExpired` chỉ chạy trong `sharedRead` khi trượt; job dò chỉ chạy ở worker (`worker.module.ts:50`). Trái quyết định "tối đa 5 giây" trong intent. Gốc là Design Notes "không dùng timer" → **bad_spec**, loopback |
| 2 | BH: bản ghi đang chạy không có hạn; lời gọi không bao giờ xong sẽ kẹt trang Token của BTC tới khi khởi động lại | false | Adapter dùng `AbortSignal.timeout` 3 giây và không bao giờ ném (`tingee.client.ts:218, 316, 568`); test "timeout: Tingee treo" chứng minh lời gọi luôn xong |
| 3 | BH, ECH: lần đọc cũ được dùng lại có thể lật cảnh báo đã `recovered` về `crossed` ở tiến trình khác, gửi email sai | low | Có thật nhưng hiếm: cần hai tiến trình đọc cùng BTC và Owner nạp Token, tất cả trong khoảng 5 giây. Production có một api và job dò mỗi giờ ở worker. Sửa phải đưa `readAt` vào CAS (thêm nhánh) → reject |
| 4 | BH: "trang và job dò dùng chung bản ghi" sai ở production vì hai bên ở hai tiến trình | false | Intent ghi "trong cùng một tiến trình"; header code ghi "mỗi instance api, worker một bản riêng". Phần giữ số ở worker thuộc #1 |
| 5 | BH, VG: không test nào chứng minh cooldown tính từ lúc lời gọi xong; comment ở test "Tingee treo" tự nhận đã kiểm | medium | Gap của VG (đã kiểm sẵn): tính `expiresAt` từ lúc bắt đầu vẫn qua mọi test, và cooldown thực chỉ còn khoảng 2 giây khi Tingee chậm → patch, gộp vào spec sửa ở vòng 1 |
| 6 | BH, ECH: `sleep(200)` trước khi mở cổng; request đến muộn gọi Tingee lần hai, test chập chờn (`token-alert.test.ts` cooldown 0, test lỗi bất ngờ) | low | Có thật khi DB chậm hơn 200 ms (CI tải nặng). Sửa trực tiếp: spy `sharedRead` rồi poll → patch, gộp vào spec |
| 7a | BH: tên test `token.test.ts:208` "mỗi lần xem đúng một lời gọi" | low | Chỉ đúng với cooldown 0; sửa tên là thay chữ → patch, gộp vào spec |
| 7b | BH: comment "mỗi lần xem" ở `contracts/organizer.ts:516`, `web/.../token/page.tsx:12`, `token-view.tsx:73-74`, AC `epics.md:1458`; `epic-4-context.md:38` | low | Có thật. Never của intent cấm đổi contracts/web → **defer**: thêm vào task `deferred-work.md` của spec. `epic-4-context.md` là cache tự dựng lại khi planning artifacts mới hơn (spine vừa sửa), nên không cần làm gì |
| 8 | BH: "Tải lại"/"Thử lại" không đổi gì trong cooldown, kể cả sau `unavailable`; web không có tín hiệu | low | Đúng như quyết định của Mason (dùng lại lần đọc, giữ cả `unavailable`). Sửa phải đổi intent → reject. Quay lại từ portal Tingee sau khi mua mất hơn 5 giây |
| 9 | BH: các câu mô tả lệch chi tiết: spine thiếu "tính từ lúc xong" và "mỗi tiến trình", comment module thiếu "cùng credential", deferred-work thiếu worker | low | Có thật; sửa chữ trực tiếp → patch, gộp vào spec (task spine, deferred-work, `organizer.module.ts`) |
| 10 | BH: lệch mẫu `AvailabilityMemo` (inject đồng hồ, xóa lúc tra, giới hạn cỡ); giả `Date` toàn harness thì dễ vỡ | false | Giả `Date` là mẫu sẵn có của repo (`event-sale-status.test.ts:214`), 42 test xanh 4 lượt; số khóa bị chặn bởi số BTC. Phần xóa thuộc #1 |
| 11 | BH: không log hay đếm lần dùng lại | low | Intent không yêu cầu; sửa phải thêm log/metric mới → reject |
| 12 | BH: test cấu hình chỉ kiểm hằng số, không kiểm provider production | false | Các test trên harness `real` (provider như production) chứng minh cooldown 5 giây bằng hành vi; worker dùng cùng `tokenSettings(config)` |
| 13 | BH: mọi request nhận chung một đối tượng `TokenReading`; sửa tại chỗ sẽ rò sang request khác | false | Không có chỗ nào sửa tại chỗ: `overview` dựng object mới, job dò chỉ đọc |
| 14 | BH: `sleep` và cổng chặn viết lặp ở hai file test | low | `sleep` cục bộ là quy ước sẵn có (`token-alert.test.ts:154` có từ trước); không có tác hại cụ thể → reject |
| 15 | BH: diff review thiếu file spec | false | Cố ý: spec chỉ đi tới lớp edge-case dưới dạng claims file |
| 16 | ECH: đồng hồ hệ thống lùi (NTP) làm dùng lại quá 5 giây | low | Hiếm (NTP thường chỉnh dần); sửa phải đổi nguồn đồng hồ và cách test → reject |
| 17 | ECH: nhiều BTC dùng chung `clientId` vẫn nhân số lời gọi trên key | low | Never của intent cấm chia sẻ giữa BTC; E4-2 sẽ chặn dùng chung merchant → reject |
| 18 | ECH: test giữ cổng mà lỗi trước `open()` thì để lại lời gọi treo, kéo theo các test sau | low | Có thật khi một test đã đỏ; sửa trực tiếp bằng `finally`/`afterEach` → patch, gộp vào spec |

Vòng 2. Ba lớp: Blind Hunter (BH, 12 phát hiện), Edge Case Hunter (ECH, 3), Verification Gap (VG, 1 gap).

| # | Phát hiện | Verdict | Bằng chứng / xử lý |
|---|---|---|---|
| 19 | VG, BH: không test nào phủ phép kiểm `this.shared.get(key) === entry` trong `forget`; xóa vô điều kiện vẫn qua mọi test | low | Gap của VG (đã kiểm sẵn). Timer chạy theo đồng hồ đơn điệu, còn hết hạn tính theo `Date.now()`. Khi bản ghi mới thay bản ghi cũ trước lúc timer cũ chạy (event loop bận, đồng hồ nhảy), xóa vô điều kiện sẽ xóa nhầm bản ghi mới và cho lọt thêm lời gọi Tingee → patch: thêm test |
| 20 | BH: mục hoãn mới thiếu JSDoc `TokenBalanceReading` (`contracts/organizer.ts:532-535`: "mỗi lần xem là một lần đọc mới", `readAt` "lúc api đọc") | low | Có thật (đã đọc file). Sửa chữ trong `deferred-work.md` → patch |
| 21 | BH: test "bản ghi bị xóa khi rảnh" không có cận trên, mốc giờ lấy trước lần đọc | low | Có thật: timer chạy trễ gấp đôi cooldown vẫn qua (poll 5 giây cho cooldown 1 giây). Sửa trực tiếp trong test → patch |
| 22 | BH: test "hai BTC" không bắt được việc bỏ `organizationId` khỏi khóa | false | `credentialId` là `tingee_credentials.id` của từng BTC (`payout-targets.ts:48, 67`): hai BTC cùng merchant vẫn khác `credentialId`, nên bất biến "không chia sẻ giữa hai BTC" vẫn giữ dù bỏ tiền tố; test kiểm đúng bất biến đó |
| 23 | BH, ECH: describe "worker thật" dùng cooldown 5 giây production; lần dò thứ hai có thể dùng lại lần đọc đầu; header file ghi cooldown 0 cho cả file | low | Có thật (`token-alert.test.ts:793-795` dựng `WorkerModule` không ghi đè). Lần dò thứ hai vẫn đánh giá ngưỡng, nhưng có đọc lại Tingee hay không thì tùy thời gian gửi email → patch: ghi đè cooldown 0, khẳng định 2 lời gọi |
| 24 | BH: comment `organizer.module.ts` thiếu "thêm", thiếu "chỉ trong bộ nhớ, mỗi tiến trình một bản", còn câu "đánh giá sau mỗi lần đọc" | low | Có thật; sửa chữ → patch |
| 25 | BH: JSDoc controller ghi "không lưu số ở DB hay log", hẹp hơn luật "DB, Redis, audit hay log" | low | Có thật; sửa chữ → patch |
| 26 | BH: AD-32 thiếu lý do ở dòng Prevents, Rule không nói `unavailable` cũng được dùng lại | low | Có thật; người đọc sau có thể "sửa" cooldown về đọc mỗi lần xem. Sửa chữ → patch |
| 27 | BH: không ghi phần hạn mức còn lại (N instance api → N lời gọi mỗi 5 giây; giả định một api) | low | Có thật: bản vòng 1 có câu này, bản làm lại bỏ mất. Sửa chữ trong `deferred-work.md` → patch |
| 28 | BH: "5 giây" viết cứng ở comment code thay vì tên hằng | low | Có thật ở header service và JSDoc controller; đổi hằng thì comment sai mà không ai biết. Sửa chữ → patch (spine và `deferred-work.md` giữ số 5 vì là tài liệu nghiệp vụ) |
| 29 | BH: test "lỗi bất ngờ" có `.then((res) => res)` vô tác dụng, cặp `toEqual`/`toBe` lặp, không kiểm body 500 | low | Có thật; dọn trực tiếp → patch |
| 30 | BH: getter `sharedReadCount` chỉ cho test mà không đánh dấu | false | JSDoc đã ghi "chỉ cho test", theo mẫu `AvailabilityMemo.size` |
| 31 | ECH: lần đọc cũ được dùng lại lật cảnh báo về `crossed` ở tiến trình khác | low | carried: trùng #3 (cùng chỗ, cùng ý; code vẫn như #3 mô tả) → reject |
| 32 | ECH: test chỉ giả `Date`; timer xóa 5 giây là thật, CI chậm có thể xóa sớm làm test dùng lại chập chờn | low | Các bước giữa lần đọc đầu và lần dùng lại trong test chỉ mất cỡ dưới 1 giây, còn biên an toàn là 5 giây thật. Sửa phải inject đồng hồ và bộ hẹn giờ (thêm tham số) → reject |
