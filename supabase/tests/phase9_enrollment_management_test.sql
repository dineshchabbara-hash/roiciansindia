-- Phase 9 (Enrollment Management) regression suite. Covers:
--   - the new DB-generated enrollment_code default (20260101000021) and its
--     pre-existing immutability trigger/unique constraint
--   - the hardened enrollment_summary/student_attendance_summary views
--     (20260101000022) specifically against real Enrollment rows
--   - the pre-existing enrollments/payments/payment_refunds RLS policies,
--     end to end, the same way phase7/phase8's suites did for
--     programs/batches
--   - financial isolation between two Enrollments' own payments/refunds
--   - a Program fee change never mutating an already-created Enrollment's
--     own commercial-terms snapshot
--   - the enrollments_one_per_student_batch partial unique index
--     (20260101000025): a Student may have at most one Enrollment for a
--     given non-null Batch, enforced at the raw DB layer regardless of
--     status (cancelled/withdrawn does not bypass it); different Batches
--     or a null Batch remain unrestricted
--   - the enrollments_operational_status_requires_batch CHECK constraint
--     (20260101000025): enrolled/active/on_hold/completed require a Batch
--     at the raw DB layer; lead/applicant remain Batch-optional
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

-- Fixture identities: one admin, one super admin, one trainer assigned to
-- the batch (A), one trainer never assigned (B, isolation), two students
-- (each with their own Enrollment, for cross-Enrollment isolation), one
-- program, one batch under that program.
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-000000000001', 'phase9-admin@validation.local'),
  ('f1000000-0000-0000-0000-000000000002', 'phase9-superadmin@validation.local'),
  ('f1000000-0000-0000-0000-000000000003', 'phase9-trainer-a@validation.local'),
  ('f1000000-0000-0000-0000-000000000004', 'phase9-trainer-b@validation.local'),
  ('f1000000-0000-0000-0000-000000000005', 'phase9-student-a@validation.local'),
  ('f1000000-0000-0000-0000-000000000006', 'phase9-student-b@validation.local'),
  -- Used only by the Student+Batch uniqueness probes further below.
  ('f1000000-0000-0000-0000-000000000007', 'phase9-student-repeat-probe@validation.local'),
  ('f1000000-0000-0000-0000-000000000008', 'phase9-student-uniq-probe2@validation.local'),
  -- Used only by the operational-status-requires-Batch CHECK probes.
  ('f1000000-0000-0000-0000-000000000009', 'phase9-student-check-probe@validation.local');

