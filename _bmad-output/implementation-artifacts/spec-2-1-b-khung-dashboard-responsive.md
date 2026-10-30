---
title: 'Story 2.1 (phần B): Khung dashboard responsive'
type: 'feature'
created: '2026-10-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '6d98f07d086ae9873d04e0632bd9e7c5c22d0a57'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-2-1-tao-btc-va-nen-tang-quyen.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dashboard hiện chỉ có header đơn giản. Người thuộc nhiều BTC không chuyển qua lại được, và chưa có điều hướng cấp BTC theo UX-DR34 cho các story sau gắn vào.

**Approach:**
- Dựng layout `app/(dashboard)/btc/[orgId]/layout.tsx` với khung responsive gồm `dashboard-sidebar`, BTC switcher và `bottom-tab-bar`.
- Danh sách mục điều hướng khai báo một chỗ. Mục chỉ dành cho Owner suy ra từ `roleHasPermission` của contracts.
- Mục chưa có trang thì dẫn tới trang tạm "Sắp có".

## Boundaries & Constraints

**Always:**
- Thứ tự mục và URL:
  - **Sự kiện** `/btc/{id}`
  - **Cần xử lý** `/btc/{id}/can-xu-ly`
  - **Token** `/btc/{id}/token`
  - **Thành viên** `/btc/{id}/thanh-vien` (cần `members.manage`)
  - **Tài khoản nhận tiền** `/btc/{id}/tai-khoan-nhan-tien` (cần `payout_account.manage`)
  - **Cài đặt** `/btc/{id}/cai-dat`
  - Riêng tab bar có thêm **Quét vé** `/btc/{id}/quet-ve`.
- Admin bị **ẩn** (không render) các mục Thành viên và Tài khoản nhận tiền.
- Admin mở thẳng URL của hai mục đó thì thấy `empty-state` "Chỉ Owner xem được mục này." kèm nút "Về danh sách Sự kiện".
- **Mason chốt 30/10/2026:** hiện đủ mục theo UX. Mọi mục chưa có trang (kể cả nút "Tạo Sự kiện" → `/btc/{id}/su-kien/tao`) dẫn tới trang tạm có `empty-state` "Sắp có" và câu ngắn nêu mục sẽ làm gì. Story sau thay trang tạm bằng trang thật.
- Danh sách Sự kiện trống hiện `empty-state` "Chưa có Sự kiện nào." kèm nút "Tạo Sự kiện".
- **Từ `lg` (≥ 1024px):** sidebar `w-sidebar-width`, nền `stage`.
  - BTC switcher ở đầu: avatar chữ cái đầu, tên BTC, vai trò và chevron, mở `DropdownMenu`.
  - Mục đang chọn: chữ `stage-foreground` đậm, thanh coral 3px bên trái, icon màu `brand`. Mục thường dùng `stage-muted`, hover nền `stage-line`.
- **`md`–`lg`:** sidebar chỉ còn icon. Mỗi mục có `aria-label` và tooltip là tên mục. Switcher chỉ còn avatar.
- **Dưới `md`:** `bottom-tab-bar` cố định ở đáy, nền `bar`, cao `h-tab-bar-height` cộng `env(safe-area-inset-bottom)`.
  - Các mục: Sự kiện · Cần xử lý · Quét vé · Thêm.
  - Mục đang chọn màu `brand` và có vạch coral 2px ở trên.
  - "Thêm" mở `Sheet` gồm Token, Thành viên, Tài khoản nhận tiền, Cài đặt và BTC switcher (cũng ẩn mục chỉ dành cho Owner).
  - Nội dung trang chừa đủ chỗ để không bị tab bar che.
- **BTC switcher:**
  - Liệt kê memberships (tên và vai), đánh dấu BTC hiện tại.
  - Chọn một BTC khác thì về `/btc/{id}` của BTC đó. Cuối danh sách có "Tạo BTC mới" → `/tao-btc`.
- Vai trò lấy từ `GET /v1/orgs/:orgId`. Gặp `NOT_A_MEMBER` thì giữ màn hiện có, không render nav. Gặp 401 thì về đăng nhập kèm `returnTo`.
- Dùng được bằng bàn phím: Tab đi qua các mục, Enter mở, Esc đóng Sheet và menu. Ở 320px không cuộn ngang.

