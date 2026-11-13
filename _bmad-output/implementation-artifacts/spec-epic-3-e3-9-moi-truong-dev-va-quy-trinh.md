---
title: 'E3-9: môi trường dev (Tingee fake gửi IPN, seed kiểm Secret Token) và quy trình PR trước Story 4.1'
type: 'chore'
created: '2026-11-13'
status: 'done'
baseline_commit: 'd89dcffb5cf28c224718a2fc6704e5af0ddda6c9'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Retro Epic 3 (F1, F3, F4, F5) ghi lại mấy chỗ hổng:
- Commit `08520a6` (Tingee fake gửi IPN) chỉ nằm ở nhánh local `claude/youthful-bhaskara-7cfc7d`.
- `pnpm db:seed` báo "Không đổi" dù Secret Token của BTC demo không còn giải mã được.
- README không cảnh báo hai bẫy: `.env` trỏ Tingee thật, và đổi giá trị khóa mà giữ số phiên bản.
- Sprint-status lệch sau mỗi story vì Build chỉ đặt `review`, nên phải sửa tay trên `main`.
- PR #53 được merge khi CI đỏ.

**Approach:**
- Cherry-pick `08520a6` nguyên commit.
- Seed kiểm credential đang dùng còn giải mã được không.
- README thêm cảnh báo về hai bẫy cấu hình.
- Override `bmad-build` để story được đặt `done` ngay trong nhánh của story.
- Thêm PR template ghi luật CI đỏ.

## Boundaries & Constraints

**Always:**
- Seed chạy trong một transaction: lỗi thì không đổi gì, như hiện nay.
- Thông báo của seed không in ciphertext, Secret Token hay chuỗi kết nối.
- Override Build không bao giờ commit lên `main`. Đang ở `main` thì dừng và báo.

**Never:**
- Không đổi `apps/api/src`.
- Không thêm kiểm khóa lúc khởi động api/worker (đã giao Story 4.6/4.7).
- Không đụng credential đã `retired_at`.
- Không sửa `.claude/skills/bmad-build/*` vì file đó bị ghi đè khi cập nhật BMad. Chỉ dùng `_bmad/custom/bmad-build.toml`.

## I/O & Edge-Case Matrix

| Scenario | Trạng thái credential hiện hành của BTC demo | Kết quả |
|---|---|---|
| Chưa có | không có dòng `retired_at IS NULL` | Thêm như hiện nay |
| Còn mở được | `secretBox.open` thành công | Không đổi (giữ thông báo "Không đổi" nếu không có gì khác) |
| Hỏng, merchant demo | `client_id = SEED_MERCHANT.clientId`; ciphertext sai giá trị khóa, hoặc phiên bản không có trong env | UPDATE tại chỗ `secret_token_ciphertext = seal(SEED_MERCHANT.secretToken)` bằng khóa hiện hành, thêm một dòng thay đổi, thoát 0 |
| Hỏng, merchant khác | `client_id` khác, không mở được | Mã thoát 1, rollback, hướng dẫn liên kết lại key ở trang Tài khoản nhận tiền hoặc khôi phục giá trị khóa cũ |

**Quyết định (Mason, 13/11/2026):**
- Seed tự mã hóa lại Secret Token của merchant demo, như Matrix ở trên. Payout account và Đơn cũ vẫn trỏ cùng dòng credential, plaintext không đổi, nên IPN của Đơn cũ cũng chạy lại.
- Luật CI đỏ dùng PR template và mục README. Thêm vào đó, bật bảo vệ nhánh `main` qua `gh api`:
  - bắt buộc check `ci` xanh, không bật `strict`;
  - bắt buộc đi qua PR, không bắt buộc số người duyệt;
  - `enforce_admins` tắt, nên Owner vẫn bypass được nhưng phải chủ động.
  - Phiên chính chạy lệnh này sau khi implement xong, không giao cho subagent.

</frozen-after-approval>

## Code Map

