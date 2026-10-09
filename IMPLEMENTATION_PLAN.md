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

### Current roadmap (authoritative; supersedes older phase lists)

Phases 1–19 are complete and merged (numbering unchanged). Remaining order,
private LMS first — the public website is deferred until the private LMS is
finished:

| Phase | Scope | Status |
|---|---|---|
| 18b | Email & multi-channel delivery | Deferred |
| **20A** | **Offline Payments Ledger** — Admin offline payment recording + Payments ledger (FR-90/FR-91/BR-6) | Active |
| 20B | Razorpay Integration (FR-92/FR-93) | Not started — needs test-mode keys, webhook secret and a reachable webhook URL |
| 21 | Receipts, Refunds & Payment Documents (FR-94/FR-95/FR-97) | Not started — needs DECISIONS_NEEDED.md D7 (receipt half) and D8 |
| 22 | Public Website | Deferred |
| 23 | Lead Management | Not started |
| 24 | Testing & Security Review | Not started |
| 25 | Production Deployment | Not started |

Phase 20A was split out of the documented Phase 20 at the Phase 20 scope
gate: FR-90's admin-recorded offline payment is P0, was assigned to no
phase, and has no external dependency, while Razorpay needs credentials.
It is a prerequisite of 20B (both write the same `payments` table and feed
the same Phase 14 balance), not a replacement. Older notes inside completed
phases that mention earlier numberings (e.g. "Reports (Phase 21)" in
Phase 11) are historical and left as written.

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
here and reused unchanged in Phase 14/20/21.

**Security implications:** Fee/discount overrides audited (`audit_logs`) from
this phase forward.

**Tests:** Multiple enrollments per student (§68/§69 verification); a payment
against one enrollment never touches another enrollment's balance (§67
verification — even though payments aren't built until Phase 14/20, this phase's
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

**Status:** COMPLETED — merged to `main` at commit `474fd41` (fast-forward
from `claude/phase14-financial-engine`). Manual Windows browser acceptance
confirmed 7/7 passed before merge; synthetic E2E test data cleanup verified
via a dedicated read-only audit script.

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

**Pre-acceptance review re-verification:** `DATABASE_SCHEMA.md` lists
`payment_plans.total_amount` only as `numeric(12,2) not null`, with no
formula given (unlike `enrollments.total_payable`, whose formula §6 states
explicitly) — so no primary source defines it as A) a derived total of
installments, B) an independently agreed plan total, or C) a snapshot of
`enrollments.total_payable`. Of these, (A) is the only option that avoids
inventing either a second form field or a matching-validation rule, and it
follows this codebase's own established cache-field precedent exactly —
so it is kept as the least-destructive, least-invented interpretation.
(B) would require Admin to type an independent total with no defined
reconciliation rule against the lines (the exact guess the brief warned
against); (C) would force every plan's total to equal the Enrollment's
full `total_payable`, which is not stated anywhere and would wrongly
forbid a plan that only schedules part of what's owed. No code change
was needed for this item.

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
`waived`, an Admin business decision no formula can derive.
`partially_paid`/`paid` are computed from `amount_paid_cache`, which
Phase 14 never writes to (structurally unreachable for a Phase-14-created
installment until a real payment posts in Phase 20/21) — the derivation
still handles them correctly once one does.

**Pre-acceptance review correction:** the status CHECK constraint and
FR-96 list `overdue` as an *allowed* status value, but neither
`REQUIREMENTS.md`, `DATABASE_SCHEMA.md`, nor any other primary source
defines a timezone, date boundary, overdue threshold, or grace period for
when an installment actually becomes overdue — only that `due`/`upcoming`
are allowed statuses was ever a safe inference. The original Phase 14
build derived `overdue` automatically from a bare `due_date < today`
string comparison; this was an invented rule the Phase 14 brief explicitly
warned against ("do not implement overdue logic unless requirements
define timezone/boundary/threshold/grace-period"). Corrected:
`deriveInstallmentDisplayStatus` now computes only `due` (unpaid, due date
on or before today) and `upcoming` (unpaid, due date in the future) from
the date; it never assigns `overdue`. `overdue` remains a valid
`InstallmentStatus` value — preserved in the type and the CHECK constraint
— for a future phase that defines the missing rule explicitly, but Phase
14 does not decide it.

An installment whose derived status is `paid` is never editable,
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

Registration fee is confirmed, from `DATABASE_SCHEMA.md` §6's own formula
(`total_payable = agreed_fee - discount_amount + registration_fee +
tax_amount`), to already be part of `total_payable` on the Enrollment
itself — not a separate, immediately-due concept.

**Pre-acceptance review correction:** the original Phase 14 build went
further than this and modeled the brief's own worked example ("₹10,000
registration + two ₹20,000 installments") as a requirement that an
installment schedule's first line must represent the registration fee —
reflected in a UI placeholder hint ("e.g. Registration" on row 1 only) and
in this document's own prior wording ("registration is simply
installment #1"). On re-inspection, no primary source (`REQUIREMENTS.md`,
`DATABASE_SCHEMA.md`, this plan's own DoD text) actually requires this:
`registration_fee` being part of `total_payable` says nothing about
whether, or how, it should also appear as an installment line, and
`DATABASE_SCHEMA.md`'s `installments.label` comment ("e.g. 'Registration',
'Installment 1'") is only an illustration of free-text label values, not a
rule that row 1 must be a registration line. Classification: **C —
merely inferred from an example**, not explicitly required. Corrected:
Payment Plans are fully generic — every installment row's label, amount,
and due date are entirely Admin-defined with no position-dependent
default or assumption. The create-plan form's placeholder text is now the
same neutral `Installment {n}` for every row, including the first. Admin
remains free to label a row "Registration" (or anything else) if that
fits their process — that is ordinary free-text labeling, not application
logic. `registration_fee` on the Enrollment itself is unchanged.

FR-31 (Confirmed Unpaid Fees / outstanding-balance sign behavior) remains
the same unresolved discrepancy flagged during Phase 9 — see this phase's
completion report for the full triangulation across `REQUIREMENTS.md`,
`DATABASE_SCHEMA.md`, and the actual code. Phase 14 never reads or writes
`amount_paid_cache`/`outstanding_balance_cache`/the outstanding-balance
formula at all — Payment Plans are a planned schedule, entirely separate
from the actual-payments arithmetic FR-31 concerns — so this phase neither
resolves nor depends on resolving it.)

