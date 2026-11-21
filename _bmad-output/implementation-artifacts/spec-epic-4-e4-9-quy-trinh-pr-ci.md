---
title: 'E4-9: Quy trình PR/CI — stacked PR phải về main, CI trên main không bị hủy'
type: 'chore'
created: '2026-11-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '14cbc6411fd79a93e250588d0a7f05093315dee0'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:**
- **G2 (retro Epic 4):** PR #92 (4.7-f) và #93 (4.7-g) đều báo MERGED nhưng code không lên `main`. #92 nhắm `docs/correct-course-tach-4-7`, nhánh này đã merge vào `main` qua #91 trước đó 35 phút. #93 nhắm nhánh của #92. Repo đang tắt `delete_branch_on_merge`, nên GitHub không tự đổi base của PR con. `sprint-status.yaml` vẫn ghi 4.7 `done`, phải mở #94 để đưa code lên.
- **E6:** `ci.yml:12-13` đặt `cancel-in-progress: true` cho mọi ref, kể cả `main`. Hai PR merge cách nhau dưới khoảng 30 phút thì run của commit `main` đầu bị hủy. Branch protection đang `strict: false`, nên lỗi do merge lệch base không bao giờ ra kết quả đỏ.

**Approach:**
- `main`: mỗi commit có một concurrency group riêng, nên không run nào bị hủy hay bị thay khi đang chờ. PR giữ nguyên hành vi hủy run cũ khi có push mới.
- Stacked PR: thêm workflow guard `pr-base.yml` với check `base-main`, đỏ khi base của PR khác `main` và tự chạy lại khi đổi base.

**Quyết định (Mason, 21/11/2026):**
- Chọn (a): chỉ thêm workflow guard.
- Không bật `delete_branch_on_merge`.
- Không thêm bước kiểm base vào `bmad-build.toml` và không sửa PR template.

## Boundaries & Constraints

**Always:**
- Job `ci` giữ đúng tên, vì đó là required check của `main`.
- Trên PR, push mới vẫn hủy run `ci` cũ của cùng PR.
- Tên nhánh base đi qua `env`, không nội suy thẳng vào `run:`.
- Thông báo lỗi của guard bằng tiếng Việt và nói rõ phải làm gì.

**Never:**
- Không đổi branch protection hay cài đặt repo.
- Không đưa `base-main` vào required check.
- Không chặn tạo stacked PR. Guard chỉ báo đỏ.
- Không thêm `edited` vào trigger của `ci.yml`, vì sửa tiêu đề PR sẽ chạy lại cả job 20–30 phút.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nhiều merge liên tiếp | 3 push lên `main` trong 30 phút | 3 run `ci` riêng, không run nào `cancelled` | N/A |
| Push mới lên PR | `synchronize` khi run cũ đang chạy | Run `ci` cũ bị hủy như hiện nay | N/A |
| PR nhắm `main` | base = `main` | `base-main` xanh | N/A |
| Stacked PR | base = `feat/…` | `base-main` đỏ, báo phải merge PR cha trước rồi đổi base sang `main` | Không chặn tạo PR |
| Đổi base sang `main` | sự kiện `edited` | `base-main` chạy lại, chuyển xanh | N/A |
| Sửa tiêu đề hoặc mô tả PR | sự kiện `edited` | `base-main` chạy lại (vài giây), `ci` không chạy lại | N/A |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml:11-13` -- khối `concurrency` (`group: ci-${{ github.ref }}`, `cancel-in-progress: true`). Đây là workflow duy nhất, trigger `pull_request` (mọi base) và `push` lên `main`. Job `ci` là required check (`contexts: ["ci"]`, `strict: false`). Chỉ sửa khối `concurrency`.
- `.github/workflows/pr-base.yml` -- MỚI. Theo quy ước của `ci.yml`: `runs-on: ubuntu-24.04`, comment tiếng Việt. Không checkout, `permissions: {}`.
- Bằng chứng: `gh pr view 91/92/93` (base lần lượt `main`, `docs/correct-course-tach-4-7`, `feat/4-7-f-…`); `gh api repos/{owner}/{repo}` cho `delete_branch_on_merge: false`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- action item `epic-4-retro-e4-9-quy-trinh-pr-ci`. Bước `on_complete` đặt `done`, không sửa tay.
- Không sửa: `_bmad/custom/bmad-build.toml`, `.github/pull_request_template.md`.

## Tasks & Acceptance

**Execution:**
- [x] `.github/workflows/ci.yml` -- đặt `group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}` và `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, kèm comment dẫn retro E6 -- nếu chỉ đặt `cancel-in-progress: false` thì run đang chờ vẫn bị run mới thay.
- [x] `.github/workflows/pr-base.yml` -- tạo workflow `PR base`:
  - Trigger `pull_request` với `types: [opened, reopened, synchronize, edited]`.
  - Một job `base-main`, `timeout-minutes: 2`, concurrency theo số PR có hủy run cũ.
  - Một bước đọc `BASE_REF` từ `github.event.pull_request.base.ref` qua `env`. Base khác `main` thì in `::error::` tiếng Việt rồi `exit 1`.
  - Comment dẫn retro G2.

