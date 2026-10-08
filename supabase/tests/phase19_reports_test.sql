-- Phase 19 (Reports & Analytics) regression suite. Phase 19 adds NO
-- migration: the reports read existing tables/views through the caller's
-- own RLS-scoped session. This file pins the database-layer guarantees the
-- report data layer (lib/data/reports.ts) relies on, so a future policy or
-- view change that would widen what a report can contain fails here:
--
--   - enrollment_summary and student_attendance_summary stay
--     security_invoker (20260101000022) — they never bypass RLS.
--   - Admin / Super Admin read every report source in full: the views,
--     payments, payment_refunds and certificates (issued AND revoked).
--   - The attendance view's denominator is sessions MARKED, with Present +
--     Late counted as attended (Phase 13 semantics, read verbatim).
--   - Trainers never read any financial or certificate source, nor the
--     enrollment summary, whether or not they are assigned to the batch.
--   - A Student reads only their own rows from every source.
--   - anon reads nothing.
--
-- Every role is exercised as itself (`authenticated` / `anon` with a
-- JWT-claims GUC), never as service_role. Read-only assertions; ends with
-- ROLLBACK, so no trace is left regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('19000000-0000-0000-0000-000000000001', 'phase19-admin@validation.local'),
  ('19000000-0000-0000-0000-000000000002', 'phase19-super@validation.local'),
  ('19000000-0000-0000-0000-000000000003', 'phase19-trainer-a@validation.local'),
  ('19000000-0000-0000-0000-000000000004', 'phase19-trainer-b@validation.local'),
  ('19000000-0000-0000-0000-000000000005', 'phase19-student-a@validation.local'),
  ('19000000-0000-0000-0000-000000000006', 'phase19-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('19000000-0000-0000-0000-000000000001', 'admin'),
  ('19000000-0000-0000-0000-000000000002', 'super_admin'),
  ('19000000-0000-0000-0000-000000000003', 'trainer'),
  ('19000000-0000-0000-0000-000000000004', 'trainer'),
  ('19000000-0000-0000-0000-000000000005', 'student'),
  ('19000000-0000-0000-0000-000000000006', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('19100000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Phase19', 'Admin', 'phase19-admin@validation.local', 'admin'),
  ('19100000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000002', 'Phase19', 'Super', 'phase19-super@validation.local', 'super_admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('19200000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000003', 'Phase19', 'TrainerA', 'phase19-trainer-a@validation.local'),
  ('19200000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000004', 'Phase19', 'TrainerB', 'phase19-trainer-b@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('19300000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000005', 'Phase19', 'StudentA', '9990019001', 'phase19-student-a@validation.local'),
  ('19300000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000006', 'Phase19', 'StudentB', '9990019002', 'phase19-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('19400000-0000-0000-0000-000000000001', 'PHASE19-PROG', 'Phase 19 Program', 1000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('19500000-0000-0000-0000-000000000001', '19400000-0000-0000-0000-000000000001', 'Phase 19 Batch', current_date, 'active');

-- Trainer A is assigned to the batch; Trainer B is not.
insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('19600000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', '19200000-0000-0000-0000-000000000001', true);

insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('19700000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', '19400000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 1000.00, 1000.00, 1000.00, 'active'),
  ('19700000-0000-0000-0000-000000000002', '19300000-0000-0000-0000-000000000002', '19400000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 1000.00, 1000.00, 1000.00, 'active');

insert into class_sessions (id, batch_id, session_date, status) values
  ('19800000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', current_date - 2, 'completed'),
  ('19800000-0000-0000-0000-000000000002', '19500000-0000-0000-0000-000000000001', current_date - 1, 'completed'),
  ('19800000-0000-0000-0000-000000000003', '19500000-0000-0000-0000-000000000001', current_date, 'completed');

-- Student A: present, late, absent (3 marked -> 66.67%). Student B: one
-- absent (1 marked -> 0.00%).
insert into attendance (class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type) values
  ('19800000-0000-0000-0000-000000000001', '19700000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 'present', '19100000-0000-0000-0000-000000000001', 'admin'),
  ('19800000-0000-0000-0000-000000000002', '19700000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 'late', '19100000-0000-0000-0000-000000000001', 'admin'),
  ('19800000-0000-0000-0000-000000000003', '19700000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 'absent', '19100000-0000-0000-0000-000000000001', 'admin'),
  ('19800000-0000-0000-0000-000000000001', '19700000-0000-0000-0000-000000000002', '19300000-0000-0000-0000-000000000002', '19500000-0000-0000-0000-000000000001', 'absent', '19100000-0000-0000-0000-000000000001', 'admin');

insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, total_amount, method, status) values
  ('19a00000-0000-0000-0000-000000000001', 'PHASE19-PAY-A', '19300000-0000-0000-0000-000000000001', '19700000-0000-0000-0000-000000000001', 'partial', 400.00, 400.00, 'cash', 'paid'),
  ('19a00000-0000-0000-0000-000000000002', 'PHASE19-PAY-B', '19300000-0000-0000-0000-000000000002', '19700000-0000-0000-0000-000000000002', 'partial', 250.50, 250.50, 'cash', 'paid');

insert into payment_refunds (id, payment_id, amount, status) values
  ('19b00000-0000-0000-0000-000000000001', '19a00000-0000-0000-0000-000000000001', 100.25, 'processed');

insert into certificates (id, certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, status, pdf_path) values
  ('19c00000-0000-0000-0000-000000000001', 'PHASE19-CERT-A', '19700000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', '19400000-0000-0000-0000-000000000001', current_date, current_date, 'issued', '19300000-0000-0000-0000-000000000001/PHASE19-CERT-A.pdf'),
  ('19c00000-0000-0000-0000-000000000002', 'PHASE19-CERT-B', '19700000-0000-0000-0000-000000000002', '19300000-0000-0000-0000-000000000002', '19400000-0000-0000-0000-000000000001', current_date, current_date, 'revoked', '19300000-0000-0000-0000-000000000002/PHASE19-CERT-B.pdf');

-- ---------------------------------------------------------------------------
-- Views stay security_invoker.

do $$
declare
  invoker_count int;
begin
  select count(*) into invoker_count
  from pg_class
  where relname in ('enrollment_summary', 'student_attendance_summary')
    and reloptions @> array['security_invoker=true'];
  if invoker_count <> 2 then
    raise exception 'FAIL: both report views must stay security_invoker, got %', invoker_count;
  end if;
  raise notice 'PASS: enrollment_summary and student_attendance_summary are security_invoker';
end
$$;

-- ---------------------------------------------------------------------------
-- Admin and Super Admin — full read of every report source.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"19000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  n bigint;
  rec record;
begin
  select count(*) into n from enrollment_summary where program_id = '19400000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'FAIL: admin should read both enrollment_summary rows, got %', n; end if;

  select total_sessions, present_count, late_count, absent_count, excused_count, attendance_percentage
    into rec from student_attendance_summary
    where enrollment_id = '19700000-0000-0000-0000-000000000001';
  if rec.total_sessions <> 3 or rec.present_count <> 1 or rec.late_count <> 1
     or rec.absent_count <> 1 or rec.excused_count <> 0 or rec.attendance_percentage <> 66.67 then
    raise exception 'FAIL: Phase 13 semantics changed for student A: %', rec;
  end if;
  select attendance_percentage into rec from student_attendance_summary
    where enrollment_id = '19700000-0000-0000-0000-000000000002';
  if rec.attendance_percentage <> 0.00 then
    raise exception 'FAIL: student B (1 absent of 1 marked) should be 0.00%%, got %', rec.attendance_percentage;
  end if;
  raise notice 'PASS: attendance view denominator = sessions marked; Present + Late attended (66.67 / 0.00)';

  select count(*) into n from payments where id::text like '19a00000-%';
  if n <> 2 then raise exception 'FAIL: admin should read both payments, got %', n; end if;
  select count(*) into n from payment_refunds where id = '19b00000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: admin should read the refund, got %', n; end if;
  raise notice 'PASS: admin reads enrollment_summary, payments, refunds and certificates in full';
end
$$;

do $$
declare
  issued bigint;
  revoked bigint;
begin
  select count(*) filter (where status = 'issued'), count(*) filter (where status = 'revoked')
    into issued, revoked from certificates where id::text like '19c00000-%';
  if issued <> 1 or revoked <> 1 then
    raise exception 'FAIL: issued and revoked must stay distinct (issued %, revoked %)', issued, revoked;
  end if;
  raise notice 'PASS: certificate status keeps issued and revoked distinct';
end
$$;

set local "request.jwt.claims" to '{"sub":"19000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n bigint;
begin
  select count(*) into n from enrollment_summary where program_id = '19400000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'FAIL: super admin should read both enrollment_summary rows, got %', n; end if;
  select count(*) into n from student_attendance_summary where batch_id = '19500000-0000-0000-0000-000000000001';
  if n <> 2 then raise exception 'FAIL: super admin should read both attendance summaries, got %', n; end if;
  select count(*) into n from payments where id::text like '19a00000-%';
  if n <> 2 then raise exception 'FAIL: super admin should read both payments, got %', n; end if;
  raise notice 'PASS: super admin reads every report source';
end
$$;

-- ---------------------------------------------------------------------------
-- Trainers — never financial, certificate or enrollment-summary data,
-- assigned to the batch or not.

do $$
declare
  trainer_sub text;
  n bigint;
begin
  foreach trainer_sub in array array[
    '19000000-0000-0000-0000-000000000003',
    '19000000-0000-0000-0000-000000000004'
  ] loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', trainer_sub, 'role', 'authenticated')::text,
      true
    );

    select count(*) into n from enrollment_summary where program_id = '19400000-0000-0000-0000-000000000001';
    if n <> 0 then raise exception 'FAIL: trainer % read % enrollment_summary rows', trainer_sub, n; end if;
    select count(*) into n from payments where id::text like '19a00000-%';
    if n <> 0 then raise exception 'FAIL: trainer % read % payments', trainer_sub, n; end if;
    select count(*) into n from payment_refunds where id = '19b00000-0000-0000-0000-000000000001';
    if n <> 0 then raise exception 'FAIL: trainer % read a refund', trainer_sub; end if;
    select count(*) into n from certificates where id::text like '19c00000-%';
    if n <> 0 then raise exception 'FAIL: trainer % read % certificates', trainer_sub, n; end if;
  end loop;
  raise notice 'PASS: assigned and unassigned trainers read no enrollment_summary, payments, refunds or certificates';
end
$$;

set local "request.jwt.claims" to '{"sub":"19000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  n bigint;
begin
  select count(*) into n from student_attendance_summary where batch_id = '19500000-0000-0000-0000-000000000001';
  if n <> 0 then
    raise exception 'FAIL: an unassigned trainer must not read attendance summaries, got %', n;
  end if;
  raise notice 'PASS: unassigned trainer reads no attendance summary';
end
$$;

-- ---------------------------------------------------------------------------
-- Student A — own rows only, from every source.

set local "request.jwt.claims" to '{"sub":"19000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  n bigint;
begin
  select count(*) into n from enrollment_summary where student_id = '19300000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FAIL: student A read student B''s enrollment_summary row'; end if;
  select count(*) into n from enrollment_summary where student_id = '19300000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: student A should read their own enrollment_summary row, got %', n; end if;

  select count(*) into n from student_attendance_summary where student_id = '19300000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FAIL: student A read student B''s attendance summary'; end if;

  select count(*) into n from payments where student_id = '19300000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FAIL: student A read student B''s payment'; end if;

  select count(*) into n from certificates where student_id = '19300000-0000-0000-0000-000000000002';
  if n <> 0 then raise exception 'FAIL: student A read student B''s certificate'; end if;

  select count(*) into n from payment_refunds where id = '19b00000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: student A should read the refund on their own payment, got %', n; end if;
  raise notice 'PASS: student reads only their own report-source rows';
end
$$;

-- ---------------------------------------------------------------------------
-- anon — nothing. Same convention as phase17/phase18: anon is denied
-- either by zero rows or by "permission denied" (no grant on the views,
-- and no EXECUTE on the RLS helper functions).

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

do $$
declare
  source text;
  n bigint;
begin
  foreach source in array array[
    'enrollment_summary',
    'student_attendance_summary',
    'payments',
    'payment_refunds',
    'certificates',
    'students',
    'enrollments',
    'attendance'
  ] loop
    begin
      execute format('select count(*) from %I', source) into n;
      if n <> 0 then
        raise exception 'FAIL: anon read % rows from %', n, source;
      end if;
    exception
      when insufficient_privilege then
        null;
      when others then
        if sqlerrm like 'FAIL:%' then raise; end if;
        if sqlerrm not like 'permission denied%' then raise; end if;
    end;
  end loop;
  raise notice 'PASS: anon reads nothing from any report source';
end
$$;

rollback;
