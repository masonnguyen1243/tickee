# Reconciliation: brd-data-model-notes.md vs PRD Tickee (2026-10-27)

- Source: `../../brd-data-model-notes.md` (7 business questions, 2 technical points, 6 "confirmed as sound" items)
- Checked against: `prd.md`, `addendum.md`, decision log `.memlog.md`
- Rule: deliberate user decisions in `.memlog.md` are not gaps. Technical points may be deferred to Architecture; flagged only if the PRD gives Architecture nothing to work from.

Status legend: **Answered** (settled as a requirement) · **Assumption** (settled only via `[ASSUMPTION]`) · **Open Q** (listed in §13) · **N/A (deliberate)** (removed by a logged user decision) · **Deferred (OK)** (left to Architecture with enough to work from) · **Dropped** (not addressed anywhere).

## Summary

| # | Note item | Overall status | Worst gap |
|---|---|---|---|
| 1 | Multi-ticket / multi-tier orders, form per attendee | Answered | Medium |
| 2 | Voucher scope + price snapshot | N/A (deliberate) + Answered | none |
| 3 | Voucher use held 15 min | N/A (deliberate) | none |
| 4 | CTV account / OTP, invites, scanner identity | Answered (one Assumption) | Medium |
| 5 | Report workflow, who handles, lock level | Partially answered + Assumption + Open Q #7 | Medium |
| 6 | Sheets edits/deletes, row mapping, OAuth token | Assumption + Open Q #6 | Medium |
| 7 | "Cần hoàn" / "Đã hoàn tay" on cancellation | Answered (state list is Assumption) | Medium |
| 8 (tech) | OTP storage, TTL, attempt limit | Superseded; Deferred (OK) | Low |
| 9 (tech) | Two sources of held count, atomic release, reconciliation | Deferred (OK) for mechanics; business rule missing at expiry boundary | **High** |
| S1–S6 | Confirmed-as-sound items | All reflected | Medium (S2 knock-on) |

Gap count: **High 1 · Medium 9 · Low 9**

---

## 1. Multi-ticket / multi-tier orders; separate form per attendee? (FR-04, FR-08, BR-01)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| One order, many tickets, many tiers | Answered | §3 Glossary "Đơn"; FR-12; UJ-1 step 1; §11.3 row 6; memlog L19, L24 | none | – |
| Form per attendee vs per order | Answered | FR-9 hệ quả 1; §3 "Đơn"; UJ-1 step 3 | none (deliberate: one form per order) | – |
| Ticket linked to a tier ("attendee chưa gắn ticket_type") | Answered | §3 "Hạng vé", "Vé"; FR-22 (N tickets, N QR); FR-27 shows Hạng vé on scan | none | – |
| Hold for multi-qty, multi-tier (`reserved + 1` problem) | Answered | FR-13 hệ quả 2 (all-or-nothing across tiers, names the sold-out tier); FR-8 hệ quả 2 | none | – |
| Holder identity per Vé | Dropped (knock-on) | FR-27 / UJ-3 show "tên khách" on scan; FR-29 lookup by buyer SĐT/email; FR-22 sharing to companions | With one form per Đơn, no ticket carries its own holder name. Unstated: what "tên khách" the scanner shows for a companion's ticket (buyer's name on every ticket?), and in FR-29 manual check-in, how CTV picks which of the order's N tickets to check in when a companion cannot open theirs (the companion must also know the buyer's phone/email). | Medium |
| Max tickets per order / per account | Assumption + Open Q | FR-12 `[ASSUMPTION: 10 Vé/Đơn, BTC chỉnh]`; §13 Q2 | Already tracked; no new gap | Low |

## 2. Voucher per order or per ticket? Limit per phone? Order stores price at purchase and applied voucher (FR-06)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| Voucher scope, per-phone limit, voucher stored on order | N/A (deliberate) | §11.2 "Voucher: chưa cần thiết"; §11.3 row 4; memlog L62 | none | – |
| Price snapshot at purchase | Answered | FR-8 hệ quả 3 ("Giá được chốt vào Đơn tại thời điểm đặt"); FR-12 hệ quả 2 | none | – |
| Per-buyer purchase limit (spirit of "giới hạn mỗi SĐT") | Open Q | §13 Q2 (per Tài khoản Tickee per Sự kiện) | Tracked | – |

## 3. Voucher use held 15 min like tickets? (FR-06, BR-02)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| Voucher hold | N/A (deliberate) | §11.2; §11.3 row 4; memlog L62 | none | – |

