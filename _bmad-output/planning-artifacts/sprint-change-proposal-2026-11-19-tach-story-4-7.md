---
title: 'Sprint Change Proposal: tách Story 4.7, phần hạ tầng sang Epic 9'
date: '2026-11-19'
author: 'Mason (duyệt) · Developer agent (soạn)'
status: 'approved'
scope: 'moderate'
trigger_story: 'Story 4.7 (in-progress) và action item Epic 4 "Chốt nhà cung cấp hạ tầng/email/giám sát theo NĐ 53/2022"'
---

# Sprint Change Proposal: tách Story 4.7, phần hạ tầng sang Epic 9

## 1. Tóm tắt vấn đề

**Nguồn:** Story 4.7 "Môi trường staging/production, deploy và diễn tập khôi phục" đang `in-progress`. Mason quyết định ngày 19/11/2026 hoãn việc chọn nhà cung cấp hạ tầng, email và giám sát tới khi code xong Epic 5–8.

**Phân loại:** quyết định sắp lại thứ tự. Không có lỗi kỹ thuật, không đổi yêu cầu sản phẩm.

**Bối cảnh:**

- Story 4.7 trộn hai loại việc:
  - **Phần code**, không cần chọn nhà cung cấp. Đã làm qua 5 story con: 4.7-a (giới hạn IP `/v1/admin/*`), 4.7-b (siết cấu hình production), 4.7-c (CI e2e full-stack), 4.7-d (giới hạn presign ảnh), 4.7-e (khóa migrate). `/readyz`, tắt êm khi `SIGTERM` và `TRUST_PROXY_HOPS` có từ Epic 1–3, có test (`deferred-work.md`, mục "tách phạm vi Story 4.7 khi build").
  - **Phần hạ tầng**, chỉ làm được khi đã có nhà cung cấp: staging tự deploy, production deploy theo tag, topology, test IPN liên tục trong lúc deploy, test hợp đồng Tingee UAT, PITR và diễn tập khôi phục, đo uptime.
- AD-22 cố ý hoãn việc chọn nhà cung cấp tới khi có ý kiến pháp chế về NĐ 53/2022 Điều 26 (lưu dữ liệu người dùng Việt Nam tại Việt Nam). Action item Epic 4 "Chốt nhà cung cấp hạ tầng/email/giám sát theo NĐ 53/2022 trước Story 4.7 và Closed Beta" vẫn `open`.
- Code đã không phụ thuộc nhà cung cấp (AD-22: Docker, Postgres chuẩn, S3, SMTP), nên chọn muộn ít khi phải sửa code.

**Hệ quả nếu giữ nguyên:**

- Story 4.7 ở `in-progress` tới sát Closed Beta. Epic 4 không đóng được, retro Epic 4 phải chờ.
- Story 5.8 (kiểm thử tải NFR-3 trên staging) cần staging, nên Epic 5 cũng không đóng được.
- `sprint-status.yaml` không cho thấy phần nào của 4.7 đã xong, phần nào đang chờ nhà cung cấp.

## 2. Phân tích tác động (kết quả checklist)

