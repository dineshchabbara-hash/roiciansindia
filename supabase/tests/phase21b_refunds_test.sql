-- Phase 21B (Refunds) regression suite for 20260101000038_refund_workflow.sql:
--
--   - grants: record_offline_refund / reserve_razorpay_refund callable by
--     signed-in users but self-checked (Admin/Super Admin only);
--     apply_razorpay_refund_status / fail_unsent_razorpay_refund are
--     service_role only; payment_refunds has SELECT policies only.
--   - offline refunds: processed at once, partial/multiple/full, positive
--     amount, required reason, refund date not in the future and not before
--     the payment date, idempotent on the form id, never above the payment.
--   - Razorpay refunds: initiated reserves capacity without affecting
--     outstanding; processed is final and counts once; failed releases the
--     reservation; replays are no-ops; amount/currency/payment mismatches
--     and unknown refunds change nothing; provider refund id unique.
--   - D8 (option A): outstanding = payable - paid + processed refunds,
--     exactly once; payments, enrollments, installments and receipts are
--     never touched by a refund.
--   - RLS: Admin reads all; Student reads own only; Trainer and anon
--     nothing; no end-user role writes the ledger directly.
--
-- Concurrency across real connections: scripts/test-refund-concurrency.sh.
-- Ends with ROLLBACK.

begin;

