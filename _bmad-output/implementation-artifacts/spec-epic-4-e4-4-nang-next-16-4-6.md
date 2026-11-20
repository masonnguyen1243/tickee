---
title: 'E4-4 (phần Next): đối chiếu advisory và nâng Next 16.4.3 → 16.4.6'
type: 'chore'
created: '2026-11-20'
status: 'done'
baseline_commit: 'ff969b75ff2f8894c215032a4fdb3c1cae17ac65'
route: 'oneshot'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-11-20.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Next CLI dừng build và `next dev` với `SecurityFatalError`, báo bản 16.4.3 có lỗ hổng đã biết (`deferred-work.md:949-950`, retro Epic 4 mục E4). Trước giờ chưa ai đối chiếu với nguồn chính thức. Tra GitHub Advisory Database ngày 20/11/2026 cho `next@16.4.3` thì ra 7 advisory mức medium, công bố 16–19/11/2026, đều đã vá từ 16.4.5: GHSA-f3mh-rxg3-f5g2, GHSA-7qx7-33qx-rqx2, GHSA-pc58-hwjq-p385, GHSA-rhh4-g77r-r9qj, GHSA-vvgp-ww4w-46vf, GHSA-vc7v-qv4w-wrv8, GHSA-mfr8-8qww-v76h.

**Approach:** Ghim `next` của `apps/web` lên 16.4.6. Đây là bản patch mới nhất của dòng 16.4 (`latest` trên npm, phát hành 09/11/2026, qua được `minimumReleaseAge`), và tra advisory cho `next@16.4.6` ra 0 mục. Sau đó cập nhật lockfile, bảng Stack trong spine, mục hoãn và action item. Chỉ làm phần Next của E4-4. Cache ảnh OG và giới hạn tốc độ `funnel-events` giữ nguyên mốc "trước Closed Beta".

</frozen-after-approval>

## Implementation Notes

- Quyết định của agent:
  - Chọn 16.4.6 thay vì 16.4.5 (bản vá tối thiểu): cùng dòng patch, có thêm bản sửa sau 16.4.5, không có advisory mở.
  - React giữ 19.3.1 vì không advisory nào yêu cầu nâng.
- Mức phơi nhiễm của tickee trước khi nâng (để biết mức khẩn, không phải lý do bỏ qua): web không dùng Edge runtime, `'use cache'`/`unstable_cache` hay `next/image`. Vẫn có thể dính hai mục: endpoint tối ưu ảnh mặc định (GHSA-7qx7) và mục self-hosted (GHSA-pc58). Nâng bản thì hết cả hai.
- File đã đổi:
  - `apps/web/package.json`: `next` lên 16.4.6.
  - `pnpm-lock.yaml`: đổi `next`, `@next/env`, `@next/swc-*` và hash tương ứng. Phía importer `apps/api` cũng đổi khóa snapshot của `better-auth` và `@thallesp/nestjs-better-auth`, vì peer tùy chọn `next` giờ trỏ 16.4.6; api không nạp `next`. Ngoài ra cây phụ thuộc không đổi.
  - `ARCHITECTURE-SPINE.md`: bảng Stack ghi Next.js 16.4.6.
  - `deferred-work.md`: thêm dòng "Đã xử lý" ngay dưới mục `:948-950`.
- Kiểm chứng (local, 20/11):
  - `pnpm --filter @tickee/web typecheck`, `lint:deps` và `test` (399 test) đều xanh.
  - `next build` (với `NEXT_PUBLIC_API_BASE_URL` như CI) thoát 0 và không còn `SecurityFatalError`.
  - `next dev` lên "Ready" rồi chạy đủ 25 giây, không tự thoát như ở 16.4.3.
  - `pnpm audit --prod`: "No known vulnerabilities found".
