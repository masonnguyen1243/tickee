# E4-8: Bảng phân loại mục mở trong `deferred-work.md`

Đi kèm `spec-epic-4-e4-8-ve-sinh-deferred-work.md`. Số dòng tính theo `deferred-work.md` ở commit `19f7b190b02c8ec84ebd4325b32e3c976b946977` (21/11/2026). Mục đã đóng (có "Đã xử lý" phủ hết) không có trong bảng: khoảng 45 mục.

Cột **Ghi** là dòng sẽ thêm ngay dưới mục (sau các dòng theo sau đã có của mục đó), theo mẫu ở spec › Design Notes. Loại:

- **Đã xử lý**: đã làm mà chưa ghi. Kèm bằng chứng.
- **AC 9.1**: đã có trong AC 9.1 sau E4-7.
- **Trùng**: trỏ mục gốc, theo dõi ở đó.
- **Story nhận**: gán chủ (story backlog hoặc action item). Gồm cả mục có nhãn chết (4.x đã xong, "5.8", "Epic 7", "khi Tingee trả lời"…).
- **Chấp nhận**: không làm trong MVP, Mason duyệt ở checkpoint E4-8.
- **Nợ nhỏ**: test, tách file, câu chữ không story nào chạm. Ghi "Story nhận (21/11/2026, E4-8): action item E4-11" (Mason chốt 21/11/2026).

## Dòng 1–283