## Phase 15 — Materials

**Status:** COMPLETED — merged into `main` at `c1da25b` (fast-forward from
`474fd41`), after 7/7 Windows browser acceptance and a final read-only
cleanup audit confirming zero residue.

**Scope:** Upload UI (Admin/Trainer) scoped to Program/Batch/Module/Session;
Storage integration with a private bucket + signed URLs; Student materials
view scoped to active enrollment.

**DB changes:** None beyond Phase 2 (`materials`, `program_modules`) except
one narrowing-only RLS correction
(`20260101000026_materials_student_rls_active_enrollment.sql`, see below) and
one new Storage bucket + policy migration
(`20260101000027_materials_storage.sql`).

**Security implications:** File upload validation per `SECURITY_PLAN.md` §8
(extension allow-list, size limits, MIME sniffing from actual bytes, never
the trusted Content-Type header alone); verified a Student cannot access
Materials for a Program/Batch/Module/Session they are not (status-)eligibly
enrolled in, at both the table and Storage layers, via direct id/path
tampering (`supabase/tests/phase15_materials_test.sql`); the `materials`
Storage bucket is private (`public: false`), never a public URL.

**DoD:** A student sees only materials for their own eligibly-enrolled
Program/Batch (Module/Session access is RLS-authorized but not separately
surfaced on the Student enrollment page — see "Known limitations" below);
download works via a short-lived signed URL.

