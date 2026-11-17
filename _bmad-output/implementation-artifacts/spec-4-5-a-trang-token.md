---
title: 'Story 4.5-a: Trang Token'
type: 'feature'
created: '2026-11-16'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1d110e78c00708b26f108faf2eac1986cee0ce20'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Trang Token của dashboard vẫn là "Sắp có". Owner và Admin không biết BTC còn bao nhiêu Token, nên chỉ phát hiện hết Token khi Sự kiện có phí đã bị "Tạm ngừng bán" (4.2).

**Approach:** `tingee` thêm `getTokenBalance(credential)` đọc số dư và hạn mức Token (timeout 3 giây, không lưu). `organizer` mở `GET /v1/orgs/:orgId/token`, gọi bằng credential hiện hành của tài khoản nhận tiền mặc định. Trang Token hiện số đọc được, hoặc "Chưa đọc được số dư". Owner có "Mua thêm Token" mở portal Tingee.

## Boundaries & Constraints

**Always:**
- **Quyết định của Mason (16/11):**
  - Tingee chưa có API đọc Token bằng key merchant, nên dùng **hợp đồng tạm** như `getGatewayOrder` (4.1) và lời gọi dò dịch vụ (4.2):
    - `POST /v1/merchant/get-token-balance`, body `{}`;
    - trả `{ code: '00', data: { balance, creditLimit } }`, trong đó `balance` là số nguyên (có thể âm), `creditLimit` là số nguyên ≥ 0 (hạn mức âm hoặc trả sau);
    - đường dẫn, field và schema gom ở một chỗ trong adapter, docblock ghi "hợp đồng tạm";
    - Tingee fake trả số. Trên UAT/PROD, trang hiện "Chưa đọc được số dư" cho tới khi đổi adapter.
  - Mã 402 không làm ở story này (ghi `deferred-work.md`).
  - Ngưỡng, job dò, email và banner thuộc 4.5-b.
- **`getTokenBalance`** không ném lỗi. Kết quả:
  - `{ status: 'ok', balance, creditLimit }`;
  - hoặc `{ status: 'unavailable' }`: timeout 3 giây, lỗi mạng, HTTP lỗi, `code` ≠ `'00'`, sai schema, mọi mã credential.
- **Token khả dụng** = `balance + creditLimit`, tính ở server.
- **`GET /v1/orgs/:orgId/token`** (`TOKEN_VIEW`, Owner và Admin):
  - Gọi Tingee ngoài transaction, không retry.
  - Không có tài khoản nhận tiền mặc định → `reading: { status: 'no_payout_account' }`, không gọi Tingee.
  - Không giải mã được credential → `unavailable`.
  - `ok` trả `balance`, `creditLimit`, `available` và `readAt` (đồng hồ server).
  - `tingeePortalUrl` chỉ có khi người gọi có `TOKEN_PURCHASE` (Owner).
- **UX trang Token** (`app/(dashboard)/btc/[orgId]/token`):
  - "Token khả dụng" là `stat-card`; "Số dư" và "Hạn mức trả sau" ở `card` sáng; số định dạng `vi-VN`, số âm có dấu trừ.
  - Dòng "Đọc lúc {HH:mm:ss}" và nút "Tải lại" (spinner, chặn bấm lặp). Không tự đọc lại theo chu kỳ.
  - Đang tải: skeleton.
  - `unavailable`: "Chưa đọc được số dư" + "Thử lại".
  - `no_payout_account`: `empty-state` "Chưa có tài khoản nhận tiền mặc định". Owner có nút tới Tài khoản nhận tiền; Admin thấy "Nhờ Owner liên kết tài khoản nhận tiền."
  - Owner có nút "Mua thêm Token" (`TingeeLink`, tab mới). Admin thấy "Chỉ Owner mua thêm Token." Cả hai thấy "Token mua trên portal Tingee; Tickee không bán Token."
  - Nút "Mua thêm Token" vẫn hiện khi chưa đọc được số dư.
  - Màn 320px không cuộn ngang.

