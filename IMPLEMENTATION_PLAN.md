# IMPLEMENTATION_PLAN.md

## Roicians Tech — Training Management System / LMS

**Status:** Draft v1.0 (Planning Phase)

---

## 0. Ground Rules for Every Phase

Per the engagement instructions, before implementing each phase:
1. Explain what is about to be built.
2. Identify files to be modified/created.
3. Identify database changes.
4. Identify security implications.
5. Implement.
6. Run relevant checks/tests (`tsc`, lint, unit tests, and — where applicable —
   a manual run through the feature per the "run" skill for UI changes).
7. Fix errors surfaced by (6).
8. Summarize completed work before moving to the next phase.

No phase re-writes a previously completed phase's working code without a stated
reason. Phases follow the brief's own ordering (§80) since no phase in that
ordering created a dependency contradiction during analysis.

---

## Phase 1 — Project Setup

**Scope:** Next.js (App Router, TypeScript strict) project scaffold; Tailwind +
shadcn/ui installed and themed with placeholder brand tokens; ESLint/Prettier;
Vitest configured; Playwright configured; base folder structure per
`ARCHITECTURE.md` §3; `.env.example`; `.gitignore`; `README.md` skeleton.

**DB changes:** None yet (Supabase project connected, no schema).

**Security implications:** Establish the import-boundary convention (server-only
modules for privileged keys) from day one so later phases don't retrofit it.

**Definition of Done:** `npm run dev` serves a placeholder home page; `npm run
build`, `npm run lint`, `npm run typecheck` all pass; CI-equivalent script
documented in README.

## Phase 2 — Database Schema & Migrations

**Scope:** Implement all tables from `DATABASE_SCHEMA.md` as Supabase migrations,
including sequences, constraints, indexes, triggers (`updated_at`), and the
`enrollment_summary`/`student_attendance_summary` views. Seed script for local dev
(demo Super Admin/Admin/Trainer/Student + sample programs/batches).

**DB changes:** All tables in §4 of `DATABASE_SCHEMA.md`.

**Security implications:** Per-role RLS *policies* are Phase 3 work (they
reference `auth.uid()`/`user_roles`, which need the real auth wiring to test
meaningfully) — but RLS itself is **enabled with no policies (default-deny)
on every table** as of the Phase 2 verification pass, closing the gap where
Supabase's `auto_expose_new_tables` default would otherwise expose every
table to the `anon`/`authenticated` PostgREST roles the moment this schema
reached a live project. Schema-level constraints (FKs, checks, uniqueness,
immutability triggers) are the rest of the Phase 2 security contribution.

**Tests:** Migration applies cleanly on a fresh DB; seed script idempotent;
constraint tests (e.g. duplicate `program_code` rejected, `enrollment_code`/
`payment_code`/`receipt_number`/`certificate_number` immutability triggers
fire); a payment (and a refund) against one enrollment leaves a second
enrollment's balance calculation untouched; a role with only a blanket
`SELECT` grant (simulating `anon`/`authenticated`) sees zero rows on every
table and through both reporting views, while a `BYPASSRLS` role (simulating
`service_role`) is unaffected.

**DoD:** `supabase db reset` produces a fully migrated + seeded local database;
ERD in `DATABASE_SCHEMA.md` matches actual migrated schema.

**Verification status:** Completed. A dedicated Phase 2 verification pass (13
migrations total — the original 11 plus two fixes: receipt/certificate number
immutability triggers, and the RLS lockdown + `security_invoker` fix on both
views) was run against a real Postgres 16 instance with a minimal `auth.users`
stub, since this sandbox has no Docker for the full local Supabase stack. See
the Phase 2 verification report for the complete finding list and the exact
commands used; re-verification against a real Supabase project is still
required before Phase 3 begins (Docker/GoTrue's actual `auth.users` schema
was never exercised here).

## Phase 3 — Authentication & Role Permissions

**Scope:** Supabase Auth wiring (`@supabase/ssr` server/browser clients,
middleware session refresh), `user_roles` table + RBAC helper (`lib/domain/
rbac.ts`), route-group layouts (`/admin`, `/trainer`, `/student`) with server-side
role gating, login pages (Student/Trainer/Admin distinct entry points, shared
backend), forgot/reset password, Super Admin bootstrap procedure (documented,
one-time script/SQL — not a UI flow), Admin/Trainer invite flow.

**DB changes:** Enable RLS on all tables per `USER_ROLES_AND_PERMISSIONS.md` §5;
write and test the actual policy SQL.

**Security implications:** This phase *is* the core security boundary — highest
scrutiny phase. Explicit tests for cross-role access attempts (§18 of
`SECURITY_PLAN.md`).

