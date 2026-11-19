---
title: 'Story 4.7-b: Siết cấu hình production lúc khởi động'
type: 'feature'
created: '2026-11-18'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '933bd1c9e227a154d7c8ebd25d21b2c700c6f4f2'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Schema `config` chỉ kiểm định dạng, nên api/worker lên production vẫn chạy được với `http://`, với secret mẫu của `.env.example` (ai đọc repo cũng biết), với `TICKET_QR_KEYS` trùng khóa `TINGEE_CREDENTIAL_KEYS`, hoặc với `AUTH_COOKIE_DOMAIN` không bao được hai origin. Thiếu `NODE_ENV` thì mặc định `development`, nên mọi luật production (gồm giới hạn IP `/v1/admin/*` của 4.7-a) tự tắt.

**Approach:** `NODE_ENV` thành biến bắt buộc, không mặc định. Thêm luật chéo vào schema của vai api và worker. Lỗi đi qua `ConfigError` như hiện nay: chỉ nêu tên biến và lý do, không bao giờ nêu giá trị, báo đủ mọi lỗi trong một lượt.

## Boundaries & Constraints

**Always:**
- **`NODE_ENV`:** cả ba vai đều bắt buộc. Thiếu hoặc rỗng → `thiếu`. Image đã đặt `production`; `.env.example` đặt `development`; test đặt `test`.
- **https khi `NODE_ENV=production`:** `API_PUBLIC_URL`, `WEB_ORIGIN`, `TINGEE_BASE_URL`, `S3_ENDPOINT`, `S3_PUBLIC_BASE_URL` phải là `https:`. Biến nào vai đó đọc thì vai đó kiểm. `OTEL_EXPORTER_OTLP_ENDPOINT` không kiểm (collector nội bộ có thể dùng http).
- **Giá trị mẫu khi `NODE_ENV=production`:** từ chối đúng giá trị mẫu của `.env.example` ở `BETTER_AUTH_SECRET`, `REVALIDATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Với `TINGEE_CREDENTIAL_KEYS` và `TICKET_QR_KEYS`, từ chối mọi khóa có byte trùng một trong hai khóa mẫu, bất kể số phiên bản.
- **Khóa trùng (mọi môi trường):** `TICKET_QR_KEYS` có một khóa trùng byte với một khóa của `TINGEE_CREDENTIAL_KEYS` thì lỗi ở `TICKET_QR_KEYS`.
- **`AUTH_COOKIE_DOMAIN` (vai api):**
  - Đặt ở mọi môi trường: so không phân biệt hoa thường, bỏ dấu `.` đầu. Host của `API_PUBLIC_URL` và của `WEB_ORIGIN` phải bằng miền này hoặc kết thúc bằng `.<miền>`.
  - Ở production mà hai host khác nhau thì bắt buộc, vì SSR của web chuyển tiếp cookie của web sang api.
- **Báo lỗi:** mỗi luật gắn đúng tên biến (`path`). Luật chỉ chạy khi các biến nó dùng (kể cả `NODE_ENV`) không có lỗi khác, nên một biến không bị báo hai lần. Lý do lỗi:
  - https: `phải là https khi NODE_ENV=production`;
  - giá trị mẫu: `là giá trị mẫu của .env.example; môi trường thật phải sinh giá trị riêng`;
  - khóa trùng: `dùng chung khóa với TINGEE_CREDENTIAL_KEYS`;
  - cookie: `phải là miền cha của host API_PUBLIC_URL và WEB_ORIGIN`.

**Never:**
- Không kiểm `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SMTP_URL` theo giá trị mẫu. Không kiểm danh sách hậu tố công khai (PSL).
- Không đọc `.env.example` lúc chạy (image không có file này): giá trị mẫu nằm trong code, test giữ đồng bộ.
- Không làm phía web (`WEB_ORIGIN`/`metadataBase` của `apps/web`). Không làm các story con 4.7 khác: presign ảnh, CI e2e full-stack, khóa migrate. Không đổi hành vi `ADMIN_ALLOWED_CIDRS`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Production hợp lệ | api: https, secret riêng, `AUTH_COOKIE_DOMAIN=tickee.vn`, host `api.tickee.vn` và `tickee.vn`; worker tương ứng | Khởi động | N/A |
| Thiếu `NODE_ENV` | Mọi vai, biến không đặt hoặc rỗng | `ConfigError` | `NODE_ENV (thiếu)` |
| http ở production | `API_PUBLIC_URL=http://…` (tương tự 4 biến còn lại; `WEB_ORIGIN` ở cả worker) | `ConfigError` | Lý do https |
| Dev giữ như cũ | `NODE_ENV=development`, giá trị y `.env.example` | Khởi động | N/A |
| Secret mẫu | Production, `BETTER_AUTH_SECRET` (hoặc 5 biến kia) đúng giá trị mẫu | `ConfigError`, không in giá trị | Lý do giá trị mẫu |
| Khóa mẫu đổi phiên bản | Production, `TINGEE_CREDENTIAL_KEYS=v1:<thật>,v2:<khóa mẫu QR>` | `ConfigError` ở `TINGEE_CREDENTIAL_KEYS` | Lý do giá trị mẫu |
| Khóa dùng chung | Mọi môi trường, `TICKET_QR_KEYS=v3:<một khóa của TINGEE_CREDENTIAL_KEYS>` | `ConfigError` ở `TICKET_QR_KEYS` | Lý do khóa trùng |
| Cookie sai miền | `AUTH_COOKIE_DOMAIN=khac.vn` (cả development) | `ConfigError` | Lý do cookie |
| Cookie dấu chấm, hoa | `.Tickee.VN` với `https://api.tickee.vn`, `https://tickee.vn` | Hợp lệ | N/A |
| Production thiếu cookie | Hai host khác nhau, không đặt `AUTH_COOKIE_DOMAIN` | `ConfigError` | `AUTH_COOKIE_DOMAIN (thiếu)` |
| Cùng host | Production, cả hai origin cùng host, không đặt cookie | Khởi động | N/A |
| Nhiều lỗi | Production: http + secret mẫu + thiếu `DATABASE_URL` | Một `ConfigError` nêu đủ, mỗi biến một issue | N/A |