- `08520a6` -- sửa `.env.example`, README (mục "Thanh toán Đơn có phí ở local"), `apps/api/test/{dev-seed,tingee-fake}`, `test/payment/ipn-dev-checkout.test.ts`; thêm `spec-tingee-fake-gui-ipn.md`. Merge-tree với `main` sạch, các import fixture vẫn còn trên `main`.
- `apps/api/test/dev-seed/seed.ts` -- `seedDevData`: khối `let [credential] = …` chỉ select `id`, chưa có thì insert `secretBox.seal(SEED_MERCHANT.secretToken)`. `runDevSeed` bắt lỗi chung thành "Lỗi khi ghi DB" và thoát 1. Lỗi nghiệp vụ cần một lớp riêng để in thông báo riêng.
- `apps/api/src/platform/crypto/secret-box.ts` -- `SecretBox.open` ném `SecretBoxError` khi sai dạng, thiếu phiên bản hoặc sai tag. Chỉ dùng, không sửa.
- `apps/api/test/dev-seed/seed.test.ts` -- test seed với `TEST_CREDENTIAL_KEYS`. Mẫu dựng `SecretBox` khác khóa: `testCredentialKey` trong `test/helpers.ts`.
- `README.md` -- bảng biến dòng 197–199 (`TINGEE_BASE_URL`, `TINGEE_CREDENTIAL_KEYS`, `TICKET_QR_KEYS`), mục "Dữ liệu dev" ở dòng 49.
- `_bmad/custom/bmad-build.toml` -- tạo mới, được commit (`.gitignore` chỉ bỏ `*.user.toml`). Khóa `[workflow] on_complete` chạy cuối step-05/oneshot, sau commit. `render_skill.py` gộp file này qua `load_customization`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `development_status`, `action_items` (id `epic-3-retro-e3-9-…`).
- `.github/workflows/ci.yml` -- job `ci` chạy cho `pull_request` và `push` lên `main`. Repo public, `main` chưa được bảo vệ.

## Tasks & Acceptance

**Execution:**
- [x] `git cherry-pick 08520a6` -- giữ nguyên commit, tác giả và message; phải là commit đầu tiên trên nhánh.
- [x] `apps/api/test/dev-seed/seed.ts` -- select thêm `clientId` và `secretTokenCiphertext`; thử `open`; xử lý theo Matrix. Merchant khác thì ném lỗi riêng, `runDevSeed` in hướng dẫn và thoát 1.
- [x] `apps/api/test/dev-seed/seed.test.ts` -- phủ mọi dòng Matrix: ciphertext sai giá trị khóa (cùng `v1`), ciphertext phiên bản không có trong env, merchant khác (rollback, mã 1, thông báo không lộ bí mật), chạy lại lần hai thì báo "Không đổi".
- [x] `README.md` -- `TINGEE_BASE_URL`: `.env` local phải là `http://localhost:4010`, trỏ Tingee thật thì key demo lỗi và báo "Chưa tạo được link thanh toán". `TINGEE_CREDENTIAL_KEYS`/`TICKET_QR_KEYS`: không bao giờ đổi giá trị của phiên bản đã dùng, muốn đổi thì thêm `v<k+1>`, kèm hậu quả và cách sửa ở local (`pnpm db:seed`). Mục "Dữ liệu dev": hành vi mới. Thêm mục ngắn "Quy trình PR".
- [x] `_bmad/custom/bmad-build.toml` -- `on_complete`: nếu `{story_key}` có giá trị thì đặt `done`. Nếu spec là action item trong `action_items` thì đặt `status: done` kèm `note` trỏ spec. Cập nhật `last_updated`, commit riêng trên nhánh hiện tại.
- [x] `.github/pull_request_template.md` -- các mục: Tóm tắt, Spec, Kiểm tra. Checklist: sprint-status cập nhật trong PR này; CI xanh, hoặc nếu merge khi đỏ thì ghi lý do và link run.
- [x] `sprint-status.yaml` -- E3-9 `status: done`, `note` trỏ spec này.
- [x] Bảo vệ nhánh `main` theo Quyết định -- **chỉ phiên chính làm**. Subagent implement bỏ qua task này; mục README "Quy trình PR" vẫn mô tả nó.

**Acceptance Criteria:**
- Given đã thêm override, when chạy `render_skill.py` cho bmad-build, then `step-05-present.md` và `step-oneshot.md` đã render đều có chỉ dẫn `on_complete`.
- Given nhánh này, when xem `git log`, then `08520a6` có mặt dưới dạng một commit riêng giữ nguyên message.

## Implementation Notes

