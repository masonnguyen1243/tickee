# Reconcile: brd-tickee.md → PRD Tickee (2026-10-27)

- **Source input:** `brd-tickee.md` (Tickee BRD MVP v1, 26/10/2026)
- **Checked against:** `prd.md`, `addendum.md`, `.memlog.md` (deliberate changes, summarised in PRD §11.3)
- **Method:** each BRD section (§1–§16 and Appendix A) was walked line by line. For every requirement, rule, exception, NFR, integration, assumption, constraint, dependency, risk, decision, launch criterion and qualitative idea, I checked whether prd.md/addendum.md carries it or the memlog logs a deliberate change. The gaps below are the items that are dropped, weakened or contradicted with no logged decision. Some are knock-ons of logged decisions that the PRD never followed through; these are marked **[knock-on]**.

**Totals: 31 gaps: 4 high, 12 medium, 15 low.**

---

## High

### H1. The unit of the Token fee is now ambiguous: per transaction or per ticket [knock-on]
- **BRD:** §13 "Trừ bao nhiêu: theo mức Tingee quy định mỗi giao dịch; tham khảo tương đương 3.000–5.000đ/vé"; BR-05 (one deduction per Webhook); the §13 cost comparison table (4.000đ/vé × 50/150/300 vé); BO-05 (Token revenue for Tingee).
- **What's missing:** The BRD assumed one order equals one ticket, so "per transaction" and "per ticket" meant the same thing. The PRD's logged decision to allow multi-ticket orders (one QR and one Webhook per Đơn) breaks that. PRD §7 now says both "Tingee trừ Token cho mỗi Webhook" and "3.000–5.000đ/Vé". Taken literally, a 10-ticket order is charged once. That cuts Tingee's Token revenue per ticket (BO-05) and changes the cost comparison and the Token khả dụng arithmetic. Neither the open questions nor the memlog mention it.
- **Where it should go:** PRD §7 (state the fee unit explicitly), §13 (new open question for Tingee: per Webhook or per ticket for multi-ticket orders), and §12 long-term metric (Token per month).