insert into user_roles (auth_user_id, role) values
  ('f1000000-0000-0000-0000-000000000001', 'admin'),
  ('f1000000-0000-0000-0000-000000000002', 'super_admin'),
  ('f1000000-0000-0000-0000-000000000003', 'trainer'),
  ('f1000000-0000-0000-0000-000000000004', 'trainer'),
  ('f1000000-0000-0000-0000-000000000005', 'student'),
  ('f1000000-0000-0000-0000-000000000006', 'student'),
  ('f1000000-0000-0000-0000-000000000007', 'student'),
  ('f1000000-0000-0000-0000-000000000008', 'student'),
  ('f1000000-0000-0000-0000-000000000009', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Phase9', 'Admin', 'phase9-admin@validation.local', 'admin'),
  ('f2000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'Phase9', 'SuperAdmin', 'phase9-superadmin@validation.local', 'super_admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000003', 'Phase9', 'TrainerA', 'phase9-trainer-a@validation.local'),
  ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000004', 'Phase9', 'TrainerB', 'phase9-trainer-b@validation.local');

insert into students (id, auth_user_id, student_code, first_name, last_name, phone) values
  ('f4000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000005', 'PHASE9-STU-A', 'Phase9', 'StudentA', '9990004001'),
  ('f4000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000006', 'PHASE9-STU-B', 'Phase9', 'StudentB', '9990004002'),
  -- Used only by the Student+Batch uniqueness probes further below.
  ('f4000000-0000-0000-0000-000000000003', 'f1000000-0000-0000-0000-000000000007', 'PHASE9-STU-REPEAT', 'Phase9', 'StudentRepeatProbe', '9990004003'),
  ('f4000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000008', 'PHASE9-STU-UNIQ2', 'Phase9', 'StudentUniqProbe2', '9990004004'),
  -- Used only by the operational-status-requires-Batch CHECK probes.
  ('f4000000-0000-0000-0000-000000000005', 'f1000000-0000-0000-0000-000000000009', 'PHASE9-STU-CHECK', 'Phase9', 'StudentCheckProbe', '9990004005');

insert into programs (id, program_code, name, regular_fee, registration_fee, tax_rate_percent, status) values
  ('f5000000-0000-0000-0000-000000000001', 'PHASE9-PROG', 'Phase 9 Test Program', 50000.00, 1000.00, 18.00, 'active'),
  ('f5000000-0000-0000-0000-000000000002', 'PHASE9-PROG-OTHER', 'Phase 9 Other Program', 30000.00, 0, null, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('f6000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'Phase 9 Test Batch', current_date, 'active'),
  ('f6000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000002', 'Phase 9 Other Batch', current_date, 'active'),
  -- Dedicated to the Student+Batch uniqueness probes below only — never
  -- assigned to any trainer, so none of these ever perturb trainer_visible_
  -- enrollments()'s per-batch count for batch f6...0001.
  ('f6000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001', 'Phase 9 Uniqueness-Probe Batch A', current_date, 'active'),
  ('f6000000-0000-0000-0000-000000000004', 'f5000000-0000-0000-0000-000000000001', 'Phase 9 Uniqueness-Probe Batch B', current_date, 'active'),
  -- Dedicated to the operational-status-requires-Batch CHECK probes below.
  ('f6000000-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000001', 'Phase 9 Check-Probe Batch', current_date, 'active');

insert into batch_trainers (batch_id, trainer_id, is_primary) values
  ('f6000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', true);

-- ---------------------------------------------------------------------------
-- Admin: insert without supplying enrollment_code, prove the DB-generated
-- format, uniqueness, and immutability.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  generated_code text;
begin
  insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
  values ('f7000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', 50000.00, 45000.00, 45000.00)
  returning enrollment_code into generated_code;

  if generated_code !~ '^ENR-[0-9]{6}$' then
    raise exception 'FAIL: enrollment_code was not DB-generated in the expected ENR-###### format, got %', generated_code;
  end if;
  raise notice 'PASS: enrollment_code is DB-generated in the expected format (%)', generated_code;
end
$$;

do $$
begin
  begin
    update enrollments set enrollment_code = 'ENR-999999' where id = 'f7000000-0000-0000-0000-000000000001';
    raise exception 'FAIL: enrollment_code should be immutable after creation';
  exception
    when others then
      if sqlerrm like '%immutable%' then
        raise notice 'PASS: enrollment_code remains immutable after creation';
      else
        raise exception 'FAIL: unexpected error updating enrollment_code: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
begin
  begin
    update enrollments set enrollment_code = (select enrollment_code from enrollments where id = 'f7000000-0000-0000-0000-000000000001')
      where id = 'f7000000-0000-0000-0000-000000000001';
  exception
    when others then null;
  end;

  begin
    insert into enrollments (student_id, program_id, enrollment_code, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000001',
      (select enrollment_code from enrollments where id = 'f7000000-0000-0000-0000-000000000001'),
      50000.00, 50000.00, 50000.00);
    raise exception 'FAIL: a duplicate enrollment_code was allowed by the database';
  exception
    when unique_violation then
      raise notice 'PASS: duplicate enrollment_code is rejected by the DB unique constraint';
  end;
end
$$;

-- Student+Batch database-level uniqueness (20260101000025's partial unique
-- index enrollments_one_per_student_batch): a Student may have at most one
-- Enrollment for a given non-null Batch, enforced even against a raw DB
-- insert that bypasses createEnrollmentRecord's own application-layer
-- pre-check entirely (tested separately in
-- lib/data/__tests__/enrollments.test.ts). Approved Phase 9
-- manual-acceptance business rule (Sept 2026), superseding the earlier
-- "repeat enrollment is allowed by design" finding for this specific case
-- — that finding remains true only for DIFFERENT Batches (or a null
-- Batch), proven further below.
--
-- Uses its own dedicated, unused-elsewhere Students/Batches (never Student
-- A/B or batch f6...0001) so leftover rows never perturb any other
-- assertion in this file (Student A/B's own enrollment counts,
-- trainer_visible_enrollments()'s per-batch count, etc.) and so no
-- role/cleanup DELETE is ever needed — the whole file's own ROLLBACK
-- removes everything regardless of pass/fail.

-- (17) First Student+Batch Enrollment is allowed.
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable) values
  ('f7000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000003', 50000.00, 50000.00, 50000.00);

-- (18)/(19) A second Enrollment for the same Student+Batch is rejected by
-- the database itself, regardless of the requested status.
do $$
begin
  begin
    insert into enrollments (student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000003', 50000.00, 50000.00, 50000.00);
    raise exception 'FAIL: a second Enrollment for the same Student+Batch was allowed by the database';
  exception
    when unique_violation then
      raise notice 'PASS: a second Enrollment for the same Student+Batch is rejected by enrollments_one_per_student_batch';
  end;
end
$$;

-- (20) Cancelling the existing Enrollment does not free up the Batch for a
-- new one — no reinstatement exception in the unique index.
update enrollments set status = 'cancelled' where id = 'f7000000-0000-0000-0000-000000000003';

do $$
begin
  begin
    insert into enrollments (student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000003', 50000.00, 50000.00, 50000.00);
    raise exception 'FAIL: a cancelled existing Enrollment should not allow a second Enrollment for the same Student+Batch';
  exception
    when unique_violation then
      raise notice 'PASS: a cancelled existing Enrollment does not bypass the Student+Batch uniqueness constraint';
  end;
end
$$;

-- (21) Withdrawing the existing Enrollment does not free up the Batch
-- either — same constraint, same non-exception, a different terminal
-- status than the previous probe.
update enrollments set status = 'withdrawn' where id = 'f7000000-0000-0000-0000-000000000003';

do $$
begin
  begin
    insert into enrollments (student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000003', 50000.00, 50000.00, 50000.00);
    raise exception 'FAIL: a withdrawn existing Enrollment should not allow a second Enrollment for the same Student+Batch';
  exception
    when unique_violation then
      raise notice 'PASS: a withdrawn existing Enrollment does not bypass the Student+Batch uniqueness constraint';
  end;
end
$$;

-- (22) The same Student enrolling in a DIFFERENT Batch remains allowed —
-- the unique index is scoped to (student_id, batch_id) together, not
-- student_id alone.
do $$
declare
  affected int;
begin
  with attempt as (
    insert into enrollments (student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000004', 50000.00, 50000.00, 50000.00)
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: the same Student enrolling in a different Batch should be allowed';
  end if;
  raise notice 'PASS: the same Student enrolling in a different Batch remains allowed';
end
$$;

-- (23) A DIFFERENT Student enrolling in the SAME Batch (f6...0003, already
-- occupied by Student f4...0003 above) remains allowed — the unique index
-- is per-Student, not a Batch-capacity limit.
do $$
declare
  affected int;
begin
  with attempt as (
    insert into enrollments (student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000004', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000003', 50000.00, 50000.00, 50000.00)
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: a different Student enrolling in the same Batch should be allowed';
  end if;
  raise notice 'PASS: a different Student enrolling in the same Batch remains allowed';
end
$$;

-- Null-Batch Enrollments (Lead/Applicant) are outside this uniqueness
-- rule entirely — the index's own WHERE clause excludes batch_id IS NULL,
-- so the same Student may hold any number of null-Batch rows.
do $$
declare
  affected int;
begin
  with attempt as (
    insert into enrollments (student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000003', 'f5000000-0000-0000-0000-000000000001', null, 50000.00, 50000.00, 50000.00)
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: a null-Batch Enrollment for a Student who already has Batch-linked Enrollments should still be allowed';
  end if;
  raise notice 'PASS: a null Batch is not covered by enrollments_one_per_student_batch — the same Student may hold any number of null-Batch Enrollments';
end
$$;

-- ---------------------------------------------------------------------------
-- Operational-status-requires-Batch database CHECK
-- (20260101000025's enrollments_operational_status_requires_batch): an
-- Enrollment may not hold an operational/student-active status (enrolled,
-- active, on_hold, completed) without a Batch, enforced even against a raw
-- DB write bypassing lib/data/enrollments.ts's own application-layer check
-- (tested separately in lib/data/__tests__/enrollments.test.ts).
-- Lead/Applicant remain Batch-optional; this CHECK does not apply to them.

-- (6) lead + null Batch is allowed (the column's own default status).
do $$
declare
  affected int;
begin
  with attempt as (
    insert into enrollments (student_id, program_id, batch_id, status, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000001', null, 'lead', 50000.00, 50000.00, 50000.00)
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: lead + null Batch should be allowed';
  end if;
  raise notice 'PASS: lead + null Batch is allowed by enrollments_operational_status_requires_batch';
end
$$;

-- (7) applicant + null Batch is allowed.
do $$
declare
  affected int;
begin
  with attempt as (
    insert into enrollments (student_id, program_id, batch_id, status, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000001', null, 'applicant', 50000.00, 50000.00, 50000.00)
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: applicant + null Batch should be allowed';
  end if;
  raise notice 'PASS: applicant + null Batch is allowed by enrollments_operational_status_requires_batch';
end
$$;

-- (8)-(11) enrolled/active/on_hold/completed + null Batch are all rejected
-- by the database itself.
do $$
declare
  op_status text;
begin
  foreach op_status in array array['enrolled', 'active', 'on_hold', 'completed']
  loop
    begin
      execute format(
        'insert into enrollments (student_id, program_id, batch_id, status, regular_fee, agreed_fee, total_payable)
         values (%L, %L, null, %L, 50000.00, 50000.00, 50000.00)',
        'f4000000-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000001', op_status
      );
      raise exception 'FAIL: % + null Batch should be rejected by the database', op_status;
    exception
      when check_violation then
        raise notice 'PASS: % + null Batch is rejected by enrollments_operational_status_requires_batch', op_status;
    end;
  end loop;
end
$$;

-- (12)-(15) enrolled/active/on_hold/completed + a valid Batch are allowed.
-- One insert (status='enrolled') followed by UPDATEs through the other
-- three operational statuses on that SAME row — not four separate INSERTs
-- — so this stays a clean, isolated probe of the CHECK constraint alone:
-- reusing this Student+Batch pair for a second INSERT would instead hit
-- enrollments_one_per_student_batch (tested separately above), and Enrollment
-- hard-delete is blocked, so a fresh INSERT per status isn't an option here.
do $$
declare
  new_id uuid;
  op_status text;
  affected int;
begin
  insert into enrollments (student_id, program_id, batch_id, status, regular_fee, agreed_fee, total_payable)
  values ('f4000000-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000005', 'enrolled', 50000.00, 50000.00, 50000.00)
  returning id into new_id;
  raise notice 'PASS: enrolled + a valid Batch is allowed by enrollments_operational_status_requires_batch';

  foreach op_status in array array['active', 'on_hold', 'completed']
  loop
    execute format('update enrollments set status = %L where id = %L', op_status, new_id);
    get diagnostics affected = row_count;
    if affected <> 1 then
      raise exception 'FAIL: % + a valid Batch should be allowed', op_status;
    end if;
    raise notice 'PASS: % + a valid Batch is allowed by enrollments_operational_status_requires_batch', op_status;
  end loop;
end
$$;

-- Second Enrollment (Student B, different Program, no Batch) — used below
-- for the financial-isolation and enrollment_summary-no-fan-out checks.
insert into enrollments (id, student_id, program_id, regular_fee, agreed_fee, total_payable) values
  ('f7000000-0000-0000-0000-000000000002', 'f4000000-0000-0000-0000-000000000002', 'f5000000-0000-0000-0000-000000000002', 30000.00, 30000.00, 30000.00);

-- ---------------------------------------------------------------------------
-- Program fee change must never mutate an already-created Enrollment's own
-- commercial-terms snapshot (Enrollment A was created with regular_fee
-- 50000.00/agreed_fee 45000.00 against Program f5...0001, whose regular_fee
-- was also 50000.00 at that time).

update programs set regular_fee = 99999.99, registration_fee = 500.00 where id = 'f5000000-0000-0000-0000-000000000001';

do $$
declare
  a_regular_fee numeric;
  a_agreed_fee numeric;
  a_total_payable numeric;
begin
  select regular_fee, agreed_fee, total_payable into a_regular_fee, a_agreed_fee, a_total_payable
  from enrollments where id = 'f7000000-0000-0000-0000-000000000001';

  if a_regular_fee <> 50000.00 or a_agreed_fee <> 45000.00 or a_total_payable <> 45000.00 then
    raise exception 'FAIL: a Program fee change mutated an existing Enrollment''s commercial terms — regular_fee=%, agreed_fee=%, total_payable=%', a_regular_fee, a_agreed_fee, a_total_payable;
  end if;
  raise notice 'PASS: a Program fee change after Enrollment creation does not alter that Enrollment''s own commercial-terms snapshot';
end
$$;

-- ---------------------------------------------------------------------------
-- No duplicate list rows from child joins: multiple payments/refunds
-- against Enrollment A must never multiply its row in enrollment_summary.

insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, total_amount, method, status) values
  ('f8000000-0000-0000-0000-000000000001', 'PHASE9-PAY-A1', 'f4000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'partial', 20000.00, 20000.00, 'cash', 'paid'),
  ('f8000000-0000-0000-0000-000000000002', 'PHASE9-PAY-A2', 'f4000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'partial', 10000.00, 10000.00, 'upi', 'paid');

insert into payment_refunds (id, payment_id, amount, status) values
  ('f9000000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', 5000.00, 'processed');

do $$
declare
  row_count int;
begin
  select count(*) into row_count from enrollment_summary where id = 'f7000000-0000-0000-0000-000000000001';
  if row_count <> 1 then
    raise exception 'FAIL: Enrollment A should appear exactly once in enrollment_summary regardless of payment/refund count, got % rows', row_count;
  end if;
  raise notice 'PASS: multiple payments and a refund against one Enrollment never duplicate its enrollment_summary row';
end
$$;

-- ---------------------------------------------------------------------------
-- Financial isolation: Enrollment B has zero payments/refunds of its own —
-- Enrollment A's payments/refunds above must never be visible against B.

insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, total_amount, method, status) values
  ('f8000000-0000-0000-0000-000000000003', 'PHASE9-PAY-B1', 'f4000000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000002', 'partial', 7000.00, 7000.00, 'cash', 'paid');

do $$
declare
  a_paid numeric;
  a_refunded numeric;
  b_paid numeric;
  b_refunded numeric;
begin
  select coalesce(sum(total_amount), 0) into a_paid from payments where enrollment_id = 'f7000000-0000-0000-0000-000000000001' and status = 'paid';
  select coalesce(sum(pr.amount), 0) into a_refunded from payment_refunds pr join payments p on p.id = pr.payment_id where p.enrollment_id = 'f7000000-0000-0000-0000-000000000001' and pr.status = 'processed';
  select coalesce(sum(total_amount), 0) into b_paid from payments where enrollment_id = 'f7000000-0000-0000-0000-000000000002' and status = 'paid';
  select coalesce(sum(pr.amount), 0) into b_refunded from payment_refunds pr join payments p on p.id = pr.payment_id where p.enrollment_id = 'f7000000-0000-0000-0000-000000000002' and pr.status = 'processed';

  if a_paid <> 30000.00 or a_refunded <> 5000.00 then
    raise exception 'FAIL: Enrollment A''s own paid/refunded totals are wrong: paid=%, refunded=%', a_paid, a_refunded;
  end if;
  if b_paid <> 7000.00 or b_refunded <> 0 then
    raise exception 'FAIL: Enrollment B''s totals were corrupted by Enrollment A''s payments/refunds: paid=%, refunded=%', b_paid, b_refunded;
  end if;
  raise notice 'PASS: Enrollment A and Enrollment B''s paid/refunded totals are fully isolated from each other';
end
$$;

-- ---------------------------------------------------------------------------
-- RLS: Admin/Super Admin full access; Trainer sees own-batch Enrollments
-- only via trainer_visible_enrollments() with zero financial columns, and
-- zero rows/writes on the base table or enrollment_summary; Student sees
-- only their own Enrollment; anon blocked entirely.

do $$
declare
  cnt int;
begin
  select count(*) into cnt from enrollments where id in ('f7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000002');
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both enrollments, got %', cnt;
  end if;
  raise notice 'PASS: admin can select enrollments';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update enrollments set status = 'active' where id = 'f7000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to update an enrollment''s status';
  end if;
  raise notice 'PASS: admin can update an enrollment''s status';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from enrollments where id in ('f7000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000002');
  if cnt <> 2 then
    raise exception 'FAIL: super_admin should see both enrollments, got %', cnt;
  end if;
  raise notice 'PASS: super_admin can select enrollments';
end
$$;

reset role;

-- Trainer A: assigned to the batch behind Enrollment A only.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from enrollments;
  if cnt <> 0 then
    raise exception 'FAIL: trainer should see zero rows on the base enrollments table (no trainer policy exists, by design), got %', cnt;
  end if;
  raise notice 'PASS: trainer has zero direct access to the enrollments base table';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from enrollment_summary;
  if cnt <> 0 then
    raise exception 'FAIL: trainer should see zero rows via enrollment_summary (it now respects RLS, and no trainer policy exists on enrollments), got %', cnt;
  end if;
  raise notice 'PASS: trainer has zero access to enrollment_summary — no financial exposure through the view either';
end
$$;

do $$
declare
  cnt int;
  has_financial_columns boolean;
begin
  select count(*) into cnt from trainer_visible_enrollments() where batch_id = 'f6000000-0000-0000-0000-000000000001';
  if cnt <> 1 then
    raise exception 'FAIL: trainer A should see exactly 1 enrollment via trainer_visible_enrollments() for their own batch, got %', cnt;
  end if;

  -- The hardened function's own return columns (checked once, structurally,
  -- via information_schema) never include a financial field.
  select exists (
    select 1 from information_schema.columns
    where table_name = 'trainer_visible_enrollments' and column_name in
      ('agreed_fee', 'regular_fee', 'discount_amount', 'discount_reason', 'registration_fee', 'tax_amount', 'total_payable', 'amount_paid_cache', 'outstanding_balance_cache')
  ) into has_financial_columns;
  if has_financial_columns then
    raise exception 'FAIL: trainer_visible_enrollments() exposes a financial column';
  end if;
  raise notice 'PASS: trainer_visible_enrollments() shows the trainer their own-batch enrollment with zero financial columns';
end
$$;

do $$
begin
  begin
    insert into enrollments (student_id, program_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 1, 1, 1);
    raise exception 'FAIL: trainer should not be able to insert an enrollment';
  exception
    when insufficient_privilege then
      raise notice 'PASS: trainer is blocked from inserting an enrollment';
    when others then
      if sqlerrm like '%row-level security%' or sqlerrm like '%new row violates%' then
        raise notice 'PASS: trainer is blocked from inserting an enrollment (RLS policy violation)';
      else
        raise exception 'FAIL: unexpected error inserting an enrollment as trainer: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update enrollments set status = 'cancelled' where id = 'f7000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer should not be able to update an enrollment, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer is blocked from updating an enrollment (0 rows affected)';
end
$$;

reset role;

-- Trainer B: not assigned to any batch behind either enrollment.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from trainer_visible_enrollments();
  if cnt <> 0 then
    raise exception 'FAIL: trainer B (not assigned to this batch) should see nothing, got %', cnt;
  end if;
  raise notice 'PASS: trainer B (not assigned) sees nothing via trainer_visible_enrollments() — trainer isolation intact';
end
$$;

reset role;

-- Student A: owns Enrollment A only.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*) into cnt from enrollments;
  select id into seen_id from enrollments limit 1;
  if cnt <> 1 or seen_id <> 'f7000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: student A should see only their own enrollment, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student A sees only their own enrollment on the base table (pre-existing enrollments_select_own policy)';
end
$$;

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*) into cnt from enrollment_summary;
  select id into seen_id from enrollment_summary limit 1;
  if cnt <> 1 or seen_id <> 'f7000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: student A should see only their own row via enrollment_summary, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: student A sees only their own row via enrollment_summary — Student B''s row (and its total_payable) never appears';
end
$$;

do $$
begin
  begin
    insert into enrollments (student_id, program_id, regular_fee, agreed_fee, total_payable)
    values ('f4000000-0000-0000-0000-000000000005', 'f5000000-0000-0000-0000-000000000001', 1, 1, 1);
    raise exception 'FAIL: student should not be able to insert an enrollment';
  exception
    when insufficient_privilege then
      raise notice 'PASS: student is blocked from inserting an enrollment';
    when others then
      if sqlerrm like '%row-level security%' or sqlerrm like '%new row violates%' or sqlerrm like '%foreign key%' then
        raise notice 'PASS: student is blocked from inserting an enrollment (RLS policy violation)';
      else
        raise exception 'FAIL: unexpected error inserting an enrollment as student: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    update enrollments set status = 'cancelled' where id = 'f7000000-0000-0000-0000-000000000001'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: student should not be able to update their own enrollment''s status, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student is blocked from updating an enrollment (0 rows affected)';
end
$$;

reset role;

-- Anon: zero access to enrollments and enrollment_summary.
set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from enrollments;
  exception
    when insufficient_privilege then
      cnt := 0;
  end;
  if cnt <> 0 then
    raise exception 'FAIL: anon should have zero access to enrollments, got %', cnt;
  end if;
  raise notice 'PASS: anon has zero access to the enrollments table';
end
$$;

do $$
begin
  begin
    perform count(*) from enrollment_summary;
    raise exception 'FAIL: anon should not be able to query enrollment_summary at all';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon is blocked from querying enrollment_summary (no SELECT grant)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Hard-delete protection (20260101000023_remove_enrollments_delete_policy):
-- no normal application role — Admin/Super Admin included — may hard-delete
-- an Enrollment; lifecycle status is the only sanctioned way to retire one.
-- Uses a dedicated fixture with NO payments/certificates/payment_plan/
-- attendance/assignment_submissions row referencing it, so the protection
-- proven here comes from RLS/authorization, never from an FK RESTRICT
-- side effect (payments/certificates are RESTRICT and would mask this).

do $$
declare
  delete_policy_count int;
begin
  select count(*) into delete_policy_count
  from pg_policies where tablename = 'enrollments' and cmd = 'DELETE';
  if delete_policy_count <> 0 then
    raise exception 'FAIL: enrollments should have zero DELETE policies, found %', delete_policy_count;
  end if;
  raise notice 'PASS: enrollments_delete_admin no longer exists — no DELETE policy remains on enrollments';
end
$$;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';

insert into enrollments (id, student_id, program_id, regular_fee, agreed_fee, total_payable) values
  ('f7000000-0000-0000-0000-000000000099', 'f4000000-0000-0000-0000-000000000001', 'f5000000-0000-0000-0000-000000000001', 50000.00, 50000.00, 50000.00);

do $$
declare
  affected int;
begin
  with attempt as (
    delete from enrollments where id = 'f7000000-0000-0000-0000-000000000099'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: admin should not be able to hard-delete an Enrollment, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: admin is blocked from hard-deleting an Enrollment (0 rows affected)';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    delete from enrollments where id = 'f7000000-0000-0000-0000-000000000099'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: super_admin should not be able to hard-delete an Enrollment, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: super_admin is blocked from hard-deleting an Enrollment (0 rows affected)';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    delete from enrollments where id = 'f7000000-0000-0000-0000-000000000099'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: trainer should not be able to hard-delete an Enrollment, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: trainer is blocked from hard-deleting an Enrollment (0 rows affected)';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  affected int;
begin
  with attempt as (
    delete from enrollments where id = 'f7000000-0000-0000-0000-000000000099'
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 0 then
    raise exception 'FAIL: student should not be able to hard-delete an Enrollment, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: student is blocked from hard-deleting an Enrollment (0 rows affected)';
end
$$;

reset role;

set local role anon;

do $$
declare
  affected int;
begin
  begin
    with attempt as (
      delete from enrollments where id = 'f7000000-0000-0000-0000-000000000099'
      returning 1
    )
    select count(*) into affected from attempt;
  exception
    when insufficient_privilege then
      affected := 0;
  end;
  if affected <> 0 then
    raise exception 'FAIL: anon should not be able to hard-delete an Enrollment, but % row(s) were affected', affected;
  end if;
  raise notice 'PASS: anon is blocked from hard-deleting an Enrollment (0 rows affected)';
end
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from enrollments where id = 'f7000000-0000-0000-0000-000000000099';
  if cnt <> 1 then
    raise exception 'FAIL: the unreferenced test Enrollment should still exist after every unauthorized DELETE attempt, got count=%', cnt;
  end if;
  raise notice 'PASS: the unreferenced test Enrollment survives every unauthorized DELETE attempt — the protection is authorization/RLS, not an FK side effect';
end
$$;

reset role;

-- No explicit fixture teardown needed: this entire file runs inside one
-- transaction (begin ... rollback) that is never committed, so the test
-- Enrollment above (and every other fixture in this file) vanishes on
-- rollback regardless of pass/fail — no service-role/owner cleanup step,
-- and the production enrollments_delete_admin removal is a real, committed
-- migration applied separately, never touched by this rollback.

rollback;

select 'ALL PHASE 9 REGRESSION TESTS PASSED' as result;