| Dòng | Loại | Mục | Ghi |
|---|---|---|---|
| 1 | Chấp nhận | Test `serverApiRequest` và header mặc định | Hàm chưa có consumer (`apps/web/lib/api/server.ts:10`); phần `content-type` đã có test (`api-client.test.ts:111-128`) |
| 4, 7, 10 | Đã xử lý | Che IP/UA pino-http; redact theo đường dẫn; ErrorFilter không log params | `spec-epic-1-ai-1-bit-ro-pii-trong-log.md`; `platform/logging/pino-options.ts:16-22,39`; `platform/http/error.filter.ts:25` |
| 16, 17 | Trùng | Review 1.3 nhắc lại ba mục trên | Trùng các mục dòng 4, 7, 10 (đã xử lý) |
| 21 | Story nhận | e2e "Không đồng ý khi session đã hết" lỗi lẻ | E2-8 (test chập chờn) |
| 33 | AC 9.1 | `TRUST_PROXY_HOPS` + kiểm sau deploy | Đã có AC 9.1 (E4-7) |
| 40, 43 | Story nhận | SSR gọi api qua URL nội bộ; Google OAuth bỏ Testing, redirect URI | 9.1 |
| 46 | Story nhận | Smoke đăng nhập Google ở staging; báo lỗi khi `/me` 401 | 9.1 (smoke); phần báo lỗi ở `google-return.tsx:25` xét theo kết quả smoke |
| 50 | Story nhận | ≥ 1 worker; cảnh báo `identity.purge-expired` lỗi | 9.1 (worker, đã có AC); phần cảnh báo → E4-10 (`defineCronQueue` kèm dead-letter) |
| 54 | Story nhận | Gom IPv6 theo /64 cho giới hạn OTP/Google | E4-4 (nhóm giới hạn tốc độ trước Closed Beta) |
| 57 | Đã xử lý | Story 2.1 phần B khung dashboard | `spec-2-1-b-khung-dashboard-responsive.md`; `components/tickee/dashboard-shell.tsx` |
| 61 | Chấp nhận | Test cách ly bằng tài nguyên thật của BTC B | Đã có test IDOR theo handler (`events.test.ts:302`, `ticket-types.test.ts:171`) |
| 64 | Story nhận | `POST /v1/orgs` thiếu rate limit + idempotency | E4-4 (nhóm giới hạn tốc độ) |
| 67 | Story nhận | PermissionGuard cho `/v1/checkin/events/:eventId` | 5.1 |
| 71 | Chấp nhận | Đổi BTC làm khung dashboard unmount | Chỉ nháy UI |
| 75 | Story nhận | `viewportFit: 'cover'` cho safe-area | 5.3 (màn quét trên điện thoại) |
| 78 | Nợ nhỏ | Chưa có Prettier và bước kiểm định dạng CI | — |
| 84 | Chấp nhận | "Cài đặt" gắn `org.read`, thiếu quyền sửa BTC | Backlog không có story sửa BTC |
| 88 | Nợ nhỏ | Tách `login-form.tsx` thành hook (AI-5 phần web) | — |
| 92 | Chấp nhận | `signInWithCode` đua, lệch số lượt còn lại | Chỉ lệch số hiển thị |
| 96 | Trùng | Story 2.2B đặt lại TOTP ở `/admin` | Trùng dòng 133 → 7.7 |
| 102 | Nợ nhỏ | Test `TotpAttemptLimiter.restore` khi lỗi hệ thống | — |
| 106 | Đã xử lý | Test step-up rồi gửi lại mutation | `apps/web/e2e/members.spec.ts:190`; `apps/api/test/organizer/members.test.ts:205` |
| 110 | Chấp nhận | CSP phải cho phép `THEME_SCRIPT` inline | Chưa có CSP, không story nào thêm |
| 114 | Story nhận | Đăng nhập tài khoản khác vẫn giữ cache memberships cũ | 5.2 (CTV đăng nhập qua link mời) |
| 120 | Story nhận | Giới hạn mời Admin theo tài khoản/người nhận; số BTC mỗi tài khoản | E4-4 (nhóm giới hạn tốc độ) |
| 124 | Story nhận | `organization_invitations` giữ email mãi | 7.6 |
| 133 | Story nhận | Đặt lại TOTP ở `/admin` | 7.7 |
| 140 | Story nhận | `StatusNotice` thiếu id đối tượng trong khóa đóng | 7.1 (notice Sự kiện đã hủy; `notices.service.ts:146` đã `dismissible`) |
| 143 | Chấp nhận | `GET /v1/admin/organizations` chưa phân trang | Closed Beta ít BTC |
| 146 | Chấp nhận + Story nhận | CLI thiếu `admin:list`; README chạy `admin-cli.js` trong image | `admin:list`: chấp nhận (SQL qua migrator đủ dùng). README → 9.1 |
| 150 | Nợ nhỏ | `bootLog.fatal({ err })` ở `main.ts:83` log nguyên lỗi | Phần worker mời Admin đã xong (`invitation-jobs.ts:112`) |
| 156 | Story nhận | VA Tingee lệch DB khi timeout | E3-3 |
| 162 | Nợ nhỏ | `tingee:fake` chưa có bước build trong CI | — |
| 168 | Trùng | Hai BTC chung merchant, IPN đổ nhầm | Trùng dòng 417 → E4-2 |
| 171 | Đã xử lý | Key thiếu quyền Cổng thanh toán → `TINGEE_CREDENTIAL_INVALID` | Story 3.4; `modules/tingee/errors.ts:18-19` (1133) |
| 174, 190 | Story nhận | `get-va-paging` trả null; `vaAccountNumber` có thể là số gốc | E3-3 |
| 193 | Đã xử lý | URL IPN 404 trước Epic 3 | Story 3.5; `api.module.ts:78` |
| 197 | Đã xử lý | Story 2.7-b ảnh Sự kiện/S3 | Story 4.8; `event/schema.ts:54` (`image_key`) |
| 203 | Trùng + Story nhận | `EventService.update` không xét status/khóa | Phần hủy đã chặn (`event.service.ts:54`); phần sau mở bán trùng dòng 327 (đã xử lý); phần BTC bị khóa → 7.4 |
| 206, 227, 246 | Đã xử lý | `publicBySlug` theo trạng thái; `ordering.sellability`; export `sale-rules` | Story 2.11; `event/public-event.ts:12`; `modules/ordering/index.ts:64`; `event/index.ts:35` |
| 209 | Chấp nhận | Trường dựng sẵn FR-9 | Ngoài MVP (Mason, `sprint-change-proposal-2026-11-09-doi-chieu-spec.md`) |
| 215 | Nợ nhỏ | e2e 400 `VALIDATION_FAILED` form Hạng vé | Sửa khi triển khai (trước ghi "Đã xử lý"): `ticket-types.spec.ts:126,135` chỉ là API giả từ chối input mà web đã chặn, chưa ca nào nhận 400 từ input hợp lệ |
| 221 | Nợ nhỏ | Test id câu hỏi/phương án viết hoa | — |
| 233 | Trùng | Phần còn lại: sửa Sự kiện/form sau mở bán | Trùng dòng 327 (đã xử lý) |
| 237 | Story nhận | Link công khai dựng từ `window.location.origin` | 9.1 |
| 240, 277, 281 | Story nhận | Stub `organizationLocked()`; đổi tên/khóa BTC enqueue revalidate; Ẩn/Hiện/Kết thúc xét khóa | 7.4 |
| 252, 258 | Đã xử lý | Story 2.11-b trang `/e/{slug}`; 2.11-c revalidate | `spec-2-11-b-…`, `spec-2-11-c-…` |
| 266 | AC 9.1 + Story nhận | Font OG trong image; `API_INTERNAL_URL` | Font OG: đã có AC 9.1 (E4-7). `API_INTERNAL_URL` → 9.1 |
| 271 | Story nhận | cacheHandler chung nhiều instance web; `REVALIDATE_SECRET`; worker tới được web | 9.1 |
| 274 | AC 9.1 | CDN giữ bản cũ `/e/{slug}` | Đã có AC 9.1 (E4-7) |

