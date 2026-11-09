---
title: 'E2-7: Môi trường dev'
type: 'chore'
created: '2026-11-09'
status: 'done'
baseline_commit: '607108952307383d7dd9c893b990a28bc61e15c3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-retro-2026-11-09.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Retro Epic 2 (F3): DB local thiếu migration (lỗi 500), `pnpm dev` không chạy worker nên không gửi email mời, không có seed nên phải `UPDATE` tay để duyệt Closed Beta. `pnpm typecheck` build lại web không có `NEXT_PUBLIC_API_BASE_URL` (hoặc lấy lại bản build đó từ cache), làm e2e lỗi giả hàng loạt. `.turbo` phình tới 5 GB.

**Approach:** `pnpm dev` chạy migrate trước, rồi chạy api, worker và Tingee fake. Thêm `pnpm db:seed` tạo một BTC đã duyệt Closed Beta, có tài khoản nhận tiền trỏ vào merchant demo của Tingee fake. Lệnh dev ở gốc repo tự đặt giá trị local cho biến build web. `next build` thiếu biến thì dừng ngay. Thu hẹp output cache của web và đặt trần cho cache turbo.

**Quyết định (theo brief session cha, 09/11):** `pnpm dev` chạy luôn Tingee fake (`.env.example` đã trỏ `TINGEE_BASE_URL` vào fake). Seed mặc định tạo tài khoản `btc.demo@tickee.local`; `--email` dùng tài khoản khác.

## Boundaries & Constraints

**Always:**
- Build web để deploy vẫn phải tự đặt `NEXT_PUBLIC_API_BASE_URL`. Giá trị local mặc định chỉ đi qua các lệnh dev ở gốc repo (`typecheck`, `test`, `test:e2e`), không qua `pnpm build`.
- Seed chạy bằng `tickee_migrator`, trong một transaction, chạy lại không tạo trùng, từ chối khi `NODE_ENV=production`. Code seed nằm ngoài `src/` nên không vào image.
- Không commit secret. Key demo là key giả, chỉ có nghĩa với Tingee fake.

**Never:**
- Không đổi CI (`ci.yml` đã đặt biến ở cấp job).
- Không đổi luật nghiệp vụ (Closed Beta, tài khoản nhận tiền, mở bán).
- Seed không gọi Tingee và không ghi audit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Typecheck rồi e2e | Shell không có biến; `pnpm typecheck` rồi `pnpm --filter @tickee/web test:e2e` | Web build nhúng `http://localhost:3001`; e2e xanh | — |
| Build web thiếu biến | `pnpm turbo build --filter @tickee/web`, shell không có biến | `next build` dừng, nêu tên biến | Không có bản build nào, turbo không cache |
| `next typegen` thiếu biến | typecheck web | Chạy bình thường | — |
| `pnpm dev`, DB mới | Postgres chạy, chưa migrate | Migrate xong rồi api, worker, web, contracts, Tingee fake mới chạy | — |
| `pnpm dev`, Postgres tắt | — | Migrate lỗi; api và worker không khởi động | Log lỗi kết nối |
| Seed lần đầu | DB đã migrate | Tạo user (đã đồng ý NĐ 13), BTC `approved`, credential demo, một tài khoản nhận tiền mặc định; in email đăng nhập | — |
| Seed lần hai | Đã seed | Không thêm dòng nào; báo "không đổi" | — |
| Seed `--email` | Tài khoản có sẵn | Tài khoản đó làm Owner của BTC demo | Email sai dạng: thoát ≠ 0 |

</frozen-after-approval>

## Code Map

