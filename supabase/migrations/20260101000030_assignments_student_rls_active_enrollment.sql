-- Phase 16 (Assignments & Submissions) business-rule checkpoint, approved
-- decision (not an inference): neither REQUIREMENTS.md (FR-80/81/82) nor
-- USER_ROLES_AND_PERMISSIONS.md's own permission matrix name an
-- enrollment-status set for Assignment visibility or submission ability —
-- a genuine primary-source gap, reported and resolved by explicit decision
-- rather than silently copied from Materials' own FR-71 rule.
--
-- Approved status set — identical to Materials' own
-- 20260101000026_materials_student_rls_active_enrollment.sql, by explicit
-- choice (not by default):
--   VIEW assignments:              ALLOWED enrolled/active/on_hold/completed
--                                  DENIED  lead/applicant/withdrawn/cancelled
--   SUBMIT/UPDATE (resubmit) own:  same set as VIEW (explicit choice: no
--                                  narrower submit-only set was requested)
--   VIEW OWN past submission:      UNCHANGED — assignment_submissions_
--                                  select_own stays status-unfiltered by
--                                  explicit decision (a student's own
--                                  historical submission + grade/feedback
--                                  is a permanent academic record, visible
--                                  regardless of what their enrollment
--                                  status later becomes).
--
-- Narrowing-only: this adds an `and e.status in (...)` condition to
-- assignments_select_student's existing EXISTS branch, and the identical
-- condition to the already-present enrollments join in
-- assignment_submissions_write_own/_update_own
-- (20260101000028_assignment_submissions_ownership_rls.sql's own ownership
-- fix). It can only reject rows a Student could previously see/write; it
-- grants nothing new. assignment_submissions_select_own,
-- assignment_submissions_select_trainer/_admin, and every Admin/Trainer
-- policy on either table are untouched.

drop policy if exists assignments_select_student on assignments;

create policy assignments_select_student on assignments
  for select using (
    exists (
      select 1 from enrollments e
      where e.batch_id = assignments.batch_id
        and e.student_id = current_student_id()
        and e.status in ('enrolled', 'active', 'on_hold', 'completed')
    )
  );

drop policy if exists assignment_submissions_write_own on assignment_submissions;

create policy assignment_submissions_write_own on assignment_submissions
  for insert with check (
    student_id = current_student_id()
    and exists (
      select 1
      from assignments a
      join enrollments e on e.id = assignment_submissions.enrollment_id
      where a.id = assignment_submissions.assignment_id
        and e.batch_id = a.batch_id
        and e.student_id = current_student_id()
        and e.status in ('enrolled', 'active', 'on_hold', 'completed')
    )
  );

drop policy if exists assignment_submissions_update_own on assignment_submissions;

create policy assignment_submissions_update_own on assignment_submissions
  for update using (student_id = current_student_id())
  with check (
    student_id = current_student_id()
    and exists (
      select 1
      from assignments a
      join enrollments e on e.id = assignment_submissions.enrollment_id
      where a.id = assignment_submissions.assignment_id
        and e.batch_id = a.batch_id
        and e.student_id = current_student_id()
        and e.status in ('enrolled', 'active', 'on_hold', 'completed')
    )
  );
