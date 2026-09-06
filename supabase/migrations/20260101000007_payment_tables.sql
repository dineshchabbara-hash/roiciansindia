-- Payments, refunds, and receipts. See DATABASE_SCHEMA.md §4/§6/§7 and
-- SECURITY_PLAN.md §9. Payments are immutable transaction records — balances
-- are always derived from them, never edited directly (REQUIREMENTS.md §91).

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  payment_code text not null unique,

  student_id uuid not null references students (id) on delete restrict,
  enrollment_id uuid not null references enrollments (id) on delete restrict,
  installment_id uuid references installments (id) on delete set null,

  payment_type text not null
    check (payment_type in ('registration', 'full', 'installment', 'partial', 'other')),
  amount numeric(12, 2) not null check (amount >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(12, 2) not null check (total_amount >= 0),

  method text not null
    check (method in ('razorpay', 'cash', 'bank_transfer', 'upi', 'cheque', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled')),

  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,

  internal_reference text,
  notes text,
  created_by uuid references admins (id),
  paid_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table payments is
  'Immutable payment transaction records. Never UPDATE amount/total_amount once status=paid; corrections go through payment_refunds or a new offsetting payment.';
comment on column payments.razorpay_payment_id is
  'Unique (when present) — the webhook idempotency key. Prevents duplicate Razorpay event delivery from creating a second payment row.';

create trigger payments_set_updated_at
  before update on payments
  for each row execute function set_updated_at();

create unique index if not exists payments_razorpay_payment_id_unique
  on payments (razorpay_payment_id)
  where razorpay_payment_id is not null;

create index if not exists payments_enrollment_idx on payments (enrollment_id);
create index if not exists payments_student_idx on payments (student_id);
create index if not exists payments_status_created_idx on payments (status, created_at desc);

create or replace function prevent_payment_code_change()
returns trigger
language plpgsql
as $$
begin
  if new.payment_code is distinct from old.payment_code then
    raise exception 'payment_code is immutable and cannot be changed after creation';
  end if;
  return new;
end;
$$;

create trigger payments_prevent_code_change
  before update on payments
  for each row execute function prevent_payment_code_change();

-- ---------------------------------------------------------------------------

create table if not exists payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments (id) on delete restrict,
  amount numeric(12, 2) not null check (amount >= 0),
  reason text,
  razorpay_refund_id text,
  status text not null default 'initiated'
    check (status in ('initiated', 'processed', 'failed')),
  initiated_by uuid references admins (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table payment_refunds is
  'Refund transactions linked to an original payment. The original payment row is never deleted or overwritten (REQUIREMENTS.md §71/§90).';

create trigger payment_refunds_set_updated_at
  before update on payment_refunds
  for each row execute function set_updated_at();

create index if not exists payment_refunds_payment_idx on payment_refunds (payment_id);

-- ---------------------------------------------------------------------------

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  payment_id uuid not null unique references payments (id) on delete restrict,
  pdf_path text not null,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table receipts is
  'One receipt per successful payment (online or offline). receipt_number minted from receipt_number_seq — concurrency-safe (REQUIREMENTS.md §92).';
