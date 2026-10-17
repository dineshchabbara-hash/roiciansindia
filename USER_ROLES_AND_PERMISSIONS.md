# USER_ROLES_AND_PERMISSIONS.md

## Roicians Tech — Training Management System / LMS

**Status:** Draft v1.0 (Planning Phase)

---

## 1. Roles

| Role | Description |
|---|---|
| **Super Admin** | Full platform control, including system settings, admin/trainer account management, and numbering/tax configuration. Typically 1–3 accounts. |
| **Admin** | Day-to-day operational staff: students, programs, batches, enrollments, payments, attendance, certificates, reports, and (Phase 22, approved) ordinary public-website management. Cannot change system-level settings reserved for Super Admin (see matrix). |
| **Trainer** | Delivers training. Scoped strictly to batches they are assigned to. No visibility into payments/fees, no access to Admin settings. |
| **Student** | Self-service portal for their own data only. |

A user has **exactly one** application role in V1 (stored in `user_roles`). Every
permission check happens **server-side** — the client never decides what it's
allowed to render based only on its own state; it renders based on data the server
already filtered/authorized.

## 2. Enforcement Model (Defense in Depth)

1. **Route-group layout gate** — `app/admin/layout.tsx`, `app/trainer/layout.tsx`,
   `app/student/layout.tsx` each read the session role server-side and redirect
   away if it doesn't match. Prevents casual URL-guessing.
