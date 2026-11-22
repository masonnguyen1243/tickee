---
title: 'E4-8: Vệ sinh deferred-work.md và chặn rơi mục hoãn'
type: 'chore'
created: '2026-11-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '19f7b190b02c8ec84ebd4325b32e3c976b946977'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/e4-8-phan-loai-deferred-work.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:**
- **G1, G9 (retro Epic 4):** mục hoãn ghi "Story 4.x" bị rơi khi story đó tách nhỏ hoặc đóng, vì không bước nào quét lại. `deferred-work.md` có khoảng 70 mục mở không có chủ hoặc trỏ story đã xong, và khoảng 30 mục đã làm mà chưa ghi "Đã xử lý" (C4, D5, E4).
- **E7:** `spec-ci-cai-playwright-khong-treo.md` còn `in-progress` dù đã merge ở `fdf3cf6`.

**Approach:**
- Kết sổ theo bảng `e4-8-phan-loai-deferred-work.md`: chỉ thêm một dòng ngay dưới mỗi mục, không sửa nội dung cũ.
- Override `bmad-build`: bước đặt `done` grep `deferred-work.md` theo số story, và mỗi mục còn mở phải được làm, chuyển sang story có tên, hoặc ghi chấp nhận. Lời bác triage "để story X xét" phải thành một mục `deferred-work.md`.

**Quyết định (Mason, 21/11/2026):**
- 18 mục "Nợ nhỏ" của bảng ghi "Story nhận (…): action item E4-11". Thêm action item E4-11 vào `sprint-status.yaml` (`open`, Mason, trước Closed Beta, `ref` trỏ spec này). E4-10 giữ nguyên phạm vi.
- Mọi mục defer mới (triage review, oneshot, tách phạm vi ở step-01/02) phải có dòng `story:` (số story, mã action item, hoặc `chấp nhận`). Không đích nào hợp thì hỏi người dùng ở bước trình bày rồi mới ghi. Lời bác triage "để story X xét" cũng phải thành một mục như vậy.
- Thêm bước nạp lúc bắt đầu: khi lập kế hoạch, grep `deferred-work.md` theo số story hoặc mã action item. Mỗi mục còn mở phải có mặt trong spec, hoặc là việc làm (Tasks), hoặc là việc để lại kèm đích (Boundaries › Never).
- Giữ một spec, chấp nhận vượt ngưỡng token (khoảng 2.500).

## Boundaries & Constraints

**Always:**
- Dòng thêm theo đúng mẫu ở Design Notes, ghi ngày `21/11/2026`.
- Trước khi ghi, so nội dung mục với cột "Mục" của bảng. Số dòng tính theo baseline, nên áp từ cuối file lên.
- Giữ nguyên mục sprint-status hiện có trong `on_complete`, chỉ thêm vào.
- Bước mới trong override không bao giờ commit lên `main`.

**Never:**
- Không sửa hay xóa nội dung mục cũ, kể cả dòng "Đã xử lý" cũ.
- Không sửa code trong `apps/` hay `packages/`, `epics.md`, spine, PRD, hay `.claude/skills/bmad-build/*`.
- Không đổi trạng thái action item nào ngoài E4-8. Phần sprint-status `done` do `on_complete` làm.

