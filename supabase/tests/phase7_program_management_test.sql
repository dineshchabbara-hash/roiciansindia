-- Phase 7 (Program Management) regression suite. No RLS/schema changes were
-- made in Phase 7 — this is the first time the pre-existing `programs` RLS
-- policies (supabase/migrations/20260101000014_rls_policies.sql) are
-- actually exercised against real role-scoped sessions, rather than just
-- used as fixture data (see rls_trainer_isolation_test.sql). Run via
-- scripts/test-rls.sh. Ends with ROLLBACK — no trace left regardless of
-- pass/fail.

begin;

-- Fixture admin/trainer/student identities, matching the pattern in
-- rls_trainer_isolation_test.sql / phase5_student_management_test.sql.
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'phase7-admin@validation.local'),
  ('c1000000-0000-0000-0000-000000000002', 'phase7-trainer@validation.local'),
  ('c1000000-0000-0000-0000-000000000003', 'phase7-student@validation.local');

insert into user_roles (auth_user_id, role) values
  ('c1000000-0000-0000-0000-000000000001', 'admin'),
  ('c1000000-0000-0000-0000-000000000002', 'trainer'),
  ('c1000000-0000-0000-0000-000000000003', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'Phase7', 'Admin', 'phase7-admin@validation.local', 'admin');

-- ---------------------------------------------------------------------------
-- Admin: can insert, select, and update programs (programs_write_admin /
-- programs_select_admin / programs_update_admin).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    insert into programs (program_code, name, regular_fee, status)
    values ('PHASE7-DRAFT', 'Phase 7 Draft Program', 50000, 'draft')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to insert a program';
  end if;
  raise notice 'PASS: admin can insert a program';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    insert into programs (program_code, name, regular_fee, status)
    values ('PHASE7-ACTIVE', 'Phase 7 Active Program', 60000, 'active')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to insert a second program';
  end if;
  raise notice 'PASS: admin can insert a second (non-draft) program';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from programs where program_code in ('PHASE7-DRAFT', 'PHASE7-ACTIVE');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both programs it just created, got %', cnt;
  end if;
  raise notice 'PASS: admin sees both draft and non-draft programs';
end
$$;

do $$
declare
  affected int;
begin
  -- Updates PHASE7-ACTIVE, not PHASE7-DRAFT: the draft fixture must stay
  -- draft so the later trainer/student "must not see drafts" checks below
  -- are actually exercising a draft row.
  with attempt as (
    update programs set name = 'Phase 7 Active Program (Renamed)' where program_code = 'PHASE7-ACTIVE'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update a program';
  end if;
  raise notice 'PASS: admin can update a program';
end
$$;

-- program_code uniqueness is a real, case-sensitive DB constraint — not an
-- app-only check. A second insert reusing the same exact code must fail.
do $$
begin
  begin
    insert into programs (program_code, name, regular_fee, status)
    values ('PHASE7-ACTIVE', 'Duplicate Code Program', 10000, 'draft');
    raise exception 'FAIL: duplicate program_code was allowed';
  exception
    when unique_violation then
      raise notice 'PASS: duplicate program_code is rejected by the DB unique constraint';
  end;
end
$$;

do $$
declare
  affected int;
begin
  -- Case-sensitive: a different-cased version of an existing code is a
  -- distinct value at the DB level (no functional case-insensitive index).
  with attempt as (
    insert into programs (program_code, name, regular_fee, status)
    values ('phase7-active', 'Different Case Program', 10000, 'draft')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: a differently-cased program_code should be treated as distinct';
  end if;
  raise notice 'PASS: program_code uniqueness is case-sensitive, as designed';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer: read-only access to non-draft programs only (programs_select_published,
-- a pre-existing, unmodified policy), and zero write access
-- (programs_write_admin/update_admin/delete_admin never grant trainer).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
  draft_cnt int;
begin
  select count(*) into cnt from programs where program_code = 'PHASE7-ACTIVE';
  select count(*) into draft_cnt from programs where program_code = 'PHASE7-DRAFT';
  if cnt <> 1 then
    raise exception 'FAIL: trainer should see a non-draft program via programs_select_published, got %', cnt;
  end if;
  if draft_cnt <> 0 then
    raise exception 'FAIL: trainer should not see a draft program, got %', draft_cnt;
  end if;
  raise notice 'PASS: trainer sees non-draft programs only (pre-existing programs_select_published policy)';
end
$$;

do $$
begin
  begin
    insert into programs (program_code, name, regular_fee, status)
    values ('PHASE7-TRAINER-WRITE', 'Trainer Should Not Create This', 10000, 'draft');
    raise exception 'FAIL: trainer should not be able to insert a program';
  exception
    when insufficient_privilege then
      raise notice 'PASS: trainer is blocked from inserting a program';
    when others then
      -- RLS violations on INSERT surface as a generic policy-check failure
      -- (42501/insufficient_privilege) or a row-level security error,
      -- depending on driver; either is an acceptable rejection here.
      if sqlerrm like '%row-level security%' or sqlerrm like '%new row violates%' then
        raise notice 'PASS: trainer is blocked from inserting a program (RLS policy violation)';
      else
        raise exception 'FAIL: unexpected error inserting as trainer: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update programs set name = 'Trainer Tried To Rename This' where program_code = 'PHASE7-ACTIVE'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer should not be able to update a program, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer is blocked from updating a program (0 rows affected)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student: same read-only/no-write boundary as trainer.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
  draft_cnt int;
begin
  select count(*) into cnt from programs where program_code = 'PHASE7-ACTIVE';
  select count(*) into draft_cnt from programs where program_code = 'PHASE7-DRAFT';
  if cnt <> 1 then
    raise exception 'FAIL: student should see a non-draft program via programs_select_published, got %', cnt;
  end if;
  if draft_cnt <> 0 then
    raise exception 'FAIL: student should not see a draft program, got %', draft_cnt;
  end if;
  raise notice 'PASS: student sees non-draft programs only (pre-existing programs_select_published policy)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update programs set name = 'Student Tried To Rename This' where program_code = 'PHASE7-ACTIVE'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: student should not be able to update a program, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student is blocked from updating a program (0 rows affected)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon: zero access, including to non-draft programs (programs_select_published
-- is scoped `to authenticated`, not `anon`).

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from programs;
  exception
    when insufficient_privilege then
      cnt := 0;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anon should have zero access to programs, got %', cnt;
  end if;
  raise notice 'PASS: anon has zero access to the programs table';
end
$$;

reset role;

rollback;

select 'ALL PHASE 7 REGRESSION TESTS PASSED' as result;
