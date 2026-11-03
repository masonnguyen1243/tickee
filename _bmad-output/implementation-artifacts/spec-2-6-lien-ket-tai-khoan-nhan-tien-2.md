---
title: 'Story 2.6: Liên kết tài khoản nhận tiền (BTC dùng key Tingee của mình)'
type: 'feature'
created: '2026-11-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a8ad6e84d627015fde80b10226dc55130fed7134'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-03.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Code 2.6 hiện có (commit `178bd2c`) làm theo mô hình Tickee là Master Merchant (Merchant con, `create-va`/`confirm-va` + OTP ngân hàng). Sprint Change Proposal 03/11/2026 đã thay mô hình này: mỗi BTC dùng tài khoản merchant Tingee của chính mình (FR-5, AD-6, AD-7, AD-9, AD-35, UX-DR40).

**Approach:** Owner nhập Client ID và Secret Token. `organizer` gọi `tingee.listAccounts(credential)` (`POST /v1/get-va-paging`) ngoài transaction. Key đúng thì lưu credential (secret mã hóa) và trả danh sách tài khoản. Owner chọn một tài khoản, hệ thống lưu thành tài khoản nhận tiền. Sau đó trang hiện URL IPN riêng của BTC và checklist cấu hình portal Tingee. Phần nào của code cũ được giữ hay bỏ thì theo bảng "Kỹ thuật" ở §2 của đề xuất.

## Boundaries & Constraints

**Always:**
- `tingee` là nơi duy nhất gọi Tingee. Mỗi lời gọi nhận `TingeeCredential {clientId, secretToken}` làm tham số và không gửi `merchantId`. Giữ nguyên cách `post()` ký request, timeout 15 giây, đọc envelope và log an toàn. Bảng mã:
  - `TINGEE_CREDENTIAL_INVALID` (422) ← 92, 97, 1133.
  - `MERCHANT_SUSPENDED` (409) ← 1007, 1034.
  - `PAYMENT_PROVIDER_UNAVAILABLE` (503) ← mọi mã khác, timeout, lỗi mạng, dữ liệu sai dạng.
- Env api: bỏ `TINGEE_CLIENT_ID` và `TINGEE_SECRET_TOKEN`, giữ `TINGEE_BASE_URL`, thêm `TINGEE_CREDENTIAL_KEYS`.
  - Dạng `v<k>:<base64 của 32 byte>`, nhiều khóa cách nhau bằng dấu phẩy. Zod kiểm: có ít nhất 1 khóa, mỗi khóa đúng 32 byte, không trùng `k`.
  - Mã hóa AES-256-GCM bằng khóa có `k` lớn nhất. Ciphertext có tiền tố `v<k>:` (AD-23); giải mã chọn khóa theo tiền tố.
- Secret Token chỉ lưu dạng ciphertext. Nó không bao giờ có trong response, log, audit hay lỗi. `organizer` giải mã ngay trước khi gọi `tingee`. Client ID trả về dạng che: `••••` + 4 ký tự cuối.
- Mọi route chỉ cho Owner (`PAYOUT_ACCOUNT_MANAGE`). Admin nhận `FORBIDDEN_ROLE`; web giữ `OwnerOnly`.
- Tingee luôn được gọi ngoài `db.transaction`. Mỗi lần ghi là một transaction riêng, có audit (chỉ ghi tên trường): `tingee_credential.connected`, `payout_account.linked`.
- Danh sách tài khoản:
  - Chỉ gồm tài khoản `status: active`, bỏ các dòng `transactionType: debit`.
  - Mỗi dòng có ngân hàng, `•••• 1234` và tên chủ tài khoản.
  - Tài khoản `bankBin 970415` có `selectable: false`.
- Khi chọn tài khoản, server đọc lại danh sách từ Tingee bằng credential hiện hành:
  - VA không còn `active` → `PAYOUT_ACCOUNT_UNAVAILABLE` (409).
  - VietinBank → `BANK_NOT_SUPPORTED` (422).
  - Cả hai trường hợp đều không lưu gì.
