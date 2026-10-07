# REQUIREMENTS.md

## Roicians Tech — Training Management System / LMS

**Status:** Draft v1.0 (Planning Phase)
**Owner:** Product/Engineering
**Last updated:** 2026-09-05

This document consolidates the complete requirement set for the platform, grouped by
category. Each requirement is tagged with a priority where useful:

- **P0** — Critical for V1 launch
- **P1** — Important, follows shortly after V1
- **P2** — Future / not built now, but architecture must not block it

Wherever the original request contained ambiguity, a contradiction, or a gap, a
**[DECISION]** or **[ASSUMPTION]** note is inline. Items requiring explicit business
sign-off are also listed in `DECISIONS_NEEDED.md`.

---

## 1. Business Requirements

- BR-1: Operate as a single-tenant platform for **Roicians Tech Pvt. Ltd.**
  (brand/display name: **Roicians Tech**), an IT training company operating in
  **India**. **[RESOLVED — see `DECISIONS_NEEDED.md` D1]** Legal name, display
  name, logo, address, and other contact details are stored in centralized,
  configurable Company Settings, not hard-coded anywhere in application code — see
  FR-140 for the legal-name vs. display-name usage rule. Any future legal-name or
  branding change requires only a Settings update, never a code change.
- BR-2: Support the full student lifecycle: Lead → Registration → Student record →
  Enrollment → Payment → Active → Completed/Withdrawn.
- BR-3: A Student ID is permanent and belongs to the person, not to any one enrollment.
  One student may hold multiple concurrent or historical enrollments across programs.
- BR-4: A Program (e.g. "AI Powered QA / Software Testing") is distinct from a Batch
  (a scheduled run of that program, e.g. "September 2026 Weekend Batch"). Many batches
  belong to one program; a program is never duplicated to represent a new batch.
- BR-5: Payments are tracked per-enrollment. A payment for one enrollment must never
  affect the outstanding balance of a different enrollment belonging to the same
  student.
- BR-6: The system must support online payment (Razorpay) and admin-recorded offline
  payment (cash/UPI/bank transfer/cheque), both producing receipts.
- BR-7: The system must scale to thousands of students without requiring architecture
  changes (pagination, indexing, no unbounded client-side loads).
- BR-8: Must be usable day-to-day by non-technical administrative staff.
- BR-9: Public marketing website and the operational portals (Admin/Trainer/Student)
  ship from the same codebase/brand system.
- BR-10: The platform must be defensible as a genuine institute-management product —
  no fake buttons, no placeholder numbers presented as real data (see `REQ-DEMO`
  below).

## 2. Functional Requirements

### 2.1 Identity & Access
- FR-1 (P0): Role-based accounts: Super Admin, Admin, Trainer, Student.
- FR-2 (P0): Email/password authentication with forgot/reset password flow, secure
  session handling, session expiry.
- FR-3 (P0): Role-based redirect after login: `/admin`, `/trainer`, `/student`.
  Direct URL access to another role's area must be blocked server-side, not just
  hidden in navigation.
- FR-4 (P0): Students cannot self-register as Trainer/Admin. Trainer accounts are
  created/invited by Admin/Super Admin only.
- FR-5 (P1): OTP, Google/Microsoft SSO reserved for future (P2) — auth abstraction
  must not block adding these later.

### 2.2 Student Management
- FR-10 (P0): Create/edit/view/deactivate student profiles; students are never hard
  deleted (see Delete Policy in `SECURITY_PLAN.md`).
- FR-11 (P0): Student ID auto-generated, starting at `10001`, sequential, unique,
  immutable, generated via a DB-safe sequence (never `MAX(id)+1`).
- FR-12 (P0): Search/filter by Student ID, name, email, phone, status, program, batch.
- FR-13 (P0): Student detail view aggregates enrollments, payments, attendance,
  assignments, certificates, and internal notes (staff-only, never shown to student).
- FR-14 (P1): Duplicate-detection warning (by email or phone) at creation time, with
  explicit Admin override allowed (family/shared-contact scenarios are legitimate).

### 2.3 Program & Batch Management
- FR-20 (P0): CRUD for Programs: name, unique program code, description, duration,
  delivery mode, regular fee, registration fee, tax rate/class, status, category,
  thumbnail, certificate eligibility, payment-plan availability.
- FR-21 (P0): Program codes are admin-defined (not system-generated) but enforced
  unique; format is free text validated against a configurable pattern.
- FR-22 (P0): CRUD for Batches, each batch belongs to exactly one Program; fields per
  spec §11 (schedule, capacity, trainer(s), status, meeting link/location).
- FR-23 (P0): Batch status lifecycle: Draft → Upcoming → Active → Completed /
  Cancelled → Archived.
