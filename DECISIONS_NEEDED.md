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

### D2. GST / tax applicability
Is GST currently charged on your training fees? If yes, at what rate, and is your
GSTIN available? **Default:** tax is modeled as fully configurable and **disabled**
until you provide a rate — receipts show no tax line until enabled. This needs
your input before Phase 9 (Enrollments) if you want tax-inclusive figures from day
one; otherwise it can be turned on any time later without a schema change.

### D3. Student portal account creation timing
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

### D5. Admin access to Company Settings
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

### D7. Receipt/Certificate numbering reset behavior — certificate half RESOLVED (Phase 17), receipt half still open

**Certificate numbering (resolved):** explicit checkpoint decision — the
`certificate_number_seq` underlying `generate_certificate_number()`
(`20260101000031_certificate_number_generation.sql`) is global and monotonic,
**never** reset per calendar year; `{year}` in the `CERT-{year}-{seq:6}` format
string is a cosmetic label computed from the current date at mint time, not a
per-year-restarting counter. A certificate number is therefore never reused or
ambiguous across years.

**Receipt numbering (still open):** `REC-{year}-{seq:6}` default numbering still
implies the sequence portion is scoped per calendar year (so 2027 receipts
restart at `000001`). **Confirm** this is the desired behavior versus a single
never-resetting sequence across all years (e.g. `REC-000001`, `REC-000002`, …
indefinitely) before Phase 21 (Receipts, Refunds & Payment Documents) — this is
a separate decision from the certificate half above; the same monotonic-sequence
approach could be reused for consistency, but that itself needs confirming.

### D8. Outstanding-balance refund sign (FR-31) — confirm which direction is correct

`REQUIREMENTS.md` FR-31 was previously listed below as "resolved with a stated
engineering default," but re-inspection during Phase 14 found that the
resolution text is internally inconsistent, not actually settled. FR-31's own
prose reads `total payable − sum(valid payments) − sum(approved
refunds/credits)` (a refund *further reduces* what's owed), but the `§91`
logic it cites as its source, in `DATABASE_SCHEMA.md`, actually computes
`outstanding_balance = total_payable − (valid_payments_sum −
approved_refunds_sum)` — algebraically `total_payable − payments + refunds`
(a refund *adds back* to what's owed, since it reverses a payment). The
actual code (`lib/domain/dashboard-metrics.ts`) implements the second
version, backed by an existing unit test that cites "the Phase 2
verification report" as its own authority.

**Default in effect today:** the second interpretation (refund adds back to
outstanding — the standard accounting reading: a refunded payment no longer
counts as paid, so the amount is owed again). No phase through Phase 14 has
changed this or depends on changing it — Payment Plans (Phase 14) never
touch this formula at all. **Needed from you:** confirm the second
interpretation is correct (in which case FR-31's own prose sentence should
be corrected to match its own cited source), or tell us the first
interpretation was actually intended (in which case the code and its
existing test both need to change) — either way this is a one-line fix once
confirmed, but nobody should make that call silently. Not urgent before any
phase through 16 (Receipts) unless real refund volume starts making the
distinction financially visible sooner.

---

Everything else in the original brief — including all items the brief itself
flagged as ambiguous (Student ID format, Enrollment ID format, email-uniqueness
handling, program-module structure, trainer-multiplicity modeling,
invoice-vs-receipt separation) — has been resolved with a stated engineering
default in `REQUIREMENTS.md` §7 and does not require your input to begin
implementation. (Amount-paid/outstanding-balance derivation is no longer
listed here as settled — see D8 above.)
