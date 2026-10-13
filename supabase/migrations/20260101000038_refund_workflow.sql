-- Phase 21B (Refunds). FR-97 (refunds link back to the original payment;
-- original payment rows are never deleted or overwritten), SEC-10 (refund
-- is an Admin/Super Admin action and is audited). One canonical refund
-- ledger — the pre-existing `payment_refunds` table (20260101000007) — for
-- offline/manual and Razorpay TEST-mode refunds alike; provider fields are
-- additive.
--
-- Rules confirmed at the Phase 21B checkpoint (DECISIONS_NEEDED.md D8 and
-- the four refund decisions), not inferred:
--  - Accounting (D8, option A, unchanged Phase 14 formula):
--      outstanding = total_payable - paid + processed refunds.
--    Only `processed` refunds are financial truth.
--  - The original payment stays `paid` forever: its amount and status are
--    never changed (Phase 20A immutability is untouched). "Partially /
--    fully refunded" is a display label derived from this ledger.
--  - Capacity: processed + initiated (in-progress) + the new refund must
--    never exceed the payment's total_amount. An `initiated` refund
--    reserves capacity but does not affect outstanding; a `failed` refund
--    affects nothing and releases its reservation.
--  - A refund is NOT a fee adjustment: nothing here touches enrollments,
--    payment plans, installments or payments.
--  - Offline refunds (payment method cash / bank_transfer / upi / cheque /
--    other) record money already returned, so they are inserted directly
--    as `processed`, with a required reason, a refund date (Asia/Kolkata,
--    not in the future, not before the payment date) and an optional
--    reference. Razorpay payments are refunded through Razorpay only.
--  - Admin and Super Admin may refund; no approval step; Students,
--    Trainers and anon have no write path.
--
-- A read-only review of the dev project found: amount allowed 0, no
-- refund-date/reference/lifecycle-time columns, no uniqueness on
-- razorpay_refund_id, no cumulative cap, no immutability, and direct
-- Admin INSERT/UPDATE policies. This migration closes each gap.

-- 1. Columns -------------------------------------------------------------------

alter table payment_refunds
  add column if not exists refunded_on date,
  add column if not exists reference text,
  add column if not exists processed_at timestamptz,
  add column if not exists failed_at timestamptz;

comment on column payment_refunds.refunded_on is
  'Asia/Kolkata business date the money was returned. Entered by the Admin for an offline refund; the provider confirmation date for a Razorpay refund. Null until processed.';
comment on column payment_refunds.reference is
  'Optional offline refund reference (UTR, cheque number, ...). Never card/bank account data.';

alter table payment_refunds
  add constraint payment_refunds_amount_positive check (amount > 0);

alter table payment_refunds
  add constraint payment_refunds_reason_required
  check (reason is not null and char_length(btrim(reason)) between 1 and 500);

alter table payment_refunds
  add constraint payment_refunds_reference_length
  check (reference is null or char_length(reference) <= 100);

alter table payment_refunds
  add constraint payment_refunds_processed_has_date
  check (status <> 'processed' or (refunded_on is not null and processed_at is not null));

create unique index if not exists payment_refunds_razorpay_refund_id_unique
  on payment_refunds (razorpay_refund_id)
  where razorpay_refund_id is not null;

alter table razorpay_webhook_events
  add column if not exists provider_refund_id text;

-- 2. Capacity + eligibility, for every writer ---------------------------------

create or replace function enforce_refund_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  pay record;
  committed numeric;
begin
  -- Serializes every refund write for this payment.
  select p.id, p.status, p.total_amount
    into pay
    from payments p
   where p.id = new.payment_id
   for update;
  if pay.id is null or pay.status <> 'paid' then
    raise exception using
      errcode = '23514',
      message = 'A refund can only be recorded against a paid payment (FR-97)';
  end if;

  if new.status in ('initiated', 'processed') then
    select coalesce(sum(r.amount), 0) into committed
      from payment_refunds r
     where r.payment_id = new.payment_id
       and r.status in ('initiated', 'processed')
       and r.id <> new.id;
    if committed + new.amount > pay.total_amount then
      raise exception using
        errcode = '23514',
        message = 'Refunds would exceed the original payment amount';
    end if;
  end if;
  return new;
end;
$$;

comment on function enforce_refund_capacity() is
  'Phase 21B: refunds only against paid payments, and processed + in-progress refunds never exceed the payment total — checked under a payment row lock for every writer.';

create trigger payment_refunds_enforce_capacity
  before insert or update of payment_id, amount, status on payment_refunds
  for each row execute function enforce_refund_capacity();

-- 3. Immutability / lifecycle ---------------------------------------------------