insert into auth.users (id, email) values
  ('21b00000-0000-0000-0000-000000000001', 'phase21b-admin@validation.local'),
  ('21b00000-0000-0000-0000-000000000002', 'phase21b-trainer@validation.local'),
  ('21b00000-0000-0000-0000-000000000003', 'phase21b-student-a@validation.local'),
  ('21b00000-0000-0000-0000-000000000004', 'phase21b-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('21b00000-0000-0000-0000-000000000001', 'admin'),
  ('21b00000-0000-0000-0000-000000000002', 'trainer'),
  ('21b00000-0000-0000-0000-000000000003', 'student'),
  ('21b00000-0000-0000-0000-000000000004', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('21b10000-0000-0000-0000-000000000001', '21b00000-0000-0000-0000-000000000001', 'Phase21B', 'Admin', 'phase21b-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('21b20000-0000-0000-0000-000000000001', '21b00000-0000-0000-0000-000000000002', 'Phase21B', 'Trainer', 'phase21b-trainer@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('21b30000-0000-0000-0000-000000000001', '21b00000-0000-0000-0000-000000000003', 'Phase21B', 'StudentA', '9990021201', 'phase21b-student-a@validation.local'),
  ('21b30000-0000-0000-0000-000000000002', '21b00000-0000-0000-0000-000000000004', 'Phase21B', 'StudentB', '9990021202', 'phase21b-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('21b40000-0000-0000-0000-000000000001', 'PHASE21B-PROG', 'Phase 21B Program', 15000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('21b50000-0000-0000-0000-000000000001', '21b40000-0000-0000-0000-000000000001', 'Phase 21B Batch', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('21b60000-0000-0000-0000-000000000001', '21b50000-0000-0000-0000-000000000001', '21b20000-0000-0000-0000-000000000001', true);

-- A1 (Student A, payable 15000.00, with a plan), B1 (Student B, 3000.00).
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, discount_amount, discount_reason, total_payable, status) values
  ('21b70000-0000-0000-0000-000000000001', '21b30000-0000-0000-0000-000000000001', '21b40000-0000-0000-0000-000000000001', '21b50000-0000-0000-0000-000000000001', 16000.00, 16000.00, 1000.00, 'Early bird', 15000.00, 'active'),
  ('21b70000-0000-0000-0000-000000000002', '21b30000-0000-0000-0000-000000000002', '21b40000-0000-0000-0000-000000000001', '21b50000-0000-0000-0000-000000000001', 3000.00, 3000.00, 0, null, 3000.00, 'active');

insert into payment_plans (id, enrollment_id, total_amount) values
  ('21b80000-0000-0000-0000-0000000000a1', '21b70000-0000-0000-0000-000000000001', 15000.00);
insert into installments (id, payment_plan_id, sequence, amount, due_date) values
  ('21b80000-0000-0000-0000-0000000000b1', '21b80000-0000-0000-0000-0000000000a1', 1, 10000.00, current_date),
  ('21b80000-0000-0000-0000-0000000000b2', '21b80000-0000-0000-0000-0000000000a1', 2, 5000.00, current_date + 30);

-- Payments (seeded as the server would): O1 offline cash 10000 paid two
-- days ago; R1 Razorpay 5000 paid; H1 Razorpay held (authorized); OB
-- Student B offline 3000 paid.
insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, tax_amount, total_amount, method, status, created_by, paid_at) values
  ('21b90000-0000-0000-0000-000000000001', 'PAY-P21B-O1', '21b30000-0000-0000-0000-000000000001', '21b70000-0000-0000-0000-000000000001', 'partial', 10000.00, 0, 10000.00, 'cash', 'paid', '21b10000-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('21b90000-0000-0000-0000-000000000004', 'PAY-P21B-OB', '21b30000-0000-0000-0000-000000000002', '21b70000-0000-0000-0000-000000000002', 'full', 3000.00, 0, 3000.00, 'upi', 'paid', '21b10000-0000-0000-0000-000000000001', now() - interval '1 day');
insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, tax_amount, total_amount, method, status, razorpay_order_id, razorpay_payment_id, paid_at) values
  ('21b90000-0000-0000-0000-000000000002', 'PAY-P21B-R1', '21b30000-0000-0000-0000-000000000001', '21b70000-0000-0000-0000-000000000001', 'partial', 5000.00, 0, 5000.00, 'razorpay', 'paid', 'order_P21B_R1', 'pay_P21B_R1', now() - interval '1 day'),
  ('21b90000-0000-0000-0000-000000000003', 'PAY-P21B-H1', '21b30000-0000-0000-0000-000000000001', '21b70000-0000-0000-0000-000000000001', 'partial', 100.00, 0, 100.00, 'razorpay', 'authorized', 'order_P21B_H1', 'pay_P21B_H1', now());

-- A receipt for O1, issued before any refund (Phase 21A).
set local role service_role;
select issue_receipt('21b90000-0000-0000-0000-000000000001');
reset role;

create temporary table p21b_snapshot on commit drop as
select
  (select row_to_json(p)::text from payments p where p.id = '21b90000-0000-0000-0000-000000000001') as o1,
  (select row_to_json(p)::text from payments p where p.id = '21b90000-0000-0000-0000-000000000002') as r1,
  (select row_to_json(e)::text from enrollments e where e.id = '21b70000-0000-0000-0000-000000000001') as enr,
  (select json_agg(i order by i.sequence)::text from installments i where i.payment_plan_id = '21b80000-0000-0000-0000-0000000000a1') as inst,
  (select row_to_json(r)::text from receipts r where r.payment_id = '21b90000-0000-0000-0000-000000000001') as receipt;
grant select on p21b_snapshot to authenticated, service_role;

-- Phase 14 formula (D8 option A), for enrollment A1.
create or replace function pg_temp.p21b_outstanding() returns numeric language sql as $$
  select greatest(0, e.total_payable
    - coalesce((select sum(p.total_amount) from payments p where p.enrollment_id = e.id and p.status = 'paid'), 0)
    + coalesce((select sum(r.amount) from payment_refunds r join payments p on p.id = r.payment_id
                 where p.enrollment_id = e.id and r.status = 'processed'), 0))
  from enrollments e where e.id = '21b70000-0000-0000-0000-000000000001'
$$;

-- ---------------------------------------------------------------------------
-- Schema, grants, policies.

do $$
declare
  r text;
begin
  foreach r in array array['anon'] loop
    if has_function_privilege(r, 'record_offline_refund(uuid, uuid, numeric, text, date, text)', 'execute')
       or has_function_privilege(r, 'reserve_razorpay_refund(uuid, uuid, numeric, text)', 'execute') then
      raise exception 'FAIL: % must not execute the refund functions', r;
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_function_privilege(r, 'apply_razorpay_refund_status(uuid, text, text, bigint, text, text, text)', 'execute')
       or has_function_privilege(r, 'fail_unsent_razorpay_refund(uuid)', 'execute') then
      raise exception 'FAIL: % must not execute the provider refund functions', r;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'apply_razorpay_refund_status(uuid, text, text, bigint, text, text, text)', 'execute') then
    raise exception 'FAIL: service_role must execute apply_razorpay_refund_status';
  end if;
  if exists (select 1 from pg_policies where tablename = 'payment_refunds' and cmd <> 'SELECT') then
    raise exception 'FAIL: payment_refunds must have SELECT policies only';
  end if;
  if pg_temp.p21b_outstanding() <> 0 then
    raise exception 'FAIL: A1 should start fully paid, outstanding %', pg_temp.p21b_outstanding();
  end if;
  raise notice 'PASS: refund write functions are self-checked or service_role-only; payment_refunds has no end-user write policy';
end
$$;

-- ---------------------------------------------------------------------------
-- Offline refunds (Admin session).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21b00000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  r record;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into r from record_offline_refund('21bc0000-0000-0000-0000-000000000001',
    '21b90000-0000-0000-0000-000000000001', 2000.00, 'Course downgrade', today, 'UTR-1');
  if r.already_recorded then raise exception 'FAIL: first offline refund reported already_recorded'; end if;
  if not exists (select 1 from payment_refunds where id = r.refund_id and status = 'processed'
                   and amount = 2000.00 and refunded_on = today and reference = 'UTR-1'
                   and initiated_by = '21b10000-0000-0000-0000-000000000001' and processed_at is not null) then
    raise exception 'FAIL: offline refund row not recorded as processed with its details';
  end if;
  if pg_temp.p21b_outstanding() <> 2000.00 then
    raise exception 'FAIL: a processed ₹2000 refund must raise outstanding to 2000.00, got %', pg_temp.p21b_outstanding();
  end if;

  -- Same form resubmitted: no second refund.
  select * into r from record_offline_refund('21bc0000-0000-0000-0000-000000000001',
    '21b90000-0000-0000-0000-000000000001', 2000.00, 'Course downgrade', today, 'UTR-1');
  if not r.already_recorded then raise exception 'FAIL: resubmission must be idempotent'; end if;
  if (select count(*) from payment_refunds where payment_id = '21b90000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: resubmission created a second refund';
  end if;
  begin
    perform record_offline_refund('21bc0000-0000-0000-0000-000000000001',
      '21b90000-0000-0000-0000-000000000001', 1.00, 'x', today, null);
    raise exception 'FAIL: a refund id was reused for a different refund';
  exception when sqlstate 'P2103' then null;
  end;
  raise notice 'PASS: a partial offline refund is processed at once, raises outstanding by exactly its amount, and a resubmitted form is idempotent';
end
$$;

do $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- 8000.01 would exceed 10000 - 2000.
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 8000.01, 'Too much', today, null);
    raise exception 'FAIL: over-refund accepted';
  exception when sqlstate 'P2101' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 0, 'Zero', today, null);
    raise exception 'FAIL: zero refund accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', -5, 'Negative', today, null);
    raise exception 'FAIL: negative refund accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 1.001, 'Fraction', today, null);
    raise exception 'FAIL: sub-paisa refund accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 10, '   ', today, null);
    raise exception 'FAIL: blank reason accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 10, 'Future', today + 1, null);
    raise exception 'FAIL: future refund date accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 10, 'Too early', today - 3, null);
    raise exception 'FAIL: refund dated before the payment accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000002', 10, 'Online', today, null);
    raise exception 'FAIL: a Razorpay payment was refunded manually';
  exception when sqlstate 'P2102' then null;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-0000000000ff', 10, 'Unknown', today, null);
    raise exception 'FAIL: unknown payment accepted';
  exception when sqlstate 'P2104' then null;
  end;
  if pg_temp.p21b_outstanding() <> 2000.00 then
    raise exception 'FAIL: rejected refunds changed outstanding';
  end if;
  raise notice 'PASS: over-refund, zero/negative/sub-paisa amount, blank reason, future or pre-payment date, Razorpay payment and unknown payment are all refused';