### H2. The Closed Beta mitigation "chỉ mời các BTC được chọn" has no FR behind it
- **BRD:** R-01 (fraud, money lands in a scammer's account, level Cao). Mitigations: KYC (BR-10), "giới hạn vé có phí cho BTC mới", report + lock (FR-26).
- **What's missing:** The memlog logs deferring KYC and rejecting caps. To replace them, PRD R-1 relies on an invite-only Closed Beta ("chỉ mời các BTC được chọn"; Glossary "BTC được mời"). No FR implements this. FR-1 lets anyone register, and FR-5 lets anyone link a payout account and open paid sales immediately. As written, the beta is open sign-up with no KYC, no cap and no gate. The weakened R-01 control rests on an invite gate that does not exist.
- **Where it should go:** a new FR in §4.2 or §4.9: a BTC allowlist, invite code or Quản trị Tingee approval before a BTC can open paid sales during the Closed Beta. Reference it from R-1.

### H3. Authentication for Quản trị Tingee was dropped
- **BRD:** §12.2 "Quản trị Tingee: SSO nội bộ + 2FA, giới hạn IP".
- **What's missing:** PRD FR-35 adds an admin console that can lock any Sự kiện or BTC. In the Closed Beta that lock is the only fraud control. Yet no FR or NFR says how admins authenticate. FR-1/NFR-6 require 2FA only for the BTC Owner, and FR-4 has no admin row. Admin access could end up implemented as a flag on a normal Tickee account.
- **Where it should go:** FR-35 consequences and NFR-6. Optionally, add an admin row to the FR-4 matrix.

### H4. NĐ 13/2023 consent moved from every checkout to a single consent, with no logged decision
- **BRD:** NFR-08 "Thu thập đồng ý xử lý dữ liệu tại checkout theo NĐ 13/2023"; §10.3 "Dữ liệu người mua chỉ dùng cho sự kiện đã mua".
- **What's missing:** Consent at checkout covers each purchase, and each purchase hands the buyer's data to a different BTC. The PRD makes consent one-off, and it contradicts itself on when: FR-3 says "trước khi gửi Đơn đầu tiên", §8 says "khi tạo Tài khoản Tickee hoặc khi gửi Đơn đầu tiên". The memlog (line 14) lists "NĐ 13/2023 consent at sign-up vs checkout" as an open knock-on but never records a decision. Also unaddressed: whether sharing data with each new BTC needs its own consent, and consent for BTC members and CTV accounts.
- **Where it should go:** FR-3, PRD §8, NFR-8. Or add an open question for legal and log the decision.

---

## Medium

### M1. The BTC "Staff" member role was removed and merged into per-event CTV
- **BRD:** FR-01 "mời thành viên theo vai trò Owner / Admin / Staff"; §3.1 "Staff / CTV"; §12.1 "Staff / CTV".
- **What's missing:** PRD FR-2 lets an Owner invite only Admins. Scanning staff exist only as per-event CTV, and their access ends automatically when the event ends. A BTC with regular gate staff (recurring workshops, livehouses) has to re-invite them for every event. The BRD also let an Owner be invited ("mời ... Owner"), while the PRD fixes exactly one Owner with no ownership transfer. The memlog logs the CTV-account change but neither the removal of Staff nor the single-Owner rule, and §11.3 lists neither.
- **Where it should go:** FR-2, FR-4, Glossary (Owner), §11.3.

### M2. The BR-11 trust statement only appears on the dynamic-QR page
- **BRD:** BR-11 "Trang checkout ghi rõ 'Tiền chuyển thẳng cho [tên BTC]' và hiển thị chính sách hoàn vé của BTC"; R-02 (Cao).
- **What's missing:** The PRD puts the statement only in FR-16 (QR động). FR-17 (QR tĩnh) doesn't repeat it, and nothing places it in the checkout step before the Đơn is submitted. Static QR is likely the main path for the target segment (see M3), so the core trust framing is missing exactly where buyers are most nervous: a plain bank transfer with typed content.
- **Where it should go:** a checkout-wide consequence (FR-12 or a new FR in §4.4) covering both QR types and the pre-submit step. Then point FR-16 and FR-17 to it.

### M3. Constraint C-02 was dropped: dynamic QR usually needs a business account
- **BRD:** C-02 "QR động tùy ngân hàng và loại tài khoản, thường chỉ tài khoản doanh nghiệp"; §4 principle 4 "(thường là doanh nghiệp)"; D-01.
- **What's missing:** The PRD has no constraints section and never says dynamic QR is mostly for business accounts. The target BTCs (CLBs, student groups, small venues) mostly use personal accounts, so static QR may be the majority path. Yet UJ-1, UJ-2, SM-2 (≥95% dynamic) and Phase 1's exit criterion all assume the dynamic happy path. There is no static-QR journey and no estimate of how many beta BTCs will end up on static QR.
- **Where it should go:** a constraints list (§6 or a new subsection), a static-QR variant in UJ-1/UJ-2, a note on SM-2, and Closed Beta selection (§11.4).

### M4. BTC login changed (Tingee SSO dropped, password dropped) without a logged decision
- **BRD:** §12.2 "Owner / Admin BTC: SSO tài khoản Tingee nếu có; nếu không: email + mật khẩu, Google hoặc magic link".
- **What's missing:** For buyers the memlog logs "Google or email OTP, no password", and for BTCs only "BTC sign-up = email". PRD FR-1 also drops Tingee SSO for BTCs, only as an `[ASSUMPTION]`, and drops password login. Neither change is in §11.3. Tingee SSO matters for the growth channel the BRD bets on (BO-04 "mạng lưới merchant Tingee"; UJ-2's Tingee referral entry point).
- **Where it should go:** FR-1, §11.3, and an open question on whether Tingee SSO is feasible for MVP.

### M5. Competitor figures are stated as fact; the BRD's verification caveat was lost
- **BRD:** §2.1 "Sàn vé lớn thu phí 8–15% + phí cố định và giữ tiền 7–14 ngày **(số liệu nghiên cứu ban đầu, cần kiểm tra lại)**".
- **What's missing:** PRD §1 Vision states "Sàn vé thu 8–15% kèm phí cố định và giữ tiền 7–14 ngày" with no caveat. The PRD's stakes are market launch, and these numbers are likely to end up in sales and marketing copy, where comparative claims must be backed up.
- **Where it should go:** §1 (restore the caveat) and §13 (add an open question: verify the competitor fee and payout-hold figures before using them in GTM).

### M6. The workshop segment's headline needs were excluded with no logged decision
- **BRD:** §2.2 "Workshop & networking — Nhu cầu nổi bật: Sự kiện định kỳ, hóa đơn".
- **What's missing:** PRD §11.2 puts "Sự kiện định kỳ, hóa đơn điện tử cho Người mua" out of scope. The memlog records no decision and §11.3 has no row. Workshops are still a named Closed Beta segment (§2.1), and SM-4 (a second event within 60 days) relies on repeat events. The PRD doesn't acknowledge that one target segment loses both of its top needs.
- **Where it should go:** §11.3 (log the change and the reason) and §2.1 (note the impact on the segment). Optionally, a lightweight "duplicate event" feature as a Should.