- `git cherry-pick 08520a6` sạch, thành `cddd902` (commit đầu tiên trên nhánh, giữ tác giả, ngày và message). Nhưng `test/payment/ipn-dev-checkout.test.ts` của commit đó không typecheck trên `main`: Story 3.7 đã đổi `BuyerOrder` thành `BuyerOrderView` (trường `buyerStatus` thay `status`). Sửa trong thay đổi chưa commit (không sửa commit cherry-pick): `BuyerOrderView.parse`, `buyerStatus` `awaiting_payment`/`paid`, như `ipn.test.ts`.
- Seed: `unreadableReason` chỉ bắt `SecretBoxError` (lỗi khác ném tiếp). Lỗi nghiệp vụ là `UnreadableCredentialError` (export, mang `organizationId` và `reason` = message của `SecretBoxError`, không có bí mật). `runDevSeed` in hướng dẫn kèm URL `{WEB_ORIGIN}/btc/{orgId}/tai-khoan-nhan-tien`, không in Client ID của key riêng.
- Test Matrix (`seed.test.ts`, describe "Secret Token của key hiện hành không giải mã được"): sai giá trị khóa cùng `v1`, phiên bản `v2` không có trong env (cả hai qua CLI: mã 0, đúng một dòng "Mã hóa lại…", cùng dòng credential, payout vẫn trỏ vào, lần hai "Không đổi"); còn mở được bằng khóa cũ khi đang xoay `v1,v2` → "Không đổi"; merchant khác → mã 1, rollback cả việc duyệt lại Closed Beta, đầu ra không chứa ciphertext/Secret Token/Client ID/chuỗi kết nối/giá trị khóa. Test merchant khác trả credential về trạng thái giải mã được trong `finally` (DB test dùng chung). Thêm ca credential đã thay (`retired_at`) không giải mã được cạnh key hiện hành mở được: "Không đổi", dòng đã thay giữ nguyên.
- Sau review: `ipnRecipientOf` mở mọi credential của BTC, kể cả đã thay, nên liên kết lại key hay seed mã hóa lại chỉ sửa key hiện hành (tạo link mới); còn dòng nào không giải mã được thì IPN của BTC vẫn trả 500. Hướng dẫn của CLI và README nói rõ điều này, cách sửa đầy đủ là khôi phục giá trị khóa cũ, không thì dựng lại DB local (`docker compose down -v`). Seed không đổi hành vi với dòng đã thay.
- Override Build: prose của `on_complete` không được render quét token, nên dùng đường dẫn `{project-root}/_bmad-output/...` thay `{{.implementation_artifacts}}`. Thêm một nhánh nhỏ: spec chỉ làm một phần action item (như E2-5, E3-7 trước đây) thì chỉ nối `note`, không đặt `done`.
- Lưu ý cho AC render: `step-05-present.md` vốn đã chứa chữ "sprint-status" (đường dẫn `sync-sprint-status.md`), nên lệnh `grep -l "sprint-status"` ở Verification luôn khớp. Kiểm bằng tiêu đề riêng của override: `grep -c 'Sprint-status \`done\` trong nhánh của story'` ra 1 ở cả `step-05-present.md` và `step-oneshot.md`.
- Bảo vệ nhánh `main` (phiên chính, 13/11/2026): `gh api -X PUT repos/masonnguyen1243/tickee/branches/main/protection`. Kết quả: check bắt buộc `ci` (app_id 15368), `strict: false`, `enforce_admins: false`, bắt buộc PR với 0 người duyệt, không giới hạn người push.
- Kiểm sau review vòng 1 (13/11/2026): `pnpm typecheck` qua; `pnpm turbo lint:deps` qua; `pnpm turbo test --filter @tickee/api` 67 file, 1040 test qua (`test/dev-seed/seed.test.ts` 24, `test/payment/ipn-dev-checkout.test.ts` 3, `test/tingee-fake/checkout-ipn.test.ts` 27); render bmad-build có tiêu đề override ở cả `step-05-present.md` và `step-oneshot.md`.

## Spec Change Log

## Review Triage Log

Vòng 1 (13/11/2026): ba lớp review (Blind Hunter = BH, Edge Case Hunter = ECH, Verification Gap = VG) chạy trên diff từ `d89dcff`.

