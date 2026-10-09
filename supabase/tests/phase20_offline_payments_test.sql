-- Phase 20A (Offline Payments Ledger) regression suite for
-- 20260101000035_offline_payments_ledger.sql:
--
--   - record_offline_payment(): Admin/Super Admin only; derives student_id
--     and created_by server-side; stores status=paid, tax 0, total=amount;
--     paid_at is the Asia/Kolkata calendar day entered; payment_code is DB
--     generated (PAY-nnnnnn); idempotent on the caller-supplied id.
--   - Business rules confirmed at the Phase 20A checkpoint: confirmed
--     enrollment statuses only; overpayment blocked against the Phase 14
--     outstanding formula (payable - paid + processed refunds, floor 0);
--     no future payment date; offline methods only; enrollment-level only.
--   - FR-91: no end-user role can UPDATE/DELETE/INSERT payments directly;
--     a settled row is frozen for every role, service_role included.
--   - BR-5: student/installment must belong to the payment's enrollment.
--   - Trainer reads nothing and records nothing; a Student reads only
--     their own payments and records nothing; anon cannot call the RPC.
--
-- Every role is exercised as itself (`authenticated` / `anon` with a
-- JWT-claims GUC), never as service_role, except the explicit
-- database-owner checks in the immutability/integrity section (which prove
-- the triggers hold even for a privileged writer). Ends with ROLLBACK.

begin;

insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001', 'phase20-admin@validation.local'),
  ('20000000-0000-0000-0000-000000000002', 'phase20-super@validation.local'),
  ('20000000-0000-0000-0000-000000000003', 'phase20-trainer@validation.local'),
  ('20000000-0000-0000-0000-000000000004', 'phase20-student-a@validation.local'),
  ('20000000-0000-0000-0000-000000000005', 'phase20-student-b@validation.local'),
  ('20000000-0000-0000-0000-000000000006', 'phase20-admin-noprofile@validation.local');