- Mỗi BTC có tối đa một credential hiện hành và một tài khoản nhận tiền hiện hành (unique index một phần). Đã có tài khoản nhận tiền thì gửi key hoặc chọn lại nhận `409 PAYOUT_ACCOUNT_ALREADY_LINKED`; đổi là việc của Story 2.13.
- **Quyết định 03/11/2026 (Mason):** đã kết nối key nhưng chưa chọn tài khoản thì trang có link "Dùng key khác" để nhập lại key, không cần xác nhận lại. Credential cũ chuyển `retired_at`, không xóa. Key mới sai thì credential cũ vẫn là hiện hành.
- `ipnKey` là chuỗi ngẫu nhiên 128 bit dạng base64url, mỗi BTC một chuỗi. Sinh khi lưu credential lần đầu và không đổi khi nhập key khác. URL IPN = `API_PUBLIC_URL` + `/v1/payments/tingee/ipn/{ipnKey}`.
- Banner `PAYOUT_ACCOUNT_NOT_LINKED` giữ như cũ (Owner có "Liên kết ngay", Admin thấy "Nhờ Owner…"). Banner mất khi BTC có tài khoản nhận tiền hiện hành.
- Copy web theo AC Story 2.6 trong `epics.md`:
  - Lỗi tại form: "Client ID hoặc Secret Token không đúng.", "Tingee tạm lỗi, thử lại sau ít phút." + "Thử lại"; giữ nguyên dữ liệu đã nhập.
  - Danh sách: "Chưa hỗ trợ VietinBank", nút "Dùng tài khoản này".
  - Danh sách rỗng: `empty-state` "Tài khoản Tingee của bạn chưa liên kết tài khoản ngân hàng nào." + link portal + "Tải lại".
  - Đã liên kết: badge success "Đã liên kết", nút "Sao chép" (toast "Đã sao chép"), checklist portal hai bước.
  - BTC chưa có tài khoản Tingee: hướng dẫn ba bước kèm link.

**Never:**
- Không làm các việc của story khác:
  - Đổi tài khoản hoặc đổi key sau khi đã liên kết, `REAUTH_REQUIRED`, email cảnh báo (Story 2.13).
  - Endpoint IPN (Story 3.5).
  - `payment_service_status` / `credential_invalid` (Story 4.2).
  - `publishReadiness` (Story 2.10).
- Không giữ Merchant con, `create-va`, `confirm-va`, OTP ngân hàng, `PAYOUT_ACCOUNT_LINKING`, `organizations.tingee_merchant_id` hay danh sách 5 ngân hàng.
- Test tự động không gọi Tingee thật. Không đọc hay in giá trị key trong `.env`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Kết nối | Key đúng; Tingee trả 3 tài khoản (1 VietinBank, 1 `inactive`) | 200; credential lưu dạng ciphertext; 2 dòng, VietinBank `selectable: false` | — |
| Key sai | Tingee trả 92/97/1133 | 422 `TINGEE_CREDENTIAL_INVALID`; không ghi DB | Lỗi tại form, giữ dữ liệu |
| Tingee lỗi | Timeout / 500 / dữ liệu sai dạng | 503 `PAYMENT_PROVIDER_UNAVAILABLE`; không ghi DB | "Thử lại" |
| Danh sách rỗng | Key đúng, 0 tài khoản `active` | 200, credential lưu, `accounts: []` | `empty-state` + "Tải lại" |
| Chọn | VA `active`, không phải VietinBank | 200, tài khoản hiện hành; notice NOT_LINKED mất; overview có `ipnUrl` | — |
| Chọn VietinBank | VA ngân hàng 970415 | 422 `BANK_NOT_SUPPORTED`, không lưu | — |
| VA không còn | VA không còn trong danh sách `active` | 409 `PAYOUT_ACCOUNT_UNAVAILABLE` | "Tải lại" |
| Đã liên kết | Gửi key hoặc chọn lại | 409 `PAYOUT_ACCOUNT_ALREADY_LINKED`, không gọi Tingee | — |
| Admin | Mọi route | 403 `FORBIDDEN_ROLE` | — |
| Hai tab | Chọn hai VA cùng lúc | Đúng một tài khoản hiện hành | Tab sau nhận 409 |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/tingee/`:
  - Giữ `signing.ts` (và `test/tingee/signing.test.ts`).
  - `errors.ts`: bảng mã mới.
  - `tingee.client.ts`: options chỉ còn `baseUrl`, `timeoutMs`, `now`; `post(credential, path, payload)`. Bỏ `createMerchant`/`createVa`/`confirmVa` và các type của chúng. Thêm `listAccounts(credential): Promise<TingeeAccount[]>` với body `{skipCount: 0, maxResultCount: 200}`. Parse từng dòng: dòng sai dạng thì bỏ và log warn số dòng bị bỏ. Trả `accountLast4`, không trả số tài khoản gốc.
  - `tingee.module.ts`: `forRoot({baseUrl})`.
  - Thêm `tingeePortalUrl(baseUrl)`: host `uat-open-api.tingee.vn` → `https://uat-baas-portal.tingee.vn`, host khác → `https://baas.tingee.vn`.
  - `index.ts`: cập nhật export.