- `package.json` -- script gốc: `dev`, `typecheck`, `test`; thêm `test:e2e`, `db:seed`.
- `turbo.json` -- `build` khai `env` chung, outputs gồm `.next/**` trừ `.next/cache` (nhưng gồm `.next/dev` 213 MB của `next dev`, nên mỗi entry cache khoảng 365 MB). Chưa có `cacheMaxSize`/`cacheMaxAge` (turbo 2.11 có). `@tickee/web#typecheck` phụ thuộc `build` để tránh race với typegen (Story 1.2), phải giữ.
- `apps/api/package.json` -- `dev` (tsc watch + node watch, `APP_ROLE=api`), `tingee:fake` (tsc riêng vào `node_modules/.cache`). Mẫu đọc env: `--env-file-if-exists=../../.env`.
- `apps/api/src/roles/migrate.ts` -- `APP_ROLE=migrate` chạy Drizzle, schema pgboss, grant. Dùng lại qua `dist/main.js`.
- `apps/api/test/tingee-fake/{main,server}.ts` -- `DEMO_MERCHANTS` ở `main.ts`. `fakeAccount` sinh VA ngẫu nhiên mỗi lần chạy, nên seed không khớp được VA.
- `apps/api/src/platform/crypto` -- `SecretBox`, `parseCredentialKeys` (mã hóa secret như `PayoutAccountService.connect`).
- `apps/api/src/platform/db` -- `Database` (mẫu ở `roles/admin-cli.ts`).
- `apps/api/src/modules/{identity,organizer}/schema.ts` -- `users`, `organizations`, `members`, `tingeeCredentials`, `payoutAccounts`. `tingee_ipn_key` là 16 byte base64url (`payout-account.service.ts:67`). `accountLast4` là 4 số cuối `accountNumber` (`tingee.client.ts:127`).
- `apps/web/next.config.ts` -- `next build` nạp `.env*` trước khi nạp config. `next typegen` cũng nạp config ở `PHASE_PRODUCTION_BUILD`.
- `README.md` -- mục "Chạy local", "Kiểm tra".

## Tasks & Acceptance

**Execution:**
- [x] `scripts/dev-env.sh` -- mới: đặt `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` nếu chưa có, rồi `exec "$@"` -- một chỗ duy nhất cho giá trị local.
- [x] `package.json` -- `typecheck`/`test` chạy qua `dev-env.sh`; `test:e2e` build web (qua `dev-env.sh`) rồi chạy Playwright; `dev` = `turbo dev dev:worker dev:tingee`; `db:seed` -- lệnh dev không cần build tay.
- [x] `turbo.json` -- `env` và outputs `.next` chuyển sang `@tickee/web#build` (thêm `!.next/dev/**`, inputs gồm các file `.env*` của Next); thêm `@tickee/api#db:migrate`; `dev`/`dev:worker` của api phụ thuộc `db:migrate`; `cacheMaxSize: "2GB"`, `cacheMaxAge: "7d"` -- cache đúng và có trần.
- [x] `apps/web/next.config.ts` + một hàm kiểm thuần (vd. `apps/web/lib/build-env.ts`) -- khi `next build` (không phải typegen) mà thiếu biến thì throw, nêu tên biến và cách đặt -- không bao giờ ra (và cache) bản build hỏng.
- [x] `apps/web/test/` -- Vitest cho hàm kiểm: build thiếu biến → throw; build có biến, typegen, dev, start → không throw.
- [x] `apps/api/package.json` -- `db:migrate`, `dev:worker`, `dev:tingee`, `db:seed`; bỏ bước `tsc` đầu của `dev` vì turbo đã build.
- [x] `apps/api/test/tingee-fake/demo-merchants.ts` -- mới: chuyển `DEMO_MERCHANTS` sang đây, VA cố định; `main.ts` import -- seed và fake dùng chung dữ liệu.
- [x] `apps/api/test/dev-seed/{seed.ts,main.ts,tsconfig.json}` -- mới: hàm seed (nhận `Database`, khóa, email) tách khỏi CLI; idempotent theo I/O Matrix; build như `tingee:fake`.
- [x] `apps/api/test/dev-seed/seed.test.ts` -- Vitest trên Postgres test: lần đầu tạo đủ dòng (`paidSalesAllowed` của BTC demo đạt cả hai điều kiện), lần hai không thêm dòng, `--email` dùng tài khoản có sẵn, `NODE_ENV=production` bị từ chối, email sai dạng bị từ chối.
- [x] `README.md`, `.env.example` -- lệnh mới; bỏ hướng dẫn chạy migrate/worker/fake tay; mục dọn `.turbo`.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- E2-7 `status: done` kèm `note`.

