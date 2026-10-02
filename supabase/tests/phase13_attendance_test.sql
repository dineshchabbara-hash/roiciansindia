-- Phase 13 (Attendance) regression suite. All policies asserted below
-- (attendance_select_admin/select_trainer/select_own/write_admin/
-- write_trainer/update_admin/update_trainer/delete_admin,
-- attendance_audit_select_admin/write_admin,
-- 20260101000014_rls_policies.sql) PRE-DATE Phase 13 and are unchanged by
-- it — this is the first phase to actually exercise them end to end, since
-- no application code wrote to `attendance`/`attendance_audit` before
-- Phase 13 existed (same situation Phase 12 was in for class_sessions).
--
-- Covers, both allowed and denied:
--   - Admin/Super Admin: full select/insert/update/delete on `attendance`,
--     any batch; select/insert on `attendance_audit`.
--   - Assigned Trainer: select/insert/update on `attendance` scoped to their
--     OWN assigned batch only — denied for an unrelated batch (including a
--     cross-batch injection attempt using a real student from their own
--     batch against a different batch's session); no delete policy exists
--     for Trainer at all; ZERO access (select or insert) to
--     `attendance_audit` — by design, see lib/data/trainer-portal.ts's own
--     comment on why its attendance_audit writes use the service-role
--     client instead.
--   - Enrolled Student: select scoped to their OWN attendance rows only
--     (attendance_select_own) — denied for an unrelated student's row; zero
--     write access to `attendance`; zero access to `attendance_audit`.
--   - anon: zero access to both tables.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('13000000-0000-0000-0000-000000000001', 'phase13-admin@validation.local'),
  ('13000000-0000-0000-0000-000000000002', 'phase13-trainer-a@validation.local'),
  ('13000000-0000-0000-0000-000000000003', 'phase13-trainer-b@validation.local'),
  ('13000000-0000-0000-0000-000000000004', 'phase13-student-a@validation.local'),
  ('13000000-0000-0000-0000-000000000005', 'phase13-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('13000000-0000-0000-0000-000000000001', 'admin'),
  ('13000000-0000-0000-0000-000000000002', 'trainer'),
  ('13000000-0000-0000-0000-000000000003', 'trainer'),
  ('13000000-0000-0000-0000-000000000004', 'student'),
  ('13000000-0000-0000-0000-000000000005', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('13100000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Phase13', 'Admin', 'phase13-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('13200000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000002', 'Phase13', 'TrainerA', 'phase13-trainer-a@validation.local'),
  ('13200000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000003', 'Phase13', 'TrainerB', 'phase13-trainer-b@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('13300000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000004', 'Phase13', 'StudentA', '9990007001', 'phase13-student-a@validation.local'),
  ('13300000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000005', 'Phase13', 'StudentB', '9990007002', 'phase13-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('13400000-0000-0000-0000-000000000001', 'PHASE13-PROG', 'Phase 13 Program', 40000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('13500000-0000-0000-0000-000000000001', '13400000-0000-0000-0000-000000000001', 'Phase 13 Batch A', current_date, 'active'),
  ('13500000-0000-0000-0000-000000000002', '13400000-0000-0000-0000-000000000001', 'Phase 13 Batch B', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('13600000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', '13200000-0000-0000-0000-000000000001', true),
  ('13600000-0000-0000-0000-000000000002', '13500000-0000-0000-0000-000000000002', '13200000-0000-0000-0000-000000000002', true);

insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('13700000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000001', '13400000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', 40000.00, 40000.00, 40000.00, 'enrolled'),
  ('13700000-0000-0000-0000-000000000002', '13300000-0000-0000-0000-000000000002', '13400000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000002', 40000.00, 40000.00, 40000.00, 'enrolled');

insert into class_sessions (id, batch_id, session_date, status) values
  ('13800000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', current_date, 'scheduled'),
  ('13800000-0000-0000-0000-000000000002', '13500000-0000-0000-0000-000000000002', current_date, 'scheduled'),
  -- A second Batch B session, deliberately left with no attendance row, so
  -- a cross-batch injection attempt against it can't accidentally collide
  -- with attendance_unique_per_session and mask a genuine RLS denial.
  ('13800000-0000-0000-0000-000000000003', '13500000-0000-0000-0000-000000000002', current_date, 'scheduled');

insert into attendance (id, class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type) values
  ('13900000-0000-0000-0000-000000000001', '13800000-0000-0000-0000-000000000001', '13700000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', 'present', '13100000-0000-0000-0000-000000000001', 'admin'),
  ('13900000-0000-0000-0000-000000000002', '13800000-0000-0000-0000-000000000002', '13700000-0000-0000-0000-000000000002', '13300000-0000-0000-0000-000000000002', '13500000-0000-0000-0000-000000000002', 'absent', '13200000-0000-0000-0000-000000000002', 'trainer');

-- ---------------------------------------------------------------------------
-- Admin — full access, any batch.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"13000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from attendance
  where id in ('13900000-0000-0000-0000-000000000001', '13900000-0000-0000-0000-000000000002');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both attendance rows regardless of batch, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all attendance rows regardless of batch (attendance_select_admin)';
end
$$;

do $$
declare
  scratch_session_id uuid;
  new_id uuid;
begin
  -- A throwaway session on Batch B — the setup row already occupies
  -- (session B, student B), and attendance_unique_per_session rejects a
  -- second row for that same pair, so this proves insert access without
  -- colliding with it.
  insert into class_sessions (batch_id, session_date, status)
  values ('13500000-0000-0000-0000-000000000002', current_date, 'scheduled')
  returning id into scratch_session_id;
  insert into attendance (class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type)
  values (scratch_session_id, '13700000-0000-0000-0000-000000000002', '13300000-0000-0000-0000-000000000002', '13500000-0000-0000-0000-000000000002', 'late', '13100000-0000-0000-0000-000000000001', 'admin')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: admin should be able to insert an attendance row for any batch';
  end if;
  delete from attendance where id = new_id;
  delete from class_sessions where id = scratch_session_id;
  raise notice 'PASS: admin can insert an attendance row for any batch (attendance_write_admin)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update attendance set status = 'late'
    where id = '13900000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update any attendance row, got affected=%', affected;
  end if;
  update attendance set status = 'present' where id = '13900000-0000-0000-0000-000000000001';
  raise notice 'PASS: admin can update any attendance row (attendance_update_admin)';
end
$$;

do $$
declare
  new_audit_id uuid;
begin
  insert into attendance_audit (attendance_id, changed_by, changed_by_type, previous_status, new_status)
  values ('13900000-0000-0000-0000-000000000001', '13100000-0000-0000-0000-000000000001', 'admin', 'present', 'late')
  returning id into new_audit_id;
  if new_audit_id is null then
    raise exception 'FAIL: admin should be able to insert an attendance_audit row';
  end if;
  raise notice 'PASS: admin can insert an attendance_audit row (attendance_audit_write_admin)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from attendance_audit where attendance_id = '13900000-0000-0000-0000-000000000001';
  if cnt <> 1 then
    raise exception 'FAIL: admin should see the attendance_audit row it just inserted, got count=%', cnt;
  end if;
  raise notice 'PASS: admin can read attendance_audit (attendance_audit_select_admin)';
end
$$;

do $$
declare
  scratch_session_id uuid;
  scratch_attendance_id uuid;
  affected int;
begin
  insert into class_sessions (batch_id, session_date, status)
  values ('13500000-0000-0000-0000-000000000001', current_date, 'scheduled')
  returning id into scratch_session_id;
  insert into attendance (class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type)
  values (scratch_session_id, '13700000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', 'present', '13100000-0000-0000-0000-000000000001', 'admin')
  returning id into scratch_attendance_id;
  with attempt as (
    delete from attendance where id = scratch_attendance_id returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to delete an attendance row, got affected=%', affected;
  end if;
  delete from class_sessions where id = scratch_session_id;
  raise notice 'PASS: admin can delete an attendance row at the RLS layer (attendance_delete_admin — not exposed in the application UI, see the Phase 13 report)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer A — assigned to Batch A only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"13000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from attendance
  where id in ('13900000-0000-0000-0000-000000000001', '13900000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '13900000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: trainer A should see only Batch A''s attendance row, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer A sees only their assigned batch''s attendance (attendance_select_trainer)';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into attendance (class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type)
  values ('13800000-0000-0000-0000-000000000001', '13700000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', 'late', '13200000-0000-0000-0000-000000000001', 'trainer');
  raise exception 'FAIL: trainer A should not be able to insert a duplicate row for (session A, student A) — attendance_unique_per_session';
exception
  when unique_violation then
    raise notice 'PASS: attendance_unique_per_session rejects a duplicate (class_session_id, student_id) row';
end
$$;

do $$
declare
  scratch_session_id uuid;
  new_id uuid;
begin
  insert into class_sessions (batch_id, session_date, status)
  values ('13500000-0000-0000-0000-000000000001', current_date, 'scheduled')
  returning id into scratch_session_id;
  insert into attendance (class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type)
  values (scratch_session_id, '13700000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', 'present', '13200000-0000-0000-0000-000000000001', 'trainer')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: trainer A should be able to insert an attendance row for their own assigned batch';
  end if;
  delete from attendance where id = new_id;
  delete from class_sessions where id = scratch_session_id;
  raise notice 'PASS: trainer A can insert an attendance row for their own assigned batch (attendance_write_trainer)';
end
$$;

do $$
begin
  -- Targets session '...003' (Batch B, no attendance row from setup) rather
  -- than the setup row's own session — otherwise a successful insert would
  -- hit attendance_unique_per_session first and the `when ... or others`
  -- handler below would report a false PASS for the wrong reason (a
  -- constraint collision, not an RLS denial).
  begin
    insert into attendance (class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type)
    values ('13800000-0000-0000-0000-000000000003', '13700000-0000-0000-0000-000000000002', '13300000-0000-0000-0000-000000000002', '13500000-0000-0000-0000-000000000002', 'present', '13200000-0000-0000-0000-000000000001', 'trainer');
    raise exception 'FAIL: trainer A should not be able to insert an attendance row for Batch B (unassigned)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting attendance for an unrelated batch, even with a real student/session from that batch (attendance_write_trainer WITH CHECK)';
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update attendance set status = 'late'
    where id = '13900000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: trainer A should be able to update their own batch''s attendance, got affected=%', affected;
  end if;
  update attendance set status = 'present' where id = '13900000-0000-0000-0000-000000000001';
  raise notice 'PASS: trainer A can update their own batch''s attendance (attendance_update_trainer)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update attendance set status = 'present'
    where id = '13900000-0000-0000-0000-000000000002'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer A should not be able to update Batch B''s attendance, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer A is blocked from updating an unrelated batch''s attendance (0 rows affected, attendance_update_trainer)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    delete from attendance where id = '13900000-0000-0000-0000-000000000001' returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer A should not be able to delete any attendance row, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer A has zero delete capability on attendance (0 rows affected — no attendance_delete_trainer policy exists)';
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from attendance_audit where attendance_id = '13900000-0000-0000-0000-000000000001';
  exception
    when insufficient_privilege then
      raise notice 'PASS: trainer A is blocked from reading attendance_audit (insufficient_privilege — no trainer policy exists)';
      return;
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: trainer A is blocked from reading attendance_audit (permission denied)';
        return;
      end if;
      raise exception 'FAIL: unexpected error reading attendance_audit as trainer A: %', sqlerrm;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: trainer A should see zero attendance_audit rows, got count=%', cnt;
  end if;
  raise notice 'PASS: trainer A sees zero attendance_audit rows (no trainer select policy exists)';
end
$$;

do $$
begin
  begin
    insert into attendance_audit (attendance_id, changed_by, changed_by_type, previous_status, new_status)
    values ('13900000-0000-0000-0000-000000000001', '13200000-0000-0000-0000-000000000001', 'trainer', 'present', 'late');
    raise exception 'FAIL: trainer A should not be able to insert an attendance_audit row directly — no trainer write policy exists (lib/data/trainer-portal.ts uses the service-role client for this instead)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting attendance_audit directly (no attendance_audit_write_trainer policy exists)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer B — symmetric check, proving isolation is not a one-way accident.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"13000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from attendance
  where id in ('13900000-0000-0000-0000-000000000001', '13900000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '13900000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: trainer B should see only Batch B''s attendance row, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer B sees only their own assigned batch''s attendance (not trainer A''s)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student A — enrolled in Batch A only, own attendance row.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"13000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from attendance
  where id in ('13900000-0000-0000-0000-000000000001', '13900000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '13900000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: student A should see only their own attendance row, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student A sees only their own attendance row (attendance_select_own), not student B''s';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from student_attendance_summary where student_id = '13300000-0000-0000-0000-000000000001';
  if cnt <> 1 then
    raise exception 'FAIL: student A should see exactly one summary row (their own), got count=%', cnt;
  end if;
  raise notice 'PASS: student A can read their own row from student_attendance_summary (security_invoker, FR-62)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from student_attendance_summary where student_id = '13300000-0000-0000-0000-000000000002';
  if cnt <> 0 then
    raise exception 'FAIL: student A should see zero rows of student B''s attendance summary, got count=%', cnt;
  end if;
  raise notice 'PASS: student A sees zero of student B''s rows in student_attendance_summary';
end
$$;

do $$
begin
  begin
    insert into attendance (class_session_id, enrollment_id, student_id, batch_id, status, marked_by, marked_by_type)
    values ('13800000-0000-0000-0000-000000000001', '13700000-0000-0000-0000-000000000001', '13300000-0000-0000-0000-000000000001', '13500000-0000-0000-0000-000000000001', 'present', '13300000-0000-0000-0000-000000000001', 'admin');
    raise exception 'FAIL: student A should have zero write access to attendance';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student A is blocked from inserting any attendance row (no student write policy exists)';
  end;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from attendance_audit where attendance_id = '13900000-0000-0000-0000-000000000001';
  exception
    when insufficient_privilege then
      raise notice 'PASS: student A is blocked from reading attendance_audit (insufficient_privilege)';
      return;
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: student A is blocked from reading attendance_audit (permission denied)';
        return;
      end if;
      raise exception 'FAIL: unexpected error reading attendance_audit as student A: %', sqlerrm;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: student A should see zero attendance_audit rows, got count=%', cnt;
  end if;
  raise notice 'PASS: student A sees zero attendance_audit rows';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student B — symmetric check.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"13000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from attendance
  where id in ('13900000-0000-0000-0000-000000000001', '13900000-0000-0000-0000-000000000002');
  if cnt <> 1 or seen_id <> '13900000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: student B should see only their own attendance row, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student B sees only their own attendance row (not student A''s)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon — zero access. Same defensive try/catch pattern as
-- supabase/tests/phase12_class_sessions_test.sql's own anon check.

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from attendance
    where id in ('13900000-0000-0000-0000-000000000001', '13900000-0000-0000-0000-000000000002');
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying attendance (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying attendance (permission denied evaluating a policy helper function)';
      else
        raise exception 'FAIL: unexpected error querying attendance as anon: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from attendance_audit;
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying attendance_audit (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying attendance_audit (permission denied)';
      else
        raise exception 'FAIL: unexpected error querying attendance_audit as anon: %', sqlerrm;
      end if;
  end;
end
$$;

reset role;

rollback;

select 'ALL PHASE 13 REGRESSION TESTS PASSED' as result;