## 4. CTV needs account or OTP? Invites table (hash, expiry, revoke); `checkins` scanner reference (FR-20, §12.2)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| CTV identity | Answered | §3 "CTV", "Tài khoản Tickee"; FR-26; §11.3 row 5; memlog L49, L52 | Shared account type for buyer/BTC/CTV is an `[ASSUMPTION]` (§3, §14) but low-risk | – |
| Invite expiry and revocation | Answered | FR-26 hệ quả 2–3 (expires, revocable, revoke effective on next scan; auto-ends at event end) | none | – |
| Scanner reference | Answered | FR-27 hệ quả 2 (time + previous scanner); FR-28; FR-29 hệ quả 3 (records performer); §11.3 row 5 reason | Scanner = Tài khoản Tickee (CTV/Owner/Admin) | – |
| Invite link model and acceptance control | Assumption | FR-26 hệ quả 3 `[ASSUMPTION: một link nhiều CTV hay mỗi CTV một link — UX/Architecture quyết]`; §14 | Left to UX/Architecture, but it is a business/security choice: the link is sent "qua bất kỳ kênh nào", and accepting it grants check-in plus FR-29 phone/email lookup of attendee names. Not settled: whether a link is single-use or bound to an invitee email, whether BTC sees or approves who accepted, link lifetime. | Medium |
| Trigger for "Sự kiện kết thúc" | Dropped | §3 event states (Đang mở bán → Đã kết thúc); FR-24; FR-26 hệ quả 2 | The transition drives both CTV expiry and ticket removal from "Vé của tôi", but nothing says whether it fires at the event end time, on a manual action, or after a grace period. An event that overruns its end time would lock CTVs out mid-gate. | Low |

## 5. Report-handling workflow, who handles, lock level; no `reports` table, no Event/BTC lock state (FR-26, R-01)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| Who reports, who handles | Answered | FR-35 (Người mua reports with reason; Quản trị Tingee reviews); §3 "Quản trị Tingee" | none | – |
| Lock level | Answered | FR-35 hệ quả 1–2 (Sự kiện or whole BTC); §3 event state "Bị khóa" | none | – |
| Issued tickets of a locked event | Assumption + Open Q | FR-35 hệ quả 3 `[ASSUMPTION: vẫn hợp lệ trừ khi Quản trị Tingee vô hiệu]`; §13 Q7 | Tracked | – |
| Workflow (who is on duty, SLA, notify BTC/buyers) | Open Q | FR-35 Ghi chú; §13 Q7 | FR-35 is the only fraud control in Closed Beta (R-1 Cao, KYC deferred, no compensating cap per memlog L37), yet Q7 is not marked blocking and is not tied to any Phase 2/3 exit or Closed Beta gate in §11.4. | Medium |
| BTC-level lock state and effects | Dropped (partial) | §3 has an event "Bị khóa" state but no BTC status list; FR-35 hệ quả 2 only says "ngừng nhận Đơn" | The note flagged missing lock states for BTC. Undefined: what a locked BTC can still do (sign in, dashboard, handle "Cần xử lý", export refund list, run check-in for sold events, create events), and what happens to orders "Chờ thanh toán" with open QR, or money arriving after a lock (event or BTC). Event lock is only reachable from "Đang mở bán", not from Ẩn/Nháp. Unlock target state is unstated. | Medium |
| Quản trị Tingee role in the account and permission model | Dropped | FR-4 matrix has no Quản trị Tingee column; FR-35 hệ quả 4 "có nơi xem danh sách báo cáo"; NFR-7 | The most privileged, cross-tenant role has no permission row, no sign-in or 2FA requirement (BRD §12.2 had an IP restriction for Tingee admin; PRD drops it), and NFR-7 gives no stated exception to tenant isolation. Architecture has to invent the platform-admin model. | Medium |
| Reporter eligibility and abuse | Dropped | FR-35 "Người mua báo cáo" | Unclear whether a reporter must be signed in or hold an order for the event (the public page needs no login), and no guard against spam or brigading reports. | Low |

