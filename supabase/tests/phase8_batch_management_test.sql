-- Phase 8 (Batch Management) regression suite. No RLS/schema changes were
-- made in Phase 8 — this exercises the pre-existing `batches`/`batch_trainers`
-- RLS policies (supabase/migrations/20260101000014_rls_policies.sql)
-- end to end, the same way phase7_program_management_test.sql did for
-- `programs`. Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace
-- left regardless of pass/fail.

begin;

-- Fixture identities: one admin, four trainers (A assigned to the batch,
-- B never assigned — reserved for the isolation check below; C and D are
-- used only by the Primary-uniqueness bug-fix section so they never
-- interfere with B's "not assigned" assertion), one student (enrolled in
-- the batch), matching the pattern in rls_trainer_isolation_test.sql /
-- phase7_program_management_test.sql.
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'phase8-admin@validation.local'),
  ('d1000000-0000-0000-0000-000000000002', 'phase8-trainer-a@validation.local'),
  ('d1000000-0000-0000-0000-000000000003', 'phase8-trainer-b@validation.local'),
  ('d1000000-0000-0000-0000-000000000004', 'phase8-student@validation.local'),
  ('d1000000-0000-0000-0000-000000000005', 'phase8-trainer-c@validation.local'),
  ('d1000000-0000-0000-0000-000000000006', 'phase8-trainer-d@validation.local');

