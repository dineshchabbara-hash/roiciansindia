-- Program/Batch catalog: programs, program_modules, batches, batch_trainers.
-- See DATABASE_SCHEMA.md §4. A program is never duplicated to represent a new
-- batch (REQUIREMENTS.md BR-4/§69) — many batches reference one program.

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  program_code text not null unique,
  name text not null,
  description text,
  category text,

  duration_value integer,
  duration_unit text check (duration_unit in ('hours', 'days', 'weeks', 'months')),
  delivery_mode text check (delivery_mode in ('online', 'in_person', 'hybrid')),

  regular_fee numeric(12, 2) not null,
  registration_fee numeric(12, 2) not null default 0,
  -- Nullable: null means "use company_settings.default_tax_rate_percent".
  tax_rate_percent numeric(5, 2),

  status text not null default 'draft' check (status in ('draft', 'active', 'inactive', 'archived')),
  thumbnail_path text,
  certificate_eligible boolean not null default true,
  installments_allowed boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint programs_regular_fee_non_negative check (regular_fee >= 0),
  constraint programs_registration_fee_non_negative check (registration_fee >= 0)
);

comment on table programs is
  'Course/program catalog. program_code is admin-defined free text (unique), not system-generated — see REQUIREMENTS.md §7 item 1.';

create trigger programs_set_updated_at
  before update on programs
  for each row execute function set_updated_at();

create index if not exists programs_status_idx on programs (status);
create index if not exists programs_category_idx on programs (category);

-- ---------------------------------------------------------------------------

create table if not exists program_modules (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs (id) on delete cascade,
  title text not null,
  description text,
  sequence integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_modules_unique_sequence unique (program_id, sequence)
);

create trigger program_modules_set_updated_at
  before update on program_modules
  for each row execute function set_updated_at();

create index if not exists program_modules_program_idx on program_modules (program_id);

-- ---------------------------------------------------------------------------

create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs (id) on delete restrict,
  name text not null,

  start_date date not null,
  expected_end_date date,
  days_of_week text[] not null default '{}',
  start_time time,
  end_time time,
  timezone text not null default 'Asia/Kolkata',

  delivery_mode text check (delivery_mode in ('online', 'in_person', 'hybrid')),
  capacity integer check (capacity is null or capacity > 0),
  status text not null default 'draft'
    check (status in ('draft', 'upcoming', 'active', 'completed', 'cancelled', 'archived')),

  meeting_link text,
  location text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table batches is
  'A scheduled run of a program (e.g. "September 2026 Weekend Batch"). Many batches per program — see REQUIREMENTS.md BR-4.';

create trigger batches_set_updated_at
  before update on batches
  for each row execute function set_updated_at();

create index if not exists batches_program_status_idx on batches (program_id, status);
create index if not exists batches_start_date_idx on batches (start_date);

-- ---------------------------------------------------------------------------

create table if not exists batch_trainers (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches (id) on delete cascade,
  trainer_id uuid not null references trainers (id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint batch_trainers_unique unique (batch_id, trainer_id)
);

comment on table batch_trainers is
  'Many-to-many assignment of trainers to batches; supports co-taught batches (one may be flagged primary).';

create index if not exists batch_trainers_trainer_idx on batch_trainers (trainer_id);
create index if not exists batch_trainers_batch_idx on batch_trainers (batch_id);