**Acceptance Criteria:**
- Given PR của spec này (base `main`), when CI chạy, then `ci` và `base-main` đều xanh.
- Given đoạn shell của guard, when chạy tay với `BASE_REF=main` rồi `BASE_REF=feat/x`, then lần lượt exit 0, và exit 1 kèm thông báo.

## Implementation Notes

- Nhánh `chore/e4-9-quy-trinh-pr-ci`. Đã sửa `.github/workflows/ci.yml` (chỉ khối `concurrency`, kèm comment E6) và tạo mới `.github/workflows/pr-base.yml`.
- `require('yaml')` ở gốc repo không chạy, vì `yaml` không phải dependency trực tiếp. Đã parse bằng bản trong store pnpm (`node_modules/.pnpm/yaml@2.*/node_modules/yaml`, `strict: true`).
- Kiểm theo bảng I/O (21/11), dùng assert trên YAML đã parse:
  - Job `ci` giữ tên; `ci.yml` chỉ trigger `pull_request` (không `types`, nên không có `edited`) và `push`.
  - `group`/`cancel-in-progress` đúng như Tasks.
  - `pr-base.yml` có `types: [opened, reopened, synchronize, edited]`, `permissions: {}`, `timeout-minutes: 2`, và không có `${{` trong `run:`.
- Đoạn `run:` lấy từ YAML, chạy bằng `bash -eo pipefail`:
  - `main` → exit 0.
  - `feat/x` → exit 1 kèm `::error::`.
  - Base chứa `"; echo pwn; "` → exit 1, chuỗi chỉ được in ra, không bị chạy.
