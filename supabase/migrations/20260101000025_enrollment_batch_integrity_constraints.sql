-- Phase 9 manual-acceptance correction: two database-level integrity rules
-- approved after a read-only assessment found live dev rows violating both
-- (since cleaned up separately, outside this migration — see the Phase 9
-- report; this migration contains no data changes, only schema).
--
-- Rule 1: an Enrollment may not hold an operational/student-active status
-- (enrolled, active, on_hold, completed) without a Batch. Lead/Applicant
-- remain Batch-optional; Withdrawn/Cancelled are historical/terminal and
-- are not touched by this constraint (it only fires when status IS one of
-- the four operational values). This backs up the existing application-
-- layer check in lib/data/enrollments.ts's updateEnrollmentStatus with a
-- DB-level guarantee that also covers direct DB/API writes.

alter table public.enrollments
  add constraint enrollments_operational_status_requires_batch
  check (
    status not in ('enrolled', 'active', 'on_hold', 'completed')
    or batch_id is not null
  );

-- Rule 2: a Student may have at most one Enrollment for a given non-null
-- Batch, regardless of that Enrollment's status — a cancelled or withdrawn
-- Enrollment does not free up the Batch for a new one (that would be a
-- reinstatement workflow, explicitly out of scope here). Different Batches
-- for the same Student, and the same Batch for different Students, remain
-- unrestricted. Batch-less (lead/applicant) rows are outside this rule —
-- the partial WHERE clause excludes them. This backs up the existing
-- application-layer duplicate check in lib/data/enrollments.ts's
-- createEnrollmentRecord with a concurrency-safe DB guarantee.

create unique index enrollments_one_per_student_batch
  on public.enrollments (student_id, batch_id)
  where batch_id is not null;
