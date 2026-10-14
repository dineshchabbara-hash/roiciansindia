-- Phase 21C (LMS Administration & Identity) regression suite for
-- 20260101000039_admin_identity_settings.sql:
--
--   - identity writes are server-only: no end-user write policy on
--     user_roles/admins; an Admin cannot insert/promote roles, create admin
--     profiles, or re-link a profile's login (students/trainers/admins).
--   - deactivated Admin: loses is_admin_or_super() at once; bootstrap role
--     rows without an admins profile keep working.
--   - Company Settings: Super Admin updates, Admin reads only, Student /
--     Trainer / anon see nothing; numbering formats, GSTIN and logo path
--     are validated by the database.
--   - provisioning functions are service_role only, idempotent, assign a
--     fixed role, and refuse logins already in use or students already
--     linked; Admin account creation can never create a Super Admin;
--     deactivation only applies to role_level admin.
--   - audit_logs: Super Admin reads all, Admin everything except
--     admin_account entries; still no end-user write policy.
--   - FR-41 photo: a student's photo path must sit in their own folder;
--     profile-photos objects are visible to the owner and Admins only.
--
-- Ends with ROLLBACK.

begin;

insert into auth.users (id, email, encrypted_password) values
  ('21c00000-0000-0000-0000-000000000001', 'phase21c-super@validation.local', 'x'),
  ('21c00000-0000-0000-0000-000000000002', 'phase21c-admin@validation.local', 'x'),
  ('21c00000-0000-0000-0000-000000000003', 'phase21c-trainer@validation.local', 'x'),
  ('21c00000-0000-0000-0000-000000000004', 'phase21c-student-a@validation.local', 'x'),
  ('21c00000-0000-0000-0000-000000000005', 'phase21c-bootstrap@validation.local', 'x'),
  -- logins created by provisioning (no password yet)
  ('21c00000-0000-0000-0000-000000000011', 'phase21c-student-b@validation.local', null),
  ('21c00000-0000-0000-0000-000000000012', 'phase21c-other@validation.local', null),
  ('21c00000-0000-0000-0000-000000000013', 'phase21c-new-admin@validation.local', null);

insert into user_roles (auth_user_id, role) values
  ('21c00000-0000-0000-0000-000000000001', 'super_admin'),
  ('21c00000-0000-0000-0000-000000000002', 'admin'),
  ('21c00000-0000-0000-0000-000000000003', 'trainer'),
  ('21c00000-0000-0000-0000-000000000004', 'student'),
  ('21c00000-0000-0000-0000-000000000005', 'super_admin');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('21c10000-0000-0000-0000-000000000001', '21c00000-0000-0000-0000-000000000001', 'Phase21C', 'Super', 'phase21c-super@validation.local', 'super_admin'),
  ('21c10000-0000-0000-0000-000000000002', '21c00000-0000-0000-0000-000000000002', 'Phase21C', 'Admin', 'phase21c-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('21c20000-0000-0000-0000-000000000001', '21c00000-0000-0000-0000-000000000003', 'Phase21C', 'Trainer', 'phase21c-trainer@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email, status) values
  ('21c30000-0000-0000-0000-000000000001', '21c00000-0000-0000-0000-000000000004', 'Phase21C', 'StudentA', '9990021301', 'phase21c-student-a@validation.local', 'active'),
  ('21c30000-0000-0000-0000-000000000002', null, 'Phase21C', 'StudentB', '9990021302', 'phase21c-student-b@validation.local', 'active'),
  ('21c30000-0000-0000-0000-000000000003', null, 'Phase21C', 'Inactive', '9990021303', 'phase21c-inactive@validation.local', 'inactive');

insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, after_data) values
  ('21c00000-0000-0000-0000-000000000001', 'super_admin', 'admin_account.created', 'admin_account', '21c10000-0000-0000-0000-000000000002', '{"email":"x"}'),
  ('21c00000-0000-0000-0000-000000000002', 'admin', 'student.portal_access_granted', 'student', '21c30000-0000-0000-0000-000000000001', '{"studentCode":"1"}');

insert into storage.objects (bucket_id, name) values
  ('profile-photos', '21c30000-0000-0000-0000-000000000001/aaaaaaaa-0000-4000-8000-000000000001.jpg'),
  ('profile-photos', '21c30000-0000-0000-0000-000000000002/aaaaaaaa-0000-4000-8000-000000000002.jpg');