## I/O & Edge-Case Matrix (bước đặt `done` mới)

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Mục đã làm | Story 5.3 xong; mục có "Story nhận (…): 5.3", spec đã làm | Thêm "Đã xử lý" kèm bằng chứng, commit cùng sprint-status | — |
| Mục chưa làm | Mục khớp 5.3 mà spec không làm | Hỏi gộp một lần: chuyển sang story/action item nào, hay chấp nhận. Ghi dòng tương ứng | Chưa trả lời thì không commit |
| Spec con | 4.2-a xong, mục để cho 4.2-b | Người dùng xác nhận thì ghi "Story nhận (…): 4.2-b" | — |
| Số kề | Grep 5.3 gặp `5.30`, `15.3` | Không tính | — |
| Action item | Spec của E4-1 | Grep `E4-1`, không khớp `E4-10` | — |
| Không có gì | Không khớp, hoặc mọi mục đã đóng | Không đổi `deferred-work.md` | — |
| Lúc lập kế hoạch | Bắt đầu 9.1; có mục "Story nhận (…): 9.1" và mục ghi "Story 4.7" mà phần mở đầu 9.1 nhận | Spec 9.1 liệt kê từng mục: làm hoặc để lại kèm đích | — |
| Defer mới | Review của story 5.2 hoãn một phát hiện | Mục mới có `story:`; không đích nào hợp thì hỏi ở bước trình bày | Chưa có đích thì không ghi `story:` tự đoán |

</frozen-after-approval>

## Code Map

- `_bmad-output/implementation-artifacts/deferred-work.md`: 993 dòng. Mẫu "Đã xử lý" có ở `:32`, `:588`. Phần bàn giao 9.1/9.2 ở `:918-934`.
- `_bmad-output/implementation-artifacts/e4-8-phan-loai-deferred-work.md`: bảng nguồn, mỗi dòng là một mục cần ghi, kèm loại và nội dung ghi.
- `_bmad/custom/bmad-build.toml`: hiện chỉ có `[workflow].on_complete` (đặt sprint-status `done`). Các hook có sẵn (`.claude/skills/bmad-build/customize.toml`, chỉ đọc): `persistent_facts` và `activation_steps_append` là list nối thêm, `on_complete` là string thay thế.
- `_bmad-output/implementation-artifacts/spec-ci-cai-playwright-khong-treo.md:5`: `status: 'in-progress'`.
- `_bmad-output/planning-artifacts/epics.md:2196, :2252`: phần mở đầu của 9.1 và 9.2 đã nhận các mục ghi "Story 4.7" và "5.8". Không sửa.
- `_bmad/scripts/render_skill.py`: render skill có override, dùng để kiểm.

## Tasks & Acceptance

**Execution:**
- [x] `deferred-work.md`: áp từng dòng của bảng, đi từ cuối file lên. Loại "Nợ nhỏ" ghi thành "Story nhận (21/11/2026, E4-8): action item E4-11. <lý do>". Thêm phần "Mục mới" (F1, F2, F4) ở cuối file, mỗi mục theo mẫu `source_spec`/`summary`/`evidence` kèm dòng `story:`. Đây là việc chính của E4-8.
- [x] `_bmad/custom/bmad-build.toml`, ba thay đổi, đều do retro G1 yêu cầu:
  - Trong `on_complete`: thêm mục "Mục hoãn trong `deferred-work.md`", chạy trước mục sprint-status, đúng như I/O Matrix (mẫu grep ở Design Notes). Bước commit sprint-status thêm `deferred-work.md` vào `--only` khi file đổi.
  - `persistent_facts`, mục 1: mọi mục defer mới phải có dòng `story:`, kể cả lời bác "để story X xét".
  - `persistent_facts`, mục 2: ở step-02, grep theo số story/mã action item và đưa từng mục còn mở vào spec. Đặt ở `persistent_facts` vì luật áp ở step-02 và step-04, không phải lúc kích hoạt.
- [x] `spec-ci-cai-playwright-khong-treo.md`: đổi `status` thành `'done'` (E7).
- [x] `sprint-status.yaml`: thêm action item E4-11 ngay sau E4-10, cùng cấu trúc các mục E4-x: `id: "epic-4-retro-e4-11-no-nho-tu-deferred-work"`, `status: open`, `ref` trỏ spec này. Cập nhật `last_updated`.

