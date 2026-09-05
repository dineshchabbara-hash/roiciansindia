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

### D4. Certificate design and public-verification display name
Two sub-questions: (1) Do you have an existing certificate design/template (PDF,
image, or description of layout, signatory name/title) we should match, or should
we design a clean default? (2) On the public `/verify-certificate` page, should the
full student name be shown, or a partially-masked version (e.g. "Priya S.")?
**Default:** clean original design authored in Phase 19; full name shown on
verification (this is standard practice for certificate verification pages and
matches what the brief's §29 describes) — flag now only if you want masking.

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

### D7. Receipt/Certificate numbering reset behavior
Default numbering is `REC-{year}-{seq:6}` / `CERT-{year}-{seq:6}`, implying the
sequence portion is scoped per calendar year (so 2027 receipts restart at
`000001`). **Confirm** this is the desired behavior versus a single
never-resetting sequence across all years (e.g. `REC-000001`, `REC-000002`, …
indefinitely) — both are legitimate business choices and this only needs
confirming before Phase 16 (Receipts).

---

Everything else in the original brief — including all items the brief itself
flagged as ambiguous (Student ID format, Enrollment ID format, email-uniqueness
handling, amount-paid/outstanding-balance derivation, program-module structure,
trainer-multiplicity modeling, invoice-vs-receipt separation) — has been resolved
with a stated engineering default in `REQUIREMENTS.md` §7 and does not require
your input to begin implementation.