**Never:**
- Không lưu số dư, hạn mức hay Token khả dụng ở DB, audit hay cache server; log chỉ ghi `status`, không ghi số.
- Lời gọi đọc Token không bật hay tắt `payment_service_status`, kể cả khi nhận `TINGEE_CREDENTIAL_INVALID`.
- Không ngưỡng, job, email, banner; không đổi ánh xạ mã lỗi đang có của `tingee`.
- Không migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Đọc được | fake: `balance` 1200, `creditLimit` 500 | khả dụng "1.700", số dư "1.200", hạn mức "500", "Đọc lúc …" | N/A |
| Số dư âm | `balance` -200, `creditLimit` 500 | khả dụng "300", số dư "-200" | N/A |
| Timeout | fake `hang` | "Chưa đọc được số dư" + "Thử lại" sau khoảng 3 giây | `unavailable` |
| Tingee lỗi hoặc sai schema | HTTP 500, `code` ≠ `'00'`, thiếu field, số lẻ | Như trên | `unavailable` |
| Key hỏng | `forbidden` (1133) | Như trên; `payment_service_status` không đổi | `unavailable` |
| Chưa có tài khoản mặc định | không có tài khoản mặc định | `empty-state` theo vai; không gọi Tingee | `no_payout_account` |
| Admin xem | Admin | Đủ số; không có "Mua thêm Token" và `tingeePortalUrl` | N/A |
| Ngoài BTC | BTC khác hoặc CTV | Không đọc | `403 NOT_A_MEMBER` |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tingee/tingee.client.ts`
  - `TingeeClient` (:156-186): thêm `getTokenBalance`.
  - Làm theo mẫu `getMerchantServiceStatus` (:348-374): không ném lỗi; hợp đồng tạm ghi ở docblock :177-185.
  - Timeout: hằng số riêng 3 giây cạnh :47; `send()` dùng `AbortSignal.timeout` (:444); options ở :188-199.
  - Bảng mã lỗi `errors.ts:16-25`: không sửa.
- `apps/api/test/tingee-fake/server.ts`
  - Thêm route (đăng ký ở :710-713, `route()` :483).
  - `FakeMerchant` (:86-108) thêm số dư mặc định và hàng đợi `tokenReplies`; dùng lại `behavior` `hang`/`error`/`forbidden`.
  - Mẫu test: `test/tingee/client.test.ts:596`.
- `apps/api/src/modules/organizer/payout-targets.ts:37-72`: `defaultPayoutTargetOf(db, secretBox, orgId)` trả null (→ `no_payout_account`), hoặc ném `SecretBoxError` (→ `unavailable`). Mẫu dùng: `payment-service.ts:378-454` (`probe`).
- Mới: `apps/api/src/modules/organizer/token.service.ts`, `token.controller.ts`.
  - Đăng ký ở `organizer.module.ts:44-68`.
  - Settings (`secretBox`, `tingeePortalUrl`) dựng như `payoutAccountSettings` (`payout-account.service.ts:84-103`); `TINGEE_CLIENT` inject như :183.
  - Quyền: `@RequirePermission(Permission.TOKEN_VIEW)`; kiểm `TOKEN_PURCHASE` của người gọi bằng `roleHasPermission` (`packages/contracts/src/organizer.ts:51`).
- `packages/contracts/src/organizer.ts`: schema `TokenReading` (union theo `status`) và `TokenOverview`, cùng path builder. Thêm cạnh schema dịch vụ thanh toán.
- Test API:
  - mới `test/organizer/token.test.ts`;
  - `test/organizer/isolation.test.ts`: route được tự phát hiện; thêm `expect(guarded).toContain(…)` và `permissionOf` (:55-145).
- Web (`apps/web`)
  - `app/(dashboard)/btc/[orgId]/token/page.tsx`: thay `ComingSoon`, giữ `metadata`. Nav đã có (`lib/organizer/nav.ts:49`).
  - Vai lấy từ `useCurrentOrganization().role` (`components/tickee/current-organization.tsx:17`).
  - Dùng lại `components/tickee/{stat-card,empty-state,tingee-link}.tsx`.
  - Gọi API theo mẫu `lib/organizer/api.ts`.
  - Mock e2e: `e2e/organizer-mock.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/organizer.ts` (+ test): `TokenReading`, `TokenOverview`, path.
- [x] `apps/api/src/modules/tingee/tingee.client.ts` + `test/tingee-fake/server.ts`: `getTokenBalance` và route fake.
- [x] `apps/api/src/modules/organizer/token.{service,controller}.ts` + `organizer.module.ts`: GET Token.
- [x] Test API: mọi dòng I/O Matrix, cách ly, không đổi `payment_service_status`, log không có số.
- [x] Web: trang Token theo vai, các trạng thái, "Tải lại".
- [x] Test web unit (định dạng số, nội dung theo vai) và e2e `e2e/token.spec.ts` (Owner, Admin, lỗi, chưa có tài khoản, 320px).

**Acceptance Criteria:**
- Given `pnpm lint:deps`, then sạch.
- Given bộ test cách ly, then `GET …/token` được phát hiện và pass.

## Implementation Notes

- `story_key`: `4-5-token-và-cảnh-báo-token`. Story còn 4.5-b (`deferred-work.md`), nên xong 4.5-a thì story vẫn `in-progress`, không đặt `done`. Nhánh `feat/4-5-a-trang-token`.
- Lỗi của chính api Tickee (không phải Tingee) hiện banner danger "Chưa tải được Token" kèm "Thử lại". Spec không nêu trường hợp này.
- `e2e/dashboard-shell.spec.ts` từng dùng trang Token làm trang tạm "Sắp có"; nay dùng Cài đặt.

## Spec Change Log

## Review Triage Log

Lượt 1 (16/11/2026). BH = blind-hunter, ECH = edge-case-hunter, VG = verification-gap.

| # | Nguồn | Phát hiện | Verdict | Route | Bằng chứng |
|---|-------|-----------|---------|-------|------------|
| 1 | BH | "Tải lại"/"Thử lại" lỗi khi đã có số: số cũ và "Đọc lúc" cũ giữ nguyên, không báo lỗi | medium | patch | `token-view.tsx` chỉ xét `isError` khi `!data`; React Query giữ `data` cũ khi refetch lỗi. |
| 2 | BH | `GET …/token` không có cooldown hay single-flight: nhiều tab hay script gọi Tingee không giới hạn bằng key merchant | maybe-false | defer | Chưa biết Tingee có giới hạn tần suất theo key không. Nếu có thì medium (key bị chặn ảnh hưởng `create-link`). Cần chính sách rate limit của Tingee. |
| 3 | BH | Không có cờ cấu hình tắt lời gọi tạm trên PROD | low | reject | Phần đã khóa chấp nhận "Trên UAT/PROD, trang hiện 'Chưa đọc được số dư' cho tới khi đổi adapter". Request ký gửi tới chính Tingee như mọi lời gọi khác; sửa phải thêm biến cấu hình. |
| 4 | BH | "Thử lại sau ít phút." hứa sai khi trạng thái kéo dài trên UAT/PROD | low | patch | `TOKEN_UNAVAILABLE_DESCRIPTION` (`lib/organizer/token.ts`); chỉ cần sửa câu. |
| 5 | BH | Query web vẫn retry 2 lần (global `shouldRetryQuery`) | low | patch | `useQuery` của `TokenView` không đặt `retry`. Lỗi mạng sau khi api đã gọi Tingee → thêm lời gọi Tingee; sửa bằng một dòng. |
| 6 | BH | e2e "không tự đọc lại" không thể fail | low | patch | Cùng gốc #20. |
| 7 | BH | Nhánh tổng quá lớn (`isSafeInteger`) không có test | low | patch | Cùng gốc #23. |
| 8 | BH | Trạng thái lỗi api "Chưa tải được Token" không có e2e | low | patch | Cùng gốc #22. |
| 9 | BH | Owner không có link portal (`none`) chưa được render trong e2e; handler mặc định của mock trả Owner không kèm `tingeePortalUrl` | low | reject | `none` chỉ xảy ra khi api sai (test API khẳng định Owner luôn có link); đã có unit test. Sửa mock phải đưa vai vào handler mặc định (`organizer-mock.ts:90`). |
| 10 | BH | Log "Tingee trả lỗi HTTP" cả khi HTTP 200 mà envelope sai | low | reject | Chỉ gặp khi Tingee trả 200 không phải JSON; sửa phải thêm nhánh. |
| 11 | BH | Mỗi lần lỗi có hai dòng log, không dòng nào đủ ngữ cảnh | false | reject | `platform/logging/logging.module.ts:14-20` gắn `requestId` vào mọi log trong request, nên hai dòng nối được với nhau. |
| 12 | BH | Acceptance Criteria của spec mỏng | low | reject | Sửa thì phải sửa spec của build này. I/O Matrix đã nêu từng kết quả và dòng nào cũng có test. |
| 13 | BH | `formatTokenCount` chép regex của `formatVnd` | low | reject | Không chỉ ra được bên gọi nào lệch; gom helper là thêm public surface ở contracts. |
| 14 | BH | Test so với `toLocaleString('vi-VN')` sẽ fail trên Node small-ICU | false | reject | `package.json` engines `node >=26.12.1`, `.nvmrc` 26.12.1; Node chính thức có full ICU (ICU 78.3 trên máy dev). |
| 15 | BH | Trả chung một object `UNAVAILABLE` dễ bị sửa lây | false | reject | `apps/api/src` không có interceptor nào (grep `implements NestInterceptor` rỗng); body chỉ được serialize. |
| 16 | ECH | Như #1 | medium | patch | Như #1. |
| 17 | ECH | Như #5 | low | patch | Như #5. |
| 18 | ECH | Như #2 | maybe-false | defer | Như #2. |
| 19 | ECH | `no_payout_account` không có nút đọc lại; Admin thấy trạng thái cũ tới khi rời trang | low | reject | Rời trang hoặc tải lại trình duyệt là có lần đọc mới (`gcTime: 0`). Chỉ gặp khi Admin ngồi chờ đúng lúc Owner liên kết; sửa phải thêm nút ngoài UX đã khóa. |
| 20 | VG | e2e "không tự đọc lại" không fail được; reconnect chưa được kiểm | low | patch | Gap đã kiểm: `staleTime` toàn cục 30 giây; `visibilitychange` gửi lên `document` không bubble tới listener trên `window`. |
| 21 | VG | `gcTime: 0` (mở lại trang thì đọc mới) chưa có test | low | patch | Gap đã kiểm: test nào cũng bắt đầu bằng `page.goto`. |
| 22 | VG | Trạng thái lỗi api chưa có test | low | patch | Gap đã kiểm: handler token nào cũng trả 200. |
| 23 | VG | Nhánh tổng quá lớn chưa có test | low | patch | Gap đã kiểm: số lớn nhất trong test là 7.350.291 + 4.816.073. |
| 24 | VG | Như #1 (Other findings) | medium | patch | Như #1. |

## Design Notes

- **Không bật cờ khi gặp `TINGEE_CREDENTIAL_INVALID`.** AD-32 bật `credential_invalid` khi lời gọi bằng credential hiện hành trả mã này. Nhưng đường dẫn Token là giả định: Tingee thật có thể trả mã credential cho một đường dẫn không tồn tại, và khi đó mọi BTC xem trang Token sẽ bị Tạm ngừng bán sai. Đổi lại khi Tingee xác nhận API.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: không lỗi.
- `pnpm lint:deps` -- expected: không vi phạm.
- `pnpm --filter @tickee/api test` -- expected: pass, gồm `isolation.test.ts`.
- `pnpm --filter @tickee/contracts test`, `pnpm --filter @tickee/web test` -- expected: pass.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build` rồi `pnpm --filter @tickee/web exec playwright test e2e/token.spec.ts` -- expected: pass.
