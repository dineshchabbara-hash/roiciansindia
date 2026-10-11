-- Phase 20B (Razorpay test-mode integration). Online payment is a second
-- entry channel into the SAME canonical `payments` ledger Phase 20A built
-- (FR-92, FR-93, BR-6, SEC-5, SEC-6). A read-only review of the dev project
-- found nothing to hold a Razorpay order before money is captured, nothing
-- to deduplicate webhook deliveries, and nothing at the database level
-- preventing two paid ledger rows for one Razorpay order. This migration
-- adds exactly that, and nothing else:
--
--  1. `payment_orders` — one row per Razorpay Order the server created for
--     an enrollment (the payment INTENT). It is NOT a ledger: Phase 14 and
--     every report keep reading `payments` only. A ledger row is written
--     only when Razorpay reports the payment captured, so abandoned or
--     failed checkouts never touch `payments` (no pending ledger noise, no
--     consumed payment codes) and Phase 20A's immutability rules apply to
--     every online payment from the moment it exists. `provider_order_id`
--     is unique, so an order can never be re-mapped to another enrollment;
--     at most one order per enrollment is open (`created`) at a time.
--
--  2. `razorpay_webhook_events` — the delivery log keyed by Razorpay's
--     event id (x-razorpay-event-id), for replay detection and support. It
--     stores ids, type and outcome only — never the payload, signature or
--     any payment-instrument data.
--
--  3. `payments_razorpay_order_paid_unique` — at most one PAID ledger row
--     per Razorpay order. Together with the existing unique
--     `razorpay_payment_id` index this makes duplicate finalization
--     impossible at the database level, whatever the application does.
--
--  4. `register_razorpay_order()` and `finalize_razorpay_payment()` —
--     SECURITY DEFINER, EXECUTE for service_role ONLY. End users never call
--     them: the server (after authenticating the Student and, for
--     finalization, verifying Razorpay's HMAC signature and the payment's
--     captured status with Razorpay itself) calls them with the
--     service-role client. A Student therefore has no path to register an
--     order, choose an amount, or mark anything paid.
--
-- Business rules (REQUIREMENTS FR-43/FR-92, Phase 20A D9, Phase 20B
-- checkpoint): the Student initiates payment for their own confirmed
-- enrollment; the amount is server-derived — the next unpaid installment's
-- uncovered remainder (oldest-first coverage, computed at order time, see
-- lib/domain/online-payments.ts) or the full outstanding balance; payments
-- stay enrollment-level (installment_id is never set on the ledger row;
-- payment_orders.installment_id only records which installment the amount
-- was derived from). Overpayment is never recorded as paid.
--
-- Finalization never discards captured money: a captured payment that
-- cannot be accepted as paid (amount/currency differs from the order, the
-- order already has a paid payment, the enrollment is no longer eligible,
-- or the amount now exceeds the outstanding balance — e.g. an offline
-- payment was recorded meanwhile) is written as status 'authorized' with a
-- "Held for review" note. 'authorized' rows are not financial truth (Phase
-- 14 counts status 'paid' only) and are resolved in Phase 21 (refund). This
-- is API_AND_INTEGRATIONS.md §2.5 step 4b's documented hold behaviour.
--
-- No refund, receipt or email behaviour is added. Migrations 1–35 are
-- untouched.

-- 1. payment_orders --------------------------------------------------------

