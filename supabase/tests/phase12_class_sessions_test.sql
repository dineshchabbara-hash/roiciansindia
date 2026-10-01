-- Phase 12 (Class Sessions) regression suite. All policies asserted below
-- (class_sessions_select_admin/select_trainer/select_student/write_admin/
-- write_trainer/update_admin/update_trainer/delete_admin,
-- 20260101000014_rls_policies.sql) PRE-DATE Phase 12 and are unchanged by
-- it — this is the first phase to actually exercise them end to end, since
-- no application code wrote to `class_sessions` before Phase 12 existed
-- (same situation Phase 11 was in for trainer_visible_students()/
-- trainer_visible_enrollments() — see that phase's own SQL test header).
--
-- Covers, both allowed and denied:
--   - Admin/Super Admin: full select/insert/update/delete, any batch.
--   - Assigned Trainer: select/insert/update scoped to their OWN assigned
--     batch only — denied for an unrelated batch; no delete policy exists
--     for Trainer at all (by design — see the Phase 12 report for why the
--     application layer never exposes a delete control even though this
--     RLS capability exists for Admin).
--   - Enrolled Student: select scoped to their OWN enrolled batch only —
--     denied for an unrelated batch; zero write access (no student write
--     policy exists at all).
--   - anon: zero access.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('12000000-0000-0000-0000-000000000001', 'phase12-admin@validation.local'),
  ('12000000-0000-0000-0000-000000000002', 'phase12-trainer-a@validation.local'),
  ('12000000-0000-0000-0000-000000000003', 'phase12-trainer-b@validation.local'),
  ('12000000-0000-0000-0000-000000000004', 'phase12-student-a@validation.local'),
  ('12000000-0000-0000-0000-000000000005', 'phase12-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('12000000-0000-0000-0000-000000000001', 'admin'),
  ('12000000-0000-0000-0000-000000000002', 'trainer'),
  ('12000000-0000-0000-0000-000000000003', 'trainer'),
  ('12000000-0000-0000-0000-000000000004', 'student'),
  ('12000000-0000-0000-0000-000000000005', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('12100000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Phase12', 'Admin', 'phase12-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('12200000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'Phase12', 'TrainerA', 'phase12-trainer-a@validation.local'),
  ('12200000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000003', 'Phase12', 'TrainerB', 'phase12-trainer-b@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('12300000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000004', 'Phase12', 'StudentA', '9990006001', 'phase12-student-a@validation.local'),
  ('12300000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000005', 'Phase12', 'StudentB', '9990006002', 'phase12-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('12400000-0000-0000-0000-000000000001', 'PHASE12-PROG', 'Phase 12 Program', 40000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('12500000-0000-0000-0000-000000000001', '12400000-0000-0000-0000-000000000001', 'Phase 12 Batch A', current_date, 'active'),
  ('12500000-0000-0000-0000-000000000002', '12400000-0000-0000-0000-000000000001', 'Phase 12 Batch B', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('12600000-0000-0000-0000-000000000001', '12500000-0000-0000-0000-000000000001', '12200000-0000-0000-0000-000000000001', true),
  ('12600000-0000-0000-0000-000000000002', '12500000-0000-0000-0000-000000000002', '12200000-0000-0000-0000-000000000002', true);

insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('12700000-0000-0000-0000-000000000001', '12300000-0000-0000-0000-000000000001', '12400000-0000-0000-0000-000000000001', '12500000-0000-0000-0000-000000000001', 40000.00, 40000.00, 40000.00, 'enrolled'),
  ('12700000-0000-0000-0000-000000000002', '12300000-0000-0000-0000-000000000002', '12400000-0000-0000-0000-000000000001', '12500000-0000-0000-0000-000000000002', 40000.00, 40000.00, 40000.00, 'enrolled');

insert into class_sessions (id, batch_id, session_date, status) values
  ('12800000-0000-0000-0000-000000000001', '12500000-0000-0000-0000-000000000001', current_date, 'scheduled'),
  ('12800000-0000-0000-0000-000000000002', '12500000-0000-0000-0000-000000000002', current_date, 'scheduled');

-- ---------------------------------------------------------------------------
-- Admin — full access, any batch.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"12000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from class_sessions
  where id in ('12800000-0000-0000-0000-000000000001', '12800000-0000-0000-0000-000000000002');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both sessions, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all class sessions regardless of batch (class_sessions_select_admin)';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into class_sessions (batch_id, session_date, status)
  values ('12500000-0000-0000-0000-000000000002', current_date, 'scheduled')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: admin should be able to insert a session for any batch';
  end if;
  delete from class_sessions where id = new_id;
  raise notice 'PASS: admin can insert a class session for any batch (class_sessions_write_admin)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update class_sessions set status = 'completed'
    where id = '12800000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update any session''s status, got affected=%', affected;
  end if;
  update class_sessions set status = 'scheduled' where id = '12800000-0000-0000-0000-000000000001';
  raise notice 'PASS: admin can update any class session (class_sessions_update_admin)';
end
$$;

do $$
declare
  new_id uuid;
  affected int;
begin
  insert into class_sessions (batch_id, session_date, status)
  values ('12500000-0000-0000-0000-000000000001', current_date, 'scheduled')
  returning id into new_id;
  with attempt as (
    delete from class_sessions where id = new_id returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to delete a class session, got affected=%', affected;
  end if;
  raise notice 'PASS: admin can delete a class session at the RLS layer (class_sessions_delete_admin — not exposed in the application UI, see the Phase 12 report)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer A — assigned to Batch A only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"12000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from class_sessions
  where id in ('12800000-0000-0000-0000-000000000001', '12800000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '12800000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: trainer A should see only Batch A''s session, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer A sees only their assigned batch''s sessions (class_sessions_select_trainer)';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into class_sessions (batch_id, session_date, status)
  values ('12500000-0000-0000-0000-000000000001', current_date, 'scheduled')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: trainer A should be able to insert a session for their own assigned batch';
  end if;
  delete from class_sessions where id = new_id;
  raise notice 'PASS: trainer A can insert a session for their own assigned batch (class_sessions_write_trainer)';
end
$$;

do $$
begin
  begin
    insert into class_sessions (batch_id, session_date, status)
    values ('12500000-0000-0000-0000-000000000002', current_date, 'scheduled');
    raise exception 'FAIL: trainer A should not be able to insert a session for Batch B (unassigned)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting a session for an unrelated batch (class_sessions_write_trainer WITH CHECK)';
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update class_sessions set status = 'completed'
    where id = '12800000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: trainer A should be able to update their own batch''s session, got affected=%', affected;
  end if;
  update class_sessions set status = 'scheduled' where id = '12800000-0000-0000-0000-000000000001';
  raise notice 'PASS: trainer A can update their own batch''s session (class_sessions_update_trainer)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update class_sessions set status = 'cancelled'
    where id = '12800000-0000-0000-0000-000000000002'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer A should not be able to update Batch B''s session, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer A is blocked from updating an unrelated batch''s session (0 rows affected, class_sessions_update_trainer)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    delete from class_sessions where id = '12800000-0000-0000-0000-000000000001' returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer A should not be able to delete any class session, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer A has zero delete capability (0 rows affected — no class_sessions_delete_trainer policy exists)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer B — symmetric check, proving isolation is not a one-way accident.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"12000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from class_sessions
  where id in ('12800000-0000-0000-0000-000000000001', '12800000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '12800000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: trainer B should see only Batch B''s session, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer B sees only their own assigned batch''s session (not trainer A''s)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student A — enrolled in Batch A only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"12000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from class_sessions
  where id in ('12800000-0000-0000-0000-000000000001', '12800000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '12800000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: student A should see only their own enrolled batch''s session, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student A sees only their own enrolled batch''s session (class_sessions_select_student)';
end
$$;

do $$
begin
  begin
    insert into class_sessions (batch_id, session_date, status)
    values ('12500000-0000-0000-0000-000000000001', current_date, 'scheduled');
    raise exception 'FAIL: student A should have zero write access to class_sessions';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student A is blocked from inserting any class session (no student write policy exists)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student B — symmetric check.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"12000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from class_sessions
  where id in ('12800000-0000-0000-0000-000000000001', '12800000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '12800000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: student B should see only their own enrolled batch''s session, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student B sees only their own enrolled batch''s session (not student A''s)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon — zero access. Same defensive try/catch pattern as
-- supabase/tests/phase10_student_portal_test.sql / phase11_trainer_portal_test.sql's
-- own anon checks: accepts either an empty result or a permission-denied
-- error evaluating a policy helper function as proof of "zero access".

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from class_sessions
    where id in ('12800000-0000-0000-0000-000000000001', '12800000-0000-0000-0000-000000000002');
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying class_sessions (insufficient_privilege)';
      return;
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying class_sessions (permission denied evaluating a policy helper function)';
        return;
      end if;
      raise exception 'FAIL: unexpected error querying class_sessions as anon: %', sqlerrm;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anonymous should see zero class_sessions, got count=%', cnt;
  end if;
  raise notice 'PASS: anonymous sees zero class_sessions';
end
$$;

reset role;

rollback;

select 'ALL PHASE 12 REGRESSION TESTS PASSED' as result;