## 6. Sheets: BTC edits/deletes columns or rows; store row-to-order map; encrypt OAuth token (FR-22, US-06)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| BTC edits/deletes rows or columns | Assumption + Open Q | FR-32 hệ quả 4 `[ASSUMPTION: ghi lại dòng bị mất, không ghi đè cột BTC thêm]`; §13 Q6; §14 | Tracked. The assumption doesn't cover BTC re-sorting rows or deleting/renaming Tickee-owned columns; fold this into Q6. | – (tracked) |
| Row granularity vs multi-ticket decision | Dropped (knock-on) | FR-32 "ghi mỗi Đơn thành một dòng ... cập nhật trạng thái check-in" | Check-in is per Vé (FR-22, FR-28), but the Sheet row is per Đơn. How a row shows partial check-in (for example 2 of 3) is undefined. The same question applies to the CSV (FR-31). | Medium |
| Sheet scope and which statuses create rows | Dropped | FR-32 | Not stated: whether there is one Sheet per BTC or per Sự kiện. The rule for when a row appears is ambiguous: "ghi mỗi Đơn" suggests at creation, while hệ quả 1 says on payment. Unclear whether Hết hạn/Cần xử lý/Đã hủy/Đã hoàn tay are written. | Low |
| OAuth expiry | Answered, but duplicated as Open Q | FR-32 hệ quả 3 (dashboard asks BTC to reconnect) vs §13 Q6 still asks it | Minor inconsistency; close Q6's OAuth half | Low |
| Row-to-order mapping | Deferred (OK) | FR-32 (update-in-place outcome) | Architecture can derive | – |
| OAuth token encryption at rest | Deferred, thin | NFR-6 covers HTTPS, signatures, QR signing and 2FA only | No requirement for encrypting stored third-party credentials (Google refresh token, Tingee keys). Architecture will likely do it anyway, but the PRD gives nothing. | Low |

## 7. Cancellation + refund list: no "cần hoàn" / "đã hoàn tay" order status; can BTC mark manual refund? (FR-25, EX-08, D-06)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| BTC marks manual refund | Answered | §3 order state "Đã hoàn tay"; FR-33 hệ quả 3; FR-21 hệ quả 3; state list `[ASSUMPTION]` (§3, §14) | none | – |
| Distinct "needs refund" state; money at the cancellation boundary | Dropped (partial) | §3 "Đã hủy" = event cancelled OR rejected Cần xử lý; FR-33 | There is no "Cần hoàn" state, so "Đã hủy" mixes orders with money received and orders without. Undefined: what happens to "Chờ thanh toán" orders and open QRs at cancellation, and to IPNs that arrive after cancellation. The refund list scope is also undefined: only Đã thanh toán, or also Cần xử lý items where money was received (Lệch số tiền, Thanh toán mồ côi, Giao dịch chưa khớp)? | Medium |
| Priority mismatch | Dropped (inconsistency) | FR-7 / FR-4 "hủy" is Must; FR-33 (what cancel does) is Should; §11.1 lists it under Should | If FR-33 slips, the Must cancel action has no defined effect on tickets, buyer emails, refund list or "Đã hoàn tay" marking. The answer to note #7 lives entirely in a Should FR. | Medium |
| Refunding one paid order outside cancellation | Dropped | FR-7 makes refund policy mandatory; FR-21 / FR-33 are the only paths to "Đã hoàn tay" | A BTC honouring its own refund policy for one buyer (whole or partial, e.g. 1 of 3 tickets) cannot mark it, and nothing says whether the tickets get voided. "Đã hoàn tay" is per Đơn only. | Low |

---

## 8 (tech). OTP for ticket lookup has no store (OTP table or Redis TTL, attempt limit)

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| Ticket-lookup OTP | N/A (deliberate) | §11.3 row 1 (BRD FR-17 OTP lookup replaced by "Vé của tôi", email, staff lookup); memlog L18, L42 | none | – |
| Login OTP (the remaining OTP use) | Deferred (OK) | FR-1 hệ quả 1 (single-use, expiry, wrong-attempt limit, `[ASSUMPTION: 5 phút, 5 lần]`) | Enough for Architecture | – |
| Throttling | Dropped | FR-1; FR-29 | No send/resend rate limit for email OTP (cost, abuse). No rate limit or enumeration guard on the FR-29 phone/email lookup, which lets any CTV probe whether a phone or email bought a ticket. | Low |

## 9 (tech). Two sources of held count (`ticket_types.reserved` and `reservations`); atomic expiry release; periodic reconciliation

| Aspect | Status | PRD location | Gap | Severity |
|---|---|---|---|---|
| Invariants Architecture needs | Deferred (OK) | FR-13 (sold + held ≤ capacity, all-or-nothing); FR-14 (release at 15 min, immediately resellable); FR-8 hệ quả 2; NFR-3 | Business invariants are clear; schema and job design belong to Architecture | – |
| Late payment on a dynamic QR after hold release | Dropped | FR-14 (QR unpayable after expiry, order → Hết hạn); FR-17 hệ quả 3–4 define the late-payment rule **for static QR only**; FR-19 issues on billId + amount match with no order-state precondition; FR-20 reconciles only after ~2 min | A transfer started just before 15:00 whose IPN (or Đối soát bù) lands after the hold is released has no rule. Both naive builds break an SM-1 critical invariant: issuing oversells (FR-13), and refusing gives "paid but no ticket". The PRD needs to say the FR-17 rule applies to dynamic QR too (issue if the tier still has room, else "Thanh toán mồ côi"), or cite a Tingee guarantee. | **High** |
| Atomicity / drift detection for holds | Deferred, thin | NFR-5 all-or-nothing covers payment + issue + email/Sheets only; NFR-10 monitors IPN, issuance and queues | No outcome for hold release atomicity, and no alert when held counts drift. Architecture can derive these from FR-13, so the gap is small. | Low |
| Static-QR hold semantics | Open Q | FR-17 `[ASSUMPTION: 15 phút]`; §13 Q1 (marked blocking) | Tracked; it blocks the static branch of the hold design | Low |