## Dòng 284–540

| Dòng | Loại | Mục | Ghi |
|---|---|---|---|
| 286 | Story nhận | Sự kiện `cancelled` vẫn sửa được Hạng vé, form, giới hạn Đơn | 7.1 |
| 288, 298 | Đã xử lý | Luồng đổi key Tingee; cảnh báo khi chọn tài khoản đầu tiên sau đổi key | Story 2.13-b; `payout-account.controller.ts:44-69`; `payout-account.service.ts:556-557` |
| 292 | Story nhận | Mã TOTP dùng lại được trong cửa sổ 30 giây | 7.7 |
| 295 | Chấp nhận | Xóa Admin không đòi xác nhận lại | Cần đổi danh sách thao tác nhạy cảm trong AD. **Mason xem kỹ** (bảo mật) |
| 301, 317, 336 | Nợ nhỏ | Email khuyên "đăng xuất mọi thiết bị" khi chưa có; dialog tắt 2FA không báo; đăng xuất lỗi không báo | Sửa câu chữ / thêm `onError` |
| 304 | Story nhận | Route nhận key Tingee không giới hạn tần suất | E4-4 (nhóm giới hạn tốc độ) |
| 313 | Story nhận | Không có đường khôi phục khi người khác bật 2FA | 7.7 |
| 321 | Trùng | Sự kiện đã hủy vẫn sửa được Hạng vé | Trùng dòng 286 → 7.1 |
| 324, 327 | Đã xử lý | Hạng vé 0đ trong Sự kiện hỗn hợp; sửa sau mở bán | Spec 3.3 (`place-order.ts:206`); bản chụp ở `ordering/schema.ts:119,223` (E2-6, 3.2) và email 3.10 |
| 347 | Story nhận | Giới hạn theo IP cho funnel-events | E4-4 |
| 350 | Đã xử lý | Nút "Mua" kẹt `pending` sau redirect | `e/[slug]/ticket-tiers.tsx:97` (`useTransition`), có e2e hồi quy |
| 356 | Đã xử lý | Dọn `order_create_attempts` | Story 4.6-c; `ordering/safety-net-jobs.ts:117-122,231`; `test/ordering/safety-net.test.ts:384` |
| 362, 365 | Story nhận | TX1 thiếu `lock_timeout`; `FOR SHARE` làm `FOR UPDATE` chờ | 9.2 |
| 375 | Story nhận | Runbook xoay khóa QR (phần còn lại) | 9.1 |
| 407, 411 | Nợ nhỏ | Truy vấn tên BTC lặp ở ba job; thiếu test `dedupeBy`/`parallel` | — |
| 417 | Story nhận | Chặn hai BTC chung merchant | E4-2 |
| 423 | Story nhận | IPN `status` khác chữ thường | E3-3 |
| 429 | Đã xử lý | Cảnh báo vận hành cho `payment_unmatched` | Story 4.6; `payment/ipn-processor.ts:266-268`; `platform/alerts/kinds.ts:11` |
| 439 | Chấp nhận | Full-stack chưa kiểm tab ở nền | e2e giả lập đã phủ (`apps/web/e2e/live-mock.ts`) |
| 454 | Story nhận | Trang Đơn im lặng khi lỗi không phải lỗi mạng | 7.1 (cùng chạm Trang Đơn) |
| 462 | Story nhận | Báo Người mua khi Đơn vào `review` vì lý do khác `sold_out` | 7.1, chưa quyết: 7.1 chốt có báo hay không (retro C4) |
| 469 | Story nhận | Không giới hạn số lượt email đổi giờ/địa điểm | E3-8 |
| 483 | Đã xử lý | Đóng mục Cần xử lý phát `event_orders_changed` | Story 4.4; `payment/review-actions.ts:417-421`; `test/payment/review-actions.test.ts:602,665` |
| 489 | Chấp nhận | `overview` hai câu độc lập lệch một Đơn | Đã chấp nhận ở 3.11; tín hiệu tải lại tự sửa (AD-17) |
| 513, 534 | Story nhận | Test giả `Date` cho `endedNow`; test ghim `dbClock` của `markPaid` | E4-10 |
| 528 | Chấp nhận | Helper `buyerScope` | Mason hoãn ở E3-7 (12/11/2026) |
| 537 | Trùng | Test giả `Date` cho `endedNow` | Trùng dòng 513 → E4-10 |