**Acceptance Criteria:**
- Given bảng phân loại, when xong, then mỗi dòng của bảng có đúng một dòng ghi mới ngay dưới mục tương ứng, và diff của `deferred-work.md` không xóa dòng nào.
- Given `deferred-work.md` sau E4-8, when grep một story backlog (vd. `7.1`) hay một action item (vd. `E4-10`), then thấy đủ các mục bảng giao cho đích đó.
- Given override mới, when render skill, then render thành công và các đoạn mới có trong file render.

## Design Notes

Mẫu dòng ghi (một dòng, thụt như các dòng "Đã xử lý" hiện có):

```markdown
- Đã xử lý (21/11/2026, E4-8): mục ngay trên đã làm ở Story 4.6-c. Bằng chứng: `ordering/safety-net-jobs.ts:117-122`.
- Đã có AC 9.1 (E4-7), ghi 21/11/2026.
- Trùng (21/11/2026, E4-8): theo dõi ở mục "<cụm đầu summary của mục gốc>" (phần "<heading>").
- Story nhận (21/11/2026, E4-8): 7.1. <lý do ngắn>.
- Chấp nhận (21/11/2026, Mason duyệt ở E4-8): <lý do>.
```

- Mỗi số dòng trong cột "Dòng" của bảng nhận đúng một dòng ghi. Hàng có hai loại (vd. "Chấp nhận + Story nhận") ghi chung một dòng, mở đầu bằng loại đứng trước, phần còn lại nối sau dấu chấm.
- Mục "Trùng" trỏ mục gốc bằng heading và cụm từ, không dùng số dòng vì số dòng đổi sau mỗi lần thêm.
- Mục defer mới (F1, F2, F4 và mọi mục do Build ghi sau này) thêm trường thứ tư:

  ```markdown
  - source_spec: `<spec>`
    summary: <một câu>
    evidence: <vì sao có thật>
    story: 6.1
  ```
- Mẫu grep: với story `N.M` dùng `grep -nE '(^|[^0-9.])N\.M([^0-9]|$)'`; với action item dùng `grep -nE 'E4-1([^0-9]|$)'`.

## Verification

**Commands:**
- `git diff --numstat -- _bmad-output/implementation-artifacts/deferred-work.md`: cột xóa bằng 0.
- `python3 -c "import tomllib; tomllib.load(open('_bmad/custom/bmad-build.toml','rb'))"`: không lỗi.
- `uv run --no-cache _bmad/scripts/render_skill.py --project-root . --skill .claude/skills/bmad-build`: in ra một `workflow.md`; grep thư mục render thấy đoạn "Mục hoãn trong `deferred-work.md`".
- `grep -cE '\((21/11/2026, E4-8|21/11/2026, Mason duyệt ở E4-8)\)|Đã có AC 9.1 \(E4-7\), ghi 21/11/2026' _bmad-output/implementation-artifacts/deferred-work.md`: bằng 155 (số dòng mà cột "Dòng" của bảng nêu).
- `grep -nE '(^|[^0-9.])7\.1([^0-9]|$)'`, `grep -n 'E4-11'`, `grep -n 'Story nhận (21/11/2026, E4-8): 9.1'` trên `deferred-work.md`: mỗi lệnh thấy đủ các mục bảng giao cho đích đó.

## Implementation Notes

