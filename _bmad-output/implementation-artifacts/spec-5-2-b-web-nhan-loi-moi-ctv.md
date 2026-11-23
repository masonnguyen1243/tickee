---
title: 'Story 5.2-b: Web nhận lời mời CTV'
type: 'feature'
created: '2026-11-23'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a06a49b64aa4336a0af526dd98dd52581a5f47ac'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** API nhận lời mời CTV đã có (5.2-a), nhưng web chưa có trang `/loi-moi-ctv`. Mở link mời vẫn ra 404, Owner/Admin chưa có lối vào Màn quét. Ngoài ra, đăng nhập OTP bằng tài khoản khác trong cùng tab còn giữ cache memberships của tài khoản trước tới 30 giây (FR-26, FR-29, UX-DR27, UX-DR33).

**Approach:**
- Trang `/loi-moi-ctv` theo mẫu `/loi-moi-btc`, gọi preview/accept của 5.2-a.
- Trang tạm `/events/[eventId]` trong route group `(checkin)`, đọc `GET /v1/checkin/events/:eventId`.
- Nút "Mở Màn quét" ở tab Check-in.
- Đăng nhập OTP thành công thì làm mới toàn bộ cache.

**Quyết định (Mason, 23/11/2026):**
- Giữ một spec dù vượt mức token: sửa cache dính với trang mới, vì sau đăng nhập màn xem trước phải tải lại để nhận `scanEventId`.
- Đăng nhập xong quay về `/loi-moi-ctv` thì thấy lại màn xem trước và bấm "Nhận soát vé" lần nữa, như `/loi-moi-btc`. Không tự gọi accept.

## Boundaries & Constraints

**Always:**
- Token đọc từ `#` một lần sau hydrate, giữ trong `sessionStorage` của tab (khóa riêng, không dùng chung khóa của `/loi-moi-btc`). Giữ được thì bỏ `#` khỏi URL. Token không bao giờ vào URL request, query hay `returnTo`; `returnTo` luôn là `/loi-moi-ctv`. Token chỉ đi trong body `POST`.
- Trang `/loi-moi-ctv` có `robots` noindex và `referrer: 'no-referrer'`, như `/loi-moi-btc`.
- Màn xem trước chỉ có tên Sự kiện, tên BTC và nút "Nhận soát vé". Chưa đăng nhập thì nút sang `/dang-nhap?returnTo=%2Floi-moi-ctv`. Đã đăng nhập thì có thêm dòng "Bạn đang đăng nhập bằng {email}." và nút gọi accept.
- Đã đăng nhập mà chưa đồng ý NĐ 13 thì sang `/dong-y` với `returnTo=/loi-moi-ctv`, như `/loi-moi-btc`. `TOTP_REQUIRED` do `Providers` xử lý.
- Token bị xóa khỏi `sessionStorage` khi: accept thành công, preview trả `scanEventId`, link hỏng, hoặc `CHECKER_REVOKED`.
- Mọi điều hướng sang Màn quét dùng helper đường dẫn web mới trong contracts. Đường dẫn API mới cũng khai báo trong contracts.
- Trang `/events/[eventId]`: `401` thì sang đăng nhập với `returnTo` là chính trang đó. `403` (`NOT_A_MEMBER`, `CHECKER_REVOKED`) thì hiện câu của API, không có tên Sự kiện. `200` thì hiện tên Sự kiện và "Màn quét đang được hoàn thiện."
- "Mở Màn quét" là link tới Màn quét của Sự kiện đang xem, ở mọi trạng thái Sự kiện. Trạng thái nào được quét do 5.3/5.6 xử lý trên Màn quét.
- Đăng nhập OTP thành công: làm mới toàn bộ cache TanStack Query (dữ liệu cũ bị bỏ, query đang hiện tải lại), rồi mới điều hướng.