| # | Lớp | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|---|---|---|---|---|
| 1 | VG | Không có test cho luật "không đụng credential `retired_at`" | medium | Gap đã kiểm sẵn: mọi test seed chỉ có một credential cho mỗi BTC | patch |
| 2 | VG, ECH | Hướng dẫn "liên kết lại key" không làm IPN chạy lại | medium | `ipnRecipientOf` (`payout-targets.ts:98-109`) gọi `open` trên mọi credential, kể cả bản đã thay; `replaceKey` giữ ciphertext ở dòng đã thay, nên IPN vẫn trả 500 | patch (gộp với 3) |
| 3 | VG, ECH | README nói mã hóa lại xong thì IPN Đơn cũ chạy lại, sai khi BTC demo còn credential đã thay mã hóa bằng khóa cũ | medium | Cùng nguyên nhân với #2 | patch (sửa README, không đụng dòng đã thay) |
| 4 | BH, ECH | Câu "không phải key merchant demo" sai với `demo-btc-chua-lien-ket`; seed chỉ kiểm BTC demo của `--email` | low | `DEMO_MERCHANTS` có hai merchant; Matrix coi mọi key khác `SEED_MERCHANT` là "merchant khác". Sửa câu chữ, không đổi hành vi | patch |
| 5 | BH | Thiếu nhắc khởi động lại `pnpm dev` sau khi sửa `.env` | low | api/worker đọc khóa lúc khởi động; help của CLI có nhắc, README thì không | patch |
| 6 | BH, ECH | README nói Owner "phải chủ động chọn bypass" bảo vệ nhánh | medium | `enforce_admins: false`: `git push` thẳng lên `main` của Owner vẫn qua, chỉ kèm thông báo; README cũng không nói `strict: false` | patch |
| 7 | BH | Không nói ai đổi trạng thái epic/retro, trên nhánh nào | low | README cấm sửa tay trên `main` nhưng bỏ ngỏ việc này | patch |
| 8 | ECH | Mục `on_complete` có thể không chạy ở route oneshot | medium | `step-oneshot.md` ghi "Stop and wait for the user" trước mục On Complete | patch |
| 9 | ECH | So khớp action item theo tiền tố: `e3-1` khớp nhầm `e3-10-…` | low | Chỉ dẫn hiện ghi "cùng mã retro", không đòi khớp nguyên đoạn | patch |
| 10 | ECH | Commit sprint-status có thể kéo theo file đã stage sẵn | low | Chỉ dẫn ghi "chỉ stage" nhưng không dùng `git commit --only` | patch |
| 11 | BH, ECH | "Báo hash trong tóm tắt cuối" trong khi tóm tắt đã in trước `on_complete` | low | step-05 có "Display Summary" trước "On Complete" | patch |
| 12 | BH | Kiểm `main` của override chạy sau commit của Build | low | Build tự commit ở step-05 là hành vi có sẵn, và step-01 đã HALT khi nhánh không hợp | reject (có từ trước) |
| 13 | BH | Ghi chú WORKFLOW NOTES của sprint-status còn tả luồng `review` cũ | low | Dòng "Dev moves story to 'review'…" lệch với override mới; sửa thẳng một dòng | patch |
| 14 | BH, ECH | Nhánh story song song luôn xung đột ở `last_updated` | medium | `sync-sprint-status.md` vốn đã cập nhật `last_updated` trên nhánh mỗi lần đồng bộ | defer (có từ trước) |
| 15 | BH | Dòng cuối PR template hiện trong mọi PR | low | Đang là chữ thường, không phải comment | patch |
| 16 | BH | Note sprint-status trích `08520a6`, commit chỉ có ở local | low | Trên nhánh này commit là `cddd902`, cùng patch-id | patch (note trích cả hai) |
| 17 | BH | `cddd902` không typecheck, còn bản sửa ở commit sau | low | Lỗi chỉ ở file test; sửa vào chính commit đó trái với "cherry-pick nguyên commit" trong khối frozen | reject (ghi vào mô tả PR) |
| 18 | BH | Seed không cảnh báo khi `TINGEE_BASE_URL` khác fake | low | Intent chọn chỉ ghi README; cảnh báo thì thêm nhánh code | reject |
| 19 | BH | `.env.example` thiếu hai cảnh báo mới | low | Đây là file dev chép và sửa; chỉ cần thêm comment | patch |
| 20 | BH | Matrix của `spec-tingee-fake-gui-ipn.md` ghi 2xx, code đòi ACK | low | Có sẵn trong commit cherry-pick; message của commit có ghi ACK | reject (có từ trước) |
| 21 | BH | Spec E3-9 chưa ghi bằng chứng kiểm | low | Sửa bằng cách sửa spec của build này | reject (luật triage) |
| 22 | ECH | Khóa của seed khác khóa api khi shell export ghi đè `.env` | low | Cùng một shell thì hai process nhận cùng biến; thêm cờ opt-in trái với quyết định tự mã hóa lại | reject |
| 23 | ECH | Race gán `ipnKey` giữa seed và thao tác liên kết trên UI | low | Code có sẵn từ `08520a6`, chỉ dev gặp, cần thao tác đồng thời | reject |

## Verification

**Commands:**
- `pnpm typecheck` -- expected: pass
- `pnpm turbo test --filter @tickee/api` -- expected: pass, gồm `test/dev-seed`, `test/tingee-fake`, `test/payment/ipn-dev-checkout.test.ts`
- `pnpm turbo lint:deps` -- expected: pass
- `uv run --no-cache _bmad/scripts/render_skill.py --project-root . --skill .claude/skills/bmad-build`, rồi `grep -c 'Sprint-status \`done\` trong nhánh của story' <thư mục render>/step-05-present.md <thư mục render>/step-oneshot.md` -- expected: 1 ở mỗi file
