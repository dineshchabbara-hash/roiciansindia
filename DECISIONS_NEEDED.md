# DECISIONS_NEEDED.md

## Roicians Tech — Training Management System / LMS

These are the only items where an engineering default would be a genuine guess
about your business rather than a safe architectural choice. Everything else in
the requirement set has been resolved with a documented, standard default (see the
"Requirements Changed / Clarified" section of `REQUIREMENTS.md`). Please confirm
or override each item below; sensible defaults are marked and implementation will
proceed with the default if no response is given before that phase starts.

---

### D1. Company identity and branding — **RESOLVED**
Confirmed:
- **Legal company name:** Roicians Tech Pvt. Ltd.
- **Brand/display name:** Roicians Tech
- **Country of operation:** India

These are stored in `company_settings` as `legal_name = "Roicians Tech Pvt. Ltd."`
and `company_name = "Roicians Tech"`. Per the naming rule in `REQUIREMENTS.md`
FR-140 / `DATABASE_SCHEMA.md` §`company_settings`: **Roicians Tech** is used for
normal UI/display branding (nav, dashboards, marketing pages, emails), and
**Roicians Tech Pvt. Ltd.** is used on legal/financial documents (receipts,
invoices, certificates, payment records, legal disclosures) wherever the
contracting legal entity needs to be named. Neither string is hard-coded in
application components — both are read from centralized Company Settings, so
either can change independently later without a code change.

Still outstanding (not blocking implementation start): logo file, registered
address, phone, email, GSTIN, and primary/secondary brand colors — placeholders
remain in `company_settings` for these until supplied, editable at any time from
Settings, needed no later than Phase 4 (Admin shell branding) / Phase 22 (Public
Website).
(Phase 22 update, D11: the public brand is **ROICIANS TECH** with the line
"Practical technology training for the AI era"; the visual direction and
suggested starting palette are approved. Still outstanding for the website:
the authorized logo files, final colour tokens after logo review, and the
approved public contact details.)

### D2. GST / tax applicability
Is GST currently charged on your training fees? If yes, at what rate, and is your
GSTIN available? **Default:** tax is modeled as fully configurable and **disabled**
until you provide a rate — receipts show no tax line until enabled. This needs
your input before Phase 9 (Enrollments) if you want tax-inclusive figures from day
one; otherwise it can be turned on any time later without a schema change.

### D3. Student portal account creation timing — RESOLVED (option b, Phase 21C)

**Resolved:** option (b) — an Admin/Super Admin provisions portal access for
an existing Student record; there is no self-serve signup. Implemented in
Phase 21C: the login is created without a password, gets the fixed
`student` role and is linked server-side; the student sets their own
password via the set-password link. Original text kept below.

The brief allows two options: (a) student creates their portal login during public
registration, before any Admin review, or (b) Admin creates/approves the student
record first, then provisions the login. **Recommended default: (b)** — Admin
confirms the registration/enrollment before a login exists, avoiding orphaned auth
accounts with no real student record and giving staff a chance to catch duplicates
before they become logins. **Needed from you:** confirm (b) is acceptable, or tell
us you want self-serve signup (a) — this affects Phase 3/Phase 5 flow design.

### D4. Certificate design and public-verification display name — RESOLVED (Phase 17)

Resolved by proceeding with the stated default, with no objection raised: a clean,
original, text-only certificate design was authored in Phase 17
(`lib/pdf/certificate.tsx`, `@react-pdf/renderer`) — student name, program name,
certificate number, completion/issue dates, and `company_settings`' own
legal name/signatory name/title, no logo image embedding in this V1 (a future
phase can add `company_settings.logo_path` as an `<Image>` without changing the
render data contract). The public `/verify-certificate` page shows the full
student display name (not masked), matching the stated default.

### D5. Admin access to Company Settings — RESOLVED (Phase 21C)

**Resolved:** Super Admin edits; Admin has read-only access (the read-only
correction already in the RLS policies since Phase 3); Student, Trainer and
anonymous users have none. Implemented by `/admin/settings` in Phase 21C.
Original text kept below.

Current default (`USER_ROLES_AND_PERMISSIONS.md` §3) restricts tax/numbering/
branding configuration to Super Admin only, with Admin excluded, to prevent an
operational-staff mistake from silently changing receipt numbering or tax
behavior platform-wide. **Confirm this is acceptable**, or tell us Admin should
also have Settings access — one-line change if so.

### D6. Program code format enforcement
The brief gives illustrative codes (e.g. `AIQAIN11`) but says codes are
admin-defined. **Default:** free-text program code with a uniqueness constraint
only, no enforced pattern. **Needed from you:** if you want a *mandatory* format
(e.g. always `{ProgramAbbrev}{Country}{Number}`), give us the exact pattern and
we'll add server-side validation for it in Phase 7 — otherwise Admin can type any
unique code.

### D7. Receipt/Certificate numbering reset behavior — RESOLVED (certificates Phase 17, receipts Phase 21A)

**Certificate numbering (resolved):** explicit checkpoint decision — the
`certificate_number_seq` underlying `generate_certificate_number()`
(`20260101000031_certificate_number_generation.sql`) is global and monotonic,
**never** reset per calendar year; `{year}` in the `CERT-{year}-{seq:6}` format
string is a cosmetic label computed from the current date at mint time, not a
per-year-restarting counter. A certificate number is therefore never reused or
ambiguous across years.

**Receipt numbering (resolved at the Phase 21A checkpoint):** one global
`receipt_number_seq` that never resets — the same rule as certificates.
`{year}` in `REC-{year}-{seq:6}` is a cosmetic label (the Asia/Kolkata year
of issue), so 2027 receipts continue the sequence (e.g. `REC-2027-000245`).
Gaps from rolled-back or failed transactions are acceptable; uniqueness and
immutability are required; gapless numbering is not. Implemented by
`next_receipt_number()` / `issue_receipt()` in
`20260101000037_receipts_issuance.sql`.

