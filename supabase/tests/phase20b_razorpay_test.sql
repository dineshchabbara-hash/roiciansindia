-- Phase 20B (Razorpay test-mode integration) regression suite for
-- 20260101000036_razorpay_online_payments.sql:
--
--   - register_razorpay_order / finalize_razorpay_payment are service_role
--     only: Student, Trainer, Admin and anon cannot execute either.
--   - payment_orders / razorpay_webhook_events: no end-user write path;
--     Admin reads all, a Student reads only their own orders, Trainer and
--     anon read nothing.
--   - register re-checks ownership, confirmed status, installment
--     ownership and the Phase 14 overpayment guard; one open order per
--     enrollment (older open orders are superseded).
--   - finalize: captured only; idempotent on the provider payment id;
--     exactly one paid ledger row per order (DB unique index); amount /
--     currency mismatch, a second capture on a paid order, an ineligible
--     enrollment or an amount above the current outstanding balance are
--     recorded as 'authorized' (held), never 'paid'; unknown orders write
--     nothing; one audit row per ledger row.
--   - Phase 14 parity: a recorded online payment moves outstanding by
--     exactly its amount; held rows do not; the ledger row is frozen
--     (Phase 20A trigger); offline recording still works and sees online
--     payments in its own guard.
--
-- End-user roles run as themselves (`authenticated` / `anon` + JWT claims);
-- server calls run as `service_role`, exactly as the app's service-role
-- client does. Ends with ROLLBACK.

begin;