</frozen-after-approval>

## Code Map

Đường dẫn dưới `apps/api/` trừ khi ghi khác.

- `src/platform/config/config.schema.ts`:
  - `common.NODE_ENV` (`:14`) đang `.default('development')`.
  - `httpOrigin` (`:28`), `cookieDomain` (`:33`), `credentialKeys` (`:39`, vẫn là chuỗi sau parse).
  - `tingeeAndTickets` (`:55`) dùng chung api/worker; `storage` (`:197`).
  - `apiConfigSchema` (`:271-280`): mẫu luật chéo `.refine(fn, { path, message, when })`, chạy cả khi biến khác lỗi.
  - `workerConfigSchema` (`:282`) hiện là `z.object` thuần.
- `src/platform/config/load-config.ts` -- `toIssues` (`:24`): biến không đặt thì lý do `thiếu`; issue `custom` dùng `message`; tên biến lấy từ `path[0]`.
- `src/platform/crypto/secret-box.ts:40` -- `parseCredentialKeys` trả `{ version, key: Buffer }[]`, dùng để so byte.
- `src/modules/identity/auth.ts:105-107` -- cookie `Secure` theo scheme của `API_PUBLIC_URL`; `crossSubDomainCookies` theo `AUTH_COOKIE_DOMAIN`.
- `../web/lib/api/server.ts:14` -- SSR chuyển tiếp cookie của request web sang api. Đây là lý do khác host thì bắt buộc cookie miền cha.
- `src/roles/admin-cli.ts:101`, `test/dev-seed/seed.ts:322` -- `loadConfig` vai migrate, lấy `NODE_ENV` từ `.env` hoặc từ image (`Dockerfile:26`).
- `../../.github/workflows/ci.yml:67-70` -- bước "Migrate" chạy `dist/main.js` mà không có `NODE_ENV`.
- Test thiếu `NODE_ENV` phải bổ sung:
  - `test/config.test.ts`: `apiEnv`/`workerEnv`; `:59`, `:70` đang kiểm mặc định `development`; `:446` có vòng `undefined`.
  - `test/roles.process.test.ts`: `apiRoleEnv` (`:14`) và các env spawn khác.
  - `test/worker.test.ts:56`, `test/telemetry/config.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/platform/config/production-rules.ts` (mới, export qua `index.ts`) -- giá trị mẫu, `sharesKey(a, b)` so byte khóa, `isCookieParent(domain, origin)` -- gom hằng và hàm thuần để schema và test dùng chung.
