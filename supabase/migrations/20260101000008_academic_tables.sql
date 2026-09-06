-- Class sessions, attendance, materials, assignments. See DATABASE_SCHEMA.md §4.

create table if not exists class_sessions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches (id) on delete cascade,
  trainer_id uuid references trainers (id) on delete set null,
  session_date date not null,
  start_time time,
  end_time time,
  topic text,
  description text,
  meeting_link text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'completed', 'cancelled', 'rescheduled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger class_sessions_set_updated_at
  before update on class_sessions
  for each row execute function set_updated_at();

create index if not exists class_sessions_batch_date_idx on class_sessions (batch_id, session_date);

-- ---------------------------------------------------------------------------

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references class_sessions (id) on delete cascade,
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  -- Denormalized for query performance (avoids joining through
  -- class_sessions for every attendance/batch report).
  batch_id uuid not null references batches (id) on delete cascade,

  status text not null check (status in ('present', 'absent', 'late', 'excused')),

  -- Polymorphic "marked by" reference (trainer or admin) — modeled as a type
  -- + id pair rather than a single FK, since Postgres has no native
  -- polymorphic foreign key. Referential integrity across the two possible
  -- target tables is enforced at the application layer.
  marked_by uuid not null,
  marked_by_type text not null check (marked_by_type in ('trainer', 'admin')),
  marked_at timestamptz not null default now(),

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_unique_per_session unique (class_session_id, student_id)
);

comment on table attendance is
  'One row per student per class session. Attendance percentage is computed on read (see student_attendance_summary view), never hand-entered.';

create trigger attendance_set_updated_at
  before update on attendance
  for each row execute function set_updated_at();

create index if not exists attendance_enrollment_idx on attendance (enrollment_id);
create index if not exists attendance_batch_status_idx on attendance (batch_id, status);

-- ---------------------------------------------------------------------------

create table if not exists attendance_audit (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references attendance (id) on delete cascade,
  changed_by uuid not null,
  changed_by_type text not null check (changed_by_type in ('trainer', 'admin')),
  previous_status text,
  new_status text,
  changed_at timestamptz not null default now()
);

comment on table attendance_audit is
  'Change history for attendance edits made after the initial marking (REQUIREMENTS.md §17).';

create index if not exists attendance_audit_attendance_idx on attendance_audit (attendance_id);

-- ---------------------------------------------------------------------------

create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  program_id uuid references programs (id) on delete cascade,
  batch_id uuid references batches (id) on delete cascade,
  module_id uuid references program_modules (id) on delete cascade,
  class_session_id uuid references class_sessions (id) on delete cascade,

  title text not null,
  description text,
  material_type text not null check (material_type in ('file', 'link', 'video')),
  file_path text,
  external_url text,

  uploaded_by uuid not null,
  uploaded_by_type text not null check (uploaded_by_type in ('admin', 'trainer')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint materials_scoped check (
    program_id is not null or batch_id is not null
    or module_id is not null or class_session_id is not null
  ),
  constraint materials_file_or_link check (
    (material_type = 'link' and external_url is not null)
    or (material_type = 'video' and external_url is not null)
    or (material_type = 'file' and file_path is not null)
  )
);

comment on table materials is
  'Uploaded/linked learning material. Every row must be scoped to at least one of program/batch/module/session.';

create trigger materials_set_updated_at
  before update on materials
  for each row execute function set_updated_at();

create index if not exists materials_program_idx on materials (program_id);
create index if not exists materials_batch_idx on materials (batch_id);
create index if not exists materials_module_idx on materials (module_id);
create index if not exists materials_session_idx on materials (class_session_id);

-- ---------------------------------------------------------------------------

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs (id) on delete cascade,
  batch_id uuid not null references batches (id) on delete cascade,
  module_id uuid references program_modules (id) on delete set null,
  trainer_id uuid not null references trainers (id) on delete restrict,

  title text not null,
  description text,
  attachment_path text,
  assigned_date date not null default current_date,
  due_date date not null,
  max_marks numeric(6, 2) check (max_marks is null or max_marks >= 0),
  status text not null default 'active' check (status in ('active', 'closed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger assignments_set_updated_at
  before update on assignments
  for each row execute function set_updated_at();

create index if not exists assignments_batch_idx on assignments (batch_id);
create index if not exists assignments_trainer_idx on assignments (trainer_id);

-- ---------------------------------------------------------------------------

create table if not exists assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments (id) on delete cascade,
  enrollment_id uuid not null references enrollments (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,

  submitted_at timestamptz,
  text_response text,
  file_path text,
  status text not null default 'not_submitted'
    check (status in ('not_submitted', 'submitted', 'late', 'reviewed', 'resubmission_requested')),

  marks numeric(6, 2) check (marks is null or marks >= 0),
  trainer_feedback text,
  reviewed_by uuid references trainers (id),
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint assignment_submissions_unique unique (assignment_id, enrollment_id)
);

create trigger assignment_submissions_set_updated_at
  before update on assignment_submissions
  for each row execute function set_updated_at();

create index if not exists assignment_submissions_student_idx on assignment_submissions (student_id);
create index if not exists assignment_submissions_assignment_idx on assignment_submissions (assignment_id);
