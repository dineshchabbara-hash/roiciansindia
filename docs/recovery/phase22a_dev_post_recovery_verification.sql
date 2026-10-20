-- =============================================================================
-- Phase 22A — DEV POST-RECOVERY FUNCTIONAL VERIFICATION
-- ENVIRONMENT-SPECIFIC (Supabase project nqeaehqzhjhhgsilrgeo only), NOT A
-- MIGRATION, NOT AUTHORIZED FOR EXECUTION without separate explicit approval.
-- Run only AFTER docs/recovery/phase22a_dev_recovery.sql has committed.
--
-- One transaction that ends in ROLLBACK. Synthetic fixtures only (ids 22d…,
-- e-mails @validation.local, codes P22D-…); no existing record is read for
-- content, changed or deleted.
--
-- Why ROLLBACK is sufficient here, and its limits:
--   * every row written (auth.users, user_roles, admins, trainers, students,
--     programs, program_modules, enrollments, website rows, audit_logs) is
--     transactional and disappears on ROLLBACK;
--   * sequences are NOT transactional: every fixture supplies its own code
--     (student_code, enrollment_code; no payments or certificates are
--     created), and the script records all public sequence positions first
--     and fails before the ROLLBACK if any moved;
--   * no external message can be sent: the script refuses if pg_net / http
--     extensions, auth.users triggers or webhook triggers exist (none on DEV
--     at review time); Supabase Auth e-mails are sent by the Auth API, not by
--     rows in auth.users;
--   * remaining non-transactional traces: server logs, WAL and
--     pg_stat_statements may record these statements and synthetic values.
-- =============================================================================

begin;
set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- 0. Target, recovery state and side-effect preconditions -------------------------
do $pre$
begin
  if (select system_identifier::text from pg_control_system()) <> '7678069749886157684' then
    raise exception 'verification: wrong database cluster';
  end if;
  if current_database() <> 'postgres' or current_user <> 'postgres' then
    raise exception 'verification: run as postgres on database postgres';
  end if;
  if (select md5(string_agg(version || ':' || name, ',' order by version collate "C")) from supabase_migrations.schema_migrations)
     <> 'bf94f88d0d898a25a3910f3d4e287925' then
    raise exception 'verification: migration history is not migrations 1-42 (recovery not applied?)';
  end if;
  if exists (select 1 from pg_extension where extname in ('pg_net', 'http', 'pgsql-http')) then
    raise exception 'verification: an HTTP extension is installed; side effects cannot be ruled out';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal) then
    raise exception 'verification: auth.users has triggers; side effects cannot be ruled out';
  end if;
  if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
              where not t.tgisinternal and n.nspname in ('supabase_functions', 'net')) then
    raise exception 'verification: webhook triggers exist; side effects cannot be ruled out';
  end if;
  if exists (select 1 from programs where program_code like 'P22D-%') then
    raise exception 'verification: synthetic codes already in use';
  end if;
end
$pre$;

create temp table p22d_sequences on commit drop as
  select schemaname, sequencename, last_value from pg_sequences where schemaname = 'public';

-- 1. Synthetic identities --------------------------------------------------------
insert into auth.users (id, email) values
  ('22d00000-0000-4000-8000-000000000001', 'p22d-super@validation.local'),
  ('22d00000-0000-4000-8000-000000000002', 'p22d-admin@validation.local'),
  ('22d00000-0000-4000-8000-000000000003', 'p22d-trainer@validation.local'),
  ('22d00000-0000-4000-8000-000000000004', 'p22d-student@validation.local'),
  ('22d00000-0000-4000-8000-000000000005', 'p22d-inactive@validation.local');
insert into user_roles (auth_user_id, role) values
  ('22d00000-0000-4000-8000-000000000001', 'super_admin'),
  ('22d00000-0000-4000-8000-000000000002', 'admin'),
  ('22d00000-0000-4000-8000-000000000003', 'trainer'),
  ('22d00000-0000-4000-8000-000000000004', 'student'),
  ('22d00000-0000-4000-8000-000000000005', 'admin');