### M7. No public-launch timing; the KYC gate has no phase; the 6-week plan was kept after scope grew
- **BRD:** §15 "MVP dự kiến 6 tuần vì thanh toán đã có sẵn trên Tingee; thủ tục Zalo và pháp lý chạy song song từ tuần 1"; "Tiêu chí mở công khai (tuần 7)".
- **What's missing:** The PRD drops the week-7 target. It adds KYC and anti-fraud as a public-launch gate (gate 3) but schedules them in no phase. FR-6 even defers the specification to a future PRD update. It keeps the 6-week plan although scope grew: buyer accounts, Google and email OTP login, multi-ticket orders, "Vé của tôi", attendance history, the admin console and real-time check-in tracking. Nothing records whether 6 weeks still holds. Starting the legal work in week 1 is also gone, though legal sign-off is gate 4.
- **Where it should go:** §11.4 (a Phase 4 or "pre-public" phase for KYC and anti-fraud, a target public-launch window, a legal workstream starting in week 1) and §9 (a schedule risk).

### M8. Per-attendee identity was lost; the scan screen shows the buyer's name [knock-on]
- **BRD:** §10.1 `attendees` "Từng người dự + câu trả lời form"; US-04 "báo xanh kèm tên khách và hạng vé"; §2.2 sports "Form tùy chỉnh, Sheets để chia bảng".
- **What's missing:** The logged decision to fill the form once per Đơn means a companion's ticket carries only the buyer's details. FR-27 still promises "tên khách" on green, but for a companion that is the buyer's name. FR-29 lookup only works with the buyer's phone or email. For doubles or team sports, the BTC can't get each player's name or level for bracketing, which is the sports segment's stated need. The PRD doesn't state any of these consequences.
- **Where it should go:** FR-9 (an optional per-Vé attendee-name field chosen by the BTC, or state the limit explicitly), FR-27, FR-29, and UJ-1's ending.

### M9. The shareable "link Vé" has no security property [knock-on]
- **BRD:** §12.2 "xem vé qua link có chữ ký".
- **What's missing:** The memlog logs replacing the signed-link view with account-based "Vé của tôi". PRD FR-22 then brings back a shareable "link Vé" for companions without saying whether it needs login (a companion may have no account) or works as an unguessable signed link. Because the link reveals a usable Mã QR vé, it acts as a bearer credential. FR-29 and FR-25 carefully hide the QR elsewhere, so this is the remaining exposure.
- **Where it should go:** FR-22 consequences (signed, unguessable, revoked when the ticket is cancelled or the event ends) and FR-23 (the email link).

### M10. No data-subject rights or account deletion with mandatory accounts [knock-on]
- **BRD:** NFR-08 (NĐ 13/2023) and R-08. The memlog (line 14) lists "account deletion" as a knock-on to resolve.
- **What's missing:** Buyer, CTV and BTC accounts are now mandatory and persist across events, and FR-24 keeps attendance history. The PRD has no FR for deleting an account, withdrawing consent or exporting one's data. The memlog knock-on was never closed.
- **Where it should go:** FR-1 or a new FR in §4.1, §8, and §13 open questions (alongside retention, Q8).

### M11. Payment traceability and support tooling were weakened
- **BRD:** §10.1 `payment_events` "Bản gốc IPN, chống xử lý trùng, tra soát"; `checkins` "Lượt quét: vé, người quét, thời điểm, kết quả"; D-10 (Tickee keeps payment reconciliation records); §3.1 Quản trị Tingee goal "hỗ trợ".
- **What's missing:** PRD FR-19 only says IPNs with a bad signature are "ghi lại để tra soát". Nothing requires keeping the raw IPN for every transaction, keeping a record of every scan attempt (including failures), or giving ops or BTCs a way to trace an order to its IPN and QR status. Detecting and fixing "khách đã trả tiền mà không nhận được Vé", a severe error in SM-1, depends on this. FR-35 gives Tingee admins report and lock views only, with no support or lookup tool.
- **Where it should go:** FR-19 (retain every IPN), FR-27/FR-28 (log every scan result), NFR-11, and FR-35 (an admin support view for an order and its payment).

