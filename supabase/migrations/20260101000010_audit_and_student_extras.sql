-- Audit trail and student-adjacent staff-only records.
-- See DATABASE_SCHEMA.md §4 and SECURITY_PLAN.md §13.

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid references auth.users (id) on delete set null,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

comment on table audit_logs is
  'Generic audit trail for sensitive actions (fee overrides, manual payments, refunds, status changes, certificate revocation, etc). Never stores passwords, tokens, or secrets — enforced by a redaction helper at every write call site (built in the phase that first writes audit entries).';

create index if not exists audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index if not exists audit_logs_created_at_idx on audit_logs (created_at);

-- ---------------------------------------------------------------------------

create table if not exists student_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id) on delete cascade,
  note text not null,
  created_by uuid not null references admins (id),
  created_at timestamptz not null default now()
);

comment on table student_notes is
  'Internal staff-only notes on a student. Never surfaced to the student portal.';

create index if not exists student_notes_student_idx on student_notes (student_id);

-- ---------------------------------------------------------------------------

create table if not exists student_documents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students (id) on delete cascade,
  document_type text not null,
  file_path text not null,
  uploaded_by uuid not null,
  uploaded_by_type text not null check (uploaded_by_type in ('admin', 'student')),
  created_at timestamptz not null default now()
);

create index if not exists student_documents_student_idx on student_documents (student_id);