**Acceptance Criteria:**
- Given worktree mới (chưa có `.next`), when `pnpm typecheck` rồi `pnpm --filter @tickee/web test:e2e`, then e2e xanh.
- Given `pnpm dev` đang chạy và đã `pnpm db:seed`, when đăng nhập OTP bằng email seed, tạo Sự kiện có Hạng vé có phí rồi bấm "Mở bán", then mở bán thành công, không phải sửa DB bằng SQL.
- Given đã chạy `pnpm dev` một lần, when build web, then entry cache turbo không chứa `.next/dev`.

## Implementation Notes

- Phê duyệt spec: theo brief của session cha (phạm vi bốn mục và tiêu chí hoàn thành của E2-7). Không dừng ở checkpoint. Spec khoảng 2.500 token, vượt mức 1.600 gợi ý. Vẫn giữ một spec, vì E2-7 là một action item.
- Ngoài spec, đã giữ lại: seed bổ sung phần thiếu (duyệt lại Closed Beta bị thu hồi, liên kết lại tài khoản đã hủy). `--email` tạo tài khoản nếu chưa có. Tìm BTC demo theo tên "BTC Demo" cộng Owner. Sau review, `pnpm db:seed` **không** migrate (chạy sau khi `pnpm dev` đã migrate).
- Turbo 2.11 dùng chung cache local giữa các git worktree, ở `.turbo/cache` của checkout chính. Lần chạy đầu với trần mới đã thu cache từ 5,0 GB xuống 1,7 GB. Entry build web không còn `.next/dev`: khoảng 4 MB so với 365 MB trước đây.
- Kiểm (09/11, sau review):
  - `next build` thiếu biến: dừng với `MissingBuildEnvError`, turbo không cache.
  - Xóa `.next` rồi `pnpm typecheck` (shell không có biến): bản build nhúng `http://localhost:3001`.
  - E2e: 577/578 qua. Mỗi lần chạy lỗi một test chập chờn đã ghi ở retro F4: lần 1 `purchase-form.spec.ts:376` (chromium; chạy riêng 8 lần thì lỗi 1), lần 2 `event-settings.spec.ts:224` (webkit). Không có lỗi hàng loạt.
  - API 41 file / 601 test; web Vitest 14 file / 124 test; `lint:deps` sạch; `pnpm db:seed` chạy lại báo "Không đổi".
  - AC2 (đăng nhập OTP, tạo Sự kiện có Hạng vé 150.000đ, mở bán 200) đi qua REST mà web gọi, chưa bấm trên trình duyệt.
- Tác động lên dữ liệu local: DB dev `tickee` được migrate tới 0014. Có thêm `btc.demo@tickee.local` và `ban.dev@tickee.local` cùng BTC demo, một Sự kiện thử đã mở bán, các session đăng nhập.

## Spec Change Log

## Review Triage Log

