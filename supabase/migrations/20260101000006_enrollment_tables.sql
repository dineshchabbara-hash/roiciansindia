-- Enrollments and installment plans. See DATABASE_SCHEMA.md §4/§6.
-- A student can hold many enrollments (REQUIREMENTS.md BR-3/§68); a payment
-- against one enrollment must never affect another (BR-5/§67) — enforced by
-- scoping every payment to exactly one enrollment (next migration).

create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  enrollment_code text not null unique,

  student_id uuid not null references students (id) on delete restrict,
  program_id uuid not null references programs (id) on delete restrict,
  -- Nullable: supports a "registered, not yet batch-assigned" state.
  batch_id uuid references batches (id) on delete set null,

  enrollment_date date not null default current_date,
  status text not null default 'lead'
    check (status in (
      'lead', 'applicant', 'registered', 'enrolled', 'active',
      'on_hold', 'completed', 'withdrawn', 'cancelled'
    )),

  regular_fee numeric(12, 2) not null,
  agreed_fee numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  discount_reason text,
  registration_fee numeric(12, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  total_payable numeric(12, 2) not null,

  -- Cached/derived only — see DATABASE_SCHEMA.md §6. Never written directly
  -- by any client request; recomputed transactionally by the domain-layer
  -- balance function whenever a payment/refund posts (implemented in the
  -- phase that first writes payments).
  amount_paid_cache numeric(12, 2) not null default 0,
  outstanding_balance_cache numeric(12, 2) not null default 0,

  payment_plan_type text check (payment_plan_type in ('full', 'installments')),
  source text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint enrollments_fees_non_negative check (
    regular_fee >= 0 and agreed_fee >= 0 and discount_amount >= 0
    and registration_fee >= 0 and tax_amount >= 0 and total_payable >= 0
  ),
  constraint enrollments_caches_non_negative check (
    amount_paid_cache >= 0 and outstanding_balance_cache >= 0
  )
);

comment on table enrollments is
  'Student + Program + Batch relationship and financial terms. No uniqueness constraint forces one enrollment per student — multiple/repeat enrollments are by design.';
comment on column enrollments.enrollment_code is
  'Immutable human-readable Enrollment ID (e.g. ENR-000123), assigned once from enrollment_id_seq at insert.';
comment on column enrollments.amount_paid_cache is
  'Derived cache only. Authoritative value = sum(payments.total_amount where status=paid) - sum(payment_refunds.amount where status=processed) for this enrollment. See DATABASE_SCHEMA.md §6.';

create trigger enrollments_set_updated_at
  before update on enrollments
  for each row execute function set_updated_at();

create index if not exists enrollments_student_idx on enrollments (student_id);
create index if not exists enrollments_program_idx on enrollments (program_id);
create index if not exists enrollments_batch_idx on enrollments (batch_id);
create index if not exists enrollments_status_idx on enrollments (status);

create or replace function prevent_enrollment_code_change()
returns trigger
language plpgsql
as $$
begin
  if new.enrollment_code is distinct from old.enrollment_code then
    raise exception 'enrollment_code is immutable and cannot be changed after creation';
  end if;
  return new;
end;
$$;

create trigger enrollments_prevent_code_change
  before update on enrollments
  for each row execute function prevent_enrollment_code_change();

-- ---------------------------------------------------------------------------

create table if not exists payment_plans (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references enrollments (id) on delete cascade,
  total_amount numeric(12, 2) not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payment_plans_set_updated_at
  before update on payment_plans
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------

create table if not exists installments (
  id uuid primary key default gen_random_uuid(),
  payment_plan_id uuid not null references payment_plans (id) on delete cascade,
  sequence integer not null,
  label text,
  amount numeric(12, 2) not null check (amount >= 0),
  due_date date not null,
  status text not null default 'upcoming'
    check (status in ('upcoming', 'due', 'partially_paid', 'paid', 'overdue', 'waived')),
  amount_paid_cache numeric(12, 2) not null default 0 check (amount_paid_cache >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installments_unique_sequence unique (payment_plan_id, sequence)
);

comment on table installments is
  'Individual installment lines under a payment plan. Worked example: registration + 2 installments (REQUIREMENTS.md §24).';

create trigger installments_set_updated_at
  before update on installments
  for each row execute function set_updated_at();

create index if not exists installments_plan_idx on installments (payment_plan_id);
create index if not exists installments_status_idx on installments (status);
