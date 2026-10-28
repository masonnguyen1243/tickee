# Review — epics.md (2026-10-28)

Nội dung: `_bmad-output/planning-artifacts/epics.md` (docs, định nghĩa hành vi). Lens: adversarial, edge-case-hunter, structure, prose (sau structure). Bỏ verification-gap (chỉ áp dụng cho code).

## Findings JSON (adversarial + edge-case-hunter)

```json
[
{"lens":"adversarial","location":"Story 3.6 + Story 7.1","trigger_condition":"IPN success cho Đơn cancelled của Sự kiện đã hủy khớp cả nhánh duplicate_payment lẫn nhánh event_cancelled→review; AD-3 không có cancelled→review","guard_snippet":"Kiểm 'Sự kiện đã hủy' trước; chỉ tạo review_item event_cancelled, giữ Đơn cancelled; cập nhật AD-3","potential_consequence":"CAS thất bại → tiền về không có review_item, hoặc sai loại → lọt danh sách hoàn tiền 7.2"},
{"lens":"adversarial","location":"Story 3.6 (merchantId lệch)","trigger_condition":"Chỉ lưu event + log, không review_item, không nói mã trả Tingee","guard_snippet":"review_item unmatched gắn BTC sở hữu Merchant con; định nghĩa response (00/lỗi); cảnh báo vận hành","potential_consequence":"Tiền vào tài khoản BTC mà không ai biết; Tingee retry vô hạn"},
{"lens":"adversarial","location":"Story 3.9","trigger_condition":"Đồng hồ về 0 → 'Hết hạn', mâu thuẫn AD-4/UX-DR17","guard_snippet":"Về 0 → 'Đang xác nhận thanh toán'; chỉ 'Hết hạn' khi API trả expired","potential_consequence":"Người mua chuyển tiền lần hai"},
{"lens":"adversarial","location":"Story 3.7","trigger_condition":"Thiếu buyerStatus event_cancelled và cancelled_by_organizer","guard_snippet":"Thêm AC cho hai trạng thái + fallback cho giá trị lạ","potential_consequence":"/orders/:code kẹt màn chờ hoặc vỡ"},
{"lens":"adversarial","location":"Story 7.4","trigger_condition":"Khóa → sellability 'Tạm ngừng bán' thay vì eventReason 'Bị khóa' (2.10/UX-DR13)","guard_snippet":"eventReason='Bị khóa', banner 'Sự kiện tạm thời không nhận Đơn.'","potential_consequence":"Banner sai lý do, Owner mua Token vô ích"},
{"lens":"adversarial","location":"FR-21 / Story 4.4","trigger_condition":"Không story nào cài thao tác 'ghép tay' giao dịch unmatched với Đơn","guard_snippet":"Thêm AC 'Ghép với Đơn' qua markPaid(source=manual), hoặc ghi rõ đã cắt + sửa Coverage Map","potential_consequence":"FR-21 báo đã phủ nhưng thiếu; người mua chỉ được hoàn tiền"},
{"lens":"adversarial","location":"Story 7.6 / FR-2","trigger_condition":"Chặn Owner xóa tài khoản bằng 'Chuyển quyền Owner trước' nhưng không có story chuyển quyền","guard_snippet":"Thêm story chuyển quyền Owner (step-up TOTP, audit, 1 transaction)","potential_consequence":"Owner không thực hiện được quyền xóa theo NĐ 13"},
{"lens":"adversarial","location":"Story 2.2","trigger_condition":"Không recovery code/reset TOTP; không miễn trừ endpoint enroll/logout khỏi TOTP_REQUIRED","guard_snippet":"Recovery codes (hash) + quy trình reset có audit; liệt kê endpoint miễn step-up","potential_consequence":"Owner bị khóa vĩnh viễn; Owner mới không enroll được"},
{"lens":"adversarial","location":"Phụ thuộc epic","trigger_condition":"'E5–E8 chỉ dựa trên E1–E3' sai: 7.2→4.4/6.3, 7.1→4.1, 7.4→notices E4, 6.5→E4","guard_snippet":"Sửa: E7→E4,E6; E6→E4","potential_consequence":"Sprint planning xếp sai thứ tự, dev bị chặn"},
{"lens":"adversarial","location":"Story 4.1, 4.5","trigger_condition":"API tra trạng thái và API Token của Tingee còn là câu hỏi mở nhưng AC coi như có","guard_snippet":"Spike/hợp đồng Tingee làm DoR; ghi phương án dự phòng","potential_consequence":"FR-20 và tiêu chí Phase 1 phụ thuộc API có thể không có"},
{"lens":"adversarial","location":"Story 3.8","trigger_condition":"Tạo lại link không thu hồi QR tĩnh đã bị chụp","guard_snippet":"Ghi rõ giới hạn trên UI, hoặc thêm qr_version vào chữ ký","potential_consequence":"Người khác vào cổng bằng Vé 'đã thu hồi'"},
{"lens":"adversarial","location":"Story 7.5","trigger_condition":"Vé voided nhưng Đơn paid: không vào danh sách hoàn tiền, vẫn tính doanh thu; phạm vi khi khóa BTC không rõ","guard_snippet":"Nêu phạm vi voidTickets; đưa vào danh sách hoàn tiền, loại khỏi doanh thu","potential_consequence":"Người mua không được hoàn; doanh thu ảo"},
{"lens":"adversarial","location":"Story 7.6","trigger_condition":"anonymize_user không enqueue sheet_row_changed","guard_snippet":"Enqueue cho mọi Đơn bị ẩn danh có Sheet; ghi đè cột PII","potential_consequence":"PII còn trong Google Sheet — vi phạm FR-38/NĐ 13"},
{"lens":"adversarial","location":"Story 2.6","trigger_condition":"Không có luồng đổi/hủy liên kết tài khoản nhận tiền","guard_snippet":"Story đổi tài khoản (step-up TOTP, audit, Đơn mở giữ merchant cũ, email cảnh báo Admin)","potential_consequence":"Phải sửa DB tay; không audit khi tài khoản bị chiếm"},
{"lens":"adversarial","location":"Story 2.5","trigger_condition":"Không mô tả cách cấp/thu hồi platform_admin và cấu hình IP","guard_snippet":"CLI/migrate cấp theo email có audit; IP allowlist trong config Zod","potential_consequence":"Không ai duyệt Closed Beta, hoặc cấp bằng SQL tay"},
{"lens":"adversarial","location":"Story 3.2","trigger_condition":"Không định nghĩa UX khi đã có Đơn pending và tạo Đơn mới; không tự hủy Đơn","guard_snippet":"409 PENDING_ORDER_EXISTS → chuyển tới Đơn đang có; cân nhắc 'Hủy Đơn này'","potential_consequence":"Bỏ mua lúc mở bán đông, giảm SM-C2"},
{"lens":"adversarial","location":"Story 3.5","trigger_condition":"'IPN công khai với guard người dùng' đọc ngược nghĩa; không nhắc raw body parser","guard_snippet":"@Public, raw body parser riêng route, test giữ nguyên byte","potential_consequence":"IPN 401 hoặc chữ ký luôn sai"},
{"lens":"adversarial","location":"FR-23 / 3.8 vs FR-36 / 8.2","trigger_condition":"Dòng giới thiệu Tickee trong email là Must ở FR-23 nhưng chỉ cài ở Story 8.2 (cắt được)","guard_snippet":"Bỏ khỏi FR-23 hoặc thêm AC vào 3.8","potential_consequence":"Cắt E8 làm FR-23 trượt nghiệm thu"},
{"lens":"edge-case-hunter","location":"epics.md:933-998","trigger_condition":"IPN success tới khi Đơn đang ở trạng thái review","guard_snippet":"case order.status==='review': createReviewItem('duplicate_payment'|'additional_payment'); no markPaid","potential_consequence":"Khoản tiền thứ hai không có nhánh xử lý"},
{"lens":"edge-case-hunter","location":"epics.md:979-985","trigger_condition":"IPN cho Đơn cancelled thuộc Sự kiện đã hủy khớp cả hai nhánh","guard_snippet":"if event cancelled -> review_item event_cancelled (no status change); else duplicate_payment","potential_consequence":"Loại mục sai; phá máy trạng thái"},
{"lens":"edge-case-hunter","location":"epics.md:991-993","trigger_condition":"IPN merchantId lệch: chỉ lưu event","guard_snippet":"createReviewItem(unmatched, resolveOrgByMerchant) + alert","potential_consequence":"Tiền về không ai thấy"},
{"lens":"edge-case-hunter","location":"epics.md:987-989","trigger_condition":"orderId không tồn tại và merchantId không ứng với BTC nào","guard_snippet":"store payment_event + platform-level alert queue","potential_consequence":"review_items.organization_id NOT NULL → không tạo được mục, tiền lạc"},
{"lens":"edge-case-hunter","location":"epics.md:995-997","trigger_condition":"Thanh toán trùng lần hai khi đã có duplicate_payment open","guard_snippet":"unique (order_id, type, payment_event_id)","potential_consequence":"Khoản trùng thứ hai bị nuốt"},
{"lens":"edge-case-hunter","location":"epics.md:974-977","trigger_condition":"Tiền về muộn cho Đơn expired nhiều Hạng vé, chỉ một số còn chỗ","guard_snippet":"sell all tiers theo id; 0 rows → rollback → review orphan","potential_consequence":"Phát Vé một phần"},
{"lens":"edge-case-hunter","location":"epics.md:974-977","trigger_condition":"Tiền về muộn nhưng số tiền lệch","guard_snippet":"check amount trước nhánh late-sell","potential_consequence":"Phát Vé khi tiền thiếu"},
{"lens":"edge-case-hunter","location":"epics.md:974-977","trigger_condition":"Tiền về muộn khi Sự kiện đã kết thúc/khóa/ẩn","guard_snippet":"effective_end_at<now → review orphan; định nghĩa lock/hidden","potential_consequence":"Phát Vé vô dụng"},
{"lens":"edge-case-hunter","location":"epics.md:946-948","trigger_condition":"IPN success cho Đơn pending sau khi Sự kiện kết thúc sớm","guard_snippet":"markPaid: now>effective_end_at → review item","potential_consequence":"Vé không dùng được, không vào hàng hoàn tiền"},
{"lens":"edge-case-hunter","location":"epics.md:954-956","trigger_condition":"IPN canceled/expired cho Đơn không pending","guard_snippet":"store event, no-op","potential_consequence":"Có thể ghi đè Đơn paid"},
{"lens":"edge-case-hunter","location":"epics.md:904","trigger_condition":"TX2 chạy sau khi job 60s đã expire Đơn","guard_snippet":"0 rows → ORDER_EXPIRED, không trả checkout URL","potential_consequence":"Link Tingee mồ côi"},
{"lens":"edge-case-hunter","location":"epics.md:856-858","trigger_condition":"Job 60s chạy khi Đơn đã có link, expires_at đã lùi","guard_snippet":"WHERE status='pending' AND payment_link IS NULL AND expires_at<now()","potential_consequence":"Hết hạn nhầm Đơn đang thanh toán"},
{"lens":"edge-case-hunter","location":"epics.md:1145-1147","trigger_condition":"Đơn expired, IPN mất, khách trả muộn","guard_snippet":"tiếp tục đối soát N lần sau expired cho Đơn từng có link","potential_consequence":"Tiền về muộn không bao giờ phát hiện"},
{"lens":"edge-case-hunter","location":"epics.md:1145-1147","trigger_condition":"Tra Gateway lỗi lặp mãi","guard_snippet":"backoff maxAttempts + alert","potential_consequence":"Job lặp vô hạn"},
{"lens":"edge-case-hunter","location":"epics.md:854","trigger_condition":"Đã có Đơn pending, gửi Đơn mới","guard_snippet":"409 PENDING_ORDER_EXISTS → redirect","potential_consequence":"500 hoặc thông báo mơ hồ"},
{"lens":"edge-case-hunter","location":"epics.md:841-845","trigger_condition":"Số lượng 0, âm, vượt giới hạn Vé/Đơn","guard_snippet":"zod qty int>=1, sum<=max_tickets_per_order, lines>=1","potential_consequence":"Đơn rỗng hoặc vượt giới hạn"},
{"lens":"edge-case-hunter","location":"epics.md:679-685","trigger_condition":"Sự kiện có phí có Hạng vé 0đ","guard_snippet":"cấm giá 0 khi có hạng trả phí, hoặc định nghĩa route + trần","potential_consequence":"Vé 0đ không bị trần 200"},
{"lens":"edge-case-hunter","location":"epics.md:683-689","trigger_condition":"Tăng suất/đổi giá làm Sự kiện miễn phí vượt 200","guard_snippet":"lock FOR UPDATE, assert sum(capacity)<=200","potential_consequence":"Vượt trần FR-11"},
{"lens":"edge-case-hunter","location":"epics.md:666-694","trigger_condition":"Xóa/đổi giá Hạng vé đã có Vé bán/giữ","guard_snippet":"reject delete nếu sold+held>0; giá mới chỉ áp Đơn mới","potential_consequence":"Tồn kho lệch, tham chiếu hỏng"},
{"lens":"edge-case-hunter","location":"epics.md:653-656","trigger_condition":"Giờ kết thúc < bắt đầu, cửa sổ bán ngược","guard_snippet":"zod refine end>start, close>open, close<=effective_end_at","potential_consequence":"effective_end_at sai"},
{"lens":"edge-case-hunter","location":"epics.md:725-735","trigger_condition":"Mở bán khi chưa có Hạng vé hoặc giờ bắt đầu đã qua","guard_snippet":"publishReadiness thêm HAS_TICKET_TYPE, START_IN_FUTURE","potential_consequence":"Trang mở bán nhưng không mua được"},
{"lens":"edge-case-hunter","location":"epics.md:793-795","trigger_condition":"Bấm Kết thúc khi chưa bắt đầu hoặc còn Đơn pending","guard_snippet":"định nghĩa cửa sổ cho phép; xử lý Đơn pending","potential_consequence":"Phát Vé sau kết thúc"},
{"lens":"edge-case-hunter","location":"epics.md:1847-1849","trigger_condition":"Không có story chuyển quyền Owner","guard_snippet":"flows.transferOwnership với TOTP step-up","potential_consequence":"Owner không xóa được tài khoản"},
{"lens":"edge-case-hunter","location":"epics.md:1847-1858","trigger_condition":"Xóa tài khoản khi còn Đơn review/chờ hoàn tiền","guard_snippet":"chặn hoặc giữ liên hệ để hoàn tiền","potential_consequence":"BTC không liên hệ hoàn tiền được"},
{"lens":"edge-case-hunter","location":"epics.md:1843-1853","trigger_condition":"Rút lại đồng ý thay vì xóa","guard_snippet":"định nghĩa flows.withdrawConsent","potential_consequence":"Hành vi không xác định"},
{"lens":"edge-case-hunter","location":"epics.md:1860-1862","trigger_condition":"Đăng nhập lại cùng email sau xóa","guard_snippet":"ẩn danh users.email, unlink Google","potential_consequence":"Trùng unique hoặc nối nhầm tài khoản cũ"},
{"lens":"edge-case-hunter","location":"epics.md:1855-1858","trigger_condition":"Ẩn danh khi Sự kiện có Google Sheets","guard_snippet":"enqueue sheet_row_changed","potential_consequence":"PII còn trong Sheet"},
{"lens":"edge-case-hunter","location":"epics.md:424-427","trigger_condition":"Gửi OTP liên tục cho một email","guard_snippet":"rate limit theo email + IP","potential_consequence":"Spam; 5 lần sai mỗi mã vô hiệu chống dò"},
{"lens":"edge-case-hunter","location":"epics.md:424-440","trigger_condition":"Tạo tài khoản lúc gửi mã; từ chối NĐ 13","guard_snippet":"tạo user sau verify; định nghĩa nhánh từ chối","potential_consequence":"Tài khoản rác; nhánh từ chối không rõ"},
{"lens":"edge-case-hunter","location":"epics.md:468-471","trigger_condition":"Email Google chưa xác minh trùng email OTP","guard_snippet":"chỉ link khi email_verified===true","potential_consequence":"Chiếm tài khoản"},
{"lens":"edge-case-hunter","location":"epics.md:518-525","trigger_condition":"Mất thiết bị TOTP hoặc nhập sai liên tục","guard_snippet":"backup codes + rate limit + recovery","potential_consequence":"Khóa vĩnh viễn hoặc dò TOTP"},
{"lens":"edge-case-hunter","location":"epics.md:489-491","trigger_condition":"Đã thuộc một BTC muốn tạo BTC thứ hai","guard_snippet":"'Tạo BTC mới' trong switcher","potential_consequence":"FR-2 không có đường tạo"},
{"lens":"edge-case-hunter","location":"epics.md:560-568","trigger_condition":"Mời email đã là thành viên/Owner/đã có lời mời","guard_snippet":"reject nếu đã là thành viên; thay lời mời cũ","potential_consequence":"Lời mời trùng, Owner bị hạ"},
{"lens":"edge-case-hunter","location":"epics.md:602-604","trigger_condition":"Duyệt lại BTC bị thu hồi; Đơn pending lúc thu hồi","guard_snippet":"cho revoked→approved; xử lý Đơn pending","potential_consequence":"Không có đường khôi phục"},
{"lens":"edge-case-hunter","location":"epics.md:606-635","trigger_condition":"Đổi tài khoản nhận tiền khi còn Đơn pending","guard_snippet":"giữ sub_merchant cũ cho Đơn cũ; chặn khi pending","potential_consequence":"IPN Đơn cũ bị từ chối"},
{"lens":"edge-case-hunter","location":"epics.md:1170-1172","trigger_condition":"MERCHANT_SUSPENDED không rõ lý do","guard_snippet":"map reason; mặc định tingee_disabled","potential_consequence":"Banner/hành động sai"},
{"lens":"edge-case-hunter","location":"epics.md:1255-1261","trigger_condition":"Chưa đặt ngưỡng Token; Token lên rồi xuống lại","guard_snippet":"threshold null → mặc định; reset dedupe khi >= ngưỡng","potential_consequence":"Không cảnh báo hoặc lặp"},
{"lens":"edge-case-hunter","location":"epics.md:1234-1236","trigger_condition":"Đã hoàn tay cho duplicate_payment của Đơn paid","guard_snippet":"chỉ resolve review_item, Đơn giữ paid","potential_consequence":"Đơn paid thành refunded sai"},
{"lens":"edge-case-hunter","location":"epics.md:1221-1224","trigger_condition":"Duyệt tay phát Vé khi Sự kiện đã hủy/kết thúc","guard_snippet":"reject manual approve","potential_consequence":"Phát Vé cho Sự kiện không diễn ra"},
{"lens":"edge-case-hunter","location":"epics.md:1720-1722","trigger_condition":"Hủy Sự kiện khi có Đơn review","guard_snippet":"giữ review, gắn event_cancelled, đưa vào danh sách hoàn","potential_consequence":"Bỏ sót trong danh sách hoàn tiền"},
{"lens":"edge-case-hunter","location":"epics.md:1716-1718","trigger_condition":"Hủy Sự kiện draft hoặc đã kết thúc","guard_snippet":"định nghĩa rõ cho phép/chặn","potential_consequence":"Nhánh không có hành vi"},
{"lens":"edge-case-hunter","location":"epics.md:1821-1833","trigger_condition":"Vé vô hiệu nhưng Sự kiện không hủy","guard_snippet":"cancel_reason=voided, đưa vào danh sách hoàn","potential_consequence":"Không có danh sách hoàn tiền"},
{"lens":"edge-case-hunter","location":"epics.md:1799-1801","trigger_condition":"Khóa: sellability trả 'Tạm ngừng bán'","guard_snippet":"eventReason='Bị khóa'","potential_consequence":"Banner sai"},
{"lens":"edge-case-hunter","location":"epics.md:1017-1020","trigger_condition":"buyerStatus event_cancelled/cancelled/refunded trên /orders/:code","guard_snippet":"map mọi giá trị enum + fallback","potential_consequence":"Màn trống hoặc lỗi"},
{"lens":"edge-case-hunter","location":"epics.md:1072-1074","trigger_condition":"order-card về 0 trong cửa sổ +5 phút","guard_snippet":"hiện 'Đang xác nhận'; 'Hết hạn' chỉ khi API expired","potential_consequence":"Người mua chuyển tiền lại"},
{"lens":"edge-case-hunter","location":"epics.md:1410-1412","trigger_condition":"Mã quét sai định dạng hoặc k không tồn tại","guard_snippet":"BAD_SIGNATURE, không query DB","potential_consequence":"500 thay vì đỏ"},
{"lens":"edge-case-hunter","location":"epics.md:1700-1702","trigger_condition":"Kết nối lại tạo Sheet mới","guard_snippet":"full resync","potential_consequence":"Sheet mới thiếu Đơn cũ"},
{"lens":"edge-case-hunter","location":"epics.md:872-874","trigger_condition":"Một người gửi nhiều Đơn miễn phí liên tiếp","guard_snippet":"trần Vé miễn phí mỗi người/Sự kiện","potential_consequence":"Một người chiếm hết 200 Vé"}
]
```