**Never:**
- Không làm badge đếm Cần xử lý (chưa có dữ liệu, Epic 4).
- Không làm Dialog "Bạn không còn là thành viên…" (Story 2.4).
- Không làm `event-card` hay tabs cấp Sự kiện (Story 2.7).
- Không đổi `viewportFit`.
- Không sửa api.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Desktop Owner | 1280px, role owner | Sidebar đủ 6 mục, không có tab bar | N/A |
| Desktop Admin | 1280px, role admin | Ẩn Thành viên và Tài khoản nhận tiền | N/A |
| Tablet | 900px | Sidebar chỉ icon, mỗi mục có tên truy cập | N/A |
| Mobile | 375px | Tab bar 4 mục; "Thêm" mở Sheet có các mục còn lại và switcher | Esc đóng Sheet |
| Đổi BTC | Chọn BTC B trong switcher | URL `/btc/{B}`, tên B ở switcher | N/A |
| Tạo BTC mới | Bấm mục cuối switcher | Về `/tao-btc` | N/A |
| Admin mở URL chỉ Owner | `/btc/{id}/thanh-vien`, role admin | `empty-state` "Chỉ Owner xem được mục này." + "Về danh sách Sự kiện" | N/A |
| Mục chưa có trang | `/btc/{id}/token` | Trang tạm "Sắp có" trong khung | N/A |
| Không phải thành viên | org trả `NOT_A_MEMBER` | `empty-state` hiện có, không có nav | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/app/(dashboard)/layout.tsx`: hiện là header đơn giản (giống `(public)/layout.tsx`). Chuyển header này sang layout riêng của `/tao-btc` (`app/(dashboard)/tao-btc/layout.tsx`), còn layout nhóm chỉ còn passthrough.
- `apps/web/app/(dashboard)/btc/[orgId]/{page,organization-home}.tsx`: dùng lại `fetchOrganization`, cách xử lý 401 và `NOT_A_MEMBER`. Phần dữ liệu và trạng thái chuyển lên layout/shell. `page.tsx` chỉ còn tiêu đề và danh sách Sự kiện trống.
- `apps/web/lib/organizer/api.ts`: dùng `fetchMemberships`/`MEMBERSHIPS_QUERY_KEY`, `fetchOrganization`/`organizationQueryKey`.
- `packages/contracts/src/organizer.ts`: `organizationDashboardPath`, `CREATE_ORGANIZATION_PATH`, `Permission`, `roleHasPermission`. Thêm helper đường dẫn các mục (vd. `organizationSectionPath(id, section)`) nếu web và test cần dùng chung.
- `apps/web/components/ui/dropdown-menu.tsx`: dùng cho switcher. Sheet và Tooltip chưa có: tạo `components/ui/{sheet,tooltip}.tsx` theo mẫu shadcn trên `radix-ui` 1.8.1 (đã cài).
- `apps/web/components/tickee/{empty-state,account-menu,wordmark}.tsx`: dùng lại `EmptyState({icon,title,description,action})`. Đặt `AccountMenu` ở đầu vùng nội dung.
- `apps/web/app/globals.css`: đã có token `--color-stage*`, `--color-bar`, `--spacing-sidebar-width` (256px), `--spacing-tab-bar-height` (64px). Breakpoint dùng mặc định của Tailwind (md 768, lg 1024). Chưa có tiện ích safe-area: dùng `pb-[env(safe-area-inset-bottom)]`.
- `apps/web/e2e/{organizer-mock,identity-mock}.ts`: `mockOrganizerApi` (`ORG_ID`, `OTHER_ORG_ID`, `organization(overrides)`), `me()`. Project Playwright chỉ có mobile 375px; test desktop và tablet dùng `page.setViewportSize`.
- `apps/web/e2e/create-organization.spec.ts`: các test trang đích `/btc/[orgId]` phải giữ pass (tên BTC, `empty-state`, `NOT_A_MEMBER`, 401).

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/components/ui/{sheet,tooltip}.tsx` -- primitive shadcn trên `radix-ui`, kèm mục trong `ui-kit` -- cho Sheet "Thêm" và tooltip ở sidebar dạng icon.
- [x] `apps/web/lib/organizer/nav.ts` + `packages/contracts` (helper đường dẫn) -- khai báo mục (key, nhãn, icon lucide, đường dẫn, quyền cần có, vị trí sidebar/tab/sheet) và hàm `visibleSections(role)` -- một nguồn duy nhất cho sidebar, tab bar và Sheet.
- [x] `apps/web/components/tickee/{dashboard-shell,dashboard-sidebar,bottom-tab-bar,organization-switcher}.tsx` -- khung theo Always. Mục đang chọn xác định theo pathname. `aria-current="page"`.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/layout.tsx` -- tải org (role) và memberships, xử lý 401 và `NOT_A_MEMBER`, bọc `children` bằng shell.
- [x] `apps/web/app/(dashboard)/btc/[orgId]/{page,su-kien/tao/page,can-xu-ly/page,token/page,thanh-vien/page,tai-khoan-nhan-tien/page,cai-dat/page,quet-ve/page}.tsx` + `components/tickee/{coming-soon,owner-only}.tsx` -- trang Sự kiện có nút "Tạo Sự kiện". Mỗi trang tạm có tiêu đề "Sắp có". Hai mục chỉ dành cho Owner bọc trong guard theo quyền.
- [x] `apps/web/app/(dashboard)/{layout,tao-btc/layout}.tsx` -- tách header cũ cho `/tao-btc`.
- [x] `apps/web/e2e/dashboard-shell.spec.ts` -- phủ mọi dòng của matrix, thêm 320px không cuộn ngang. Test mục đang chọn có `aria-current`. Chạy trên cả hai project.

**Acceptance Criteria:**
- Given `pnpm turbo build typecheck lint:deps test` và Playwright, then tất cả pass, kể cả `create-organization.spec.ts` hiện có.
- Given ở 375px trên trang Sự kiện có nội dung dài, when cuộn xuống cuối, then phần cuối nội dung không bị tab bar che.

## Implementation Notes

- Mỗi mục trong `lib/organizer/nav.ts` mang một quyền của FR-4: Sự kiện `events.manage`, Cần xử lý `review_queue.handle`, Token `token.view`, Thành viên `members.manage`, Tài khoản nhận tiền `payout_account.manage`, Cài đặt `org.read`, Quét vé `checkin.scan`. Mục hiện khi `roleHasPermission(role, permission)`; `isOwnerOnly` suy ra từ quyền của Admin.
- `packages/contracts`: `OrganizationSection`, `ORGANIZATION_SECTION_SEGMENTS`, `organizationSectionPath(id, section)` (gồm `create-event` → `su-kien/tao`). Mục đang chọn: `/btc/{id}` và mọi trang dưới `su-kien/` thuộc "Sự kiện".
- `DashboardShell` chỉ render trang con sau khi tải xong BTC và đưa BTC qua `CurrentOrganizationProvider`; trang con không tự xử lý tải/lỗi. 401 về đăng nhập với `returnTo` là pathname hiện tại. Lỗi tải lại nền khi đã có dữ liệu thì giữ khung; `NOT_A_MEMBER` luôn bỏ điều hướng.
- Switcher lấy tên/vai BTC hiện tại từ `GET /v1/orgs/:orgId`; nếu memberships (cache cũ) thiếu BTC hiện tại thì thêm vào đầu danh sách.
- Trang Sự kiện giữ `h1` là tên BTC (test hiện có của `create-organization.spec.ts`); trang tạm và trang chặn Admin có eyebrow tên BTC + `h1` tên mục.
- `md`–`lg`: tooltip chỉ hiện ở dải này (`lg:hidden`), nhãn chữ ẩn, link có `aria-label`.
- E2E: WebKit (Safari) mặc định không Tab tới link, test bàn phím dùng `Alt+Tab` trên webkit.
- Kiểm tra (30/10/2026):
  - `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm turbo build typecheck lint:deps test --force`: 11/11 task pass (contracts 76, web 43, api 153 test).
  - `CI=1 pnpm --filter @tickee/web test:e2e`: 153 pass + 1 flaky (`login.spec.ts` "Không đồng ý", lỗi lẻ có từ trước). `dashboard-shell.spec.ts` + `create-organization.spec.ts` chạy `--repeat-each=3 --retries=0`: 186/186 pass.

## Spec Change Log

## Review Triage Log

Vòng 1 (30/10/2026). Reviewer: Blind Hunter (B), Edge Case Hunter (E), Verification Gap (V).

| # | Phát hiện | Verdict | Bằng chứng | Hướng xử lý |
|---|-----------|---------|-----------|-------|
| V1/B11 | Nhánh lỗi tải BTC của shell (5xx + "Thử lại", giữ khung khi tải lại nền lỗi) chưa có test | medium | Đã kiểm chứng sẵn (V): không mock nào trả 5xx | patch (test) |
| V2/B11 | Switcher ghép memberships với BTC hiện tại chưa có test | medium | Đã kiểm chứng sẵn (V): mock memberships luôn khớp mock org | patch (test) |
| V3 | Header chuyển chỗ (menu tài khoản, link trang chủ) chưa được kiểm trên `/btc/*` và `/tao-btc` | medium | Đã kiểm chứng sẵn (V) | patch (test) |
| V4 | Đóng Sheet bằng nút "Đóng" hoặc chạm nền mờ chưa có test | medium | Đã kiểm chứng sẵn (V): chỉ đóng bằng Esc hoặc khi điều hướng | patch (test) |
| V-o | `isOwnerOnly` không có code production nào dùng | low | Đúng: chỉ test dùng; lọc thật qua `visibleSections` | reject |
| B1 | 4 file shell dùng nháy kép và cột 80, lệch phần còn lại của web | low | Đúng: `dashboard-sidebar.tsx` và các file khác dùng nháy kép | patch (định dạng lại). Thêm config Prettier và bước kiểm thì defer |
| B2 | Guard chỉ dành cho Owner bọc tay ở từng trang thay vì ở shell | low | Đúng như task spec. Api vẫn chặn ở guard quyền; story sau theo cùng mẫu | reject |
| B3 | Tooltip làm trình đọc màn hình đọc tên mục hai lần; tooltip ở `lg` chỉ ẩn bằng CSS | low | Radix chỉ gắn `aria-describedby` khi tooltip mở; ảnh hưởng nhỏ, sửa phải điều khiển `open` theo media query | reject |
| B4/E5 | Tab "Thêm" trông như đang chọn nhưng thiếu `aria-current` | low | Đúng: `tabClass(activeInMore)` chỉ đổi style | patch |
| B5/E2 | Sheet "Thêm" vẫn mở khi đổi route bằng nút back | low | Đúng: `moreOpen` chỉ đóng khi bấm bên trong | patch |
| E3 | Sheet vẫn mở khi xoay thiết bị qua mốc `md` | low | Hiếm; sửa phải thêm listener media query | reject |
| B6/E6 | Lỗi memberships trong switcher không có "Thử lại"; 401 của memberships không chuyển sang đăng nhập | low | Chỉ xảy ra khi org vừa tải được mà memberships lỗi; hiếm | reject |
| B7 | Toast che tab bar trên mobile | low | Dashboard chưa có toast (Story 2.10 mới thêm) | reject |
| B8 | Đổi BTC làm cả khung điều hướng unmount (skeleton, mất focus, tab bar nháy) | medium | Đúng: query key mới chưa có cache nên rơi vào nhánh loading | defer |
| B9 | Header wordmark + menu tài khoản bị chép ba nơi | low | Đúng: `(public)/layout`, `tao-btc/layout`, `ContentHeader` | patch |
| B10 | `w-16`, `max-w-5xl`, `md:px-8` viết cứng thay vì token | low | DESIGN.md chưa có token cho các giá trị này (`[ASSUMPTION]`) | reject |
| B12 | Switcher báo "đang chọn" hai lần; chọn BTC hiện tại từ trang con lại về trang Sự kiện | low | Ảnh hưởng nhỏ | reject |
| B13/E1 | `returnTo` khi 401 mất query string và hash | low | Đúng: chỉ dùng `pathname` | patch |
| B14/E8 | Avatar lấy ký tự đầu, có thể ra dấu câu hoặc nửa emoji | low | Hiếm với tên BTC | reject |
| B15 | Padding safe-area bằng 0 vì không có `viewportFit: 'cover'` | medium | Đúng; spec cấm đổi `viewportFit` | defer |
| B16 | "Dashboard BTC" trong menu tài khoản luôn mở BTC đầu tiên, kể cả khi đang ở BTC khác | low | Đã có switcher trong khung | reject |
| B17 | Sidebar bọc trong `<aside>` (landmark complementary) | low | Đúng | patch |
| E4 | Không mục sidebar nào được chọn khi ở `/quet-ve` (≥ md) hoặc ở trang chặn Admin | low | Quét vé chỉ có ở tab bar theo UX | reject |
| E7 | `orgId` viết hoa trong URL làm cache key đổi | low | Link trong app luôn dùng id chữ thường | reject |

## Design Notes

Một nguồn duy nhất cho các mục: `ownerOnly` không viết tay mà suy ra từ `!roleHasPermission('admin', perm)`. Nhờ vậy, khi ma trận FR-4 trong contracts đổi, nav đổi theo. Ví dụ:

```ts
{ key: 'members', label: 'Thành viên', icon: Users, path: 'thanh-vien', permission: Permission.MEMBERS_MANAGE, placement: 'sidebar|sheet' }
```

Role lấy từ `GET /v1/orgs/:orgId` (guard api là nguồn sự thật), không lấy từ memberships, để không lệch khi vai bị đổi.

## Verification

**Commands:**
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 pnpm turbo build typecheck lint:deps test --force` -- expected: pass.
- `CI=1 pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium` (hai test "Không đồng ý" của `login.spec.ts` vốn lỗi lẻ từ trước).
