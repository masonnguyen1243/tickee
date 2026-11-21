---
title: 'CI: bước cài Playwright không treo vì apt'
type: 'bugfix'
created: '2026-11-19'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Bước "Cài trình duyệt Playwright (Chromium, WebKit)" của job `ci` chạy `playwright install --with-deps`. Mỗi run, bước này dùng apt tải 126 MB gói `.deb` (181 gói mới, 5 gói nâng) từ mirror Ubuntu. apt không có timeout.

Số đo trên 4 run xanh ngày 19/11:
- apt mất từ 33 giây tới 24 phút.
- Tải trình duyệt từ CDN của Playwright chỉ mất 8–15 giây.

Run 44478845730 (PR 89) treo 52 phút ở `apt-get update` (`archive.ubuntu.com … noble-security InRelease`), rồi job bị hủy ở trần 60 phút dù Vitest đã xanh.

**Approach:**
- Cache các gói `.deb` mà Playwright cần, cùng thư mục trình duyệt, bằng `actions/cache`. Khóa cache gồm phiên bản Playwright và phiên bản image runner.
- Cache trúng: cài thẳng từ các file `.deb` bằng `apt-get install --no-download`, không gọi mirror.
- Cache trượt, hoặc cài từ cache lỗi: cài qua mirror như cũ, nhưng apt có timeout và retry, và cả lệnh được thử lại tối đa 3 lần. Mirror treo thì apt báo lỗi sau vài chục giây, không chờ tới hết giờ job.

**Quyết định (lúc lập spec, từ số đo):**
- Cache gói `.deb` là phần chính. Cache trình duyệt chỉ đi kèm cho tiện, vì tải trình duyệt vốn nhanh.
- Không đặt `timeout-minutes` riêng cho bước cài. Timeout của apt đã bắt trường hợp treo hẳn, còn mirror chậm mà vẫn chạy thì không nên bị cắt. Trần 60 phút của job giữ nguyên.
- Không chuyển Playwright sang image `mcr.microsoft.com/playwright`. Bộ full-stack chạy api, worker, Postgres và Mailpit trên máy runner, nên đổi sang container là đổi cả cách chạy job.

</frozen-after-approval>

## Implementation Notes

- File: `.github/workflows/ci.yml` (bước cài, các bước cache, comment đầu job) và một script mới `.github/scripts/install-playwright.sh`.
- Khóa cache tính trong shell từ `ImageOS`, `ImageVersion` (biến môi trường của runner GitHub, không có trong context `env` của biểu thức) và phiên bản `@playwright/test` đã cài. Image mới thì khóa đổi, nên các gói cũ không bị cài lên image mới.
- Dùng `actions/cache/restore` và `actions/cache/save` tách riêng. Lưu ngay sau bước cài khi cache trượt, không chờ cuối job: bước sau đỏ thì cache vẫn được lưu.
- Cache tạo trên nhánh PR chỉ PR đó dùng được. Sau khi merge, run đầu tiên trên `main` tạo cache cho mọi PR dùng chung.
- Không chạy được CI ở local; kiểm bằng hai run trên PR: lượt đầu cache trượt (tạo cache), lượt chạy lại cache trúng.
- Số đo trước khi sửa (log 4 run xanh ngày 19/11, apt / tải trình duyệt / cả bước):

  | Run | apt | Tải trình duyệt | Cả bước |
  |-----|-----|-----------------|---------|
  | 44444723761 | 33 giây | 15 giây | 54 giây |
  | 44473623404 | 3 phút 28 giây | 15 giây | 5 phút |
  | 44457528612 | 15 phút 16 giây | 15 giây | 16 phút 16 giây |
  | 44433829680 | 24 phút 14 giây | 14 giây | 25 phút |

  Cả 4 run đều tải "Need to get 126 MB", 181 gói mới, 5 gói nâng.
