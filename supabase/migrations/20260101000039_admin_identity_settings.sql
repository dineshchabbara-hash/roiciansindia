-- Phase 21C (LMS Administration & Identity). FR-1/FR-4 + DECISIONS_NEEDED
-- D3 (Admin provisions Student portal logins), the role matrix's "Manage
-- Admin accounts (create/deactivate)" (Super Admin only), FR-140/FR-141
-- (Company Settings), FR-41 (Student profile photo) and the role matrix's
-- "View Audit Logs" (Super Admin full, Admin non-sensitive subset).
--
-- A read-only review of the dev project before this migration found:
--  - user_roles carried Admin INSERT/UPDATE/DELETE policies, so any Admin
--    could write any role row (including super_admin) — a role-escalation
--    path. Every legitimate role write in the application already runs
--    through the service role, so those policies are dropped.
--  - admins carried Super Admin INSERT/UPDATE/DELETE policies; Admin
--    account management now goes through the service-role functions below
--    after a server-side Super Admin check, so those are dropped too.
--  - students/trainers update policies let an Admin rewrite auth_user_id,
--    i.e. re-link a profile to any login. The link is now server-only.
--  - Nothing blocked a deactivated Admin (admins.status = 'inactive').
--  - students.profile_photo_path could be set to any string by the
--    student themselves (FR-41 self-edit path).
--  - audit_logs: Admin and Super Admin read everything; the matrix's
--    "non-sensitive subset" for Admin had been deferred until an entry
--    needed hiding — Admin account management is that entry.

-- 1. Identity writes are server-only -------------------------------------------

drop policy if exists user_roles_write_admin on user_roles;
drop policy if exists user_roles_update_admin on user_roles;
drop policy if exists user_roles_delete_admin on user_roles;

drop policy if exists admins_write_super on admins;
drop policy if exists admins_update_super on admins;
drop policy if exists admins_delete_super on admins;

-- The auth link of a profile changes only through trusted server code
-- (service role) or a direct database session (migrations / operators) —
-- never through an end-user (authenticated/anon) request.
create or replace function prevent_end_user_auth_link_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and new.auth_user_id is distinct from old.auth_user_id then
    raise exception using
      errcode = '42501',
      message = 'A profile''s login link can only be changed by the server (Phase 21C)';
  end if;
  return new;
end;
$$;

-- Named *_protect_auth_link so the pre-existing students self-edit trigger
-- (students_prevent_self_edit_protected_fields) still fires first and keeps
-- its own message for a student editing their own row.
comment on function prevent_end_user_auth_link_change() is
  'Phase 21C: students/trainers/admins.auth_user_id is server-authoritative — an end-user request can never re-link a profile to another login.';

create trigger students_protect_auth_link
  before update on students
  for each row execute function prevent_end_user_auth_link_change();
create trigger trainers_protect_auth_link
  before update on trainers
  for each row execute function prevent_end_user_auth_link_change();
create trigger admins_protect_auth_link
  before update on admins
  for each row execute function prevent_end_user_auth_link_change();

-- 2. A deactivated Admin loses Admin authority immediately --------------------
-- Only an explicitly inactive admins row blocks: role rows without an admins
-- profile (the documented one-time Super Admin bootstrap) keep working.

create or replace function is_admin_or_super()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from user_roles
    where auth_user_id = auth.uid() and role in ('admin', 'super_admin')
  ) and not exists (
    select 1 from admins
    where auth_user_id = auth.uid() and status = 'inactive'
  );
$$;

create or replace function is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from user_roles
    where auth_user_id = auth.uid() and role = 'super_admin'
  ) and not exists (
    select 1 from admins
    where auth_user_id = auth.uid() and status = 'inactive'
  );
$$;

-- 3. Company Settings (FR-140/FR-141) ------------------------------------------
-- Existing RLS is kept: Admin/Super Admin SELECT, Super Admin UPDATE, no
-- INSERT/DELETE for anyone. Constraints make a bad save impossible at the
-- database, mirroring the application validation. Numbering formats must keep
-- a {seq:N} token (the same rule next_receipt_number() /
-- generate_certificate_number() already fall back on).

alter table company_settings
  add constraint company_settings_names_present
  check (char_length(btrim(company_name)) between 1 and 120
         and char_length(btrim(legal_name)) between 1 and 200);