- [x] `src/platform/config/config.schema.ts` -- bỏ default của `NODE_ENV`; luật https, giá trị mẫu, khóa trùng cho api và worker; luật cookie cho api. Mỗi luật một `refine` có `path` và `when` -- AC Always.
- [x] `test/config.test.ts` -- phủ toàn bộ I/O Matrix. Thêm một test đọc `../../.env.example`: với từng biến trong danh sách mẫu, giá trị trong file bị từ chối ở production. Nhờ vậy sửa giá trị mẫu mà quên sửa code thì test đỏ.
- [x] `test/roles.process.test.ts`, `test/worker.test.ts`, `test/telemetry/config.test.ts` -- thêm `NODE_ENV: 'test'` cho env tự dựng.
- [x] `../../.github/workflows/ci.yml` -- bước Migrate thêm `NODE_ENV: test`.
- [x] `../../.env.example`, `../../README.md` (mục mới `## Cấu hình staging/production` trước `## Kiểm tra`) -- `NODE_ENV` bắt buộc và danh sách luật production.
- [x] `deferred-work.md` -- thêm dòng "Đã xử lý (…)" dưới các mục: checklist production của retro Epic 1 (mục đầu), review 3.3 triage #9, story con "siết cấu hình production", review 4.7-a `NODE_ENV`. Mục `TRUST_PROXY_HOPS` vẫn mở.

**Acceptance Criteria:**
- Given env của image (`NODE_ENV=production`) với giá trị y `.env.example`, when chạy vai api hoặc worker, then thoát mã 1 và nêu đủ các biến vi phạm, không có giá trị nào trong output.
- Given `.env` local tạo từ `.env.example`, when `pnpm dev`, `db:seed`, `admin:grant`, then chạy như trước.

## Implementation Notes