create table if not exists payment_orders (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'razorpay' check (provider = 'razorpay'),
  provider_order_id text not null unique,
  enrollment_id uuid not null references enrollments (id) on delete restrict,
  student_id uuid not null references students (id) on delete restrict,
  purpose text not null check (purpose in ('next_installment', 'full_outstanding')),
  installment_id uuid references installments (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created'
    check (status in ('created', 'superseded', 'paid', 'held')),
  payment_id uuid unique references payments (id) on delete restrict,
  created_by_auth_user_id uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table payment_orders is
  'Phase 20B: Razorpay Orders created server-side for an enrollment (payment intents). Not a ledger — financial truth stays in payments. Written only by register_razorpay_order()/finalize_razorpay_payment() (service_role).';

create trigger payment_orders_set_updated_at
  before update on payment_orders
  for each row execute function set_updated_at();

create index if not exists payment_orders_enrollment_idx on payment_orders (enrollment_id);
create index if not exists payment_orders_student_idx on payment_orders (student_id);
create unique index if not exists payment_orders_one_open_per_enrollment
  on payment_orders (enrollment_id) where status = 'created';

alter table payment_orders enable row level security;

create policy payment_orders_select_admin on payment_orders
  for select using (is_admin_or_super());

create policy payment_orders_select_own on payment_orders
  for select using (student_id = current_student_id());

-- 2. razorpay_webhook_events ------------------------------------------------

create table if not exists razorpay_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  provider_order_id text,
  provider_payment_id text,
  outcome text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table razorpay_webhook_events is
  'Phase 20B: Razorpay webhook delivery log keyed by x-razorpay-event-id (replay detection). Ids, type and outcome only — no payload, signature or instrument data. Written by the webhook route via service_role.';

create index if not exists razorpay_webhook_events_payment_idx
  on razorpay_webhook_events (provider_payment_id);

alter table razorpay_webhook_events enable row level security;

create policy razorpay_webhook_events_select_admin on razorpay_webhook_events
  for select using (is_admin_or_super());

-- 3. One paid ledger row per Razorpay order ---------------------------------

create unique index if not exists payments_razorpay_order_paid_unique
  on payments (razorpay_order_id)
  where status = 'paid' and razorpay_order_id is not null;

-- 4a. register_razorpay_order -------------------------------------------------

create or replace function register_razorpay_order(
  p_provider_order_id text,
  p_enrollment_id uuid,
  p_student_id uuid,
  p_purpose text,
  p_installment_id uuid,
  p_amount numeric,
  p_created_by_auth_user_id uuid,
  p_ttl_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  enr record;
  paid_sum numeric;
  refunded_sum numeric;
  outstanding numeric;
  new_id uuid;
begin
  if p_provider_order_id is null or btrim(p_provider_order_id) = ''
     or p_enrollment_id is null or p_student_id is null then
    raise exception using errcode = '22023', message = 'Order, enrollment and student are required';
  end if;
  if p_purpose is null or p_purpose not in ('next_installment', 'full_outstanding') then
    raise exception using errcode = '22023', message = 'Unknown online payment purpose';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_amount > 9999999999.99 then
    raise exception using errcode = '22023', message = 'Amount must be a positive rupee value with at most 2 decimal places';
  end if;
  if p_ttl_minutes is null or p_ttl_minutes < 1 or p_ttl_minutes > 1440 then
    raise exception using errcode = '22023', message = 'Order lifetime must be between 1 and 1440 minutes';
  end if;

  select e.id, e.student_id, e.status, e.total_payable
    into enr
    from enrollments e
   where e.id = p_enrollment_id
   for update;
  if enr.id is null then
    raise exception using errcode = 'P2004', message = 'Enrollment not found';
  end if;
  if enr.student_id <> p_student_id then
    raise exception using errcode = '42501', message = 'Enrollment does not belong to this student';
  end if;
  if enr.status not in ('enrolled', 'active', 'on_hold', 'completed') then
    raise exception using errcode = 'P2002', message = 'Online payment is only available for a confirmed enrollment';
  end if;
  if p_installment_id is not null and not exists (
    select 1 from installments i
      join payment_plans pp on pp.id = i.payment_plan_id
     where i.id = p_installment_id and pp.enrollment_id = p_enrollment_id
  ) then
    raise exception using errcode = '23514', message = 'Installment does not belong to this enrollment';
  end if;

  -- Same Phase 14 overpayment guard as record_offline_payment().
  select coalesce(sum(p.total_amount), 0) into paid_sum
    from payments p
   where p.enrollment_id = p_enrollment_id and p.status = 'paid';
  select coalesce(sum(r.amount), 0) into refunded_sum
    from payment_refunds r
    join payments p on p.id = r.payment_id
   where p.enrollment_id = p_enrollment_id and r.status = 'processed';
  outstanding := greatest(0, enr.total_payable - paid_sum + refunded_sum);
  if p_amount > outstanding then
    raise exception using
      errcode = 'P2001',
      message = format('Amount exceeds the outstanding balance of %s', to_char(outstanding, 'FM9999999999990.00'));
  end if;

  -- Only one open order per enrollment: an earlier open order (another
  -- tab, a changed amount, the other purpose) is superseded. A payment
  -- still captured against it is finalized on its own merits.
  update payment_orders
     set status = 'superseded'
   where enrollment_id = p_enrollment_id and status = 'created';

  insert into payment_orders (
    provider_order_id, enrollment_id, student_id, purpose, installment_id,
    amount, currency, status, created_by_auth_user_id, expires_at
  ) values (
    btrim(p_provider_order_id), p_enrollment_id, p_student_id, p_purpose, p_installment_id,
    p_amount, 'INR', 'created', p_created_by_auth_user_id,
    now() + make_interval(mins => p_ttl_minutes)
  )
  returning id into new_id;

  return new_id;
end;
$$;

comment on function register_razorpay_order(text, uuid, uuid, text, uuid, numeric, uuid, integer) is
  'Phase 20B: records a Razorpay Order the server created. service_role only. Re-checks enrollment ownership, confirmed status, installment ownership and the Phase 14 overpayment guard under an enrollment row lock; supersedes any other open order for the enrollment.';

revoke execute on function register_razorpay_order(text, uuid, uuid, text, uuid, numeric, uuid, integer) from public, anon, authenticated;
grant execute on function register_razorpay_order(text, uuid, uuid, text, uuid, numeric, uuid, integer) to service_role;

-- 4b. finalize_razorpay_payment -----------------------------------------------

create or replace function finalize_razorpay_payment(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_currency text,
  p_provider_status text,
  p_paid_at timestamptz,
  p_source text
)
returns table (payment_id uuid, payment_code text, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ord record;
  enr record;
  existing record;
  paid_sum numeric;
  refunded_sum numeric;
  outstanding numeric;
  amount_rupees numeric;
  hold_reason text;
  new_id uuid;
  new_code text;
begin
  if p_source is null or p_source not in ('checkout', 'webhook') then
    raise exception using errcode = '22023', message = 'Unknown finalization source';
  end if;
  if p_provider_payment_id is null or btrim(p_provider_payment_id) = ''
     or p_provider_order_id is null or btrim(p_provider_order_id) = '' then
    raise exception using errcode = '22023', message = 'Provider order and payment ids are required';
  end if;
  if p_provider_status is distinct from 'captured' then
    raise exception using errcode = '22023', message = 'Only a captured payment can be finalized';
  end if;
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception using errcode = '22023', message = 'Provider amount must be positive';
  end if;

  select o.* into ord from payment_orders o where o.provider_order_id = p_provider_order_id;
  if ord.id is null then
    return query select null::uuid, null::text, 'unknown_order'::text;
    return;
  end if;

  -- Serialize with offline recording and every other finalization for this
  -- enrollment (record_offline_payment locks the same row).
  select e.id, e.status, e.total_payable into enr
    from enrollments e where e.id = ord.enrollment_id for update;
  select o.* into ord from payment_orders o where o.id = ord.id for update;

  select p.id, p.payment_code into existing
    from payments p where p.razorpay_payment_id = p_provider_payment_id;
  if existing.id is not null then
    return query select existing.id, existing.payment_code, 'already_recorded'::text;
    return;
  end if;

  amount_rupees := p_amount_paise::numeric / 100;

  select coalesce(sum(p.total_amount), 0) into paid_sum
    from payments p
   where p.enrollment_id = ord.enrollment_id and p.status = 'paid';
  select coalesce(sum(r.amount), 0) into refunded_sum
    from payment_refunds r
    join payments p on p.id = r.payment_id
   where p.enrollment_id = ord.enrollment_id and r.status = 'processed';
  outstanding := greatest(0, enr.total_payable - paid_sum + refunded_sum);

  if p_currency is distinct from 'INR' or amount_rupees <> ord.amount then
    hold_reason := 'amount or currency differs from the order';
  elsif ord.status = 'paid' then
    hold_reason := 'the order already has a paid payment';
  elsif enr.status not in ('enrolled', 'active', 'on_hold', 'completed') then
    hold_reason := 'the enrollment is no longer eligible for payment';
  elsif amount_rupees > outstanding then
    hold_reason := 'the amount exceeds the current outstanding balance';
  end if;

  insert into payments (
    student_id, enrollment_id, installment_id, payment_type,
    amount, tax_amount, total_amount, method, status,
    razorpay_order_id, razorpay_payment_id, internal_reference, notes,
    created_by, paid_at
  ) values (
    ord.student_id, ord.enrollment_id, null,
    case ord.purpose when 'next_installment' then 'installment' else 'full' end,
    amount_rupees, 0, amount_rupees, 'razorpay',
    case when hold_reason is null then 'paid' else 'authorized' end,
    p_provider_order_id, p_provider_payment_id, p_provider_payment_id,
    case when hold_reason is null then null else 'Held for review: ' || hold_reason end,
    null, coalesce(p_paid_at, now())
  )
  returning id, payments.payment_code into new_id, new_code;

  if hold_reason is null then
    update payment_orders set status = 'paid', payment_id = new_id where id = ord.id;
  elsif ord.status <> 'paid' then
    update payment_orders
       set status = 'held', payment_id = coalesce(payment_orders.payment_id, new_id)
     where id = ord.id;
  end if;

  -- Exactly one audit entry per ledger row, in the same transaction (a
  -- retried delivery returns 'already_recorded' above and writes nothing).
  insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, after_data)
  values (
    null, 'system',
    case when hold_reason is null then 'payment.recorded_online' else 'payment.online_held' end,
    'payment', new_id,
    jsonb_build_object(
      'paymentCode', new_code,
      'enrollmentId', ord.enrollment_id,
      'amount', to_char(amount_rupees, 'FM9999999999990.00'),
      'purpose', ord.purpose,
      'providerOrderId', p_provider_order_id,
      'providerPaymentId', p_provider_payment_id,
      'source', p_source,
      'holdReason', hold_reason
    )
  );

  return query select new_id, new_code,
    case when hold_reason is null then 'recorded' else 'held' end::text;
end;
$$;

comment on function finalize_razorpay_payment(text, text, bigint, text, text, timestamptz, text) is
  'Phase 20B: the single canonical transition from a captured Razorpay payment to a ledger row. service_role only; called after the server verified the Checkout signature + fetched the payment from Razorpay, or after a signature-verified payment.captured webhook. Idempotent on razorpay_payment_id; locks the enrollment; writes paid, or authorized (held for review) when it cannot be accepted; audits once.';

revoke execute on function finalize_razorpay_payment(text, text, bigint, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function finalize_razorpay_payment(text, text, bigint, text, text, timestamptz, text) to service_role;