### M12. Data hosting location and cross-border transfer are not addressed
- **BRD:** Appendix A "cloud trong nước hoặc AWS Singapore"; NFR-08 / R-08 (NĐ 13/2023).
- **What's missing:** Neither the PRD nor the addendum mentions where data is hosted. Hosting personal data in Singapore makes it a cross-border transfer under NĐ 13/2023, which needs its own impact-assessment filing. That is a legal item for the public-launch gate, not just a technical choice.
- **Where it should go:** §8 (a legal item for pre-public launch) and the addendum (the hosting options from Appendix A).

---

## Low

### L1. The fake-screenshot fraud framing was dropped
- **BRD:** §2.1 "dễ sót và **bị lừa ảnh giả**".
- **Missing:** PRD §1 mentions screenshots, but not fraud via fake screenshots, which is a key reason for automatic matching and a strong positioning point for BTCs.
- **Where:** §1 Vision or §2.1 JTBD (BTC).

### L2. The BO-03 metric and the cost comparison table were not carried
- **BRD:** BO-03 metric "Phí trên mỗi vé so với đối thủ"; the §13 table (50/150/300 vé: 200k vs 2,25tr, 600k vs 6,75tr, 1,2tr vs 13,5tr).
- **Missing:** The PRD has no fee-versus-competitor metric and no worked comparison. These are the main evidence for "thấp hơn nhiều lần". The BO-01..05 IDs and their trace to SM-x are also lost.
- **Where:** §12 (a long-term metric), §7 or addendum (comparison table, marked as reference figures).

### L3. The Token step in onboarding is missing from UJ-2
- **BRD:** §5.3 step 4 "BTC mua Token hoặc được cấp hạn mức trả sau".
- **Missing:** UJ-2 goes from payout link straight to opening sales. Nothing warns a BTC when it opens a paid event with zero Token khả dụng, so the first buyer could hit "Tạm ngừng bán". The memlog's "negative/postpaid from the start" decision covers only the case where Tingee grants credit.
- **Where:** UJ-2 step 2, plus FR-5 or FR-34 (a warning or check before publishing a paid event).

### L4. Manual lookup by name was dropped
- **BRD:** FR-21 "Tra cứu và check-in tay theo **tên**/SĐT".
- **Missing:** PRD FR-29 allows lookup by phone or email only. The memlog logs phone/email lookup but not dropping name search. Name is often the fastest way to find a guest at the gate.
- **Where:** FR-29 (restore it, or log the removal, for example for privacy).

### L5. The "mở thêm chỗ" option for orphan payments isn't explicit
- **BRD:** EX-05 BTC action "Tự hoàn hoặc **mở thêm chỗ**".
- **Missing:** FR-21 says manual matching issues a ticket "với điều kiện Hạng vé còn chỗ". It doesn't say the BTC can raise capacity (FR-8 allows increases) to resolve an orphan when the type is sold out.
- **Where:** FR-21 consequences.

### L6. The free-event cap changed from a reference figure to a hard cap
- **BRD:** BR-12 "giới hạn 200 vé/sự kiện (tham khảo)".
- **Missing:** FR-11 makes 200 a hard cap. It is tagged `[ASSUMPTION]` but not logged as a decision and not in §11.3.
- **Where:** FR-11 and §11.3 (confirm and log).

### L7. Manual check-in was quietly promoted from Should to Must
- **BRD:** FR-21 priority Should.
- **Missing:** PRD FR-29 has no Should tag, so it is Must by default. The memlog line 22 says "likely promoted Should→Must; to confirm", and it was never confirmed. §11.3 has no row for it.
- **Where:** FR-29 tag or §11.3.

### L8. Session security and IPN source-IP limits were dropped
- **BRD:** §12.2 "Phiên đăng nhập lưu cookie httpOnly, access token ngắn hạn, refresh token xoay vòng. IPN từ Tingee ... giới hạn IP nguồn nếu được".
- **Missing:** NFR-6 covers signatures only.
- **Where:** NFR-6, or the addendum for Architecture.

### L9. Tingee API conventions weren't carried to the addendum
- **BRD:** §11 "ký bằng x-client-id, x-request-timestamp, x-signature (HMAC SHA512); API luôn trả HTTP 200, thành công khi code = '00'", plus the developer doc links in INT-02 and INT-03.
- **Missing:** The "always HTTP 200, check code" behaviour is an integration gotcha and appears nowhere outside the BRD.
- **Where:** addendum (a new section on Tingee integration notes).