- Sprint-status: 4.7-b là story con. Theo tiền lệ 4.7-a và 4.8-a, `4-7-…` giữ `in-progress`. Bước `done` của override `bmad-build.toml` coi `story_key` là rỗng; không có action item nào khớp, nên không sửa `sprint-status.yaml`.
- Luật chéo nằm trong một danh sách `CROSS_RULES` (`config.schema.ts`). `withCrossRules()` biến mỗi luật thành một `refine` có `path`/`when`, và bỏ luật có biến mà vai không đọc. Vì vậy worker không có luật cookie, S3 hay `ADMIN_ALLOWED_CIDRS`. Luật `ADMIN_ALLOWED_CIDRS` của 4.7-a chuyển vào danh sách này với `uses: ['NODE_ENV']`, hành vi giữ nguyên.
- "Cùng host" so `hostname`, bỏ cổng, vì cookie không tách theo cổng.
- Một lỗi có thể che lỗi khác: production còn `API_PUBLIC_URL` `http://` thì luật cookie chỉ báo ở lần khởi động sau, vì spec muốn mỗi biến chỉ báo một lần. README đã ghi điều này.
- `worker.test.ts` dựng env từ `test/helpers.ts`, vốn đã có `NODE_ENV: 'test'`, nên không cần sửa. Ngoài các file trong spec, phải thêm `NODE_ENV` vào `test/telemetry/telemetry.process.test.ts`.
- Verification 18/11/2026: `build typecheck` (đặt `NEXT_PUBLIC_API_BASE_URL`), `lint:deps` và API 94 file/1554 test đều xanh.
- Sau review vòng 1 (triage #13–14, #20, #22, #23):
  - luật giá trị mẫu so sau `trim()`;
  - test chống trôi kiểm từng khóa của `.env.example`;
  - có test luật cookie bị bỏ qua khi origin lỗi;
  - README ghi CLI vai migrate cần `NODE_ENV`.

  Ba mục defer (#10, #11–12, #24) đã ghi vào `deferred-work.md`. Verification 19/11/2026: `build typecheck`, `lint:deps`, API 94 file/1555 test đều xanh.

## Spec Change Log

## Review Triage Log

Vòng 1 (18/11/2026): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-----|-----------|---------|------------|-------|
| 1 | BH | Không báo đủ lỗi trong một lượt: issue của luật chéo (vd. https của `API_PUBLIC_URL`, khóa mẫu) làm bỏ qua luật cookie và luật khóa trùng; README vừa nói "một lượt" vừa nói phải khởi động lại | low | Đúng như Always › Báo lỗi trong frozen ("luật chỉ chạy khi các biến nó dùng không có lỗi khác"); README đã ghi ngoại lệ. Sửa phải gắn nhãn nguồn issue, trái với intent | reject |
| 2 | EC | Như #1 (`when` bỏ qua luật khi biến trong `uses` lỗi) | low | Cùng gốc với #1 | reject |
| 3 | BH | Lý do "bắt buộc khi production…" không bao giờ hiện; người vận hành chỉ thấy `AUTH_COOKIE_DOMAIN (thiếu)` | low | Đúng như I/O Matrix (`AUTH_COOKIE_DOMAIN (thiếu)`); bảng biến README ghi rõ khi nào bắt buộc; như triage 4.7-a #14 | reject |
| 4 | BH | Endpoint OTEL http kèm `OTEL_EXPORTER_OTLP_HEADERS` gửi token dạng rõ | low | Intent loại OTEL khỏi luật https; collector SaaS dùng https sẵn, collector nội bộ http là cách dùng hợp lệ; có từ 4.6-a | reject |
| 5 | BH | Chỉ so đúng giá trị mẫu của chính biến đó (bản sửa nhẹ, mẫu của biến khác, credential MinIO trôi) | low | Cần cố ý chép mẫu sang biến khác; sửa nhẹ thì không luật nào bắt được; ngoài nhu cầu thường ngày | reject |
| 6 | BH | `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SMTP_URL` không bị kiểm | false | Intent › Never loại tường minh ba biến này | reject |
| 7 | BH | Tên biến trong `CROSS_RULES` gõ sai hoặc đổi tên thì luật bị bỏ im lặng | low | Mỗi biến của luật có test đặt đúng tên, nên đổi tên sẽ làm test đỏ; chỉ lọt khi thêm luật mới không kèm test. Sửa là thêm guard | reject |
| 8 | EC | Như #7 | low | Cùng gốc với #7 | reject |
| 9 | BH | Fallback `?? ''`: biến https tùy chọn chưa đặt sẽ báo nhầm; `CredentialKeysError` lọt ra nếu `when` hỏng | false | Năm biến https đều bắt buộc: không đặt thì đã có issue `thiếu` và `when` bỏ luật; key list sai dạng cũng đã có issue. Không input nào tới được nhánh này | reject |
| 10 | BH | Phía web: `/api/revalidate` nhận `REVALIDATE_SECRET` mẫu; `NEXT_PUBLIC_API_BASE_URL` http vẫn build production | low | Có sẵn từ 2.11-c/1.2; intent › Never loại phía web. Là phần web của cùng checklist | defer |
| 11 | BH | Chép `.env.example` lên server giữ `NODE_ENV=development` thì mọi luật production tắt (env runtime đè `ENV` của image) | medium | Đúng: `--env-file`/secret store đè `ENV NODE_ENV=production`; có từ trước story này (intent chỉ xử lý thiếu biến). Sửa cần luật mới (cảnh báo khi origin https không phải local mà `NODE_ENV` khác production) mà intent chưa định | defer |
| 12 | VG | Như #11 (mục Other findings) | medium | Cùng gốc với #11 | defer |
| 13 | BH | `admin:grant`/`admin:revoke`, `db:seed` (vai migrate) giờ cần `NODE_ENV`, README chưa nói | low | Do story này gây ra; lỗi `NODE_ENV (thiếu)` rõ nhưng người chạy CLI từ máy mình không có `.env` sẽ gặp. Sửa là một câu tài liệu | patch |
| 14 | EC | Như #13 | low | Cùng gốc với #13 | patch |
| 15 | BH | Hai test cùng chép danh sách biến vi phạm và hàm đọc `.env.example` | low | Thêm luật thì test đỏ to ở cả hai nơi, không lỗi im lặng; cosmetic | reject |
| 16 | BH | Spec không có trong diff review | false | Cố ý: spec chỉ đưa cho lớp Edge Case | reject |
| 17 | BH | Barrel `platform/config/index.ts` export hàm chỉ test dùng | low | Không có tác hại cụ thể (cùng cách `cidr.js` đang export) | reject |
| 18 | BH | `isCookieParent` khớp đuôi trên host là IP (`0.0.1` với `127.0.0.1`); hậu tố công khai; host có dấu `.` cuối; hai miền khác nhau | low | Production https trên IP hay host có dấu `.` cuối là cấu hình hiếm; PSL bị intent loại; hai miền khác nhau thì SSR không chia được cookie nên từ chối khởi động là đúng | reject |
| 19 | EC | Như #18 (hai host IP ở production không bao giờ khởi động được) | low | Cùng gốc với #18 | reject |
| 20 | EC | Secret mẫu kèm khoảng trắng hoặc xuống dòng cuối (secret k8s tạo từ file) lọt qua so khớp chính xác | low | Đúng: `loadConfig` không trim, nên `<mẫu>\n` khác `<mẫu>`. Sửa trực tiếp: so sau `trim()` | patch |
| 21 | EC | Test tiến trình treo tới timeout và để lại worker chạy nếu có hồi quy làm config production qua được | low | Chỉ xảy ra khi đã có hồi quy; cùng mẫu `run()` với test 4.7-a có sẵn; test đỏ vì timeout 30 giây | reject |
| 22 | EC | Test chống trôi chỉ kiểm cả chuỗi key list; thêm `v2:<khóa mới>` vào `.env.example` thì test vẫn xanh trong khi khóa mới lọt production | low | Đúng: `usesExampleKey` khớp nếu có một khóa trùng nên khóa v1 làm cả danh sách bị từ chối. Trái với lời hứa chống trôi; sửa trong test | patch |
| 23 | VG | Không test nào chứng minh luật cookie bị bỏ qua khi origin lỗi; đổi `uses` thì mọi test vẫn xanh | medium | Gap đã kiểm (VG chạy bản đột biến) | patch |
| 24 | VG | Không gì kiểm image chạy api/worker với `NODE_ENV=production` thật | medium | Gap đã kiểm; đổi `ENV` trong Dockerfile thì CI vẫn xanh. Cần chạy image vai api/worker trong CI, trùng story con CI e2e full-stack | defer |

## Design Notes

Thứ tự trong `when`: luật bỏ qua khi `NODE_ENV` hoặc biến nó đọc đã có issue. Ví dụ luật https của `API_PUBLIC_URL`:

```ts
.refine((c) => c.NODE_ENV !== 'production' || isHttps(c.API_PUBLIC_URL), {
  path: ['API_PUBLIC_URL'],
  message: 'phải là https khi NODE_ENV=production',
  when: (p) => !p.issues.some((i) => ['NODE_ENV', 'API_PUBLIC_URL'].includes(String(i.path?.[0]))),
})
```

Mỗi luật sinh từ một danh sách `{ variable, uses, check, message }` để api và worker dùng chung. Không viết tay từng `refine`.

## Verification

**Commands:**
- `pnpm turbo build typecheck` và `pnpm turbo lint:deps` -- expected: xanh (web cần `NEXT_PUBLIC_API_BASE_URL`, như CI).
- `pnpm --filter @tickee/api test` -- expected: xanh, gồm các test mới.