## Dòng 541–746

| Dòng | Loại | Mục | Ghi |
|---|---|---|---|
| 555 | Đã xử lý (phần 4.4) | C6: ghi `orders.status` phát tín hiệu cùng transaction | Phần 4.4: `ordering/order-review.ts:63,92`, `payment/review-actions.ts:285,420`. Phần 7.1/7.2/7.5 giữ nguyên |
| 558, 561, 564, 609, 676 | Story nhận | NOTIFY tuần tự; email đổi giờ tuần tự; p95 create-link; tải tra trạng thái; `reconcilableOrderIdsOf` quét bảng | 9.2 (thay nhãn "5.8") |
| 567 | Story nhận | A2 giữ chỗ hàng loạt | E4-6 (chặn); cảnh báo trùng dòng 770; đo → 9.2 |
| 570, 695 | AC 9.1 | Edge HTTP/2 cho SSE | Đã có AC 9.1 (E4-7) |
| 581 | Trùng | Runbook ký lại khi xoay khóa QR (phần 2) | Trùng dòng 375 → 9.1 |
| 583 | Đã xử lý | Cảnh báo `ticket_qr_key_missing`, gộp trùng | Story 4.6; `ticketing/tickets.service.ts:205-213`; `platform/alerts/kinds.ts:93-98` |
| 586 | Chấp nhận | Phần 4.6: marker cho Chi tiết Vé, Trang Đơn, email, "Tạo lại link" | 4.7-g đã kiểm khóa lúc khởi động |
| 593 | Chấp nhận | Hai nhánh story xung đột `last_updated` của sprint-status | Gỡ tay, giữ giá trị mới hơn |
| 602, 606, 616, 659, 662, 734 | Story nhận | Hợp đồng tạm API tra đơn, dò dịch vụ, Token; mã 1133, 1033, 402 | Action item "Chốt với Tingee" |
| 612 | Đã xử lý (phần cảnh báo) + Story nhận | Phần 4.6: cảnh báo và lệnh tra lại tay | Cảnh báo: `payment/reconciliation-worker.ts:282-290`, `kinds.ts:86-92`. Lệnh tra tay → E4-1 |
| 631, 634 | Story nhận | Test chốt link/`checkoutUrl` theo đồng hồ DB; `ended_manually_at` dùng giờ app | E4-10 |
| 640 | Story nhận | Thẻ Đơn ở "Vé của tôi" vẫn mời thanh toán khi Sự kiện kết thúc | 7.1 |
| 679 | Chấp nhận | Danh sách BTC bị ngắt không phân trang; job dò không ngân sách thời gian | Closed Beta ít BTC; CAS `checked_at` chặn gọi trùng |
| 707, 710 | Chấp nhận | Hàng Cần xử lý không phân trang; `onSignal` tải lại thừa | Chỉ cần khi một BTC có hàng trăm mục; đã gom 1 giây |
| 713 | Đã xử lý | 4.4-b "Ghép với Đơn" | `spec-4-4-b-ghep-voi-don.md`; `payment/review-actions.controller.ts:102` |
| 722 | Story nhận | Đối soát bù ngừng tra Đơn đã Ghép hoặc đang review | E4-1 |
| 728 | Đã xử lý | 4.5-b "Cảnh báo Token" | `spec-4-5-b-canh-bao-token.md`; `organizer/token-alert.ts:22-34` |
| 744 | Story nhận | Test `ipn-dev-checkout` thỉnh thoảng trả 500 | E2-8 (test chập chờn) |

