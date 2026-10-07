-- Phase 16 (Assignments & Submissions) pre-implementation security finding,
-- discovered during requirements-first discovery, not introduced by this
-- phase: assignment_submissions_write_own / assignment_submissions_update_own
-- (both added ahead of schedule in Phase 2, alongside the rest of the
-- assignments schema, 20260101000014_rls_policies.sql) only ever checked
--
--   student_id = current_student_id()
--
-- and never verified that the submitted `enrollment_id` (or `assignment_id`)
-- actually belongs to that same student, or to the same batch the
-- assignment itself is scoped to. Because `enrollment_id` only carries a
-- plain foreign-key constraint (it must reference *some* existing
-- `enrollments` row, not necessarily the caller's own), a Student session
-- could previously INSERT/UPDATE an `assignment_submissions` row that sets
-- `student_id` to themselves but `enrollment_id` to a DIFFERENT student's
-- enrollment (as long as that enrollment id exists and is a guessable/
-- enumerable uuid) — a real ownership-verification gap, exactly the class
-- of issue REQUIREMENTS-stage review for this phase was looking for
-- ("never trust browser-supplied student_id/enrollment_id/batch_id").
--
-- Narrowing-only, same discipline as 20260101000026's own materials fix:
-- this adds an additional `exists (...)` condition requiring the
-- `enrollment_id` to (a) actually belong to current_student_id() and (b) be
-- enrolled in the exact batch the target assignment is scoped to. It can
-- only reject rows a Student could previously (incorrectly) write; it
-- grants nothing new, and does not touch assignment_submissions_select_own/
-- _select_trainer/_select_admin or any Admin/Trainer policy at all.
--
-- This is a defense-in-depth DB-level backstop; the Phase 16 application
-- layer (lib/data/student-portal.ts) independently re-derives the caller's
-- own enrollment_id server-side for the target assignment's batch and never
-- accepts one from the client either way — this migration ensures the same
-- guarantee holds even for a direct PostgREST call that bypasses the
-- application layer entirely.

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
    )
  );
