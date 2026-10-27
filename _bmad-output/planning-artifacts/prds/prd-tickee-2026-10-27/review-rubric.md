# PRD Quality Review — Tickee MVP v1

## Overall verdict

This is a well-built PRD. It has a real thesis: auto-matched VietQR replaces Google Forms plus manual bank-statement checks, money goes straight to the BTC, and the fee is far below ticket marketplaces. Its three journeys are earned and each drives FRs, the Glossary and state tables are unusually tight, and nearly every FR carries testable consequences. The §11.3 delta table and R-1's "chấp nhận rủi ro có chủ đích" surface the user's deliberate changes honestly. The risk sits where those changes ripple into payment and lifecycle edges the PRD has not closed:
- the multi-Vé Đơn quietly changes the fee unit;
- the KYC deferral rests on an invite-only control that no FR enforces;
- three money-or-gate paths are unspecified: a late payment that arrives as the hold expires, refunding a single paid Đơn, and what "Sự kiện kết thúc" means.

Close those five highs before Architecture and story creation; the rest is polish or Finalize triage.

## Decision-readiness — adequate

Decisions are stated as decisions:
- §11.3 records every BRD reversal with a reason.
- R-1 says outright that Closed Beta accepts fraud risk.
- FR-6 and §11.4 make KYC a hard gate before public launch.
- The blocking Open Questions are labelled "chặn phần thanh toán" and "chặn Phase 1".
- Someone who doubts the mandatory-login decision finds the objection acknowledged in R-5 and SM-C2.

That is better than most PRDs.

It weakens in three places. Each accepted risk is described by the controls that remain, not by what was given up, and one of those controls does not exist in the product. The case for mandatory login is stated as fact when it is open to dispute. The public-launch gate is worded more loosely than the metric it cites.