**Tests:** Unit tests for `rbac.ts` permission checks; integration tests logging
in as each role and asserting redirect/access boundaries; RLS policy tests
(direct Postgres queries as different simulated roles).

**DoD:** All four roles can log in and land on their correct portal root; a
student manually navigating to `/admin` is redirected; RLS verified with at least
one automated test per table with a policy.

## Phase 4 — Base Admin Layout & Dashboard

**Scope:** Admin shell (sidebar, topbar, breadcrumbs), dashboard cards wired to
real (initially near-empty, since data is thin) counts: total/active/new students,
enrollments, programs, active batches, trainers, revenue collected, outstanding
fees, recent payments/enrollments, upcoming classes, pending payments/
certificates, attendance overview.

**DB changes:** None beyond Phase 2 (dashboard reads existing tables/views).

**Security implications:** Every dashboard query scoped by role (Admin sees all;
this phase doesn't yet build Trainer/Student dashboards — those are Phases 10–11).

**Tests:** Dashboard renders correct counts against seeded data (integration
test); no query loads unbounded row sets.

**DoD:** Dashboard shows real, live numbers from the seeded database — explicitly
not hard-coded placeholders (REQ-DEMO compliance).

## Phase 5 — Student Management

**Scope:** Student CRUD (add/edit/view/deactivate), Student ID auto-generation via
sequence (Phase 2 groundwork), search/filter/pagination, student detail page
aggregating enrollments/payments/attendance/assignments/certificates (most of
which render "no data yet" until their own phases land — clearly, not faked),
internal notes, document upload.

**DB changes:** None beyond Phase 2 (uses `students`, `student_notes`,
`student_documents`).

**Security implications:** Duplicate-detection warning (email/phone) with
Admin-override audit note; document upload security per `SECURITY_PLAN.md` §8.

**Tests:** Student ID sequential/unique/immutable (including a concurrency test —
parallel creation requests never collide); search/filter correctness; deactivate
sets status without deleting.

**DoD:** Admin can fully manage students end-to-end against the real database.

## Phase 6 — Trainer Management

**Scope:** Trainer CRUD by Admin, invite flow (Phase 3 groundwork reused), trainer
profile fields, status (active/inactive).

**DB changes:** None beyond Phase 2 (`trainers`).

**Security implications:** Trainer accounts only created by Admin/Super Admin;
no public trainer signup.

**DoD:** Admin can create a trainer, trainer receives invite, trainer can log in
and land on an (initially minimal) Trainer Portal shell.

## Phase 7 — Programs

**Scope:** Program CRUD, program code uniqueness enforcement + optional regex
config from `company_settings`, program status lifecycle, thumbnail upload,
category/duration/fee fields.

**DB changes:** None beyond Phase 2 (`programs`, `program_modules` basic CRUD if
modules are included here or deferred to Phase 17 — recommendation: build the
`program_modules` CRUD now since it's simple and unblocks Materials/Assignments
scoping later, without building the full "lesson" UI yet).

**Security implications:** Public program pages (Phase 22) will read this data
read-only; ensure no draft/inactive program leaks to public queries.

**DoD:** Admin can create the example programs from the brief (§9) end-to-end.

## Phase 8 — Batches

**Scope:** Batch CRUD scoped to a program, trainer assignment (`batch_trainers`),
schedule fields, capacity, status lifecycle, meeting link/location.

**DB changes:** None beyond Phase 2 (`batches`, `batch_trainers`).

**Security implications:** Trainer's later batch-scoped access (Phase 11+) depends
on `batch_trainers` being correctly maintained here — get the assignment UI right
now to avoid rework.

**DoD:** Admin can create multiple batches under one program (verifying BR-4/§69
directly) and assign one or more trainers to each.

## Phase 9 — Enrollments

**Status:** COMPLETED — merged to `main` at commit `797d6f7` (`Merge branch
'claude/phase9-enrollment-management'`).

**Scope:** Enrollment creation (Student + Program + Batch), financial terms entry
(agreed fee, discount+reason, registration fee, tax), status lifecycle, balance
cache computed on create, enrollment list/detail/search/filter.

**DB changes:** None beyond Phase 2 (`enrollments`); this phase implements the
balance-computation service function (`lib/domain/enrollment-balance.ts`) used
here and reused unchanged in Phase 14/15/16.

**Security implications:** Fee/discount overrides audited (`audit_logs`) from
this phase forward.

**Tests:** Multiple enrollments per student (§68/§69 verification); a payment
against one enrollment never touches another enrollment's balance (§67
verification — even though payments aren't built until Phase 14/15, this phase's
balance function is unit-tested in isolation with mocked payment sums to confirm
the isolation logic is correct before payments exist).