- `apps/api/src/platform/crypto/` (mới): `secret-box.ts` gồm `parseCredentialKeys(raw)` và `SecretBox` (`seal`/`open`); dùng chung được cho AD-23 sau này. Thêm `index.ts`.
- `apps/api/src/platform/config/config.schema.ts:59-67`: thay 3 khóa Tingee. Sửa theo: `test/helpers.ts:35-38`, `test/config.test.ts:15-17,132-142`, `test/roles.process.test.ts:26-28`.
- `apps/api/src/api.module.ts:32-37`: `TingeeModule.forRoot({baseUrl})`. `OrganizerModule.forRoot(config)` nhận `API_PUBLIC_URL`, `TINGEE_BASE_URL`, `TINGEE_CREDENTIAL_KEYS`.
- `apps/api/src/modules/organizer/schema.ts`:
  - Bỏ `tingeeMerchantId`; thêm `organizations.tingee_ipn_key text UNIQUE`.
  - Bảng mới `tingee_credentials`: `organization_id`, `client_id`, `secret_token_ciphertext`, `created_by`, `created_at`, `retired_at`. Unique một phần trên `organization_id WHERE retired_at IS NULL`.
  - `payout_accounts` viết lại: `tingee_credential_id` (FK), `va_account_number`, `bank_bin`, `bank_name`, `account_type`, `account_last4`, `account_name`, `tingee_shop_id`, `created_by`, `linked_at`, `retired_at`. Unique một phần như trên.
- `apps/api/drizzle/0008_*.sql`, `meta/0008_snapshot.json`, `meta/_journal.json`: xóa bản cũ rồi chạy `pnpm --filter @tickee/api db:generate --name tingee_credentials`.
- `apps/api/src/modules/organizer/payout-account.{service,controller}.ts`: viết lại.
  - Giữ khung: `orgScope`, `audit.record`, lỗi DB chỉ log `dbErrorSummary`. Mỗi transaction ghi bắt đầu bằng khóa dòng `organizations FOR UPDATE`.
  - Route:
    - `GET /v1/orgs/:orgId/payout-account`: overview, không gọi Tingee.
    - `POST …/payout-account/credential`: kết nối bằng key.
    - `GET …/payout-account/options`: đọc lại danh sách; BTC chưa có credential → 404 `NOT_FOUND`.
    - `POST …/payout-account` với `{vaAccountNumber}`: chọn tài khoản.
  - `payoutAccountStatusOf` chỉ còn `linked | not_linked`. Cập nhật `organizer.module.ts` và export ở `index.ts`.
- `apps/api/src/modules/reporting/notices.service.ts:60-95`: bỏ nhánh `awaiting_otp`.
- `apps/api/src/platform/{audit/audit.ts:32-40, http/app-error.ts:28-35, http/error.filter.ts:32-39}`: đồng bộ action audit và mã lỗi.
- `packages/contracts/src/`:
  - `organizer.ts`: bỏ khối DTO cũ (từ `SUPPORTED_PAYOUT_BANKS` tới `PayoutAccountOverview`), giữ `BLOCKED_BANK_BINS`. Thêm `ConnectTingeeRequest`, `SelectPayoutAccountRequest`, `TingeeCredentialSummary`, `PayoutAccountOption`, `PayoutAccountOptions`, `PayoutAccount`, `PayoutAccountOverview {credential, account, ipnUrl, tingeePortalUrl}`, `maskTingeeClientId`, `TINGEE_IPN_PATH`.
  - `errors.ts`: bỏ `PAYOUT_ACCOUNT_INVALID`, `PAYOUT_ACCOUNT_IN_USE`, `BANK_OTP_*`, `PayoutFieldErrorDetails`; thêm `TINGEE_CREDENTIAL_INVALID`, `PAYOUT_ACCOUNT_UNAVAILABLE`.
  - `reporting.ts`: bỏ `PAYOUT_ACCOUNT_LINKING`.
  - `pii.ts`: thêm `va_account_number`, `secret_token`, `client_id` vào nhóm khóa luôn che.
  - `test/payout-account.test.ts`: viết lại.
