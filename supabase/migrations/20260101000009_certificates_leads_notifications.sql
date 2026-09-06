-- Certificates, leads, notifications, email log. See DATABASE_SCHEMA.md §4.

create table if not exists certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_number text not null unique,
  enrollment_id uuid not null references enrollments (id) on delete restrict,
  student_id uuid not null references students (id) on delete restrict,
  program_id uuid not null references programs (id) on delete restrict,

  completion_date date not null,
  issue_date date not null default current_date,
  status text not null default 'issued' check (status in ('issued', 'revoked')),
  pdf_path text not null,
  revoked_reason text,
  revoked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table certificates is
  'Issued certificates. Reissue creates a new row (new certificate_number) and marks the prior one revoked — history is preserved (REQUIREMENTS.md §28).';
comment on table certificates is
  'Public verification (/verify-certificate) exposes only certificate_number, student display name, program name, issue_date, and status — never the full row.';

create trigger certificates_set_updated_at
  before update on certificates
  for each row execute function set_updated_at();

create index if not exists certificates_enrollment_idx on certificates (enrollment_id);
create index if not exists certificates_student_idx on certificates (student_id);

-- ---------------------------------------------------------------------------

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  program_id uuid references programs (id) on delete set null,
  message text,
  source text,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'follow_up', 'qualified', 'converted', 'not_interested', 'closed')),
  converted_student_id uuid references students (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table leads is
  'Public inquiry pipeline. Converting a lead to a student preserves the originating source (REQUIREMENTS.md §39/FR-132).';

create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

create index if not exists leads_status_idx on leads (status);

-- Deferred FK from students.lead_id, now that leads exists (avoids a
-- migration-order cycle between students and leads).
alter table students
  add constraint students_lead_id_fkey
  foreign key (lead_id) references leads (id) on delete set null;

-- ---------------------------------------------------------------------------

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_auth_user_id uuid not null references auth.users (id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  channel text not null default 'in_app' check (channel in ('in_app', 'email', 'whatsapp')),
  status text not null default 'unread' check (status in ('unread', 'read')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table notifications is
  'In-app (and future multi-channel) notification feed. channel is adapter-based so WhatsApp can be added later without a schema change (ARCHITECTURE.md §10).';

create index if not exists notifications_recipient_idx on notifications (recipient_auth_user_id, status);

-- ---------------------------------------------------------------------------

create table if not exists email_log (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null,
  template_key text not null,
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  error_message text,
  related_entity_type text,
  related_entity_id uuid,
  created_at timestamptz not null default now()
);

comment on table email_log is
  'Record of every transactional email send attempt, for support/troubleshooting. Never stores full message bodies with unnecessary PII.';

create index if not exists email_log_related_idx on email_log (related_entity_type, related_entity_id);
