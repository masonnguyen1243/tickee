---
title: 'CI: bước cài Playwright không treo vì apt'
type: 'bugfix'
created: '2026-11-19'
status: 'in-progress'
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