-- ---------------------------------------------------------------------------
-- Grants and policies.

do $$
declare
  r text;
  fn text;
begin
  foreach fn in array array[
    'find_auth_account(text)',
    'auth_account_activity(uuid[])',
    'link_student_portal_account(uuid, uuid)',
    'link_admin_account(uuid, text, text, text)',
    'set_admin_account_status(uuid, text)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, fn, 'execute') then
        raise exception 'FAIL: % must not execute %', r, fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'FAIL: service_role must execute %', fn;
    end if;
  end loop;
  if exists (select 1 from pg_policies where tablename in ('user_roles', 'admins') and cmd <> 'SELECT') then
    raise exception 'FAIL: user_roles/admins must have SELECT policies only';
  end if;
  if exists (select 1 from pg_policies where tablename = 'audit_logs' and cmd <> 'SELECT') then
    raise exception 'FAIL: audit_logs must stay append-only (SELECT policies only)';
  end if;
  if exists (select 1 from pg_policies where tablename = 'company_settings' and cmd in ('INSERT', 'DELETE')) then
    raise exception 'FAIL: company_settings must have no insert/delete policy';
  end if;
  raise notice 'PASS: provisioning functions are service_role only; user_roles/admins/audit_logs have no end-user write policy';
end
$$;

-- ---------------------------------------------------------------------------
-- An Admin cannot escalate roles or re-link logins.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n int;
begin
  begin
    insert into user_roles (auth_user_id, role) values ('21c00000-0000-0000-0000-000000000012', 'super_admin');
    raise exception 'FAIL: Admin inserted a user_roles row';
  exception when insufficient_privilege then null;
  end;

  update user_roles set role = 'super_admin' where auth_user_id = '21c00000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Admin promoted their own role'; end if;

  delete from user_roles where auth_user_id = '21c00000-0000-0000-0000-000000000004';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Admin deleted a role'; end if;

  begin
    insert into admins (auth_user_id, first_name, last_name, email, role_level)
    values ('21c00000-0000-0000-0000-000000000012', 'X', 'Y', 'x@y.local', 'super_admin');
    raise exception 'FAIL: Admin created an admins row';
  exception when insufficient_privilege then null;
  end;

  begin
    update students set auth_user_id = '21c00000-0000-0000-0000-000000000012'
     where id = '21c30000-0000-0000-0000-000000000002';
    raise exception 'FAIL: Admin re-linked a student login';
  exception when insufficient_privilege then null;
  end;

  begin
    update trainers set auth_user_id = '21c00000-0000-0000-0000-000000000012'
     where id = '21c20000-0000-0000-0000-000000000001';
    raise exception 'FAIL: Admin re-linked a trainer login';
  exception when insufficient_privilege then null;
  end;

  -- Ordinary profile edits are unaffected.
  update students set phone = '9990021399' where id = '21c30000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: Admin profile edit stopped working'; end if;

  raise notice 'PASS: Admin cannot insert/promote/delete roles, create admin profiles or re-link a login; ordinary edits still work';
end
$$;

-- Super Admin cannot write roles or admins directly either (server-only).
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  n int;
begin
  begin
    insert into user_roles (auth_user_id, role) values ('21c00000-0000-0000-0000-000000000012', 'admin');
    raise exception 'FAIL: Super Admin wrote user_roles directly';
  exception when insufficient_privilege then null;
  end;
  update admins set role_level = 'super_admin' where id = '21c10000-0000-0000-0000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Super Admin promoted an admin row directly'; end if;
  raise notice 'PASS: role and admin-profile writes go through the server only, even for a Super Admin session';
end
$$;

-- ---------------------------------------------------------------------------
-- Company Settings.

do $$
declare
  n int;
begin
  update company_settings set company_name = 'Phase21C Brand', address = '1 Test Road', gstin = '29ABCDE1234F1Z5'
   where singleton;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: Super Admin could not update company settings'; end if;

  begin
    update company_settings set receipt_number_format = 'REC-{year}' where singleton;
    raise exception 'FAIL: a format without {seq:N} was accepted';
  exception when check_violation then null;
  end;
  begin
    update company_settings set certificate_number_format = 'C-{seq:6}-{seq:6}' where singleton;
    raise exception 'FAIL: a format with two {seq:N} tokens was accepted';
  exception when check_violation then null;
  end;
  begin
    update company_settings set receipt_number_format = 'REC <x>{seq:6}' where singleton;
    raise exception 'FAIL: a format with unsafe characters was accepted';
  exception when check_violation then null;
  end;
  begin
    update company_settings set gstin = 'NOT-A-GSTIN' where singleton;
    raise exception 'FAIL: an invalid GSTIN was accepted';
  exception when check_violation then null;
  end;
  begin
    update company_settings set logo_path = '../secret.png' where singleton;
    raise exception 'FAIL: an arbitrary logo path was accepted';
  exception when check_violation then null;
  end;
  begin
    update company_settings set company_name = '  ' where singleton;
    raise exception 'FAIL: a blank brand name was accepted';
  exception when check_violation then null;
  end;
  update company_settings set receipt_number_format = 'RCPT/{seq:7}/{year}' where singleton;
  raise notice 'PASS: Super Admin edits settings; formats, GSTIN, logo path and names are validated by the database';
end
$$;

set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n int;
  brand text;
begin
  select company_name into brand from company_settings where singleton;
  if brand is distinct from 'Phase21C Brand' then raise exception 'FAIL: Admin cannot read settings (%)', brand; end if;
  update company_settings set company_name = 'Admin Was Here' where singleton;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Admin updated company settings'; end if;
  raise notice 'PASS: Admin reads company settings but cannot change them';
end
$$;

set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if exists (select 1 from company_settings) then raise exception 'FAIL: Trainer sees company settings'; end if;
end
$$;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if exists (select 1 from company_settings) then raise exception 'FAIL: Student sees company settings'; end if;
end
$$;
reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $$
begin
  -- anon cannot even evaluate the role helpers (no EXECUTE) — a denial
  -- either way.
  begin
    if exists (select 1 from company_settings) then raise exception 'FAIL: anon sees company settings'; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: Trainer, Student and anon cannot read company settings';
end
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Student portal provisioning (service role).

set local role service_role;
set local "request.jwt.claims" to '{"role":"service_role"}';

do $$
declare
  r record;
  outcome text;
begin
  select * into r from find_auth_account('PHASE21C-student-b@validation.local');
  if r.auth_user_id is distinct from '21c00000-0000-0000-0000-000000000011' or r.has_password
     or r.role is not null or r.student_id is not null then
    raise exception 'FAIL: find_auth_account mis-described a fresh login: %', row_to_json(r);
  end if;

  outcome := link_student_portal_account('21c30000-0000-0000-0000-000000000002', '21c00000-0000-0000-0000-000000000011');
  if outcome <> 'linked' then raise exception 'FAIL: first link returned %', outcome; end if;
  if (select role from user_roles where auth_user_id = '21c00000-0000-0000-0000-000000000011') is distinct from 'student' then
    raise exception 'FAIL: provisioned login did not get the student role';
  end if;
  if (select auth_user_id from students where id = '21c30000-0000-0000-0000-000000000002') is distinct from '21c00000-0000-0000-0000-000000000011' then
    raise exception 'FAIL: student not linked to the login';
  end if;

  outcome := link_student_portal_account('21c30000-0000-0000-0000-000000000002', '21c00000-0000-0000-0000-000000000011');
  if outcome <> 'already_linked' then raise exception 'FAIL: retry returned %', outcome; end if;
  if (select count(*) from user_roles where auth_user_id = '21c00000-0000-0000-0000-000000000011') <> 1 then
    raise exception 'FAIL: retry duplicated the role';
  end if;

  outcome := link_student_portal_account('21c30000-0000-0000-0000-000000000002', '21c00000-0000-0000-0000-000000000012');
  if outcome <> 'student_has_other_account' then raise exception 'FAIL: second login for a linked student returned %', outcome; end if;

  -- The login already linked to Student B cannot be linked to Student A's
  -- record or reused for another student.
  outcome := link_student_portal_account('21c30000-0000-0000-0000-000000000003', '21c00000-0000-0000-0000-000000000011');
  if outcome not in ('account_in_use', 'student_inactive') then raise exception 'FAIL: reused login returned %', outcome; end if;

  outcome := link_student_portal_account('21c30000-0000-0000-0000-000000000003', '21c00000-0000-0000-0000-000000000012');
  if outcome <> 'student_inactive' then raise exception 'FAIL: inactive student returned %', outcome; end if;

  -- A trainer / admin / other-role login is never adopted as a student.
  update students set status = 'active' where id = '21c30000-0000-0000-0000-000000000003';
  outcome := link_student_portal_account('21c30000-0000-0000-0000-000000000003', '21c00000-0000-0000-0000-000000000003');
  if outcome <> 'account_in_use' then raise exception 'FAIL: trainer login returned %', outcome; end if;
  outcome := link_student_portal_account('21c30000-0000-0000-0000-000000000003', '21c00000-0000-0000-0000-000000000002');
  if outcome <> 'account_in_use' then raise exception 'FAIL: admin login returned %', outcome; end if;
  if exists (select 1 from user_roles where auth_user_id in ('21c00000-0000-0000-0000-000000000003', '21c00000-0000-0000-0000-000000000002') and role = 'student') then
    raise exception 'FAIL: a staff login got a student role';
  end if;

  outcome := link_student_portal_account('21c30000-0000-0000-0000-0000000000ff', '21c00000-0000-0000-0000-000000000012');
  if outcome <> 'student_not_found' then raise exception 'FAIL: unknown student returned %', outcome; end if;

  select * into r from find_auth_account('phase21c-student-b@validation.local');
  if r.student_id is distinct from '21c30000-0000-0000-0000-000000000002' or r.role <> 'student' then
    raise exception 'FAIL: find_auth_account did not report the new link';
  end if;
  raise notice 'PASS: student provisioning links once with a fixed student role, is idempotent, and refuses linked students, inactive students and logins in use';
end
$$;

-- ---------------------------------------------------------------------------
-- Admin accounts (service role).

do $$
declare
  r record;
begin
  select * into r from link_admin_account('21c00000-0000-0000-0000-000000000013', 'New', 'Admin', 'Phase21C-New-Admin@validation.local');
  if r.outcome <> 'created' or r.admin_id is null then raise exception 'FAIL: admin creation returned %', r.outcome; end if;
  if (select role from user_roles where auth_user_id = '21c00000-0000-0000-0000-000000000013') <> 'admin'
     or (select role_level from admins where id = r.admin_id) <> 'admin'
     or (select email from admins where id = r.admin_id) <> 'phase21c-new-admin@validation.local' then
    raise exception 'FAIL: new admin is not a plain admin with a normalized email';
  end if;

  select * into r from link_admin_account('21c00000-0000-0000-0000-000000000013', 'New', 'Admin', 'phase21c-new-admin@validation.local');
  if r.outcome <> 'already_admin' then raise exception 'FAIL: admin retry returned %', r.outcome; end if;
  if (select count(*) from admins where auth_user_id = '21c00000-0000-0000-0000-000000000013') <> 1 then
    raise exception 'FAIL: admin retry duplicated the profile';
  end if;

  select * into r from link_admin_account('21c00000-0000-0000-0000-000000000004', 'Student', 'A', 'other@validation.local');
  if r.outcome <> 'account_in_use' then raise exception 'FAIL: student login as admin returned %', r.outcome; end if;
  select * into r from link_admin_account('21c00000-0000-0000-0000-000000000001', 'Super', 'X', 'super2@validation.local');
  if r.outcome <> 'account_in_use' then raise exception 'FAIL: super admin login re-used returned %', r.outcome; end if;
  select * into r from link_admin_account('21c00000-0000-0000-0000-000000000012', 'Dup', 'Email', 'phase21c-admin@validation.local');
  if r.outcome <> 'email_in_use' then raise exception 'FAIL: duplicate admin email returned %', r.outcome; end if;
  if exists (select 1 from user_roles where auth_user_id = '21c00000-0000-0000-0000-000000000012') then
    raise exception 'FAIL: a refused admin creation left a role behind';
  end if;

  select * into r from set_admin_account_status('21c10000-0000-0000-0000-000000000001', 'inactive');
  if r.outcome <> 'not_manageable' then raise exception 'FAIL: deactivating a super admin returned %', r.outcome; end if;
  select * into r from set_admin_account_status('21c10000-0000-0000-0000-000000000002', 'inactive');
  if r.outcome <> 'updated' or r.auth_user_id <> '21c00000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: deactivating an admin returned %', r.outcome;
  end if;
  select * into r from set_admin_account_status('21c10000-0000-0000-0000-000000000002', 'inactive');
  if r.outcome <> 'unchanged' then raise exception 'FAIL: repeated deactivation returned %', r.outcome; end if;
  raise notice 'PASS: admin creation is fixed to role admin, idempotent, refuses logins/emails in use; only plain admins can be deactivated';
end
$$;

reset role;

-- The deactivated Admin loses Admin authority immediately; the bootstrap
-- Super Admin without an admins row keeps it.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if is_admin_or_super() then raise exception 'FAIL: inactive admin still passes is_admin_or_super()'; end if;
  if exists (select 1 from company_settings) or exists (select 1 from students) then
    raise exception 'FAIL: inactive admin still reads admin data';
  end if;
end
$$;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000005","role":"authenticated"}';
do $$
begin
  if not is_super_admin() or not is_admin_or_super() then
    raise exception 'FAIL: bootstrap super admin without an admins row lost access';
  end if;
  raise notice 'PASS: a deactivated admin loses access at once; a bootstrap super admin without a profile row keeps it';
end
$$;
reset role;

set local role service_role;
set local "request.jwt.claims" to '{"role":"service_role"}';
select * from set_admin_account_status('21c10000-0000-0000-0000-000000000002', 'active');
reset role;

-- ---------------------------------------------------------------------------
-- Audit log visibility.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if not is_admin_or_super() then raise exception 'FAIL: reactivated admin has no access'; end if;
  if exists (select 1 from audit_logs where entity_type = 'admin_account') then
    raise exception 'FAIL: Admin sees admin_account audit entries';
  end if;
  if not exists (select 1 from audit_logs where action = 'student.portal_access_granted') then
    raise exception 'FAIL: Admin cannot see ordinary audit entries';
  end if;
  begin
    insert into audit_logs (action, entity_type, entity_id) values ('x', 'y', gen_random_uuid());
    raise exception 'FAIL: Admin wrote an audit row';
  exception when insufficient_privilege then null;
  end;
end
$$;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  n int;
begin
  if not exists (select 1 from audit_logs where entity_type = 'admin_account') then
    raise exception 'FAIL: Super Admin cannot see admin_account entries';
  end if;
  delete from audit_logs;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Super Admin deleted audit rows'; end if;
  update audit_logs set action = 'tampered';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Super Admin updated audit rows'; end if;
end
$$;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if exists (select 1 from audit_logs) then raise exception 'FAIL: Student sees audit rows'; end if;
end
$$;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if exists (select 1 from audit_logs) then raise exception 'FAIL: Trainer sees audit rows'; end if;
  raise notice 'PASS: Super Admin reads all audit rows, Admin all but admin_account, Student/Trainer none; nobody updates or deletes';
end
$$;

-- ---------------------------------------------------------------------------
-- FR-41 profile photo.

set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
declare
  n int;
begin
  update students set profile_photo_path = '21c30000-0000-0000-0000-000000000001/bbbbbbbb-0000-4000-8000-000000000001.jpg'
   where id = '21c30000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: student could not set their own photo path'; end if;
  begin
    update students set profile_photo_path = '21c30000-0000-0000-0000-000000000002/aaaaaaaa-0000-4000-8000-000000000002.jpg'
     where id = '21c30000-0000-0000-0000-000000000001';
    raise exception 'FAIL: student pointed their photo at another student''s file';
  exception when check_violation then null;
  end;
  if (select count(*) from storage.objects where bucket_id = 'profile-photos') <> 1
     or not exists (select 1 from storage.objects where bucket_id = 'profile-photos' and name like '21c30000-0000-0000-0000-000000000001/%') then
    raise exception 'FAIL: student sees photo objects other than their own';
  end if;
  begin
    insert into storage.objects (bucket_id, name) values ('profile-photos', '21c30000-0000-0000-0000-000000000001/x.jpg');
    raise exception 'FAIL: student wrote a storage object directly';
  exception when insufficient_privilege then null;
  end;
end
$$;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'profile-photos') then
    raise exception 'FAIL: Trainer sees profile photos';
  end if;
end
$$;
set local "request.jwt.claims" to '{"sub":"21c00000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'profile-photos') <> 2 then
    raise exception 'FAIL: Admin cannot see profile photos';
  end if;
  raise notice 'PASS: a photo path stays in the student''s own folder; photos are visible to the owner and Admins only; no direct writes';
end
$$;
reset role;

rollback;