end
$$;

do $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  -- The remaining 8000.00 exactly: a full refund of the rest.
  perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 8000.00, 'Withdrawal', today, null);
  if (select sum(amount) from payment_refunds where payment_id = '21b90000-0000-0000-0000-000000000001' and status = 'processed') <> 10000.00 then
    raise exception 'FAIL: multiple refunds should total the full payment';
  end if;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 0.01, 'Beyond', today, null);
    raise exception 'FAIL: refund beyond a fully refunded payment accepted';
  exception when sqlstate 'P2101' then null;
  end;
  if pg_temp.p21b_outstanding() <> 10000.00 then
    raise exception 'FAIL: full refund of O1 must make outstanding 10000.00, got %', pg_temp.p21b_outstanding();
  end if;
  raise notice 'PASS: multiple partial refunds can reach exactly the payment total and never beyond it';
end
$$;

-- ---------------------------------------------------------------------------
-- Razorpay refunds.

do $$
declare
  r record;
begin
  select * into r from reserve_razorpay_refund('21bc0000-0000-0000-0000-0000000000a1',
    '21b90000-0000-0000-0000-000000000002', 3000.00, 'Batch cancelled');
  if r.already_reserved or r.status <> 'initiated' or r.provider_payment_id <> 'pay_P21B_R1' then
    raise exception 'FAIL: reserve did not return the trusted provider payment id with an initiated row';
  end if;
  if pg_temp.p21b_outstanding() <> 10000.00 then
    raise exception 'FAIL: an initiated refund must not change outstanding';
  end if;
  -- Capacity is reserved: 3000 + 2500 > 5000.
  begin
    perform reserve_razorpay_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000002', 2500.00, 'Second');
    raise exception 'FAIL: reservation ignored an in-progress refund';
  exception when sqlstate 'P2101' then null;
  end;
  select * into r from reserve_razorpay_refund('21bc0000-0000-0000-0000-0000000000a1',
    '21b90000-0000-0000-0000-000000000002', 3000.00, 'Batch cancelled');
  if not r.already_reserved then raise exception 'FAIL: repeated reserve must be idempotent'; end if;
  begin
    perform reserve_razorpay_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000001', 1.00, 'Offline');
    raise exception 'FAIL: an offline payment was refunded through Razorpay';
  exception when sqlstate 'P2102' then null;
  end;
  begin
    perform reserve_razorpay_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000003', 10.00, 'Held');
    raise exception 'FAIL: a held (authorized) payment was refunded';
  exception when sqlstate 'P2102' then null;
  end;
  begin
    perform apply_razorpay_refund_status('21bc0000-0000-0000-0000-0000000000a1', 'pay_P21B_R1', 'rfnd_X', 300000, 'INR', 'processed', 'api');
    raise exception 'FAIL: Admin executed apply_razorpay_refund_status';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: a Razorpay refund reserves capacity as initiated (no outstanding effect), is idempotent, and only paid Razorpay payments qualify';