- `deferred-work.md`: 155 dòng ghi chèn bằng script tạm (không commit), đi từ cuối file lên theo số dòng baseline; script tự tìm cuối mục (gồm dòng "Đã xử lý"/"Ghi thêm" đã có) và đối chiếu một cụm chữ của cột "Mục" trước khi chèn. Lượt đầu: 170 thêm, 0 xóa (155 dòng ghi + 15 dòng phần "Mục mới").
- Lệch bảng ở dòng 215 (e2e `400 VALIDATION_FAILED` form Hạng vé): bảng ghi "Đã xử lý" với bằng chứng `ticket-types.spec.ts:126,135`, nhưng hai dòng đó là API giả từ chối input sai mà web đã chặn trước (ca "giá 1.500 → … không gọi api"); không ca nào gửi input hợp lệ rồi nhận 400. Ghi thành "Story nhận (…): action item E4-11" thay vì đóng sai. E4-11 vì vậy có 19 mục (16 + 215 + F1, F2); `action` của E4-11 trong sprint-status không ghi số mục.
- Hàng hai loại (146, 203, 266, 612, 928) ghi một dòng; phần "Story nhận" đứng sau cũng mang "(21/11/2026, E4-8)" để `grep 'Story nhận (21/11/2026, E4-8): 9.1'` thấy đủ mục của 9.1. Dòng "Trùng" nối thêm "Story nhận ở đó: <đích>" để grep theo đích thấy cả mục trùng.
- Dòng 4 và 7: bảng gộp bằng chứng `pino-options.ts:16-22,39`; tách theo nội dung: mục 4 → `:19-22` (`REQUEST_PII_PATHS`), mục 7 → `:16,39` (`GENERIC_PII_KEYS`, `buildRedactPaths`).
- F4: quy ước `cursor` + `limit` của spine nay ở `ARCHITECTURE-SPINE.md:438` (bảng ghi `:417` trước lần sửa của E4-7).
- Action item không có `id` ("Chốt với Tingee") ghi là `action item "Chốt với Tingee" (sprint-status, epic 4)`.
- Override: `on_complete` thêm mục "Mục hoãn trong `deferred-work.md`" trước mục sprint-status; mục sprint-status chỉ được nối thêm câu (bước 4, bước 6), không dòng cũ nào đổi. Luật mã và luật đóng mục nằm một chỗ (persistent fact thứ ba "Mã và luật đóng mục hoãn"), luật nạp ở step-02 và `on_complete` cùng trỏ tới. Câu hỏi ở bước 5 không chặn sprint-status (E3-9): mục sprint-status commit trước, kèm các dòng không cần hỏi; dòng cần câu trả lời commit riêng `deferred-work.md` sau đó với message "kết sổ mục hoãn".
- Sau review: thêm một dòng "Ghi thêm (21/11/2026, E4-8)" dưới đoạn "**Story 9.1 nhận**" (phần "Bàn giao sau khi tách Story 4.7"): cảnh báo `identity.purge-expired` sang E4-10, chốt IPN `status`/`get-va-paging` sang E3-3. Dòng này chứa "(21/11/2026, E4-8)" nên lệnh đếm ở Verification ra 156 (155 dòng của bảng + 1). Diff `deferred-work.md`: 171 thêm, 0 xóa.
- Kiểm: `python3` mặc định của máy là 3.9 (không có `tomllib`); kiểm TOML bằng `/opt/homebrew/bin/python3` 3.14. YAML của sprint-status kiểm bằng gói `yaml` trong `node_modules`.

- Audit I/O Matrix: hàng "Số kề" và "Action item" kiểm bằng grep trên dữ liệu tự tạo (`5.3` không khớp `5.30`/`15.3`, khớp `5.3-a`; `E4-1` không khớp `E4-10`/`E4-11`). Các hàng còn lại là chỉ dẫn cho agent trong override, không có harness test; chỉ kiểm bằng cách đọc bản render (`step-05-present.md`, `step-oneshot.md`, `workflow.md`). Lần chạy thật đầu tiên là Story 5.1.
- Dòng 215 của bảng sửa thành "Nợ nhỏ" theo lệch đã ghi ở trên, nên E4-11 có 19 mục (18 của bảng ban đầu + dòng 215).

## Spec Change Log

## Review Triage Log

Lượt 1 (21/11/2026). Ba lớp: Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG; không có gap, 2 "Other findings").

