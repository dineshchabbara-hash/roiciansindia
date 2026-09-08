-- Regression suite for the Real Supabase Development Validation Gate
-- security-hardening pass (trainer_visible_students/trainer_visible_enrollments
-- function redesign + RLS lockdown). Run via scripts/test-rls.sh against a
-- scratch local Postgres 16 database with supabase/tests/auth_schema_stub.sql
-- and every file in supabase/migrations/ already applied, in order.
--
-- The entire run (fixtures, assertions, cleanup) is one transaction ended
-- with ROLLBACK, so it never leaves any trace in the target database
-- regardless of pass/fail — no manual cleanup step is needed. A RAISE
-- EXCEPTION on any failed assertion aborts the script with a non-zero exit
-- (via psql -v ON_ERROR_STOP=1), which is what makes this usable as a CI gate.
--
-- These same assertions were run manually, statement-by-statement, against
-- the real "Roicians India LMS Dev" Supabase project during the Real
-- Supabase Development Validation Gate, then the fixture rows were deleted
-- from the live project. This file is what makes that verification
-- permanent and re-runnable, rather than a one-off manual check.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: 2 trainers each with their own batch/student/enrollment, plus
-- one admin and one super_admin. Deterministic UUIDs for readability only.

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'rls-test-trainer-a@validation.local'),
  ('a0000000-0000-0000-0000-00000000000b', 'rls-test-trainer-b@validation.local'),
  ('b0000000-0000-0000-0000-00000000000a', 'rls-test-student-a@validation.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'rls-test-student-b@validation.local'),
  ('c0000000-0000-0000-0000-000000000001', 'rls-test-admin@validation.local'),
  ('c0000000-0000-0000-0000-000000000002', 'rls-test-superadmin@validation.local');

insert into user_roles (auth_user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', 'trainer'),
  ('a0000000-0000-0000-0000-00000000000b', 'trainer'),
  ('b0000000-0000-0000-0000-00000000000a', 'student'),
  ('b0000000-0000-0000-0000-00000000000b', 'student'),
  ('c0000000-0000-0000-0000-000000000001', 'admin'),
  ('c0000000-0000-0000-0000-000000000002', 'super_admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('f0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 'Trainer', 'A', 'rls-test-trainer-a@validation.local'),
  ('f0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b', 'Trainer', 'B', 'rls-test-trainer-b@validation.local');

insert into students (id, auth_user_id, student_code, first_name, last_name, phone, date_of_birth, address_line1) values
  ('10000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 'RLS-TEST-STU-A', 'Student', 'A', '9990000001', '2000-01-01', 'Secret Address A'),
  ('10000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 'RLS-TEST-STU-B', 'Student', 'B', '9990000002', '2000-01-02', 'Secret Address B');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('20000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Admin', 'User', 'rls-test-admin@validation.local', 'admin'),
  ('20000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Super', 'Admin', 'rls-test-superadmin@validation.local', 'super_admin');

insert into programs (id, program_code, name, regular_fee, status) values
  ('30000000-0000-0000-0000-000000000001', 'RLS-TEST-PROG', 'RLS Test Program', 20000.00, 'active');

insert into batches (id, program_id, name, start_date) values
  ('40000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', 'RLS Test Batch A', current_date),
  ('40000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001', 'RLS Test Batch B', current_date);

insert into batch_trainers (batch_id, trainer_id) values
  ('40000000-0000-0000-0000-00000000000a', 'f0000000-0000-0000-0000-00000000000a'),
  ('40000000-0000-0000-0000-00000000000b', 'f0000000-0000-0000-0000-00000000000b');

insert into enrollments (id, enrollment_code, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable) values
  ('50000000-0000-0000-0000-00000000000a', 'RLS-TEST-ENR-A', '10000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000a', 20000.00, 18000.00, 18000.00),
  ('50000000-0000-0000-0000-00000000000b', 'RLS-TEST-ENR-B', '10000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-00000000000b', 20000.00, 18000.00, 18000.00);

-- ---------------------------------------------------------------------------
-- Static check: the two trainer-safe functions never expose a forbidden
-- column, verified against the function's actual declared return type
-- (not just this file's assumption of it).

do $$
declare
  bad_cols text;
begin
  -- Introspect via information_schema on the actual OUT-parameter column
  -- list Postgres exposes for this RETURNS TABLE function, rather than
  -- trusting this test's own assumption of what it returns.
  select string_agg(parameter_name, ', ')
    into bad_cols
  from information_schema.parameters
  where specific_schema = 'public'
    and specific_name in (
      select p.proname || '_' || p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'trainer_visible_students'
    )
    and parameter_name in (
      'date_of_birth', 'gender', 'preferred_name', 'alternate_phone',
      'address_line1', 'address_line2', 'city', 'state', 'postal_code',
      'country', 'emergency_contact_name', 'emergency_contact_phone',
      'registration_date', 'status', 'profile_photo_path', 'lead_id',
      'auth_user_id', 'created_at', 'updated_at'
    );

  if bad_cols is not null then
    raise exception 'FAIL: trainer_visible_students() exposes forbidden student column(s): %', bad_cols;
  end if;
  raise notice 'PASS: trainer_visible_students() exposes no forbidden student columns';
end
$$;

do $$
declare
  bad_cols text;
begin
  select string_agg(parameter_name, ', ')
    into bad_cols
  from information_schema.parameters
  where specific_schema = 'public'
    and specific_name in (
      select p.proname || '_' || p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'trainer_visible_enrollments'
    )
    and parameter_name in (
      'regular_fee', 'agreed_fee', 'discount_amount', 'discount_reason',
      'registration_fee', 'tax_amount', 'total_payable', 'amount_paid_cache',
      'outstanding_balance_cache', 'payment_plan_type', 'source', 'notes'
    );

  if bad_cols is not null then
    raise exception 'FAIL: trainer_visible_enrollments() exposes forbidden financial column(s): %', bad_cols;
  end if;
  raise notice 'PASS: trainer_visible_enrollments() exposes no forbidden financial columns';
end
$$;

-- ---------------------------------------------------------------------------
-- Trainer A: sees only their own batch's student/enrollment via the
-- functions, and is blocked from the base tables entirely.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(student_id::text)::uuid into cnt, seen_id from trainer_visible_students();
  if cnt <> 1 or seen_id <> '10000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: trainer_a should see exactly student A via trainer_visible_students(), got count=% id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer_a sees only student A via trainer_visible_students()';
end
$$;

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(enrollment_id::text)::uuid into cnt, seen_id from trainer_visible_enrollments();
  if cnt <> 1 or seen_id <> '50000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: trainer_a should see exactly enrollment A via trainer_visible_enrollments(), got count=% id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer_a sees only enrollment A via trainer_visible_enrollments()';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from students;
  if cnt <> 0 then
    raise exception 'FAIL: trainer_a should see 0 rows querying students directly, got %', cnt;
  end if;
  raise notice 'PASS: trainer_a is blocked from the base students table directly';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from enrollments;
  if cnt <> 0 then
    raise exception 'FAIL: trainer_a should see 0 rows querying enrollments directly, got %', cnt;
  end if;
  raise notice 'PASS: trainer_a is blocked from the base enrollments table directly';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer B: symmetric isolation — sees only student/enrollment B, proving
-- cross-trainer isolation (not just "not the whole table").

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a0000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(student_id::text)::uuid into cnt, seen_id from trainer_visible_students();
  if cnt <> 1 or seen_id <> '10000000-0000-0000-0000-00000000000b' then
    raise exception 'FAIL: trainer_b should see exactly student B via trainer_visible_students(), got count=% id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer_b sees only student B via trainer_visible_students() (not trainer A''s student)';
end
$$;

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(enrollment_id::text)::uuid into cnt, seen_id from trainer_visible_enrollments();
  if cnt <> 1 or seen_id <> '50000000-0000-0000-0000-00000000000b' then
    raise exception 'FAIL: trainer_b should see exactly enrollment B via trainer_visible_enrollments(), got count=% id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer_b sees only enrollment B via trainer_visible_enrollments() (not trainer A''s enrollment)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student isolation: each student sees only their own row/enrollment
-- (including their own financial data, which IS intended for the student).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b0000000-0000-0000-0000-00000000000a","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from students;
  if cnt <> 1 or seen_id <> '10000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: student_a should see only their own row, got count=% id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student_a sees only their own students row';
end
$$;

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from enrollments;
  if cnt <> 1 or seen_id <> '50000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: student_a should see only their own enrollment, got count=% id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student_a sees only their own enrollment';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b0000000-0000-0000-0000-00000000000b","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from students;
  if cnt <> 1 or seen_id <> '10000000-0000-0000-0000-00000000000b' then
    raise exception 'FAIL: student_b should see only their own row, got count=% id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student_b sees only their own students row (not student A''s)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Admin / Super Admin: full visibility; only super_admin may write
-- company_settings.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from students;
  if cnt <> 2 then raise exception 'FAIL: admin should see all 2 students, got %', cnt; end if;
  select count(*) into cnt from enrollments;
  if cnt <> 2 then raise exception 'FAIL: admin should see all 2 enrollments, got %', cnt; end if;
  select count(*) into cnt from trainers;
  if cnt <> 2 then raise exception 'FAIL: admin should see all 2 trainers, got %', cnt; end if;
  raise notice 'PASS: admin sees all students/enrollments/trainers';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update company_settings set company_name = 'HACKED-BY-ADMIN' returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: admin should NOT be able to update company_settings, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: admin is blocked from updating company_settings (0 rows affected)';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    update company_settings set company_name = 'RLS-TEST-TEMP-CHANGE' returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: super_admin should be able to update company_settings, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: super_admin can update company_settings';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anonymous: blocked from the trainer functions and from every base table
-- that carries student/enrollment/financial data.

set local role anon;

do $$
begin
  perform trainer_visible_students();
  raise exception 'FAIL: anon should not be able to execute trainer_visible_students()';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon is blocked from executing trainer_visible_students() (%)', sqlerrm;
end
$$;

do $$
begin
  perform trainer_visible_enrollments();
  raise exception 'FAIL: anon should not be able to execute trainer_visible_enrollments()';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon is blocked from executing trainer_visible_enrollments() (%)', sqlerrm;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from students;
  exception
    when insufficient_privilege then
      cnt := 0; -- a permission-denied error is an equally valid "no access" outcome
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anon should never see any students row, got %', cnt;
  end if;
  raise notice 'PASS: anon has zero access to the students table (empty result or permission denied)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- No trace left behind, pass or fail.

rollback;

select 'ALL RLS REGRESSION TESTS PASSED' as result;
