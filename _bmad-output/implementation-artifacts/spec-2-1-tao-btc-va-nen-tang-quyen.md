---
title: 'Story 2.1 (phần A): Tạo BTC và nền tảng quyền'
type: 'feature'
created: '2026-10-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '23870ee93ec6039462ceaf15b1305d81a31f2e77'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Người dùng đã đăng nhập chưa tạo được BTC. Api cũng chưa có guard quyền, `orgScope`, audit và bộ test cách ly mà mọi route BTC của các story sau dựa vào.

**Approach:**
- Phía api: module `organizer` sở hữu `organizations` và `members`, và cài cổng `AccessResolver`. `platform/access` khai báo cổng, `@RequirePermission` và guard. `platform/audit` sở hữu `audit_events`, chỉ cho INSERT.
- Phía web: thêm màn `/tao-btc` và một trang đích dashboard tối thiểu `/btc/[orgId]`.
- Phần B của Story 2.1 (sidebar, bottom-tab-bar, BTC switcher) đã tách sang `deferred-work.md`.

## Boundaries & Constraints

**Always:**
- Tạo `organizations` và `members(role='owner')` cùng `audit.record` trong một transaction. Unique index một phần `members(organization_id) WHERE role='owner'`, và unique `(organization_id, user_id)`.
- Enum `Permission` và ma trận FR-4 (owner/admin) khai báo một lần trong `packages/contracts`.
- Guard dựng `ctx = { userId, organizationId, role, assignedEventIds: [], stepUpAt: null }`. Người không phải thành viên → 403 `NOT_A_MEMBER`, kể cả khi `orgId` không tồn tại hoặc không phải uuid, để không lộ BTC nào có thật. Sai vai → 403 `FORBIDDEN_ROLE`.
- Audit ghi actor, `organization_id`, action (`organization.created`), đối tượng và tên trường đổi, không ghi giá trị. Role `tickee_app` không có UPDATE/DELETE trên `audit_events`, và quyền này vẫn bị chặn sau mỗi lần chạy migrate.
- Mọi bảng có cột `organization_id` đều NOT NULL, trừ `audit_events`.
- **Kênh liên hệ BTC** (Mason chốt 29/10/2026): gồm hai ô tùy chọn, `contactPhone` và `contactEmail`.
  - SĐT: bỏ khoảng trắng rồi khớp `^(0|\+84)\d{9}$`. Email: dùng `z.email()`.
  - Hai cột `contact_phone` và `contact_email` khai báo trong `PII_COLUMNS.organizer` để log tự che. Không cột nào ra audit.
  - Trả về trong `GET /v1/orgs/:orgId`, nhưng không có trong memberships.
- Bộ test cách ly tự tìm mọi route có `@RequirePermission`. Bộ test cũng fail khi có route dưới `/v1/orgs/:orgId` mà thiếu decorator.