(Phase 15 implementation note: the `materials`/`program_modules` tables and
every RLS policy this phase relies on
(materials_select_admin/select_trainer/write_admin/write_trainer/
update_admin/delete_admin, 20260101000014_rls_policies.sql) already existed,
provisioned ahead of schedule alongside the rest of the schema in Phase 2 —
Phase 15 is the first phase to actually write to `materials` and is purely
an application-layer build on top of mostly-unchanged, pre-existing
security, the same relationship Phase 12 had to `class_sessions` and
Phase 14 had to `payment_plans`/`installments`.

**Approved Phase 15 business decision — Student "active enrollment" status
set:** FR-71 does not define which enrollment statuses count as "active" for
Materials access. After discovery review, the approved rule is: ALLOWED —
`enrolled`, `active`, `on_hold`, `completed`; DENIED — `lead`, `applicant`,
`withdrawn`, `cancelled`. This aligns with the project's own pre-existing,
named "operational/student-active" status grouping
(`20260101000025_enrollment_batch_integrity_constraints.sql`'s own comment);
`completed` specifically was the one sub-question FR-71 itself left
unresolved, and its inclusion is a deliberate, explicit Phase 15 decision
(a completed student keeps access to their own past learning materials),
not an inference from any primary source. Enforced as a **narrowing-only**
correction to the pre-existing `materials_select_student` policy, applied
identically across all four scope branches (program/batch/module/session)
and mirrored in the Storage bucket's own `materials_bucket_select_student`
policy — RLS is the real authorization boundary; no application query
re-derives this filter itself.

**Scope model — exactly one of Program/Batch/Module/Session per material:**
the `materials_scoped` CHECK constraint only requires at least one of the
four columns non-null; FR-70's own "Program, Batch, Session, or Module"
wording gives no worked multi-scope example. The smallest, least-invented
reading — exactly one scope per material — is enforced at the application
layer only (`lib/domain/materials.ts`'s `resolveExactlyOneScope`); the DB
CHECK is deliberately left exactly as-is, an explicit approved decision, not
an oversight.

**Module scope — read-only picker, no Module CRUD:** Admin may scope a
material to an existing Module via a picker on the Program detail page
(`listProgramModules` — a SELECT of whatever `program_modules` rows already
exist); Module CRUD itself stays entirely out of Phase 15's scope. Trainer
upload remains Batch/Session-scoped only, matching `materials_write_trainer`
RLS exactly — no Program/Module access was invented for Trainer this phase,
since no RLS path exists for it and inventing one was explicitly forbidden.

**No hard-delete UI for Materials:** an RLS DELETE policy
(`materials_delete_admin`) proves the DB permits deletion, but no primary
source (`REQUIREMENTS.md`, this plan, the brief) actually specifies a
destructive-delete requirement for Materials — classification: unclear/not
specified. Per this engagement's own "do not invent a destructive UI control
when the requirement is unclear" rule, no hard-delete button is exposed
anywhere in the Admin UI this phase, matching the DELETE policy's own
"at the RLS layer, not exposed in the application" treatment Phase 14 used
for `payment_plans_delete_admin`. No archive/`is_active` schema was added
either, for the same reason — nothing requires it.

**Storage — private bucket, signed URLs, server-built paths:** a new
`materials` Storage bucket (`public: false`); access is via a short-lived
signed URL (`MATERIAL_SIGNED_URL_EXPIRY_SECONDS = 300`,
`lib/domain/materials.ts` — a named engineering default, not a business
rule, never persisted, changeable without a migration), minted fresh on
every request through the caller's own RLS-scoped session (never the
service-role client), so Storage RLS independently gates it even if table
RLS were ever misconfigured. Object paths are entirely server-built
(`{scopeType}/{scopeId}/{objectId}-{sanitizedName}` — the caller-supplied
original filename only ever contributes a sanitized cosmetic suffix, never
path authority) and are a defense-in-depth, trusted-identifier prefix for
the Trainer INSERT policy only (needed because no `materials` metadata row
exists yet at that exact moment to join against); every other Storage
operation (SELECT) joins back to the real `materials` row and applies the
identical authorization logic the table's own RLS policies already use —
this file does not re-derive or duplicate that logic. MIME content is
verified from the actual file bytes (`matchesMaterialFileSignature`), never
the trusted Content-Type header alone, per `SECURITY_PLAN.md` §8.

**Known limitations / deferred:** The Student enrollment page surfaces
Program- and Batch-scoped materials only (the "smallest useful UI" this
phase's own brief called for) — Module/Session-scoped materials remain
fully RLS-authorized for an eligible Student but are not separately
rendered on that page. No hard-delete/archive capability anywhere (see
above). No assignments, certificates, notifications, reports, Razorpay,
receipts, quizzes, progress-tracking, public material library, public
material URLs, video streaming/DRM/CDN integration, or content
recommendations — all explicitly out of Phase 15's scope and untouched.)

## Phase 16 — Assignments & Submissions

**Status:** ACTIVE IMPLEMENTATION — branch
`claude/phase16-assignments-submissions`, based off `main` at `c1da25b` (the
Phase 15 baseline). Not yet merged; awaiting manual Windows browser
acceptance, then explicit approval, per the same gate Phase 10–15 went
through.

**Scope:** Assignment creation (Admin, any Batch; Trainer, scoped to their own
assigned Batch only) with an optional Module tag, due date, optional
attachment; Student submission (text and/or file) against their own
Enrollment; Trainer/Admin review (marks/feedback, the two schema-defined
reviewer outcomes); status lifecycle exactly as the pre-existing schema
defines it (`not_submitted` → `submitted`/`late` → `reviewed`/
`resubmission_requested`).

**DB changes:** None for the `assignments`/`assignment_submissions` tables
themselves or their table-level RLS — both existed already, provisioned
ahead of schedule alongside the rest of the schema in Phase 2
(`20260101000008_academic_tables.sql`'s own `assignments`/
`assignment_submissions` tables; `assignments_select_admin/_trainer/_student`,
`assignments_write_admin/_trainer`, `assignments_update_admin/_trainer`,
`assignments_delete_admin`, `assignment_submissions_select_admin/_trainer/
_own`, `assignment_submissions_write_admin/_own`,
`assignment_submissions_update_admin/_trainer/_own` in
`20260101000014_rls_policies.sql`). Two migrations this phase actually adds:
- `20260101000028_assignment_submissions_ownership_rls.sql` — a **narrowing-
  only** security fix for a real pre-existing gap found during discovery:
  `assignment_submissions_write_own`/`_update_own` only ever checked
  `student_id = current_student_id()`, never that the submitted
  `enrollment_id` actually belonged to that student or matched the target
  assignment's own `batch_id`. Closed the same way Phase 15's own
  `20260101000026` narrowed `materials_select_student` — adds an `exists(...)`
  condition, grants nothing new.
- `20260101000029_assignments_storage.sql` — two new private Storage buckets,
  `assignment-attachments` and `assignment-submissions` (see below).
- `20260101000030_assignments_student_rls_active_enrollment.sql` — a
  **narrowing-only** business-rule correction, added after an explicit
  pre-browser-testing checkpoint (neither REQUIREMENTS.md nor
  USER_ROLES_AND_PERMISSIONS.md name an enrollment-status set for
  Assignment visibility/submission at all — a genuine primary-source gap,
  reported rather than silently resolved). Final approved decision: VIEW
  and SUBMIT use **different** status sets —
  - **VIEW** assignments / history: ALLOWED `enrolled`/`active`/`on_hold`/
    `completed` (same set as Materials' own `20260101000026`), DENIED
    `lead`/`applicant`/`withdrawn`/`cancelled`.
  - **SUBMIT/UPDATE** (resubmit) own submission: ALLOWED `enrolled`/
    `active` ONLY — narrower than VIEW. An `on_hold` student can see their
    assignments but may not submit new work while paused; a `completed`
    student can see their past assignments but has no outstanding
    coursework to submit. DENIED `lead`/`applicant`/`on_hold`/`completed`/
    `withdrawn`/`cancelled`.
  - **Own past submission/grade** (`assignment_submissions_select_own`):
    deliberately left UNCHANGED/status-unfiltered — a permanent academic
    record, visible regardless of what the enrollment status later
    becomes.

**Security implications:** File upload validation reuses `SECURITY_PLAN.md`
§8's policy verbatim (extension allow-list, 10MB document/5MB image size
limits, MIME sniffing from actual bytes — `lib/domain/assignments.ts`, a
self-contained duplicate of `lib/domain/materials.ts`'s own rules, not a
cross-import, since Assignments is a separate domain). Submission ownership
is server-derived, never browser-trusted: `lib/data/student-portal.ts`'s
`submitMyAssignment` re-resolves the caller's own `enrollment_id` from their
`student_id` + the assignment's `batch_id` on every call, backed by
`20260101000028` at the DB layer too. Direct id/path tampering (another
student's `enrollment_id`, a cross-batch `assignment_id`, a malformed/
non-UUID/wrong-segment-count Storage path) is proven denied at the RLS layer
by `supabase/tests/phase16_assignments_test.sql`. Both Storage buckets are
private (`public: false`), never a public URL; access is a short-lived
signed URL only, minted through the caller's own RLS-scoped session.

**DoD:** A student can submit an assignment (text and/or file) against their
own enrolled Batch and see Trainer/Admin feedback/marks once reviewed; an
assigned Trainer can create assignments and review submissions only for
their own assigned Batches; Admin can do the same for any Batch.

(Phase 16 implementation note: the `assignments`/`assignment_submissions`
tables and their table-level RLS already existed from Phase 2 — this phase
is the first to actually write to either table, and is purely an
application-layer build on top of mostly-unchanged, pre-existing security,
the same relationship Phase 15 had to `materials`.

**Scope model — NOT inferred from Materials, read directly from schema:**
`assignments.program_id`/`batch_id` are both `NOT NULL` (never "exactly one
of four" the way Materials is) — every assignment is Program-AND-Batch
scoped, with an optional Module tag (`module_id`, `ON DELETE SET NULL`,
unlike Materials' per-scope `ON DELETE CASCADE`). There is no
`class_session_id` column on `assignments` at all — Session-scoped
assignments do not exist in this schema and were not invented.

**Submission uniqueness — schema-defined, not invented:** `assignment_
submissions_unique unique (assignment_id, enrollment_id)` is the one row per
assignment per enrollment; resubmission is an UPDATE of that same row, never
a second row. Phase 16's own approved, documented (non-DB) interpretation:
once a submission's status is `reviewed`, the Student-facing submit form is
withdrawn (`lib/data/student-portal.ts`'s `submitMyAssignment` also rejects
the write server-side) until the reviewer explicitly sets
`resubmission_requested` — a reviewer-outcome-gated edit window, not an
invented status value.

**Due-date/late semantics — mechanical, not invented:** `due_date` is a plain
`date` (no time component); no grace period, late penalty, auto-rejection, or
timezone policy is defined anywhere in requirements, and none was invented —
a submission is never blocked after the due date. `resolveSubmissionStatusForNow`
(`lib/domain/assignments.ts`) picks between the two already-existing enum
values (`submitted`/`late`) by comparing the server's own current UTC date to
`due_date` — a mechanical use of existing values, not a new business rule.
Known limitation: no per-batch/student timezone is read anywhere in this
comparison.

**Feedback/marks — schema already supports it, nothing invented:**
`assignment_submissions.marks`/`trainer_feedback`/`reviewed_by`/`reviewed_at`
already existed (Phase 2), and FR-45/FR-53 explicitly authorize Student
read/Trainer write of exactly this. One finding worth flagging: `reviewed_by`
has a FOREIGN KEY to `trainers(id)` **only** — there is no column shaped to
hold an Admin's own `admins.id` here. An Admin-performed review
(`reviewSubmissionAsAdminAction`) therefore leaves `reviewed_by` NULL;
`reviewed_at` still records that a review happened. `marks` is bounded
app-side by the assignment's own `max_marks` (`isMarksWithinCeiling`) — an
application safeguard, not a DB CHECK tying the two columns together.

**created_by/submitted_by contract — verified, not assumed:** `assignments.
trainer_id` and `assignment_submissions.student_id`/`enrollment_id` are all
role-profile ids (`trainers.id`/`students.id`/`enrollments.id`), resolved
server-side from the caller's own session (`resolveMyTrainerId`/
`resolveMyStudentId` — the same established contract Phase 15's own
`uploaded_by` audit finding proved), never the raw `auth_user_id` and never
browser-supplied.

**Storage — two private buckets, signed URLs, server-built paths:**
`assignment-attachments` (`{assignmentId}/{objectId}-{sanitizedName}`) and
`assignment-submissions` (`{assignmentId}/{studentId}/{objectId}-
{sanitizedName}`) — kept as two separate buckets rather than one with
path-prefix branching, since Trainer/Admin-provided attachments and
Student-provided submissions have entirely different write-permission
shapes (`20260101000029_assignments_storage.sql`'s own header comment).
Unlike Materials (whose Trainer INSERT policy had to trust path-encoded
scope, since no `materials` row existed yet at upload time), the Assignment
creation flow inserts the `assignments` row FIRST (attachment optional,
`attachment_path` still null), then uploads the attachment keyed by the
now-real assignment id, then updates `attachment_path` — so the Trainer
Storage INSERT policy can join directly to the real `assignments` row
instead of re-deriving trust from the path text, a strictly tighter design
than Materials' own INSERT-before-row-exists workaround. If the attachment
upload fails, the just-created (brand new, submission-free) assignment row
is deleted rather than left half-created, since this phase builds no
separate "edit assignment"/re-upload flow. Access is via a short-lived
signed URL (`ASSIGNMENT_SIGNED_URL_EXPIRY_SECONDS = 300`, same engineering-
default reasoning as Materials' own constant), minted fresh per request
through the caller's own RLS-scoped session.

**No hard-delete UI for Assignments/Submissions:** `assignments_delete_admin`
exists at the RLS layer (Admin only — no Trainer/Student delete policy for
either table at all), but no primary source specifies a destructive-delete
requirement, so no hard-delete button is exposed anywhere in the application,
matching Phase 14/15's own identical treatment of their own DELETE policies.

**RESOLVED by explicit checkpoint decision (was a known limitation, now
closed):** `assignments_select_student` and `assignment_submissions_write_own`/
`_update_own` originally had no enrollment-status filter at all (a genuine
primary-source gap — reported rather than silently resolved). After two
rounds of an explicit pre-browser-testing checkpoint, the final approved
decision SPLITS the two permissions: VIEW allows
`enrolled`/`active`/`on_hold`/`completed` (same set as Materials); SUBMIT/
resubmit allows `enrolled`/`active` ONLY (narrower — `on_hold` and
`completed` can see but not submit); both deny
`lead`/`applicant`/`withdrawn`/`cancelled`. Enforced by
`20260101000030_assignments_student_rls_active_enrollment.sql`. Viewing
one's OWN past submission (`assignment_submissions_select_own`) stays
status-unfiltered by the same explicit decision — a permanent academic
record. Proven at the RLS layer, with direct per-status evidence (not
inferred from one case to another), by
`supabase/tests/phase16_assignments_test.sql`'s own enrolled/active/
on_hold/completed/withdrawn/cancelled Student sections.
- Admin's assignment-creation form requires picking a Trainer from that
  Batch's own assigned trainers (`getBatchTrainerAssignments`) — an
  application-layer convenience/data-integrity choice (consistent attribution
  to a real co-teacher of the batch), not an RLS restriction; `assignments_
  write_admin` itself has no such restriction and would accept any trainer
  id.
- No full batch-roster cross-reference exists in the Admin/Trainer
  submissions UI — a Student with no submission row simply never appears in
  `SubmissionsSection`'s list (there is no synthesized "not submitted"
  placeholder row), a smallest-useful-UI scope decision, not a limitation of
  the underlying data.
- No notifications, certificates, reports/analytics, Razorpay, receipts,
  rubrics/numeric-scoring beyond the existing flat `marks` column, plagiarism
  detection, AI grading, discussion/comments, quizzes/exams, or public
  assignment pages — all explicitly out of Phase 16's scope and untouched.)

## Phase 17 — Certificates

**Status:** ACTIVE IMPLEMENTATION — branch `claude/phase17-certificates`, based
off `main` at `2698020` (the Phase 16 baseline). Not yet merged; awaiting
manual Windows browser acceptance, then explicit approval, per the same gate
Phase 10–16 went through.

**Scope:** Certificate issuance (Admin/Super Admin only, per eligible
Enrollment), server-side PDF generation, standalone revoke and atomic
reissue-with-history-preservation, Student own-read/download, public
`/verify-certificate` page + server action (built in this phase, not
deferred — see the Public verification note below).

**DB changes:** The `certificates` table and its table-level RLS
(`certificates_select_admin/_select_own`, `certificates_write_admin`,
`certificates_update_admin` — no delete policy for any role) already existed
from Phase 2 (`20260101000009_certificates_leads_notifications.sql`,
`20260101000014_rls_policies.sql`), as did the immutability trigger
(`20260101000012_receipt_certificate_immutability.sql`) and
`certificate_number_seq`/`company_settings.certificate_number_format`
(`20260101000002_sequences.sql`, `20260101000003_company_settings.sql`).
Three migrations this phase actually adds:
- `20260101000031_certificate_number_generation.sql` — `generate_certificate_
  number()`, formatting a new number from `company_settings.
  certificate_number_format` using the existing, global, never-reset
  `certificate_number_seq`; self-gated to Admin/Super Admin
  (`is_admin_or_super()`), EXECUTE revoked from `public`/`anon`/
  `authenticated` then re-granted only to `authenticated`, matching
  `20260101000016`'s own hardening precedent; also wired as the
  `certificates.certificate_number` column `DEFAULT` as a defense-in-depth
  fallback.
- `20260101000032_certificates_storage.sql` — the private `certificates`
  Storage bucket (Admin full; Student select-own via a join to the real
  `certificates` row; no anon policy of any kind).
- `20260101000033_reissue_certificate_function.sql` — `reissue_certificate()`,
  atomically inserting the replacement row and marking the original revoked
  in one plpgsql function body (a single statement in the caller's own
  transaction), so a reissue can never partially apply; same Admin/Super
  Admin self-gate and EXECUTE lockdown as `generate_certificate_number()`.

**Eligibility rule — a checkpoint-approved business decision, not inferred:**
ALL THREE conditions must hold: (1) `enrollment.status = 'completed'`, (2)
`program.certificate_eligible = true`, (3) the enrollment's outstanding
balance is `<= 0`. The balance check calls the one existing authoritative
`getEnrollmentFinancialSummary(enrollmentId, totalPayable)`
(`lib/data/enrollments.ts`) — never a duplicated/reinterpreted financial
calculation, never another enrollment's balance — exactly as the checkpoint
required. `lib/domain/certificates.ts`'s `resolveCertificateEligibility` is
pure and unit-tested against the 5 required cases (completed+eligible+paid
→ eligible; completed+eligible+unpaid → not eligible; not-completed+paid →
not eligible; completed+ineligible-program+paid → not eligible; another
enrollment's paid status never crosses over). `issueCertificateRecord`
(`lib/data/certificates.ts`) re-derives this server-side on every issuance
attempt — the Admin UI's own eligibility display is never trusted as the
real gate.

**Certificate ID — server-generated, sequential, unique, immutable:**
`certificate_number` is minted via the `generate_certificate_number()` RPC
(never browser-supplied), using the pre-existing global `certificate_number_
seq` — confirmed via checkpoint: **monotonic, never resets per calendar
year** (`DECISIONS_NEEDED.md` D7, certificate half resolved). Because
`certificates.pdf_path` is `NOT NULL` and immutable
(`20260101000012`), the application must mint the number and render the PDF
with it printed BEFORE the row exists at all — the opposite ordering from
Materials/Assignments' own "insert row first, attach after" pattern. Neither
`certificate_number` nor `pdf_path`/`enrollment_id`/`student_id`/
`program_id`/`completion_date`/`issue_date` can ever be changed after
creation, for any role including Admin (`prevent_certificate_immutable_
fields_change`, proven in `supabase/tests/phase17_certificates_test.sql`).

**Issuance/revocation/reissue workflow:**
- **Issue** (`issueCertificateRecord`): re-check eligibility → mint number
  (RPC) → render PDF (`lib/pdf/certificate.tsx`'s `renderCertificatePdf`) →
  upload to the `certificates` bucket at `{studentId}/{certificateNumber}.pdf`
  → insert the row with the already-known number/path. If the insert fails,
  the just-uploaded object is removed (no orphan file); if the upload fails,
  the consumed sequence number is simply skipped, the same gap-tolerance
  every other id sequence in this schema already accepts.
- **Revoke** (`revokeCertificateRecord`): standalone, no replacement —
  `status='revoked'`, `revoked_reason`, `revoked_at`. Refuses to revoke an
  already-revoked certificate. Never deletes the row.
- **Reissue** (`reissueCertificateRecord`): mints a new number, renders/
  uploads a new PDF carrying over the original's `completion_date`, then
  calls `reissue_certificate()` to atomically insert the new row AND mark
  the original revoked (reason defaults to `"Replaced by reissued
  certificate <newNumber>"` when none is given) — never two simultaneously
  `issued` rows for one completion event. Refuses to reissue a certificate
  that is not currently `issued`. If the final RPC call fails, the
  already-uploaded new PDF object is removed; the original row is never
  touched on failure.
- **Verification history:** no `replaces`/`replaced_by` FK column exists —
  this is the documented design (the `certificates` table's own comment:
  "Reissue creates a new row... and marks the prior one revoked — history is
  preserved"), reconstructed by shared `enrollment_id` + chronological
  `issue_date`/`created_at` ordering, not a gap filled in with invented
  structure. A revoked certificate is never hard-deleted — no delete policy
  exists for any role at the RLS layer, and no hard-delete UI is exposed
  anywhere in the application.

**Student/Trainer/Admin access:** Student sees and downloads only their own
certificates (`certificates_select_own`, `GET /student/enrollments/[id]`'s
own `StudentCertificatesCard`) — issued certificates remain visible
regardless of the Enrollment's current/later status (a permanent academic
record, deliberately NOT given Materials/Assignments-style status
filtering); cannot issue/revoke/reissue. Trainer has **zero** certificate
access of any kind (`USER_ROLES_AND_PERMISSIONS.md`'s own matrix: Trainer
"–" on certificates) — no RLS policy, no Storage policy, no UI surface, no
side-channel financial exposure through a certificate join. Admin/Super
Admin share one model (no invented Admin-vs-Super-Admin distinction) — every
mutation is server-authorized (`lib/actions/certificates.ts` re-checks
`isAdminOrSuperAdmin` before calling into the data layer).

**PDF architecture:** `@react-pdf/renderer` (the `API_AND_INTEGRATIONS.md`
§5.2 "Recommended... for V1" pick — no new library invented, no headless-
Chromium pipeline). `lib/pdf/certificate.tsx` is a text-only V1 design (no
logo image embedding — `DECISIONS_NEEDED.md` D4's own "clean original
design" default) showing only the approved field list: student display
name, program name, certificate number, completion/issue dates, and
`company_settings`' own legal name/signatory name/title — never grades,
attendance, payment info, Trainer names, or anything outside that list.

**Storage/signed-download:** Private `certificates` bucket (`public:
false`), object paths server-built and deterministic
(`buildCertificatePath`), never caller-supplied. Download is the same
proven id-first pattern as Materials/Assignments:
`getCertificateDownloadUrl` re-fetches the row through the caller's own
RLS-scoped session first, and only then mints a signed URL through that
same session — a certificate the caller cannot see never reaches a Storage
call at all. `CERTIFICATE_SIGNED_URL_EXPIRY_SECONDS = 300`, reusing Phase
15/16's own established engineering default (no certificate-specific
requirement conflicts with it).

**Public verification — built now, not deferred:** the brief's own framing
suggested AD-L-006 (public verification) belonged to a future phase, but
discovery found `IMPLEMENTATION_PLAN.md`'s own pre-existing Phase 17 scope
line above, `DECISIONS_NEEDED.md` D4, and `SECURITY_PLAN.md`'s own existing
rate-limiting/data-minimization design for exactly this page all
independently already placed it in Phase 17 — reported, then explicitly
authorized by checkpoint to build now. `/verify-certificate`
(`app/(public)/verify-certificate`) is an anonymous page + `"use server"`
action (`verifyCertificateAction`, `lib/actions/certificates.ts`) — no
separate `app/api/...` route handler exists anywhere else in this codebase
either, so a Server Action is this project's own established "API" layer,
not a deviation. Data comes from `verifyCertificatePublic`
(`lib/data/certificates.ts`), which uses the service-role client
(`lib/supabase/admin.ts`'s documented narrow-use pattern — no anon RLS
policy exists or was added) with an explicit column allow-list matching the
`certificates` table's own documented approved public field set
(certificate number, student display name, program name, issue date,
status) — never `select('*')`, never financial/Trainer/internal-id data.
Rate-limited by IP (`checkRateLimit`, `lib/auth/rate-limit.ts` — the same
existing in-memory/Upstash backend already used for `/login`/
`/forgot-password`; `SECURITY_PLAN.md` §11's own "Upstash Redis... or a
Postgres-table-backed limiter" note names either as acceptable, and this
phase reuses the backend the codebase already has rather than adding either
a new managed-service dependency or a new Postgres-table limiter).

**Security implications:** Public verification endpoint returns only the
limited field set above, rate-limited (10 requests/60s per IP). No new
financial exposure to Trainer or the public endpoint at any point — the
eligibility check's own outstanding-balance read never leaves the Admin-only
issuance path. Direct tampering (cross-student certificate id, Trainer/
Student calling the issuance/revoke/reissue actions or the `generate_
certificate_number()`/`reissue_certificate()` RPCs directly, anonymous table/
Storage access) is proven denied at the RLS/grant layer by
`supabase/tests/phase17_certificates_test.sql`.

**DoD:** A certificate can be issued (only when genuinely eligible),
downloaded by the student, revoked and reissued with full history preserved,
and verified publicly by number without exposing private data.

**Known limitations / explicitly out of scope this phase:** No certificate-
design customization UI (logo/colors/layout are fixed in
`lib/pdf/certificate.tsx`, deferred); no bulk/batch issuance (one Enrollment
at a time); no notifications on issuance (Phase 18); no Reports/analytics
beyond what this phase itself needed (Phase 19); no Razorpay/receipts work
(Phase 20/21); Receipt numbering's own year-reset question
(`DECISIONS_NEEDED.md` D7, receipt half) remains open for Phase 21.

## Phase 18 — Notifications

**Approved V1 re-scope (Phase 18 checkpoint decisions C1–C4).** Phase 18 is
delivered as **V1: in-app notifications only**. This is an explicit approved
scope decision, not an omission. The email and multi-channel work originally
listed here is moved, unchanged, to **Phase 18b — Email & Multi-Channel
Delivery (deferred)** below.

**V1 scope (delivered):**
- Admin/Super Admin sends a plain-text in-app notification (title + message)
  to ONE existing Student or Trainer, found by name/email search. The browser
  posts only a Student/Trainer profile reference; the server resolves the
  canonical `auth.users` id itself.
- Recipient (Student/Trainer) feed at `/student/notifications` and
  `/trainer/notifications`: newest first (most recent 50), unread/read
  status, mark one read, mark all read, exact unread count, unread badge on
  the portal's Notifications nav link. Read state persists.
- Admin/Super Admin "Recently sent" history at `/admin/notifications`,
  limited to notifications the caller sent (no global view).
- Audit: `notification.send` with recipient auth id and kind only (never the
  title or message). Mark-read is not audited.
- No automatic hooks into Phases 12–17 (enrollment, payments, attendance,
  materials, assignments, certificates are untouched).

**DB changes:** `20260101000034_notifications_v1_sender_and_immutability.sql`
(additive; migrations 9/14/16 not edited):
- `notifications.created_by_auth_user_id` (nullable, `auth.users`,
  `ON DELETE SET NULL`); the insert policy requires it to equal `auth.uid()`.
- Indexes: `(recipient_auth_user_id, created_at desc)`,
  `(created_by_auth_user_id, created_at desc)`.
- Checks: trimmed title 1–200 chars, body ≤ 2000, `status='read'` iff
  `read_at` is set.
- Policies (decision C3): own-received read for everyone; own-sent read for
  Admin/Super Admin; Admin read-all, update, and delete policies dropped.
  Insert only as Admin/Super Admin sending an unread `in_app`
  `admin_message` as themselves to an existing Student/Trainer account.
- Immutability (decision C4): recipient, sender, type, title, body, data,
  channel, created_at cannot change for any application role, Admin
  included; only `status`/`read_at` change, and only by the recipient. No
  application role can hard-delete a notification.

**Tests:** `supabase/tests/phase18_notifications_test.sql` (40 RLS
assertions, real `authenticated`/`anon` roles); Vitest domain/validation,
data, action, and component tests; browser acceptance
`e2e/phase18-notifications.spec.ts`:
1. "Admin sends an in-app notification to a Student through the UI"
2. "Student sees their notification, marks it read, and the read state persists"
3. "Other Students and Trainers cannot see or change someone else's notification"
4. "Mark all as read persists, and only the sending Admin sees the sent history"

**DoD (V1):** the four browser tests pass on Windows one at a time
(`--workers=1 --retries=0`), the RLS suite passes, migration 34 is verified
on the dev project, and the Phase18E2E cleanup audit is clean.

## Phase 18b — Email & Multi-Channel Delivery (deferred)

Deferred from Phase 18 by the approved V1 re-scope; requirements kept as
written: `EmailSender` abstraction + Resend adapter, React Email templates
for all events in `REQUIREMENTS.md` FR-110, `email_log` delivery wiring,
retrofitting Phase 20/21/17's send points, `NotificationDispatcher`
(scheduled/queued dispatch, retries/background delivery), WhatsApp delivery
(FR-112), notification preferences/consent/opt-out, and automatic
notification hooks from earlier phases. Original DoD carried over:
enrollment confirmation, payment receipt, and certificate-issued emails
actually arrive (verified against a real or sandbox provider account) with
correct company branding pulled from Settings.

## Phase 19 — Reports & Analytics

**Scope:** All report categories from `REQUIREMENTS.md` FR-120 (student,
enrollment, payment, attendance, trainer), server-side pagination, CSV export.

**DB changes:** Additional indexes/views only if a specific report's query plan
needs them (evaluate with `EXPLAIN` during implementation, not speculatively).

**DoD:** Each report renders from live data with working filters and a working
CSV export that never loads the full result set into browser memory.

**Phase 19 delivered (approved Phase 19 scope, read-only, no migration):**
- Admin/Super Admin Reports area: `/admin/reports` (summary cards — no chart
  library — plus links) and `/admin/reports/[report]` for six reports:
  **Student, Enrollment, Attendance, Financial** (FR-120's "Payment" report,
  per enrollment), **Certificate** and **Trainer**. The existing "Reports" Admin nav entry
  now opens the real page (was ComingSoon); the nav list itself is unchanged.
- Server-side filtering (validated search, status, program, batch, date range,
  attendance threshold, financial enrollment group), server-side pagination
  (25 rows), whitelisted sorting with a unique tie-breaker, visible row count,
  empty and error states. One filter parser and one row-to-cell mapping
  (`lib/domain/reports.ts`) serve both the page and the export.
- `GET /api/exports/[report]` CSV export (API_AND_INTEGRATIONS.md §7):
  independently authorized, same filters, streamed in 500-row batches,
  capped at **5,000 rows** (refused with 413 above the cap — never silently
  truncated; a mid-export failure or row-count change errors the download),
  RFC 4180 quoting, UTF-8 BOM, and spreadsheet formula-injection protection.
- Authoritative sources reused, no new formulas: attendance verbatim from the
  Phase 13 `student_attendance_summary` view (denominator = sessions marked;
  Present + Late attended; enrollments with no marked session have no row);
  money from the Phase 14 engine (`computeOutstandingFeesPaise` / `sumPaise`
  / `toPaise`, integer paise, `payments.status='paid'`,
  `payment_refunds.status='processed'`) composed exactly as
  `getEnrollmentFinancialSummary`; the Financial "Confirmed" group is the
  dashboard's own `CONFIRMED_ENROLLMENT_STATUSES`. Certificates keep issued and
  revoked distinct and never expose `pdf_path` or signed URLs.
- No database migration. No index was added: the dev project holds ~11 rows
  per table, too few for a meaningful `EXPLAIN`, and every report filter
  already maps to an existing FK/status index; re-evaluate with `EXPLAIN` once
  real volumes exist. Export is not audit-logged — no project document calls
  for it.
- **Trainer report (FR-120, Admin-facing)** at `/admin/reports/trainers` and
  `GET /api/exports/trainers`, on the same registry, parser, row-to-cell
  mapping, pagination and export pipeline as the other reports. One row per
  trainer with only the fields Admin Trainer Management already shows: first
  name, last name, email, phone, status, specialization, date added (Asia/
  Kolkata date of `created_at`) and the number of assigned batches (counted
  from `batch_trainers` per page — never joined into the paged query, so a
  trainer is never duplicated). No trainer code exists in the schema, so none
  is shown; `auth_user_id`, `bio` and any auth/token data are never selected.
  Filters: search (first/last name, email, phone) and status. Sorts: name
  (default, ascending), date added, status — each with an `id` tie-breaker.
  No program/batch/date filter (no stated need; avoids a many-to-many path).
- FR-120 is fully accounted for. Trainer-role reporting is unchanged:
  Trainers keep their existing scoped Trainer-portal views (own
  batches/students, attendance) and have no access to the Admin Reports area,
  the Trainer report or any export.
- Unrelated technical debt noted (not changed in Phase 19): the Phase 18
  notification recipient search (`sanitizeRecipientSearch`) strips Unicode
  combining marks, so e.g. Devanagari vowel signs are dropped from a search
  term. The Phase 19 report search does not have this flaw.

## Phase 20A — Offline Payments Ledger

**Status:** ACTIVE IMPLEMENTATION — branch
`claude/phase20-offline-payments-ledger`, based off `main` at `d561e8d`.

**Scope (REQUIREMENTS.md FR-90 offline/admin-recorded, FR-91, BR-6):** an
Admin/Super Admin records an offline payment (cash, UPI, bank transfer,
cheque) against the correct Enrollment, and reviews every recorded payment
in an operational ledger. Not a report, not Razorpay, not receipts/refunds.

**Business rules confirmed at the Phase 20A checkpoint** (the requirements
were silent; nothing here was inferred):
- Overpayment is **blocked**: an amount above the enrollment's current
  outstanding balance (Phase 14 formula) is rejected. Partial payments are
  allowed (FR-90 lists "partial").
- Payments are **enrollment-level only**: `installment_id` is never set and
  the `installment` payment type is not offered — no rule yet defines how a
  payment updates `installments.amount_paid_cache`. Offered types:
  partial, full, registration, other (labels only; no amount rule attached).
- Only a **confirmed** enrollment (enrolled / active / on_hold / completed —
  the Phase 14 `CONFIRMED_ENROLLMENT_STATUSES`) can receive a payment.
- The Admin enters the **date received** (today or earlier, Asia/Kolkata);
  it is stored in `payments.paid_at` (start of that IST day), while
  `created_at` records when it was entered.
- Offline methods are BR-6's four only; `razorpay` (Phase 20B) and `other`
  are not offered. Tax is 0 on the payment row (`total_amount = amount`):
  the enrollment's `total_payable` already carries its tax and GST stays
  disabled (D2).

**Delivered:**
- `/admin/payments` replaces the ComingSoon page: server-paginated ledger
  (25/page, newest payment date first, `id` tie-breaker), search by payment
  code, reference, student (code/name) or enrollment code, filters for
  method, status and payment-date range (IST days), exact INR-with-paise
  display. No edit or delete control anywhere.
- `/admin/payments/new`: find the enrollment by exact code (deep-linkable
  `?enrollment=`; the Enrollment page links here), review Student, Student
  ID, Program, Batch, Enrollment code/status and the Phase 14 payable / paid
  / refunded / outstanding figures (from `getEnrollmentFinancialSummary`,
  shown to the paisa), then record amount, method, type, date received,
  reference and notes. Ineligible or fully-paid enrollments get a message
  instead of the form.
- `/admin/payments/[id]`: read-only payment page (landing page after a
  successful recording, with a persistent "recorded" status line).
- Enrollment page Financial Position card: "Record offline payment" (when
  eligible and outstanding > 0) and "View payments" links. The card itself
  and its whole-rupee display are unchanged.
- Audit: one `payment.recorded_offline` entry per created payment via the
  existing `writeAuditLog` (minimal metadata: payment code, enrollment id,
  amount, method, type, date received — no notes/reference text).

**DB changes — migration `20260101000035_offline_payments_ledger.sql`
(required; read-only review of dev found these gaps):**
- `payments.payment_code` DEFAULT `'PAY-' || lpad(nextval('payment_id_seq'), 6, '0')`
  (DATABASE_SCHEMA.md §3 format; same schema-completion pattern as
  student_code/enrollment_code). The sequence is not reset.
- FR-91 enforcement: `payments_update_admin`, `payments_delete_admin` and
  `payments_write_admin` policies dropped (no end-user INSERT/UPDATE/DELETE
  path on `payments`); trigger `payments_prevent_settled_change` freezes a
  payment once its status is paid / refunded / partially_refunded, for every
  role including service_role. Pending/authorized rows (Phase 20B) stay
  updatable server-side by service_role only.
- BR-5 integrity trigger `payments_enforce_enrollment_integrity`: a
  payment's `student_id` must be its enrollment's student and any
  `installment_id` must belong to that enrollment's plan.
- `record_offline_payment(...)` — SECURITY DEFINER, pinned search_path,
  EXECUTE for `authenticated` only; self-checks Admin/Super Admin and an
  admins profile, validates input, locks the enrollment row (`FOR UPDATE`),
  requires a confirmed status, blocks overpayment with the Phase 14 formula
  (`max(0, payable − paid + processed refunds)`), derives `student_id` and
  `created_by` server-side, stores `status='paid'`, and is idempotent on the
  form's server-minted payment id (a double submit returns the same payment).

**Known limitations / deferred:** no installment allocation; no
correction/void workflow (a mistake is corrected in Phase 21 via a refund or
by a later explicitly-designed offsetting entry); no receipt, PDF or email
(Phase 21 / 18b); the Enrollment page's Financial Position keeps its
existing whole-rupee display (the payment pages and reports show paise);
"Recorded by" shows the recorder's name only where RLS lets the viewer read
that admins row (an Admin sees their own; a Super Admin sees all); the
`enrollments.amount_paid_cache`/`outstanding_balance_cache` columns remain
unmaintained (balances are always computed live, as since Phase 9/14).

**Razorpay is deferred to Phase 20B.** Nothing Razorpay-specific was added.

## Phase 20B — Razorpay Integration

**Scope:** Order creation route/action, Checkout client integration, signature
verification, webhook route with idempotent processing, balance recompute on
confirmed payment — full flow per `API_AND_INTEGRATIONS.md` §2.

**DB changes:** None beyond Phase 2 (`payments` already modeled). Phase 20A
made the first application writes into it and added migration 35 (payment
code default, FR-91 immutability, BR-5 integrity, `record_offline_payment`);
the webhook writes through service_role and must respect those triggers.

**Security implications:** Highest-scrutiny phase alongside Phase 3 — server-
authoritative amount, signature verification, idempotency all land here. No "Pay"
button ships before this phase is complete and tested (REQ-DEMO compliance — no
fake Pay button in Phase 10/14 UI; those phases show plan/schedule only until
Phase 20 wires the real action).

**Tests:** Valid/invalid/tampered signature cases; duplicate webhook delivery
produces exactly one payment row and one balance update; amount mismatch is held
for review rather than silently accepted; concurrent payments against different
installments of the same enrollment don't race incorrectly.

**DoD:** A test-mode Razorpay payment completes end-to-end and the enrollment's
outstanding balance updates correctly and only for that enrollment.

(Phase 15 note: Razorpay integration was deliberately deferred past Materials/
Assignments/Certificates/Notifications/Reports in the revised Phase 15–21
roadmap ordering — a Phase 15–21 planning decision, not a change to this
phase's own scope, security implications, or DoD above.)

## Phase 21 — Receipts, Refunds & Payment Documents

**Scope:** Receipt number sequence usage (already defined in Phase 2), PDF
generation (`@react-pdf/renderer`) triggered on confirmed payment (online or
offline), storage in the `receipts` bucket, download in both Admin and Student
portals, email-on-payment (requires the email infra now deferred to Phase 18b —
if sequenced before Phase 18b, the email send is stubbed/queued and clearly logged
as pending rather than silently dropped; recommend pulling minimal email sending
forward into this phase if it doesn't complicate Phase 18b's fuller scope). Refunds and other
payment documents beyond the receipt itself (tracked in FR-90 as P1/P2
execution) are folded into this phase's own name per the revised roadmap, but
remain undesigned until this phase's own requirements/discovery pass — not
expanded here speculatively.

**DB changes:** None beyond Phase 2 (`receipts`).

**Security implications:** Concurrency-safe numbering verified under parallel
payment confirmations (unit/integration test with simulated concurrent
transactions).

**DoD:** Every successful payment (online, or offline from Phase 20A's
recording workflow) produces a real, downloadable, correctly numbered PDF receipt — no
"Download Receipt" button appears before this phase ships.

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