2. **Server action / route handler authorization** — every mutation re-checks role
   and, for Trainer/Student, re-checks *ownership/assignment* (e.g., "is this
   trainer actually assigned to this batch?", "does this payment belong to this
   student?") against the database — never trusts a role claim alone, and never
   trusts an ID passed from the client without an ownership check.
3. **Postgres Row Level Security** — a second, independent barrier so that even a
   bug in application-layer checks (or a direct Supabase client call) cannot leak
   cross-student or cross-trainer data. RLS policies are summarized per table below;
   full policy SQL ships in the Phase 3 migration.

## 3. Permission Matrix

Legend: **F** = Full (create/read/update, delete governed by Delete Policy),
**R** = Read-only, **RS** = Read, Scoped to own/assigned records, **CS** = Create/
Update, Scoped, **–** = No access.

| Capability | Super Admin | Admin | Trainer | Student |
|---|:---:|:---:|:---:|:---:|
| Manage Admin accounts (create/deactivate) | F | – | – | – |
| Manage Trainer accounts | F | F | – | – |
| Manage Students | F | F | R (own batch students, basic info only) | RS (self only) |
| Manage Programs | F | F | R | R (public catalog) |
| Manage Batches | F | F | R (assigned only) | R (enrolled only) |
| Website Management — ordinary public content: pages, sections, menus, footer, FAQs, banners, CTAs, approved media, SEO/social metadata, Program and Batch website content, display groups, featured Programs, ordering (Phase 22, approved — not built) | F | F | – | – |
| Publish/unpublish Programs and Batches on the website; set public registration state (Phase 22, approved — not built) | F | F | – | – |
| Preview unpublished website content; restore an earlier content version (Phase 22, approved — not built) | F | F | – | – |
| Change a Program slug after its first publication (Phase 22, approved — not built) | F | – | – | – |
| Permanently delete a Program (Phase 22 decision P22-08) | – | – | – | – |
| Assign trainers to batches | F | F | – | – |
| Manage Enrollments | F | F | R (assigned batch, no financials) | RS (self) |
| Override fee/discount/payment plan | F | F (audited) | – | – |
| Record offline payment | F | F | – | – |
| Initiate/verify online payment | F (view only) | F (view only) | – | CS (self, pay only) |
| View payments/receipts | F | F | – | RS (self) |

(Phase 21A: receipts are issued by the system, never typed — Admin/Super
Admin view/download any receipt and may only trigger "Generate receipt" for
a paid payment whose automatic issuance did not complete; nobody can edit
or delete an issued receipt. Student: own receipts only. Trainer: none.)
| Issue refund | F | F (audited) | – | – |
| Manage Class Sessions | F | F | CS (assigned batches) | R (enrolled) |
| Mark/Edit Attendance | F | F | CS (assigned batches only) | R (self) |
| Upload Materials | F | F | CS (assigned batches) | R (enrolled, download) |
| Manage Assignments | F | F | CS (assigned batches) | RS (view, submit) |
| Review Submissions / Grade | F | F | CS (assigned batches) | R (own result/feedback) |
| Issue/Revoke Certificates | F | F (audited) | – | R (own) |
| View Reports | F | F | R (own batches/students only) | – |
| Admin Reports area & CSV export (Phase 19) | F | F | – | – |
| Manage Leads (superseded — leads are managed in Zoho CRM, Phase 23; no LMS lead pipeline) | – | – | – | – |
| Manage Company Settings (branding, tax, numbering formats) | F | R | – | – |
| Manage Notification Templates (deferred, Phase 18b) | F | R | – | – |
| Send in-app notification to one Student/Trainer (Phase 18 V1) | F | F | – | – |
| View own sent notifications (sender history) | RS (own sent only) | RS (own sent only) | – | – |
| View / mark read own received notifications | RS | RS | RS (self) | RS (self) |
| View Audit Logs | F | R (non-sensitive subset) | – | – |
| Edit own profile (limited fields) | F | F | F | F (phone/address/photo/password only) |

Notes:
- "Admin (audited)" means the action is permitted but always writes an
  `audit_logs` row with before/after values — this applies to fee overrides,
  discounts, manual payments, refunds, and certificate revocation.
- Admin can **read** but not **edit** Company Settings (tax config, numbering
  formats, GSTIN, branding) — write access is reserved for Super Admin to
  prevent an operational staff error from silently changing receipt
  numbering or tax behavior platform-wide.
  **[CORRECTED during Phase 3 RLS implementation]** — the matrix cell
  originally read "–" (no access at all) for Admin, which conflicted with
  this very note (which only ever said "cannot edit") and with Admin's
  everyday need to see the current tax rate/numbering format/branding.
  Changed to "R". Write access is unaffected — still Super Admin only.
  **[DECISION CONFIRMED AS DEFAULT]** — if the business wants Admin to also
  manage (write) Settings, that is a one-line RLS policy change; flagged for
  confirmation in `DECISIONS_NEEDED.md` only if disputed.
- Trainer "R" on Students/Batches/Enrollments is **scoped**: only students currently
  enrolled in a batch the trainer is assigned to, and only non-financial fields
  (name, contact for coordination, attendance/assignment history) — never fee,
  payment, or discount data.
- Student "RS" everywhere means the row must reference the student's own
  `student_id`/`enrollment_id` — enforced both by the query (`where student_id =
  current_student_id`) and by RLS.
- **Website Management (Phase 22 approved design, not built —
  `docs/requirements/PHASE_22_APPROVED_DESIGN.md` §5):** "staff" means Admin
  and Super Admin only. Website editing grants no permission over private
  LMS finance, authentication, role assignment, RLS policies, deployment
  settings or the Super-Admin-only Company Settings. Legal/consent text is
  edited there only after business/legal approval of the wording. Every
  meaningful change is audited; Programs are archive/restore only during
  Phase 22 (no role deletes a Program).

## 4. Role-Specific Detail

### 4.1 Super Admin
- Everything Admin can do, plus:
  - Create/deactivate Admin accounts.
  - Configure Company Settings: branding, GSTIN, tax rate/label, receipt/
    certificate numbering formats, certificate signatory, social links.
  - Configure ID/numbering formats (within the safe pattern defined in
    `DATABASE_SCHEMA.md` §3 — format *strings* are configurable, the underlying
    sequence mechanism is not, to preserve concurrency safety).
  - Full audit log visibility, including sensitive financial edits.
  - Manage role assignment for any user.
  - (Phase 22, approved — not built) Change a Program's public slug after its
    first publication, with audit and redirect safeguards; other sensitive
    structural website operations identified during implementation.

### 4.2 Admin
- Full CRUD on Students, Programs, Batches, Enrollments (per Delete Policy —
  status-based, not hard delete for records with history).
- Record offline payments, issue refunds, override fees/discounts — all audited.
  (Phase 20A: Admin and Super Admin both record offline payments — the
  matrix row above, unchanged — via `/admin/payments/new`; each recording is
  audited as `payment.recorded_offline`. Recorded payments cannot be edited
  or deleted by any role. Trainers have no payment access; Students only see
  their own payments/balances in their existing portal views.)
  (Phase 20B, TEST MODE: "Initiate/verify online payment" is enforced as the
  matrix says — only a Student, for their own confirmed enrollment, can
  start a Razorpay payment; Admin/Super Admin see online payments in the
  ledger but cannot initiate or confirm one; Trainers have no access.)
  (Phase 21C: "Manage Admin accounts" is enforced — only a Super Admin
  creates/deactivates/reactivates plain Admins at /admin/admins; Super Admin
  accounts are not manageable in the app; nobody changes their own account.
  "Manage Company Settings" — Super Admin edits, Admin read-only (D5).
  "View Audit Logs" — Super Admin everything, Admin everything except Admin
  account management (the non-sensitive subset). Student portal logins are
  provisioned by Admin/Super Admin (D3 option b). No end-user role can write
  `user_roles`; roles are fixed by the server.)
  (Phase 21B: "Issue refund" — Admin and Super Admin both refund a paid
  payment from its detail page (manual refund for offline payments,
  Razorpay TEST refund for online ones); every refund is audited; no
  approval step. Students only see their own refunds; Trainers none.)
- Issue/revoke certificates.
- (Phase 22, approved — not built) Manage the ordinary public website through
  Website Management: content, Program/Batch publishing and registration
  state, groups, featured order, media, SEO, drafts, preview, publishing and
  version restore. No slug change after first publication; no Program
  deletion.
- Leads: no LMS lead pipeline — pre-enrollment leads are handled in Zoho CRM
  (Phase 23).
- View all reports across all programs/batches/trainers.
- Cannot: modify Company Settings, create Super Admin accounts, permanently delete
  a student/payment/enrollment with existing history.

### 4.3 Trainer
- Sees only batches in `batch_trainers` where `trainer_id = self`.
- Within those batches: can see enrolled students' name/contact/attendance/
  assignment data — **never** fee, discount, payment, or outstanding-balance data.
- Can create class sessions, mark/edit attendance, upload materials, create
  assignments, and grade submissions — all scoped to assigned batches, verified
  server-side on every write (re-check `batch_trainers` membership, not just role).
- Cannot access `/admin/*` routes at all (layout-level redirect), cannot call
  payment-related server actions (authorization check rejects even if attempted
  directly).

### 4.4 Student
- Sees only their own `students` row (matched via `auth_user_id`) and only
  `enrollments`/`payments`/`attendance`/`assignment_submissions`/`certificates`
  rows where `student_id` matches.
- Can edit: phone, alternate phone, address fields, profile photo, password.
  Cannot edit: name, DOB, Student ID, enrollment status, fees, program/batch
  assignment — those require an Admin-side change (with audit log).
- Can initiate a payment only for their own enrollment/installment; the amount is
  always server-derived, never client-supplied (see `SECURITY_PLAN.md`).
- Cannot see other students' data under any circumstance, including by editing a
  URL's enrollment/payment ID — every fetch is filtered by `student_id = self` at
  the query layer and backstopped by RLS.

## 5. Row Level Security Policy Summary

**Status as of Phase 3:** the real per-role policies below are implemented in
`20260101000014_rls_policies.sql` (on top of the Phase 2 default-deny
baseline in `20260101000013_rls_lockdown.sql`) and verified with simulated
`anon`/`authenticated`/`service_role` sessions per role — see the Phase 3
verification report for the full test list. Two tables (`students`,
`enrollments`) intentionally carry **no trainer-matching policy at all**,
because Postgres RLS is row-level, not column-level, and a trainer sharing
the same `authenticated` Postgres role as Admin/Student cannot be given a
restricted column set via GRANT without also restricting Admin. Trainers
instead read two dedicated `SECURITY DEFINER` functions,
`trainer_visible_students()` and `trainer_visible_enrollments()` (real-Supabase
validation migration `20260101000017` — originally implemented as views of
the same name, converted to functions because Supabase's security linter
flags any owner-privilege view as an ERROR regardless of mitigation; the
identical pattern as a function only trips a WARN, resolved the same way as
the RLS helper functions below), whose return type omits every financial/
sensitive column and whose own WHERE clause re-derives the
`batch_trainers` scoping — base-table RLS still blocks trainers from
reaching `students`/`enrollments` directly as defense in depth.

Full policy SQL ships in the Phase 3 migration; summarized intent:

| Table | Student policy | Trainer policy | Admin/Super Admin policy |
|---|---|---|---|
| `students` | `select` own row only | `select` limited columns for students in assigned batches (via a security-definer view exposing only safe columns) | full |
| `enrollments` | `select` own rows only | `select` rows where `batch_id` in trainer's assigned batches (non-financial columns only, via view) | full |
| `payments` | `select` own rows only; no `insert`/`update` (writes go through server-side service-role logic only) | no access | full, writes audited at app layer |
| `attendance` | `select` own rows only | `select`/`insert`/`update` where `batch_id` in assigned batches | full |
| `materials` | `select` where enrolled in the related program/batch | `select`/`insert` where assigned to the related batch | full |
| `assignments` / `assignment_submissions` | `select` own; `insert`/`update` own submission only | `select`/`insert`/`update` scoped to assigned batches | full |
| `certificates` | `select` own rows only | no access | full |
| `company_settings`, `audit_logs`, `leads` | no access | no access | full (audit_logs: Admin read-only subset) |
| Website Management tables (Phase 22A, planned — not created) | no access | no access | Admin/Super Admin per the matrix above; anonymous visitors none — public reads only through the server-only published-data contract (Phase 22C) |

RLS is **defense in depth**: privileged writes (payment confirmation, receipt
numbering, Student ID assignment) run through server-only code using the Supabase
service-role key, which bypasses RLS by design — so RLS protects against
*accidental or malicious direct client access*, while the application layer remains
the primary authorization mechanism for all business logic.

## 6. Account Provisioning Rules

- Super Admin accounts: created via a one-time secure setup step (documented in
  `README.md`), not through the UI, to avoid a chicken-and-egg self-service Super
  Admin signup.
- Admin/Trainer accounts: created by Super Admin (Admin creates Trainer only) via an
  invite flow — Supabase Auth admin API creates the user and emails a set-password
  link. No public signup page exists for these roles.
- Student accounts: created by Admin once a registration/enrollment is confirmed
  (see `DECISIONS_NEEDED.md` for the alternative of allowing self-serve signup
  before enrollment) — this guarantees every student auth user has a corresponding
  `students` row before they can log in, avoiding orphaned accounts.