end
$$;

reset role;
set local role service_role;

do $$
declare
  r record;
  audits int;
begin
  -- Provider says pending: attach the id, stay initiated.
  select * into r from apply_razorpay_refund_status('21bc0000-0000-0000-0000-0000000000a1', 'pay_P21B_R1', 'rfnd_P21B_1', 300000, 'INR', 'pending', 'api');
  if r.outcome <> 'pending' then raise exception 'FAIL: pending outcome expected, got %', r.outcome; end if;
  if (select status from payment_refunds where id = '21bc0000-0000-0000-0000-0000000000a1') <> 'initiated'
     or (select razorpay_refund_id from payment_refunds where id = '21bc0000-0000-0000-0000-0000000000a1') <> 'rfnd_P21B_1' then
    raise exception 'FAIL: pending must attach the provider id and stay initiated';
  end if;

  -- Mismatches change nothing.
  select * into r from apply_razorpay_refund_status(null, 'pay_P21B_R1', 'rfnd_P21B_1', 299900, 'INR', 'processed', 'webhook');
  if r.outcome <> 'amount_mismatch' then raise exception 'FAIL: amount mismatch not detected (%)', r.outcome; end if;
  select * into r from apply_razorpay_refund_status(null, 'pay_P21B_R1', 'rfnd_P21B_1', 300000, 'USD', 'processed', 'webhook');
  if r.outcome <> 'amount_mismatch' then raise exception 'FAIL: currency mismatch not detected (%)', r.outcome; end if;
  select * into r from apply_razorpay_refund_status(null, 'pay_P21B_H1', 'rfnd_P21B_1', 300000, 'INR', 'processed', 'webhook');
  if r.outcome <> 'payment_mismatch' then raise exception 'FAIL: payment mismatch not detected (%)', r.outcome; end if;
  select * into r from apply_razorpay_refund_status(null, 'pay_P21B_R1', 'rfnd_NOT_OURS', 100, 'INR', 'processed', 'webhook');
  if r.outcome <> 'unknown_refund' then raise exception 'FAIL: unknown refund not detected (%)', r.outcome; end if;
  select * into r from apply_razorpay_refund_status(null, 'pay_UNKNOWN', 'rfnd_P21B_1', 300000, 'INR', 'processed', 'webhook');
  if r.outcome <> 'unknown_payment' then raise exception 'FAIL: unknown payment not detected (%)', r.outcome; end if;
  if (select status from payment_refunds where id = '21bc0000-0000-0000-0000-0000000000a1') <> 'initiated' then
    raise exception 'FAIL: a mismatch changed the refund';
  end if;

  -- Processed (webhook), then replayed: counted exactly once.
  select * into r from apply_razorpay_refund_status(null, 'pay_P21B_R1', 'rfnd_P21B_1', 300000, 'INR', 'processed', 'webhook');
  if r.outcome <> 'processed' then raise exception 'FAIL: processed outcome expected, got %', r.outcome; end if;
  select * into r from apply_razorpay_refund_status(null, 'pay_P21B_R1', 'rfnd_P21B_1', 300000, 'INR', 'processed', 'webhook');
  if r.outcome <> 'already_final' then raise exception 'FAIL: replay must be already_final, got %', r.outcome; end if;
  select * into r from apply_razorpay_refund_status(null, 'pay_P21B_R1', 'rfnd_P21B_1', 300000, 'INR', 'failed', 'webhook');
  if r.outcome <> 'conflict' then raise exception 'FAIL: processed -> failed must be a conflict, got %', r.outcome; end if;
  select count(*) into audits from audit_logs where entity_id = '21bc0000-0000-0000-0000-0000000000a1' and action = 'refund.processed';
  if audits <> 1 then raise exception 'FAIL: expected exactly one refund.processed audit row, got %', audits; end if;
  if pg_temp.p21b_outstanding() <> 13000.00 then
    raise exception 'FAIL: processed ₹3000 Razorpay refund must make outstanding 13000.00, got %', pg_temp.p21b_outstanding();
  end if;
  if (select refunded_on from payment_refunds where id = '21bc0000-0000-0000-0000-0000000000a1') is null then
    raise exception 'FAIL: processed Razorpay refund needs its refund date';
  end if;
  raise notice 'PASS: provider pending attaches the id; mismatches and unknown refunds change nothing; processed counts once; replays are no-ops; processed is final';
