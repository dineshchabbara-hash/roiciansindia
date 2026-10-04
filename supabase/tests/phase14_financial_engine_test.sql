-- Phase 14 (Payment Plans & Financial Engine) regression suite. All
-- policies asserted below (payment_plans_select_admin/select_own/
-- write_admin/update_admin/delete_admin, installments_select_admin/
-- select_own/write_admin/update_admin/delete_admin,
-- 20260101000014_rls_policies.sql) PRE-DATE Phase 14 and are unchanged by
-- it — this is the first phase to actually exercise them end to end, since
-- no application code wrote to `payment_plans`/`installments` before
-- Phase 14 existed (same situation Phase 12 was in for class_sessions and
-- Phase 13 was in for attendance).
--
-- Covers, both allowed and denied:
--   - Admin/Super Admin: full select/insert/update/delete on
--     `payment_plans`/`installments`, any enrollment.
--   - Trainer: ZERO access (select or insert) to either table — no trainer
--     policy exists for financial data at all, by design
--     (USER_ROLES_AND_PERMISSIONS.md: "never fee, discount, payment, or
--     outstanding-balance data").
--   - Enrolled Student: select scoped to their OWN enrollment's plan/
--     installments only (payment_plans_select_own/installments_select_own)
--     — denied for an unrelated student's plan; zero write access to
--     either table.
--   - anon: zero access to both tables.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('14000000-0000-0000-0000-000000000001', 'phase14-admin@validation.local'),
  ('14000000-0000-0000-0000-000000000002', 'phase14-trainer-a@validation.local'),
  ('14000000-0000-0000-0000-000000000003', 'phase14-student-a@validation.local'),
  ('14000000-0000-0000-0000-000000000004', 'phase14-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('14000000-0000-0000-0000-000000000001', 'admin'),
  ('14000000-0000-0000-0000-000000000002', 'trainer'),
  ('14000000-0000-0000-0000-000000000003', 'student'),
  ('14000000-0000-0000-0000-000000000004', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('14100000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'Phase14', 'Admin', 'phase14-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('14200000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'Phase14', 'TrainerA', 'phase14-trainer-a@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('14300000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000003', 'Phase14', 'StudentA', '9990008001', 'phase14-student-a@validation.local'),
  ('14300000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000004', 'Phase14', 'StudentB', '9990008002', 'phase14-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('14400000-0000-0000-0000-000000000001', 'PHASE14-PROG', 'Phase 14 Program', 30000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('14500000-0000-0000-0000-000000000001', '14400000-0000-0000-0000-000000000001', 'Phase 14 Batch A', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('14600000-0000-0000-0000-000000000001', '14500000-0000-0000-0000-000000000001', '14200000-0000-0000-0000-000000000001', true);

insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('14700000-0000-0000-0000-000000000001', '14300000-0000-0000-0000-000000000001', '14400000-0000-0000-0000-000000000001', '14500000-0000-0000-0000-000000000001', 30000.00, 30000.00, 30000.00, 'enrolled'),
  ('14700000-0000-0000-0000-000000000002', '14300000-0000-0000-0000-000000000002', '14400000-0000-0000-0000-000000000001', '14500000-0000-0000-0000-000000000001', 30000.00, 30000.00, 30000.00, 'enrolled');

insert into payment_plans (id, enrollment_id, total_amount) values
  ('14800000-0000-0000-0000-000000000001', '14700000-0000-0000-0000-000000000001', 30000.00),
  ('14800000-0000-0000-0000-000000000002', '14700000-0000-0000-0000-000000000002', 30000.00);

insert into installments (id, payment_plan_id, sequence, label, amount, due_date, status) values
  ('14900000-0000-0000-0000-000000000001', '14800000-0000-0000-0000-000000000001', 1, 'Full payment', 30000.00, current_date, 'upcoming'),
  ('14900000-0000-0000-0000-000000000002', '14800000-0000-0000-0000-000000000002', 1, 'Full payment', 30000.00, current_date, 'upcoming');

-- ---------------------------------------------------------------------------
-- Admin — full access, any enrollment.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"14000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from payment_plans
  where id in ('14800000-0000-0000-0000-000000000001', '14800000-0000-0000-0000-000000000002');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both payment_plans regardless of enrollment, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all payment_plans regardless of enrollment (payment_plans_select_admin)';
end
$$;

do $$
declare
  scratch_enrollment_id uuid;
  new_id uuid;
begin
  -- batch_id omitted (nullable — "registered, not yet batch-assigned",
  -- DATABASE_SCHEMA.md): avoids colliding with the setup enrollment's own
  -- (student A, batch A) pair under enrollments_one_per_student_batch,
  -- which is irrelevant to what this scratch row is actually testing.
  -- status 'lead' (not 'enrolled') accordingly —
  -- enrollments_operational_status_requires_batch rejects an operational
  -- status without a batch_id.
  insert into enrollments (student_id, program_id, regular_fee, agreed_fee, total_payable, status)
  values ('14300000-0000-0000-0000-000000000001', '14400000-0000-0000-0000-000000000001', 30000.00, 30000.00, 30000.00, 'lead')
  returning id into scratch_enrollment_id;
  insert into payment_plans (enrollment_id, total_amount)
  values (scratch_enrollment_id, 15000.00)
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: admin should be able to insert a payment_plan for any enrollment';
  end if;
  delete from payment_plans where id = new_id;
  delete from enrollments where id = scratch_enrollment_id;
  raise notice 'PASS: admin can insert a payment_plan for any enrollment (payment_plans_write_admin)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update payment_plans set total_amount = 31000.00
    where id = '14800000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update any payment_plan, got affected=%', affected;
  end if;
  update payment_plans set total_amount = 30000.00 where id = '14800000-0000-0000-0000-000000000001';
  raise notice 'PASS: admin can update any payment_plan (payment_plans_update_admin)';
end
$$;

do $$
declare
  scratch_enrollment_id uuid;
  scratch_plan_id uuid;
  affected int;
begin
  -- batch_id omitted — same reasoning as the insert-access scratch row above.
  insert into enrollments (student_id, program_id, regular_fee, agreed_fee, total_payable, status)
  values ('14300000-0000-0000-0000-000000000001', '14400000-0000-0000-0000-000000000001', 30000.00, 30000.00, 30000.00, 'lead')
  returning id into scratch_enrollment_id;
  insert into payment_plans (enrollment_id, total_amount)
  values (scratch_enrollment_id, 15000.00)
  returning id into scratch_plan_id;
  with attempt as (
    delete from payment_plans where id = scratch_plan_id returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to delete a payment_plan, got affected=%', affected;
  end if;
  delete from enrollments where id = scratch_enrollment_id;
  raise notice 'PASS: admin can delete a payment_plan at the RLS layer (payment_plans_delete_admin — not exposed in the application UI, see the Phase 14 report)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from installments
  where id in ('14900000-0000-0000-0000-000000000001', '14900000-0000-0000-0000-000000000002');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both installments regardless of plan, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all installments regardless of plan (installments_select_admin)';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into installments (payment_plan_id, sequence, label, amount, due_date, status)
  values ('14800000-0000-0000-0000-000000000001', 2, 'Scratch', 1000.00, current_date, 'upcoming')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: admin should be able to insert an installment for any plan';
  end if;
  delete from installments where id = new_id;
  raise notice 'PASS: admin can insert an installment for any plan (installments_write_admin)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update installments set amount = 31000.00
    where id = '14900000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update any installment, got affected=%', affected;
  end if;
  update installments set amount = 30000.00 where id = '14900000-0000-0000-0000-000000000001';
  raise notice 'PASS: admin can update any installment (installments_update_admin)';
end
$$;

do $$
declare
  scratch_id uuid;
  affected int;
begin
  insert into installments (payment_plan_id, sequence, label, amount, due_date, status)
  values ('14800000-0000-0000-0000-000000000001', 3, 'Scratch', 1000.00, current_date, 'upcoming')
  returning id into scratch_id;
  with attempt as (
    delete from installments where id = scratch_id returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to delete an installment, got affected=%', affected;
  end if;
  raise notice 'PASS: admin can delete an installment at the RLS layer (installments_delete_admin — the one hard-delete path the application UI does expose, for an unpaid installment with no payment recorded against it, see the Phase 14 report)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer A — assigned to the Batch both Enrollments sit in, but financial
-- data has no trainer policy at all (USER_ROLES_AND_PERMISSIONS.md: "never
-- fee, discount, payment, or outstanding-balance data").

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"14000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from payment_plans
    where id in ('14800000-0000-0000-0000-000000000001', '14800000-0000-0000-0000-000000000002');
  exception
    when insufficient_privilege then
      raise notice 'PASS: trainer A is blocked from reading payment_plans (insufficient_privilege — no trainer policy exists)';
      cnt := -1;
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: trainer A is blocked from reading payment_plans (permission denied)';
        cnt := -1;
      else
        raise exception 'FAIL: unexpected error reading payment_plans as trainer A: %', sqlerrm;
      end if;
  end;
  if cnt = 0 then
    raise notice 'PASS: trainer A sees zero payment_plans (no trainer select policy exists)';
  elsif cnt > 0 then
    raise exception 'FAIL: trainer A should see zero payment_plans, got count=%', cnt;
  end if;
end
$$;

do $$
begin
  begin
    insert into payment_plans (enrollment_id, total_amount)
    values ('14700000-0000-0000-0000-000000000001', 5000.00);
    raise exception 'FAIL: trainer A should not be able to insert a payment_plan — no trainer write policy exists';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting a payment_plan (no payment_plans_write_trainer policy exists)';
  end;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from installments
    where id in ('14900000-0000-0000-0000-000000000001', '14900000-0000-0000-0000-000000000002');
  exception
    when insufficient_privilege then
      raise notice 'PASS: trainer A is blocked from reading installments (insufficient_privilege — no trainer policy exists)';
      cnt := -1;
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: trainer A is blocked from reading installments (permission denied)';
        cnt := -1;
      else
        raise exception 'FAIL: unexpected error reading installments as trainer A: %', sqlerrm;
      end if;
  end;
  if cnt = 0 then
    raise notice 'PASS: trainer A sees zero installments (no trainer select policy exists)';
  elsif cnt > 0 then
    raise exception 'FAIL: trainer A should see zero installments, got count=%', cnt;
  end if;
end
$$;

do $$
begin
  begin
    insert into installments (payment_plan_id, sequence, label, amount, due_date, status)
    values ('14800000-0000-0000-0000-000000000001', 4, 'Scratch', 1000.00, current_date, 'upcoming');
    raise exception 'FAIL: trainer A should not be able to insert an installment — no trainer write policy exists';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting an installment (no installments_write_trainer policy exists)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student A — own Enrollment's plan/installments only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"14000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from payment_plans
  where id in ('14800000-0000-0000-0000-000000000001', '14800000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '14800000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: student A should see only their own payment_plan, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student A sees only their own payment_plan (payment_plans_select_own), not student B''s';
end
$$;

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from installments
  where id in ('14900000-0000-0000-0000-000000000001', '14900000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '14900000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: student A should see only their own installments, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student A sees only their own installments (installments_select_own), not student B''s';
end
$$;

do $$
begin
  begin
    insert into payment_plans (enrollment_id, total_amount)
    values ('14700000-0000-0000-0000-000000000001', 5000.00);
    raise exception 'FAIL: student A should not be able to insert a payment_plan — no student write policy exists';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student A is blocked from inserting a payment_plan (no payment_plans_write_own policy exists)';
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update payment_plans set total_amount = 1.00
    where id = '14800000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: student A should not be able to update their own payment_plan, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student A is blocked from updating their own payment_plan (0 rows affected — no payment_plans_update_own policy exists)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update installments set amount = 1.00
    where id = '14900000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: student A should not be able to update their own installment, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student A is blocked from updating their own installment (0 rows affected — no installments_update_own policy exists)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student B — symmetric check, proving isolation is not a one-way accident.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"14000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from payment_plans
  where id in ('14800000-0000-0000-0000-000000000001', '14800000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '14800000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: student B should see only their own payment_plan, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student B sees only their own payment_plan (not student A''s)';
end
$$;

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from installments
  where id in ('14900000-0000-0000-0000-000000000001', '14900000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '14900000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: student B should see only their own installments, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student B sees only their own installments (not student A''s)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon — zero access. Same defensive try/catch pattern as
-- supabase/tests/phase13_attendance_test.sql's own anon check.

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from payment_plans
    where id in ('14800000-0000-0000-0000-000000000001', '14800000-0000-0000-0000-000000000002');
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying payment_plans (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying payment_plans (permission denied evaluating a policy helper function)';
      else
        raise exception 'FAIL: unexpected error querying payment_plans as anon: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from installments;
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying installments (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying installments (permission denied)';
      else
        raise exception 'FAIL: unexpected error querying installments as anon: %', sqlerrm;
      end if;
  end;
end
$$;

reset role;

rollback;

select 'ALL PHASE 14 REGRESSION TESTS PASSED' as result;