- FR-24 (P1): Optional course structure: Program → Modules → Lessons, used to scope
  materials/assignments without forcing structure on every program.

### 2.4 Enrollment
- FR-30 (P0): Enrollment links Student + Program + Batch, carries its own immutable
  Enrollment ID, financial terms (agreed fee, discount + reason, registration fee,
  tax, total payable), and a status lifecycle (Lead → Applicant → Enrolled →
  Active → On Hold → Completed → Withdrawn → Cancelled). ("Registered" was
  removed as a separate stage — Phase 9 manual-acceptance correction, Sept
  2026 — Registered and Enrolled are not distinct stages for this workflow.)
- FR-31 (P0): Outstanding balance is **derived**, not stored as a freely-editable
  number: `total payable − sum(valid payments) − sum(approved refunds/credits)`. See
  §91 logic, reproduced in `DATABASE_SCHEMA.md`.
  (UNRESOLVED DISCREPANCY, flagged during Phase 9, re-confirmed during Phase
  14 review, not fixed by either: this sentence's own refund term — "−
  sum(approved refunds/credits)", i.e. a refund *further reduces*
  outstanding — does not match the §91 formula it cites as its source.
  `DATABASE_SCHEMA.md` §91 actually gives `amount_paid = valid_payments_sum
  − approved_refunds_sum` then `outstanding_balance = total_payable −
  amount_paid`, which algebraically is `total_payable − valid_payments_sum
  + approved_refunds_sum` — a refund *adds back* to outstanding (the
  standard "a refund reverses a payment, so the amount owed goes back up"
  interpretation). The actual code
  (`lib/domain/dashboard-metrics.ts`'s `computeOutstandingFeesPaise`) matches
  §91, not this sentence, and is covered by an existing unit test that cites
  "the Phase 2 verification report" as its own source of truth — two of the
  three sources agree with each other; only this sentence disagrees with the
  section it names as its own source. This reads as a drafting error in this
  sentence, not a code defect, but per explicit instruction it is documented
  here rather than silently "corrected." No phase through Phase 14 has
  touched `amount_paid_cache`/`outstanding_balance_cache`/this formula — an
  explicit product decision on the correct sign is still needed before any
  future phase relies on it more heavily than Phase 9/10 already do.)
- FR-32 (P0): A student can hold many enrollments; enrollments are never merged into
  a single "profile balance."

### 2.5 Student Portal
- FR-40 (P0): Dashboard: identity, current program(s)/batch(es), upcoming classes,
  attendance snapshot, assignment snapshot, payment status/outstanding, recent
  payments, certificates, announcements.
  (Phase 10 implementation note: attendance/assignment snapshots, recent payments,
  certificates, and announcements have no backing feature yet — Phases 12/13/14/17
  build the underlying data. Phase 10's dashboard shows identity, current
  program(s)/batch(es), and a payment status/outstanding figure derived from Phase 9
  data; upcoming classes and attendance are inert, clearly-labeled "coming in a
  later phase" cards, never fabricated data. Announcements is omitted entirely
  rather than shown empty, since no announcements model exists anywhere yet.)
- FR-41 (P0): Self-service edit limited to phone, address, profile photo, password.
  Identity/enrollment-critical fields require Admin change (with audit trail).
  (Phase 10 implementation note: phone and address are editable from Phase 10 —
  lib/validation/student-self-profile.ts, enforced independently at the database
  layer by the pre-existing prevent_student_self_edit_of_protected_fields trigger,
  20260101000014_rls_policies.sql. Profile photo upload and password change are
  deferred — the pre-existing student-documents Storage bucket
  (20260101000018_student_documents_storage.sql) is Admin-only with no student-
  facing Storage grant yet, and a profile-photo bucket + its own RLS is a separate
  unit of work; password self-service is already served by the existing role-
  agnostic /forgot-password → /reset-password flow, so no new UI was built for it.)
- FR-42 (P0): View program/batch/trainer/schedule/materials/assignments scoped to the
  student's own enrollments only (enforced server-side + RLS).
  (Phase 10 implementation note: delivers the program/batch/status/dates/payment-
  status view — lib/data/student-portal.ts, a dedicated Student-safe projection,
  never lib/data/enrollments.ts's Admin-facing EnrollmentProfile, which carries
  discount reason, source, and admin notes. Trainer/schedule/materials/assignments
  views are out of Phase 10's scope — they depend on Phase 11/12/17 features that
  don't exist yet.)
- FR-43 (P0): View fees, installment schedule, payment history, outstanding balance;
  pay online via Razorpay; download receipts.
- FR-44 (P0): View own attendance (present/absent/late/excused) and computed
  attendance percentage.
  (Phase 13 implementation note: delivers a dashboard summary card
  (`/student`, `student_attendance_summary` view — computed on read, not
  hand-maintained) and a per-session history list on
  `/student/enrollments/[id]` (`getMyAttendanceForEnrollment`), closing the
  Phase 10 placeholder. Scoped to the caller's own enrollment only, the same
  own-data-only pattern as the rest of the Student Portal. Trainer-private
  `notes`/`marked_by`/`marked_by_type` fields are never selected or rendered
  for the Student — not explicitly authorized by this FR, so withheld.)
- FR-45 (P1): View/submit assignments, see trainer feedback/marks.
- FR-46 (P1): View/download materials scoped to enrolled batches.
- FR-47 (P1): View/download issued certificates.

### 2.6 Trainer Portal
- FR-50 (P0): Dashboard: assigned programs/batches, upcoming classes, assigned
  student counts, pending review queue.
  (Phase 11 implementation note: upcoming classes and pending review have no
  backing feature yet — Phases 12/18 build the underlying data. Phase 11's
  dashboard shows identity, assigned batch/program/student counts (derived
  from the caller's own `batch_trainers` rows and
  `trainer_visible_students()`), and a preview of the caller's own batches;
  upcoming classes and pending review are inert, clearly-labeled "coming in a
  later phase" cards, never fabricated data.)
- FR-51 (P0): View assigned batches and their enrolled students (basic info only —
  no payment data).
  (Phase 11 implementation note: delivers `/trainer/batches` +
  `/trainer/batches/[id]` and `/trainer/students` + `/trainer/students/[id]`
  — `lib/data/trainer-portal.ts`, a dedicated Trainer-safe projection, never
  `lib/data/trainers.ts`'s Admin-facing `getTrainerProfile`/
  `getTrainerAssignments` (which accept a caller-supplied id and would risk
  Program fee-column exposure). Students are sourced exclusively from the
  pre-existing `trainer_visible_students()`/`trainer_visible_enrollments()`
  SECURITY DEFINER functions, the only sanctioned read path to Student data
  for a Trainer — the base `students`/`enrollments` tables carry no
  trainer-matching RLS policy at all. Programs are derived only from the
  caller's own assigned batches, never every published Program, and never
  select `regular_fee`/`registration_fee`/`tax_rate_percent` even though the
  pre-existing `programs_select_published` RLS policy would technically
  allow it — that policy serves the general authenticated-user program
  catalog, not Trainer scoping, so this phase applies its own row- and
  column-level restriction rather than relying on RLS alone for Programs.)
- FR-52 (P0): Create class sessions; mark/edit attendance for authorized batches only
  (server-enforced batch-trainer assignment check).
  (Class session half: Phase 12. Attendance-marking half: Phase 13
  implementation note — `/trainer/batches/[id]/sessions/[sessionId]/attendance`
  derives the eligible roster exclusively from the pre-existing
  `trainer_visible_enrollments()` SECURITY DEFINER function (the same
  sanctioned read path Phase 11 established for Trainer access to Student/
  Enrollment data), then independently re-verifies the session's own
  `batch_id` is one of the caller's assignments on every mutation — a
  browser-supplied enrollment/batch/student id is never trusted. Mirrors
  Admin's `/admin/batches/[id]/sessions/[sessionId]/attendance` in shape but
  uses a wholly separate, Trainer-safe data path
  (`lib/data/trainer-portal.ts`), never the Admin-facing
  `lib/data/attendance.ts` functions that accept a caller-trusted batch id.)
- FR-53 (P1): Upload materials, create assignments, review submissions, add
  feedback/marks scoped to assigned batches.
  (Material upload delivered in Phase 15 — Trainer scoped to their own
  assigned Batch/Session only, no Program/Module access (see
  IMPLEMENTATION_PLAN.md's own Phase 15 note). Assignments/submissions/
  feedback remain deferred to Phase 16 — explicitly out of Phase 11's
  scope. Not implemented, not stubbed with fake data.)
- FR-54 (P0): Trainers explicitly cannot: view unrelated students, modify payments or
  fees, access Admin settings.
  (Phase 11 implementation note: verified server-side — `getMyBatch`/
  `getMyStudent` scope every query by the caller's own resolved trainer id in
  addition to the requested id, returning the identical not-found error for
  a nonexistent id and an out-of-scope id, so a probe can never distinguish
  the two. No Trainer-facing query ever selects a financial column. Trainer
  self-profile-editing was also considered and kept read-only: no
  `trainers_update_own` RLS policy exists at the database layer, and no FR in
  this section authorizes it, so `/trainer/profile` has no edit form at all —
  a stronger, less ambiguous case than the Student Portal's FR-41, which did
  have explicit authorization for its editable fields.)

### 2.7 Class Sessions & Attendance
- FR-60 (P0): Class session entity per batch (date/time/topic/meeting
  link/status: Scheduled/Completed/Cancelled/Rescheduled).
  (Phase 12 implementation note: the `class_sessions` table and its status
  CHECK constraint already matched this FR exactly before Phase 12 began
  (provisioned alongside the rest of the schema) — Phase 12 is the
  application layer on top: Admin full CRUD except hard delete (status
  change to "Cancelled" is the approved removal path, per this FR's own
  status list — see IMPLEMENTATION_PLAN.md's Phase 12 note for why no
  delete control is exposed despite the pre-existing RLS allowing it for
  Admin), Trainer create/edit scoped to their own assigned batch only
  (`lib/data/trainer-portal.ts`, never `lib/data/class-sessions.ts`'s
  Admin-facing, caller-trusted-id functions), and a read-only "Upcoming
  classes" dashboard widget for Student/Trainer/Admin alike, scoped by the
  pre-existing class_sessions_select_student/select_trainer RLS policies.)
- FR-61 (P0): Attendance rows link Student + Enrollment + Batch + Class Session,
  status (Present/Absent/Late/Excused), `marked_by`, timestamp, optional notes.
  (Phase 13 implementation note: the `attendance` table, its status CHECK
  constraint, and its `attendance_unique_per_session` uniqueness constraint
  already matched this FR exactly before Phase 13 began (provisioned
  alongside the rest of the schema in Phase 2) — Phase 13 is the application
  layer on top, the same relationship Phase 12 had to `class_sessions`. No
  new migration was added. `marked_by`/`marked_by_type` is a polymorphic pair
  (uuid + a `'trainer'|'admin'` check, no real FK — referential integrity is
  enforced at the application layer, matching the pre-existing schema's own
  design) set server-side to the authenticated actor's own resolved id, never
  a form field. The roster is not filtered by enrollment status — neither
  this FR nor the pre-existing `trainer_visible_enrollments()` function
  applies such a filter, so none was invented.)
- FR-62 (P0): Attendance percentage computed on read (view/materialized aggregate),
  not manually maintained.
  (Phase 13 implementation note: the pre-existing `student_attendance_summary`
  view (`security_invoker = true`) already computed this exactly as
  specified — `round(100.0 * count(*) filter (where status in ('present',
  'late')) / count(*), 2)`, late counting as present — before Phase 13 began.
  Phase 13 is the first phase to read from it, in both the Student dashboard
  summary card and the enrollment-detail Attendance card.)
- FR-63 (P1): Audit trail for attendance changes after initial marking.
  (Phase 13 implementation note: the pre-existing `attendance_audit` table is
  used as-is — no second audit system was built alongside it, and no row is
  duplicated into the general `audit_logs` table. A fresh mark (no prior row
  for that enrollment+session) writes no audit row, since this FR scopes the
  trail to changes *after* initial marking. A correction writes
  `attendance_audit` only when `status` changes (the table has no `notes`
  column to diff). `attendance_audit` carries no RLS policy for Trainers at
  all (by design, not a gap) — the Trainer-side correction path writes that
  one audit row via the existing service-role admin client
  (`lib/supabase/admin.ts`); the `attendance` row mutation itself still goes
  through the Trainer's own RLS-scoped client, which remains the actual
  authorization gate.)

### 2.8 Materials & Course Structure
- FR-70 (P1): Upload PDFs/docs/slides/sheets/images/links/video links; attach to
  Program, Batch, Session, or Module.
  (Phase 15 implementation note: the `materials`/`program_modules` tables
  and every RLS policy this phase relies on
  (materials_select_admin/select_trainer/select_student/write_admin/
  write_trainer/update_admin/delete_admin, 20260101000014_rls_policies.sql)
  already existed, provisioned ahead of schedule alongside the rest of the
  schema in Phase 2 — Phase 15 is the first phase to actually write to
  `materials` and is purely an application-layer build on top of unchanged,
  pre-existing security, the same relationship Phase 12 had to
  `class_sessions`. "Attach to Program, Batch, Session, or Module" is
  implemented as exactly-one-scope-per-material, an application-layer
  decision — not a DB rule — since the `materials_scoped` CHECK constraint
  itself only requires at least one of the four, and no primary source
  gives a worked multi-scope example; the DB CHECK is deliberately left
  unchanged. Admin may scope a material to an existing Module (no Module
  CRUD — a read-only picker over whatever `program_modules` rows already
  exist); Trainer upload remains Batch/Session-scoped only, matching
  `materials_write_trainer`'s own RLS shape exactly — no Program/Module
  access was invented for Trainer this phase.)
- FR-71 (P1): Access to materials strictly scoped to the student's active enrollment
  in the related program/batch; storage URLs are never public/guessable.
  (Phase 15 implementation note: "active enrollment" is not defined by any
  primary source down to the exact status set, so this is an explicit,
  approved Phase 15 business decision, not an inference: ALLOWED —
  `enrolled`, `active`, `on_hold`, `completed`; DENIED — `lead`,
  `applicant`, `withdrawn`, `cancelled`. This aligns with the project's own
  pre-existing, named "operational/student-active" status grouping
  (`supabase/migrations/20260101000025_enrollment_batch_integrity_
  constraints.sql`'s own comment: enrolled/active/on_hold/completed);
  `completed` specifically was the one sub-question FR-71 itself left
  unresolved (a completed student keeps access to their own past learning
  materials; withdrawn/cancelled are historical/terminal and lead/applicant
  are not yet in the learning-delivery lifecycle). Enforced as a narrowing-
  only RLS correction to the pre-existing `materials_select_student` policy
  (`20260101000026_materials_student_rls_active_enrollment.sql`), applied
  identically across all four scope branches (program/batch/module/
  session) and to the Storage bucket's own mirrored policy
  (`20260101000027_materials_storage.sql`) — RLS is the actual
  authorization boundary, never re-derived in application code. Storage:
  a new private `materials` bucket (`public: false`), never a public URL;
  access is via a short-lived signed URL
  (`MATERIAL_SIGNED_URL_EXPIRY_SECONDS = 300`, `lib/domain/materials.ts` —
  a named engineering default, not a business rule, never persisted,
  changeable without a migration), minted fresh on every request through
  the caller's own RLS-scoped session (never the service-role client), so
  Storage RLS independently gates it even if table RLS were ever
  misconfigured. MIME content is verified from the actual file bytes
  (`matchesMaterialFileSignature`), never the trusted Content-Type header
  alone, per `SECURITY_PLAN.md` §8.)

### 2.9 Assignments
- FR-80 (P1): Assignment entity (program/batch/module, trainer, title, description,
  attachment, assigned/due date, max marks, status).
  (Phase 16 implementation note: the `assignments`/`assignment_submissions`
  tables and every RLS policy this phase relies on
  (assignments_select_admin/_trainer/_student, assignments_write_admin/
  _trainer, assignments_update_admin/_trainer, assignments_delete_admin,
  assignment_submissions_select_admin/_trainer/_own,
  assignment_submissions_write_admin/_own,
  assignment_submissions_update_admin/_trainer/_own,
  20260101000014_rls_policies.sql) already existed, provisioned ahead of
  schedule alongside the rest of the schema in Phase 2 — Phase 16 is the
  first phase to actually write to either table. `program_id`/`batch_id`
  are both `NOT NULL` on `assignments` — this is NOT the Materials "exactly
  one of Program/Batch/Module/Session" model; every assignment is
  Program-AND-Batch scoped, with an optional Module tag, and there is no
  Session-scoped assignment at all, by schema, not by omission.)
- FR-81 (P1): Submission entity (student, enrollment, assignment, timestamp, text
  and/or file, status, marks, feedback, reviewer, reviewed date).
  (Phase 16 implementation note: `unique(assignment_id, enrollment_id)` is
  the schema's own one-submission-per-assignment rule — resubmission updates
  that same row, never a second one. `reviewed_by` has a FOREIGN KEY to
  `trainers(id)` only, so an Admin-performed review leaves it null;
  `reviewed_at` still records that a review happened. A real pre-existing
  RLS gap was found and closed here (narrowing only, never weakened):
  `assignment_submissions_write_own`/`_update_own` previously checked only
  `student_id`, never that the submitted `enrollment_id` actually belonged
  to that student and matched the assignment's own batch
  (`20260101000028_assignment_submissions_ownership_rls.sql`); the
  application layer (`lib/data/student-portal.ts`'s `submitMyAssignment`)
  independently re-derives `enrollment_id` server-side either way, never
  accepting one from the caller.)
- FR-82 (P1): Submission status lifecycle: Not Submitted → Submitted/Late → Reviewed
  → Resubmission Requested.
  (Phase 16 implementation note: `due_date` has no time component and no
  grace period/late-penalty/auto-rejection/timezone policy is defined
  anywhere — `resolveSubmissionStatusForNow` (`lib/domain/assignments.ts`)
  mechanically picks `submitted` vs `late` by comparing the server's own
  current UTC date to `due_date`; a submission is never blocked after the
  due date. `assignments_select_student` (pre-existing, Phase 2, unchanged)
  has no enrollment-status filter at all, unlike Materials' own narrowed
  `materials_select_student` — this was deliberately NOT copied onto
  Assignments without a primary-source basis, and is reported as a known
  limitation in IMPLEMENTATION_PLAN.md's own Phase 16 note rather than
  silently resolved either way.)

### 2.10 Payments
- FR-90 (P0): Payment types: registration fee, full payment, installment, partial,
  online (Razorpay), offline (admin-recorded), refund (tracked, P1/P2 execution).
  (Phase 14 implementation note: this phase builds only the *planned*
  schedule the "registration fee"/"installment" types above will eventually
  post against — `payment_plans`/`installments`, pre-existing schema with no
  prior application code reading or writing either table. Actual payment
  transactions of any of these types are explicitly Phase 20/21 scope; Phase
  14 never inserts into `payments`, only reads it once, by exact
  `installment_id`, to check whether an installment is safe to hard-delete.)
- FR-91 (P0): Payment record is an **immutable transaction row** (see §21/§90 fields);
  balances are never edited directly — only new payment/refund rows change them.
- FR-92 (P0): Razorpay order creation is server-side; amount is always re-derived
  server-side from the enrollment/installment, never trusted from the client.
- FR-93 (P0): Razorpay signature verification on both the checkout-completion
  callback and the webhook; webhook processing is idempotent (dedup by Razorpay
  event ID / payment ID).
- FR-94 (P0): Every successful payment (online or offline) generates a sequential,
  unique receipt number and a downloadable PDF receipt; the student is emailed a
  copy.
- FR-95 (P0): Receipt numbering and Student ID generation must be concurrency-safe
  (Postgres sequences / `SELECT … FOR UPDATE` inside a transaction — never
  `MAX(x)+1` read-then-write).
- FR-96 (P1): Configurable installment plans per enrollment (amount, due date,
  status: Upcoming/Due/Partially Paid/Paid/Overdue/Waived).
  (Phase 14 implementation note: the `payment_plans`/`installments` tables
  and their status CHECK constraint already matched this FR exactly before
  Phase 14 began (provisioned alongside the rest of the schema in Phase 2) —
  Phase 14 is the application layer on top, the same relationship Phase 12
  had to `class_sessions` and Phase 13 had to `attendance`. Status is mostly
  *derived* on read (due/upcoming from the due date, partially_paid/paid
  from `amount_paid_cache` once a future phase's payment posts), per this
  FR's own co-location with FR-91's "balances are never edited directly"
  principle — `waived` is the one status value this phase ever writes
  explicitly, since no formula can derive an Admin's decision to forgive an
  installment. Pre-acceptance review correction: `overdue` is listed here
  as an *allowed* status value only — no primary source defines the
  timezone/boundary/threshold/grace-period needed to derive it
  automatically, so Phase 14 never assigns it; an unpaid installment past
  its due date reads as `due`, and `overdue` is reserved for a future phase
  that defines the missing rule explicitly. `payment_plans.total_amount` is
  likewise a derived, server-recomputed cache (`sum(installments.amount)`),
  never a submitted form field — see IMPLEMENTATION_PLAN.md's Phase 14 note
  for the full reasoning, including why this is the least-invented of the
  three possible readings of an otherwise-unspecified field.
  `programs.installments_allowed` (defined in Phase 2, never enforced
  before now) gates growing a plan past one line. Registration fee is not
  modeled as a mandatory first installment line — that was this phase's
  own over-read of a schema label example, corrected during pre-acceptance
  review; Payment Plans are fully generic, and `registration_fee` stays an
  Enrollment-level field, independent of any installment schedule.)
- FR-97 (P2): Refund transactions link back to the original payment; original payment
  rows are never deleted or overwritten.

### 2.11 Certificates
- FR-100 (P1): Admin issues certificates per enrollment; sequential unique Certificate
  ID (e.g. `CERT-2026-000001`); PDF generation with company branding.
- FR-101 (P1): Public certificate verification page (`/verify-certificate`) returns
  only non-sensitive fields (student name, program, issue date, validity) given a
  Certificate ID.
- FR-102 (P1): Admin can revoke/reissue with audit history.

### 2.12 Notifications & Email
- FR-110 (P1): Transactional email for: welcome, enrollment confirmation, payment
  receipt, payment reminder, class reminder, assignment notice, certificate issued,
  password reset.
- FR-111 (P1): In-app notification feed per user.
- FR-112 (P2): Architecture leaves room for WhatsApp as an additional notification
  channel without redesign (channel-agnostic notification table + dispatcher).

### 2.13 Reporting
- FR-120 (P1): Student, Enrollment, Payment, Attendance, Trainer reports as listed in
  spec §32, each paginated server-side with CSV export.

### 2.14 Public Website & Leads
- FR-130 (P0): Public pages: Home, About, Programs, Program Detail, Corporate
  Training, Contact, Student Login, Trainer Login (Admin login is not publicly
  linked, but reachable at a known path).
- FR-131 (P1): Public inquiry/lead form; Admin-facing lead list with status pipeline
  (New → Contacted → Follow-up → Qualified → Converted → Not Interested → Closed).
- FR-132 (P1): Converting a lead to a student preserves the original lead source on
  the student/enrollment record.

### 2.15 Settings / Configuration
- FR-140 (P0): Centralized Company Settings (name, legal name, logo, address,
  contact, GSTIN, tax config, receipt/certificate numbering formats, certificate
  signatory, social links). No company detail is hard-coded in UI/code.
  **Naming rule:** the display/brand name (`company_name` = "Roicians Tech") is
  used throughout normal UI/portal branding (nav bars, page titles, dashboard
  headers, marketing pages, emails); the full legal name
  (`legal_name` = "Roicians Tech Pvt. Ltd.") is used specifically on legal/
  financial documents — receipts, invoices, certificates, payment records, and any
  other legal disclosures — wherever a document needs to name the contracting
  legal entity rather than just the brand. Both values live in the same
  `company_settings` row; no component hard-codes either string.
- FR-141 (P0): Tax configuration is explicit and off by default until GST details are
  supplied (see `DECISIONS_NEEDED.md`).

### 2.16 Anti-fake-implementation requirement (REQ-DEMO)
- FR-150 (P0): No UI control may claim to perform an action it does not actually
  perform end-to-end. Any temporarily mocked feature must be visibly labeled
  "(Preview / Not Yet Connected)" in the UI and must not appear as a real dashboard
  number, button, or download until backed by real persistence/integration.

## 3. Non-Functional Requirements

- NFR-1 (Scalability): Server-side pagination everywhere; indexed lookups on all
  foreign keys and search fields; no full-table client loads.
- NFR-2 (Performance): Avoid N+1 queries; use Postgres views/materialized aggregates
  for expensive rollups (attendance %, outstanding balances) where reads are
  frequent.
- NFR-3 (Availability): Stateless Next.js deployment on Vercel; Postgres (Supabase)
  as the durable store; no in-memory session state that would break horizontal
  scaling.
- NFR-4 (Usability): Clean, corporate UI; non-technical staff must be able to operate
  Admin Portal without training beyond onboarding docs.
- NFR-5 (Accessibility): WCAG-AA-oriented — keyboard nav, labeled forms, sufficient
  contrast, semantic HTML, accessible dialogs.
- NFR-6 (Responsiveness): Full functionality on desktop/tablet/mobile; complex admin
  tables provide a responsive card/list fallback below a breakpoint.
- NFR-7 (Maintainability): TypeScript strict mode, layered architecture (UI → server
  actions/API → domain/service layer → data access), no business logic embedded in
  components.
- NFR-8 (Auditability): All financially or academically significant mutations are
  audit-logged with before/after where feasible.
- NFR-9 (Internationalization of time): All timestamps stored UTC in Postgres;
  displayed in `Asia/Kolkata` by default via a configurable per-deployment timezone
  setting, not the visitor's browser timezone, for business-critical dates (due
  dates, class times).
- NFR-10 (Money correctness): All currency fields use Postgres `numeric(12,2)`
  (or integer paise where specified) — never IEEE-754 floats — in DB, transport, and
  calculation layers.

## 4. Security Requirements

(Full detail in `SECURITY_PLAN.md`; summarized here as requirements)

- SEC-1: Authorization is enforced server-side on every mutation and every sensitive
  read — UI hiding is a convenience only, never the control.
- SEC-2: Supabase Row Level Security enabled on all tables containing student/
  trainer/payment data, as defense-in-depth alongside application-layer checks.
- SEC-3: All external input (forms, API bodies, query params) validated with Zod on
  the server, regardless of client-side validation.
- SEC-4: File uploads validated by extension + sniffed MIME type + size cap; stored
  under non-guessable keys in private buckets; served via short-lived signed URLs.
- SEC-5: Razorpay webhook signature verification is mandatory; webhook handler is
  idempotent against replayed/duplicate deliveries.
- SEC-6: Payment amount is always recomputed server-side from the enrollment/
  installment record; client-submitted amounts are never trusted.
- SEC-7: Rate limiting on auth endpoints, payment-initiation endpoints, and the
  public lead form / certificate verification endpoint.
- SEC-8: No secrets in source control; all credentials via environment variables;
  `.env.example` documents required variables with placeholders only.
- SEC-9: Error responses never leak stack traces, SQL, or credential material to the
  client; full detail goes to server-side logs only.
- SEC-10: Sensitive actions (fee override, discount, status change, refund) require
  Admin/Super Admin role and are audit-logged.

## 5. Integration Requirements

- INT-1 (P0): Razorpay — Orders API, Checkout, signature verification, Webhooks.
- INT-2 (P0): Supabase — Postgres, Auth, Storage, RLS.
- INT-3 (P1): Transactional email provider (Resend recommended, SendGrid as
  alternative) via an abstracted `EmailSender` interface so the provider can be
  swapped without touching call sites.
- INT-4 (P1): PDF generation for receipts/certificates via a server-side renderer
  (`@react-pdf/renderer` or headless-Chromium HTML→PDF) — see
  `API_AND_INTEGRATIONS.md` for the recommendation and trade-offs.
- INT-5 (P2): WhatsApp Business API, Zoom/Google Meet, Google Calendar, CRM, Meta
  Leads, accounting software, mobile app, AI assistant, placement/job-board module —
  none built now; notification, meeting-link, and identity models are kept
  provider-agnostic to avoid blocking these later.

## 6. Future Requirements (P2 — Not Built Now)

- FUT-1: Multi-branch support (branch/location/business-unit fields reserved but not
  enforced in V1; see `ARCHITECTURE.md` §SaaS/Branch readiness).
- FUT-2: Multi-company SaaS — would require introducing a `tenant_id` on every table
  and rescoping RLS policies; deliberately not done now (see architecture notes on
  what changes later).
- FUT-3: Placement/career module (resume, interview prep, referrals) — data model
  leaves room (student ↔ future `placement_profile` 1:1) but is not implemented.
- FUT-4: Refunds — schema supports it (`payment_refunds` table) but the operational
  refund workflow (Razorpay refund API call) ships after V1 unless required sooner.
- FUT-5: Advanced analytics, mobile app, automation — explicitly deferred.

## 7. Requirements Changed / Clarified From the Original Brief

These are called out explicitly per the "identify missing requirements,
contradictions" instruction:

1. **Program Code format** — the brief gives example codes but says "Admin should be
   able to define program codes" — this is implemented as free-text + uniqueness
   constraint + optional regex validation configured in Settings, not a fixed
   generator, to avoid contradicting the "admin-defined" requirement while still
   preventing collisions.
2. **Student ID vs. Enrollment ID vs. Payment ID** — the brief asks for three
   independent identifier spaces; we use one canonical strategy for all three
   (DB `bigserial`/sequence-backed human-readable codes with distinct prefixes/ranges)
   documented once in `DATABASE_SCHEMA.md` §ID Strategy, rather than three bespoke
   schemes, to keep the concurrency-safety guarantee (§92/§93) consistent everywhere.
3. **"Amount paid" on enrollment** — the brief lists `amount_paid` and
   `outstanding_balance` as enrollment fields (§12) but also mandates (§91) that
   balance must be derived from transactions, not stored as an editable number. We
   resolve this by keeping `amount_paid`/`outstanding_balance` as **cached, derived,
   server-recomputed** columns (never directly editable by any client), refreshed
   transactionally whenever a payment/refund posts. This satisfies both the "show it
   fast" and "never trust a hand-edited number" requirements — see §91 note in
   `DATABASE_SCHEMA.md`.
4. **Email uniqueness** — §95 flags that not every student may have a unique personal
   email (e.g., shared family email) while auth requires unique login identities. We
   resolve this by decoupling **auth identity** (Supabase Auth `users.email`, always
   unique) from **student contact email** (`students.email`, not
   database-unique, so Admin can record a shared family email while still creating a
   uniquely-authenticated portal login, typically via a distinct login email or by
   deferring portal-account creation for that student). Documented fully in
   `SECURITY_PLAN.md`.
5. **Trainer "multiple trainers per batch"** — modeled as a join table
   (`batch_trainers`) rather than a single FK, with one trainer optionally flagged
   primary, so co-taught batches are representable from day one.
6. **Receipt vs Invoice** — kept as two distinct future document types sharing a
   numbering-and-template subsystem; invoice generation itself is not built until tax
   requirements (GST invoice rules) are confirmed (`DECISIONS_NEEDED.md`).
7. **"Do not add unnecessary personal information"** — Date of birth, gender, and
   emergency contact are modeled as **nullable/optional** fields, collected only if
   the enrollment/program requires them, not mandatory on every student.

---

*See `DECISIONS_NEEDED.md` for the short list of items that need explicit business
input rather than an engineering default.*