end
$$;

-- A failed provider refund releases its reservation; an unsent one can be
-- released; ids are unique.
reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21b00000-0000-0000-0000-000000000001","role":"authenticated"}';
select reserve_razorpay_refund('21bc0000-0000-0000-0000-0000000000a2', '21b90000-0000-0000-0000-000000000002', 2000.00, 'Second refund');
reset role;
set local role service_role;

do $$
declare
  r record;
begin
  select * into r from apply_razorpay_refund_status('21bc0000-0000-0000-0000-0000000000a2', 'pay_P21B_R1', 'rfnd_P21B_2', 200000, 'INR', 'failed', 'webhook');
  if r.outcome <> 'failed' then raise exception 'FAIL: failed outcome expected, got %', r.outcome; end if;
  if pg_temp.p21b_outstanding() <> 13000.00 then raise exception 'FAIL: a failed refund changed outstanding'; end if;
  if (select count(*) from audit_logs where entity_id = '21bc0000-0000-0000-0000-0000000000a2' and action = 'refund.failed') <> 1 then
    raise exception 'FAIL: expected one refund.failed audit row';
  end if;
  begin
    insert into payment_refunds (payment_id, amount, reason, razorpay_refund_id, status)
    values ('21b90000-0000-0000-0000-000000000002', 1.00, 'dup', 'rfnd_P21B_1', 'initiated');
    raise exception 'FAIL: duplicate provider refund id accepted';
  exception when unique_violation then null;
  end;
  raise notice 'PASS: a failed refund changes nothing financially and is audited once; provider refund ids are unique';
