-- Identity tables: user_roles, students, trainers, admins.
-- See DATABASE_SCHEMA.md §4 and USER_ROLES_AND_PERMISSIONS.md.

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin', 'trainer', 'student')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table user_roles is
  'Maps a Supabase Auth user to exactly one application role (single role per user in V1).';

create trigger user_roles_set_updated_at
  before update on user_roles
  for each row execute function set_updated_at();

create index if not exists user_roles_role_idx on user_roles (role);

-- ---------------------------------------------------------------------------

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  student_code text not null unique,

  -- Nullable: a student record can exist (registration/lead conversion)
  -- before a portal login is provisioned. See DECISIONS_NEEDED.md D3.
  auth_user_id uuid unique references auth.users (id) on delete set null,

  first_name text not null,
  last_name text not null,
  preferred_name text,

  -- Contact email, intentionally NOT unique — see REQUIREMENTS.md §7 item 4
  -- (a shared family email is a legitimate scenario). Auth identity
  -- uniqueness is enforced separately by Supabase Auth on auth.users.email.
  email text,
  phone text not null,
  alternate_phone text,

  date_of_birth date,
  gender text,

  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',

  emergency_contact_name text,
  emergency_contact_phone text,

  registration_date date not null default current_date,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  profile_photo_path text,

  lead_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table students is
  'One permanent row per person who is or was a student. student_code is the permanent, immutable Student ID (REQUIREMENTS.md §7/§68).';
comment on column students.student_code is
  'Human-readable Student ID, assigned once from student_id_seq at insert. Never editable after creation (see the immutability trigger in a later migration).';
comment on column students.email is
  'Contact email — deliberately not unique. Auth login identity uniqueness lives on auth.users.email instead.';

create trigger students_set_updated_at
  before update on students
  for each row execute function set_updated_at();

create index if not exists students_phone_idx on students (phone);
create index if not exists students_email_idx on students (email);
create index if not exists students_status_idx on students (status);
create index if not exists students_name_idx
  on students (lower(first_name || ' ' || last_name));

-- Prevent student_code from ever being changed after creation (REQUIREMENTS.md
-- "Admin should not normally manually edit a Student ID" / immutability rule).
create or replace function prevent_student_code_change()
returns trigger
language plpgsql
as $$
begin
  if new.student_code is distinct from old.student_code then
    raise exception 'student_code is immutable and cannot be changed after creation';
  end if;
  return new;
end;
$$;

create trigger students_prevent_code_change
  before update on students
  for each row execute function prevent_student_code_change();

-- ---------------------------------------------------------------------------

create table if not exists trainers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  phone text,
  bio text,
  specialization text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table trainers is
  'Trainer profile, one per invited trainer auth account. Created/invited by Admin/Super Admin only.';

create trigger trainers_set_updated_at
  before update on trainers
  for each row execute function set_updated_at();

create index if not exists trainers_status_idx on trainers (status);

-- ---------------------------------------------------------------------------

create table if not exists admins (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  first_name text not null,
  last_name text not null,
  email text not null unique,
  role_level text not null check (role_level in ('admin', 'super_admin')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table admins is
  'Admin/Super Admin profile. role_level mirrors user_roles.role for convenience joins; user_roles remains authoritative for access control.';

create trigger admins_set_updated_at
  before update on admins
  for each row execute function set_updated_at();