**Never:**
- Không dùng plugin organization của Better Auth.
- Không cho `platform` import module.
- Không làm sidebar, switcher, bottom-tab-bar hay banner Closed Beta (thuộc phần B và Story 2.5).
- Không làm TOTP/step-up (Story 2.2).
- Không đổi `DEFAULT_RETURN_TO`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tạo BTC | `POST /v1/orgs {name}` đã đăng nhập và đồng ý | 201 `{id, name, role:'owner'}`; có 1 dòng audit | N/A |
| Đã thuộc BTC khác | User là Admin/Owner ở BTC X | Vẫn tạo được, thành Owner BTC mới | N/A |
| Tên không hợp lệ | rỗng/toàn khoảng trắng hoặc > 100 ký tự sau trim | 400 `VALIDATION_FAILED`, không ghi DB | Web lỗi tại ô, giữ dữ liệu |
| Liên hệ sai định dạng | `contactPhone: "123"` hoặc email hỏng | 400 `VALIDATION_FAILED`; bỏ trống cả hai vẫn hợp lệ | Web lỗi tại ô |
| Chưa đăng nhập | không cookie | 401 `UNAUTHENTICATED` | Web về `/dang-nhap?returnTo=/tao-btc` |
| Memberships | `GET /v1/me/memberships` | `[{organizationId, name, role}]` theo `created_at` tăng | N/A |
| Không phải thành viên | `GET /v1/orgs/:orgB` bởi thành viên BTC A | 403 `NOT_A_MEMBER` | Web `empty-state` "Bạn không có quyền xem BTC này." |
| Sai vai | Admin gọi route cần quyền chỉ Owner | 403 `FORBIDDEN_ROLE` | N/A |
| Lỗi mạng khi tạo | api 5xx | Lỗi tại chỗ + "Thử lại", giữ tên đã nhập | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/api.module.ts` L19-24 -- thêm `OrganizerModule.forRoot(config)` sau `IdentityModule`.
- `apps/api/src/modules/identity/session.guard.ts` L13-53 -- `SessionGuard` gán `req.session`/`req.user`. `RequestWithSession` chưa export qua `identity/index.ts` (AD-10). Guard quyền ở `platform` tự khai báo kiểu request tối thiểu `{ user?: { id: string } }`. Thứ tự `APP_GUARD`: Session → Consent → Permission (đăng ký trong `OrganizerModule`, sau `IdentityModule`).
- `apps/api/src/modules/identity/consent.guard.ts` -- mẫu đọc metadata bằng `Reflector`. `identity.controller.ts` L99-103 -- mẫu `@Req()`.
- `apps/api/src/platform/http/{app-error,error.filter,parse-request}.ts` -- thêm `NOT_A_MEMBER` và `FORBIDDEN_ROLE` (403) vào `DEFAULT_STATUS` và `MESSAGES`. Dùng `parseRequest` cho body.
- `packages/contracts/src/pii.ts` -- thêm `organizer: ['contact_phone', 'contact_email']`.
- `packages/contracts/src/errors.ts` -- thêm mã lỗi. Thêm file mới `organizer.ts` (Zod `CreateOrganizationRequest`, `Organization`, `Membership`, enum `Role`, `Permission`, `ROLE_PERMISSIONS`), re-export trong `index.ts`.
- `apps/api/src/platform/db/{columns,database,grants}.ts` -- helper `id()`, `timestamptz()`, `createdAt()`; `Database.transaction` / `Tx`. `grantAppRole` L15-20 GRANT UPDATE/DELETE cho mọi bảng ở mỗi lần migrate, nên REVOKE trên `audit_events` phải chạy **sau** đó ngay trong `grantAppRole`.
- `apps/api/src/roles/migrate.ts`, `test/global-setup.ts` -- cùng gọi `runMigrations`. Test kết nối bằng `tickee_app`.
- `apps/api/drizzle/` -- migration sinh bằng `pnpm --filter @tickee/api db:generate`, migration mới nhất hiện là `0003`.
- `apps/api/.dependency-cruiser.cjs`, `module-graph.cjs` -- quy tắc `platform-not-to-domain`, `outside-public-api-only`. `organizer` chỉ được phụ thuộc `identity` và `tingee`.
- `apps/api/test/identity/harness.ts` L59-83 -- `createHarness`, `sessionCookie()`, `newEmail()`. Mở rộng để nhận thêm controller test.
- `apps/web/app/(dashboard)/layout.tsx` -- passthrough rỗng. `app/(public)/dang-nhap/login-form.tsx` -- mẫu `useMutation` + `StatusBanner` + `router.replace`. `app/providers.tsx` -- tự chuyển khi gặp `CONSENT_REQUIRED`.
- `apps/web/lib/api/client.ts` (`apiRequest`), `lib/auth/api.ts` (`fetchMe`, `hasErrorCode`), `lib/auth/return-to.ts` (`withReturnTo`). Dùng lại `components/tickee/{empty-state,status-banner}.tsx`, `components/ui/{button,input,label}.tsx`.
- `apps/web/components/tickee/account-menu.tsx` L30 -- thêm lối vào dashboard.
- `apps/web/e2e/identity-mock.ts` -- `mockIdentityApi` chỉ chặn `/v1/identity/**`. Thêm mock cho `/v1/orgs/**` và `/v1/me/memberships`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/{errors,organizer,index}.ts` + test -- mã lỗi, schema, `Permission` theo FR-4: `org.read`, `members.manage`, `payout_account.manage`, `token.view`, `token.purchase`, `events.manage`, `orders.view`, `review_queue.handle`, `checkers.manage`, `checkin.scan`, `checkin.lookup`. `ROLE_PERMISSIONS` cho owner/admin; test khẳng định Admin thiếu đúng `members.manage`, `payout_account.manage`, `token.purchase`.
- [x] `apps/api/src/platform/access/{access-resolver,require-permission,permission.guard,org-scope,index}.ts` -- token DI `ACCESS_RESOLVER`, interface `resolve(userId, orgId) → {role} | null`, decorator đặt metadata, guard dựng `req.accessContext`, `orgScope(ctx)(table)` trả điều kiện `eq(organizationId)`.
- [x] `apps/api/src/platform/audit/{schema,audit,index}.ts` + `platform/db/grants.ts` -- bảng `audit_events`, `audit.record(tx, {...})`, và REVOKE UPDATE/DELETE trong `grantAppRole`.
- [x] `apps/api/src/modules/organizer/{schema,organizer.module,organizer.service,organizations.controller,memberships.controller,access-resolver.impl,index}.ts` -- bảng, `POST /v1/orgs`, `GET /v1/orgs/:orgId` (`org.read`), `GET /v1/me/memberships`. Cài cổng và đăng ký `APP_GUARD`.
- [x] `apps/api/drizzle/0004_*.sql` -- migration sinh ra cùng các index.
- [x] `apps/api/test/organizer/{create-organization,permission-guard,isolation}.test.ts` -- phủ các dòng của matrix. Guard dùng controller test có quyền chỉ Owner. Thêm test schema: mọi bảng có `organization_id` đều NOT NULL. Bộ cách ly dùng `DiscoveryService` duyệt route và gọi chéo hai BTC. Thêm test chứng minh `tickee_app` UPDATE/DELETE `audit_events` thất bại sau khi chạy lại migrate.
- [x] `apps/web/app/(dashboard)/tao-btc/{page,create-organization-form}.tsx`, `app/(dashboard)/btc/[orgId]/page.tsx`, `lib/organizer/api.ts` -- form tạo, rồi `replace` sang `/btc/{id}`. Trang đích có tên BTC và `empty-state` "Chưa có Sự kiện nào." Gặp 401 thì về đăng nhập kèm `returnTo`.
- [x] `apps/web/components/tickee/account-menu.tsx` -- mục "Dashboard BTC" (BTC đầu tiên) hoặc "Tạo BTC" (khi chưa có BTC).
- [x] `apps/web/e2e/{organizer-mock,create-organization.spec}.ts` -- tạo thành công, lỗi tên, Thử lại giữ dữ liệu, `NOT_A_MEMBER`, 320px không cuộn ngang, chạy trên cả hai project.

**Acceptance Criteria:**
- Given hai request đồng thời tạo Owner thứ hai cho cùng một BTC (chèn trực tiếp), then unique index từ chối.
- Given log api trong luồng tạo BTC, then không có tên BTC hay giá trị trường nào trong audit.
- Given `pnpm turbo build typecheck lint:deps test` và Playwright, then tất cả pass.

## Implementation Notes

- `app/(dashboard)/layout.tsx` có header giống layout công khai (wordmark + menu tài khoản) để trang dùng được. Không có sidebar, switcher hay bottom-tab-bar (phần B).
- Audit `organization.created` chỉ ghi `changed_fields = ['name']`. Cột liên hệ không bao giờ vào audit.
- `audit_events` không có khóa ngoại, vì `platform` không phụ thuộc bảng của mô-đun. `grantAppRole` thu UPDATE/DELETE/TRUNCATE qua `APPEND_ONLY_TABLES` sau mỗi lần GRANT. Migration 0004 cũng REVOKE thêm một lần để phòng hờ.
- `PermissionGuard` ném lỗi cấu hình (500) nếu route vừa `@Public()` vừa `@RequirePermission`. Thêm `@Access()` để lấy `AccessContext` trong handler. `orgId` được hạ chữ thường trước khi tra.
- Không làm banner "Chờ duyệt Closed Beta" (Story 2.5 / phần B).
- Kiểm tra (30/10/2026):
  - `pnpm turbo build typecheck lint:deps test --force`: 11/11 task pass (contracts 70, web 24, api 152 test).
  - `e2e/create-organization.spec.ts`: 18/18 trên hai project.
  - Hai test webkit "Không đồng ý" trong `login.spec.ts` cũng lỗi lẻ trên baseline (3/10 lần), không do thay đổi này.

## Spec Change Log

## Review Triage Log

Vòng 1 (30/10/2026). Reviewer: Blind Hunter (B), Edge Case Hunter (E), Verification Gap (V).

| # | Phát hiện | Verdict | Bằng chứng | Hướng xử lý |
|---|-----------|---------|-----------|-------|
| B1 | Bộ test cách ly chỉ kiểm guard. Không gọi tài nguyên con thật của BTC B (IDOR theo `eventId`) | medium | Đúng: `fill()` thay param con bằng UUID ngẫu nhiên. Story này chưa có tài nguyên con | defer (Story 2.7) |
| B2 | Test đối chứng không bắt route 500 trên chính BTC A | low | Đúng: chỉ kiểm code khác `NOT_A_MEMBER` | patch |
| B3/E1 | Guard gắn cứng `:orgId`. Route có `@RequirePermission` mà thiếu `:orgId` luôn trả `NOT_A_MEMBER`, nên bộ test cách ly pass vô nghĩa | medium | Đúng: `permission.guard.ts` gặp `orgId` undefined thì trả `notAMember()` | patch (ném lỗi cấu hình). Port cho `checkin` để defer sang Epic 5 |
| B4/V3 | `@Public()` + `@RequirePermission` chỉ lộ lúc có request, và chưa có test | low | Đúng, nhưng chỉ xảy ra do dev cấu hình sai | defer (V đề xuất) |
| B5 | Thiếu audit `member.added` cho Owner | false | `organization.created` có actor = Owner và `organization_id`, nên việc gán Owner đã được ghi | reject |
| B6 | `changed_fields` thiếu tên cột liên hệ | low | Khối frozen ghi "Không cột nào ra audit" cho cột liên hệ; code làm đúng như vậy | reject |
| B7/E5 | `POST /v1/orgs` không giới hạn tần suất và không có idempotency: mất response rồi "Thử lại" tạo BTC trùng | medium | Đúng: chỉ chặn bấm đúp phía client | defer |
| B8 | SĐT không chuẩn hóa (`+84` khác `0`), từ chối dấu chấm/gạch | low | Đúng: chỉ bỏ khoảng trắng | patch |
| B9/E6 | Tên toàn ký tự vô hình (zero-width) lọt qua | low | Đúng nhưng hiếm, sửa phải thêm refine | reject |
| B10 | Có nhiều BTC thì chỉ vào được BTC đầu tiên qua menu | low | BTC switcher thuộc phần B đã tách (deferred-work) | reject |
| B11 | Web chưa xử lý `FORBIDDEN_ROLE` | false | Chưa có trang web nào gọi route chỉ dành cho Owner; `org.read` Admin cũng có | reject |
| B12 | Thông báo `NOT_A_MEMBER` nói "xem" cả với thao tác ghi | low | Đúng: chuỗi cố định ở guard và `MESSAGES` | patch |
| B13 | `req.params.orgId` không hạ chữ thường | low | Handler lấy id qua `@Access()`; hiếm khi gặp | reject |
| B14 | `organizations.updated_at` không đổi khi update | low | Đúng: chỉ có `defaultNow()` | patch |
| B15 | DB test dùng chung dễ gây lỗi lẻ khi chạy song song | false | `vitest.config.ts` đặt `fileParallelism: false` | reject |
| B16 | Phần B không có key sprint-status; mục deferred ghi `source_spec: none` | medium | Đúng: đánh 2.1 done sau phần A thì mất phần B | xử lý ở bước trình bày (giữ 2.1 chưa done) |
| B17 | AC trộn log với audit; không kiểm tên BTC vắng trong log | low | Khóa `name` đã che qua `PII_KEYS` | reject |
| E2 | `ORG_ROUTE` chỉ khớp tên param `:orgId` | low | Đúng: `/v1/orgs/:id` thiếu decorator lọt kiểm | patch |
| E3 | `@All`/`@Head` làm crash bộ test | false | Crash là lỗi ồn ào, đúng hành vi mong muốn | reject |
| E4 | RouterModule hoặc prefix khác làm sai đường dẫn | false | Repo không dùng RouterModule/versioning | reject |
| E7 | Tên có emoji hoặc dấu tổ hợp chạm giới hạn 100 UTF-16 | low | Trình duyệt gửi NFC; hiếm | reject |
| E8 | `CONSENT_REQUIRED` làm banner lỗi lóe lên trước khi chuyển trang | low | Đúng: rơi vào nhánh `org.error` | patch |
| E9/E11 | Memberships lỗi thì menu không có lối vào | low | Đúng nhưng hiếm; hiện "Tạo BTC" khi lỗi sẽ gây hiểu nhầm | reject |
| E10 | Query key memberships không theo user | low | Đăng xuất đã xóa cache; còn lại chỉ trường hợp session hết hạn rồi đổi tài khoản | reject |
| V1 | Chặn memberships theo đồng ý ở menu tài khoản chưa có test | medium | Đã kiểm chứng sẵn (V) | patch |
| V2 | 401 lúc submit `/tao-btc` chưa có test | medium | Đã kiểm chứng sẵn (V) | patch |
| V-o | Banner "Chưa tải được BTC" chưa có e2e | low | Ngoài matrix, chỉ để biết | reject |

## Design Notes

`NOT_A_MEMBER` cho cả `orgId` không tồn tại hoặc sai định dạng: guard trả lỗi trước khi controller biết BTC có thật hay không, nên không thể dò ra BTC nào tồn tại.

Bộ test cách ly đọc metadata `@RequirePermission` qua `DiscoveryService` + `MetadataScanner`, thay `:orgId` bằng id của BTC B, rồi gọi bằng cookie của Owner BTC A. Mọi route phải trả 403 `NOT_A_MEMBER`. Route của story sau tự rơi vào bộ này mà không phải sửa test.

## Verification

**Commands:**
- `docker compose up -d && pnpm turbo build typecheck lint:deps test --force` -- expected: pass, có test organizer mới.
- `pnpm --filter @tickee/web test:e2e` -- expected: pass trên `ios-webkit` và `android-chromium`.