insert into user_roles (auth_user_id, role) values
  ('20000000-0000-0000-0000-000000000001', 'admin'),
  ('20000000-0000-0000-0000-000000000002', 'super_admin'),
  ('20000000-0000-0000-0000-000000000003', 'trainer'),
  ('20000000-0000-0000-0000-000000000004', 'student'),
  ('20000000-0000-0000-0000-000000000005', 'student'),
  ('20000000-0000-0000-0000-000000000006', 'admin');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('20100000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Phase20', 'Admin', 'phase20-admin@validation.local', 'admin'),
  ('20100000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Phase20', 'Super', 'phase20-super@validation.local', 'super_admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('20200000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Phase20', 'Trainer', 'phase20-trainer@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('20300000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'Phase20', 'StudentA', '9990020001', 'phase20-student-a@validation.local'),
  ('20300000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005', 'Phase20', 'StudentB', '9990020002', 'phase20-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('20400000-0000-0000-0000-000000000001', 'PHASE20-PROG', 'Phase 20 Program', 1000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('20500000-0000-0000-0000-000000000001', '20400000-0000-0000-0000-000000000001', 'Phase 20 Batch', current_date, 'active'),
  ('20500000-0000-0000-0000-000000000002', '20400000-0000-0000-0000-000000000001', 'Phase 20 Batch Two', current_date, 'active');

-- The trainer is assigned to the batch: assignment must still grant zero
-- financial access.
insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('20600000-0000-0000-0000-000000000001', '20500000-0000-0000-0000-000000000001', '20200000-0000-0000-0000-000000000001', true);

-- A1/A2: two active enrollments of Student A (BR-5 isolation between
-- them). B1: Student B, enrolled. L1 lead, C1 cancelled (ineligible).
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('20700000-0000-0000-0000-000000000001', '20300000-0000-0000-0000-000000000001', '20400000-0000-0000-0000-000000000001', '20500000-0000-0000-0000-000000000001', 1000.00, 1000.00, 1000.00, 'active'),
  ('20700000-0000-0000-0000-000000000002', '20300000-0000-0000-0000-000000000001', '20400000-0000-0000-0000-000000000001', '20500000-0000-0000-0000-000000000002', 500.00, 500.00, 500.00, 'active'),
  ('20700000-0000-0000-0000-000000000003', '20300000-0000-0000-0000-000000000002', '20400000-0000-0000-0000-000000000001', '20500000-0000-0000-0000-000000000001', 800.00, 800.00, 800.00, 'enrolled'),
  ('20700000-0000-0000-0000-000000000004', '20300000-0000-0000-0000-000000000001', '20400000-0000-0000-0000-000000000001', null, 1000.00, 1000.00, 1000.00, 'lead'),
  ('20700000-0000-0000-0000-000000000005', '20300000-0000-0000-0000-000000000001', '20400000-0000-0000-0000-000000000001', null, 1000.00, 1000.00, 1000.00, 'cancelled');

-- A plan + installment on B1 (used for the installment-integrity check).
insert into payment_plans (id, enrollment_id, total_amount) values
  ('20800000-0000-0000-0000-000000000001', '20700000-0000-0000-0000-000000000003', 800.00);
insert into installments (id, payment_plan_id, sequence, amount, due_date) values
  ('20900000-0000-0000-0000-000000000001', '20800000-0000-0000-0000-000000000001', 1, 800.00, current_date);

-- ---------------------------------------------------------------------------
-- Schema: policies removed, RPC grants, payment_code default.

do $$
declare
  n int;
begin
  select count(*) into n from pg_policies
   where tablename = 'payments' and cmd in ('INSERT', 'UPDATE', 'DELETE');
  if n <> 0 then
    raise exception 'FAIL: payments must have no INSERT/UPDATE/DELETE policy, found %', n;
  end if;
  if has_function_privilege('anon', 'record_offline_payment(uuid, uuid, numeric, text, text, date, text, text)', 'execute') then
    raise exception 'FAIL: anon must not be able to execute record_offline_payment';
  end if;
  if not has_function_privilege('authenticated', 'record_offline_payment(uuid, uuid, numeric, text, text, date, text, text)', 'execute') then
    raise exception 'FAIL: authenticated must be able to execute record_offline_payment';
  end if;
  raise notice 'PASS: payments has no end-user write policy; RPC executable by authenticated only';
end
$$;

-- ---------------------------------------------------------------------------
-- Admin records an offline payment.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  r record;
  p record;
  ist_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into r from record_offline_payment(
    '20a00000-0000-0000-0000-000000000001', '20700000-0000-0000-0000-000000000001',
    250.50, 'cash', 'partial', ist_today - 1, '  RCPT-BOOK-17  ', '  counter  ');
  if r.already_recorded then raise exception 'FAIL: first recording reported already_recorded'; end if;
  if r.recorded_payment_id <> '20a00000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: RPC returned a different payment id %', r.recorded_payment_id;
  end if;
  if r.recorded_payment_code !~ '^PAY-[0-9]{6,}$' then
    raise exception 'FAIL: payment_code % is not DB-generated PAY-nnnnnn', r.recorded_payment_code;
  end if;

  select * into p from payments where id = '20a00000-0000-0000-0000-000000000001';
  if p.status <> 'paid' or p.amount <> 250.50 or p.total_amount <> 250.50 or p.tax_amount <> 0 then
    raise exception 'FAIL: stored amounts/status wrong: % % % %', p.status, p.amount, p.total_amount, p.tax_amount;
  end if;
  if p.student_id <> '20300000-0000-0000-0000-000000000001'
     or p.enrollment_id <> '20700000-0000-0000-0000-000000000001'
     or p.installment_id is not null then
    raise exception 'FAIL: payment attached to the wrong student/enrollment/installment';
  end if;
  if p.created_by <> '20100000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: created_by must be the signed-in admin''s admins.id, got %', p.created_by;
  end if;
  if (p.paid_at at time zone 'Asia/Kolkata')::date <> ist_today - 1 then
    raise exception 'FAIL: paid_at must be the entered Asia/Kolkata day, got %', p.paid_at;
  end if;
  if p.method <> 'cash' or p.payment_type <> 'partial'
     or p.internal_reference <> 'RCPT-BOOK-17' or p.notes <> 'counter' then
    raise exception 'FAIL: method/type/reference/notes not stored as trimmed input';
  end if;
  raise notice 'PASS: admin records an offline payment with DB-derived student, admin, code and status';
end
$$;

do $$
declare
  r record;
  n int;
begin
  select * into r from record_offline_payment(
    '20a00000-0000-0000-0000-000000000001', '20700000-0000-0000-0000-000000000001',
    250.50, 'cash', 'partial', (now() at time zone 'Asia/Kolkata')::date - 1, null, null);
  if not r.already_recorded then
    raise exception 'FAIL: resubmitting the same payment id must be idempotent';
  end if;
  select count(*) into n from payments where enrollment_id = '20700000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: idempotent resubmission created % rows', n; end if;
  raise notice 'PASS: resubmitting the same payment form is idempotent';
end
$$;

do $$
begin
  perform record_offline_payment(
    '20a00000-0000-0000-0000-000000000001', '20700000-0000-0000-0000-000000000001',
    99.00, 'cash', 'partial', (now() at time zone 'Asia/Kolkata')::date, null, null);
  raise exception 'FAIL: reusing a payment id for a different payment was accepted';
exception when sqlstate 'P2003' then
  raise notice 'PASS: a payment id cannot be reused for a different payment';
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 14 parity: outstanding = max(0, payable - paid + processed refunds).
-- A processed refund (inserted by the database owner — Phase 21 scope)
-- raises A1's outstanding back; the RPC's ceiling must follow exactly.

reset role;
insert into payment_refunds (id, payment_id, amount, status) values
  ('20b00000-0000-0000-0000-000000000001', '20a00000-0000-0000-0000-000000000001', 50.50, 'processed'),
  ('20b00000-0000-0000-0000-000000000002', '20a00000-0000-0000-0000-000000000001', 10.00, 'initiated');
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
begin
  -- 1000.00 - 250.50 + 50.50 = 800.00 (the initiated refund does not count)
  perform record_offline_payment(
    '20a00000-0000-0000-0000-000000000002', '20700000-0000-0000-0000-000000000001',
    800.01, 'upi', 'partial', (now() at time zone 'Asia/Kolkata')::date, null, null);
  raise exception 'FAIL: an amount above the outstanding balance was accepted';
exception when sqlstate 'P2001' then
  raise notice 'PASS: overpayment (800.01 > outstanding 800.00) is blocked';
end
$$;

do $$
declare
  r record;
  n int;
begin
  select * into r from record_offline_payment(
    '20a00000-0000-0000-0000-000000000003', '20700000-0000-0000-0000-000000000002',
    500.00, 'bank_transfer', 'full', (now() at time zone 'Asia/Kolkata')::date, 'UTR123', null);
  if r.already_recorded then raise exception 'FAIL: exact-outstanding payment flagged already_recorded'; end if;
  -- A2 now has outstanding 0: even one paisa more is an overpayment.
  begin
    perform record_offline_payment(
      '20a00000-0000-0000-0000-000000000004', '20700000-0000-0000-0000-000000000002',
      0.01, 'cash', 'partial', (now() at time zone 'Asia/Kolkata')::date, null, null);
    raise exception 'FAIL: a payment against a fully paid enrollment was accepted';
  exception when sqlstate 'P2001' then null;
  end;
  -- BR-5: A2's payment never touched A1 (same student, other enrollment).
  select count(*) into n from payments
   where enrollment_id = '20700000-0000-0000-0000-000000000001' and status = 'paid';
  if n <> 1 then raise exception 'FAIL: A1 has % paid payments after paying A2', n; end if;
  raise notice 'PASS: paying exactly the outstanding is allowed, then any further amount is blocked; sibling enrollment untouched';
end
$$;

do $$
declare
  payable numeric;
  paid numeric;
  refunded numeric;
begin
  select total_payable into payable from enrollments where id = '20700000-0000-0000-0000-000000000001';
  select coalesce(sum(total_amount), 0) into paid from payments
   where enrollment_id = '20700000-0000-0000-0000-000000000001' and status = 'paid';
  select coalesce(sum(r.amount), 0) into refunded from payment_refunds r
    join payments p on p.id = r.payment_id
   where p.enrollment_id = '20700000-0000-0000-0000-000000000001' and r.status = 'processed';
  if greatest(0, payable - paid + refunded) <> 800.00 then
    raise exception 'FAIL: Phase 14 outstanding for A1 should be 800.00, got %', greatest(0, payable - paid + refunded);
  end if;
  raise notice 'PASS: the admin-visible Phase 14 inputs give outstanding 800.00 for A1';
end
$$;

-- ---------------------------------------------------------------------------
-- Invalid input and ineligible enrollments.

do $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  bad record;
  rejected int := 0;
begin
  for bad in
    select * from (values
      (0.00::numeric, 'cash', 'partial', today, null::text),
      (-1.00, 'cash', 'partial', today, null),
      (1.005, 'cash', 'partial', today, null),
      (null, 'cash', 'partial', today, null),
      (10.00, 'razorpay', 'partial', today, null),
      (10.00, 'other', 'partial', today, null),
      (10.00, 'cash', 'installment', today, null),
      (10.00, 'cash', 'refund', today, null),
      (10.00, 'cash', 'partial', today + 1, null),
      (10.00, 'cash', 'partial', null, null),
      (10.00, 'cash', 'partial', today, repeat('x', 101))
    ) as v(amount, method, ptype, paid_on, ref)
  loop
    begin
      perform record_offline_payment(
        gen_random_uuid(), '20700000-0000-0000-0000-000000000001',
        bad.amount, bad.method, bad.ptype, bad.paid_on, bad.ref, null);
      raise exception 'FAIL: invalid input accepted: % % % % ref_len=%',
        bad.amount, bad.method, bad.ptype, bad.paid_on, char_length(bad.ref);
    exception when sqlstate '22023' then
      rejected := rejected + 1;
    end;
  end loop;
  if rejected <> 11 then raise exception 'FAIL: expected 11 rejections, got %', rejected; end if;
  raise notice 'PASS: zero/negative/sub-paisa/null amounts, online/unknown methods, installment/unknown types, future/null dates and long references are rejected';
end
$$;

do $$
declare
  target uuid;
  rejected int := 0;
begin
  foreach target in array array[
    '20700000-0000-0000-0000-000000000004'::uuid,
    '20700000-0000-0000-0000-000000000005'::uuid
  ] loop
    begin
      perform record_offline_payment(
        gen_random_uuid(), target, 10.00, 'cash', 'partial',
        (now() at time zone 'Asia/Kolkata')::date, null, null);
      raise exception 'FAIL: payment accepted against ineligible enrollment %', target;
    exception when sqlstate 'P2002' then
      rejected := rejected + 1;
    end;
  end loop;
  begin
    perform record_offline_payment(
      gen_random_uuid(), '20799999-0000-0000-0000-000000000000', 10.00, 'cash', 'partial',
      (now() at time zone 'Asia/Kolkata')::date, null, null);
    raise exception 'FAIL: payment accepted against a nonexistent enrollment';
  exception when sqlstate 'P2004' then
    rejected := rejected + 1;
  end;
  if rejected <> 3 then raise exception 'FAIL: expected 3 eligibility rejections, got %', rejected; end if;
  raise notice 'PASS: lead, cancelled and nonexistent enrollments cannot receive an offline payment';
end
$$;

-- ---------------------------------------------------------------------------
-- FR-91: an Admin session cannot alter, delete or directly insert payments.

do $$
declare
  n int;
  p record;
begin
  update payments set amount = 1.00, total_amount = 1.00
   where id = '20a00000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin UPDATE changed % payment rows', n; end if;

  delete from payments where id = '20a00000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin DELETE removed % payment rows', n; end if;

  select * into p from payments where id = '20a00000-0000-0000-0000-000000000001';
  if p.amount <> 250.50 then raise exception 'FAIL: payment changed to %', p.amount; end if;

  begin
    insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, total_amount, method, status)
    values (gen_random_uuid(), 'PHASE20-DIRECT', '20300000-0000-0000-0000-000000000001',
            '20700000-0000-0000-0000-000000000001', 'partial', 5000.00, 5000.00, 'cash', 'paid');
    raise exception 'FAIL: admin direct INSERT into payments bypassed the RPC';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: Admin cannot UPDATE, DELETE or directly INSERT payments (RPC is the only write path)';
end
$$;

-- Super Admin records too.
set local "request.jwt.claims" to '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  r record;
  creator uuid;
begin
  select * into r from record_offline_payment(
    '20a00000-0000-0000-0000-000000000005', '20700000-0000-0000-0000-000000000003',
    100.00, 'cheque', 'registration', (now() at time zone 'Asia/Kolkata')::date, 'CHQ-000123', null);
  select created_by into creator from payments where id = r.recorded_payment_id;
  if creator <> '20100000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: super admin payment attributed to %', creator;
  end if;
  raise notice 'PASS: Super Admin records an offline payment attributed to themselves';
end
$$;

-- An admin role without an admins profile cannot record (no attributable recorder).
set local "request.jwt.claims" to '{"sub":"20000000-0000-0000-0000-000000000006","role":"authenticated"}';

do $$
begin
  perform record_offline_payment(
    gen_random_uuid(), '20700000-0000-0000-0000-000000000003', 1.00, 'cash', 'partial',
    (now() at time zone 'Asia/Kolkata')::date, null, null);
  raise exception 'FAIL: an admin without an admins profile recorded a payment';
exception when insufficient_privilege then
  raise notice 'PASS: an admin role with no admins profile cannot record a payment';
end
$$;

-- ---------------------------------------------------------------------------
-- Trainer: no financial read, no write path.

set local "request.jwt.claims" to '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  n int;
begin
  select count(*) into n from payments where id::text like '20a00000-%';
  if n <> 0 then raise exception 'FAIL: trainer read % payments', n; end if;
  begin
    perform record_offline_payment(
      gen_random_uuid(), '20700000-0000-0000-0000-000000000003', 1.00, 'cash', 'partial',
      (now() at time zone 'Asia/Kolkata')::date, null, null);
    raise exception 'FAIL: trainer recorded a payment';
  exception when insufficient_privilege then null;
  end;
  update payments set notes = 'trainer' where id = '20a00000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: trainer updated % payments', n; end if;
  delete from payments where id = '20a00000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: trainer deleted % payments', n; end if;
  raise notice 'PASS: an assigned Trainer cannot read, record, update or delete payments';
end
$$;

-- ---------------------------------------------------------------------------
-- Students: own rows only, no write path.

set local "request.jwt.claims" to '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  n int;
begin
  select count(*) into n from payments where id::text like '20a00000-%';
  if n <> 2 then raise exception 'FAIL: student A should read their own 2 payments, got %', n; end if;
  begin
    perform record_offline_payment(
      gen_random_uuid(), '20700000-0000-0000-0000-000000000001', 1.00, 'cash', 'partial',
      (now() at time zone 'Asia/Kolkata')::date, null, null);
    raise exception 'FAIL: student recorded a payment';
  exception when insufficient_privilege then null;
  end;
  update payments set amount = 0 where id = '20a00000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: student updated % payments', n; end if;
  begin
    insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, total_amount, method, status)
    values (gen_random_uuid(), 'PHASE20-STUDENT', '20300000-0000-0000-0000-000000000001',
            '20700000-0000-0000-0000-000000000001', 'partial', 999.00, 999.00, 'cash', 'paid');
    raise exception 'FAIL: student inserted a payment';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: Student A reads only their own payments and cannot record, update or insert';
end
$$;

set local "request.jwt.claims" to '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  n int;
begin
  select count(*) into n from payments where student_id = '20300000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL: student B read % of student A''s payments', n; end if;
  select count(*) into n from payments where id = '20a00000-0000-0000-0000-000000000005';
  if n <> 1 then raise exception 'FAIL: student B should read their own payment'; end if;
  raise notice 'PASS: Student B never reads Student A''s payments';
end
$$;

-- anon has no EXECUTE grant at all.
reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

do $$
begin
  perform record_offline_payment(
    gen_random_uuid(), '20700000-0000-0000-0000-000000000003', 1.00, 'cash', 'partial',
    (now() at time zone 'Asia/Kolkata')::date, null, null);
  raise exception 'FAIL: anon executed record_offline_payment';
exception when insufficient_privilege then
  raise notice 'PASS: anon cannot execute record_offline_payment';
end
$$;

-- ---------------------------------------------------------------------------
-- Triggers hold for a privileged writer (database owner).

reset role;

do $$
begin
  update payments set notes = 'edited' where id = '20a00000-0000-0000-0000-000000000001';
  raise exception 'FAIL: a paid payment was edited by the database owner';
exception when insufficient_privilege then
  raise notice 'PASS: a paid payment is frozen even for a privileged writer';
end
$$;

do $$
declare
  code text;
begin
  -- A pending (not-yet-settled) row stays updatable server-side; once it
  -- settles it is frozen. Also proves the payment_code DEFAULT.
  insert into payments (id, student_id, enrollment_id, payment_type, amount, total_amount, method, status)
  values ('20a00000-0000-0000-0000-000000000006', '20300000-0000-0000-0000-000000000002',
          '20700000-0000-0000-0000-000000000003', 'partial', 10.00, 10.00, 'razorpay', 'pending')
  returning payment_code into code;
  if code !~ '^PAY-[0-9]{6,}$' then raise exception 'FAIL: default payment_code %', code; end if;
  update payments set status = 'paid', paid_at = now() where id = '20a00000-0000-0000-0000-000000000006';
  begin
    update payments set status = 'cancelled' where id = '20a00000-0000-0000-0000-000000000006';
    raise exception 'FAIL: a settled payment could be cancelled';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: payment_code defaults to PAY-nnnnnn; pending rows settle once and are then frozen';
end
$$;

do $$
declare
  rejected int := 0;
begin
  begin
    insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, total_amount, method, status)
    values (gen_random_uuid(), 'PHASE20-X1', '20300000-0000-0000-0000-000000000002',
            '20700000-0000-0000-0000-000000000001', 'partial', 1.00, 1.00, 'cash', 'pending');
  exception when check_violation then rejected := rejected + 1;
  end;
  begin
    insert into payments (id, payment_code, student_id, enrollment_id, installment_id, payment_type, amount, total_amount, method, status)
    values (gen_random_uuid(), 'PHASE20-X2', '20300000-0000-0000-0000-000000000001',
            '20700000-0000-0000-0000-000000000001', '20900000-0000-0000-0000-000000000001',
            'installment', 1.00, 1.00, 'cash', 'pending');
  exception when check_violation then rejected := rejected + 1;
  end;
  if rejected <> 2 then raise exception 'FAIL: expected 2 integrity rejections, got %', rejected; end if;
  raise notice 'PASS: a payment cannot name another enrollment''s student or installment (BR-5)';
end
$$;

rollback;