end
$$;

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21b00000-0000-0000-0000-000000000001","role":"authenticated"}';
-- 3000 processed + 0 in progress: 2000 is free again after the failure.
select reserve_razorpay_refund('21bc0000-0000-0000-0000-0000000000a3', '21b90000-0000-0000-0000-000000000002', 2000.00, 'Retry after failure');
reset role;
set local role service_role;

do $$
begin
  if not fail_unsent_razorpay_refund('21bc0000-0000-0000-0000-0000000000a3') then
    raise exception 'FAIL: an unsent initiated refund must be releasable';
  end if;
  if fail_unsent_razorpay_refund('21bc0000-0000-0000-0000-0000000000a3') then
    raise exception 'FAIL: releasing twice must be a no-op';
  end if;
  if fail_unsent_razorpay_refund('21bc0000-0000-0000-0000-0000000000a1') then
    raise exception 'FAIL: a processed refund must never be released';
  end if;
  raise notice 'PASS: a failed reservation releases capacity; fail_unsent only releases initiated refunds with no provider id';
end
$$;

-- ---------------------------------------------------------------------------
-- Ledger invariants for every writer (database owner / service_role).

reset role;
do $$
begin
  begin
    insert into payment_refunds (payment_id, amount, reason, status)
    values ('21b90000-0000-0000-0000-000000000002', 2000.01, 'Over cap', 'initiated');
    raise exception 'FAIL: direct insert beyond the payment total accepted';
  exception when check_violation then null;
  end;
  begin
    insert into payment_refunds (payment_id, amount, reason, status)
    values ('21b90000-0000-0000-0000-000000000003', 1.00, 'Held', 'initiated');
    raise exception 'FAIL: refund against a held payment accepted';
  exception when check_violation then null;
  end;
  begin
    insert into payment_refunds (payment_id, amount, reason, status)
    values ('21b90000-0000-0000-0000-000000000002', 0, 'Zero', 'initiated');
    raise exception 'FAIL: zero refund accepted directly';
  exception when check_violation then null;
  end;
  begin
    insert into payment_refunds (payment_id, amount, status)
    values ('21b90000-0000-0000-0000-000000000002', 1.00, 'initiated');
    raise exception 'FAIL: refund without a reason accepted';
  exception when check_violation or not_null_violation then null;
  end;
  begin
    update payment_refunds set amount = 1.00 where id = '21bc0000-0000-0000-0000-000000000001';
    raise exception 'FAIL: refund amount rewritten';
  exception when insufficient_privilege then null;
  end;
  begin
    update payment_refunds set status = 'failed', failed_at = now() where id = '21bc0000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: processed refund changed';
  exception when insufficient_privilege then null;
  end;
  begin
    update payment_refunds set razorpay_refund_id = 'rfnd_OTHER' where id = '21bc0000-0000-0000-0000-0000000000a1';
    raise exception 'FAIL: provider refund id rewritten';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: cap, eligibility, positive amount, required reason and immutability hold for every writer';