- E2E full-stack không chạy local: CI chạy nó trên PR. `pnpm --filter @tickee/api typecheck` xanh.
- Vì sao `SecurityFatalError` lúc có lúc không (`next/dist/lib/upgrade/nudge.js`):
  - Next CLI chỉ dừng khi phát hiện đang chạy dưới AI agent (`getAgentName`). Người chạy tay thì thấy menu tương tác. CI không có agent nên không bị dừng.
  - Lần dừng đầu ghi biên nhận vào `.next/cache/next-agentic-upgrade-retries`, hạn 5 phút. Chạy lại trong 5 phút thì qua, kèm cảnh báo.
  - Vì vậy `next dev` do agent khởi động lại sau hơn 5 phút sẽ bị dừng lần nữa. Đây là nguyên nhân "web chết ngầm" ghi ở retro.
  - Khi có advisory mới cho 16.4.6, triệu chứng sẽ quay lại; đó là tín hiệu đúng, cần tra advisory như spec này.
- Kiểm lại các phân tích dựa vào mã nguồn nội bộ của 16.4.3, trên 16.4.6:
  - Header `immutable` mặc định của `ImageResponse` vẫn ở `compiled/@vercel/og/index.node.js:20581`, nên S1 của phần OG vẫn đúng.
  - `registerInstrumentation` vẫn bỏ qua khi `NEXT_PHASE === 'phase-production-build'`. `test/start.process.test.ts` (4.7-f) nằm trong 399 test đã xanh.

## Review Triage Log

Một lớp review: Blind Hunter, 11 phát hiện.

| # | Phát hiện | Verdict | Bằng chứng / xử lý |
|---|---|---|---|
| 1 | Action item E4-4 trong `sprint-status.yaml` chưa cập nhật | false | Bước On Complete của Build ghi `note` vào action item trong một commit riêng. Item vẫn `open`/`in-progress` vì phần OG và `funnel-events` còn lại |
| 2 | Retro và ghi chú bảo mật local chưa cập nhật | low | Patch: S3 trong ghi chú local có dòng "Đã xử lý". Retro là bản chụp ngày 20/11, không viết lại; trạng thái theo dõi ở `sprint-status.yaml` |
| 3 | Spec `in-progress` mâu thuẫn với dòng "Đã xử lý" | false | Bước Finalize đặt `done` trước commit; hai thay đổi vào cùng commit |
| 4 | Frontmatter thiếu `baseline_commit`, `context` | low | Patch: thêm `baseline_commit` và retro Epic 4 vào `context` |
| 5 | Không có gì tự báo khi phụ thuộc dính advisory | medium | Defer: cần Mason chốt chính sách audit (`deferred-work.md`, mục review E4-4) |
| 6 | Chưa ghi nguyên nhân `SecurityFatalError`; CI có thể đỏ chập chờn | false (phần CI) | `nudge.js` chỉ dừng khi phát hiện agent, CI không bị. Patch: ghi cơ chế và hạn 5 phút vào Implementation Notes |
| 7 | Endpoint `/_next/image` vẫn bật | low | Defer như hardening; advisory hiện tại đã vá |
| 8 | Phân tích dựa vào mã nguồn nội bộ 16.4.3 chưa kiểm lại | false | Đã kiểm trên 16.4.6: header `immutable` vẫn ở `:20581`, `registerInstrumentation` vẫn bỏ qua lúc build. 4.8-b tự tải ảnh nên không phụ thuộc chặn `localhost` của Satori. Không liệt kê changelog 16.4.4–16.4.6: low, bác |
| 9 | Mô tả lockfile thiếu phần importer api; chỉ kiểm web | low | Patch: ghi phần snapshot `better-auth`; `@tickee/api` typecheck xanh |
| 10 | Số dòng `deferred-work.md` lệch nhau và sẽ cũ đi | low | Bác: số dòng trong Intent nằm trong khối frozen. Dòng "Đã xử lý" trỏ tên spec nên vẫn tra được |
| 11 | `updated` của spine chưa đổi | low | Patch: `updated: '2026-11-20'` |
