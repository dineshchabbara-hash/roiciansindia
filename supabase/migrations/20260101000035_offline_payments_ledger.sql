-- Phase 20A (Offline Payments Ledger). Schema-completion + enforcement for
-- the first application writer of `payments` (FR-90 offline/admin-recorded
-- payments, FR-91 immutable transaction rows, BR-5 per-enrollment
-- isolation, BR-6 admin-recorded offline payment). The `payments` table,
-- `payment_id_seq` and the payment_code immutability trigger already exist
-- (20260101000002 / 20260101000007); a read-only review of the dev project
-- found four gaps this migration closes:
--
--  1. payment_code had no DB-side generator (DATABASE_SCHEMA.md §3:
--     `PAY-{nextval('payment_id_seq') padded to 6}`) — the same
--     schema-completion gap 20260101000019 (student_code) and
--     20260101000021 (enrollment_code) fixed with a column DEFAULT. The
--     sequence is NOT reset/recreated; it continues from its current state
--     and gaps remain valid. Explicit codes (existing fixtures/tests) still
--     work — the DEFAULT applies only when the insert omits the column.
--
--  2. FR-91 was enforced by convention only: payments_update_admin and
--     payments_delete_admin let any Admin session UPDATE or DELETE any
--     payment row over the REST API, and only payment_code was protected.
--     Both policies are dropped (RLS default-deny — the same mechanism
--     20260101000023 used to remove the enrollments delete policy), and a
--     trigger freezes every column of a payment once it represents money
--     received (status paid / refunded / partially_refunded) for EVERY
--     role, service_role included. Corrections go through a new payment or
--     a refund row (DATABASE_SCHEMA.md payments "Immutability rule"),
--     never by editing history. A not-yet-settled row (pending/authorized
--     — the future Phase 20B online flow) stays updatable server-side by
--     service_role only; no end-user role has any UPDATE/DELETE path.
--
--  3. Nothing tied payments.student_id to the enrollment's own student, or
--     installment_id to that enrollment's own plan — a cross-enrollment
--     row (BR-5) was storable. A BEFORE INSERT/UPDATE trigger now rejects
--     both mismatches for every writer.
--
--  4. Offline recording needs server-side business rules that a plain
--     INSERT policy cannot express atomically: the enrollment must be in a
--     confirmed status, the amount must not exceed the current outstanding
--     balance (checked under a row lock, so two concurrent submissions
--     cannot together overshoot), the recording Admin is derived from the
--     session (never a submitted field), and a resubmitted form is
--     idempotent. That is record_offline_payment() below. payments_write_
--     admin (a direct INSERT policy) is dropped so this function is the
--     ONLY end-user write path; service_role keeps its own server-side
--     path (fixtures, the future Phase 20B webhook).
--
-- Business rules confirmed at the Phase 20A checkpoint (not inferred):
-- overpayment is blocked; payments are enrollment-level only (no
-- installment allocation in 20A — installment_id is never set here);
-- eligible enrollment statuses are the confirmed set enrolled / active /
-- on_hold / completed (lib/domain/dashboard-metrics.ts
-- CONFIRMED_ENROLLMENT_STATUSES); the Admin enters the date the money was
-- received (today or earlier, Asia/Kolkata calendar day).
--
-- The outstanding guard below mirrors the Phase 14 formula exactly
-- (lib/domain/dashboard-metrics.ts computeOutstandingFeesPaise /
-- DATABASE_SCHEMA.md §6): max(0, total_payable - sum(paid payments'
-- total_amount) + sum(processed refunds' amount)), scoped to one
-- enrollment. It is a write-time guard only — every displayed figure still
-- comes from the TypeScript engine; parity is pinned by
-- supabase/tests/phase20_offline_payments_test.sql.
--
-- No Razorpay, receipt or refund behaviour is added or changed here.

-- 1. payment_code generation ------------------------------------------------

alter table payments
  alter column payment_code
  set default ('PAY-' || lpad(nextval('public.payment_id_seq')::text, 6, '0'));

-- 2. Immutability ------------------------------------------------------------

drop policy if exists payments_update_admin on payments;
drop policy if exists payments_delete_admin on payments;

create or replace function prevent_settled_payment_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status in ('paid', 'refunded', 'partially_refunded') then
    raise exception using
      errcode = '42501',
      message = 'A recorded payment is an immutable transaction row and cannot be changed (FR-91)';
  end if;
  return new;
end;
$$;

comment on function prevent_settled_payment_change() is
  'FR-91: once a payment represents money received (paid / refunded / partially_refunded) no column may change, for any role. Corrections are a new payment or a refund row.';

create trigger payments_prevent_settled_change
  before update on payments
  for each row execute function prevent_settled_payment_change();

-- 3. Cross-enrollment integrity ---------------------------------------------

create or replace function enforce_payment_enrollment_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  enrollment_student uuid;
begin
  select student_id into enrollment_student from enrollments where id = new.enrollment_id;
  if enrollment_student is distinct from new.student_id then
    raise exception using
      errcode = '23514',
      message = 'payments.student_id must be the student of payments.enrollment_id (BR-5)';
  end if;

  if new.installment_id is not null and not exists (
    select 1
    from installments i
    join payment_plans pp on pp.id = i.payment_plan_id
    where i.id = new.installment_id and pp.enrollment_id = new.enrollment_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'payments.installment_id must belong to the payment plan of payments.enrollment_id (BR-5)';
  end if;

  return new;
end;
$$;

comment on function enforce_payment_enrollment_integrity() is
  'BR-5: a payment''s student and installment must belong to its own enrollment, for every writer.';

create trigger payments_enforce_enrollment_integrity
  before insert or update of student_id, enrollment_id, installment_id on payments
  for each row execute function enforce_payment_enrollment_integrity();

-- 4. Offline recording -------------------------------------------------------

drop policy if exists payments_write_admin on payments;

create or replace function record_offline_payment(
  p_payment_id uuid,
  p_enrollment_id uuid,
  p_amount numeric,
  p_method text,
  p_payment_type text,
  p_paid_on date,
  p_reference text,
  p_notes text
)
returns table (recorded_payment_id uuid, recorded_payment_code text, already_recorded boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  admin_id uuid;
  enr record;
  existing record;
  paid_sum numeric;
  refunded_sum numeric;
  outstanding numeric;
  clean_reference text;
  clean_notes text;
  new_id uuid;
  new_code text;
begin
  if not is_admin_or_super() then
    raise exception using
      errcode = '42501',
      message = 'Only Admin/Super Admin may record an offline payment';
  end if;

  admin_id := current_admin_id();
  if admin_id is null then
    raise exception using
      errcode = '42501',
      message = 'The signed-in Admin has no admin profile to record the payment against';
  end if;

  if p_payment_id is null or p_enrollment_id is null then
    raise exception using errcode = '22023', message = 'Payment and enrollment identifiers are required';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2)
     or p_amount > 9999999999.99 then
    raise exception using errcode = '22023', message = 'Amount must be a positive rupee value with at most 2 decimal places';
  end if;
  if p_method is null or p_method not in ('cash', 'bank_transfer', 'upi', 'cheque') then
    raise exception using errcode = '22023', message = 'Payment method must be cash, bank_transfer, upi or cheque';
  end if;
  if p_payment_type is null or p_payment_type not in ('registration', 'full', 'partial', 'other') then
    raise exception using errcode = '22023', message = 'Payment type must be registration, full, partial or other';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Asia/Kolkata')::date then
    raise exception using errcode = '22023', message = 'Payment date is required and cannot be in the future';
  end if;

  clean_reference := nullif(btrim(coalesce(p_reference, '')), '');
  clean_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if char_length(coalesce(clean_reference, '')) > 100 then
    raise exception using errcode = '22023', message = 'Reference must be at most 100 characters';
  end if;
  if char_length(coalesce(clean_notes, '')) > 1000 then
    raise exception using errcode = '22023', message = 'Notes must be at most 1000 characters';
  end if;

  -- Serializes every offline recording for this enrollment: the
  -- outstanding check and the insert below see each other's committed rows.
  select e.id, e.student_id, e.status, e.total_payable
    into enr
    from enrollments e
   where e.id = p_enrollment_id
   for update;
  if enr.id is null then
    raise exception using errcode = 'P2004', message = 'Enrollment not found';
  end if;

  -- Idempotent resubmission: the form carries a server-minted payment id.
  select p.id, p.payment_code, p.enrollment_id, p.amount, p.method
    into existing
    from payments p
   where p.id = p_payment_id;
  if existing.id is not null then
    if existing.enrollment_id = p_enrollment_id
       and existing.amount = p_amount
       and existing.method = p_method then
      return query select existing.id, existing.payment_code, true;
      return;
    end if;
    raise exception using errcode = 'P2003', message = 'This payment form was already used for a different payment';
  end if;

  if enr.status not in ('enrolled', 'active', 'on_hold', 'completed') then
    raise exception using
      errcode = 'P2002',
      message = 'Offline payments can only be recorded against a confirmed enrollment (enrolled, active, on hold or completed)';
  end if;

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

  insert into payments (
    id, student_id, enrollment_id, installment_id, payment_type,
    amount, tax_amount, total_amount, method, status,
    internal_reference, notes, created_by, paid_at
  ) values (
    p_payment_id, enr.student_id, p_enrollment_id, null, p_payment_type,
    p_amount, 0, p_amount, p_method, 'paid',
    clean_reference, clean_notes, admin_id,
    (p_paid_on::timestamp at time zone 'Asia/Kolkata')
  )
  returning id, payment_code into new_id, new_code;

  return query select new_id, new_code, false;
end;
$$;

comment on function record_offline_payment(uuid, uuid, numeric, text, text, date, text, text) is
  'Phase 20A: the only end-user write path into payments. Admin/Super Admin only (self-checked). Locks the enrollment, requires a confirmed status, blocks amounts above the Phase 14 outstanding balance, derives student_id/created_by server-side, stores status=paid with tax 0 (total = amount), and is idempotent on the caller-supplied payment id.';

revoke execute on function record_offline_payment(uuid, uuid, numeric, text, text, date, text, text) from public, anon, authenticated;
grant execute on function record_offline_payment(uuid, uuid, numeric, text, text, date, text, text) to authenticated;