**Never:**
- Không làm Màn quét thật (camera, kết quả, số check-in) và không đổi "Quét vé" ở tab bar/sidebar. Thuộc 5.3.
- Không làm thu hồi/khôi phục CTV, màn hết quyền `EVENT_ENDED`. Thuộc 5.6.
- Không sửa API hay migration. Không thêm route liệt kê Sự kiện của CTV.
- Không đổi luồng đăng nhập Google: luồng này rời trang (điều hướng toàn trang) nên cache vốn mới.
- Không thêm test e2e-fullstack: e2e mock đủ cho vòng OTP, như `invitation.spec.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Xem trước, chưa đăng nhập | Preview `200`, `scanEventId: null`; `me` 401 | Tên Sự kiện, tên BTC, "Nhận soát vé" → đăng nhập, `returnTo=/loi-moi-ctv` | N/A |
| Nhận | Đã đăng nhập; bấm "Nhận soát vé"; accept `200 {eventId}` | Nút có spinner, chặn bấm lặp; chuyển `replace` tới Màn quét | N/A |
| Đã có quyền | Preview trả `scanEventId` (CTV `active`, Owner/Admin) | Chuyển thẳng tới Màn quét, không gọi accept | N/A |
| Link hỏng | Preview hoặc accept `404 CHECKER_INVITE_INVALID`; hoặc không có token | "Link mời đã hết hạn. Liên hệ BTC để nhận link mới.", không có tên Sự kiện | Không có token thì không gọi preview |
| Đã bị thu hồi | Accept `403 CHECKER_REVOKED` | "Bạn không còn quyền soát vé cho Sự kiện này." | N/A |
| Phiên hết giữa chừng | Accept `401` | Sang đăng nhập, `returnTo=/loi-moi-ctv`; token vẫn giữ | N/A |
| Lỗi tải | Preview lỗi mạng/5xx | Banner lỗi + "Thử lại" | N/A |
| Đổi tài khoản | Đang đăng nhập A (cache memberships của A), đăng nhập OTP bằng B trong cùng tab | Menu tài khoản không còn "Dashboard BTC" của A | N/A |

</frozen-after-approval>

## Code Map

**Mẫu cần chép**
- `apps/web/app/(public)/loi-moi-btc/{page,invitation-acceptance}.tsx`: trang nhận lời mời Admin.
  - `useInvitationToken` đọc `#` rồi `replaceState`; `Screen` và `Loading`.
  - Điều hướng consent, `LOGIN_TO_ACCEPT`, banner "Thử lại".
  - Không chép nhánh email lệch và "Đăng xuất": lời mời CTV không gắn email.
- `apps/web/lib/organizer/invitation-token.ts`: `tokenFromHash` và lưu/đọc/xóa token theo một khóa `sessionStorage` cố định. Có test ở `apps/web/test/invitation-token.test.ts`.
- `apps/web/app/(buyer)/buyer-gate.tsx`: mẫu 401 → `withReturnTo(LOGIN_PATH, here)`.

**Chỗ sửa**
- `apps/web/app/(public)/dang-nhap/login-form.tsx:149`: `verify.onSuccess` hiện chỉ `invalidateQueries(ME_QUERY_KEY)`. `staleTime` 30 giây ở `app/providers.tsx:43`. `AccountMenu` (`components/tickee/account-menu.tsx:41,91`) đọc `MEMBERSHIPS_QUERY_KEY` để dựng "Dashboard BTC".
- `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checkin-tab.tsx`: `CheckinTab` hiện chỉ có `CheckerInviteBlock`.
- `apps/web/app/(checkin)/layout.tsx`: layout rỗng chờ story của bề mặt này.
- `apps/web/lib/checkin/api.ts`: lớp API của `checkin`; dùng `apiRequest` từ `lib/api/client.ts`.
- `packages/contracts/src/checkin.ts`:
  - đã có `CHECKER_INVITE_PATH`, `CheckerInviteTokenRequest`, `CheckerInvitePreview`, `AcceptedCheckerInvite`, `CheckinEvent`;
  - thêm helper đường dẫn ở đây. Test ở `packages/contracts/test/checkin.test.ts`.

**API đã có (5.2-a, không sửa)**
- `POST /v1/checkin/invites/preview` (đăng nhập không bắt buộc) và `POST /v1/checkin/invites/accept`, ở `apps/api/src/flows/checker-invite.controller.ts`.
- `GET /v1/checkin/events/:eventId`, ở `apps/api/src/modules/checkin/checkin-event.controller.ts`.
- Câu lỗi do API trả: `CHECKER_INVITE_INVALID`, `CHECKER_REVOKED`, `NOT_A_MEMBER` ("Bạn không có quyền soát vé cho Sự kiện này.").