create or replace function prevent_refund_rewrite()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_id is distinct from old.payment_id
     or new.amount is distinct from old.amount
     or new.reason is distinct from old.reason
     or new.reference is distinct from old.reference
     or new.initiated_by is distinct from old.initiated_by
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'A refund record cannot be rewritten (FR-97)';
  end if;
  if old.razorpay_refund_id is not null
     and new.razorpay_refund_id is distinct from old.razorpay_refund_id then
    raise exception using errcode = '42501', message = 'razorpay_refund_id is set once';
  end if;
  if old.status in ('processed', 'failed') then
    if new.status is distinct from old.status
       or new.refunded_on is distinct from old.refunded_on
       or new.processed_at is distinct from old.processed_at
       or new.failed_at is distinct from old.failed_at
       or new.razorpay_refund_id is distinct from old.razorpay_refund_id then
      raise exception using errcode = '42501', message = 'A processed or failed refund is final';
    end if;
  end if;
  return new;
end;
$$;

comment on function prevent_refund_rewrite() is
  'Phase 21B: refund amount, payment, reason, reference, initiator and creation time never change; the provider refund id is set once; processed and failed are final. Only initiated -> processed | failed is a legal transition.';

create trigger payment_refunds_prevent_rewrite
  before update on payment_refunds
  for each row execute function prevent_refund_rewrite();

-- 4. No direct end-user writes ---------------------------------------------------

drop policy if exists payment_refunds_write_admin on payment_refunds;
drop policy if exists payment_refunds_update_admin on payment_refunds;

-- 5. Offline refund (Admin / Super Admin session) -------------------------------