insert into auth.users (id, email) values
  ('2b000000-0000-0000-0000-000000000001', 'phase20b-admin@validation.local'),
  ('2b000000-0000-0000-0000-000000000002', 'phase20b-trainer@validation.local'),
  ('2b000000-0000-0000-0000-000000000003', 'phase20b-student-a@validation.local'),
  ('2b000000-0000-0000-0000-000000000004', 'phase20b-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('2b000000-0000-0000-0000-000000000001', 'admin'),
  ('2b000000-0000-0000-0000-000000000002', 'trainer'),
  ('2b000000-0000-0000-0000-000000000003', 'student'),
  ('2b000000-0000-0000-0000-000000000004', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('2b100000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-000000000001', 'Phase20B', 'Admin', 'phase20b-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('2b200000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-000000000002', 'Phase20B', 'Trainer', 'phase20b-trainer@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('2b300000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-000000000003', 'Phase20B', 'StudentA', '9990021001', 'phase20b-student-a@validation.local'),
  ('2b300000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-000000000004', 'Phase20B', 'StudentB', '9990021002', 'phase20b-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('2b400000-0000-0000-0000-000000000001', 'PHASE20B-PROG', 'Phase 20B Program', 1000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('2b500000-0000-0000-0000-000000000001', '2b400000-0000-0000-0000-000000000001', 'Phase 20B Batch', current_date, 'active'),
  ('2b500000-0000-0000-0000-000000000002', '2b400000-0000-0000-0000-000000000001', 'Phase 20B Batch Two', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('2b600000-0000-0000-0000-000000000001', '2b500000-0000-0000-0000-000000000001', '2b200000-0000-0000-0000-000000000001', true);

-- A1: Student A, active, payable 1000.00 with a 2-line plan (400 + 600).
-- A2: Student A, active, payable 500.00 (no plan). B1: Student B,
-- enrolled, 800.00. L1: Student A, lead (ineligible).
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('2b700000-0000-0000-0000-000000000001', '2b300000-0000-0000-0000-000000000001', '2b400000-0000-0000-0000-000000000001', '2b500000-0000-0000-0000-000000000001', 1000.00, 1000.00, 1000.00, 'active'),
  ('2b700000-0000-0000-0000-000000000002', '2b300000-0000-0000-0000-000000000001', '2b400000-0000-0000-0000-000000000001', '2b500000-0000-0000-0000-000000000002', 500.00, 500.00, 500.00, 'active'),
  ('2b700000-0000-0000-0000-000000000003', '2b300000-0000-0000-0000-000000000002', '2b400000-0000-0000-0000-000000000001', '2b500000-0000-0000-0000-000000000001', 800.00, 800.00, 800.00, 'enrolled'),
  ('2b700000-0000-0000-0000-000000000004', '2b300000-0000-0000-0000-000000000001', '2b400000-0000-0000-0000-000000000001', null, 1000.00, 1000.00, 1000.00, 'lead');

insert into payment_plans (id, enrollment_id, total_amount) values
  ('2b800000-0000-0000-0000-000000000001', '2b700000-0000-0000-0000-000000000001', 1000.00),
  ('2b800000-0000-0000-0000-000000000003', '2b700000-0000-0000-0000-000000000003', 800.00);
insert into installments (id, payment_plan_id, sequence, amount, due_date) values
  ('2b900000-0000-0000-0000-000000000001', '2b800000-0000-0000-0000-000000000001', 1, 400.00, current_date),
  ('2b900000-0000-0000-0000-000000000002', '2b800000-0000-0000-0000-000000000001', 2, 600.00, current_date + 30),
  ('2b900000-0000-0000-0000-000000000003', '2b800000-0000-0000-0000-000000000003', 1, 800.00, current_date);

-- ---------------------------------------------------------------------------
-- Schema and grants.

do $$
declare
  fn text;
  r text;
begin
  foreach fn in array array[
    'register_razorpay_order(text, uuid, uuid, text, uuid, numeric, uuid, integer)',
    'finalize_razorpay_payment(text, text, bigint, text, text, timestamptz, text)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, fn, 'execute') then
        raise exception 'FAIL: % must not execute %', r, fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'FAIL: service_role must execute %', fn;
    end if;
  end loop;
  if exists (select 1 from pg_policies
              where tablename in ('payment_orders', 'razorpay_webhook_events')
                and cmd <> 'SELECT') then
    raise exception 'FAIL: payment_orders / razorpay_webhook_events must have SELECT policies only';
  end if;
  raise notice 'PASS: Razorpay functions are service_role-only; order/event tables have no end-user write policy';
end
$$;

-- ---------------------------------------------------------------------------
-- register_razorpay_order (as the server's service-role client).

set local role service_role;

do $$
declare
  o1 uuid;
  o2 uuid;
  n int;
begin
  -- next installment (400.00, installment 1) for A1
  o1 := register_razorpay_order('order_P20B_A1_1', '2b700000-0000-0000-0000-000000000001',
    '2b300000-0000-0000-0000-000000000001', 'next_installment',
    '2b900000-0000-0000-0000-000000000001', 400.00, '2b000000-0000-0000-0000-000000000003', 30);
  -- the Student switches to "pay full outstanding": the first open order is superseded
  o2 := register_razorpay_order('order_P20B_A1_2', '2b700000-0000-0000-0000-000000000001',
    '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 1000.00,
    '2b000000-0000-0000-0000-000000000003', 30);
  select count(*) into n from payment_orders
   where enrollment_id = '2b700000-0000-0000-0000-000000000001' and status = 'created';
  if n <> 1 then raise exception 'FAIL: expected exactly one open order, got %', n; end if;
  if (select status from payment_orders where id = o1) <> 'superseded' then
    raise exception 'FAIL: the earlier open order was not superseded';
  end if;
  if (select expires_at from payment_orders where id = o2) <= now() then
    raise exception 'FAIL: expires_at not in the future';
  end if;
  raise notice 'PASS: register records the server-created order; one open order per enrollment';
end
$$;

do $$
declare
  rejected int := 0;
begin
  begin -- reused provider order id
    perform register_razorpay_order('order_P20B_A1_2', '2b700000-0000-0000-0000-000000000002',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 500.00, null, 30);
  exception when unique_violation then rejected := rejected + 1;
  end;
  begin -- another student's enrollment
    perform register_razorpay_order('order_P20B_X1', '2b700000-0000-0000-0000-000000000003',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 800.00, null, 30);
  exception when insufficient_privilege then rejected := rejected + 1;
  end;
  begin -- ineligible (lead)
    perform register_razorpay_order('order_P20B_X2', '2b700000-0000-0000-0000-000000000004',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 100.00, null, 30);
  exception when sqlstate 'P2002' then rejected := rejected + 1;
  end;
  begin -- overpayment
    perform register_razorpay_order('order_P20B_X3', '2b700000-0000-0000-0000-000000000002',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 500.01, null, 30);
  exception when sqlstate 'P2001' then rejected := rejected + 1;
  end;
  begin -- installment of another enrollment's plan
    perform register_razorpay_order('order_P20B_X4', '2b700000-0000-0000-0000-000000000001',
      '2b300000-0000-0000-0000-000000000001', 'next_installment',
      '2b900000-0000-0000-0000-000000000003', 100.00, null, 30);
  exception when check_violation then rejected := rejected + 1;
  end;
  begin -- zero / sub-paisa amount
    perform register_razorpay_order('order_P20B_X5', '2b700000-0000-0000-0000-000000000002',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 0.005, null, 30);
  exception when sqlstate '22023' then rejected := rejected + 1;
  end;
  begin -- unknown purpose
    perform register_razorpay_order('order_P20B_X6', '2b700000-0000-0000-0000-000000000002',
      '2b300000-0000-0000-0000-000000000001', 'tip', null, 10.00, null, 30);
  exception when sqlstate '22023' then rejected := rejected + 1;
  end;
  if rejected <> 7 then raise exception 'FAIL: expected 7 register rejections, got %', rejected; end if;
  raise notice 'PASS: register rejects reused order ids, cross-student enrollments, ineligible enrollments, overpayment, foreign installments and invalid input';
end
$$;

-- ---------------------------------------------------------------------------
-- finalize_razorpay_payment.

do $$
declare
  r record;
  n int;
begin
  select * into r from finalize_razorpay_payment('order_P20B_A1_2', 'pay_P20B_1', 100000, 'INR',
    'captured', now(), 'checkout');
  if r.outcome <> 'recorded' or r.payment_code !~ '^PAY-[0-9]{6,}$' then
    raise exception 'FAIL: first finalize should record, got % %', r.outcome, r.payment_code;
  end if;
  perform 1 from payments p
   where p.id = r.payment_id and p.status = 'paid' and p.method = 'razorpay'
     and p.amount = 1000.00 and p.total_amount = 1000.00 and p.tax_amount = 0
     and p.payment_type = 'full' and p.installment_id is null and p.created_by is null
     and p.student_id = '2b300000-0000-0000-0000-000000000001'
     and p.enrollment_id = '2b700000-0000-0000-0000-000000000001'
     and p.razorpay_order_id = 'order_P20B_A1_2' and p.razorpay_payment_id = 'pay_P20B_1'
     and p.razorpay_signature is null;
  if not found then raise exception 'FAIL: recorded ledger row has wrong values'; end if;
  if (select status from payment_orders where provider_order_id = 'order_P20B_A1_2') <> 'paid' then
    raise exception 'FAIL: order not marked paid';
  end if;

  -- callback + webhook (any order): the same payment id is a no-op
  select * into r from finalize_razorpay_payment('order_P20B_A1_2', 'pay_P20B_1', 100000, 'INR',
    'captured', now(), 'webhook');
  if r.outcome <> 'already_recorded' then raise exception 'FAIL: repeat finalize got %', r.outcome; end if;
  select count(*) into n from payments where razorpay_payment_id = 'pay_P20B_1';
  if n <> 1 then raise exception 'FAIL: % ledger rows for one provider payment', n; end if;
  select count(*) into n from audit_logs a join payments p on p.id = a.entity_id
   where p.razorpay_payment_id = 'pay_P20B_1';
  if n <> 1 then raise exception 'FAIL: % audit rows for one provider payment', n; end if;
  if not exists (select 1 from audit_logs a join payments p on p.id = a.entity_id
                  where p.razorpay_payment_id = 'pay_P20B_1'
                    and a.action = 'payment.recorded_online' and a.actor_role = 'system'
                    and a.after_data->>'source' = 'checkout'
                    and not (a.after_data ? 'signature')) then
    raise exception 'FAIL: audit row missing or wrong';
  end if;
  raise notice 'PASS: captured payment recorded once as paid; repeated callback/webhook is idempotent; audited once';
end
$$;

do $$
declare
  r record;
begin
  -- a second captured payment on the already-paid order -> held, never a second paid row
  select * into r from finalize_razorpay_payment('order_P20B_A1_2', 'pay_P20B_2', 100000, 'INR',
    'captured', now(), 'webhook');
  if r.outcome <> 'held' then raise exception 'FAIL: second capture on paid order got %', r.outcome; end if;
  if (select status from payments where id = r.payment_id) <> 'authorized' then
    raise exception 'FAIL: second capture must be stored as authorized (held)';
  end if;
  if (select notes from payments where id = r.payment_id) not like 'Held for review:%' then
    raise exception 'FAIL: held row lacks its review note';
  end if;

  -- the superseded first order captured later: A1 is now fully paid -> exceeds outstanding -> held
  select * into r from finalize_razorpay_payment('order_P20B_A1_1', 'pay_P20B_3', 40000, 'INR',
    'captured', now(), 'webhook');
  if r.outcome <> 'held' then raise exception 'FAIL: stale order capture got %', r.outcome; end if;

  -- unknown order: nothing written
  select * into r from finalize_razorpay_payment('order_P20B_UNKNOWN', 'pay_P20B_4', 100, 'INR',
    'captured', now(), 'webhook');
  if r.outcome <> 'unknown_order' or r.payment_id is not null then
    raise exception 'FAIL: unknown order should write nothing';
  end if;
  if exists (select 1 from payments where razorpay_payment_id = 'pay_P20B_4') then
    raise exception 'FAIL: unknown order created a ledger row';
  end if;
  raise notice 'PASS: second capture and stale-order capture are held (authorized), unknown orders write nothing';
end
$$;

do $$
declare
  r record;
  rejected int := 0;
begin
  perform register_razorpay_order('order_P20B_A2_1', '2b700000-0000-0000-0000-000000000002',
    '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 500.00, null, 30);

  -- amount differs from the order -> held
  select * into r from finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_5', 49999, 'INR',
    'captured', now(), 'webhook');
  if r.outcome <> 'held' then raise exception 'FAIL: amount mismatch got %', r.outcome; end if;
  -- currency differs -> held
  select * into r from finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_6', 50000, 'USD',
    'captured', now(), 'webhook');
  if r.outcome <> 'held' then raise exception 'FAIL: currency mismatch got %', r.outcome; end if;

  begin -- not captured
    perform finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_7', 50000, 'INR',
      'authorized', now(), 'checkout');
  exception when sqlstate '22023' then rejected := rejected + 1;
  end;
  begin -- failed
    perform finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_8', 50000, 'INR',
      'failed', now(), 'webhook');
  exception when sqlstate '22023' then rejected := rejected + 1;
  end;
  begin -- unknown source
    perform finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_9', 50000, 'INR',
      'captured', now(), 'browser');
  exception when sqlstate '22023' then rejected := rejected + 1;
  end;
  if rejected <> 3 then raise exception 'FAIL: expected 3 rejections, got %', rejected; end if;
  if exists (select 1 from payments where razorpay_payment_id in ('pay_P20B_7','pay_P20B_8','pay_P20B_9')) then
    raise exception 'FAIL: a non-captured payment wrote a ledger row';
  end if;

  -- the matching capture is recorded
  select * into r from finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_10', 50000, 'INR',
    'captured', now(), 'checkout');
  if r.outcome <> 'recorded' then raise exception 'FAIL: matching capture got %', r.outcome; end if;
  raise notice 'PASS: amount/currency mismatches are held; authorized/failed payments and unknown sources write nothing';
end
$$;

do $$
declare
  r record;
begin
  -- ineligible enrollment at capture time: B1 order, then B1 cancelled
  perform register_razorpay_order('order_P20B_B1_1', '2b700000-0000-0000-0000-000000000003',
    '2b300000-0000-0000-0000-000000000002', 'next_installment',
    '2b900000-0000-0000-0000-000000000003', 800.00, null, 30);
  reset role;
  update enrollments set status = 'cancelled' where id = '2b700000-0000-0000-0000-000000000003';
  set local role service_role;
  select * into r from finalize_razorpay_payment('order_P20B_B1_1', 'pay_P20B_11', 80000, 'INR',
    'captured', now(), 'webhook');
  if r.outcome <> 'held' then raise exception 'FAIL: ineligible enrollment got %', r.outcome; end if;
  raise notice 'PASS: a capture against a no-longer-eligible enrollment is held';
end
$$;

-- DB-level guarantee: one paid row per Razorpay order, whatever the writer.
reset role;

do $$
begin
  insert into payments (student_id, enrollment_id, payment_type, amount, total_amount, method, status,
                        razorpay_order_id, razorpay_payment_id)
  values ('2b300000-0000-0000-0000-000000000001', '2b700000-0000-0000-0000-000000000001', 'full',
          1.00, 1.00, 'razorpay', 'paid', 'order_P20B_A1_2', 'pay_P20B_DIRECT');
  raise exception 'FAIL: a second paid row for one Razorpay order was accepted';
exception when unique_violation then
  raise notice 'PASS: the database rejects a second paid row for the same Razorpay order';
end
$$;

do $$
begin
  update payments set amount = 1.00 where razorpay_payment_id = 'pay_P20B_1';
  raise exception 'FAIL: a recorded online payment was edited';
exception when insufficient_privilege then
  raise notice 'PASS: a recorded online payment is frozen (Phase 20A trigger)';
end
$$;

-- ---------------------------------------------------------------------------
-- Phase 14 parity and Phase 20A coexistence.

do $$
declare
  a1 numeric;
  a2 numeric;
begin
  select greatest(0, e.total_payable
           - coalesce((select sum(p.total_amount) from payments p where p.enrollment_id = e.id and p.status = 'paid'), 0)
           + coalesce((select sum(r.amount) from payment_refunds r join payments p on p.id = r.payment_id
                        where p.enrollment_id = e.id and r.status = 'processed'), 0))
    into a1 from enrollments e where e.id = '2b700000-0000-0000-0000-000000000001';
  select greatest(0, e.total_payable
           - coalesce((select sum(p.total_amount) from payments p where p.enrollment_id = e.id and p.status = 'paid'), 0))
    into a2 from enrollments e where e.id = '2b700000-0000-0000-0000-000000000002';
  if a1 <> 0 or a2 <> 0 then
    raise exception 'FAIL: outstanding after online payments should be 0/0, got %/%', a1, a2;
  end if;
  if (select count(*) from payments where enrollment_id in ('2b700000-0000-0000-0000-000000000001','2b700000-0000-0000-0000-000000000002') and status = 'paid') <> 2 then
    raise exception 'FAIL: held rows must not count as paid';
  end if;
  raise notice 'PASS: online payments move the Phase 14 outstanding by exactly their amount; held rows do not count';
end
$$;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"2b000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  n int;
begin
  -- offline recording is unaffected and its guard sees the online payment
  begin
    perform record_offline_payment(gen_random_uuid(), '2b700000-0000-0000-0000-000000000001',
      1.00, 'cash', 'partial', (now() at time zone 'Asia/Kolkata')::date, null, null);
    raise exception 'FAIL: offline payment accepted on a fully paid enrollment';
  exception when sqlstate 'P2001' then null;
  end;
  select count(*) into n from payment_orders where provider_order_id like 'order_P20B_%';
  if n <> 4 then raise exception 'FAIL: admin should read all 4 orders, got %', n; end if;
  raise notice 'PASS: offline recording still enforces the shared overpayment guard; Admin reads all orders';
end
$$;

do $$
begin
  begin
    perform finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_ADMIN', 50000, 'INR', 'captured', now(), 'checkout');
    raise exception 'FAIL: admin executed finalize';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into payment_orders (provider_order_id, enrollment_id, student_id, purpose, amount, expires_at)
    values ('order_P20B_ADMIN', '2b700000-0000-0000-0000-000000000002', '2b300000-0000-0000-0000-000000000001', 'full_outstanding', 1.00, now());
    raise exception 'FAIL: admin inserted a payment order';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: Admin cannot finalize or forge an order through the database';
end
$$;

-- Student A: own orders only, no write/finalize path.
set local "request.jwt.claims" to '{"sub":"2b000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  n int;
  u int;
begin
  select count(*) into n from payment_orders where student_id <> '2b300000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL: student A read % foreign orders', n; end if;
  select count(*) into n from payment_orders;
  if n <> 3 then raise exception 'FAIL: student A should read own 3 orders, got %', n; end if;
  select count(*) into n from razorpay_webhook_events;
  if n <> 0 then raise exception 'FAIL: student read webhook events'; end if;
  update payment_orders set amount = 1.00, status = 'paid';
  get diagnostics u = row_count;
  if u <> 0 then raise exception 'FAIL: student updated % orders', u; end if;
  begin
    perform register_razorpay_order('order_P20B_STU', '2b700000-0000-0000-0000-000000000002',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 1.00, null, 30);
    raise exception 'FAIL: student executed register';
  exception when insufficient_privilege then null;
  end;
  begin
    perform finalize_razorpay_payment('order_P20B_A2_1', 'pay_P20B_STU', 50000, 'INR', 'captured', now(), 'checkout');
    raise exception 'FAIL: student executed finalize';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: Student reads only own orders and cannot register, update or finalize';
end
$$;

-- Student B / Trainer / anon.
set local "request.jwt.claims" to '{"sub":"2b000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if (select count(*) from payment_orders where student_id = '2b300000-0000-0000-0000-000000000001') <> 0 then
    raise exception 'FAIL: student B read student A orders';
  end if;
  raise notice 'PASS: Student B never reads Student A orders';
end
$$;

set local "request.jwt.claims" to '{"sub":"2b000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if (select count(*) from payment_orders) <> 0 or (select count(*) from razorpay_webhook_events) <> 0
     or (select count(*) from payments where method = 'razorpay') <> 0 then
    raise exception 'FAIL: trainer read Razorpay data';
  end if;
  begin
    perform register_razorpay_order('order_P20B_TR', '2b700000-0000-0000-0000-000000000002',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 1.00, null, 30);
    raise exception 'FAIL: trainer executed register';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: an assigned Trainer reads no orders, events or online payments and cannot register';
end
$$;

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $$
begin
  -- Same convention as phase19_reports_test.sql: anon either gets zero rows
  -- or a permission-denied error from the policy helper — both are denial.
  begin
    if (select count(*) from payment_orders) <> 0 then raise exception 'FAIL: anon read orders'; end if;
  exception when others then
    if sqlerrm not like 'permission denied%' then raise; end if;
  end;
  begin
    if (select count(*) from razorpay_webhook_events) <> 0 then raise exception 'FAIL: anon read events'; end if;
  exception when others then
    if sqlerrm not like 'permission denied%' then raise; end if;
  end;
  begin
    perform register_razorpay_order('order_P20B_ANON', '2b700000-0000-0000-0000-000000000002',
      '2b300000-0000-0000-0000-000000000001', 'full_outstanding', null, 1.00, null, 30);
    raise exception 'FAIL: anon executed register';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon reads nothing and cannot register an order';
end
$$;

rollback;