---

## Confirmed-as-sound items: still reflected as business outcomes?

| # | Note item | Status | PRD location | Gap | Severity |
|---|---|---|---|---|---|
| S1 | Money as integer VND; timestamps with timezone | Reflected | NFR-12 | none | – |
| S2 | Every record has `organization_id`, isolated by RLS | Reflected, but premise weakened | NFR-7; FR-4 hệ quả; NFR-8 | PRD decisions mean not every record is BTC-scoped any more: a Tài khoản Tickee spans BTCs (FR-2), "Vé của tôi" and attendance history span BTCs (FR-22, FR-24), CTV accounts serve several BTCs, and Quản trị Tingee reads across tenants (see #5). The PRD never says which data is user-owned versus BTC-owned, so a "tag everything with organization_id" schema won't fit. | Medium |
| S3 | `payment_events` unique by transaction id (no double IPN processing) | Reflected | FR-19 hệ quả 2; FR-20 hệ quả 3; SM-1 | none | – |
| S4 | Outbox for ZNS/email/Sheets with retry | Reflected (ZNS deliberately removed) | FR-23 hệ quả 1; FR-32 hệ quả 3; NFR-5; NFR-10 | none | – |
| S5 | Don't store Token, money, buyer bank info | Reflected | FR-5 hệ quả 3; FR-34 hệ quả 1; §7; NFR-8; §10 | none | – |
| S6 | Oversell and double check-in prevented by conditional update | Reflected as outcomes | FR-13; FR-28; FR-29 hệ quả 3; NFR-3; SM-1 | none (mechanism correctly left to Architecture) | – |

---

## Gap register (by severity)

**High**
1. #9: No rule for a dynamic-QR payment whose IPN or Đối soát bù arrives after the 15-minute hold is released. FR-17's late-payment rule covers static QR only, and both naive builds break SM-1.

**Medium**
2. #1: Holder identity per Vé is undefined with one form per Đơn: the name shown on a companion's scan, and which ticket CTV checks in on a manual lookup.
3. #4: The invite-link model (single/multi-use, bound to email, BTC sees/approves acceptors, lifetime) is pushed to UX/Architecture, but it gates PII lookup access.
4. #5: The report-handling workflow (Open Q #7) is unresolved and not tied to any gate, though FR-35 is the only fraud control in Closed Beta.
5. #5: No BTC lock state or lock effects. Pending QRs and payments after a lock are undefined.
6. #5: Quản trị Tingee is absent from the permission matrix and has no auth/2FA/IP requirement or tenant-isolation exception.
7. #6: The Sheet row is per Đơn but check-in is per Vé, so partial check-in can't be shown (CSV too).
8. #7: No "Cần hoàn" state. Pending orders, open QRs and late IPNs at cancellation are undefined, and refund-list coverage of Cần xử lý money is undefined.
9. #7: Cancel is Must (FR-7) but its effects, including "Đã hoàn tay", live in Should FR-33.
10. S2: The tenant-scoping premise no longer holds for buyer accounts, "Vé của tôi", CTVs and platform admin. The PRD doesn't tell Architecture which data is user-owned.

**Low**
11. #1: Ticket caps per order/account (tracked, Open Q #2).
12. #4: "Sự kiện kết thúc" trigger undefined. It drives CTV expiry and ticket removal.
13. #5: Reporter eligibility and report-spam guard.
14. #6: Sheet per BTC or per Sự kiện, and which order statuses produce rows.
15. #6: The OAuth-expiry half of Open Q #6 is already answered in FR-32.
16. #6: No requirement to encrypt stored OAuth and Tingee credentials.
17. #7: Single-order or partial refund outside cancellation has no flow, and ticket voiding after a refund is unstated.
18. #8: No OTP send throttle, and no rate limit or enumeration guard on FR-29 lookup.
19. #9: Hold-release atomicity and drift alerting are not stated as outcomes, and the static-QR hold is still Open Q #1.

(The #6 row-reorder/Tickee-column item is folded into the tracked Open Q #6 and not counted separately.)
