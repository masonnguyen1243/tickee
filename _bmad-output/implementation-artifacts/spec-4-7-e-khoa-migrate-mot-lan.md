---
title: 'Story 4.7-e: Vai migrate không chạy song song'
type: 'feature'
created: '2026-11-19'
status: 'done'
route: 'oneshot'
baseline_commit: '4aec00a17cd1e1cf4e7d4c05187da24305bf74e6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Vai `migrate` (`apps/api/src/roles/migrate.ts`) chạy ba việc nối tiếp nhau và không có khóa: migration Drizzle, schema `pgboss`, rồi cấp quyền cho `tickee_app`. Migrator của Drizzle 0.45 đọc migration cuối **ngoài** transaction rồi mới áp dụng phần còn thiếu. Vì vậy hai tiến trình migrate chạy cùng lúc (pipeline chạy lại, hai lượt deploy chồng nhau) có thể cùng áp một migration, hoặc cùng `GRANT`/`REVOKE` trên một bảng rồi lỗi `tuple concurrently updated`. Spine (AD-36) đang giả định pipeline chỉ chạy migrate một lần (triage 1.1 #11).

**Approach:** Bọc cả `runMigrations` trong một khóa advisory cấp session (`pg_advisory_lock`, khóa cố định của Tickee). Một kết nối riêng giữ khóa suốt ba việc. Tiến trình thứ hai **chờ** tới khi tiến trình đầu xong rồi mới chạy. Lúc đó không còn migration mới, nên Drizzle và pg-boss không làm gì, và việc cấp quyền chạy lại mà không đổi gì.

**Quyết định (lúc lập spec):**
- Chờ chứ không bỏ qua: một tiến trình bỏ qua mà vẫn thoát `0` có thể khiến deploy đổi `api`/`worker` trước khi schema xong.
- Không đặt giới hạn thời gian chờ trong code. Thời gian chờ do timeout của job trên nền tảng deploy chặn. Tiến trình giữ khóa chết thì kết nối đóng và Postgres tự nhả khóa.
- Khi phải chờ thì log `info` một lần, có marker `migrate_lock_wait`. Không log chuỗi kết nối.

</frozen-after-approval>

## Implementation Notes

- Code Map:
  - `apps/api/src/roles/migrate.ts`: `runMigrations` hiện mở `Database` với `max: 1` và Drizzle dùng chính pool này. Kết nối giữ khóa phải tách khỏi pool đó, vì giữ khóa trên pool `max: 1` sẽ làm Drizzle không còn kết nối.
  - Đặt helper khóa ở `apps/api/src/platform/db/` và export qua `index.ts`. `platform` không được phụ thuộc mô-đun miền (`.dependency-cruiser.cjs`).
  - Khóa theo mẫu `hashtextextended('…', 0)` đang dùng ở `ordering/order-rate-limit.ts:60`, nhưng là bản cấp session.
- Test:
  - `apps/api/test/db.test.ts` đã có ca "migrate lần nữa (idempotent)".
  - `vitest.config.ts` chạy file tuần tự (`fileParallelism: false`): giữ nguyên.
  - Hai ca cần thêm: (1) một kết nối khác đang giữ khóa thì `runMigrations` treo, nhả khóa thì xong; (2) nhiều `runMigrations` chạy song song đều xong, không lỗi.
- Tài liệu:
  - `README.md`: thêm một dòng về hành vi chờ khóa của vai migrate.
  - `deferred-work.md`: ghi "Đã xử lý (…)" dưới hai mục. Mục "Bảo đảm vai `migrate` chỉ chạy một lần…" trong checklist retro Epic 1. Mục "Story 4.7 con — vai `migrate`…" trong phần tách phạm vi 4.7.
- Sprint-status theo tiền lệ 4.7-a/b/c/d: `story_key` rỗng, `4-7-…` giữ `in-progress`.
- Nhánh `feat/4-7-e-khoa-migrate-mot-lan`, cắt từ `main`.
- Lượt triển khai (19/11/2026):
  - Tái hiện trước khi sửa: ba `runMigrations` song song trên `tickee_test` làm một lượt lỗi `tuple concurrently updated`, ở bước `grantAppRole`.
  - `apps/api/src/platform/db/migration-lock.ts` (mới):
    - Export `withMigrationLock`, `MIGRATION_LOCK_NAME` (`tickee:migrate`) và `MIGRATION_LOCK_APPLICATION_NAME` (`tickee-migrate-lock`), qua `platform/db/index.ts`.
    - Khóa nằm trên một `pg.Client` riêng, không lấy từ pool `max: 1` của Drizzle.
    - Thử `pg_try_advisory_lock` trước. Không lấy được thì gọi `onWait`, rồi `pg_advisory_lock`.
  - `apps/api/src/roles/migrate.ts`: `runMigrations` bọc ba bước (đổi tên thành `runLocked`).
    - `onWait` log `info` marker `migrate_lock_wait`.
    - `onLost` log `error` marker `migrate_lock_lost`.
  - Sửa theo review (xem Triage):
    - Kết nối giữ khóa đặt `statement_timeout`, `lock_timeout`, `idle_session_timeout` = 0, keepalive phía server (`tcp_keepalives_*`) và `client_connection_check_interval`. Client `pg` bật `keepAlive`.
    - Nhả khóa trên đường thành công có timeout 5 giây. Lỗi hoặc trả `false` thì báo lỗi, như khi mất kết nối.
    - `onLost` gọi ngay lúc mất kết nối, không đợi `fn` xong.
  - Test `apps/api/test/migrate-lock.test.ts`, 6 ca:
    - chờ khi có tiến trình khác giữ khóa;
    - chạy ngay khi không ai giữ;
    - ba lượt song song;
    - timeout theo role không cắt lượt chờ hay kết nối giữ khóa;
    - nhả khóa khi `fn` lỗi;
    - mất kết nối thì gọi `onLost` ngay rồi báo lỗi.
  - Kiểm test có bắt được lỗi:
    - Gỡ khóa thì ca song song đỏ 5/5 lượt.
    - Gỡ từng `SET statement_timeout`/`lock_timeout`/`idle_session_timeout` thì ca timeout đỏ.
  - `README.md` mục "Vai `migrate` không chạy song song" trong "Cấu hình staging/production": hành vi chờ, kết nối thẳng hoặc session, câu SQL xem ai giữ khóa và cách gỡ.
  - `apps/api/vitest.config.ts`: comment `fileParallelism` nêu thêm `migrate-lock.test`.
  - `deferred-work.md`: "Đã xử lý" dưới hai mục, cộng một mục hoãn (spine AD-36).