**Hạ tầng**
- `lib/api/message-of.ts`: `messageOf`.
- `lib/auth/return-to.ts`: `withReturnTo`.
- `components/tickee/{status-banner,empty-state,site-header}.tsx`.
- `handledElsewhere` coi `NOT_A_MEMBER` là việc của dashboard, nên không dùng nó ở `/events/[eventId]`.

**Test e2e**
- `apps/web/e2e/fixtures.ts`: luôn import `test`/`expect` từ đây.
- `apps/web/e2e/identity-mock.ts`: `mockIdentityApi`, `me()`, `unauthenticated()`, `apiError()`, handler OTP `POST /identity/otp`, `/identity/otp/verify`.
- `apps/web/e2e/organizer-mock.ts:167`: mẫu `mockOrganizerApi`. Chưa có mock nào cho `/v1/checkin/**`.
- `apps/web/e2e/invitation.spec.ts`:
  - mẫu vòng OTP: `:31`;
  - `recordUrls` (`:23`), kiểm `sessionStorage` (`:92`), consent (`:198`).
- `apps/web/e2e/checkin-invite.spec.ts:71`: `openApi`, trang tab Check-in `:20`.
- Hai project mobile 375px: `ios-webkit`, `android-chromium`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/checkin.ts` (+ `test/checkin.test.ts`) -- Thêm vào contracts:
  - `checkinScanPath(eventId)` → `/events/<id>` (encode);
  - `CHECKER_INVITE_PREVIEW_API_PATH`, `CHECKER_INVITE_ACCEPT_API_PATH`, `checkinEventApiPath(eventId)` (sau `/v1`).
- [x] `apps/web/lib/auth/hash-token.ts` (mới), `lib/organizer/invitation-token.ts`, `lib/checkin/invite-token.ts` (mới) (+ test) -- Gom phần lưu token theo `#`:
  - `tokenFromHash` và bộ lưu theo khóa vào file mới;
  - `invitation-token.ts` giữ nguyên tên export, dựng từ bộ chung;
  - `invite-token.ts` dùng khóa `tickee:loi-moi-ctv:token`.