### D8. Outstanding-balance refund sign (FR-31) — RESOLVED (Phase 21B checkpoint, Option A)

**Decision — canonical accounting identity:**

```
outstanding = total_payable − sum(paid payments) + sum(processed refunds)
```

A refund reverses money received, so the amount owed goes back up by the
refunded amount. This is the formula the code already implemented
(`computeOutstandingFeesPaise` in `lib/domain/dashboard-metrics.ts`, used by
the Phase 14 enrollment financial summary `getEnrollmentFinancialSummary`
and the Phase 19 reports); it was **not** changed. Only the FR-31 prose
sentence was wrong and has been corrected in `REQUIREMENTS.md`.

Separately, as an implementation/presentation rule and not part of the
identity above: the existing Phase 14 per-enrollment calculation floors the
balance it returns at zero (`Math.max(0, …)`), so the application never
displays or returns a negative outstanding value. That existing behaviour is
unchanged.

Refund statuses and the formula (Phase 21B):
- `processed` — money has been returned; the only status that changes
  financial truth (outstanding, net collected, reports).
- `initiated` — a Razorpay refund in progress; does **not** change
  outstanding but **reserves** refundable capacity on the payment.
- `failed` — does not change outstanding and releases its reservation.

A refund never changes the contractual payable (agreed fee, discount,
registration fee, tax, total payable), any installment, or the payment
row. There is no approved post-enrollment payable adjustment / cancellation
settlement mechanism — see "Open future gap" below; it was deliberately
not built in Phase 21B.

**Open future gap — post-enrollment payable adjustment / cancellation
settlement.** Today an enrollment's fee terms are set at creation only;
waiving an installment changes neither payable nor outstanding; nothing
settles a cancellation. So refunding money to a student who is leaving
raises that enrollment's outstanding balance by the refunded amount, and
there is no approved way to write the remaining payable off. A future
phase must define (with a product decision) who may adjust payable after
enrollment, how it is audited, and how it interacts with receipts and
reports. Not decided, not built.

### D9. Offline payment recording rules — RESOLVED (Phase 20A checkpoint)

The requirements did not define these; each was confirmed explicitly before
Phase 20A code was written (none was inferred):
- **Overpayment:** blocked — an offline payment may not exceed the
  enrollment's current outstanding balance (Phase 14 formula). Partial
  payments are allowed.
- **Installment targeting:** not in Phase 20A — payments are recorded
  against the enrollment only (`installment_id` null; the `installment`
  payment type is not offered). How a payment allocates to installments
  (and updates `installments.amount_paid_cache`) is still undefined and must
  be decided before any phase links payments to installments.
- **Eligible enrollments:** confirmed statuses only — enrolled, active,
  on_hold, completed. Lead/applicant and cancelled/withdrawn cannot receive
  an offline payment.
- **Payment date:** the Admin enters the date the money was received (today
  or earlier, Asia/Kolkata); stored in `payments.paid_at`.

D8 (refund sign) was unaffected by Phase 20A (it recorded no refunds and did
not change the outstanding formula); D8 itself was resolved at the Phase 21B
checkpoint.

### D10. Online payment amount — RESOLVED (Phase 20B checkpoint)

- Who: the Student, for their own enrollment (already defined by FR-43 and
  the role matrix).
- Amount: the Student chooses between the **next unpaid installment** and
  the **full outstanding balance**; never a typed amount (FR-92/SEC-6).
- Next unpaid installment = oldest-first coverage: net paid (paid −
  processed refunds) covers plan installments by sequence, waived skipped;
  the first not fully covered is next; amount = its uncovered remainder,
  capped at the outstanding balance. Computed at order time only — no
  allocation is stored (D9 still holds).

### D11. Phase 22 public website design — RESOLVED (approved 2026-10-17)

All Phase 22 business decisions are recorded in
[`docs/requirements/PHASE_22_APPROVED_DESIGN.md`](docs/requirements/PHASE_22_APPROVED_DESIGN.md)
(decision register P22-01 – P22-18). In short:

- Same repository; `roicians.in`, `student.roicians.in`,
  `trainer.roicians.in`, `admin.roicians.in`; Canada stays at
  `https://www.roicians.com`.
- Public brand ROICIANS TECH; legal name Roicians Tech Pvt. Ltd.
- Website Management: Admin and Super Admin manage the complete ordinary
  public website; Super Admin alone changes a published Program slug.
- Ten launch Programs in two editable groups; the eleventh ("AI Quality
  Engineering") is removed.
- Programs archive/restore only in Phase 22 — no permanent deletion.
- No public pricing or financial information.
- Batch privacy; registration Open/Closed/Full; "Next Cohort: Coming Soon".
- Visual direction Concept A with restrained Concept B elements.
- Online-first; enquiry interfaces in Phase 22, Zoho delivery in Phase 23.

This resolves the earlier Phase 22 open points (publication control,
content ownership, pricing display, course groups, deletion policy, launch
grouping, domains). Still open — and **not** resolved by D11: launch
content and legal/consent wording (design §17), D2 (GST/tax) and D6
(Program code format).

---

Everything else in the original brief — including all items the brief itself
flagged as ambiguous (Student ID format, Enrollment ID format, email-uniqueness
handling, program-module structure, trainer-multiplicity modeling,
invoice-vs-receipt separation) — has been resolved with a stated engineering
default in `REQUIREMENTS.md` §7 and does not require your input to begin
implementation. (Amount-paid/outstanding-balance derivation was settled by D8 above at the
Phase 21B checkpoint.)