insert into admins (id, auth_user_id, first_name, last_name, email, role_level, status) values
  ('22d10000-0000-4000-8000-000000000001', '22d00000-0000-4000-8000-000000000001', 'P22D', 'Super', 'p22d-super@validation.local', 'super_admin', 'active'),
  ('22d10000-0000-4000-8000-000000000002', '22d00000-0000-4000-8000-000000000002', 'P22D', 'Admin', 'p22d-admin@validation.local', 'admin', 'active'),
  ('22d10000-0000-4000-8000-000000000005', '22d00000-0000-4000-8000-000000000005', 'P22D', 'Inactive', 'p22d-inactive@validation.local', 'admin', 'inactive');
insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('22d20000-0000-4000-8000-000000000001', '22d00000-0000-4000-8000-000000000003', 'P22D', 'Trainer', 'p22d-trainer@validation.local');
insert into students (id, student_code, auth_user_id, first_name, last_name, phone, status) values
  ('22d30000-0000-4000-8000-000000000001', 'P22D-STU-1', '22d00000-0000-4000-8000-000000000004', 'P22D', 'Student', '9990022901', 'active');
insert into programs (id, program_code, name, regular_fee, status) values
  ('22d40000-0000-4000-8000-000000000001', 'P22D-ACTIVE', 'P22D Active', 1000, 'active'),
  ('22d40000-0000-4000-8000-000000000002', 'P22D-SAFE', 'P22D Safe Archived', 1000, 'archived'),
  ('22d40000-0000-4000-8000-000000000003', 'P22D-MODULE', 'P22D With Module', 1000, 'archived'),
  ('22d40000-0000-4000-8000-000000000004', 'P22D-ENROL', 'P22D Enrollment Removed', 1000, 'archived');
insert into program_modules (program_id, title, sequence) values ('22d40000-0000-4000-8000-000000000003', 'P22D module', 1);
insert into enrollments (id, enrollment_code, student_id, program_id, regular_fee, agreed_fee, total_payable, status) values
  ('22d60000-0000-4000-8000-000000000004', 'P22D-ENR-4', '22d30000-0000-4000-8000-000000000001', '22d40000-0000-4000-8000-000000000004', 1000, 1000, 1000, 'cancelled');
insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, after_data) values
  ('22d00000-0000-4000-8000-000000000002', 'admin', 'program.create', 'program', '22d40000-0000-4000-8000-000000000002', '{"programCode":"P22D-SAFE"}');

-- 2. Website management as Admin (real PostgREST role, real RLS) ------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22d00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $v$
declare
  d uuid; pl uuid; r record; r2 record;
begin
  d := website_create_program_document('22d40000-0000-4000-8000-000000000001', 'p22d-verification-program');
  select * into r from website_save_draft(d, 0, 'P22D headline', null, null, null, null, null, null, null,
    '[{"key":"overview","type":"text","body":"Synthetic verification text."}]'::jsonb);
  perform website_publish_document(d, r.revision_id);
  select * into r2 from website_save_draft(d, 1, 'P22D headline v2', null, null, null, null, null, null, null, '[]'::jsonb);
  if (select published_revision_id from website_documents where id = d) <> r.revision_id then
    raise exception 'FAIL: draft replaced published content';
  end if;
  begin
    perform website_save_draft(d, 1, 'stale', null, null, null, null, null, null, null, '[]'::jsonb);
    raise exception 'FAIL: stale save accepted';
  exception when sqlstate 'P2203' then null;
  end;
  begin
    perform website_publish_document(d, r.revision_id);
    raise exception 'FAIL: stale publish accepted';
  exception when sqlstate 'P2203' then null;
  end;
  perform website_restore_revision(d, r.revision_id, 2);
  pl := website_create_page('programs_listing', 'p22d-programs');
  perform website_save_draft(pl, 0, 'Programs', null, null, null, null, null, null, null,
    '[{"key":"faq","type":"faq","items":[{"question":"Q","answer":"A"}]}]'::jsonb);
  perform website_create_page('upcoming_batches', 'p22d-upcoming');
  begin
    perform website_audit('forged', 'program', gen_random_uuid(), null, null);
    raise exception 'FAIL: Admin called an internal helper';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from programs where id = '22d40000-0000-4000-8000-000000000002';
    raise exception 'FAIL: Admin deleted a Program directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform delete_archived_program('22d40000-0000-4000-8000-000000000002', 'P22D-SAFE', 'Admin attempt');
    raise exception 'FAIL: Admin used the deletion function';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS V2: Admin drafts, publishes, restores, edits listing pages; stale edits and direct/functional Program deletion refused';
