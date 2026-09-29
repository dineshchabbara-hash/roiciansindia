-- Phase 10 (Student Portal) regression suite. Covers:
--   - students_select_own / students_select_admin (RLS): a Student sees
--     only their own `students` row, never another's
--   - students_update_own (RLS) + prevent_student_self_edit_of_protected_fields
--     (20260101000014_rls_policies.sql) trigger: a Student may update their
--     own phone/alternate_phone/address fields/profile_photo_path, but is
--     blocked from changing any identity/enrollment-critical field on their
--     own row (REQUIREMENTS.md FR-41), and is blocked (0 rows affected) from
--     updating another Student's row at all
--   - Admin remains exempt from the self-edit trigger (the pre-existing
--     students_update_admin path, unchanged by Phase 10 — verified here so
--     the Student Portal's own additions never accidentally regress it)
--   - anon has zero access to `students`
-- Enrollment-level Student isolation (a Student sees only their own
-- Enrollment, base table and enrollment_summary view alike) is already
-- covered end to end by phase9_enrollment_management_test.sql — not
-- repeated here.
--
-- Every policy/trigger asserted below pre-dates this phase
-- (20260101000014_rls_policies.sql) and is not changed by it: this is the
-- first phase to actually exercise the Student-authenticated
-- (auth_user_id-backed) side of `students` end to end
-- (IMPLEMENTATION_PLAN.md Phase 10 — "first phase where Student RLS +
-- server-side ownership checks are exercised end-to-end for a real UI"),
-- so this file only adds the missing coverage.
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('fa000000-0000-0000-0000-000000000001', 'phase10-admin@validation.local'),
  ('fa000000-0000-0000-0000-000000000002', 'phase10-student-a@validation.local'),
  ('fa000000-0000-0000-0000-000000000003', 'phase10-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('fa000000-0000-0000-0000-000000000001', 'admin'),
  ('fa000000-0000-0000-0000-000000000002', 'student'),
  ('fa000000-0000-0000-0000-000000000003', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('fb000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001', 'Phase10', 'Admin', 'phase10-admin@validation.local', 'admin');

insert into students (id, auth_user_id, student_code, first_name, last_name, phone, email, address_line1, city) values
  ('fc000000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000002', 'PHASE10-STU-A', 'Phase10', 'StudentA', '9990005001', 'phase10-student-a@validation.local', 'Old Address A', 'Old City A'),
  ('fc000000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000003', 'PHASE10-STU-B', 'Phase10', 'StudentB', '9990005002', 'phase10-student-b@validation.local', 'Old Address B', 'Old City B');

-- ---------------------------------------------------------------------------
-- Student A

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"fa000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*) into cnt from students;
  select id into seen_id from students limit 1;
  if cnt <> 1 or seen_id <> 'fc000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: student A should see only their own students row, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student A sees only their own students row (students_select_own)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update students
    set phone = '9990009999', alternate_phone = '9990008888',
        address_line1 = 'New Address A', city = 'New City A',
        profile_photo_path = 'student-photos/fc000000-0000-0000-0000-000000000001.jpg'
    where id = 'fc000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: student A should be able to update their own phone/address/photo, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student A can update their own phone/alternate_phone/address/profile_photo_path (students_update_own)';
end
$$;

do $$
begin
  begin
    update students set first_name = 'Tampered' where id = 'fc000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: student A should not be able to change their own first_name';
  exception
    when others then
      if sqlerrm like '%Students may only update phone%' then
        raise notice 'PASS: student A is blocked from changing first_name on their own row (REQUIREMENTS.md FR-41 trigger)';
      else
        raise exception 'FAIL: unexpected error blocking first_name self-edit: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
begin
  begin
    update students set status = 'inactive' where id = 'fc000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: student A should not be able to change their own status';
  exception
    when others then
      if sqlerrm like '%Students may only update phone%' then
        raise notice 'PASS: student A is blocked from changing status on their own row (REQUIREMENTS.md FR-41 trigger)';
      else
        raise exception 'FAIL: unexpected error blocking status self-edit: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
begin
  begin
    update students set auth_user_id = 'fa000000-0000-0000-0000-000000000003' where id = 'fc000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: student A should not be able to change their own auth_user_id';
  exception
    when others then
      if sqlerrm like '%Students may only update phone%' then
        raise notice 'PASS: student A is blocked from changing auth_user_id on their own row (REQUIREMENTS.md FR-41 trigger)';
      else
        raise exception 'FAIL: unexpected error blocking auth_user_id self-edit: %', sqlerrm;
      end if;
  end;
end
$$;

-- students_update_own's own USING clause filters out a non-owned row
-- before the trigger even runs — 0 rows affected, no exception at all.
do $$
declare
  affected int;
begin
  with attempt as (
    update students set phone = '9990000000' where id = 'fc000000-0000-0000-0000-000000000002'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: student A should not be able to update student B''s row, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student A is blocked from updating student B''s row (0 rows affected, students_update_own)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Admin — exempt from the self-edit trigger (students_update_admin path),
-- unchanged by Phase 10.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"fa000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    update students set first_name = 'AdminChanged' where id = 'fc000000-0000-0000-0000-000000000002'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to change a student''s first_name, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: admin remains exempt from the self-edit trigger (students_update_admin, unchanged)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon — zero access.

set local role anon;

-- Accepts either enforcement shape as "zero access": an empty result (the
-- RLS-own-row clause evaluates false/null and the RLS-admin clause's
-- is_admin_or_super() resolves without error), or a permission-denied error
-- (the planner evaluates is_admin_or_super() for this query shape, and anon
-- has no EXECUTE grant on it — 20260101000016_lock_down_security_definer_
-- function_grants.sql). Both outcomes mean anon cannot read another
-- Student's row; which one Postgres takes for a given query plan is not
-- something this test should assume either way. Same defensive pattern as
-- this suite's own insert-as-trainer/student blocks above.
do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from students;
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying students (insufficient_privilege)';
      return;
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying students (permission denied evaluating a policy helper function)';
        return;
      end if;
      raise exception 'FAIL: unexpected error querying students as anon: %', sqlerrm;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anonymous should see zero students rows, got count=%', cnt;
  end if;
  raise notice 'PASS: anonymous sees zero students rows';
end
$$;

reset role;

rollback;

select 'ALL PHASE 10 REGRESSION TESTS PASSED' as result;