insert into user_roles (auth_user_id, role) values
  ('d1000000-0000-0000-0000-000000000001', 'admin'),
  ('d1000000-0000-0000-0000-000000000002', 'trainer'),
  ('d1000000-0000-0000-0000-000000000003', 'trainer'),
  ('d1000000-0000-0000-0000-000000000004', 'student'),
  ('d1000000-0000-0000-0000-000000000005', 'trainer'),
  ('d1000000-0000-0000-0000-000000000006', 'trainer');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Phase8', 'Admin', 'phase8-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('d3000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'Phase8', 'TrainerA', 'phase8-trainer-a@validation.local'),
  ('d3000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003', 'Phase8', 'TrainerB', 'phase8-trainer-b@validation.local'),
  ('d3000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000005', 'Phase8', 'TrainerC', 'phase8-trainer-c@validation.local'),
  ('d3000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000006', 'Phase8', 'TrainerD', 'phase8-trainer-d@validation.local');

insert into students (id, auth_user_id, student_code, first_name, last_name, phone) values
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000004', 'PHASE8-STU', 'Phase8', 'Student', '9990003001');

insert into programs (id, program_code, name, regular_fee, status) values
  ('d5000000-0000-0000-0000-000000000001', 'PHASE8-PROG', 'Phase 8 Test Program', 20000.00, 'active');

-- ---------------------------------------------------------------------------
-- Admin: can insert, select, and update batches, and manage batch_trainers
-- (batches_write_admin / batches_select_admin / batches_update_admin /
-- batch_trainers_write_admin / _select_admin / _update_admin / _delete_admin).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    insert into batches (id, program_id, name, start_date, status)
    values ('d6000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'Phase 8 Test Batch', current_date, 'active')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to insert a batch';
  end if;
  raise notice 'PASS: admin can insert a batch';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update batches set name = 'Phase 8 Test Batch (Renamed)' where id = 'd6000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update a batch';
  end if;
  raise notice 'PASS: admin can update a batch';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    insert into batch_trainers (batch_id, trainer_id, is_primary)
    values ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', true)
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to assign a trainer to a batch';
  end if;
  raise notice 'PASS: admin can assign a trainer to a batch (insert into batch_trainers)';
end
$$;

-- The same (batch_id, trainer_id) pair again must be rejected by the real
-- DB unique constraint — not just app-level logic.
do $$
begin
  begin
    insert into batch_trainers (batch_id, trainer_id)
    values ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: duplicate (batch_id, trainer_id) assignment was allowed';
  exception
    when unique_violation then
      raise notice 'PASS: duplicate trainer assignment is rejected by the DB unique constraint';
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update batch_trainers set is_primary = false
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and trainer_id = 'd3000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update a batch_trainers row';
  end if;
  raise notice 'PASS: admin can update a batch_trainers row';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    delete from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and trainer_id = 'd3000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to unassign a trainer (delete from batch_trainers)';
  end if;
  raise notice 'PASS: admin can unassign a trainer (delete from batch_trainers)';
end
$$;

-- Re-assign trainer A (admin, primary this time) to set up both the
-- Primary-uniqueness checks immediately below and the trainer-isolation
-- checks further down: only trainer A should ever see this batch.
insert into batch_trainers (batch_id, trainer_id, is_primary) values
  ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000001', true);

-- ---------------------------------------------------------------------------
-- Primary-Trainer uniqueness (bug-fix regression): a batch may have zero or
-- one Primary trainer, never more than one. Proven against the real table
-- and its real unique(batch_id, trainer_id) constraint, executing the exact
-- two-statement sequence assignTrainerToBatch uses (lib/data/batches.ts) —
-- insert the new assignment, then one atomic UPDATE demoting every other
-- trainer on the batch — rather than trusting a mock.

-- Trainer D assigned as non-primary must not disturb the existing Primary
-- (Trainer A).
insert into batch_trainers (batch_id, trainer_id, is_primary) values
  ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000004', false);

do $$
declare
  primary_cnt int;
  a_is_primary boolean;
begin
  select count(*) into primary_cnt from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and is_primary;
  select is_primary into a_is_primary from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and trainer_id = 'd3000000-0000-0000-0000-000000000001';
  if primary_cnt <> 1 or a_is_primary is not true then
    raise exception 'FAIL: assigning trainer D as non-primary should not disturb the existing Primary (trainer A), got primary_cnt=%, a_is_primary=%', primary_cnt, a_is_primary;
  end if;
  raise notice 'PASS: assigning a non-primary trainer does not disturb the existing Primary';
end
$$;

-- Assign trainer C as Primary — exactly the app's two-statement sequence —
-- and prove exactly one Primary remains afterward, with no assignment rows
-- lost (still 3 trainers assigned: A, C, D).
insert into batch_trainers (batch_id, trainer_id, is_primary) values
  ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000003', true);

update batch_trainers set is_primary = false
  where batch_id = 'd6000000-0000-0000-0000-000000000001' and trainer_id <> 'd3000000-0000-0000-0000-000000000003';

do $$
declare
  primary_cnt int;
  primary_trainer uuid;
  assigned_cnt int;
begin
  select count(*) into primary_cnt from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and is_primary;
  select trainer_id into primary_trainer from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and is_primary;
  select count(*) into assigned_cnt from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001';

  if primary_cnt <> 1 then
    raise exception 'FAIL: batch should have exactly one Primary trainer after replacement, got %', primary_cnt;
  end if;
  if primary_trainer <> 'd3000000-0000-0000-0000-000000000003' then
    raise exception 'FAIL: trainer C should be the sole Primary, got %', primary_trainer;
  end if;
  if assigned_cnt <> 3 then
    raise exception 'FAIL: replacing the Primary must not delete any assignment rows, expected 3 assigned trainers (A, C, D), got %', assigned_cnt;
  end if;
  raise notice 'PASS: assigning a second trainer as Primary demotes the first — exactly one Primary remains, no assignment rows lost';
end
$$;

-- Unassigning the Primary trainer must succeed and leave zero Primaries —
-- not block, and not force a replacement to be chosen.
delete from batch_trainers
  where batch_id = 'd6000000-0000-0000-0000-000000000001' and trainer_id = 'd3000000-0000-0000-0000-000000000003';

do $$
declare
  primary_cnt int;
  assigned_cnt int;
begin
  select count(*) into primary_cnt from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and is_primary;
  select count(*) into assigned_cnt from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001';
  if primary_cnt <> 0 then
    raise exception 'FAIL: unassigning the Primary trainer should leave zero Primaries, got %', primary_cnt;
  end if;
  if assigned_cnt <> 2 then
    raise exception 'FAIL: unassigning the Primary should only remove that one row, expected 2 remaining (A, D), got %', assigned_cnt;
  end if;
  raise notice 'PASS: unassigning the Primary trainer succeeds and leaves zero Primaries (a valid state)';
end
$$;

-- Clean up trainer D's assignment so later checks that count/inspect this
-- batch's assignments only ever see trainer A, as originally intended.
delete from batch_trainers
  where batch_id = 'd6000000-0000-0000-0000-000000000001' and trainer_id = 'd3000000-0000-0000-0000-000000000004';

insert into enrollments (id, enrollment_code, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable) values
  ('d7000000-0000-0000-0000-000000000001', 'PHASE8-ENR', 'd4000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 20000.00, 20000.00, 20000.00);

reset role;

-- ---------------------------------------------------------------------------
-- Trainer A (assigned to the batch): read-only, own scope only
-- (batches_select_trainer / batch_trainers_select_own), zero write access.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"d1000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from batches where id = 'd6000000-0000-0000-0000-000000000001';
  if cnt <> 1 then
    raise exception 'FAIL: trainer A (assigned) should see the batch via batches_select_trainer, got %', cnt;
  end if;
  raise notice 'PASS: trainer A sees their assigned batch (pre-existing batches_select_trainer policy)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from batch_trainers where trainer_id = 'd3000000-0000-0000-0000-000000000001';
  if cnt <> 1 then
    raise exception 'FAIL: trainer A should see their own batch_trainers row via batch_trainers_select_own, got %', cnt;
  end if;
  raise notice 'PASS: trainer A sees their own batch_trainers assignment row';
end
$$;

do $$
begin
  begin
    insert into batches (program_id, name, start_date)
    values ('d5000000-0000-0000-0000-000000000001', 'Trainer Should Not Create This', current_date);
    raise exception 'FAIL: trainer should not be able to insert a batch';
  exception
    when insufficient_privilege then
      raise notice 'PASS: trainer is blocked from inserting a batch';
    when others then
      if sqlerrm like '%row-level security%' or sqlerrm like '%new row violates%' then
        raise notice 'PASS: trainer is blocked from inserting a batch (RLS policy violation)';
      else
        raise exception 'FAIL: unexpected error inserting a batch as trainer: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update batches set name = 'Trainer Tried To Rename This' where id = 'd6000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer should not be able to update a batch, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer is blocked from updating a batch (0 rows affected)';
end
$$;

do $$
begin
  begin
    insert into batch_trainers (batch_id, trainer_id)
    values ('d6000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: trainer should not be able to assign another trainer to a batch';
  exception
    when insufficient_privilege then
      raise notice 'PASS: trainer is blocked from inserting into batch_trainers';
    when others then
      if sqlerrm like '%row-level security%' or sqlerrm like '%new row violates%' then
        raise notice 'PASS: trainer is blocked from inserting into batch_trainers (RLS policy violation)';
      else
        raise exception 'FAIL: unexpected error inserting into batch_trainers as trainer: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    delete from batch_trainers
    where batch_id = 'd6000000-0000-0000-0000-000000000001' and trainer_id = 'd3000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer should not be able to unassign themselves, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer is blocked from deleting a batch_trainers row (0 rows affected)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer B (NOT assigned to this batch): must not see it at all — proves
-- trainer isolation extends correctly to the new Phase 8 UI/data path, not
-- just the pre-existing trainer_visible_students()/trainer_visible_enrollments()
-- functions rls_trainer_isolation_test.sql already covers.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"d1000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from batches where id = 'd6000000-0000-0000-0000-000000000001';
  if cnt <> 0 then
    raise exception 'FAIL: trainer B (not assigned) should not see the batch, got %', cnt;
  end if;
  raise notice 'PASS: trainer B (not assigned to this batch) sees nothing — trainer isolation intact';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student (enrolled in the batch): read-only, own scope only
-- (batches_select_student), zero write access.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"d1000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from batches where id = 'd6000000-0000-0000-0000-000000000001';
  if cnt <> 1 then
    raise exception 'FAIL: enrolled student should see the batch via batches_select_student, got %', cnt;
  end if;
  raise notice 'PASS: student sees the batch they are enrolled in (pre-existing batches_select_student policy)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update batches set name = 'Student Tried To Rename This' where id = 'd6000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: student should not be able to update a batch, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student is blocked from updating a batch (0 rows affected)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from batch_trainers where batch_id = 'd6000000-0000-0000-0000-000000000001';
  if cnt <> 0 then
    raise exception 'FAIL: student should have zero access to batch_trainers, got %', cnt;
  end if;
  raise notice 'PASS: student has zero access to batch_trainers rows';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon: zero access to batches and batch_trainers.

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from batches;
  exception
    when insufficient_privilege then
      cnt := 0;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anon should have zero access to batches, got %', cnt;
  end if;
  raise notice 'PASS: anon has zero access to the batches table';
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from batch_trainers;
  exception
    when insufficient_privilege then
      cnt := 0;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anon should have zero access to batch_trainers, got %', cnt;
  end if;
  raise notice 'PASS: anon has zero access to the batch_trainers table';
end
$$;

reset role;

rollback;

select 'ALL PHASE 8 REGRESSION TESTS PASSED' as result;