**DoD:** A seeded student can hold two enrollments (e.g. QA + Data Analytics) with
independently tracked financial terms, matching the brief's own worked example.

## Phase 10 — Student Portal

**Status:** COMPLETED — merged to `main` at commit `82e85f5` (`Merge branch
'claude/phase10-student-portal'`). Manual browser acceptance confirmed 9/9
passed before merge; synthetic E2E test data cleanup verified.

**Scope:** Student dashboard (identity, current programs/batches, upcoming
classes placeholder until Phase 12, attendance placeholder until Phase 13,
payment status using Phase 9 data, announcements), profile view/edit (permitted
fields only), programs view (read-only, scoped to own enrollments).

**DB changes:** None beyond prior phases.

**Security implications:** First phase where Student RLS + server-side ownership
checks are exercised end-to-end for a real UI — priority test target.

**DoD:** A seeded student logs in and sees only their own enrollments/programs;
attempting to fetch another seeded student's enrollment ID via a modified request
is rejected.

## Phase 11 — Trainer Portal

**Status:** COMPLETED — on `main` as commits `001073d` (implementation) and
`996a22f` (a documentation-only numbering correction), pushed directly to
`main` with no separate merge commit. Manual browser acceptance confirmed
16/16 passed; synthetic E2E test data cleanup verified (read-only audit).

**Scope:** Trainer dashboard (assigned batches/programs, upcoming classes
placeholder until Phase 12), batch list scoped to `batch_trainers`, student list
within an assigned batch (non-financial fields only).

(Phase 11 implementation note: delivered — `/trainer` dashboard (identity,
assigned batch/program/student counts, own batches preview, two inert
"coming in a later phase" cards for upcoming classes and pending review, per
FR-50), `/trainer/profile` (read-only — no `trainers_update_own` RLS policy
exists and no FR authorizes Trainer self-edit, so this deliberately has no
form, unlike the Student Portal's FR-41), `/trainer/batches` +
`/trainer/batches/[id]` (assigned batches only, derived from the caller's own
`batch_trainers` rows, never all Batches; a Batch outside that scope 404s
identically to a nonexistent id), `/trainer/students` +
`/trainer/students/[id]` (assigned Students only, sourced exclusively from
the pre-existing `trainer_visible_students()`/`trainer_visible_enrollments()`
SECURITY DEFINER functions — the only sanctioned read path to Student data
for a Trainer — which already exclude every financial/address/DOB/emergency-
contact column by design; an unrelated Student 404s identically to a
nonexistent id). `lib/data/trainer-portal.ts` is a new, Trainer-specific safe
projection layer: it never selects a Program's `regular_fee`,
`registration_fee`, or `tax_rate_percent` columns even though
`programs_select_published` RLS would technically allow it (that policy
serves the general authenticated-user program catalog, not Trainer scoping,
so Phase 11 applies its own row- and column-level restriction on top of it
rather than relying on RLS alone for Programs). Deferred to later phases, per
scope: Class Sessions (Phase 12), Attendance (Phase 13), Materials
(Phase 17), Assignments (Phase 18), Certificates (Phase 19), Notifications
(Phase 20), Reports (Phase 21) — the dashboard's "Upcoming classes"/"Pending review"
cards are inert placeholders, never fabricated data, and no nav item links to
a page that doesn't exist yet.)

**DB changes:** None. `supabase/tests/phase11_trainer_portal_test.sql`
(run via `scripts/test-rls.sh`, local scratch Postgres only) adds regression
coverage for `batches_select_trainer`/`batch_trainers_select_own` cross-
trainer isolation — the one real gap Phase 11 newly relies on that wasn't
previously exercised end-to-end; `trainer_visible_students()`/
`trainer_visible_enrollments()` isolation was already fully covered by the
pre-existing `supabase/tests/rls_trainer_isolation_test.sql`.

**Security implications:** Verified a trainer cannot view a batch or student
they're not assigned to by direct URL/ID manipulation (`getMyBatch`/
`getMyStudent` return the identical not-found error for a nonexistent id and
an out-of-scope id). Verified Admin/Super Admin are not treated as Trainers
merely by navigating to `/trainer` — the existing (Phase 3)
`canAccessRouteGroup`/`roleHomePath` gate in `app/trainer/layout.tsx`, left
unchanged, redirects them to `/admin`.

**DoD:** A seeded trainer sees only their assigned batch(es) and its students.
Confirmed via `e2e/phase11-trainer-portal.spec.ts` (created; not yet run —
manual Windows browser acceptance is the next gate, same process as Phase 10)
and `supabase/tests/phase11_trainer_portal_test.sql` (run and passing against
a local scratch Postgres instance).

## Phase 12 — Class Sessions

**Status:** COMPLETED — on `main` at `91bb700`, pushed directly to `main`
with no separate merge commit (same convention as Phase 11). Manual browser
acceptance confirmed 16/16 passed; synthetic E2E test data cleanup verified
(read-only audit, corrected twice for scoping and verdict-logic issues
before being accepted).

**Scope:** Class session CRUD scoped to a batch (Trainer create/edit for assigned
batches; Admin full access), status lifecycle, schedule display feeding both
Admin "upcoming classes" and Student/Trainer dashboards (closing the placeholders
from Phases 4/10/11).

(Phase 12 implementation note: the `class_sessions` table, its status CHECK
constraint, and every RLS policy this phase relies on
(class_sessions_select_admin/select_trainer/select_student/write_admin/
write_trainer/update_admin/update_trainer/delete_admin) already existed
(20260101000008_academic_tables.sql / 20260101000014_rls_policies.sql,
provisioned ahead of schedule alongside the rest of the schema) — Phase 12
is the first phase to actually write to this table and is purely an
application-layer build on top of unchanged, pre-existing security. Delivered:
`/admin/batches/[id]` gains a Class Sessions section (list + "Add session"),
`/admin/batches/[id]/sessions/new` (create), `/admin/batches/[id]/sessions/
[sessionId]` (detail + status control), `/admin/batches/[id]/sessions/
[sessionId]/edit` (edit) — full CRUD except hard delete (see below).
`/trainer/batches/[id]` gains the identical shape at `/trainer/batches/[id]/
sessions/...`, scoped to the caller's own assigned batch (verified via the
existing getMyBatch ownership check before every read/write, on top of the
pre-existing RLS). The Student Portal gets no new route — REQUIREMENTS.md
FR-42 already deferred a Student "schedule" view to Phase 12, and this
phase's actual scope line only ever promised a dashboard widget, so
`/student`'s "Upcoming classes" card is populated with real, RLS-scoped data
(class_sessions_select_student) and nothing else changes for Students.
`lib/data/class-sessions.ts` (Admin) and `lib/data/trainer-portal.ts`'s new
functions (Trainer) are deliberately separate modules — the same Phase 11
precedent of never sharing a caller-trusted-id Admin data path with a
Trainer one. Hard delete is NOT exposed anywhere in the UI even though
class_sessions_delete_admin exists at the RLS layer (tested directly in
supabase/tests/phase12_class_sessions_test.sql): FR-60's own status enum
already specifies "Cancelled" as the approved way to retire a session, so
the status control is the only "removal" path — conservative, per this
phase's own DoD guidance not to invent destructive behavior beyond what
requirements specify. `trainer_id` is never a form field for either portal:
it is set automatically to the creating Trainer's own id on Trainer-created
sessions, left null on Admin-created ones, and never reassignable afterward
— no FR or existing schema convention calls for a trainer-picker UI, so none
was built.)