- Kiểm chứng:
  - Trước review: `pnpm typecheck` và `pnpm turbo lint:deps` sạch; api 1571/1571 (96 file).
  - Sau review: `test/migrate-lock.test.ts` 6/6. `pnpm typecheck` và `pnpm turbo lint:deps` sạch. Build api xong, api 1572/1572 (96 file).

## Review Triage Log

Vòng 1 (19/11/2026): Blind Hunter (BH), lớp duy nhất của đường oneshot.

| # | Phát hiện | Verdict | Bằng chứng / hướng |
|---|-----------|---------|--------------------|
| 1 | `statement_timeout`/`lock_timeout` theo role cắt lượt chờ `pg_advisory_lock` | medium | Reviewer thử trên `tickee_test`: cả hai hủy lượt chờ. Như vậy trái Quyết định "chờ, không giới hạn trong code". Patch: `SET … = 0` trên kết nối giữ khóa, kèm test |
| 2 | Mất khóa muộn (NAT ngắt im lặng) bị coi là thành công; nhả khóa bị nuốt lỗi, không có timeout | low | Đúng. Ngắt im lặng thì server vẫn giữ khóa, nên không chạy chồng; chỉ treo lâu. Patch: `keepAlive`, nhả khóa có timeout 5 giây, lỗi hoặc `false` thì báo lỗi |
| 3 | Máy chạy migrate chết không gửi FIN: server giữ khóa khoảng 2 giờ; lượt chờ bị hủy vẫn nằm trong hàng | medium | Đúng với keepalive mặc định của OS. Patch: `tcp_keepalives_*`, `client_connection_check_interval` trên kết nối giữ khóa; README thêm `pg_terminate_backend` |
| 4 | Câu SQL "ai giữ khóa" trong README trả cả lượt đang chờ | low | Đúng. Patch: join `pg_locks`, có cột `granted` |
| 5 | Chưa ghi rằng khóa cấp session cần kết nối thẳng hoặc pooler chế độ session | medium | Đúng: qua pooler chế độ transaction, nhả khóa rơi vào kết nối khác. Patch: README nêu yêu cầu; nhả khóa trả `false` thì báo lỗi |
| 6 | "Không đổi gì" chỉ đúng khi hai lượt cùng phiên bản | low | Đúng. Patch: sửa câu chữ ở README, JSDoc, deferred-work; nêu pipeline phải chặn deploy chồng giữa hai phiên bản |
| 7 | JSDoc nói "không bao giờ chạy cùng lúc"; mất khóa chỉ báo sau khi `fn` xong | low | Đúng. Patch: `onLost` log `error` ngay lúc mất; JSDoc nói rõ lượt khác có thể đã chạy chồng |
| 8 | Ca song song chỉ thử cuộc đua `GRANT`, không thử DB mới (Drizzle, tạo schema) | low | Reject: ca "đang có người giữ khóa" đã chứng minh chưa bước nào chạy khi chưa lấy được khóa (khóa bọc cả ba bước). Thử DB mới cần superuser tạo DB, nhiều hơn một sửa trực tiếp |
| 9 | `idle_session_timeout = 0` chưa có test | low | Đúng. Patch: ca timeout dùng `options=-c …`; gỡ từng `SET` thì đỏ |
| 10 | Ca 1 hỏng giữa chừng thì lượt migrate nền chạy lấn sang test sau | low | Đúng. Patch: `try/finally` nhả khóa và chờ `run` |
| 11 | `application_name` khóa không export, test chép tay chuỗi | low | Đúng. Patch: export `MIGRATION_LOCK_APPLICATION_NAME`, test dùng hằng |
| 12 | Comment `fileParallelism` trong vitest.config lỗi thời | low | Đúng. Patch: sửa comment |
| 13 | Log mỏng: không có log khi lấy được khóa, không có pid người giữ | low | Reject: hiếm gặp; câu SQL ở README (đã sửa ở #4) cho pid và `granted` |
| 14 | Spec còn `in-progress`, thiếu kết quả kiểm chứng | false | Bước Finalize chưa chạy lúc review; kết quả ghi ở Implementation Notes |
| 15 | Spine AD-36 chưa ghi luật khóa migrate | low | Defer: Classify không cho sửa spec/spine trong lượt này; đã ghi vào `deferred-work.md` |