## Dòng 747–993

| Dòng | Loại | Mục | Ghi |
|---|---|---|---|
| 749, 752, 755, 767 | Đã xử lý | Tách phạm vi 4.6: b kênh cảnh báo, c lưới an toàn, d dead-letter, e luật NFR-10 | `spec-4-6-b/c/d/e-….md`; `ops-alert-scan.ts:22`, `safety-net-jobs.ts:66`, `dead-letter.controller.ts:22`, `kinds.ts:37-47` |
| 761, 788, 843, 960 | Nợ nhỏ | Test: `startTelemetry` lỗi; snapshot REPEATABLE READ; e2e upload sau `TOTP_REQUIRED`; `statement_timeout` của TicketQrKeyCheck | — |
| 770 | Story nhận | Cảnh báo giữ chỗ hàng loạt | E4-6 |
| 776 | Story nhận | Luật báo job `failed` ở queue không có dead-letter | E4-10 (`defineCronQueue` kèm dead-letter); gồm cả `event.revalidate-public-page` |
| 782 | Đã xử lý | Thu hẹp 4.6-e, bỏ `pending_order_overdue` | Đã làm ở 4.6-c (`kinds.ts:27`) |
| 794 | Story nhận | Cảnh báo `create-link` lỗi nhanh | E3-3 (mã lỗi thật để đặt ngưỡng) |
| 797, 809 | Story nhận | Deploy worker trước api khi thêm loại cảnh báo; dọn object ảnh cũ/mồ côi | 9.1 |
| 803 | Đã xử lý | Story 4.8-b ảnh Sự kiện trên web | `spec-4-8-b-anh-su-kien-tren-web.md` |
| 806 | Story nhận | Thumbnail ảnh Sự kiện ở "Vé của tôi" | 8.1 |
| 812 | Story nhận | Resize ảnh + CDN | 9.2 đo; resize sau MVP |
| 815, 834, 947 | AC 9.1 | Bucket ảnh; deploy api trước web; `instrumentation.ts` standalone | Đã có AC 9.1 (E4-7) |
| 821 | Chấp nhận | Image MinIO fork pgsty | Chỉ dùng local, đã ghim tag |
| 840, 966, 969 | Story nhận | og:image URL cố định; audit/Dependabot; tắt `/_next/image` | E4-4. Dependabot: **Mason chốt chính sách** |
| 895 | Story nhận | Khóa advisory giữ kết nối pool | 9.1 (giới hạn ở edge) + 9.2 (đo) |
| 911, 914, 991 | Story nhận | Cache `ms-playwright` trong CI; hạ timeout job ci; kiểm concurrency khi merge chồng | E2-8 |
| 928 | Đã xử lý + AC 9.1 | `WEB_ORIGIN` bắt buộc; font OG | `WEB_ORIGIN`: `apps/web/lib/production-env.ts:99-100` (4.7-f). Font OG: đã có AC 9.1 |
| 944 | Nợ nhỏ | `REVALIDATE_SECRET` có khoảng trắng → mọi revalidate 401 | Trim ở `production-env.ts:121` |
| 985 | Story nhận | Comment cũ "mỗi lần xem một lần đọc" (Token) | E4-10 (cùng tách `contracts/organizer.ts`) |

## Mục mới (chưa có trong file)

Thêm phần `## Deferred from: sprint change proposal 2026-11-21 (E4-7), ngoài phạm vi` ở cuối file:

| Mục | Story nhận |
|---|---|
| F1: hai import sâu bỏ qua `index.ts` trong `platform` (`telemetry/span-redaction.ts`); chưa có test so khớp `module-graph.cjs` với sơ đồ spine | Nợ nhỏ |
| F2: `dedupeKey` trong `packages/contracts/src/notifications.ts:54` không ai đọc | Nợ nhỏ |
| F4: quy ước phân trang `cursor` + `limit` (spine `:417`) chưa có chỗ dùng | 6.1 (danh sách Đơn đầy đủ là danh sách lớn đầu tiên) |