## Structure (16 khuyến nghị)

| # | Loại | Vị trí | Đề xuất |
|---|---|---|---|
| 1 | MOVE | Thông tin Phase/Closed Beta rải 4 chỗ | Gom vào mục "Thứ tự triển khai và cổng Closed Beta" sau Overview; lộ mâu thuẫn E7 thuộc Phase 2 nhưng "bắt buộc trước Closed Beta" |
| 2 | MERGE | Epic List + đoạn mở đầu mỗi Epic | Epic List làm mục lục; dưới Epic chỉ giữ phần chưa có (~−280 từ) |
| 3 | MOVE | Requirements Inventory đứng trước Epic List | Đưa Epic List lên đầu; Inventory + Coverage Map xuống cuối làm phụ lục |
| 4 | CONDENSE | UX Design Requirements (2.436 từ) | Mỗi UX-DR một dòng chỉ mục → story + mục gốc (~−1.500 từ) |
| 5 | CONDENSE | Additional Requirements (AD chi tiết) | Mã + một dòng + story + link Spine (~−600 từ) |
| 6 | PRESERVE | "Quy tắc kiến trúc phải tuân thủ trong mọi story" | Đổi tên "Ràng buộc chung cho mọi story" |
| 7 | MOVE | "Điều chỉnh do Architecture" chỉ phủ UX-DR | Gom cả điều chỉnh FR-15/16/17/21 về một mục dưới Overview |
| 8 | — | `**And**` mồ côi ở 4.7, 5.1, 7.1–7.6, 8.2 | Gắn vào kịch bản hoặc tách "Ràng buộc chung của story" |
| 9 | QUESTION | Phụ thuộc chéo nằm trong ngoặc AC | Thêm dòng "**Phụ thuộc:**" cố định mỗi story |
| 10 | MOVE | Tóm tắt Epic 1 nhắc landing/Tingee fake (thực tế ở Epic 2) | Sửa cho khớp |
| 11 | QUESTION | 4.6/4.7 (vận hành) trong Epic 4; 5.8 (tải mua) trong Epic 5 | Đổi tên Epic 4 hoặc làm rõ tóm tắt |
| 12 | CONDENSE | `**Then**` gói 5–10 điều kiện (3.3, 3.4, 3.5, 7.1) | Mỗi điều kiện một dòng `**And**` |
| 13 | CONDENSE | NFR lặp ngưỡng của FR | Một nguồn, dẫn chiếu nguồn kia |
| 14 | — | AC cuối Story 3.11 là ranh giới phạm vi | Đổi thành ghi chú "Ngoài phạm vi" |
| 15 | PRESERVE | Đoạn "Thứ tự hiệu lực" ở Overview | Giữ nguyên |
| 16 | PRESERVE | FR không theo số | Thêm ghi chú "nhóm theo mục PRD" |