| Mục | Trạng thái | Ghi chú |
|---|---|---|
| 1.1 Story kích hoạt | [x] | Story 4.7, action item NĐ 53/2022 của Epic 4 |
| 1.2 Loại vấn đề | [x] | Sắp lại thứ tự do phụ thuộc ngoài (pháp chế, chọn nhà cung cấp). Không phải lỗi kỹ thuật |
| 1.3 Bằng chứng | [x] | §1. `sprint-status.yaml:83` 4.7 `in-progress`; 5 spec 4.7-a đến 4.7-e `done`; action item NĐ 53 `open`; AD-22 và bảng Deferred của spine |
| 2.1 Epic hiện tại | [!] | Epic 4 đóng được sau 4.7-f nếu phần hạ tầng rời khỏi 4.7 |
| 2.2 Thay đổi cấp epic | [!] | Thêm Epic 9 "Lên môi trường thật" với 2 story: 9.1 (phần hạ tầng của 4.7) và 9.2 (5.8 chuyển sang) |
| 2.3 Epic tương lai | [!] | Epic 5 bỏ 5.8, đóng được khi xong 5.7. Epic 6, 7, 8 không đổi |
| 2.4 Epic lỗi thời / mới | [!] | Epic 9 mới. Không epic nào lỗi thời |
| 2.5 Thứ tự epic | [!] | Epic 9 làm cuối, sau Epic 5–8, là điều kiện bắt buộc trước Closed Beta như Epic 7 |
| 3.1 PRD | [!] | §11.4: điều kiện "Kiểm thử tải NFR-3 đạt" rời Phase 2, sang một dòng mới trước Closed Beta. NFR và FR không đổi |
| 3.2 Architecture | [!] | Bảng Deferred: hạn chọn nhà cung cấp là trước Story 9.1. AD-36: ghi luật khóa của vai `migrate` (mục hoãn của review 4.7-e) |
| 3.3 UX | [N/A] | Không có màn hình nào đổi |
| 3.4 Artifact khác | [!] | `sprint-status.yaml` (đổi tên khóa 4.7, bỏ 5.8, thêm Epic 9, sửa action item); `deferred-work.md` (mục bàn giao); `epic-4-context.md` (tên 4.7, ghi chú bàn giao). CI và code không đổi |
| 4.1 Sửa trực tiếp | Viable | Effort thấp, rủi ro thấp. Chỉ sửa tài liệu kế hoạch |
| 4.2 Rollback | Not viable | Không có code cần lùi |
| 4.3 Xem lại MVP | Not viable | Phạm vi MVP không đổi. Điều kiện trước Closed Beta giữ nguyên, chỉ đổi chỗ đặt |
| 4.4 Chọn hướng | [x] | Sửa trực tiếp |

## 3. Hướng đi đề xuất

**Chọn: sửa trực tiếp kế hoạch.**

- **Story 4.7** đổi tên thành "Siết cấu hình production và CI trước khi deploy". Story giữ các AC đã làm qua 4.7-a đến 4.7-e, thêm một story con 4.7-f cho các mục code còn lại không cần nhà cung cấp. Xong 4.7-f thì 4.7 `done` và Epic 4 đóng được.
- **Epic 9 "Lên môi trường thật"** *(bắt buộc trước Closed Beta)* gồm:
  - **9.1 Môi trường staging/production, deploy và diễn tập khôi phục.** Nhận mọi AC hạ tầng của 4.7 cũ, thêm hai điều: edge phục vụ API bằng HTTP/2 (đã có trong checklist deploy), và một AC mới về email. Điều kiện bắt đầu: đã chốt nhà cung cấp theo ý kiến pháp chế.
  - **9.2 Kiểm thử tải NFR-3 trên staging.** Chính là Story 5.8, chuyển nguyên AC.
- **Hai việc có thời gian chờ, làm ngay dù hoãn chọn nhà cung cấp** (ghi vào note của action item NĐ 53):
  1. Gửi câu hỏi NĐ 53/2022 Điều 26 cho pháp chế. Thời gian trả lời không kiểm soát được, và câu trả lời quyết định danh sách nhà cung cấp được xét.
  2. Chuẩn bị domain gửi email (SPF, DKIM, DMARC) đủ sớm để email OTP và email Vé vào hộp thư chính.

**Rủi ro:**