### Findings
- **high** R-1's accepted risk rests on an invite-only control that no FR enforces (§9 R-1, FR-2, FR-5, UJ-2) — R-1's mitigation is "chỉ mời các BTC được chọn". But FR-2 lets any Tài khoản Tickee create a BTC, and FR-5 lets any Owner open paid sales once the payout account is linked. In UJ-2, Tuấn arrives through "quảng cáo của Tingee" and signs himself up. There is no allowlist, invite code or Tingee approval step. As specified, any organiser without KYC who finds the site can sell paid tickets. The user accepted the risk of a handful of hand-picked BTCs; the spec carries a much larger one. R-1 also omits that per-event caps on tickets or amounts were considered and declined (memlog), so a reader can't see the alternative that was turned down. *Fix:* add an FR that gates Closed Beta, removable at public launch: creating a BTC or opening paid sales needs an invite or approval from Quản trị Tingee. State the vetting criteria and who vets. Add one line to R-1 naming the rejected caps.
- **medium** The case for mandatory login is overstated (§4.1 Mô tả, §2.1 JTBD #2, §11.3 row 1) — the stated benefit is "BTC biết người mua là người thật chứ không phải bot". Google sign-in and email OTP are cheap for bots to pass, and the PRD itself still needs a waiting room (NFR-3) and leaves per-account Vé limits open (OQ #2). The bot objection is never addressed, and the decision has no stated condition for reversing it. *Fix:* state the benefit honestly: "Vé của tôi", better buyer identity and contact data, and some friction for bots. Attach a reversal trigger to SM-C2 (see Strategic coherence).
- **medium** Public-launch gate #2 is looser than the metric it cites (§11.4 Điều kiện mở công khai #2, §12 SM-2) — the gate says "Đa số Đơn tự duyệt" while SM-2 targets ≥95% for QR động and ≥80% for QR tĩnh. "Đa số" passes at 51%. *Fix:* have the gate cite the SM-2 thresholds, or state that it is deliberately looser and why.
- **low** Two loose ends (§13 OQ #9 vs FR-1; §11.3 Voucher row) — FR-1 hands the 2FA method to Architecture ("phương thức do Architecture chọn"), yet OQ #9 keeps it as a PM question. The voucher cut's reason, "Chưa cần thiết", gives a stakeholder nothing to challenge. *Fix:* drop OQ #9 or remove the hand-off. Give the voucher cut one line of reasoning, e.g. "not requested by beta segments; saves build time".

## Substance over theater — strong

Nothing here is furniture:
- **Protagonists:** Minh, anh Tuấn and Lan each drive concrete FRs, and their failure branches map straight to FR-14, FR-21 and FR-29.
- **JTBDs:** they lead to decisions. "Không phải duyệt tay" leads to SM-2; "không sợ bán quá số suất" leads to FR-13.
- **Vision:** specific to this product: VietQR, money straight to the BTC, distribution through Zalo and Facebook, check-in in the browser. It could not be swapped into another ticketing PRD.
- **NFRs:** most have numbers (2 s, 3 s, 1 s, 5.000 buyers for 300 Vé, 99,9%) tied to named flows, and the PRD honestly calls them "mục tiêu đề xuất" pending engineering.

The soft spots are the differentiation claim and a few NFRs.

### Findings
- **medium** The main differentiation claim has no source or tag, and fails for cheap tickets (§1 para 2, §2.1 JTBD #3, §7) — "Sàn vé thu 8–15% kèm phí cố định và giữ tiền 7–14 ngày" and "thấp hơn nhiều lần" are the PRD's main market claim. Neither has a source or an `[ASSUMPTION]` tag, and the landscape research was stopped. The BRD's own caveat ("số liệu nghiên cứu ban đầu, cần kiểm tra lại") was dropped along the way. The claim also fails for cheap tickets. At the §7 reference rate of 3.000–5.000đ/Vé, a 50.000đ student or bóng đá phủi ticket pays 6–10%, about what a marketplace charges, not "nhiều lần" less. It holds only for tickets around 300.000đ, or if the fee is charged per Đơn (see the high finding under Strategic coherence). *Fix:* tag or source the competitor figures, and qualify the claim by ticket price band, or by per-Đơn charging once that is settled.
- **low** Some NFRs use adjectives instead of numbers (§5 NFR-10, NFR-5, NFR-9) — NFR-10 says "tỉ lệ phát Vé giảm bất thường" and "hàng đợi … bị ùn". NFR-5 says "khôi phục được về một thời điểm bất kỳ" with no recovery-point or recovery-time target. NFR-9 says "Tối ưu cho điện thoại". *Fix:* give alert thresholds (e.g. IPN error rate above x% over 5 min, email queue older than N min), recovery-point and recovery-time targets, and a minimum device or viewport.
- **low** R-10's mitigation is generic (§9 R-10) — "Trải nghiệm sản phẩm và mạng lưới merchant Tingee" would fit any product. *Fix:* name the specific moat (e.g. settlement straight to the BTC, available only through Tingee, plus automatic IPN matching), or drop the row.

## Strategic coherence — adequate

The thesis is clear: remove the manual work and the trust gap of events paid by bank transfer, with auto-matched VietQR, instant Vé, no money held, and a cheap per-transaction fee. The scope follows from it, and FR-12 to FR-21 rightly make up most of the build. Each primary metric tests a part of the thesis:
- SM-1 measures correctness.
- SM-2 measures orders approved automatically.
- SM-3 measures speed.
- SM-4 measures whether BTCs come back.
- SM-5 measures setup time.

Counter-metrics exist, which is uncommon. This is a correctness MVP, and the Closed Beta gates match that.

The cracks are in the money model and in whether the metrics can force a decision:
- The user's multi-Vé Đơn decision changed the unit Tickee earns on without saying so.
- The counter-metrics have no thresholds, so they can't trigger anything.
- SM-2's own denominator makes it easy to game.
- Nothing in the launch gates asks whether BTCs actually want the product.

### Findings
- **high** The fee unit contradicts itself, and the multi-Vé Đơn decision changes unit economics without saying so (§7 bullets 3–4, §3 Token, §1 "theo từng giao dịch", FR-12, addendum §A) — Token is deducted "cho mỗi Webhook báo một giao dịch", and one Đơn is one QR thanh toán and therefore one transaction. Yet the reference price is quoted as "3.000–5.000đ/Vé", and the addendum compares OTP cost against "3.000–5.000đ/vé". Orders can hold up to 10 Vé by default (FR-12), so revenue per Vé can fall as much as tenfold against the BRD's model. The long-term metric "Số Token tiêu thụ" and the claim "thấp hơn nhiều lần" both depend on which unit is true. *Fix:* state the charging unit: per transaction (per Đơn) or per Vé. If per Vé, say how Tingee learns how many Vé a transaction covers. Add a line to §11.3 or §7 on the revenue impact of multi-Vé orders, and get Tingee's sign-off.
- **medium** The counter-metrics have no thresholds, so they can't stop anything (§12 SM-C1–SM-C3, §9 R-5) — "Không được tăng lên" and "Không được kéo SM-2 lên…" come with no baseline, ceiling or decision rule. SM-C2 is the only check on the mandatory-login bet (R-5: "Theo dõi SM-C2"), yet no drop-off level triggers a rethink. *Fix:* give each counter-metric a ceiling and an action. For example: if SM-C2 exceeds 25% of "Mua" clicks at any beta event, review guest checkout before public launch; if SM-C3 exceeds N items per event, review the QR tĩnh guidance.
- **medium** SM-2's denominator makes it easy to game, and SM-2 is a launch gate (§12 SM-2, §3 Trạng thái Đơn) — the denominator is "tổng số Đơn có phí đã thanh toán", and §3 defines Đã thanh toán as "Đã khớp IPN và phát Vé". So rejected Cần xử lý items (Đã hủy or Đã hoàn tay) and unmatched transactions never enter the denominator. A BTC that rejects or ignores problem transactions raises its SM-2. *Fix:* define the denominator as every paid-in transaction (by IPN) for paid Đơn, including Cần xử lý outcomes and unmatched transactions.
- **medium** The public-launch gates measure no product value, and SM-4 can't be measured in time (§11.4, §12 SM-4) — all four launch conditions are about correctness or compliance. SM-4 has a 60-day window that starts in Phase 3 (weeks 5–6), so it can't report before the public-launch decision unless launch waits two months. SM-5 is not a gate either. The launch decision therefore can't use any evidence that BTCs want the product. *Fix:* add a value gate measurable inside the beta, such as SM-5's median or BTCs' stated intent to reuse. Otherwise state that public launch waits for SM-4.
- **medium** There's no cut line, and the priority of cancellation is inconsistent (§4 MoSCoW tags, §11.4, FR-7, FR-33) — 33 of 36 FRs are implicitly Must inside a 4-week build (Phases 1–2). Nothing says what drops if Phase 1 slips, and Phase 1 already hinges on OQ #3. FR-7 lists "hủy" as a Must, and §3 defines "Đã hủy" states for Đơn and Vé, yet FR-33 "Hủy Sự kiện" is only a Should. Outdoor sports in the beta segments get rained out, so cancellation will likely be needed during the beta itself. *Fix:* rank the Musts, or tag the ones that can slip (e.g. FR-32 Sheets, FR-30, the waiting room). Promote FR-33 to Must, or remove "hủy" from FR-7.
- **low** Two metrics lack a data source (§12 Dài hạn, SM-3) — the long-term acquisition indicator depends on FR-36, which is only a Could. SM-3 starts "từ lúc tiền vào tài khoản BTC", which Tickee can't observe. *Fix:* note that the indicator needs FR-36 (or attribution through Tingee referrals). Define SM-3's start as the bank transaction timestamp carried in the IPN.

## Done-ness clarity — adequate

Most FRs are genuinely testable, and story creation can lift these directly:
- FR-13 covers the race for the last seat and the all-or-nothing hold across tiers.
- FR-19 covers processing each IPN only once, rejecting bad signatures, and recording payment and issuing Vé as one atomic step.
- FR-27 and FR-28 define every scan outcome and which scanner wins a concurrent scan.
- FR-32 has a 1-minute bound.

The gaps cluster at state transitions that the user's changes introduced or that span systems:
- what happens to money that arrives as a hold expires;
- when an event "ends";
- who can open a shared Vé;
- what the operator actually checks before a manual check-in.

Several of these produce the very SM-1 critical errors the PRD says must not happen: "khách đã trả tiền mà không nhận được Vé" and "check-in sai".

### Findings
- **high** A late payment on QR động after the hold expires is undefined (FR-14, FR-19, FR-20, §3 Trạng thái Đơn) — FR-14 releases the hold at 15:00 and sets the Đơn to "Hết hạn". FR-20 starts Đối soát bù only "sau 2 phút" without an IPN. So a buyer who pays at 14:50 and whose IPN is delayed or lost is confirmed after the hold is gone, possibly after the tier has sold out. FR-17 handles this "mồ côi" case for QR tĩnh only. The state table has no transition from Hết hạn to Đã thanh toán or Cần xử lý. This is one of the PRD's own SM-1 critical errors. *Fix:* add a rule. Either release the hold only after a final status check with Tingee, or treat a late-confirmed QR động payment exactly like FR-17: issue Vé if seats remain, otherwise send it to Cần xử lý as "Thanh toán mồ côi" and email the buyer. Add the transition to §3.
- **high** "Sự kiện kết thúc" has no defined trigger, yet three behaviours depend on it (§3 Trạng thái Sự kiện, FR-24, FR-26, UJ-1 and UJ-3 Kết thúc) — when an event ends, its Vé leave "Vé của tôi", the Mã QR vé is invalidated (per the FR-24 assumption), and CTV rights expire. Nothing says whether "ends" means the configured end time, the end time plus a grace period, or a manual action. If it is the end time, an overrunning tournament or a late arrival loses both the Vé and the scanners mid-gate. *Fix:* define the trigger, e.g. "kết thúc = thời gian kết thúc + N giờ, hoặc Owner/Admin bấm kết thúc sớm". State that check-in stays valid until then.
- **medium** The waiting room is a feature hidden in an NFR, yet it gates a phase (§5 NFR-3, §11.4 Phase 2, OQ #5) — "Có phòng chờ cho Sự kiện đông người mua" has no FR, no buyer-facing behaviour and no trigger, and OQ #5 is still open. Yet Phase 2 can't finish until "Kiểm thử tải NFR-3 đạt". *Fix:* write an FR covering the trigger, what the buyer sees, and how admission interacts with Giữ chỗ. Otherwise let the load test pass on oversell correctness alone and defer the waiting room.
- **medium** Access to a shared Vé is undefined, so the end of UJ-1 can't be built (FR-22, UJ-1 Kết thúc) — Minh shares a Vé with his partner by "gửi link Vé hoặc ảnh Vé". The PRD doesn't say whether the Vé link opens without login. The partner usually has no Tài khoản Tickee, and the Vé sits in Minh's account. If the link is public, anyone holding it can use the Vé. *Fix:* state the rule. For example, each Vé link is an unguessable signed URL that opens without login and shows only that Vé, with no revocation in MVP. Note the risk of the link being forwarded.
- **medium** Manual check-in has no verification step and no rule for multi-Vé orders (FR-29, FR-9, UJ-1 and UJ-3 Tình huống lỗi) — the lookup key is an SĐT the buyer typed in, never verified, since phone OTP is deferred. The operator is told only to "tra … rồi check-in tay". The PRD doesn't say what to check before letting someone in. Nor does it say which Vé of an N-Vé Đơn gets checked in, and every Vé shows the buyer's name because the form is filled once per Đơn. Anyone who knows a buyer's phone number can take that buyer's place, and the real holder then gets a red scan. This risk is not in §9. *Fix:* require the operator to select a specific Vé, state the minimum check (e.g. name and email match), and add an impersonation row to §9.
- **medium** Paid events with a free tier, and 0đ orders in paid events, are undefined (FR-11, §3 Sự kiện miễn phí) — a "Sự kiện miễn phí" requires every tier to be 0đ. A paid event with a free tier (say, a spectator pass), or a Đơn containing only 0đ tiers, is not covered. Does it get a QR? Does it use Token? Does it need a linked payout account? *Fix:* either forbid 0đ tiers in paid events, or state that a Đơn with only 0đ tiers gets its Vé at once with no QR and no Token. State that FR-11's 200-Vé cap applies only to fully free events.
- **medium** Orphan payments and rejections in Cần xử lý are underspecified (FR-21, FR-17) — the "còn chỗ" condition is stated only for manually matching a transaction to a Đơn. Can a BTC manually approve an underpaid Đơn or an orphan payment when the tier is full, overriding FR-13, or is a refund the only path? When the BTC rejects an item, is the buyer told? FR-17 emails the buyer only when the orphan is created. *Fix:* state that manual approval never exceeds số suất (or that the Owner may raise số suất explicitly). State that a rejection emails the buyer with the BTC's refund contact.
- **medium** Two FRs have no testable bound (FR-30, FR-9) — FR-30 is a single sentence ending in "cập nhật liên tục", with no Hệ quả and no latency, though UJ-3 step 4 relies on it. FR-9's "Các trường bổ sung khác" is undefined, sitting next to the "câu hỏi riêng" types that are defined. *Fix:* for FR-30, require the check-in count to update within N seconds of a scan. For FR-9, list the extra field types or delete the bullet.
- **low** Smaller consequences are unbounded (FR-23, FR-26, FR-35) — FR-23 email is now the only delivery channel, yet it has no delivery-time target or retry limit. FR-26's invite link "có thời hạn" with no duration given. FR-35 doesn't say who may report (logged-in users only? buyers of that event?) or how to limit abusive reports. *Fix:* add an email delivery target (e.g. 95% within 2 min) and a retry limit, a default invite duration, and who is allowed to report.

## Scope honesty — adequate

Scope is mostly explicit:
- §10 Non-Goals does real work ("không giữ tiền", "không phải chợ vé").
- §11.2 lists what is deferred, and FRs carry their own "Ngoài phạm vi".
- FR-6 openly defers KYC to "một bản cập nhật PRD".
- §6 admits that Tingee's agreement to create a Merchant con without KYC is "đã xác nhận bằng lời, cần văn bản xác nhận".
- Every inline `[ASSUMPTION]` appears in the Assumptions Index.

The count of open items is high for a market-launch PRD: 10 Open Questions and 24 inline `[ASSUMPTION]` tags. As briefed, most are user-approved and await Finalize triage, so that is expected. What matters is that the two blockers have no owner or date.

The real scope problems are silent omissions: capabilities that are neither in nor out of scope and that a reader would assume exist.

### Findings
- **high** There is no way to cancel or refund a single paid Đơn (FR-7, FR-21, FR-33, FR-4, §3 Trạng thái Đơn and Vé, R-2) — a refund policy is mandatory (FR-7: "Chính sách hoàn vé là trường bắt buộc"), and R-2 rates refund disputes Cao. Yet a Đơn reaches "Đã hoàn tay" only by rejecting a Cần xử lý item (FR-21) or by cancelling the whole event (FR-33, a Should). When a BTC honours its policy for one buyer, that buyer's Vé stay Hợp lệ and the seats never return to sale. The FR-4 matrix has no row for this. *Fix:* add an FR. Owner or Admin cancels a paid Đơn (all or selected Vé). The Vé become Đã hủy, the seats are released and the buyer is emailed. The Đơn becomes "Đã hoàn tay" once the BTC confirms the manual refund. Log it under NFR-11.
- **medium** Blocking items have no owner, date or fallback (§13 OQ #1, OQ #3, §9 R-9, §6 Master Merchant row) — OQ #3, the Token API, is marked "chặn Phase 1". Phase 1 is weeks 1–2, and one of its exit criteria is "hết Token thì 'Tạm ngừng bán'". R-9 says only that FR-15 and FR-34 "phải thiết kế lại" if the API is missing, and gives no fallback. OQ #1 is marked "chặn phần thanh toán". Tingee's written confirmation that a Merchant con can be created without KYC is not tracked as an OQ or a risk, though the whole beta depends on it. *Fix:* give each blocker an owner and a decide-by date. Sketch a fallback for FR-15, e.g. Tickee estimates Token khả dụng from its own IPN count times the agreed rate. Add the Merchant con confirmation to §13 or §9.
- **medium** Account lifecycle is silently left out (§4.1, §8, Owner in §3) — the memlog flagged "account deletion" as a knock-on of mandatory buyer accounts, but the PRD has:
  - no account deletion or withdrawal of consent (data-subject rights under NĐ 13/2023);
  - no way to transfer the Owner role;
  - no recovery if the Owner loses access.

  The Owner is a single point of failure: the only role that can link the payout account or manage Token, and it requires 2FA. *Fix:* add FRs, or mark these `[NON-GOAL for MVP]` and give the manual support procedure for the beta.
- **medium** There is no fallback when the gate loses connectivity (§11.2 "check-in offline", §5 NFR-4, §9) — offline check-in is out of scope, but nothing says what a CTV does when 4G fails at a sân Pickleball or a basement livehouse, and no risk row covers it. Every check-in FR assumes a connection. *Fix:* add a risk row and a minimal fallback, e.g. a pre-event CSV guest list from FR-31 for paper check-in, reconciled afterwards. Otherwise state that the beta accepts this risk.
- **low** It's unclear who builds the admin console, and callouts are inconsistent (FR-35, FR-20 "Lưu ý", FR-35 "Ghi chú") — "Quản trị Tingee có nơi xem danh sách báo cáo…" doesn't say whether Tickee builds this console or Tingee provides it. Real tensions are flagged with ad-hoc "Lưu ý" and "Ghi chú" notes rather than a consistent `[NOTE FOR PM]` that Finalize triage can search for. The PRD has no `[NOTE FOR PM]` at all. *Fix:* state who builds the admin console, and convert the two notes to `[NOTE FOR PM]`.

## Downstream usability — strong

The PRD extracts cleanly into UX, Architecture and stories:
- The Glossary covers every domain noun the FRs use, with state tables for Đơn, Vé and Sự kiện.
- The ID series are all contiguous and unique: FR-1–FR-36, NFR-1–NFR-12, SM-1–SM-5, SM-C1–SM-C3, R-1–R-10, UJ-1–UJ-3 and OQ 1–10.
- Every cross-reference resolves: FR to NFR, FR to OQ, SM to FR.
- All three UJs have named protagonists whose context is given inline.
- Sections stand alone, because they point to Glossary terms rather than saying "xem trên".

### Findings
- **medium** There's no term for the attendee, and the undefined word "khách" fills the gap (§3, FR-27, FR-29, UJ-3, FR-24) — the multi-Vé Đơn decision separates the Người mua from the person holding each Vé. The Glossary defines Vé as "Quyền vào cổng của một người" but has no term for that person. FR-27 shows "tên khách" on scan, but the form is filled once per Đơn, so every Vé carries Minh's name, including his partner's. FR-24 shows the buyer a "lịch sử đã tham dự" even if only the partner attended. UX and the data model will each have to guess. *Fix:* add "Người tham dự", or state explicitly that in MVP a Vé carries only the Người mua's name. Replace "khách" accordingly.
- **low** BRD IDs collide with PRD IDs (§11.3, §11.4 assumption) — "tra Vé bằng OTP (FR-17)" refers to BRD FR-17, while PRD FR-17 is QR tĩnh. "US-01 và US-05" are not defined in this PRD. §0's disclaimer helps human readers, but extraction tools won't see it. *Fix:* prefix every BRD reference, e.g. "BRD FR-17", "BRD US-01".
- **low** The FR references at the end of each UJ have drifted from the narrative (UJ-1, UJ-2, UJ-3):
  - UJ-2 cites FR-30 (check-in tracking) and FR-11 (free events), neither of which its story mentions. It omits FR-19 and FR-21, which its climax depends on.
  - UJ-3 step 4 ("BTC theo dõi… thời gian thực") doesn't cite FR-30.
  - UJ-1 cites FR-25, which its story never mentions.

  *Fix:* re-sync the references.

## Shape fit — strong

The shape matches the product. Tickee is B2B2C with several stakeholders and real UX on three surfaces: buyer checkout, the BTC console and the CTV scanner. The three UJs with named protagonists carry real weight. The PRD sits at the top of the chain (UX → Architecture → stories), and its density of traceability fits that. The extra sections are warranted for a payments product heading to market, not padding:
- §6 integrations
- §7 fee model
- §8 legal
- §9 risks

The PRD is in effect a Closed Beta spec with explicit gates for public launch, and FR-6 says so plainly. That is the honest shape.

### Findings
- **low** The main beta fraud control has no operator flow (FR-35, §13 OQ #7) — during Closed Beta, Quản trị Tingee's loop of report, review, lock and notify is the main fraud defence (§4.9 Mô tả). Yet Quản trị Tingee is the only actor without even a short flow. *Fix:* once OQ #7 is answered, add a 4–5 step operator flow to FR-35. A full UJ isn't needed.
- **low** A public-scale load target gates a small beta (§11.4 Phase 2, NFR-3, NFR-4) — Phase 2 must pass the test with 5.000 concurrent buyers before a beta of 2–5 events at 30–300 guests each. No overselling under concurrent load does belong before the beta. The full waiting room and the 99,9% uptime target arguably belong to the public-launch gate. *Fix:* split NFR-3 into a beta gate (no overselling at N concurrent buyers) and a public-launch gate (5.000 buyers plus the waiting room).

## Mechanical notes

- **IDs:** FR-1–36, NFR-1–12, SM-1–5, SM-C1–C3, R-1–10, UJ-1–3 and OQ 1–10 are contiguous with no duplicates. All internal cross-references resolve: FR to NFR, FR to OQ #1/#2/#4/#5/#6/#7, R-5 to SM-C2, §11.4 to SM-2, and SM to FR.
- **Assumptions Index:** the 24 inline tags map to 19 index bullets, and everything tagged inline is indexed. Three entries don't match:
  - The §14 FR-34 entry ("Hạn mức âm hoặc trả sau vẫn chịu FR-15") has no inline tag; FR-34's third bullet states it as fact.
  - The §14 entry for §3 covers "trạng thái Đơn, Vé và Sự kiện", but only the Đơn table is tagged inline.
  - The §14 FR-17 entry drops the inline second clause ("tiền về sau khi đã trả lại chỗ thì xử lý theo FR-21").

  The §1 competitor figures for fees and holding periods are an inference that should be tagged.
- **Glossary drift:**
  - "khách" (UJ-3, FR-27, FR-29) is undefined; see Downstream usability.
  - "Tạm ngừng bán" (FR-15) is a displayed condition, not a §3 Sự kiện state; say so.
  - "Phòng chờ" (NFR-3) is not defined.
  - The Glossary entry "Giữ chỗ … kéo dài đúng thời hạn QR thanh toán (15 phút)" doesn't fit QR tĩnh, which never expires; FR-17 assumes 15 minutes.
  - The bare "QR" in FR-14 should be "QR thanh toán".
- **State machine:** §3 allows Ẩn, Đã hủy and Bị khóa only from "Đang mở bán". Locking a BTC (FR-35) also affects its events in Nháp or Ẩn, and the move from Ẩn back to Đang mở bán isn't listed. The state machine is tagged for Architecture, but these are product rules.
- **Consent timing:** FR-3 asks for consent "trước khi gửi Đơn đầu tiên", while §8 says "khi tạo Tài khoản Tickee hoặc khi gửi Đơn đầu tiên". BTC members and CTVs never place a Đơn, so under FR-3 they never give consent. Pick one trigger.
- **Addendum §A is out of date:** its Bối cảnh says "người mua đăng nhập bằng OTP qua SĐT hoặc Google" for MVP. That contradicts FR-1, where MVP login is email OTP or Google and phone OTP is deferred. Relabel the section as research for the later phone-OTP and ZNS release.
- **Product name:** the title still carries "*Tên làm việc — cần xác nhận.*" For a market-launch PRD, add confirming the name to §13.
- **Required sections:** all are present for market-launch stakes: Vision, users and JTBD, UJs, Glossary, FRs, NFRs, integrations, fee model, legal, risks, Non-Goals, scope with the BRD delta, phases and gates, success metrics with counter-metrics, Open Questions, and the Assumptions Index.