- Sửa theo review (xem Triage), script có ba đường theo thứ tự:
  1. Image đã đủ thư viện: không cài gì. Kiểm offline bằng `install-deps --dry-run`, tức `apt-get install -s` (đã đọc trong `playwright-core` 1.64.1).
  2. Có gói `.deb` trong cache, khớp đúng khóa hoặc khớp tiền tố: cài từ cache, rồi kiểm lại bằng `--dry-run`.
  3. Còn lại: cài qua mirror. Chỉ chép các gói mà lượt này tải về.

  Khóa cache có tiền tố `v1` và hash của script. `restore-keys` lấy cache của image trước. Script ghi output `save`, và thời gian của bước vào step summary.
- Thời gian bị chặn khi mirror treo hẳn: với `Acquire::Retries 5` và timeout 30 giây, một lần tải treo tốn tối đa khoảng 3 phút, chưa tính thời gian chờ giữa các lần retry của apt. Cả lệnh thử lại 3 lần, nên tệ nhất khoảng 10 phút, không phải "vài chục giây" như câu trong Intent. Vẫn dưới xa trần 60 phút.

## Review Triage Log

Vòng 1 (19/11/2026): Blind Hunter (BH), lớp duy nhất của đường oneshot.

| # | Phát hiện | Verdict | Bằng chứng / hướng |
|---|-----------|---------|--------------------|
| 1 | Khóa cache không đổi khi script đổi (vd. thêm trình duyệt); không có cách bỏ một entry hỏng | medium | Đúng: cache trúng thì cài bộ gói cũ, thiếu thư viện chỉ lộ ra lúc mở trình duyệt. Patch: tiền tố `v1` và hash của script trong khóa |
| 2 | Thiếu `ImageOS`/`ImageVersion` thì khóa thành hằng | low | Reject: `runs-on: ubuntu-24.04` là runner GitHub-hosted, luôn có hai biến này |
| 3 | Không kiểm bộ gói từ cache có đủ không; image đã đủ thì vẫn gọi `apt-get update` | medium | Đúng; đã đọc `reportMissingDependenciesLinux` của 1.64.1 (`apt-get install -s`, thiếu gói thì mã 1). Patch: `--dry-run` trước khi cài và sau khi cài từ cache |
| 4 | Cache hỏng không tự sửa; chép gói trên đường fallback là phí | low | Đúng. Patch: cảnh báo hướng dẫn tăng `v<n>`; khớp đúng khóa thì không lưu lại |
| 5 | `dpkg --configure -a` không sửa phụ thuộc thiếu; lượt cuối vẫn báo "thử lại"; không có `::error::` | low | Đúng. Patch: `apt-get -f install -y`, cả sau khi cài từ cache lỗi; lượt cuối báo `::error::` |
| 6 | Thời gian bị chặn chỉ là ước tính; không có `timeout-minutes` cho bước | low | Reject phần timeout: Quyết định trong Intent đã chốt không đặt. Ghi ước tính đúng vào Implementation Notes |
| 7 | Cache thư mục trình duyệt (~870 MB giải nén) gần như không có lợi, tốn quota 10 GB | low | Đúng: số đo cho thấy tải trình duyệt mất 15 giây. Defer: Quyết định trong Intent chốt giữ cache này; ghi vào `deferred-work.md` để người dùng quyết |
| 8 | Image mới thì cache lạnh tới khi có merge vào `main` | medium | Đúng: `ImageVersion` đổi khoảng hằng tuần. Patch: `restore-keys` theo tiền tố không có `ImageVersion`. Gói cũ hơn thì `-y` từ chối hạ phiên bản, thiếu gói thì `--no-download` dừng, rồi chuyển sang mirror |
| 9 | Chép mọi file trong `/var/cache/apt/archives`, kể cả file không do lượt cài này tải | low | Đúng. Patch: chụp danh sách trước khi cài, chỉ chép file mới |
| 10 | Output `deps` không dùng; chỉ đường mirror ghi thời gian; spec thiếu số đo; chưa theo dõi việc hạ trần 60 phút | low | Patch: ghi nguồn, thời gian và số gói vào step summary; bỏ `deps`. Số đo vào spec; việc hạ trần vào `deferred-work.md` |