## Prose (17 đề xuất + 5 lỗi nhỏ)

| # | Vị trí | Vấn đề → Đề xuất |
|---|---|---|
| 1 | 2.11, 2.12, 7.4 | Chuỗi banner không ánh xạ rõ với 5 lý do; 7.4 gọi khóa là "Tạm ngừng bán" → ghi ánh xạ tường minh, 7.4 dùng "Bị khóa" |
| 2 | FR-1, FR-4 | BTC, CTV không được mở rộng → thêm dòng thuật ngữ ở Overview |
| 3 | 3.5 | "công khai với guard người dùng" → "không qua guard người dùng" |
| 4 | 2.10, 3.2 | "gọi lại" dễ hiểu thành callback → "kiểm lại" |
| 5 | 4.1 | "trạng thái đơn Gateway" lẫn với Đơn → "trạng thái giao dịch trên Gateway" |
| 6 | 4.2 | "transaction bù" chưa định nghĩa → "transaction riêng chạy sau lời gọi Tingee" |
| 7 | 4.2 | "cờ này" không rõ chủ thể → `payment_service_status` |
| 8 | 4.5 | Cụm bổ nghĩa lệch chỗ ("hạn mức âm", "xem qua adapter") |
| 9 | 1.2 | "trang dùng bàn phím" → "người dùng dùng bàn phím" |
| 10 | 2.6 vs 3.4 | Hai định dạng ký không nói phạm vi API → ghi rõ Master Merchant / Payment Gateway |
| 11 | 7.5 | Given thiếu chủ thể/động từ |
| 12 | 8.1 | Given trộn hai trạng thái, When "chờ" không phải sự kiện |
| 13 | 2.8, 3.6, 1.4 | When chứa điều kiện → chuyển lên Given |
| 14 | 2.6 | "loại QR thanh toán dùng được" mơ hồ |
| 15 | 5.1 | "đã đăng" là thuật ngữ mới → "đã mở bán / đang Ẩn" |
| 16 | 1.3 | Thiếu dấu phẩy: "sau 5 lần sai, mã bị vô hiệu" |
| 17 | 2.9, 3.2, 7.1, 8.2 | "người mua" viết thường → "Người mua" |

Lỗi nhỏ: "As a Owner" → "As an Owner"; P95/p95; khoảng trắng trước đơn vị; cách trích câu hỏi mở không thống nhất; persona "As a Tingee" (8.2) không phải vai người dùng.