**DB changes:** None beyond Phase 2 (`class_sessions`).
`supabase/tests/phase12_class_sessions_test.sql` (run via
`scripts/test-rls.sh`, local scratch Postgres only) adds the first end-to-end
regression coverage of the pre-existing class_sessions RLS policies listed
above, since no application code exercised them before Phase 12.

**DoD:** Upcoming-classes widgets across all three portals now show real,
session-backed data. Confirmed via `e2e/phase12-class-sessions.spec.ts`
(created; not yet run — manual Windows browser acceptance is the next gate)
and `supabase/tests/phase12_class_sessions_test.sql` (run and passing
against a local scratch Postgres instance).

**Known limitations / deferred:** No hard-delete capability anywhere (see
above). No recurrence, schedule-conflict detection, or trainer/batch
collision prevention (none specified in requirements). No Student-facing
batch/session detail page — dashboard widget only. Attendance (Phase 13) is
explicitly out of scope: no present/absent/late/excused marking, no
attendance percentages, no attendance-triggered financial consequences —
`class_sessions` exists as a prerequisite row for Phase 13 to reference,
nothing more.

## Phase 13 — Attendance

**Status:** COMPLETED — on `main` at `865bd3c`, pushed directly to `main`
with no separate merge commit (same convention as Phase 11/12). Manual
browser acceptance confirmed 13/13 passed (across several rounds of
E2E-fixture-only fixes — a cleanup-ordering gap in the UI-driven mark/
correct tests, a Student dashboard locator fix — none touching application
behavior); synthetic E2E test data cleanup verified via a dedicated
read-only audit script before publishing to main.