end
$$;

-- Nothing but the refund ledger changed: payments, enrollment, plan,
-- installments and the receipt are byte-for-byte as before.
do $$
declare
  snap record;
begin
  select * into snap from p21b_snapshot;
  if snap.o1 <> (select row_to_json(p)::text from payments p where p.id = '21b90000-0000-0000-0000-000000000001')
     or snap.r1 <> (select row_to_json(p)::text from payments p where p.id = '21b90000-0000-0000-0000-000000000002') then
    raise exception 'FAIL: a refund changed a payment row';
  end if;
  if snap.enr <> (select row_to_json(e)::text from enrollments e where e.id = '21b70000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: a refund changed the enrollment (payable / fee / discount)';
  end if;
  if snap.inst <> (select json_agg(i order by i.sequence)::text from installments i where i.payment_plan_id = '21b80000-0000-0000-0000-0000000000a1') then
    raise exception 'FAIL: a refund changed installments';
  end if;
  if snap.receipt <> (select row_to_json(r)::text from receipts r where r.payment_id = '21b90000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: a refund changed the original receipt';
  end if;
  if (select status from payments where id = '21b90000-0000-0000-0000-000000000001') <> 'paid' then
    raise exception 'FAIL: a fully refunded payment must stay paid';
  end if;
  raise notice 'PASS: refunds change only the refund ledger — payments stay paid and unchanged; payable, fee, discount, installments and the receipt are untouched';
end
$$;

-- ---------------------------------------------------------------------------
-- RLS / roles.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21b00000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  n int;
begin
  select count(*) into n from payment_refunds where payment_id::text like '21b90000-%';
  if n <> 5 then raise exception 'FAIL: admin should read 5 refunds, got %', n; end if;
  begin
    insert into payment_refunds (payment_id, amount, reason, status)
    values ('21b90000-0000-0000-0000-000000000004', 1.00, 'direct', 'processed');
    raise exception 'FAIL: admin inserted a refund directly';
  exception when insufficient_privilege or check_violation then null;
  end;
  update payment_refunds set reason = 'edited';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin updated % refunds directly', n; end if;
  delete from payment_refunds;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: admin deleted % refunds', n; end if;
  raise notice 'PASS: Admin reads every refund but writes only through the refund functions';
end
$$;

set local "request.jwt.claims" to '{"sub":"21b00000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if (select count(*) from payment_refunds) <> 5 then raise exception 'FAIL: student A should read own 5 refunds'; end if;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000004', 1.00, 'Self', (now() at time zone 'Asia/Kolkata')::date, null);
    raise exception 'FAIL: student recorded a refund';
  exception when insufficient_privilege then null;
  end;
  begin
    perform reserve_razorpay_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000002', 1.00, 'Self');
    raise exception 'FAIL: student initiated a refund';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: Student A reads own refunds only and cannot initiate any refund';
end
$$;

set local "request.jwt.claims" to '{"sub":"21b00000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if (select count(*) from payment_refunds) <> 0 then raise exception 'FAIL: student B read student A refunds'; end if;
  raise notice 'PASS: Student B never reads Student A refunds';
end
$$;

set local "request.jwt.claims" to '{"sub":"21b00000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if (select count(*) from payment_refunds) <> 0 then raise exception 'FAIL: trainer read refunds'; end if;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000004', 1.00, 'Trainer', (now() at time zone 'Asia/Kolkata')::date, null);
    raise exception 'FAIL: trainer recorded a refund';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: an assigned Trainer reads no refunds and cannot record one';
end
$$;

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $$
begin
  begin
    if (select count(*) from payment_refunds) <> 0 then raise exception 'FAIL: anon read refunds'; end if;
  exception when others then
    if sqlerrm not like 'permission denied%' then raise; end if;
  end;
  begin
    perform record_offline_refund(gen_random_uuid(), '21b90000-0000-0000-0000-000000000004', 1.00, 'Anon', current_date, null);
    raise exception 'FAIL: anon recorded a refund';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon reads no refunds and cannot record one';
end
$$;

rollback;