- [x] `apps/web/lib/checkin/api.ts` -- `previewCheckerInvite`, `acceptCheckerInvite`, `fetchCheckinEvent`, kèm khóa query.
- [x] `apps/web/app/(public)/loi-moi-ctv/{page,checker-invite-acceptance}.tsx` (mới) -- Trang nhận lời mời theo Boundaries và Matrix.
- [x] `apps/web/app/(checkin)/{layout.tsx,events/[eventId]/page.tsx,events/[eventId]/checkin-event-screen.tsx}` -- Màn quét tạm:
  - layout một cột có `SiteHeader`, như `(buyer)/layout.tsx` (5.3 đổi thành toàn màn);
  - page noindex.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/su-kien/[eventId]/checkin-tab.tsx` -- Thẻ "Màn quét" đặt trước khối link mời: một câu mô tả và link-nút "Mở Màn quét".
- [x] `apps/web/app/(public)/dang-nhap/login-form.tsx` -- `verify.onSuccess`: `await queryClient.resetQueries()` thay cho invalidate `me`. Làm mục hoãn "Đăng nhập tài khoản khác trong cùng tab (không đăng xuất) chỉ invalidate `me`…".
- [x] `apps/web/e2e/checkin-mock.ts` (mới), `e2e/checker-invite-accept.spec.ts` (mới), `e2e/checkin-invite.spec.ts`, `e2e/login.spec.ts` -- e2e:
  - mỗi dòng Matrix; vòng OTP như `invitation.spec.ts:31`;
  - không request nào chứa token (`recordUrls`); `sessionStorage` bị xóa ở các nhánh Boundaries;
  - `/events/[eventId]`: `200`, `401` → đăng nhập, `403`;
  - href "Mở Màn quét";
  - đổi tài khoản OTP trong cùng tab (dòng cuối của Matrix).

**Acceptance Criteria:**
- Given hai mục hoãn giao cho 5.2-b, when story xong, then cả hai đều làm (Story 5.2 phần web; đăng nhập tài khoản khác trong cùng tab).
- Given `/loi-moi-btc`, when chạy `invitation.spec.ts` sau khi gom bộ lưu token, then vẫn pass.
- Given mọi màn mới ở 320px, when xem trên mobile, then không cuộn ngang và vùng chạm ≥ 24px.

## Implementation Notes

- Đã làm (23/11/2026): đủ 8 task.
  - Mới: `lib/auth/hash-token.ts` (`tokenFromHash`, `hashTokenStore(key)`), `lib/checkin/invite-token.ts`, `app/(public)/loi-moi-ctv/*`, `app/(checkin)/events/[eventId]/*`, `e2e/checkin-mock.ts`, `e2e/checker-invite-accept.spec.ts`, `test/hash-token.test.ts`.
  - contracts: `checkinScanPath`, `CHECKER_INVITE_PREVIEW_API_PATH`, `CHECKER_INVITE_ACCEPT_API_PATH`, `checkinEventApiPath`.
- Chữ trên màn:
  - xem trước: tiêu đề "Bạn được mời soát vé cho {tên Sự kiện}.", dòng "BTC: {tên BTC}";
  - link hỏng: tiêu đề "Link mời đã hết hạn." + "Liên hệ BTC để nhận link mới.", chữ cố định (nhánh thiếu token không gọi api);
  - `CHECKER_REVOKED` khi nhận: chỉ tiêu đề "Bạn không còn quyền soát vé cho Sự kiện này.".
- Lỗi `TOTP_REQUIRED`/`CONSENT_REQUIRED` của xem trước hay `me` không hiện banner lỗi: màn chờ `Providers` (dialog 2FA không đóng được, chỉ "Đăng xuất").
- `/events/[eventId]`: lỗi khác `401`/`NOT_A_MEMBER`/`CHECKER_REVOKED` (mạng, 5xx, `403` khác) hiện banner "Chưa tải được Màn quét" + "Thử lại".
- "Mở Màn quét" dùng biến thể `secondary`: một nút chính mỗi màn, nút chính của tab thuộc khối link mời.
- Kiểm (23/11/2026):
  - contracts: 348 pass; web Vitest: 419 pass; `pnpm typecheck`, `pnpm lint:deps`: không lỗi;
  - Playwright `checker-invite-accept`, `checkin-invite`, `invitation`, `login`: 116 pass ở cả hai project; ca mới chạy `--repeat-each=4`: 144 pass;
  - đã thử trả `login-form` về `invalidateQueries(me)`: hỏng 2 ca ở cả hai project (đổi tài khoản OTP; xem trước không tải lại sau đăng nhập);
  - toàn bộ e2e: 1170 pass, 8 fail. Chạy riêng: `totp` (4), `public-event-revalidate`, `event-image.spec.ts:346` (đã ghi chập chờn ở deferred-work) đều pass. `my-tickets.spec.ts:497` (nhả Wake Lock khi rời trang) fail cả trên baseline `a06a49b`, không liên quan story này.

## Spec Change Log

## Review Triage Log

Lượt 1 (23/11/2026). VG = Verification Gap, BH = Blind Hunter, EC = Edge Case Hunter.

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|
| VG1 | Accept gặp `TOTP_REQUIRED` → dialog 2FA → gửi lại → Màn quét chưa có e2e | medium | Lớp VG đã kiểm: không spec nào mock `TOTP_REQUIRED` cho `/checkin/invites/accept`. Chuyển xử lý kết quả sang `mutate(…, {onSuccess})` hay bỏ `handledByProviders` thì không test nào hỏng. Luồng Admin có ca này (`invitation.spec.ts:122`) | patch (P2) |
| VG2 | `/events/[eventId]` lỗi 5xx: banner "Chưa tải được Màn quét" + "Thử lại" chưa có test | medium | Lớp VG đã kiểm: khối `Màn quét tạm` chỉ có 200/401/403. Bỏ nhánh banner thì người quét thấy khung chờ mãi mà không test nào hỏng | patch (P3) |
| VG3 | Accept 5xx (banner "Chưa nhận được lời mời") và `me` 5xx (banner "Chưa tải được lời mời") chưa có test | medium | Lớp VG đã kiểm: accept chỉ được mock 200/404/403/401, `me` chỉ 200/401; chuỗi "Chưa nhận được lời mời" không có trong spec e2e nào | patch (P4) |
| VG4 | `resetQueries()` tải lại memberships bằng phiên B chưa đồng ý → `CONSENT_REQUIRED` → `Providers` chuyển trang, có thể đè `returnTo` | false | Đã chạy e2e tạm (B chưa đồng ý, memberships của B trả 403 `CONSENT_REQUIRED`), 6/6 lần trên cả hai project: memberships được gọi 2 lần nhưng URL cuối luôn là `/dong-y?returnTo=%2Fchinh-sach-du-lieu` (điều hướng của form đến sau và thắng) | reject |
| EC1 | Màn quét tạm: đã có `data`, lần tải lại nền trả 403 thì vẫn hiện tên Sự kiện | low | Đúng: `if (event.data)` đứng trước `noAccess(event.error)`; TanStack giữ `data` khi refetch lỗi (refetch khi focus sau 30 giây). Sửa là đổi thứ tự hai nhánh | patch (P1) |
| EC2 | `#` có mà không hợp lệ (rỗng sau trim, > 256 ký tự) thì rơi về token cũ trong `sessionStorage` | low | Đúng, nhưng link do hệ thống tạo luôn là 22 ký tự; cần token cũ còn trong tab và một `#` hỏng. `/loi-moi-btc` cũng vậy. Sửa phải thêm nhánh | reject |
| EC3 | Mở `/loi-moi-ctv#<token khác>` trong cùng tab (chỉ đổi `#`) không đọc token mới | low | Đúng: hook chỉ đọc khi mount. Link mở từ ứng dụng nhắn tin tải trang mới; chỉ gặp khi dán link vào đúng tab đang mở trang này. `/loi-moi-btc` cũng vậy. Sửa phải thêm listener `hashchange` | reject |
| EC4 | `sessionStorage` bị chặn: `#token` ở lại URL, `Providers` dựng `returnTo` từ URL có `#` (dialog 2FA "Đăng xuất", màn đồng ý) | low | Đúng, nhưng chỉ khi trình duyệt chặn toàn bộ dữ liệu trang. Spec cho giữ `#` khi không lưu được, giống `/loi-moi-btc` (2.4). Sửa phải đổi cách giữ token và thêm màn riêng | reject |
| EC5 | `sessionStorage` bị chặn: đăng nhập xong quay về thì báo "Link mời đã hết hạn." | low | Trùng gốc EC4 | reject (gộp EC4) |
| EC6 | `await resetQueries()` chờ mọi query đang hiện, kể cả thử lại 5xx, nên điều hướng sau OTP có thể chậm vài giây | low | Đúng chỉ khi đang đăng nhập sẵn tài khoản khác (memberships đang hiện) và memberships lỗi hay chậm. Luồng thường (chưa đăng nhập) memberships tắt nên chỉ chờ `me`, như trước | reject |
| EC7 | Đăng nhập lại cùng tài khoản (phiên hết hạn) cũng mất token link CTV trong bộ nhớ | low | Đúng; Design Notes đã chấp nhận. Sửa phải so id tài khoản trước/sau | reject |
| EC8 | "Thử lại" (`link` + `sm`, `h-auto`) cao ~19,6px, dưới 24px của AC 320px | low | Đúng về số đo. Đây là cách dùng chung của mọi `StatusBanner` trong app; nút đứng riêng nên vẫn đạt WCAG 2.5.8 theo ngoại lệ khoảng cách. Sửa riêng ở đây làm lệch với các banner khác | reject |
| BH1 | Người bị thu hồi vẫn thấy Màn quét | low | Trùng EC1 | patch (gộp P1) |
| BH2 | `sessionStorage` bị chặn: token lọt vào `returnTo`, luồng hỏng | low | Trùng EC4/EC5 | reject (gộp EC4) |
| BH3 | Đăng nhập chờ mọi query; memberships tải lại bằng phiên B gây đua điều hướng | low | Phần chờ trùng EC6; phần đua điều hướng trùng VG4 (false) | reject (gộp EC6, VG4) |
| BH4 | Thiếu e2e accept `TOTP_REQUIRED` | medium | Trùng VG1 | patch (gộp P2) |
| BH5 | Nhánh banner lỗi chưa có e2e; 320px chưa kiểm trạng thái lỗi | medium | Phần banner trùng VG2/VG3; phần 320px trùng EC8 | patch (gộp P3, P4) |
| BH6 | Nhánh đồng ý NĐ 13 chỉ kiểm tới `/dong-y`, chưa đi trọn: đồng ý → quay về → token còn → nhận | low | Đúng: `invitation.spec.ts:198` có vòng trọn, spec CTV dừng ở chuyển trang. Thêm test, không đổi code | patch (P5) |
| BH7 | `checkin-event-screen.tsx` khai báo `handledElsewhere` cục bộ trùng tên hàm chung ở `lib/api` nhưng khác nghĩa (bỏ `NOT_A_MEMBER`) | low | Đúng: ai import hàm chung vào file này sẽ đụng tên, và người đọc dễ hiểu sai. Sửa là đổi tên | patch (P6) |
| BH8 | Gom chưa hết: `useCheckerInviteToken`, `Screen`, `Loading` chép lại từ `/loi-moi-btc` | low | Đúng: sửa hook token phải sửa hai nơi. Gom thêm là thêm API dùng chung (hook client trong `lib`), quá phạm vi spec đã duyệt | reject |
| BH9 | Chọn token cũ/sai (`#` hỏng, đổi `#` trong cùng tab) | low | Trùng EC2/EC3 | reject (gộp EC2, EC3) |
| BH10 | Không kiểm `CHECKER_INVITE_TOKEN_PATTERN` trước khi gọi API | low | Đúng nhưng vô hại: API trả 404 cho token sai dạng và màn hiện "Link mời đã hết hạn."; chỉ tốn một request | reject |
| BH11 | Màn 403 và màn xem trước không có cách đổi tài khoản | false | `SiteHeader` có ở cả layout `(public)` lẫn `(checkin)`, menu tài khoản có "Đăng xuất" (`account-menu.tsx:118`) | reject |
| BH12 | Sau khi bấm "Nhận soát vé", màn thu hồi/link hỏng thay cả cây, focus rơi về `body` | low | Đúng; `/loi-moi-btc` và các màn nhận lời mời có sẵn cũng vậy. Sửa phải thêm quản lý focus | reject |
| BH13 | (a) hằng đường dẫn mới chen giữa khối comment về luật link và `CheckerInviteTokenRequest`; (b) test đổi tài khoản chỉ kiểm `AccountMenu`, chưa kiểm CTA landing; (c) mục hoãn ghi `clear()`, code dùng `resetQueries()` | (a) low, (b) low, (c) false | (a) Đúng: comment giờ đứng trên `checkinScanPath`. (b) CTA landing đọc cùng `MEMBERSHIPS_QUERY_KEY`, cùng cơ chế với `AccountMenu`. (c) Summary của mục hoãn chỉ gợi ý; mục được đóng bằng dòng "Đã xử lý" ở bước kết sổ, không sửa nội dung cũ | (a) patch (P7); (b), (c) reject |

## Design Notes

**Vì sao `resetQueries()`:**
- `clear()` (như đăng xuất) gỡ cả query đang hiện. `SiteHeader` không unmount khi `returnTo` cùng layout `(public)`, nên có thể không tải lại `me`.
- `resetQueries()` bỏ dữ liệu của mọi query, tải lại các query đang hiện (`me`, memberships) và trả promise để chờ trước khi điều hướng.
- Token link CTV vừa tạo của 5.1 (cache trong bộ nhớ) cũng mất. Đăng nhập lại thì tạo link mới, như sau khi đăng xuất.

**`(checkin)` layout:** khung một cột chỉ dùng cho trang tạm. Màn quét thật ở 5.3 là toàn màn, mobile-first.

## Verification

**Commands:**
- `pnpm --filter @tickee/contracts build && pnpm --filter @tickee/contracts test` -- expected: pass.
- `pnpm --filter @tickee/web test` -- expected: pass (Vitest, gồm dependency-cruiser).
- `sh scripts/dev-env.sh pnpm turbo build --filter=@tickee/web && pnpm --filter @tickee/web exec playwright test e2e/checker-invite-accept.spec.ts e2e/checkin-invite.spec.ts e2e/invitation.spec.ts e2e/login.spec.ts` -- expected: pass ở cả hai project.
- `pnpm typecheck && pnpm lint:deps` -- expected: không lỗi.