**Scope:** Attendance marking UI (Trainer, scoped to assigned batch + session),
Admin override, attendance percentage view/computation, attendance audit trail
for post-marking edits, Student read-only attendance view (closing the Phase 10
placeholder).

**DB changes:** None beyond Phase 2 (`attendance`, `attendance_audit`,
`student_attendance_summary` view already created in Phase 2).

**Security implications:** Authorization test: Trainer cannot mark attendance for
a batch outside their assignment, even by crafting a direct request.

**DoD:** Attendance percentage is computed, not hand-entered; audit trail records
changes after initial marking.

(Phase 13 implementation note: the `attendance` table, its status CHECK
constraint (`present`/`absent`/`late`/`excused`), the `attendance_unique_per_session`
uniqueness constraint, the `attendance_audit` correction-trail table, the
`student_attendance_summary` view (`security_invoker = true`, computing
`attendance_percentage` on read with late counting as present), and every RLS
policy this phase relies on (attendance_select_admin/select_trainer/
select_student/insert_admin/insert_trainer/update_admin/update_trainer/
delete_admin) already existed (20260101000008_academic_tables.sql /
20260101000011_views.sql / 20260101000013_rls_lockdown.sql /
20260101000014_rls_policies.sql / 20260101000017_.../
20260101000022_..., provisioned ahead of schedule alongside the rest of the
schema) — Phase 13 is the first phase to actually write to `attendance` and
`attendance_audit` and is purely an application-layer build on top of
unchanged, pre-existing security, the same relationship Phase 12 had to
`class_sessions`. No new migration was added.

Delivered: `/admin/batches/[id]/sessions/[sessionId]/attendance` (per-session
roster — mark/correct status + notes for every enrolled student in that
session's own batch, in one form submit) and the identical shape at
`/trainer/batches/[id]/sessions/[sessionId]/attendance`, scoped server-side
to the caller's own assigned batch. The roster for both portals is derived
exclusively from server-side Enrollment+Batch+Class-Session relationships —
`lib/data/attendance.ts` (Admin, queries `enrollments` directly scoped to the
session's own `batch_id`) and `lib/data/trainer-portal.ts`'s new functions
(Trainer, built on the pre-existing `trainer_visible_enrollments()` /
`trainer_visible_students()` SECURITY DEFINER RPCs, the only sanctioned read
path to Student/Enrollment data for a Trainer) — never trusting a browser-
submitted student/enrollment/batch/trainer id. Every submitted
`enrollmentId` is re-intersected against this server-derived set on mutation;
anything not found is silently ignored (counted, never acted on). A fresh
mark is a plain insert with no audit row (FR-63 scopes the audit trail to
changes after initial marking); a correction writes `attendance_audit` only
when status changes (notes has no audit column) and a lost-race unique
violation on insert falls through to the correction path. Because
`attendance_audit` carries no RLS policy for Trainers at all (by design, not
a gap), the Trainer-side correction path writes that one audit row via the
existing service-role admin client (`lib/supabase/admin.ts`) — the
`attendance` row mutation itself still goes through the Trainer's own
RLS-scoped client, which remains the actual authorization gate. The Student
Portal gets its own read-only view: `/student`'s dashboard gains a real
Attendance summary card (`student_attendance_summary`, computed-on-read) and
`/student/enrollments/[id]` gains a per-session Attendance history list —
closing the Phase 10 placeholder per FR-44, with no notes/marked-by metadata
exposed and no financial fields anywhere on these pages. Hard delete is NOT
exposed anywhere in the UI even though `attendance_delete_admin` exists at
the RLS layer (tested directly in `supabase/tests/phase13_attendance_test.sql`):
correction via status update is the only "removal" path, the same
conservative precedent Phase 12 set for `class_sessions_delete_admin`. The
roster is not filtered by enrollment status (e.g. excluding withdrawn/
cancelled) since neither FR-61 nor the pre-existing `trainer_visible_enrollments()`
function applies such a filter — not an invented restriction, matching
existing precedent. A pre-existing `/admin/attendance` "Coming Soon"
placeholder (a cross-batch overview, a distinct feature from the per-session
marking UI delivered here) was found during requirements review and
deliberately left untouched as out of this phase's documented scope.)

Confirmed via `e2e/phase13-attendance.spec.ts` (created; not yet run — manual
Windows browser acceptance is the next gate, same process as Phase 10/11/12)
and `supabase/tests/phase13_attendance_test.sql` (run and passing against a
local scratch Postgres instance).

**Known limitations / deferred:** No hard-delete capability anywhere (see
above). No cross-batch Attendance overview (the pre-existing `/admin/attendance`
placeholder is unchanged — out of scope). No attendance-triggered financial
consequences (fee/payment/discount/refund fields are never read or rendered
anywhere in this phase). No Payment Plans, Razorpay, receipts, refunds,
Materials, Assignments, Certificates, Notifications, or Reports — all
explicitly Phase 14+ and untouched.

## Phase 14 — Payment Plans / Installments

**Status:** ACTIVE IMPLEMENTATION — branch `claude/phase14-financial-engine`,
based off `main` at `865bd3c` (the Phase 13 baseline). Not yet merged;
awaiting manual Windows browser acceptance, then explicit approval, per the
same gate Phase 10/11/12/13 went through.

**Scope:** Admin configures a payment plan (full or installment) per enrollment;
installment CRUD (amount/due date), status derivation
(Upcoming/Due/Partially Paid/Paid/Overdue/Waived) as a computed view rather than
a manually maintained field where possible.

**DB changes:** None beyond Phase 2 (`payment_plans`, `installments`).

**DoD:** An enrollment can be configured with the brief's own worked example
(₹10,000 registration + two ₹20,000 installments) and the plan displays correctly
in both Admin and (read-only) Student views.

(Phase 14 implementation note: the `payment_plans` and `installments` tables,
their status CHECK constraint, and every RLS policy this phase relies on
(payment_plans_select_admin/select_own/write_admin/update_admin/delete_admin,
installments_select_admin/select_own/write_admin/update_admin/delete_admin —
20260101000014_rls_policies.sql) already existed, provisioned ahead of
schedule alongside the rest of the schema — Phase 14 is the first phase to
actually write to either table and is purely an application-layer build on
top of unchanged, pre-existing security, the same relationship Phase 12 had
to `class_sessions` and Phase 13 had to `attendance`. No new migration was
added. There is zero Trainer RLS policy on either table (confirmed by direct
inspection, not an oversight) — Trainer has no financial access at all,
matching `USER_ROLES_AND_PERMISSIONS.md`'s explicit "never fee, discount,
payment, or outstanding-balance data."

Delivered: a "Payment Plan" card on the existing `/admin/enrollments/[id]`
page (no new route — Payment Plan is a section of the Enrollment detail
page, not a standalone area) with a create form when no plan exists yet, and
per-installment edit/waive/remove controls plus an "add installment" form
once one does; a read-only "Payment Plan" card on the existing
`/student/enrollments/[id]` page showing the Student's own installment
schedule. `/admin/payments` (a separate, pre-existing `ComingSoon`
placeholder — a cross-enrollment payments overview, a different feature)
was found during requirements review and deliberately left untouched, the
same precedent as `/admin/attendance` during Phase 13.

`payment_plans.total_amount` is treated as a derived, server-maintained
cache — never a field Admin edits directly — recomputed from
`sum(installments.amount)` after every installment create/edit/remove
(`lib/data/payment-plans.ts`'s own `recomputePlanTotal`), the same
"never let a cache drift from its source rows" discipline
`enrollments.amount_paid_cache`/`outstanding_balance_cache` already use
elsewhere in this codebase. This also resolves what would otherwise be an
invented "does the submitted total match the sum of installments" business
rule (the brief's own §11 warning against guessing a total-matching
formula): there is nothing to validate, since the total is never
independently submitted.

Every mutation is its own small, independently-submittable action (create
plan, add one installment, edit one installment, waive one installment,
remove one installment), matching this codebase's established
one-control-per-form convention (`EnrollmentStatusControl`,
`EnrollmentBatchAssignmentControl`) rather than one large multi-row form —
this also avoids an HTML nested-`<form>` problem a single "edit everything"
form would have created for the per-row Waive/Remove buttons.

Installment status is mostly derived on read
(`lib/domain/payment-plans.ts`'s `deriveInstallmentDisplayStatus`), per this
phase's own DoD wording ("status derivation ... as a computed view rather
than a manually maintained field where possible"): the stored `status`
column stays at its DB default (`upcoming`) for every installment this
phase creates, with exactly one status this phase ever writes explicitly —
`waived`, an Admin business decision no formula can derive. `due`/
`overdue`/`upcoming` are computed from `due_date` vs. the server's own
current date; `partially_paid`/`paid` are computed from
`amount_paid_cache`, which Phase 14 never writes to (structurally
unreachable for a Phase-14-created installment until a real payment posts
in Phase 15/16) — the derivation still handles them correctly once one
does. An installment whose derived status is `paid` is never editable,
waivable, or removable (conservative: nothing in Phase 14 can produce that
state, but a future phase's payment could, and mutating a fully-paid
installment after the fact would desync it from the real payment it was
paid against).

Hard delete of an installment IS exposed in the UI — the one deliberate
exception to this codebase's otherwise-conservative no-hard-delete
precedent (Phase 12's `class_sessions`, Phase 13's `attendance`): an unpaid
installment has no financial history to lose (nothing in `payments` can
reference it yet, by definition of "unpaid"), so removing it destroys a
draft schedule line, not a transaction record — checked by exact id against
the real `payments` table before every delete, never inferred from status
alone. Hard delete of the plan itself is NOT exposed (RLS permits it at
`payment_plans_delete_admin`, but nothing in the UI calls it).

`programs.installments_allowed` — a pre-existing flag Phase 9 defined but
never enforced anywhere — is read and enforced for the first time here:
creating or growing a plan to more than one installment line is blocked
when the Enrollment's Program has it set to `false`; a single-line "full
payment" plan is never gated by it (the flag's own name describes splitting
into installments, not whether an Enrollment may have a plan at all).

Registration fee is confirmed, from `DATABASE_SCHEMA.md` §90's own formula
(`total_payable = agreed_fee - discount_amount + registration_fee +
tax_amount`), to already be part of `total_payable` — not a separate,
immediately-due concept — so the brief's own worked example ("₹10,000
registration + two ₹20,000 installments") is modeled as a 3-line plan where
the registration fee is simply installment #1, not a distinct field or
table.

FR-31 (Confirmed Unpaid Fees / outstanding-balance sign behavior) remains
the same unresolved discrepancy flagged during Phase 9 — see this phase's
completion report for the full triangulation across `REQUIREMENTS.md`,
`DATABASE_SCHEMA.md`, and the actual code. Phase 14 never reads or writes
`amount_paid_cache`/`outstanding_balance_cache`/the outstanding-balance
formula at all — Payment Plans are a planned schedule, entirely separate
from the actual-payments arithmetic FR-31 concerns — so this phase neither
resolves nor depends on resolving it.)

## Phase 15 — Razorpay Integration

**Scope:** Order creation route/action, Checkout client integration, signature
verification, webhook route with idempotent processing, balance recompute on
confirmed payment — full flow per `API_AND_INTEGRATIONS.md` §2.

**DB changes:** None beyond Phase 2 (`payments` already modeled); this phase is
the first to actually write rows into it.

**Security implications:** Highest-scrutiny phase alongside Phase 3 — server-
authoritative amount, signature verification, idempotency all land here. No "Pay"
button ships before this phase is complete and tested (REQ-DEMO compliance — no
fake Pay button in Phase 10/14 UI; those phases show plan/schedule only until
Phase 15 wires the real action).

**Tests:** Valid/invalid/tampered signature cases; duplicate webhook delivery
produces exactly one payment row and one balance update; amount mismatch is held
for review rather than silently accepted; concurrent payments against different
installments of the same enrollment don't race incorrectly.

**DoD:** A test-mode Razorpay payment completes end-to-end and the enrollment's
outstanding balance updates correctly and only for that enrollment.

## Phase 16 — Receipts

**Scope:** Receipt number sequence usage (already defined in Phase 2), PDF
generation (`@react-pdf/renderer`) triggered on confirmed payment (online or
offline), storage in the `receipts` bucket, download in both Admin and Student
portals, email-on-payment (requires Phase 20's email infra — if sequenced before
Phase 20, the email send is stubbed/queued and clearly logged as pending rather
than silently dropped; recommend pulling minimal email sending forward into this
phase if it doesn't complicate Phase 20's fuller scope).

**DB changes:** None beyond Phase 2 (`receipts`).

**Security implications:** Concurrency-safe numbering verified under parallel
payment confirmations (unit/integration test with simulated concurrent
transactions).

**DoD:** Every successful payment (online or offline, from Phase 14's manual-entry
UI too) produces a real, downloadable, correctly numbered PDF receipt — no
"Download Receipt" button appears before this phase ships.

## Phase 17 — Materials

**Scope:** Upload UI (Admin/Trainer) scoped to program/batch/module/session;
Storage integration with private buckets + signed URLs; Student materials view
scoped to active enrollment.

**DB changes:** None beyond Phase 2 (`materials`).

**Security implications:** File upload validation per `SECURITY_PLAN.md` §8;
verify a student cannot access materials for a program/batch they are not
enrolled in via direct storage-path guessing (paths are non-guessable UUID-keyed
regardless).

**DoD:** A student sees only materials for their own enrolled batches; download
works via signed URL with expiry.

## Phase 18 — Assignments

**Scope:** Assignment CRUD (Trainer, scoped to assigned batch), submission flow
(Student: text/file, status), review/grading UI (Trainer), status lifecycle.

**DB changes:** None beyond Phase 2 (`assignments`, `assignment_submissions`).

**DoD:** A student can submit an assignment and see trainer feedback/marks; a
trainer can only grade submissions for their own assigned batches.

## Phase 19 — Certificates

**Scope:** Certificate issuance (Admin, per completed enrollment), PDF generation,
revoke/reissue with audit history, Student download view, public
`/verify-certificate` page + API.

**DB changes:** None beyond Phase 2 (`certificates`).

**Security implications:** Public verification endpoint returns only the limited
field set defined in `API_AND_INTEGRATIONS.md` §6; rate-limited.

**DoD:** A certificate can be issued, downloaded by the student, and verified
publicly by number without exposing private data.

## Phase 20 — Email Notifications

**Scope:** `EmailSender` abstraction + Resend adapter, React Email templates for
all events in `REQUIREMENTS.md` FR-110, `email_log` wiring, retrofitting Phase 15/
16/19's send points if they were stubbed earlier, in-app `notifications` feed +
`NotificationDispatcher`.

**DB changes:** None beyond Phase 2 (`notifications`, `email_log`).

**DoD:** Enrollment confirmation, payment receipt, and certificate-issued emails
actually arrive (verified against a real or sandbox provider account) with
correct company branding pulled from Settings.

## Phase 21 — Reports

**Scope:** All report categories from `REQUIREMENTS.md` FR-120 (student,
enrollment, payment, attendance, trainer), server-side pagination, CSV export.

**DB changes:** Additional indexes/views only if a specific report's query plan
needs them (evaluate with `EXPLAIN` during implementation, not speculatively).

**DoD:** Each report renders from live data with working filters and a working
CSV export that never loads the full result set into browser memory.

## Phase 22 — Public Website

**Scope:** Home, About, Programs (list + detail from real `programs` data),
Corporate Training, Contact, Student/Trainer login entry points, company branding
sourced entirely from `company_settings`.

**DB changes:** None (read-only public queries against existing tables, scoped to
`status = 'active'` programs only).

**DoD:** Public site reflects real, currently-active programs — no hard-coded
marketing copy about programs that don't exist in the database.

## Phase 23 — Lead Management

**Scope:** Public inquiry form → `leads` insert, Admin lead pipeline UI, lead-to-
student conversion flow preserving `lead_id`/source on the resulting student
record.

**DB changes:** None beyond Phase 2 (`leads`).

**Security implications:** Public form is rate-limited and validated
server-side; no authentication required to submit, but reading the lead list is
Admin-only.

**DoD:** A public inquiry becomes a lead visible in Admin, and converting it to a
student carries the source through, per BR/Registration Flow (§39–40).

## Phase 24 — Testing & Security Review

**Scope:** Fill any test gaps against the priority list in
`SECURITY_PLAN.md` §18 and the brief's §58; run the `security-review` skill
against the full diff history; Playwright E2E covering the golden path
(registration → enrollment → payment → attendance → certificate) per role.

**DoD:** Priority test list has passing coverage; security review findings are
resolved or explicitly accepted with reasoning recorded.

## Phase 25 — Production Deployment

**Scope:** Production Supabase project provisioning, production Razorpay live
keys, Vercel production environment variables, webhook URL registration, final
README deployment walkthrough, backup-strategy documentation (Supabase's own
point-in-time recovery / scheduled backups, per plan tier).

**DoD:** A production deployment is reachable, environment-isolated from
dev/staging, with live payment processing verified via a small real transaction
in a controlled test.

---

## Cross-Cutting Work (Not a Single Phase, Applied Throughout)

- **Testing:** Vitest for unit/domain-logic tests (student ID generation, balance
  calculation, RBAC checks, Razorpay signature verification, receipt numbering
  concurrency); Playwright for E2E flows per role. Each phase above adds its own
  tests as part of that phase's DoD — testing is not deferred entirely to Phase 24.
- **Accessibility:** Checked per-component as built (shadcn/ui primitives are
  already accessible by default; custom components follow the same bar), not
  retrofitted at the end.
- **No fake implementations (REQ-DEMO):** enforced phase-by-phase — a feature's UI
  ships in the same phase as its backing persistence/integration, never ahead of
  it. Where a dashboard widget's data source lands in a later phase, the widget
  either doesn't ship yet or explicitly shows a "coming soon" state — never a
  fabricated number.

## Recommended First Phase

**Phase 1 (Project Setup)**, immediately followed by **Phase 2 (Database Schema)**
— both are prerequisites for everything else and involve no unresolved business
decisions, so they can start as soon as this planning package is accepted.