create or replace function record_offline_refund(
  p_refund_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_refunded_on date,
  p_reference text
)
returns table (refund_id uuid, already_recorded boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_id uuid;
  pay record;
  existing record;
  clean_reason text;
  clean_reference text;
  committed numeric;
begin
  if not is_admin_or_super() then
    raise exception using errcode = '42501', message = 'Only Admin/Super Admin may record a refund';
  end if;
  admin_id := current_admin_id();
  if admin_id is null then
    raise exception using errcode = '42501', message = 'The signed-in Admin has no admin profile to record the refund against';
  end if;
  if p_refund_id is null or p_payment_id is null then
    raise exception using errcode = '22023', message = 'Refund and payment identifiers are required';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 9999999999.99 then
    raise exception using errcode = '22023', message = 'Refund amount must be a positive rupee value with at most 2 decimal places';
  end if;
  clean_reason := nullif(btrim(coalesce(p_reason, '')), '');
  clean_reference := nullif(btrim(coalesce(p_reference, '')), '');
  if clean_reason is null or char_length(clean_reason) > 500 then
    raise exception using errcode = '22023', message = 'A refund reason of at most 500 characters is required';
  end if;
  if char_length(coalesce(clean_reference, '')) > 100 then
    raise exception using errcode = '22023', message = 'Reference must be at most 100 characters';
  end if;

  select p.id, p.status, p.method, p.total_amount, p.paid_at
    into pay
    from payments p
   where p.id = p_payment_id
   for update;
  if pay.id is null then
    raise exception using errcode = 'P2104', message = 'Payment not found';
  end if;

  -- Idempotent resubmission: the form carries a server-minted refund id.
  select r.id, r.payment_id, r.amount into existing from payment_refunds r where r.id = p_refund_id;
  if existing.id is not null then
    if existing.payment_id = p_payment_id and existing.amount = p_amount then
      return query select existing.id, true;
      return;
    end if;
    raise exception using errcode = 'P2103', message = 'This refund form was already used for a different refund';
  end if;

  if pay.status <> 'paid' then
    raise exception using errcode = 'P2102', message = 'Only a paid payment can be refunded';
  end if;
  if pay.method = 'razorpay' then
    raise exception using errcode = 'P2102', message = 'A Razorpay payment is refunded through Razorpay, not recorded manually';
  end if;
  if p_refunded_on is null or p_refunded_on > (now() at time zone 'Asia/Kolkata')::date then
    raise exception using errcode = '22023', message = 'Refund date is required and cannot be in the future';
  end if;
  if pay.paid_at is not null and p_refunded_on < (pay.paid_at at time zone 'Asia/Kolkata')::date then
    raise exception using errcode = '22023', message = 'Refund date cannot be earlier than the payment date';
  end if;

  select coalesce(sum(r.amount), 0) into committed
    from payment_refunds r
   where r.payment_id = p_payment_id and r.status in ('initiated', 'processed');
  if committed + p_amount > pay.total_amount then
    raise exception using
      errcode = 'P2101',
      message = format('Amount exceeds the refundable balance of %s', to_char(pay.total_amount - committed, 'FM9999999999990.00'));
  end if;

  insert into payment_refunds (
    id, payment_id, amount, reason, reference, status, initiated_by, refunded_on, processed_at
  ) values (
    p_refund_id, p_payment_id, p_amount, clean_reason, clean_reference, 'processed', admin_id, p_refunded_on, now()
  );

  return query select p_refund_id, false;
end;
$$;

comment on function record_offline_refund(uuid, uuid, numeric, text, date, text) is
  'Phase 21B: records money already returned for an offline payment, directly as processed. Admin/Super Admin only (self-checked), locks the payment, enforces the cumulative cap, validates the refund date, idempotent on the form''s refund id. Changes no payment, enrollment or installment.';

revoke execute on function record_offline_refund(uuid, uuid, numeric, text, date, text) from public, anon, authenticated;
grant execute on function record_offline_refund(uuid, uuid, numeric, text, date, text) to authenticated;

-- 6. Razorpay refund: reserve (Admin / Super Admin session) ---------------------

create or replace function reserve_razorpay_refund(
  p_refund_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_reason text
)
returns table (
  refund_id uuid,
  provider_payment_id text,
  status text,
  razorpay_refund_id text,
  already_reserved boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_id uuid;
  pay record;
  existing record;
  clean_reason text;
  committed numeric;
begin
  if not is_admin_or_super() then
    raise exception using errcode = '42501', message = 'Only Admin/Super Admin may initiate a refund';
  end if;
  admin_id := current_admin_id();
  if admin_id is null then
    raise exception using errcode = '42501', message = 'The signed-in Admin has no admin profile to initiate the refund';
  end if;
  if p_refund_id is null or p_payment_id is null then
    raise exception using errcode = '22023', message = 'Refund and payment identifiers are required';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) or p_amount > 9999999999.99 then
    raise exception using errcode = '22023', message = 'Refund amount must be a positive rupee value with at most 2 decimal places';
  end if;
  clean_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if clean_reason is null or char_length(clean_reason) > 500 then
    raise exception using errcode = '22023', message = 'A refund reason of at most 500 characters is required';
  end if;

  select p.id, p.status, p.method, p.total_amount, p.razorpay_payment_id
    into pay
    from payments p
   where p.id = p_payment_id
   for update;
  if pay.id is null then
    raise exception using errcode = 'P2104', message = 'Payment not found';
  end if;

  select r.id, r.payment_id, r.amount, r.status, r.razorpay_refund_id
    into existing
    from payment_refunds r
   where r.id = p_refund_id;
  if existing.id is not null then
    if existing.payment_id = p_payment_id and existing.amount = p_amount then
      return query select existing.id, pay.razorpay_payment_id, existing.status,
                          existing.razorpay_refund_id, true;
      return;
    end if;
    raise exception using errcode = 'P2103', message = 'This refund form was already used for a different refund';
  end if;

  if pay.status <> 'paid' then
    raise exception using errcode = 'P2102', message = 'Only a paid payment can be refunded';
  end if;
  if pay.method <> 'razorpay' or pay.razorpay_payment_id is null then
    raise exception using errcode = 'P2102', message = 'Only a Razorpay payment can be refunded through Razorpay';
  end if;

  select coalesce(sum(r.amount), 0) into committed
    from payment_refunds r
   where r.payment_id = p_payment_id and r.status in ('initiated', 'processed');
  if committed + p_amount > pay.total_amount then
    raise exception using
      errcode = 'P2101',
      message = format('Amount exceeds the refundable balance of %s', to_char(pay.total_amount - committed, 'FM9999999999990.00'));
  end if;

  insert into payment_refunds (id, payment_id, amount, reason, status, initiated_by)
  values (p_refund_id, p_payment_id, p_amount, clean_reason, 'initiated', admin_id);

  return query select p_refund_id, pay.razorpay_payment_id, 'initiated'::text, null::text, false;
end;
$$;

comment on function reserve_razorpay_refund(uuid, uuid, numeric, text) is
  'Phase 21B: reserves refundable capacity for a Razorpay refund as an initiated row BEFORE the provider is called (no outstanding effect). Admin/Super Admin only, payment row lock, cumulative cap, idempotent on the form''s refund id. Returns the trusted stored Razorpay payment id.';

revoke execute on function reserve_razorpay_refund(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function reserve_razorpay_refund(uuid, uuid, numeric, text) to authenticated;

-- 7. Razorpay refund: provider truth (server only) ------------------------------

create or replace function apply_razorpay_refund_status(
  p_refund_id uuid,
  p_provider_payment_id text,
  p_provider_refund_id text,
  p_amount_paise bigint,
  p_currency text,
  p_provider_status text,
  p_source text
)
returns table (refund_id uuid, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay record;
  ref record;
  new_status text;
begin
  if p_source is null or p_source not in ('api', 'webhook', 'sync') then
    raise exception using errcode = '22023', message = 'Unknown refund status source';
  end if;
  if p_provider_payment_id is null or p_provider_refund_id is null then
    raise exception using errcode = '22023', message = 'Provider payment and refund ids are required';
  end if;
  new_status := case p_provider_status
    when 'processed' then 'processed'
    when 'failed' then 'failed'
    when 'pending' then 'initiated'
    else null end;
  if new_status is null then
    raise exception using errcode = '22023', message = 'Unknown provider refund status';
  end if;

  -- The payment is resolved from the trusted stored provider payment id.
  select p.id into pay from payments p where p.razorpay_payment_id = p_provider_payment_id for update;
  if pay.id is null then
    return query select null::uuid, 'unknown_payment'::text;
    return;
  end if;

  select r.* into ref from payment_refunds r
   where r.razorpay_refund_id = p_provider_refund_id;
  if ref.id is null and p_refund_id is not null then
    select r.* into ref from payment_refunds r
     where r.id = p_refund_id and r.razorpay_refund_id is null;
  end if;
  if ref.id is null then
    -- Not a refund this system initiated: nothing is recorded.
    return query select null::uuid, 'unknown_refund'::text;
    return;
  end if;
  if ref.payment_id <> pay.id then
    return query select ref.id, 'payment_mismatch'::text;
    return;
  end if;
  if p_amount_paise is null or p_amount_paise <> round(ref.amount * 100)
     or coalesce(p_currency, '') <> 'INR' then
    return query select ref.id, 'amount_mismatch'::text;
    return;
  end if;

  if ref.status in ('processed', 'failed') then
    if ref.status = new_status or new_status = 'initiated' then
      return query select ref.id, 'already_final'::text;
    else
      return query select ref.id, 'conflict'::text;
    end if;
    return;
  end if;

  if new_status = 'initiated' then
    update payment_refunds
       set razorpay_refund_id = coalesce(razorpay_refund_id, p_provider_refund_id)
     where id = ref.id;
    return query select ref.id, 'pending'::text;
    return;
  end if;

  if new_status = 'processed' then
    update payment_refunds
       set razorpay_refund_id = coalesce(razorpay_refund_id, p_provider_refund_id),
           status = 'processed',
           processed_at = now(),
           refunded_on = (now() at time zone 'Asia/Kolkata')::date
     where id = ref.id;
  else
    update payment_refunds
       set razorpay_refund_id = coalesce(razorpay_refund_id, p_provider_refund_id),
           status = 'failed',
           failed_at = now()
     where id = ref.id;
  end if;

  insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, after_data)
  values (
    null, 'system',
    case when new_status = 'processed' then 'refund.processed' else 'refund.failed' end,
    'refund', ref.id,
    jsonb_build_object(
      'paymentId', pay.id,
      'amount', to_char(ref.amount, 'FM9999999999990.00'),
      'providerRefundId', p_provider_refund_id,
      'source', p_source
    )
  );

  return query select ref.id, new_status;
end;
$$;

comment on function apply_razorpay_refund_status(uuid, text, text, bigint, text, text, text) is
  'Phase 21B: applies Razorpay''s refund status (API response, webhook or sync) to the refund this system initiated. Resolves the payment by its stored provider id, matches the refund by provider id or by the system refund id, checks amount and currency, and only moves initiated -> processed | failed (final). One audit row per transition; replays are no-ops. service_role only.';

revoke execute on function apply_razorpay_refund_status(uuid, text, text, bigint, text, text, text) from public, anon, authenticated;
grant execute on function apply_razorpay_refund_status(uuid, text, text, bigint, text, text, text) to service_role;

create or replace function fail_unsent_razorpay_refund(p_refund_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ref record;
begin
  select r.* into ref from payment_refunds r where r.id = p_refund_id for update;
  if ref.id is null or ref.status <> 'initiated' or ref.razorpay_refund_id is not null then
    return false;
  end if;
  update payment_refunds set status = 'failed', failed_at = now() where id = ref.id;
  insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, after_data)
  values (null, 'system', 'refund.failed', 'refund', ref.id,
          jsonb_build_object('paymentId', ref.payment_id,
                             'amount', to_char(ref.amount, 'FM9999999999990.00'),
                             'source', 'not_created_at_provider'));
  return true;
end;
$$;

comment on function fail_unsent_razorpay_refund(uuid) is
  'Phase 21B: releases the reservation of an initiated refund that Razorpay never created (definitive API rejection, or confirmed absent at the provider). No-op once a provider refund id is attached or the row is final. service_role only.';

revoke execute on function fail_unsent_razorpay_refund(uuid) from public, anon, authenticated;
grant execute on function fail_unsent_razorpay_refund(uuid) to service_role;