Lượt 1 (09/11). Ba lớp: Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----------|---------|-----------|-------|
| VG1 | `next.config.ts` gọi `assertBuildEnv` nhưng không test nào nạp config | medium | Lớp VG đã kiểm: chỉ `build-env.test.ts` gọi hàm trực tiếp. Bỏ dây nối thì mọi test vẫn xanh | patch |
| VG2, BH4, BH5 | Test seed so VA với chính hằng số seed dùng; không test nào chứng minh VA seed có trong danh sách fake trả về | medium | Đổi thứ tự `DEMO_MERCHANTS[0].accounts` sang tài khoản inactive/debit/VietinBank thì seed test vẫn xanh | patch |
| VG3 | Nhánh lỗi DB của `runDevSeed` (mã thoát, không lộ chuỗi kết nối) chưa có test | low | Lớp VG đã kiểm; CLI cùng loại `admin-cli` có test ở `roles.process.test.ts:299-311` | patch |
| BH1, EC5, BH2, EC6, BH8 | `pnpm db:seed` ở gốc chạy `turbo run db:migrate` (kèm build api) trước seed | low | Migrate chạy trước khi kiểm `NODE_ENV=production`. Turbo strict env làm migrate và seed có thể đọc DB khác nhau. Sửa src khi `pnpm dev` đang chạy rồi seed thì build api ghi lại `dist`. Đo thử: `dist` đã khớp thì không bị ghi lại | patch: bỏ bước migrate, seed nhắc chạy `pnpm dev` trước |
| BH12 | README mất mục chạy từ bản build (`APP_ROLE=api|worker`, `/healthz`, `/readyz`, `next start`) | low | Khối bị xóa là chỗ duy nhất ghi các lệnh này | patch |
| EC1, BH3, VG-khác | Seed dùng lại credential hiện hành dù `client_id` khác merchant demo | low | Có thật nhưng hẹp: BTC demo đổi key qua UI, hủy hết tài khoản, rồi seed lại. Sửa cần thêm nhánh | reject |
| EC2 | Đổi tên/chuyển Owner BTC demo thì seed lại tạo BTC demo mới | low | Hiếm, và tạo BTC demo mới là hành vi chấp nhận được. Sửa cần marker mới | reject |
| EC3 | Seed chạy cùng lúc với BTC liên kết tài khoản trên UI | low | Chỉ có advisory lock, không khóa dòng BTC. Race ở dev gần như không gặp. Sửa cần thêm khóa | reject |
| EC4 | `MIGRATION_DATABASE_URL` trỏ DB dùng chung khi `NODE_ENV` khác production | low | Phải tự trỏ `.env` dev vào DB dùng chung. Sửa cần thêm guard theo host | reject |
| EC7 | Cổng 4010 bận thì `dev:tingee` lỗi, `pnpm dev` dừng | low | Node in rõ `EADDRINUSE` kèm cổng, giống api ở 3001 và web ở 3000. Sửa cần thêm nhánh | reject |
| EC8 | Biến có nhưng sai dạng (thiếu scheme) vẫn build | low | Lỗi có từ trước, guard chỉ nhằm vào trường hợp thiếu biến. Sửa cần thêm kiểm dạng | reject |
| EC9 | Bỏ `tsc` đầu của `dev`: chạy trực tiếp mà thiếu `dist` | false | Đo thử: `node --watch` chờ file rồi tự chạy lại khi `tsc --watch` ghi xong `dist` | reject |
| BH6 | `account()` trong `demo-merchants.ts` lặp mặc định của `fakeAccount()` | low | Chỉ lệch khi đổi mặc định của fake. Sửa là refactor kiểu dữ liệu, không phải sửa thẳng | reject |
| BH7 | `describeDbError` bỏ bớt thông tin chẩn đoán | low | Theo mẫu `admin-cli` (không in message, tránh lộ chuỗi kết nối). Sửa cần thêm nhánh | reject |
| BH9 | Spec còn `in-progress`, task chưa tick trong khi sprint ghi `done` | false | Quy trình cập nhật spec ở bước review/present: task đã tick, status đổi `done` trước commit | reject |
| BH10 | Mục Verification của spec chưa có lệnh cho AC3 và các dòng `pnpm dev` | — | Muốn sửa phải sửa spec của chính build này | reject |
| BH11 | Miễn kiểm `typegen` dựa vào `process.argv` | false | `next typegen` nạp config trong cùng tiến trình (`next-typegen.js:83`) và argv có tên lệnh. Đã có unit test, chưa thấy hậu quả xấu | reject |

## Design Notes

Biến build web: turbo không nạp `.env` và không có giá trị mặc định cho `env`. Vì vậy giá trị local đặt trước khi gọi turbo. Turbo thấy giá trị này nên băm nó vào hash, và cache không lẫn bản build thiếu biến. Lệnh gọi turbo trực tiếp mà thiếu biến thì `next build` dừng. Không dùng `.env.production` commit sẵn: nếu deploy quên đặt biến, bản production sẽ âm thầm trỏ vào localhost.

## Verification

**Commands:**
- `pnpm typecheck && pnpm --filter @tickee/web test:e2e` -- expected: xanh, shell không đặt biến.
- `env -u NEXT_PUBLIC_API_BASE_URL pnpm turbo build --filter @tickee/web --force` -- expected: lỗi nêu tên biến.
- `pnpm turbo test --filter @tickee/api` và `pnpm turbo lint:deps` -- expected: xanh.
- `pnpm db:seed` hai lần trên DB đã migrate -- expected: lần hai báo không đổi.