- Ba dòng của bảng là hành vi runtime của GitHub, không kiểm được ở local: không run nào trên `main` bị `cancelled`, push mới hủy run PR cũ, `edited` chạy lại guard. Phải kiểm trên PR và sau khi merge (mục Verification).
- Review vòng 1: hai patch ở `pr-base.yml`, gồm câu `::error::` bảo đóng/mở lại PR hoặc push để `ci` chạy lại trên `main` (triage #1) và comment về ruleset (triage #2). Đã chạy lại kiểm config và đoạn shell: `main` → exit 0, `feat/x` → exit 1. Phát hiện #8 đã ghi vào `deferred-work.md`.

## Spec Change Log

## Review Triage Log

Vòng 1 (21/11/2026). BH = Blind Hunter, EC = Edge Case Hunter, VG = Verification Gap.

| # | Nguồn | Phát hiện | Verdict | Bằng chứng | Hướng |
|---|-------|-----------|---------|------------|-------|
| 1 | BH, EC, VG (khác) | Thông báo guard bảo "chờ `ci` xanh trên base mới", nhưng đổi base không chạy lại `ci` | medium | `ci.yml:4` không có `types`, nên chỉ chạy `opened/synchronize/reopened`; đổi base chỉ bắn `edited`. Re-run dùng lại merge SHA cũ. `ci` xanh cũ vẫn thỏa required check (`strict: false`) | patch: thông báo bảo đóng/mở lại PR hoặc push một commit để `ci` chạy trên `main` |
| 2 | BH | Comment `pr-base.yml` nói GitHub chỉ áp required check cho nhánh được bảo vệ, như thể không thể chặn | low | Repo public (`gh api`: `visibility: public`), nên ruleset cho mọi nhánh bắt buộc được `base-main`. Không chặn là lựa chọn "không đổi cài đặt repo" của intent | patch: sửa comment (chỉ sửa câu chữ) |
| 3 | BH | Stacked PR đang mở trước khi thay đổi lên sẽ không có `base-main` | false | `gh pr list --state open` trả `[]` lúc 21/11 | reject |
| 4 | EC | Nhánh cắt trước khi merge thiếu `pr-base.yml` trong merge ref nên guard không chạy | low | Chỉ là cửa sổ tạm. Hiện không có PR mở nào, nhánh cắt từ `main` sau khi merge đều có file. Sửa phải thêm bước quy trình | reject |
| 5 | BH | Guard đỏ cả với stack bình thường (PR cha chưa merge), dễ thành nhờn | low | Intent đã duyệt (lựa chọn (a), dòng "Stacked PR" của bảng I/O) chấp nhận đỏ cho mọi base khác `main`. Sửa phải thêm quyền `pull-requests: read` và gọi API | reject |
| 6 | BH | Hard-code `main` ở hai file | low | Default branch là `main`, branch protection và quy trình đều dùng tên này; đổi tên rất khó xảy ra. Sửa phải thêm env và `format()` | reject |
| 7 | EC | PR có conflict thì `pull_request` không chạy, `base-main` đỏ cũ còn sau khi đổi base | low | PR conflict thì đằng nào cũng không merge được; giải conflict là push, bắn `synchronize` và guard chạy lại | reject |
| 8 | VG | Check sau merge trên `main` vẫn qua với config cũ nếu không có hai merge chồng nhau | medium | Gap đã được VG kiểm trước. Chỉ quan sát được khi có hai merge vào `main` trong một khoảng thời gian chạy CI | defer: kiểm ở lần merge chồng nhau tới |
| 9 | VG | Không kiểm phía PR vẫn hủy run cũ | low | Group phía PR vẫn là `ci-refs/pull/N/merge` như cũ; `github.ref != 'refs/heads/main'` cho kết quả true với ref PR. Thấy được khi push commit sprint-status riêng lúc `ci` đang chạy. Sửa là thêm check vào spec | reject |
| 10 | VG | Đường đỏ của guard và lần chạy lại khi `edited` chưa thử trên GitHub | low | Đoạn `run:` đúng y như trong file đã chạy ở local cho cả đỏ lẫn xanh. Tài liệu webhook mà VG dẫn xác nhận `edited` bắn khi đổi base. Thử thật cần một PR nháp trên GitHub (hành động ra ngoài) | reject; đề xuất Mason cho phép thử bằng PR nháp sau khi push |

## Design Notes

Vì sao group riêng theo `github.sha` trên `main`, chứ không chỉ đặt `cancel-in-progress: false`:
- Với group dùng chung, run thứ hai chờ run thứ nhất.
- Tới merge thứ ba thì run thứ hai đang chờ bị run thứ ba thay, vì GitHub giữ tối đa một run chờ cho mỗi group.
- Group riêng tránh cả trường hợp này. Đổi lại, các run trên `main` có thể chạy song song và tốn thêm phút runner.

Guard không thể chặn nút Merge, vì GitHub chỉ áp required check cho nhánh được bảo vệ. Giá trị của nó là dấu X đỏ ngay cạnh nút Merge.

## Verification

**Commands:**
- `node -e "require('yaml').parse(require('fs').readFileSync(f,'utf8'))"` cho cả hai file workflow -- expected: parse không lỗi. Không có `yaml` thì dùng parser YAML sẵn có khác.
- Chạy đoạn shell của guard với `BASE_REF=main` và `BASE_REF=feat/x` -- expected: exit 0 / exit 1.

**Manual checks (if no CLI):**
- Trên PR của spec này: check `base-main` xuất hiện và xanh.
- Sau khi merge: `gh run list --branch main --workflow CI` -- run của commit merge không ở trạng thái `cancelled`.