- `apps/api/test/tingee-fake/{server,main}.ts`:
  - API: `startTingeeFake({merchants: [{clientId, secretToken, accounts, behavior?: 'suspended' | 'forbidden' | 'error' | 'hang'}]})`.
  - Kiểm chữ ký bằng secret của merchant có `x-client-id` khớp. `get-va-paging` trả `{totalCount, items}`; body có `merchantId` → `400`.
  - `main.ts` in sẵn 2 merchant demo: một có tài khoản, một rỗng.
- `apps/api/test/{tingee/client.test.ts, organizer/payout-account.test.ts, reporting/notices.test.ts, organizer/isolation.test.ts}`: viết lại theo matrix. Thay `TINGEE_CLIENT` qua `test/identity/harness.ts:72`.
- Web:
  - `tai-khoan-nhan-tien/payout-account-manager.tsx`: viết lại. Theo mẫu form có kiểm soát + `safeParse` + `useMutation` của bản cũ; dùng `copyWithToast` (`lib/clipboard.ts`), `StatusBadge`, `EmptyState`.
  - `page.tsx`: sửa comment.
  - `lib/organizer/api.ts:37-48`: query và mutation mới.
  - `lib/reporting/status-notices.ts`: bỏ `PAYOUT_ACCOUNT_LINKING`; sửa theo `test/status-notices.test.ts`.
