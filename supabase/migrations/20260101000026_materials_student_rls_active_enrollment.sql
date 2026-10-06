-- Phase 15 (Materials) pre-implementation security correction, approved
-- business decision (not an invented interpretation): FR-71 requires
-- Student Material access to be scoped to the student's "active
-- enrollment", but the pre-existing materials_select_student policy (added
-- ahead of schedule in Phase 2, alongside the rest of the materials schema)
-- granted access via ANY enrollment row matching the student, regardless of
-- status — including lead/applicant/withdrawn/cancelled.
--
-- Approved status set (matches this project's own existing "operational/
-- student-active" grouping — see 20260101000025's own comment — plus the
-- explicit decision that a completed enrollment retains access to its own
-- learning materials, which FR-71 itself did not resolve):
--   ALLOWED: enrolled, active, on_hold, completed
--   DENIED:  lead, applicant, withdrawn, cancelled
--
-- Narrowing-only: this adds an additional `and e.status in (...)` condition
-- to all four existing EXISTS branches (program/batch/module/session). It
-- can only remove rows a student could previously see; it grants nothing
-- new. No other policy, table, or Student Portal query is touched by this
-- migration — every other existing Student Portal feature (dashboard,
-- attendance, payment plan) remains intentionally status-unfiltered, as
-- confirmed before this change was authorized.

drop policy if exists materials_select_student on materials;

create policy materials_select_student on materials
  for select using (
    (program_id is not null and exists (
      select 1 from enrollments e
      where e.program_id = materials.program_id
        and e.student_id = current_student_id()
        and e.status in ('enrolled', 'active', 'on_hold', 'completed')
    ))
    or (batch_id is not null and exists (
      select 1 from enrollments e
      where e.batch_id = materials.batch_id
        and e.student_id = current_student_id()
        and e.status in ('enrolled', 'active', 'on_hold', 'completed')
    ))
    or (module_id is not null and exists (
      select 1 from program_modules pm
      join enrollments e on e.program_id = pm.program_id
      where pm.id = materials.module_id
        and e.student_id = current_student_id()
        and e.status in ('enrolled', 'active', 'on_hold', 'completed')
    ))
    or (class_session_id is not null and exists (
      select 1 from class_sessions cs
      join enrollments e on e.batch_id = cs.batch_id
      where cs.id = materials.class_session_id
        and e.student_id = current_student_id()
        and e.status in ('enrolled', 'active', 'on_hold', 'completed')
    ))
  );