- **Phát hiện muộn.** Nếu nhà cung cấp được chọn không cho kết nối session trực tiếp (cần cho `LISTEN` và pg-boss), load balancer không chạy HTTP/2 cho SSE, hoặc PITR không đạt RPO 5 phút, thì phải sửa sát Closed Beta. Giảm nhờ AD-22 và các tiêu chí bắt buộc đã ghi trong bảng Deferred của spine.
- **Thời gian chờ pháp chế.** Giảm bằng cách gửi câu hỏi ngay.
- **E3-3 (UAT Tingee thật) và các câu hỏi chốt qua test hợp đồng UAT** (IPN `status` chữ hoa hay thường, `get-va-paging` khi `data` rỗng) cần URL công khai để nhận IPN thật, thường là staging. Nếu muốn chốt sớm hơn 9.1, có thể thử tay bằng key UAT qua một đường hầm tạm. Không đổi action item E3-3.
- **Đổi số 5.8 thành 9.2.** Các tham chiếu "5.8" trong `deferred-work.md` không sửa từng chỗ, mà ghi chú một lần trong mục bàn giao (§4.5).

**Effort và lịch:**

- Lần sửa tài liệu này: thấp.
- 4.7-f: một lượt `bmad-build`.
- Epic 9 không thêm việc so với 4.7 cũ, trừ AC email mới. Việc chỉ dời từ giữa kế hoạch xuống cuối, trước Closed Beta.

## 4. Chi tiết đề xuất sửa

### 4.1 Epics (`epics.md`)

#### 4.1.1 Phân bổ AC của Story 4.7 cũ

| AC của 4.7 cũ (`epics.md:1503–1533`) | Đi đâu | Ghi chú |
|---|---|---|
| Ba môi trường: `TINGEE_BASE_URL` và `TINGEE_CREDENTIAL_KEYS` riêng, secret store, schema Zod, `local` không nhận IPN thật | Tách | Kiểm schema và `local` → 4.7 (xong, 4.7-b). Mỗi môi trường một bộ, tiêm từ secret store → 9.1 |
| `/v1/admin/*` theo `ADMIN_ALLOWED_CIDRS`, `TRUST_PROXY_HOPS` | 4.7 | Xong, 4.7-a |
| Merge vào `main`, CI xanh, staging tự deploy theo SHA, `migrate` chạy trước | Tách | CI → 4.7 (xong, 4.7-c và 4.7-e). Staging tự deploy → 9.1 |
| Production deploy thủ công theo tag, topology, load balancer dùng `/readyz` | 9.1 | Thêm: edge phục vụ API bằng HTTP/2 |
| `SIGTERM`: ngừng SSE mới, đóng SSE, `boss.stop`; không mất IPN, test gửi IPN liên tục khi deploy staging | Tách | Hành vi code → 4.7 (có từ Epic 1–3, có test). Test trong lượt deploy staging → 9.1 |
| Test hợp đồng Tingee UAT ở staging | 9.1 | Không đổi |
| PITR, RPO/RTO, giữ 14 ngày, diễn tập khôi phục | 9.1 | Không đổi |
| Uptime đo từ bên ngoài, báo cáo theo tháng | 9.1 | Không đổi |
| *(mới)* Cấu hình production phía web, `NODE_ENV` sai giá trị, kiểm khóa QR lúc khởi động | 4.7 (4.7-f) | Lấy từ các mục hoãn trong `deferred-work.md` |
| *(mới)* Email qua nhà cung cấp SMTP, domain có SPF/DKIM/DMARC | 9.1 | AC mới, xem §4.1.4 |

#### 4.1.2 Story 4.7 (`epics.md:1495–1533`)

OLD: toàn bộ Story 4.7 hiện tại.

NEW:

```markdown
### Story 4.7: Siết cấu hình production và CI trước khi deploy

*(Tách ngày 19/11/2026, `sprint-change-proposal-2026-11-19-tach-story-4-7.md`: phần cần nhà cung cấp hạ tầng chuyển sang Story 9.1. Story con: 4.7-a giới hạn IP admin, 4.7-b siết cấu hình production, 4.7-c CI e2e full-stack, 4.7-d giới hạn presign ảnh Sự kiện, 4.7-e khóa migrate, 4.7-f cấu hình production phía web và kiểm khóa QR lúc khởi động.)*

As a đội vận hành Tickee,
I want api, worker và web từ chối cấu hình sai, và CI chặn bản hỏng trước khi có môi trường thật,
So that khi lên staging và production ở Story 9.1 chỉ còn việc hạ tầng, không phải sửa code.

**Acceptance Criteria:**

**Given** vai `api`, `worker` hoặc `migrate` khởi động
**When** đọc env
**Then** mọi biến kiểm bằng schema Zod của `config`; thiếu `NODE_ENV`, sai định dạng, ở production mà dùng giá trị mẫu của `.env.example` hoặc origin không phải `https`, hoặc `TICKET_QR_KEYS` dùng chung khóa với `TINGEE_CREDENTIAL_KEYS` thì tiến trình dừng và nêu tên biến, không nêu giá trị; `local` không nhận IPN thật (AD-36) *(4.7-b)*

**Given** `/v1/admin/*` trên staging và production
**When** api khởi động và nhận request
**Then** chỉ nhận request từ dải IP trong env `ADMIN_ALLOWED_CIDRS`, kiểm bằng schema Zod khi khởi động; thiếu hoặc sai định dạng ở production thì api không khởi động (FR-4, AD-26)
**And** IP client lấy qua trusted proxy (`TRUST_PROXY_HOPS` đúng số proxy thật trước api); có test *(chuyển từ Story 2.5, E2-4; 4.7-a)*

**Given** một PR
**When** CI chạy
**Then** CI gồm Playwright full-stack với api thật, worker, Tingee fake, Mailpit và bộ test cách ly; image chạy được vai `migrate`, và vai `worker` ở production từ chối cấu hình sai; hai tiến trình `migrate` chạy cùng lúc thì lượt sau chờ khóa, không chạy song song (AD-36) *(4.7-c, 4.7-e)*

**Given** instance `api` hoặc `worker` nhận `SIGTERM`
**When** tắt
**Then** ngừng nhận SSE mới, đóng SSE đang mở để client tự nối lại, `boss.stop({ graceful })`; có test (AD-36, NFR-4) *(có từ Epic 1–3)*

**Given** web build hoặc chạy ở production
**When** thiếu `WEB_ORIGIN`, `WEB_ORIGIN` hoặc `NEXT_PUBLIC_API_BASE_URL` không phải `https`, hoặc `REVALIDATE_SECRET` là giá trị mẫu hay quá ngắn
**Then** build hoặc khởi động dừng và nêu tên biến; route revalidate không nhận giá trị mẫu; font OG có trong image *(4.7-f)*
**And** api và worker cảnh báo khi `NODE_ENV` khác `production` mà `API_PUBLIC_URL` hoặc `WEB_ORIGIN` là `https` trên host không phải local *(4.7-f)*
**And** lúc khởi động, mọi `qr_key_version` còn dùng ở bảng `tickets` phải có trong `TICKET_QR_KEYS`; thiếu thì báo kèm marker `ticket_qr_key_missing`, dừng hay chỉ cảnh báo chốt ở spec 4.7-f (AD-29) *(4.7-f)*
```

#### 4.1.3 Story 5.8 (`epics.md:1763–1785`)

OLD: Story 5.8 nằm cuối Epic 5.

NEW: xóa khỏi Epic 5. Nội dung chuyển nguyên sang Story 9.2 (§4.1.4).

#### 4.1.4 Epic 9 mới (thêm sau Epic 8, cuối file)

```markdown
## Epic 9: Lên môi trường thật *(bắt buộc trước Closed Beta)*

Tickee chạy trên staging và production của nhà cung cấp đã chốt theo ý kiến pháp chế: deploy an toàn, sao lưu và khôi phục được, email vào hộp thư chính, uptime đo từ bên ngoài, và chịu được một đợt mở bán đông người. Epic làm sau Epic 5–8, vì phải chốt nhà cung cấp hạ tầng, email và giám sát (NĐ 53/2022) trước. Code không phụ thuộc nhà cung cấp nhờ AD-22. *(Tách từ Story 4.7 và chuyển Story 5.8 sang, 19/11/2026.)*

### Story 9.1: Môi trường staging/production, deploy và diễn tập khôi phục

*(Tách từ Story 4.7 ngày 19/11/2026. Điều kiện bắt đầu: đã chốt nhà cung cấp hạ tầng, email và giám sát theo ý kiến pháp chế về NĐ 53/2022, và ghi vào AD-22, AD-36. Các mục checklist deploy và hạ tầng ghi "Story 4.7" trong `deferred-work.md` thuộc story này.)*

As a đội vận hành Tickee,
I want deploy an toàn lên staging và production và chứng minh khôi phục được dữ liệu,
So that Checkout, IPN và check-in luôn chạy, và một sự cố DB không làm mất tiền hay Vé.

**Acceptance Criteria:**

**Given** ba môi trường `local` (Tingee fake), `staging` (Tingee UAT), `production` (Tingee PROD)
**When** cấu hình
**Then** mỗi nơi một `TINGEE_BASE_URL` và một bộ `TINGEE_CREDENTIAL_KEYS` riêng; credential Tingee là của từng BTC; secret tiêm từ secret store của nền tảng, danh sách biến khớp schema Zod của `config` (AD-36)

**Given** PR được merge vào `main` và CI xanh (Story 4.7)
**When** pipeline chạy
**Then** staging tự deploy image tag theo commit SHA: vai `migrate` chạy trước, rồi đổi phiên bản `api`/`worker`; migration luôn tương thích ngược; pipeline không chạy hai lượt deploy chồng nhau (AD-36)

**Given** một tag release
**When** người có quyền bấm deploy production
**Then** deploy thủ công theo tag với cùng trình tự; topology tối thiểu ≥ 2 `api` sau load balancer, ≥ 1 `worker`; load balancer dùng `/readyz` (DB và `LISTEN`); edge phục vụ API bằng HTTP/2 vì nhiều trang giữ SSE dài hạn (AD-36, NFR-4)

**Given** đang deploy
**When** instance cũ nhận `SIGTERM`
**Then** không mất IPN nào trong lúc deploy, kiểm bằng test gửi IPN liên tục trong một lượt deploy staging (AD-36, NFR-4)

**Given** staging
**When** chạy bộ test hợp đồng với Tingee UAT bằng một tài khoản merchant UAT để thử (tạo link, IPN ký thật, tra trạng thái theo `orderId`, đọc danh sách tài khoản (`get-va-paging`))
**Then** bộ test chạy được bằng một lệnh và theo lịch; lỗi thì cảnh báo vận hành (AD-36)

**Given** staging và production
**When** gửi email OTP, email Vé và cảnh báo vận hành
**Then** email đi qua nhà cung cấp SMTP đã chốt, qua `EmailTransport`; domain gửi có SPF, DKIM và DMARC; email OTP và email Vé thử gửi tới Gmail và Outlook không rơi vào spam (AD-22) *(mới, 19/11/2026)*

**Given** Postgres production có PITR và failover tự động
**When** cấu hình sao lưu
**Then** RPO ≤ 5 phút, RTO ≤ 1 giờ, giữ 14 ngày (NFR-5)
**And** trước Closed Beta có một lần diễn tập khôi phục về một thời điểm sang môi trường riêng, đo thời gian thực tế và ghi biên bản trong `docs/`; không đạt RTO thì Closed Beta chưa mở

**And** uptime của Checkout, IPN và check-in được đo bằng kiểm tra từ bên ngoài, báo cáo theo tháng so với mục tiêu 99,9% (NFR-4, NFR-10)

### Story 9.2: Kiểm thử tải NFR-3 trên staging

*(Chuyển từ Story 5.8 ngày 19/11/2026, AC giữ nguyên. Các mục ghi "5.8" trong `deferred-work.md` thuộc story này. Cần staging của Story 9.1.)*

[AC của Story 5.8 hiện tại, chép nguyên văn]
```

#### 4.1.5 Các chỗ sửa nhỏ trong `epics.md`

1. **Dòng 178** (Phụ thuộc bên ngoài và rủi ro)
   - OLD: `Nhà cung cấp hạ tầng/email/giám sát đang hoãn chờ pháp chế (NĐ 53/2022). Phải chốt trước Closed Beta.`
   - NEW: `Nhà cung cấp hạ tầng/email/giám sát đang hoãn chờ pháp chế (NĐ 53/2022). Phải chốt trước Story 9.1 và Closed Beta.`
2. **Phụ thuộc giữa các epic** (dòng 296–303)
   - Thêm dòng: `- E9 dựa trên E4 (Story 4.7) và làm sau E5–E8, vì phải chốt nhà cung cấp hạ tầng trước. Story 9.2 cần staging của Story 9.1.`
   - OLD: `Phase 1 = E1–E4; Phase 2 = E5–E8. E7 thuộc Phase 2 về thứ tự làm, nhưng là điều kiện bắt buộc trước khi mở Closed Beta.`
   - NEW: `Phase 1 = E1–E4; Phase 2 = E5–E8. E7 thuộc Phase 2 về thứ tự làm, nhưng là điều kiện bắt buộc trước khi mở Closed Beta. E9 làm cuối, cũng là điều kiện bắt buộc trước Closed Beta.`
3. **Epic List, Epic 4** (dòng 323)
   - OLD: `…; staging/production, deploy an toàn và diễn tập khôi phục (NFR-4, NFR-5); giới hạn IP cho …`
   - NEW: `…; siết cấu hình production và CI trước khi deploy (phần hạ tầng ở Epic 9); giới hạn IP cho …`
4. **Epic List và phần mở đầu Epic 5** (dòng 328 và 1565)
   - OLD: `Story cuối: kiểm thử tải NFR-3 trên staging.`
   - NEW: `Kiểm thử tải NFR-3 chuyển sang Story 9.2.`
5. **Epic List** thêm Epic 9 sau Epic 8:

   ```markdown
   ### Epic 9: Lên môi trường thật *(bắt buộc trước Closed Beta)*
   Chốt nhà cung cấp hạ tầng, email và giám sát theo pháp chế (NĐ 53/2022); staging tự deploy, production deploy theo tag, diễn tập khôi phục (NFR-4, NFR-5); email vào hộp thư chính; test hợp đồng Tingee UAT; đo uptime; kiểm thử tải NFR-3 trên staging. *(Tách từ Story 4.7 và chuyển Story 5.8 sang, 19/11/2026.)*
   **FRs covered:** không có FR mới (NFR-3, NFR-4, NFR-5, NFR-10)
   **UX-DR chính:** không có
   ```

### 4.2 PRD (`prds/prd-tickee-2026-10-27/prd.md`, §11.4)

- **Dòng Phase 2:**
  - OLD: `Check-in tại cổng đạt yêu cầu. Sheets cập nhật trong vòng 1 phút. Kiểm thử tải NFR-3 đạt`
  - NEW: `Check-in tại cổng đạt yêu cầu. Sheets cập nhật trong vòng 1 phút`
- **Thêm một dòng** giữa Phase 2 và Phase 3:

  ```markdown
  | Trước Closed Beta | Chốt nhà cung cấp hạ tầng, email và giám sát theo pháp chế (NĐ 53/2022); staging và production; diễn tập khôi phục; kiểm thử tải NFR-3 trên staging (Epic 9) | Diễn tập khôi phục đạt RTO ≤ 1 giờ. Kiểm thử tải NFR-3 đạt |
  ```

NFR và FR không đổi.

### 4.3 Architecture (`ARCHITECTURE-SPINE.md`)

- **Bảng Deferred, dòng "Nhà cung cấp hạ tầng, email, backend giám sát", cột "Xem lại khi":**
  - OLD: `Trước Closed Beta`
  - NEW: `Trước Story 9.1 (Epic 9), trước Closed Beta`
- **AD-36, thêm vào cuối gạch đầu dòng CI.** Lấy từ mục hoãn của review 4.7-e (#15): luật này mô tả code đã ship, nên ghi ngay thay vì chờ 9.1.

  ```markdown
  Vai `migrate` giữ khóa advisory cấp session `tickee:migrate` suốt migration Drizzle, schema `pgboss` và cấp quyền; lượt chạy song song chờ chứ không bỏ qua. `MIGRATION_DATABASE_URL` phải là kết nối thẳng hoặc qua pooler chế độ session. Khóa không sắp thứ tự deploy giữa hai phiên bản, nên pipeline phải chặn deploy chồng nhau.
  ```

### 4.4 UX

N/A. Không có màn hình nào đổi.

### 4.5 `deferred-work.md`

- **Thêm mục ở cuối file:**

  ```markdown
  ## Bàn giao sau khi tách Story 4.7 (Sprint Change Proposal 2026-11-19)

  Từ 19/11/2026, Story 4.7 chỉ còn phần không cần nhà cung cấp hạ tầng (4.7-a đến 4.7-f). Phần hạ tầng sang Story 9.1, Story 5.8 đổi thành Story 9.2 (`_bmad-output/planning-artifacts/sprint-change-proposal-2026-11-19-tach-story-4-7.md`). Các mục cũ trong file này giữ nguyên chữ; đọc theo luật sau:

  - Mục ghi "Story 4.7" là checklist deploy hoặc hạ tầng → Story 9.1.
  - Mục ghi "5.8" → Story 9.2.

  **4.7-f nhận** (không cần nhà cung cấp):
  - Cấu hình production phía web: `REVALIDATE_SECRET` mẫu hoặc ngắn, `NEXT_PUBLIC_API_BASE_URL` là `http://` (review 4.7-b triage #10).
  - `WEB_ORIGIN` bắt buộc ở production thay vì rơi về localhost; font OG có trong image (review 2.11-b #2).
  - `NODE_ENV` đặt sai giá trị trên môi trường thật (review 4.7-b triage #11–12).
  - Kiểm lúc khởi động mọi `qr_key_version` còn dùng có trong `TICKET_QR_KEYS` (mục review E3-5 D1 #2, phần 4.7).

  **Story 9.1 nhận** (cần nhà cung cấp): luôn có ít nhất một `worker` và cảnh báo `identity.purge-expired` (retro Epic 1); cách chạy `admin-cli` trong image; biến origin công khai khi tách host; revalidate với nhiều instance web và `REVALIDATE_SECRET` chung cho worker và web; purge CDN cho `/e/*`; runbook xoay khóa QR (phần 2); edge HTTP/2 (C4 và 4.2-b); thứ tự deploy worker trước api khi thêm loại cảnh báo; api trước web khi contract thêm trường bắt buộc; bucket ảnh staging/production; giới hạn tốc độ ở edge cho route có khóa advisory (đo ở 9.2); chốt IPN `status` và `get-va-paging` khi `data` rỗng qua test hợp đồng UAT.
  ```

- **Dưới mục "Ghi luật mới của vai `migrate` vào AD-36"** (review 4.7-e #15), thêm:
  `- Đã xử lý (19/11/2026): ghi vào AD-36 qua sprint-change-proposal-2026-11-19-tach-story-4-7.md.`

### 4.6 `epic-4-context.md`

- **Dòng 17:**
  - OLD: `- Story 4.7: Môi trường staging/production, deploy và diễn tập khôi phục`
  - NEW: `- Story 4.7: Siết cấu hình production và CI trước khi deploy (phần hạ tầng chuyển sang Story 9.1, 19/11/2026)`
- **Mục "4.7:" ở Cross-Story Dependencies**, thêm dòng: `- Checklist deploy và runbook xoay khóa QR chuyển sang Story 9.1 (Sprint Change Proposal 19/11/2026).`

### 4.7 `sprint-status.yaml`

- **Epic 4:**
  - OLD: `4-7-môi-trường-staging-production-deploy-và-diễn-tập-khôi-phục: in-progress`
  - NEW: `4-7-siết-cấu-hình-production-và-ci-trước-khi-deploy: in-progress` (về `done` khi 4.7-f merge)
- **Epic 5:** xóa `5-8-kiểm-thử-tải-nfr-3-trên-staging: backlog`.
- **Thêm sau Epic 8:**

  ```yaml
  epic-9: backlog
  9-1-môi-trường-staging-production-deploy-và-diễn-tập-khôi-phục: backlog
  9-2-kiểm-thử-tải-nfr-3-trên-staging: backlog
  epic-9-retrospective: optional
  ```

- **Action item NĐ 53** (epic 4, `status: open`):
  - Sửa `action` thành: `Chốt nhà cung cấp hạ tầng/email/giám sát theo pháp chế NĐ 53/2022 trước Story 9.1 và Closed Beta`
  - Thêm `note`: `Hoãn tới khi code xong Epic 5–8 (Mason, 19/11/2026; sprint-change-proposal-2026-11-19-tach-story-4-7.md). Làm ngay vì có thời gian chờ: gửi câu hỏi Điều 26 cho pháp chế; chuẩn bị domain gửi email (SPF, DKIM, DMARC). Khi có ý kiến pháp chế: bmad-deep-recon (select, technical) để chọn nhà cung cấp`
- `last_updated` theo ngày sửa.

## 5. Bàn giao

**Phạm vi:** Moderate. Sắp lại backlog (thêm Epic 9, chuyển một story, tách một story). Chỉ sửa tài liệu; không đổi code, CI hay phạm vi MVP.

| Vai | Việc |
|---|---|
| Developer agent (phiên này) | Sửa tài liệu ở §4.1–4.3 và §4.5–4.7; commit trên branch `docs/correct-course-tach-4-7`, chỉ push hay mở PR khi Mason bảo |
| Mason | Duyệt đề xuất; gửi câu hỏi NĐ 53 cho pháp chế; quyết định push/PR |
| `bmad-build` (phiên mới) | Story con 4.7-f theo AC mới của 4.7 và danh sách "4.7-f nhận" trong `deferred-work.md`; xong thì 4.7 `done` |
| `bmad-retrospective` (tùy chọn) | Retro Epic 4 sau khi 4.7 `done` |
| `bmad-deep-recon` (khi có ý kiến pháp chế) | Chọn nhà cung cấp hạ tầng, email, giám sát; kết quả vào AD-22, AD-36 trước Story 9.1 |

**Tiêu chí hoàn thành:**

- `epics.md` có Epic 9 với Story 9.1 và 9.2. Epic 5 không còn Story 5.8. Story 4.7 có tiêu đề và AC mới.
- Mỗi AC của Story 4.7 cũ nằm ở đúng một chỗ: Story 4.7 mới hoặc Story 9.1, theo bảng §4.1.1.
- `sprint-status.yaml` có `epic-9` và hai story backlog, không còn khóa `5-8-…`, khóa 4.7 khớp tiêu đề mới, và action item NĐ 53 trỏ Story 9.1.
- `grep -n "Story cuối: kiểm thử tải" epics.md` không còn kết quả.
- PRD §11.4 có dòng "Trước Closed Beta"; spine có hạn mới ở bảng Deferred và luật khóa `migrate` ở AD-36.
- `deferred-work.md` có mục bàn giao; mục AD-36 của review 4.7-e có dòng "Đã xử lý".

**Ghi chú sau duyệt (19/11/2026):** khi build 4.7-f, Mason tách phần kiểm khóa QR lúc khởi động thành story con 4.7-g. `epics.md`, `epic-4-context.md` và `deferred-work.md` đã ghi theo. 4.7 `done` khi xong cả 4.7-f và 4.7-g.