- e2e: `e2e/organizer-mock.ts:27` bỏ mã LINKING; viết lại `e2e/payout-account.spec.ts`; `e2e/status-banners.spec.ts` bỏ case LINKING.
- `.env.example`, `README.md:132`: biến Tingee mới, cách sinh khóa (`openssl rand -base64 32`), merchant demo của fake.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{organizer,errors,reporting,pii}.ts` + `test/payout-account.test.ts` -- DTO, mã lỗi, notice, khóa che log -- nền cho api và web.
- [x] `apps/api/src/platform/{crypto,config,audit,http}` + `test/{crypto/secret-box,config}.test.ts` -- khóa có phiên bản, env mới, action audit, HTTP status -- AD-9, AD-23.
- [x] `apps/api/src/modules/tingee/*`, `test/tingee-fake/*`, `test/tingee/client.test.ts` -- `listAccounts`, bảng mã, fake nhiều merchant -- AD-9.
- [x] `apps/api/src/modules/organizer/*`, migration `0008`, `reporting/notices.service.ts` + `test/organizer/payout-account.test.ts`, `test/reporting/notices.test.ts` -- lưu trữ, service, route, banner; test phủ cả matrix.
- [x] `apps/web/{app/(dashboard)/btc/[orgId]/tai-khoan-nhan-tien/*, lib/organizer/api.ts, lib/reporting/status-notices.ts, test/status-notices.test.ts}` -- trang ba trạng thái và banner.
- [x] `apps/web/e2e/{organizer-mock.ts, payout-account.spec.ts, status-banners.spec.ts}` -- matrix phía web, chạy trên cả hai project.
- [x] `.env.example`, `README.md` -- env mới, fake demo.

**Acceptance Criteria:**
- Given log api và mọi response trong test, then không có Secret Token, chữ ký hay số tài khoản gốc. Cột `secret_token_ciphertext` bắt đầu bằng `v<k>:` và giải mã ra đúng secret.
- Given credential đã lưu bằng khóa `v1`, when env thêm khóa `v2`, then credential cũ vẫn giải mã được và credential mới lưu bằng `v2`.
- Given BTC có tài khoản nhận tiền, when gọi `GET /v1/orgs/:orgId/notices`, then không còn `PAYOUT_ACCOUNT_NOT_LINKED`.
- Given body gửi `get-va-paging`, then không có `merchantId`, và `x-client-id` là Client ID của BTC.

## Implementation Notes

- 03/11/2026: đã dọn `0008` cũ trên `tickee` và `tickee_test` bằng lệnh trong Design Notes, sau khi Mason đồng ý. Đã nối thêm vào `.env` local `TINGEE_CREDENTIAL_KEYS=v1:<khóa ngẫu nhiên>`, không đọc hay in key Tingee sẵn có. Hai khóa `TINGEE_CLIENT_ID`/`TINGEE_SECRET_TOKEN` cũ vẫn nằm trong `.env`; Zod bỏ qua chúng.
- `post()`: mã Tingee đã biết (92/97/1133/1007/1034) vẫn thành lỗi miền dù Tingee trả kèm HTTP 4xx. Trước đây mọi HTTP khác 2xx đều thành 503; đổi để key sai không bị báo là "Tingee tạm lỗi".
- Thêm CHECK `tingee_credentials_secret_token_ciphertext_check` (bắt buộc tiền tố `v<k>:`) làm lưới an toàn: plaintext không thể vào cột này.
- Web:
  - Query danh sách đặt `retry: false`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false` và có `credential.id` trong key. Mỗi lần tải là một lời gọi Tingee, chỉ xảy ra khi Owner bấm.
  - Không hiện toast sau khi kết nối: ở 375px toast đè lên nút "Dùng tài khoản này".
- Sửa ngoài Code Map:
  - `apps/web/e2e/dashboard-shell.spec.ts`: mock và tiêu đề theo dạng overview mới.
  - Tingee fake ghi lại `signature` để test kiểm rò rỉ.
- Chưa thử với Tingee thật. Tên trường của `get-va-paging` và giá trị `transactionType: 'debit'` lấy theo tài liệu.

## Spec Change Log

## Review Triage Log

Pass 1 (03/11/2026, 3 lớp: blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|---|---|
| 1 | BH | Hai BTC kết nối cùng một key/VA Tingee. Portal chỉ có một "Đường dẫn IPN" cho mỗi merchant, nên IPN của BTC này đổ về URL của BTC kia | maybe-false (nếu đúng: medium) | Portal có một ô IPN cho Cổng thanh toán, nhưng chưa biết Tingee có cấu hình IPN theo shop/VA hay không. Hậu quả chỉ xảy ra ở Story 3.5 (định tuyến theo `ipnKey` → nhánh Tài khoản lệch), story này chưa xây. Cần Tingee xác nhận, rồi Mason chọn: chặn ở bước kết nối, hay định tuyến theo Đơn ở 3.5 | defer |
| 2 | BH | BTC thành "đã liên kết" trước khi cấu hình portal; Tickee không kiểm IPN | false | Đề xuất 03/11 (rủi ro 2) đã chấp nhận rõ: không kiểm được bằng API, có checklist, Đối soát bù 4.1 bắt Đơn mất IPN. AC 2.6 quy định banner mất ngay khi chọn tài khoản | reject |
| 3 | BH | Bước kết nối không kiểm key có quyền "Cổng thanh toán" | medium | `get-va-paging` chỉ cần quyền "Tài khoản & Định danh". Không có API kiểm quyền Cổng thanh toán mà không tạo link. Đề xuất đã đặt nút "Kiểm tra kết nối" ở Epic 3 | defer |
| 4 | BH | AES-GCM không gắn AAD; chép ciphertext sang dòng khác vẫn giải mã được | low | Phải có quyền ghi DB mới làm được. Muốn sửa phải đổi định dạng và API của `SecretBox` | reject |
| 5 | BH, EC | `SecretBoxError` thành lỗi 500 chung | low | Chỉ xảy ra khi vận hành bỏ khóa khỏi env hoặc DB hỏng. ErrorFilter vẫn log "Lỗi không bắt được". Owner vẫn bấm được "Dùng key khác" ở đầu danh sách. Sửa phải thêm nhánh bắt lỗi | reject |
| 6 | BH | Xoay khóa không có công cụ mã hóa lại dữ liệu cũ | low | MVP chưa xoay khóa; muốn sửa phải viết script mới | reject |
| 7 | BH | `.env.example` có sẵn một khóa AES dùng được | low | Cùng tiền lệ với `BETTER_AUTH_SECRET` (giá trị chỉ dùng ở local, có chú thích). Môi trường thật lấy env từ secret store (AD-36) | reject |
| 8 | BH | Ba route chưa giới hạn tốc độ | low | Chỉ Owner đã đăng nhập gọi được; ai có key cũng thử thẳng trên Tingee được. Thêm limiter là thêm một cơ chế mới | reject |
| 9 | BH, EC | Danh sách cắt ở 200 dòng | low | Design Notes đã quyết; BTC nhỏ không có hơn 200 VA; adapter log cảnh báo khi bị cắt. Phân trang là thêm vòng lặp | reject |
| 10 | BH, EC | Viết lại `0008` tại chỗ làm hỏng DB đã chạy bản cũ | false | `0008` cũ chưa merge, chưa deploy (đề xuất §1). DB local duy nhất đã dọn bằng lệnh ghi trong Design Notes; CI dựng DB mới mỗi lần | reject |
| 11 | BH | Trình duyệt hoặc password manager đề nghị lưu Secret Token thành mật khẩu Tickee | low | Form gồm ô text rồi ô `type=password` là dạng form đăng nhập; `autoComplete: 'off'` bị bỏ qua với ô mật khẩu. Sửa bằng thuộc tính | patch |
| 12 | BH | Danh sách tự gọi lại Tingee mỗi khi tab lấy lại focus | medium | `providers.tsx:42` đặt `staleTime` 30 giây và `refetchOnWindowFocus` để mặc định, nên quay lại tab sau 30 giây là một lời gọi `get-va-paging`. Tingee có mã 1001/1131 "thao tác quá nhanh". Trái với comment `retry: false` | patch |
| 13 | BH | Audit không ghi id credential cũ khi "Dùng key khác" | low | Dòng cũ có `retired_at` đúng thời điểm transaction nên vẫn dựng lại được. Sửa phải thêm action audit | reject |
| 14 | BH | Bảng mới thiếu CHECK ở DB | low | Dữ liệu đến từ adapter đã kiểm bằng Zod. Thêm CHECK là thêm ràng buộc mới | reject |
| 15 | BH | Hai tab cùng kết nối key → vi phạm unique index (23505) → lỗi 500 | false | `lockOrganization` (`FOR UPDATE`) xếp hàng hai transaction. Tab sau thấy credential của tab trước là hiện hành rồi retire nó, nên không vi phạm index được | reject |
| 16 | EC | Tingee trả `items: null` khi merchant chưa có tài khoản | maybe-false (nếu đúng: medium) | Tài liệu và OpenAPI của Tingee chỉ có ví dụ có phần tử; schema của `data` để trống. Cần gọi UAT bằng một merchant chưa liên kết tài khoản nào | defer |
| 17 | EC | `accountNumber` từ 4 ký tự trở xuống thì lưu nguyên số | false | Số tài khoản ngân hàng có ít nhất 6 chữ số; chuỗi từ 4 ký tự trở xuống không lộ gì hơn "4 số cuối" | reject |
| 18 | EC | "Tải lại" lỗi khi đã có danh sách trong cache thì lỗi bị nuốt | medium | `payout-account-manager.tsx:393` chỉ hiện lỗi khi `!options.data`. Ở `empty-state`, bấm "Tải lại" mà lỗi thì trang vẫn là `empty-state`, không báo gì | patch |
| 19 | EC | Danh sách không có tài khoản nào chọn được (chỉ VietinBank) thì không có "Tải lại" hay link portal | medium | `:434-447` chỉ render danh sách. Owner liên kết thêm ngân hàng trên Tingee xong phải tải lại cả trang | patch |
| 20 | EC | Cache danh sách không gắn với credential | low | Query key của danh sách không có `credential.id`. Tab khác đổi key thì danh sách cũ hiện dưới Client ID mới | patch |
| 21 | VG | Bước kiểm lại trong transaction của `connect` chưa có test | — | Gap đã kiểm sẵn: xóa dòng `:178` thì mọi test vẫn qua | patch |
| 22 | VG | Web xử lý `PAYOUT_ACCOUNT_ALREADY_LINKED` (tab thứ hai) chưa có e2e | — | Gap đã kiểm sẵn | patch |
| 23 | VG | Danh sách khi key bị thu hồi (422) hoặc Tingee lỗi (503) chưa có e2e | — | Gap đã kiểm sẵn | patch |
| 24 | VG | `payoutAccountSettings` với `TINGEE_BASE_URL` UAT chưa có test | — | Gap đã kiểm sẵn (ưu tiên thấp) | patch |

## Design Notes

- **`ipnKey` đặt ở `organizations.tingee_ipn_key`, không đặt ở `tingee_credentials`** (AD-10 ghi ở credential). Lý do: AD-7 quy định "mỗi BTC một chuỗi", và Story 2.13 yêu cầu chuỗi không đổi khi đổi key. Đặt ở credential thì phải chép chuỗi qua từng dòng và unique index phải là index một phần. Story 3.5 tìm BTC theo `ipnKey`, rồi thử credential hiện hành trước, các credential cũ sau.
- **Phiên bản khóa nằm trong tiền tố ciphertext** (`v2:<iv>.<tag>.<ct>`, base64url), không có cột riêng nên không lệch được. Muốn tìm dòng còn dùng khóa cũ thì lọc `NOT LIKE 'v2:%'`.
- **Kết nối:** gọi Tingee trước. Thành công thì mở một transaction: khóa dòng BTC, kiểm BTC chưa có tài khoản nhận tiền, đặt `retired_at` cho credential hiện hành (nếu có), chèn credential mới, sinh `ipnKey` nếu chưa có (`coalesce`), ghi audit.
- **Chọn tài khoản:** đọc credential hiện hành, giải mã, gọi `listAccounts`. Sau đó mở transaction: khóa dòng BTC, kiểm credential vẫn là bản vừa dùng (nếu đã đổi thì trả `PAYOUT_ACCOUNT_UNAVAILABLE`), chưa có tài khoản hiện hành; chèn tài khoản, ghi audit.
- **`get-va-paging`:** gọi một lần với `maxResultCount: 200`, không phân trang (một BTC nhiều tài khoản như vậy là bất thường). Lọc `active` và bỏ `debit` ở adapter, không lọc qua body: nếu bộ lọc phía Tingee có nghĩa khác tài liệu thì danh sách vẫn đúng.
- **Tài liệu Tingee (developers.tingee.vn, đọc 03/11/2026):**
  - Body nhận `filter`, `skipCount`, `maxResultCount` (tối đa 2000), `merchantId` (chỉ khi gọi bằng key Master Merchant), `bankBin`, `accountType`, `status`, `transactionType`. Không truyền chuỗi rỗng.
  - Mã 97 còn có nghĩa "request trùng chữ ký trong 12 phút", nhưng timestamp tính tới mili-giây nên coi như không xảy ra.
  - Key tạo trên portal phải được cấp quyền theo nhóm dịch vụ; key thiếu quyền trả 1133. Hướng dẫn trên trang nhắc chọn "Cổng thanh toán" và "Tài khoản & Định danh".
  - Portal: `baas.tingee.vn` (API Credentials ở `/api-credentials`). Tab cấu hình cổng thanh toán là "Cấu hình thanh toán (Payment Gateway)", gồm hai trường bắt buộc liên quan: "Đường dẫn IPN" và "Các Tài khoản cho phép thanh toán".
- **Dọn DB local đã chạy `0008` cũ** (cả `tickee` và `tickee_test`; chạy bằng user `postgres`, sau khi người dùng đồng ý):
  ```sh
  for db in tickee tickee_test; do docker compose exec -T postgres psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -c "BEGIN; DROP TABLE IF EXISTS payout_accounts; ALTER TABLE organizations DROP COLUMN IF EXISTS tingee_merchant_id; DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1793670333579; COMMIT;"; done
  ```
  `.env` local phải thêm `TINGEE_CREDENTIAL_KEYS=v1:$(openssl rand -base64 32)`; có thể xóa hai khóa `TINGEE_CLIENT_ID`/`TINGEE_SECRET_TOKEN` (Zod bỏ qua khóa thừa).

## Verification

**Commands:**
- `pnpm turbo build typecheck lint:deps test` -- expected: tất cả pass.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm --filter @tickee/web build && pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
- `grep -rn "TINGEE_CLIENT_ID\|TINGEE_SECRET_TOKEN\|confirm-va\|create-va\|merchant/create\|PAYOUT_ACCOUNT_LINKING" apps packages --include='*.ts' --include='*.tsx'` -- expected: không còn kết quả.