create or replace function is_valid_number_format(fmt text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select fmt is not null
     and char_length(fmt) between 6 and 40
     and fmt ~ '^([A-Za-z0-9/_-]|\{year\}|\{seq:([4-9]|1[0-2])\})+$'
     and regexp_count(fmt, '\{seq:') = 1
     and regexp_count(fmt, '\{year\}') <= 1;
$$;

comment on function is_valid_number_format(text) is
  'Phase 21C: a receipt/certificate number format is letters, digits, "-", "/", "_", at most one {year} and exactly one {seq:N} (N 4-12), 6-40 characters.';

alter table company_settings
  add constraint company_settings_receipt_format_valid
  check (is_valid_number_format(receipt_number_format));

alter table company_settings
  add constraint company_settings_certificate_format_valid
  check (is_valid_number_format(certificate_number_format));

alter table company_settings
  add constraint company_settings_logo_path_valid
  check (logo_path is null or logo_path ~ '^logo/[0-9a-f-]{36}\.(png|jpg|webp)$');

alter table company_settings
  add constraint company_settings_gstin_format
  check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

alter table company_settings
  add constraint company_settings_social_links_object
  check (jsonb_typeof(social_links) = 'object');

-- Brand logo: a public bucket (the logo is public branding, used later by
-- the public website). No end-user storage policy: the server writes it with
-- the service role after a Super Admin check.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

-- 4. FR-41 profile photo ---------------------------------------------------------
-- Private bucket, objects at {student_id}/{uuid}.{ext}. Readable by the
-- student who owns the folder and by Admin/Super Admin; written only by the
-- server (service role) after the student's own session is verified.

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

create policy profile_photos_select_admin on storage.objects
  for select using (bucket_id = 'profile-photos' and is_admin_or_super());

create policy profile_photos_select_own on storage.objects
  for select using (
    bucket_id = 'profile-photos'
    and split_part(name, '/', 1) = current_student_id()::text
  );

-- A student's photo path can only point inside their own folder.
alter table students
  add constraint students_profile_photo_path_own_folder
  check (profile_photo_path is null
         or profile_photo_path ~ ('^' || id::text || '/[0-9a-f-]{36}\.(png|jpg|webp)$'));

-- 5. Audit log visibility ------------------------------------------------------
-- Super Admin: everything. Admin: everything except Admin account
-- management (a Super Admin domain). audit_logs stays append-only: no
-- INSERT/UPDATE/DELETE policy for any end-user role (unchanged).

drop policy if exists audit_logs_select_admin on audit_logs;

create policy audit_logs_select_super on audit_logs
  for select using (is_super_admin());

create policy audit_logs_select_admin_subset on audit_logs
  for select using (is_admin_or_super() and entity_type <> 'admin_account');

create index if not exists audit_logs_action_idx on audit_logs (action);
create index if not exists audit_logs_actor_idx on audit_logs (actor_auth_user_id);

-- 6. Account provisioning (service role only) ----------------------------------

-- Facts about an existing login for one email, so the server can decide
-- whether provisioning may adopt it. Never returns password material —
-- only whether a password has been set.
create or replace function find_auth_account(p_email text)
returns table (
  auth_user_id uuid,
  has_password boolean,
  last_sign_in_at timestamptz,
  role text,
  student_id uuid,
  trainer_id uuid,
  admin_id uuid
)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  return query
  select u.id,
         coalesce(u.encrypted_password, '') <> '',
         u.last_sign_in_at,
         (select ur.role from public.user_roles ur where ur.auth_user_id = u.id),
         (select s.id from public.students s where s.auth_user_id = u.id),
         (select t.id from public.trainers t where t.auth_user_id = u.id),
         (select a.id from public.admins a where a.auth_user_id = u.id)
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
   limit 1;
end;
$$;

comment on function find_auth_account(text) is
  'Phase 21C: whether a login already exists for an email and what it is linked to (never password material). service_role only.';

revoke execute on function find_auth_account(text) from public, anon, authenticated;
grant execute on function find_auth_account(text) to service_role;

-- Sign-in activity for display ("awaiting activation" vs "active").
create or replace function auth_account_activity(p_auth_user_ids uuid[])
returns table (auth_user_id uuid, has_password boolean, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  return query
  select u.id, coalesce(u.encrypted_password, '') <> '', u.last_sign_in_at
    from auth.users u
   where u.id = any (p_auth_user_ids);
end;
$$;

comment on function auth_account_activity(uuid[]) is
  'Phase 21C: whether each login has set a password and when it last signed in. service_role only.';

revoke execute on function auth_account_activity(uuid[]) from public, anon, authenticated;
grant execute on function auth_account_activity(uuid[]) to service_role;

-- Links a login to an existing Student and gives it the student role, in
-- one transaction under a row lock on the student. Idempotent: linking the
-- same pair again reports already_linked and changes nothing.
create or replace function link_student_portal_account(p_student_id uuid, p_auth_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stu record;
  existing_role text;
begin
  if p_student_id is null or p_auth_user_id is null then
    raise exception using errcode = '22023', message = 'Student and login identifiers are required';
  end if;

  select s.id, s.status, s.auth_user_id into stu
    from students s where s.id = p_student_id for update;
  -- Serializes all links of one login, so two students racing for the same
  -- login get a clean account_in_use instead of a constraint error.
  perform pg_advisory_xact_lock(hashtext('portal_login:' || p_auth_user_id::text));
  if stu.id is null then
    return 'student_not_found';
  end if;
  if stu.auth_user_id = p_auth_user_id then
    return 'already_linked';
  end if;
  if stu.auth_user_id is not null then
    return 'student_has_other_account';
  end if;
  if stu.status <> 'active' then
    return 'student_inactive';
  end if;

  select ur.role into existing_role from user_roles ur where ur.auth_user_id = p_auth_user_id;
  if (existing_role is not null and existing_role <> 'student')
     or exists (select 1 from students s where s.auth_user_id = p_auth_user_id)
     or exists (select 1 from trainers t where t.auth_user_id = p_auth_user_id)
     or exists (select 1 from admins a where a.auth_user_id = p_auth_user_id) then
    return 'account_in_use';
  end if;

  if existing_role is null then
    insert into user_roles (auth_user_id, role) values (p_auth_user_id, 'student');
  end if;
  update students set auth_user_id = p_auth_user_id where id = p_student_id;
  return 'linked';
end;
$$;

comment on function link_student_portal_account(uuid, uuid) is
  'Phase 21C: links a login to an existing active Student and assigns the student role (fixed, never caller-chosen), under a student row lock. Idempotent. service_role only — the caller has already verified an Admin/Super Admin session.';

revoke execute on function link_student_portal_account(uuid, uuid) from public, anon, authenticated;
grant execute on function link_student_portal_account(uuid, uuid) to service_role;

-- Creates the Admin profile + admin role for a login. The role is fixed to
-- 'admin': no path here can create or promote a Super Admin.
create or replace function link_admin_account(
  p_auth_user_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text
)
returns table (admin_id uuid, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_role text;
  existing_admin record;
  new_id uuid;
begin
  if p_auth_user_id is null
     or nullif(btrim(coalesce(p_first_name, '')), '') is null
     or nullif(btrim(coalesce(p_last_name, '')), '') is null
     or nullif(btrim(coalesce(p_email, '')), '') is null then
    raise exception using errcode = '22023', message = 'Login, first name, last name and email are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('link_admin_account:' || p_auth_user_id::text));

  select a.id, a.role_level into existing_admin from admins a where a.auth_user_id = p_auth_user_id;
  select ur.role into existing_role from user_roles ur where ur.auth_user_id = p_auth_user_id;

  if existing_admin.id is not null then
    if existing_admin.role_level = 'admin' and existing_role = 'admin' then
      return query select existing_admin.id, 'already_admin'::text;
    else
      return query select null::uuid, 'account_in_use'::text;
    end if;
    return;
  end if;

  if existing_role is not null
     or exists (select 1 from students s where s.auth_user_id = p_auth_user_id)
     or exists (select 1 from trainers t where t.auth_user_id = p_auth_user_id) then
    return query select null::uuid, 'account_in_use'::text;
    return;
  end if;

  if exists (select 1 from admins a where lower(a.email) = lower(btrim(p_email))) then
    return query select null::uuid, 'email_in_use'::text;
    return;
  end if;

  insert into user_roles (auth_user_id, role) values (p_auth_user_id, 'admin');
  insert into admins (auth_user_id, first_name, last_name, email, role_level)
  values (p_auth_user_id, btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)), 'admin')
  returning id into new_id;

  return query select new_id, 'created'::text;
end;
$$;

comment on function link_admin_account(uuid, text, text, text) is
  'Phase 21C: creates an Admin profile and the admin role (fixed — never super_admin) for a login. Idempotent per login. service_role only — the caller has already verified a Super Admin session.';

revoke execute on function link_admin_account(uuid, text, text, text) from public, anon, authenticated;
grant execute on function link_admin_account(uuid, text, text, text) to service_role;

-- Deactivates / reactivates an Admin (role_level 'admin' only — a Super
-- Admin account is not manageable here).
create or replace function set_admin_account_status(p_admin_id uuid, p_status text)
returns table (auth_user_id uuid, outcome text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  adm record;
begin
  if p_status is null or p_status not in ('active', 'inactive') then
    raise exception using errcode = '22023', message = 'Status must be active or inactive';
  end if;
  select a.id, a.auth_user_id, a.role_level, a.status into adm
    from admins a where a.id = p_admin_id for update;
  if adm.id is null then
    return query select null::uuid, 'not_found'::text;
    return;
  end if;
  if adm.role_level <> 'admin' then
    return query select adm.auth_user_id, 'not_manageable'::text;
    return;
  end if;
  if adm.status = p_status then
    return query select adm.auth_user_id, 'unchanged'::text;
    return;
  end if;
  update admins set status = p_status where id = adm.id;
  return query select adm.auth_user_id, 'updated'::text;
end;
$$;

comment on function set_admin_account_status(uuid, text) is
  'Phase 21C: activates/deactivates an Admin account (role_level admin only). An inactive Admin fails is_admin_or_super() immediately. service_role only — the caller has already verified a Super Admin session.';

revoke execute on function set_admin_account_status(uuid, text) from public, anon, authenticated;
grant execute on function set_admin_account_status(uuid, text) to service_role;