| Phát hiện | Verdict | Bằng chứng | Route |
|---|---|---|---|
| EC1/BH1: dòng ghép mở đầu "Chấp nhận/Trùng/Đã có AC" rồi mới "Story nhận" (146, 203, 266) bị luật đóng coi là đã đóng | medium | `on_complete` bước 3 và fact 2 xét dòng theo sau mới nhất theo chữ mở đầu; phần 9.1/7.4 của ba mục sẽ không được nạp hay hỏi | patch (nhóm A: luật đóng) |
| EC2: fact 2 coi mọi "Đã xử lý" là đóng, kể cả "phần …" | medium | Fact 2 liệt kê "Đã xử lý" không kèm "phủ hết mục"; 7.1 sẽ bỏ C6 (dòng 555 baseline), E4-1 bỏ dòng 612 | patch (nhóm A) |
| EC3/BH4b: "Đã có AC 9.1" coi là đóng ngay cả khi đang chạy 9.1 | low | Cả hai luật liệt kê "Đã có AC …" là đóng; 9 mục AC 9.1 không bao giờ nhận "Đã xử lý" | patch (nhóm A) |
| BH4b: mục đóng từ chỗ khác trong file (598–600 đóng 545–553; 525–527; 182 "hai mục trên") bị coi là mở | low | Luật chỉ xét dòng ngay dưới mục; chỉ gây thêm câu hỏi thừa | patch (nhóm A) |
| EC14: dòng nhiều đích (9.1 và E4-10), người xong trước đánh "phần", phần còn lại bị hỏi lại | low | Bước 4 xử lý phần còn lại "như mục chưa làm" dù đã có đích trên cùng dòng | patch (nhóm A) |
| VG-O1/EC4/BH2: action item không có mã `EN-K` ("Chốt với Tingee") không grep được | medium | `sprint-status.yaml` mục này không có `id`; bước 2 "Không có mã nào thì bỏ qua bước 3 và 4"; 6 mục (602, 606, 616, 659, 662, 734) rơi lại kiểu G1 | patch (nhóm B) |
| VG-O2/BH7a: mục Split ở step-01 (`source_spec: none`) không được bước 5 gom | low | Bước 5 chỉ gom `source_spec` là `{spec_file}`; sửa trực tiếp một câu | patch (nhóm C) |
| BH5: sprint-status `done` chờ câu trả lời, đi ngược E3-9 | medium | Bước 5 "không commit gì, kể cả sprint-status" và lời mở đầu mục sprint-status; E3-9 đặt `done` trước khi dừng để không lệch | patch (nhóm D) |
| EC5: story epic mà `{story_key}` rỗng thì bỏ qua grep | low | Bước 2 chỉ rơi về action item; sửa trực tiếp: lấy `N.M` từ tên file | patch (nhóm E) |
| EC6: spec con dùng `N.M` cho nhãn và lọc, mục "Story nhận: 4.2-b" lẫn vào | low | Bước 2 chỉ "nhớ hậu tố cho bước 4"; bước 3 lọc theo `N.M` | patch (nhóm F) |
| EC13: đoạn "Story 9.1 nhận" ở phần bàn giao 4.7 vẫn giao cảnh báo `identity.purge-expired`, IPN `status`, `get-va-paging` cho 9.1 trong khi E4-8 giao E4-10/E3-3 | medium | `deferred-work.md:1081` (cây hiện tại); fact 2 bảo đọc phần bàn giao nên 9.1 sẽ nhận trùng | patch (nhóm G) |
| BH13: mục "Hoãn" của retro F2 (SecretBox ×6, hai rate limiter, `isLocalHost`/`isHttps`, fixture e2e), F3 (file lớn ngoài E4-10), F5 (Code Map 4.7-d) chưa có trong `deferred-work.md` | maybe-false | Grep `SecretBox`, `isLocalHost` trong file: 0. Chưa rõ retro cố ý bỏ hay để rơi; nếu rơi thì medium | defer |
| EC7: mục chưa có `story:` bị commit khi người dùng không trả lời | low | Cần gom mọi mục thiếu `story:` toàn file, sửa hơn một câu; hiếm | reject |
| EC8: chạy trên `main` thì không hỏi mục thiếu `story:` | low | Mục sprint-status cũng dừng và bảo tạo nhánh rồi chạy lại; lần chạy lại xử lý | reject |
| EC9: `sprint-status.yaml` không có thì `deferred-work.md` không được commit | false | File luôn có trong dự án này | reject |
| EC10: người dùng trả lời một phần câu hỏi gộp | low | Agent hỏi lại phần thiếu; thêm nhánh không đáng | reject |
| EC11: resume draft thay khối frozen làm mất mục đã nạp | false | Draft đã chứa mục nạp ở lượt đầu; `preserved_intent` giữ nguyên | reject |
| EC12: spec resume ở ready-for-dev bỏ qua step-02 nên không nạp | low | Spec mới đều qua step-02; `on_complete` vẫn bắt ở cuối | reject |
| EC15: ghi mục trước rồi mới thêm `story:` lệch Intent | false | Khớp hàng "Defer mới" của I/O Matrix (không ghi `story:` tự đoán) | reject |
| BH3: dòng 730 và 700 bị bảng bỏ sót, không có chủ | false | 731 ghi "Action item E4 'Chốt với Tingee'", 701 ghi "UAT Tingee thật (E3-3)": đã có chủ | reject |
| BH4a: đầu bảng nói chỉ bỏ mục đã đóng, thực tế bỏ cả mục có chủ hợp lệ | low | Sửa câu trong file `context` của spec | reject (sửa spec) |
| BH4: không có kiểm chiều ngược (mọi mục mở đều có trong bảng) | low | Thêm bước Verification là sửa spec; hai mục BH3 nêu là false | reject (sửa spec) |
| BH4c: dòng 50 phần 9.1 nên là "Đã có AC" | low | Ghi "Story nhận 9.1 (đã có trong AC 9.1)" vẫn đúng chủ | reject |
| BH6: nạp mọi mục làm spec phình, Split sinh mục trùng | maybe-false | Split ghi một mục cho mỗi goal, không cho từng mục nạp; mục nạp giữ "Story nhận" và bước 4 xử lý spec con; nếu có thì low | reject |
| BH7b: fact 1 "mục cũ cùng chủ đề" xung đột "Do not modify existing entries" | false | Chỉ đọc mục cũ để tìm đích; `story:` thêm vào mục mới của chính lượt đó | reject |
| BH8: `bmad-build-auto` không có override | low | Có từ trước (E3-9 cũng vậy), dự án chưa dùng; tạo override mới không phải sửa trực tiếp | reject |
| BH9: giao "lệnh tra lại tay" cho E4-1 là chuyền tiếp | low | Chính E4-1 ghi "giao … cho story có tên": E4-1 là nơi quyết, mục không rơi | reject |
| BH10: E4-4, E2-8 nhận thêm việc mà `sprint-status` không ghi | low | Bước nạp ở step-02 đưa mục ra khi làm; Mason đã duyệt bảng | reject |
| BH11: không có chỗ ghi Mason duyệt các dòng "Chấp nhận" | low | Mason duyệt spec và bảng ở checkpoint (21/11/2026); sửa là sửa spec. Nhắc lại dòng 295, 966 ở bước trình bày | reject (sửa spec) |
| BH12: E4-11 không có định nghĩa xong; id mang chữ "retro" | low | Action ghi "grep E4-11" để thấy danh sách; đổi id có thể lệch luật khớp `epic-N-retro-eN-K` | reject |
| BH14: chưa chạy thử bước mới trên story cũ | low | Các lỗi nó sẽ lộ ra đã được review tìm ra (nhóm A, B) | reject |
| BH15: bằng chứng `file:dòng` sẽ trôi; bảng lệch phần đã áp (F4 `:417`, F1, dòng 4/7); ghi chú 215 lặp | low | Lệch đã ghi ở Implementation Notes; sửa là sửa spec/bảng | reject (sửa spec) |