### L10. The Appendix A tech proposal and key mechanisms weren't carried
- **BRD:** Appendix A: the stack (Next.js/NestJS/PostgreSQL PITR/Redis+BullMQ/SSE with QR-status poll fallback/ZXing/Satori/k6). Key mechanisms: the atomic reservation `UPDATE ... WHERE sold + reserved < capacity`; IPN stored with a unique transaction id, return 200 immediately, then process in a single worker transaction; the atomic check-in `UPDATE ... WHERE checked_in_at IS NULL`.
- **Missing:** The addendum exists to hold Architecture-level content but has none of this. Architecture would have to go back to the BRD.
- **Where:** the addendum, or an explicit pointer to BRD Appendix A in PRD §0.

### L11. Starting the Zalo OA application in week 1 was dropped
- **BRD:** R-07 "Nộp tuần 1"; §15 "thủ tục Zalo ... chạy song song từ tuần 1".
- **Missing:** ZNS is deferred (logged), but the next release (ZNS plus phone OTP; addendum §A eSMS GENCODE needs a Zalo OA) depends on a long approval. The PRD doesn't say to start it early.
- **Where:** §11.4 or §6 (Zalo row: "start the OA application during MVP").

### L12. Segment coverage in a 2–5 event beta is undefined
- **BRD:** D-09 "Ngách Closed Beta: Mọi mô hình tương tự: thể thao, workshop, phòng trà, sinh viên".
- **Missing:** The cut to 2–5 events is logged. But with four segments and as few as two events, the PRD doesn't say whether every segment must be covered or which come first.
- **Where:** §11.4 Phase 3, or SM-1.

### L13. Growth through the Tingee merchant network isn't measured
- **BRD:** BO-04 "Tăng trưởng qua mạng lưới merchant Tingee"; R-09 mitigation.
- **Missing:** §12 tracks new BTCs from the ticket footer (FR-36) but not how many arrive via Tingee referral (UJ-2's entry point).
- **Where:** §12 long-term metrics (referral source attribution).

### L14. Email is now the only channel, and no risk is recorded [knock-on]
- **BRD:** R-07 mitigation "email là kênh dự phòng"; INT-08 "Kênh dự phòng của ZNS".
- **Missing:** After the logged ZNS deferral, email carries ticket delivery, login OTP, Token alerts and cancellation notices with no fallback. The risk table has no entry for deliverability (spam folders, delays) blocking login or tickets.
- **Where:** §9 (a new risk; mitigations: Google login, "Vé của tôi", provider choice) and §6 (Email row).

### L15. There are no requirements against seat hoarding or rate abuse
- **BRD:** Appendix A "Redis + BullMQ: ... rate limit, phòng chờ".
- **Missing:** A 15-minute hold, up to 10 tickets per Đơn and no per-account limit (Open Q2) let one account lock a whole ticket type with repeated unpaid orders. The PRD has no rate limit or concurrent-hold limit.
- **Where:** FR-12 or FR-13 consequences, NFR-3, and Open Q2.

---

## Checked and covered (not gaps)

- **Carried faithfully:** FR-03/04/05/07/09–15/18–20/22–27, BR-01–09 and BR-12 (except the cap wording, L6), EX-01–04 and EX-06–09, NFR-01–07 and NFR-09–11, INT-01–06/08/09, A-01–03, C-01/C-03/C-04, DEP-02, R-02–R-06 and R-08–R-09, D-01–D-08 and D-10, launch gates 1, 2 and 4. Also: the no-money-held principle, Tingee as source of truth, the trust line on the dynamic page, the mobile-first Vietnamese UI, "không cần cài app", Social Ticket Card with the QR hidden, the virality footer, and "GTM không dùng tool cào dữ liệu" (§8).
- **Covered by logged decisions:** buyer account required (FR-08, §12.2 buyer, FR-17 OTP lookup); email-only delivery and ZNS deferred (FR-16, US-01 AC3, US-05 Zalo channel, INT-07, DEP-01, ZNS launch gate, §13 ZNS line); phone OTP deferred; KYC deferred to pre-public launch (FR-02 KYC half, BR-10, R-01 KYC and cap mitigations); vouchers removed (FR-06); CTV needs an account (FR-20 link/code, §12.2 CTV); multi-ticket orders and form once per Đơn; Closed Beta 2–5 events; phases re-sequenced (tagged ASSUMPTION); tickets leave "Vé của tôi" after the event; CTV access ends when the event ends.
- **Already raised as open questions in the PRD:** the static-QR hold and the Token khả dụng formula for static QR (BR-06 "số QR đang mở" narrowed to "QR động", Q1); the Token API (A-01, A-02; Q3); waiting-room criteria (NFR-03; Q5); retention (§10.3; Q8).
- **Not BRD-related, noted in passing:** addendum §A still opens with "người mua đăng nhập bằng OTP qua SĐT hoặc Google", which predates the decision to use Google or email OTP only.
