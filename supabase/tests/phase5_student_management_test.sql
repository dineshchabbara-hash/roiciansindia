-- Phase 5 (Student Management) regression suite: the two mechanisms this
-- phase added beyond the existing RLS model — student_code auto-generation
-- from student_id_seq, and the student-documents Storage bucket's
-- admin-only RLS policies. Run via scripts/test-rls.sh alongside
-- rls_trainer_isolation_test.sql. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

-- ---------------------------------------------------------------------------
-- student_code default: sequential, unique, never client-supplied.

insert into students (first_name, last_name, phone)
values ('Phase5Test', 'StudentOne', '9990002001')
returning student_code;

insert into students (first_name, last_name, phone)
values ('Phase5Test', 'StudentTwo', '9990002002')
returning student_code;

do $$
declare
  code_one text;
  code_two text;
begin
  select student_code into code_one from students where last_name = 'StudentOne' and first_name = 'Phase5Test';
  select student_code into code_two from students where last_name = 'StudentTwo' and first_name = 'Phase5Test';

  if code_one is null or code_two is null then
    raise exception 'FAIL: student_code was not auto-generated';
  end if;
  if code_one = code_two then
    raise exception 'FAIL: two inserts got the same student_code (%), sequence not advancing', code_one;
  end if;
  if code_one !~ '^\d+$' or code_two !~ '^\d+$' then
    raise exception 'FAIL: student_code is not a plain numeric string (got % and %)', code_one, code_two;
  end if;
  raise notice 'PASS: student_code auto-generated, unique, numeric (% and %)', code_one, code_two;
end
$$;

-- Immutability still holds under the new default — even a direct,
-- privileged (superuser-context) attempt to change it must fail.
do $$
declare
  target_id uuid;
begin
  select id into target_id from students where last_name = 'StudentOne' and first_name = 'Phase5Test';
  begin
    update students set student_code = '99999999' where id = target_id;
    raise exception 'FAIL: student_code was changed — immutability trigger did not fire';
  exception
    when others then
      if sqlerrm like '%student_code is immutable%' then
        raise notice 'PASS: student_code remains immutable after the schema-completion migration';
      else
        raise exception 'FAIL: unexpected error updating student_code: %', sqlerrm;
      end if;
  end;
end
$$;

-- ---------------------------------------------------------------------------
-- Storage: student-documents bucket exists with admin-only RLS.

insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

-- Fixture admin/trainer/student identities, matching the pattern in
-- rls_trainer_isolation_test.sql.
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-000000000001', 'phase5-admin@validation.local'),
  ('b1000000-0000-0000-0000-000000000002', 'phase5-trainer@validation.local'),
  ('b1000000-0000-0000-0000-000000000003', 'phase5-student@validation.local');

insert into user_roles (auth_user_id, role) values
  ('b1000000-0000-0000-0000-000000000001', 'admin'),
  ('b1000000-0000-0000-0000-000000000002', 'trainer'),
  ('b1000000-0000-0000-0000-000000000003', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Phase5', 'Admin', 'phase5-admin@validation.local', 'admin');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    insert into storage.objects (bucket_id, name)
    values ('student-documents', 'phase5-test-student/admin-upload.pdf')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to insert into the student-documents bucket';
  end if;
  raise notice 'PASS: admin can insert into the student-documents Storage bucket';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'student-documents';
  if cnt <> 1 then
    raise exception 'FAIL: admin should see the object it just inserted, got count=%', cnt;
  end if;
  raise notice 'PASS: admin can select from the student-documents Storage bucket';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'student-documents';
  if cnt <> 0 then
    raise exception 'FAIL: trainer should have zero Storage access to student-documents, got %', cnt;
  end if;
  raise notice 'PASS: trainer has no Storage access to student-documents (0 rows visible)';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b1000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'student-documents';
  if cnt <> 0 then
    raise exception 'FAIL: student should have zero Storage access to student-documents (Admin-only this phase), got %', cnt;
  end if;
  raise notice 'PASS: student has no Storage access to student-documents this phase (0 rows visible)';
end
$$;

reset role;

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from storage.objects where bucket_id = 'student-documents';
  exception
    when insufficient_privilege then
      cnt := 0;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anon should have zero Storage access to student-documents, got %', cnt;
  end if;
  raise notice 'PASS: anon has zero Storage access to student-documents';
end
$$;

reset role;

rollback;

select 'ALL PHASE 5 REGRESSION TESTS PASSED' as result;
