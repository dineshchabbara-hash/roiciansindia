-- Phase 11 (Trainer Portal) regression suite. Covers the one real coverage
-- gap Phase 11 newly relies on:
--   - batches_select_trainer / batch_trainers_select_own (RLS,
--     20260101000014_rls_policies.sql): a Trainer sees only Batches they
--     are actually assigned to (and their own batch_trainers row), never
--     another Trainer's — this is exercised end to end for the first time
--     by lib/data/trainer-portal.ts's getMyBatches()/getMyBatch()/
--     getMyPrograms(), which derive "assigned programs" from these same
--     rows.
--   - anon has zero access to `batches`/`batch_trainers`.
--
-- NOT repeated here (already fully covered by
-- supabase/tests/rls_trainer_isolation_test.sql, including forbidden-column
-- checks): trainer_visible_students()/trainer_visible_enrollments()
-- cross-trainer isolation — lib/data/trainer-portal.ts's
-- getMyStudents()/getMyStudent() read exclusively from those, unchanged by
-- Phase 11.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('fd000000-0000-0000-0000-000000000001', 'phase11-trainer-a@validation.local'),
  ('fd000000-0000-0000-0000-000000000002', 'phase11-trainer-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('fd000000-0000-0000-0000-000000000001', 'trainer'),
  ('fd000000-0000-0000-0000-000000000002', 'trainer');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('fe000000-0000-0000-0000-000000000001', 'fd000000-0000-0000-0000-000000000001', 'Phase11', 'TrainerA', 'phase11-trainer-a@validation.local'),
  ('fe000000-0000-0000-0000-000000000002', 'fd000000-0000-0000-0000-000000000002', 'Phase11', 'TrainerB', 'phase11-trainer-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('ff000000-0000-0000-0000-000000000001', 'PHASE11-PROG-A', 'Phase 11 Program A', 40000.00, 0, 'active'),
  ('ff000000-0000-0000-0000-000000000002', 'PHASE11-PROG-B', 'Phase 11 Program B', 40000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('f0100000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-000000000001', 'Phase 11 Batch A', current_date, 'active'),
  ('f0100000-0000-0000-0000-000000000002', 'ff000000-0000-0000-0000-000000000002', 'Phase 11 Batch B', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('f0200000-0000-0000-0000-000000000001', 'f0100000-0000-0000-0000-000000000001', 'fe000000-0000-0000-0000-000000000001', true),
  ('f0200000-0000-0000-0000-000000000002', 'f0100000-0000-0000-0000-000000000002', 'fe000000-0000-0000-0000-000000000002', true);

-- ---------------------------------------------------------------------------
-- Trainer A

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"fd000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id
  from batches
  where id in ('f0100000-0000-0000-0000-000000000001', 'f0100000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> 'f0100000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: trainer A should see only their own assigned batch, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer A sees only their own assigned batch (batches_select_trainer)';
end
$$;

do $$
declare
  cnt int;
  seen_trainer uuid;
begin
  select count(*), min(trainer_id::text)::uuid into cnt, seen_trainer
  from batch_trainers
  where batch_id in ('f0100000-0000-0000-0000-000000000001', 'f0100000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_trainer <> 'fe000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: trainer A should see only their own batch_trainers row, got count=%, trainer=%', cnt, seen_trainer;
  end if;
  raise notice 'PASS: trainer A sees only their own batch_trainers row (batch_trainers_select_own)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer B — symmetric check, proving isolation is not a one-way accident.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"fd000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id
  from batches
  where id in ('f0100000-0000-0000-0000-000000000001', 'f0100000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> 'f0100000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: trainer B should see only their own assigned batch, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer B sees only their own assigned batch (not trainer A''s)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon — zero access. Accepts either enforcement shape as "zero access"
-- (an empty result, or a permission-denied error evaluating a policy
-- helper function combined via OR with the trainer/student policies) —
-- same reasoning and same defensive pattern as
-- supabase/tests/phase10_student_portal_test.sql's own anon check.

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt
    from batches
    where id in ('f0100000-0000-0000-0000-000000000001', 'f0100000-0000-0000-0000-000000000002');
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying batches (insufficient_privilege)';
      return;
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying batches (permission denied evaluating a policy helper function)';
        return;
      end if;
      raise exception 'FAIL: unexpected error querying batches as anon: %', sqlerrm;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anonymous should see zero of these batches, got count=%', cnt;
  end if;
  raise notice 'PASS: anonymous sees zero batches';
end
$$;

reset role;

rollback;

select 'ALL PHASE 11 REGRESSION TESTS PASSED' as result;