end
$v$;

-- 3. Trainer / Student / inactive Admin / anon -----------------------------------
do $v$
declare
  who text;
begin
  foreach who in array array['22d00000-0000-4000-8000-000000000003', '22d00000-0000-4000-8000-000000000004',
                             '22d00000-0000-4000-8000-000000000005'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
    if (select count(*) from website_documents) + (select count(*) from website_document_revisions) <> 0 then
      raise exception 'FAIL: % can read website drafts', who;
    end if;
    begin
      perform website_create_page('about', 'p22d-about');
      raise exception 'FAIL: % created a page', who;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS V3: Trainer, Student and inactive Admin see no website drafts and cannot write';
end
$v$;
reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $v$
begin
  begin
    perform 1 from website_documents limit 1;
    raise exception 'FAIL: anon read website_documents';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS V3b: anon has no access';
end
$v$;
reset role;

-- 4. service_role: helpers and forged marker --------------------------------------
set local role service_role;
do $v$
begin
  begin
    perform program_deletion_blockers_internal('22d40000-0000-4000-8000-000000000002');
    raise exception 'FAIL: service_role called an internal helper';
  exception when insufficient_privilege then null;
  end;
  perform set_config('roicians.program_delete_authorized', '22d40000-0000-4000-8000-000000000003', true);
  begin
    delete from programs where id = '22d40000-0000-4000-8000-000000000003';
    raise exception 'FAIL: service_role deleted a Program with a forged marker';
  exception when insufficient_privilege then null;
  end;
  perform set_config('roicians.program_delete_authorized', '', true);
  -- privileged enrollment removal (as a service-role cleanup would do)
  delete from enrollments where id = '22d60000-0000-4000-8000-000000000004';
  raise notice 'PASS V4: service_role cannot call helpers or delete with a forged marker';
end
$v$;
reset role;

-- 5. Super Admin deletion workflow ---------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22d00000-0000-4000-8000-000000000001","role":"authenticated"}';
do $v$
declare
  codes text;
  a uuid;
begin
  select string_agg(code, ',') into codes from program_deletion_blockers('22d40000-0000-4000-8000-000000000001');
  if codes !~ 'not_archived' then raise exception 'FAIL: unarchived not blocked (%)', codes; end if;
  select string_agg(code, ',') into codes from program_deletion_blockers('22d40000-0000-4000-8000-000000000003');
  if codes is distinct from 'dependency:program_modules' then raise exception 'FAIL: module dependency (%)', codes; end if;
  select string_agg(code, ',') into codes from program_deletion_blockers('22d40000-0000-4000-8000-000000000004');
  if codes !~ 'audit_history' then raise exception 'FAIL: removed enrollment did not leave blocking evidence (%)', codes; end if;
  if exists (select 1 from program_deletion_blockers('22d40000-0000-4000-8000-000000000002')) then
    raise exception 'FAIL: synthetic new Program blocked (%)', (select string_agg(code, ',') from program_deletion_blockers('22d40000-0000-4000-8000-000000000002'));
  end if;
  a := delete_archived_program('22d40000-0000-4000-8000-000000000002', 'P22D-SAFE', 'Verification');
  if exists (select 1 from programs where id = '22d40000-0000-4000-8000-000000000002')
     or not exists (select 1 from audit_logs where id = a and action = 'program.deleted')
     or not exists (select 1 from audit_logs where entity_id = '22d40000-0000-4000-8000-000000000002' and action = 'program.create') then
    raise exception 'FAIL: controlled deletion or audit retention';
  end if;
  raise notice 'PASS V5: unarchived, dependency and deleted-history blockers hold; a new safe Program is deleted with its audit record kept';
end
$v$;
reset role;

-- 6. No sequence advanced ----------------------------------------------------------
do $v$
begin
  if exists (select 1 from p22d_sequences t
               join pg_sequences s on s.schemaname = t.schemaname and s.sequencename = t.sequencename
              where s.last_value is distinct from t.last_value)
     or (select count(*) from pg_sequences where schemaname = 'public') <> (select count(*) from p22d_sequences) then
    raise exception 'FAIL: a sequence advanced during verification';
  end if;
  raise notice 'PASS V6: no sequence advanced';
end
$v$;

rollback;
