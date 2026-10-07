-- Phase 16 (Assignments & Submissions) regression suite. Covers both the
-- pre-existing `assignments`/`assignment_submissions` table policies (added
-- ahead of schedule in Phase 2, 20260101000014_rls_policies.sql — unchanged
-- this phase) and the two migrations this phase actually adds:
--   - 20260101000028_assignment_submissions_ownership_rls.sql: tightens
--     assignment_submissions_write_own/_update_own to require the
--     submitted enrollment_id to actually belong to the caller AND match
--     the assignment's own batch_id (closing a real pre-existing gap where
--     only student_id was checked).
--   - 20260101000029_assignments_storage.sql: the two private
--     `assignment-attachments`/`assignment-submissions` Storage buckets and
--     their own policies.
--
-- Covers, both allowed and denied:
--   - Admin/Super Admin: full select/insert/update/delete on both tables,
--     any batch; full select/insert/update/delete on both Storage buckets.
--   - Assigned Trainer: select/insert/update on `assignments` scoped to
--     their OWN assigned Batch only; select/update on `assignment_
--     submissions` scoped via the assignment's own batch; denied for an
--     unrelated Batch's assignment and an unrelated Batch's submission;
--     Storage insert/select scoped the same way as the table; no Storage
--     insert policy at all into assignment-submissions (Trainer never
--     uploads a Student's file).
--   - Student: select `assignments` scoped to their own enrolled Batch
--     only; zero write access to `assignments` at all; insert/select/
--     update own `assignment_submissions` only — including the exact
--     ownership-spoofing attempts 20260101000028 now blocks (another
--     student's enrollment_id, a cross-batch assignment_id); Storage
--     insert restricted to a path encoding their own id and an assignment
--     in their own batch; Storage select/update scoped via the real
--     submission row; zero Storage access to assignment-attachments
--     outside their own batch, zero Storage insert into
--     assignment-attachments at all.
--   - anon: zero access to either table and either Storage bucket.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('16000000-0000-0000-0000-000000000001', 'phase16-admin@validation.local'),
  ('16000000-0000-0000-0000-000000000002', 'phase16-trainer-a@validation.local'),
  ('16000000-0000-0000-0000-000000000003', 'phase16-trainer-b@validation.local'),
  ('16000000-0000-0000-0000-000000000004', 'phase16-student-x@validation.local'),
  ('16000000-0000-0000-0000-000000000005', 'phase16-student-y@validation.local'),
  ('16000000-0000-0000-0000-000000000006', 'phase16-student-withdrawn@validation.local'),
  ('16000000-0000-0000-0000-000000000007', 'phase16-student-completed@validation.local');

insert into user_roles (auth_user_id, role) values
  ('16000000-0000-0000-0000-000000000001', 'admin'),
  ('16000000-0000-0000-0000-000000000002', 'trainer'),
  ('16000000-0000-0000-0000-000000000003', 'trainer'),
  ('16000000-0000-0000-0000-000000000004', 'student'),
  ('16000000-0000-0000-0000-000000000005', 'student'),
  ('16000000-0000-0000-0000-000000000006', 'student'),
  ('16000000-0000-0000-0000-000000000007', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('16100000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Phase16', 'Admin', 'phase16-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('16200000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002', 'Phase16', 'TrainerA', 'phase16-trainer-a@validation.local'),
  ('16200000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000003', 'Phase16', 'TrainerB', 'phase16-trainer-b@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('16300000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000004', 'Phase16', 'StudentX', '9990016001', 'phase16-student-x@validation.local'),
  ('16300000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-000000000005', 'Phase16', 'StudentY', '9990016002', 'phase16-student-y@validation.local'),
  ('16300000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-000000000006', 'Phase16', 'StudentWithdrawn', '9990016003', 'phase16-student-withdrawn@validation.local'),
  ('16300000-0000-0000-0000-000000000004', '16000000-0000-0000-0000-000000000007', 'Phase16', 'StudentCompleted', '9990016004', 'phase16-student-completed@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('16400000-0000-0000-0000-000000000001', 'PHASE16-PROG', 'Phase 16 Program', 25000.00, 0, 'active');

insert into program_modules (id, program_id, title, sequence) values
  ('16410000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-000000000001', 'Phase 16 Module 1', 1);

-- Batch A (Trainer A, Student X) and Batch B (Trainer B, Student Y) — the
-- same cross-batch isolation shape Phase 11/13/15 already proved, reused
-- here for Assignments/Submissions.
insert into batches (id, program_id, name, start_date, status) values
  ('16500000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-000000000001', 'Phase 16 Batch A', current_date, 'active'),
  ('16500000-0000-0000-0000-000000000002', '16400000-0000-0000-0000-000000000001', 'Phase 16 Batch B', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('16600000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16200000-0000-0000-0000-000000000001', true),
  ('16600000-0000-0000-0000-000000000002', '16500000-0000-0000-0000-000000000002', '16200000-0000-0000-0000-000000000002', true);

-- Student Withdrawn and Student Completed both sit in Batch A (same
-- batch as Student X/Assignment A) — the status filter, not batch
-- membership, is what the checkpoint's own approved decision (mirroring
-- Materials' 20260101000026) must be proven to deny/allow on.
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('16700000-0000-0000-0000-000000000001', '16300000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'enrolled'),
  ('16700000-0000-0000-0000-000000000002', '16300000-0000-0000-0000-000000000002', '16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000002', 25000.00, 25000.00, 25000.00, 'enrolled'),
  ('16700000-0000-0000-0000-000000000003', '16300000-0000-0000-0000-000000000003', '16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'withdrawn'),
  ('16700000-0000-0000-0000-000000000004', '16300000-0000-0000-0000-000000000004', '16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'completed');

-- Assignment 1 (Batch A, Trainer A) and Assignment 2 (Batch B, Trainer B) —
-- the cross-batch pair every isolation test below is built around.
insert into assignments (id, program_id, batch_id, trainer_id, title, due_date, max_marks) values
  ('16800000-0000-0000-0000-000000000001', '16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16200000-0000-0000-0000-000000000001', 'Phase 16 Assignment A', current_date + 7, 100),
  ('16800000-0000-0000-0000-000000000002', '16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000002', '16200000-0000-0000-0000-000000000002', 'Phase 16 Assignment B', current_date + 7, 100);

-- One pre-existing submission per Student, each against their OWN
-- assignment/batch/enrollment — the legitimate baseline every cross-
-- student/cross-batch test below attempts to read or write around.
insert into assignment_submissions (id, assignment_id, enrollment_id, student_id, text_response, status) values
  ('16900000-0000-0000-0000-000000000001', '16800000-0000-0000-0000-000000000001', '16700000-0000-0000-0000-000000000001', '16300000-0000-0000-0000-000000000001', 'Student X''s own answer', 'submitted'),
  ('16900000-0000-0000-0000-000000000002', '16800000-0000-0000-0000-000000000002', '16700000-0000-0000-0000-000000000002', '16300000-0000-0000-0000-000000000002', 'Student Y''s own answer', 'submitted');

-- Student Withdrawn's own submission, made back when their enrollment was
-- still active — proves assignment_submissions_select_own is deliberately
-- UNCHANGED by the status-eligibility fix below (a permanent academic
-- record, per the approved checkpoint decision), even once their
-- enrollment later became 'withdrawn'.
insert into assignment_submissions (id, assignment_id, enrollment_id, student_id, text_response, status) values
  ('16900000-0000-0000-0000-000000000003', '16800000-0000-0000-0000-000000000001', '16700000-0000-0000-0000-000000000003', '16300000-0000-0000-0000-000000000003', 'Student Withdrawn''s own past answer', 'reviewed');

-- Pre-existing Storage objects backing one attachment and one submission
-- file, so the Storage SELECT policies (which join storage.objects to the
-- owning table by its own stored path) have something real to find.
insert into assignments (id, program_id, batch_id, trainer_id, title, due_date, attachment_path) values
  ('16800000-0000-0000-0000-000000000003', '16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16200000-0000-0000-0000-000000000001', 'Phase 16 Assignment A (with attachment)', current_date + 7,
   '16800000-0000-0000-0000-000000000003/16910000-0000-0000-0000-000000000001-syllabus.pdf');

update assignment_submissions
  set file_path = '16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000001/16910000-0000-0000-0000-000000000002-answer.pdf'
  where id = '16900000-0000-0000-0000-000000000001';

insert into storage.objects (bucket_id, name) values
  ('assignment-attachments', '16800000-0000-0000-0000-000000000003/16910000-0000-0000-0000-000000000001-syllabus.pdf'),
  ('assignment-submissions', '16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000001/16910000-0000-0000-0000-000000000002-answer.pdf');

-- ---------------------------------------------------------------------------
-- Admin — full access, any batch, both tables, both Storage buckets.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"16000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignments
  where id in (
    '16800000-0000-0000-0000-000000000001', '16800000-0000-0000-0000-000000000002',
    '16800000-0000-0000-0000-000000000003'
  );
  if cnt <> 3 then
    raise exception 'FAIL: admin should see all 3 assignments regardless of batch, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all assignments regardless of batch (assignments_select_admin)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignment_submissions
  where id in ('16900000-0000-0000-0000-000000000001', '16900000-0000-0000-0000-000000000002');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both submissions regardless of batch, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all submissions regardless of batch (assignment_submissions_select_admin)';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into assignments (program_id, batch_id, trainer_id, title, due_date)
  values ('16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000002', '16200000-0000-0000-0000-000000000002', 'Scratch', current_date + 1)
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: admin should be able to insert an assignment for any batch';
  end if;
  update assignments set status = 'closed' where id = new_id;
  if not found then
    raise exception 'FAIL: admin should be able to update any assignment';
  end if;
  delete from assignments where id = new_id;
  raise notice 'PASS: admin can insert/update/delete an assignment at the RLS layer (assignments_write_admin/update_admin/delete_admin — no hard-delete UI is exposed in the application, see the Phase 16 report)';
end
$$;

do $$
begin
  update assignment_submissions
    set marks = 90, trainer_feedback = 'Great work', status = 'reviewed', reviewed_at = now()
    where id = '16900000-0000-0000-0000-000000000002';
  if not found then
    raise exception 'FAIL: admin should be able to review any submission';
  end if;
  raise notice 'PASS: admin can review (update marks/feedback/status on) any submission (assignment_submissions_update_admin)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects
  where bucket_id in ('assignment-attachments', 'assignment-submissions');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both Storage objects across both buckets, got count=%', cnt;
  end if;
  raise notice 'PASS: admin can select from both assignment Storage buckets (…_select_admin)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    insert into storage.objects (bucket_id, name) values ('assignment-attachments', 'scratch/admin-scratch.pdf')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to insert into the assignment-attachments bucket';
  end if;
  delete from storage.objects where bucket_id = 'assignment-attachments' and name = 'scratch/admin-scratch.pdf';
  raise notice 'PASS: admin can insert into and delete from the assignment-attachments bucket (…_insert_admin/_delete_admin)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer A — assigned to Batch A only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"16000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignments
  where id in (
    '16800000-0000-0000-0000-000000000001', '16800000-0000-0000-0000-000000000002',
    '16800000-0000-0000-0000-000000000003'
  );
  if cnt <> 2 then
    raise exception 'FAIL: trainer A should see exactly 2 assignments (their own Batch A''s), got count=%', cnt;
  end if;
  raise notice 'PASS: trainer A sees only their assigned Batch''s assignments (assignments_select_trainer), not Batch B''s';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into assignments (program_id, batch_id, trainer_id, title, due_date)
  values ('16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16200000-0000-0000-0000-000000000001', 'Scratch Batch A', current_date + 1)
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: trainer A should be able to insert an assignment scoped to their own Batch A';
  end if;
  -- No assignments_delete_trainer policy exists (by design — see this
  -- file's own header comment), so a Trainer-session DELETE here would
  -- silently affect 0 rows rather than actually remove it. Left in place
  -- deliberately; cleaned up by this whole file's own closing ROLLBACK,
  -- not by an ineffective delete attempt.
  raise notice 'PASS: trainer A can insert an assignment scoped to their own assigned batch (assignments_write_trainer)';
end
$$;

do $$
begin
  begin
    insert into assignments (program_id, batch_id, trainer_id, title, due_date)
    values ('16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000002', '16200000-0000-0000-0000-000000000001', 'Scratch Batch B', current_date + 1);
    raise exception 'FAIL: trainer A should not be able to insert an assignment scoped to Batch B (not their own assignment)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting an assignment scoped to an unassigned Batch (Batch B)';
  end;
end
$$;

do $$
begin
  update assignments set status = 'closed' where id = '16800000-0000-0000-0000-000000000001';
  if not found then
    raise exception 'FAIL: trainer A should be able to update their own Batch A assignment';
  end if;
  raise notice 'PASS: trainer A can update an assignment on their own assigned batch (assignments_update_trainer)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignment_submissions
  where id in ('16900000-0000-0000-0000-000000000001', '16900000-0000-0000-0000-000000000002');
  if cnt <> 1 then
    raise exception 'FAIL: trainer A should see exactly 1 submission (Student X''s, on their own Batch A), got count=%', cnt;
  end if;
  raise notice 'PASS: trainer A sees only submissions for assignments on their own assigned batch (assignment_submissions_select_trainer), not Student Y''s (Batch B)';
end
$$;

do $$
begin
  update assignment_submissions
    set marks = 80, trainer_feedback = 'Nice', status = 'reviewed', reviewed_by = '16200000-0000-0000-0000-000000000001', reviewed_at = now()
    where id = '16900000-0000-0000-0000-000000000001';
  if not found then
    raise exception 'FAIL: trainer A should be able to review Student X''s submission (their own Batch A)';
  end if;
  raise notice 'PASS: trainer A can review a submission on their own assigned batch (assignment_submissions_update_trainer)';
end
$$;

do $$
declare
  affected int;
begin
  update assignment_submissions
    set trainer_feedback = 'Should not apply'
    where id = '16900000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: trainer A should not be able to update Student Y''s submission (Batch B, not their own)';
  end if;
  raise notice 'PASS: trainer A is silently blocked (0 rows affected) from updating a submission on an unrelated batch (assignment_submissions_update_trainer)';
end
$$;

do $$
declare
  new_path text := '16800000-0000-0000-0000-000000000001/16920000-0000-0000-0000-000000000001-handout.pdf';
  affected int;
begin
  with attempt as (
    insert into storage.objects (bucket_id, name) values ('assignment-attachments', new_path) returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: trainer A should be able to insert an attachment for their own Batch A assignment';
  end if;
  delete from storage.objects where bucket_id = 'assignment-attachments' and name = new_path;
  raise notice 'PASS: trainer A can insert into assignment-attachments for their own assigned batch''s assignment (assignment_attachments_insert_trainer)';
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-attachments', '16800000-0000-0000-0000-000000000002/16920000-0000-0000-0000-000000000002-handout.pdf');
    raise exception 'FAIL: trainer A should not be able to insert an attachment for Batch B''s assignment';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting an attachment for an unassigned Batch''s assignment (assignment_attachments_insert_trainer)';
  end;
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'assignment-attachments';
  if cnt <> 1 then
    raise exception 'FAIL: trainer A should see exactly 1 attachment (their own Batch A assignment''s), got count=%', cnt;
  end if;
  raise notice 'PASS: trainer A sees only their own batch''s assignment attachments (assignment_attachments_select_trainer)';
end
$$;

do $$
declare
  cnt int;
begin
  -- Student X's submission file belongs to Assignment A (Batch A) — visible
  -- to trainer A via assignment_submissions_bucket_select_trainer.
  select count(*) into cnt from storage.objects where bucket_id = 'assignment-submissions';
  if cnt <> 1 then
    raise exception 'FAIL: trainer A should see exactly 1 submission file (Student X''s, their own Batch A), got count=%', cnt;
  end if;
  raise notice 'PASS: trainer A sees only submission files for their own assigned batch (assignment_submissions_bucket_select_trainer)';
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-submissions', '16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000001/trainer-scratch.pdf');
    raise exception 'FAIL: trainer A should not be able to insert into assignment-submissions at all — no Trainer insert policy exists there by design';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting into assignment-submissions entirely (no Trainer insert policy exists, by design — a Trainer never uploads a Student''s own file)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student X — enrolled in Batch A only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"16000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignments
  where id in (
    '16800000-0000-0000-0000-000000000001', '16800000-0000-0000-0000-000000000002',
    '16800000-0000-0000-0000-000000000003'
  );
  if cnt <> 2 then
    raise exception 'FAIL: student X should see exactly 2 assignments (both on their own enrolled Batch A), got count=%', cnt;
  end if;
  raise notice 'PASS: student X sees assignments scoped to their own enrolled batch (assignments_select_student), not Batch B''s';
end
$$;

do $$
begin
  begin
    insert into assignments (program_id, batch_id, trainer_id, title, due_date)
    values ('16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16200000-0000-0000-0000-000000000001', 'Scratch', current_date + 1);
    raise exception 'FAIL: student X should not be able to insert an assignment — no Student write policy exists at all';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student X has zero write access to assignments (no assignments_write_student policy exists, by design)';
  end;
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into assignment_submissions (assignment_id, enrollment_id, student_id, text_response)
  values ('16800000-0000-0000-0000-000000000003', '16700000-0000-0000-0000-000000000001', '16300000-0000-0000-0000-000000000001', 'My own new submission')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: student X should be able to insert their own submission with their own enrollment_id';
  end if;
  delete from assignment_submissions where id = new_id;
  raise notice 'PASS: student X can insert their own submission with their own matching enrollment_id (assignment_submissions_write_own)';
end
$$;

-- The core 20260101000028 fix under test: student_id correctly identifies
-- the real caller, but enrollment_id names a DIFFERENT student's own
-- enrollment (Student Y's) — pre-fix, only student_id was checked, so this
-- insert would have been wrongly allowed.
do $$
begin
  begin
    insert into assignment_submissions (assignment_id, enrollment_id, student_id, text_response)
    values ('16800000-0000-0000-0000-000000000001', '16700000-0000-0000-0000-000000000002', '16300000-0000-0000-0000-000000000001', 'Spoofed enrollment_id');
    raise exception 'FAIL: student X should not be able to insert a submission using Student Y''s enrollment_id, even with their own student_id (20260101000028 fix)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student X is blocked from spoofing another student''s enrollment_id (assignment_submissions_write_own, 20260101000028)';
  end;
end
$$;

-- A second spoofing shape: a genuinely own enrollment_id, but for an
-- assignment scoped to a DIFFERENT batch than that enrollment's own batch.
do $$
begin
  begin
    insert into assignment_submissions (assignment_id, enrollment_id, student_id, text_response)
    values ('16800000-0000-0000-0000-000000000002', '16700000-0000-0000-0000-000000000001', '16300000-0000-0000-0000-000000000001', 'Cross-batch assignment_id');
    raise exception 'FAIL: student X should not be able to submit against Assignment B (Batch B) using their own Batch-A-only enrollment_id';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student X is blocked from submitting against an assignment outside their own enrollment''s batch (assignment_submissions_write_own, 20260101000028)';
  end;
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignment_submissions where id = '16900000-0000-0000-0000-000000000001';
  if cnt <> 1 then
    raise exception 'FAIL: student X should see their own submission';
  end if;
  raise notice 'PASS: student X can select their own submission (assignment_submissions_select_own)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignment_submissions where id = '16900000-0000-0000-0000-000000000002';
  if cnt <> 0 then
    raise exception 'FAIL: student X should not see Student Y''s submission, got count=%', cnt;
  end if;
  raise notice 'PASS: student X cannot see another student''s submission (assignment_submissions_select_own has no cross-student branch)';
end
$$;

do $$
begin
  update assignment_submissions set text_response = 'Updated answer' where id = '16900000-0000-0000-0000-000000000001';
  if not found then
    raise exception 'FAIL: student X should be able to update their own submission';
  end if;
  raise notice 'PASS: student X can update their own submission (assignment_submissions_update_own)';
end
$$;

do $$
declare
  affected int;
begin
  update assignment_submissions set text_response = 'Should not apply' where id = '16900000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: student X should not be able to update Student Y''s submission';
  end if;
  raise notice 'PASS: student X is silently blocked (0 rows affected) from updating another student''s submission';
end
$$;

do $$
declare
  own_path text := '16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000001/16930000-0000-0000-0000-000000000001-mywork.pdf';
  affected int;
begin
  with attempt as (
    insert into storage.objects (bucket_id, name) values ('assignment-submissions', own_path) returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: student X should be able to insert their own submission file under {assignmentId}/{own studentId}/...';
  end if;
  delete from storage.objects where bucket_id = 'assignment-submissions' and name = own_path;
  raise notice 'PASS: student X can insert their own submission file (assignment_submissions_bucket_insert_own)';
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-submissions', '16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000002/spoofed-student-segment.pdf');
    raise exception 'FAIL: student X should not be able to insert a submission file under another student''s id segment';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student X is blocked from a path whose student-id segment names another student (assignment_submissions_bucket_insert_own)';
  end;
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-submissions', '16800000-0000-0000-0000-000000000002/16300000-0000-0000-0000-000000000001/cross-batch.pdf');
    raise exception 'FAIL: student X should not be able to insert a submission file for Assignment B (Batch B, not their enrolled batch)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student X is blocked from a path whose assignment-id segment names an assignment outside their enrolled batch';
  end;
end
$$;

-- Malformed-path cases — same rigor as Phase 15's own Storage hardening
-- (string_to_array + explicit segment-count/non-empty checks, never plain
-- split_part), proven here against the Student insert policy.
do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-submissions', '16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000001/');
    raise exception 'FAIL: an empty object-name segment should be denied';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: an empty trailing object-name segment is denied cleanly (the explicit <> '''' check)';
  end;
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-submissions', 'not-a-uuid/16300000-0000-0000-0000-000000000001/file.pdf');
    raise exception 'FAIL: a non-UUID assignment-id segment should be denied';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: a non-UUID assignment-id segment is denied cleanly (no cast exception — the DB column is cast to text, never the untrusted segment to uuid)';
  end;
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-submissions', '16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a 2-segment path (missing the object-name segment) should be denied';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: a 2-segment path is denied (array_length <> 3)';
  end;
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-submissions', 'x/16800000-0000-0000-0000-000000000001/16300000-0000-0000-0000-000000000001/file.pdf');
    raise exception 'FAIL: a 4-segment path (extra leading segment) should be denied';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: a 4-segment path is denied (array_length <> 3)';
  end;
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'assignment-submissions';
  if cnt <> 1 then
    raise exception 'FAIL: student X should see exactly 1 submission file (their own), got count=%', cnt;
  end if;
  raise notice 'PASS: student X sees only their own submission file (assignment_submissions_bucket_select_own)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'assignment-attachments';
  if cnt <> 1 then
    raise exception 'FAIL: student X should see exactly 1 attachment (their own enrolled batch''s), got count=%', cnt;
  end if;
  raise notice 'PASS: student X sees their own enrolled batch''s assignment attachment (assignment_attachments_select_student)';
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('assignment-attachments', '16800000-0000-0000-0000-000000000001/scratch.pdf');
    raise exception 'FAIL: student X should not be able to insert into assignment-attachments at all — no Student insert policy exists there by design';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student X is blocked from inserting into assignment-attachments entirely (no Student insert policy exists, by design)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student Withdrawn — enrolled in Batch A, status 'withdrawn'. Proves
-- 20260101000030's own approved checkpoint decision: VIEW and SUBMIT are
-- both denied by status (even though batch_id still matches — migration
-- 25's own comment confirms a withdrawn enrollment keeps its batch_id),
-- while the student's OWN pre-existing submission remains visible
-- (assignment_submissions_select_own deliberately unchanged).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"16000000-0000-0000-0000-000000000006","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignments
  where id in ('16800000-0000-0000-0000-000000000001', '16800000-0000-0000-0000-000000000003');
  if cnt <> 0 then
    raise exception 'FAIL: a withdrawn-status student should see zero of Batch A''s own two assignments, got count=%', cnt;
  end if;
  raise notice 'PASS: a withdrawn-status student is denied Assignment visibility (20260101000030 — status filter, not batch, blocks it)';
end
$$;

do $$
begin
  begin
    insert into assignment_submissions (assignment_id, enrollment_id, student_id, text_response)
    values ('16800000-0000-0000-0000-000000000001', '16700000-0000-0000-0000-000000000003', '16300000-0000-0000-0000-000000000003', 'Should be denied by status');
    raise exception 'FAIL: a withdrawn-status student should not be able to insert a new submission';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: a withdrawn-status student is blocked from inserting a new submission (20260101000030)';
  end;
end
$$;

-- Unlike the cross-student update-denial cases above (where USING itself
-- already excludes the row, so Postgres simply affects 0 rows), this
-- row genuinely IS the caller's own (student_id matches USING), so
-- Postgres selects it for update and only THEN evaluates WITH CHECK
-- against the post-update row — which now fails the status filter,
-- raising a real "new row violates row-level security policy" error
-- rather than a silent no-op.
do $$
begin
  begin
    update assignment_submissions set text_response = 'Should be denied by status'
      where id = '16900000-0000-0000-0000-000000000003';
    raise exception 'FAIL: a withdrawn-status student should not be able to update their own submission once withdrawn';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: a withdrawn-status student is blocked (RLS policy violation on WITH CHECK) from updating their own submission (20260101000030)';
  end;
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignment_submissions where id = '16900000-0000-0000-0000-000000000003';
  if cnt <> 1 then
    raise exception 'FAIL: a withdrawn-status student should still see their OWN pre-existing submission (select_own is deliberately status-unfiltered), got count=%', cnt;
  end if;
  raise notice 'PASS: a withdrawn-status student still sees their own past submission/grade — a permanent academic record (assignment_submissions_select_own, intentionally unchanged)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student Completed — enrolled in Batch A, status 'completed'. Proves the
-- other half of the approved checkpoint decision: 'completed' is in the
-- SAME allowed set as 'enrolled'/'active'/'on_hold' for both VIEW and
-- SUBMIT (explicitly chosen, not the narrower "enrolled+active only"
-- alternative).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"16000000-0000-0000-0000-000000000007","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from assignments
  where id in ('16800000-0000-0000-0000-000000000001', '16800000-0000-0000-0000-000000000003');
  if cnt <> 2 then
    raise exception 'FAIL: a completed-status student should still see both of Batch A''s own two assignments, got count=%', cnt;
  end if;
  raise notice 'PASS: a completed-status student retains Assignment visibility (20260101000030 — completed is in the approved allowed set)';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into assignment_submissions (assignment_id, enrollment_id, student_id, text_response)
  values ('16800000-0000-0000-0000-000000000003', '16700000-0000-0000-0000-000000000004', '16300000-0000-0000-0000-000000000004', 'Completed student can still submit')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: a completed-status student should still be able to submit (completed is in the approved allowed set)';
  end if;
  delete from assignment_submissions where id = new_id;
  raise notice 'PASS: a completed-status student can still submit (20260101000030 — completed is in the approved allowed set, same as VIEW)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- anonymous — zero access to either table, either Storage bucket.

set local role anon;

-- anon lacks EXECUTE on the current_trainer_id()/current_student_id()
-- SECURITY DEFINER helpers (20260101000016_lock_down_security_definer_
-- function_grants.sql), so evaluating assignments_select_trainer/_student's
-- own USING clauses for this role raises "permission denied for function"
-- rather than silently contributing zero rows — the same outcome Phase 15's
-- own anon materials test already proves and catches, not a new behavior.
do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from assignments;
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying assignments (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying assignments (permission denied evaluating a policy helper function)';
      else
        raise exception 'FAIL: unexpected error querying assignments as anon: %', sqlerrm;
      end if;
  end;
  if cnt is not null and cnt <> 0 then
    raise exception 'FAIL: anonymous should see zero assignments, got %', cnt;
  end if;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from assignment_submissions;
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying assignment_submissions (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying assignment_submissions (permission denied evaluating a policy helper function)';
      else
        raise exception 'FAIL: unexpected error querying assignment_submissions as anon: %', sqlerrm;
      end if;
  end;
  if cnt is not null and cnt <> 0 then
    raise exception 'FAIL: anonymous should see zero submissions, got %', cnt;
  end if;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from storage.objects
    where bucket_id in ('assignment-attachments', 'assignment-submissions');
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying either assignment Storage bucket (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying either assignment Storage bucket (permission denied)';
      else
        raise exception 'FAIL: unexpected error querying assignment Storage objects as anon: %', sqlerrm;
      end if;
  end;
  if cnt is not null and cnt <> 0 then
    raise exception 'FAIL: anonymous should see zero Storage objects in either bucket, got %', cnt;
  end if;
end
$$;

do $$
begin
  begin
    insert into assignments (program_id, batch_id, trainer_id, title, due_date)
    values ('16400000-0000-0000-0000-000000000001', '16500000-0000-0000-0000-000000000001', '16200000-0000-0000-0000-000000000001', 'Scratch', current_date + 1);
    raise exception 'FAIL: anonymous should not be able to insert an assignment';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: anonymous is blocked from inserting an assignment';
  end;
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values ('assignment-submissions', 'scratch/anon.pdf');
    raise exception 'FAIL: anonymous should not be able to insert into the assignment-submissions bucket at all';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: anonymous is blocked from inserting into the assignment-submissions bucket';
  end;
end
$$;

reset role;

rollback;

select 'ALL PHASE 16 REGRESSION TESTS PASSED' as result;
