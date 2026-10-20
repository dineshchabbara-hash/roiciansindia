-- Phase 22A corrections regression suite for
--   20260101000042_phase22a_corrections.sql
-- (docs/recovery/PHASE_22A_RECOVERY_REVIEW.md).
--
--   K1  privileges: Phase 22 internal helpers are executable by no API role
--       (PUBLIC, anon, authenticated, service_role); self-checking management
--       functions keep their grants; guard is not SECURITY DEFINER; no other
--       function deletes Programs.
--   K2  Programs-listing and Upcoming-Batches pages: single instance,
--       allowed sections only, draft/publish/stable published/restore/
--       unpublish.
--   K3  programs.created_at cannot be changed or set in the future.
--   K4  helper calls are denied to service_role/authenticated while the
--       authorized workflows (which use them internally) still work.
--   K5  forged deletion marker: denied for anon/authenticated (no DELETE
--       privilege) and for service_role (guard); the controlled Super Admin
--       function still deletes; the database owner can bypass (documented).
--   K6  delete-evidence: an enrollment removed by a privileged route, a Batch
--       removed by an Admin through the existing policy, and a certificate
--       removed by the owner each leave <entity>.row_deleted naming the
--       Program, and that Program stays blocked. Batch deletion permission
--       itself is unchanged.
--   K7  unattributable history: attributable legacy evidence does not block
--       an unrelated Program; unresolved legacy evidence blocks every Program
--       that existed when it was recorded, not one created afterwards; a
--       Program's earliest audit record counts as its creation; evidence is
--       never modified.
--
-- Ends with ROLLBACK. Fixture ids use the 22b… prefix.

begin;

insert into auth.users (id, email) values
  ('22b00000-0000-0000-0000-000000000001', 'phase22a-fix-super@validation.local'),
  ('22b00000-0000-0000-0000-000000000002', 'phase22a-fix-admin@validation.local'),
  ('22b00000-0000-0000-0000-000000000003', 'phase22a-fix-trainer@validation.local'),
  ('22b00000-0000-0000-0000-000000000004', 'phase22a-fix-student@validation.local');
insert into user_roles (auth_user_id, role) values
  ('22b00000-0000-0000-0000-000000000001', 'super_admin'),
  ('22b00000-0000-0000-0000-000000000002', 'admin'),
  ('22b00000-0000-0000-0000-000000000003', 'trainer'),
  ('22b00000-0000-0000-0000-000000000004', 'student');
insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('22b10000-0000-0000-0000-000000000001', '22b00000-0000-0000-0000-000000000001', 'Fix', 'Super', 'phase22a-fix-super@validation.local', 'super_admin'),
  ('22b10000-0000-0000-0000-000000000002', '22b00000-0000-0000-0000-000000000002', 'Fix', 'Admin', 'phase22a-fix-admin@validation.local', 'admin');
insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('22b20000-0000-0000-0000-000000000001', '22b00000-0000-0000-0000-000000000003', 'Fix', 'Trainer', 'phase22a-fix-trainer@validation.local');
insert into students (id, student_code, auth_user_id, first_name, last_name, phone, status) values
  ('22b30000-0000-0000-0000-000000000001', 'P22B-STU-1', '22b00000-0000-0000-0000-000000000004', 'Fix', 'Student', '9990022501', 'active');

-- Programs. Explicit past creation times model real history; the evidence
-- rows below use timestamps relative to them.
insert into programs (id, program_code, name, regular_fee, status, created_at) values
  ('22b40000-0000-0000-0000-000000000001', 'P22B-MARK', 'Fix Marker Target', 1000, 'archived', now() - interval '60 days'),
  ('22b40000-0000-0000-0000-000000000002', 'P22B-SUPER-OK', 'Fix Super Admin Delete', 1000, 'archived', now() - interval '60 days'),
  ('22b40000-0000-0000-0000-000000000011', 'P22B-H-ENROL', 'Fix History Enrollment', 1000, 'archived', now() - interval '60 days'),
  ('22b40000-0000-0000-0000-000000000012', 'P22B-H-BATCH', 'Fix History Batch', 1000, 'archived', now() - interval '60 days'),
  ('22b40000-0000-0000-0000-000000000013', 'P22B-H-CERT', 'Fix History Certificate', 1000, 'archived', now() - interval '60 days'),
  ('22b40000-0000-0000-0000-000000000021', 'P22B-LEGACY-OLD', 'Fix Existed Before Legacy', 1000, 'archived', now() - interval '60 days'),
  ('22b40000-0000-0000-0000-000000000022', 'P22B-NEW', 'Fix Created After Legacy', 1000, 'archived', now() - interval '1 day'),
  ('22b40000-0000-0000-0000-000000000023', 'P22B-AUDIT-OLDER', 'Fix Earlier Audit Than Row', 1000, 'archived', now() - interval '1 day'),
  ('22b40000-0000-0000-0000-000000000031', 'P22B-ACTIVE', 'Fix Active Program', 1000, 'active', now() - interval '60 days');

-- Routine history only (must survive and must not block on its own).
insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, before_data, after_data, created_at) values
  ('22b00000-0000-0000-0000-000000000002', 'admin', 'program.create', 'program', '22b40000-0000-0000-0000-000000000022', null, '{"programCode":"P22B-NEW"}', now() - interval '1 day'),
  ('22b00000-0000-0000-0000-000000000002', 'admin', 'program.status_change', 'program', '22b40000-0000-0000-0000-000000000022', '{"status":"active"}', '{"status":"archived"}', now() - interval '12 hours'),
  -- P22B-AUDIT-OLDER: its row says "1 day ago", but its own audit trail starts 40 days ago.
  ('22b00000-0000-0000-0000-000000000002', 'admin', 'program.create', 'program', '22b40000-0000-0000-0000-000000000023', null, '{"programCode":"P22B-AUDIT-OLDER"}', now() - interval '40 days');

insert into program_modules (program_id, title, sequence) values
  ('22b40000-0000-0000-0000-000000000001', 'Module that must not be cascaded', 1);

-- ===========================================================================
-- K1 catalog

do $$
declare
  fn text;
  r text;
begin
  foreach fn in array array[
    'website_assert_manager()', 'website_clean_text(text, text, integer, boolean)', 'website_is_safe_href(text)',
    'website_is_valid_slug(text)', 'website_allowed_section_types(text)', 'website_validate_sections(text, jsonb)',
    'website_audit(text, text, uuid, jsonb, jsonb)',
    'website_insert_revision(website_documents, text, text, text, text, text, text, uuid, uuid, jsonb, uuid)',
    'guard_website_document_change()', 'guard_website_document_insert()', 'prevent_website_revision_update()',
    'prevent_website_slug_history_change()', 'guard_program_delete()', 'program_deletion_blockers_internal(uuid)',
    'guard_program_created_at()', 'record_program_history_on_delete()', 'program_unattributable_history(uuid)'
  ] loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(r, fn, 'execute') then
        raise exception 'FAIL: % can execute internal helper %', r, fn;
      end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = fn::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception 'FAIL: PUBLIC can execute %', fn;
    end if;
  end loop;

  foreach fn in array array[
    'website_create_page(text, text)', 'website_save_draft(uuid, integer, text, text, text, text, text, text, uuid, uuid, jsonb)',
    'website_publish_document(uuid, uuid)', 'program_deletion_blockers(uuid)', 'delete_archived_program(uuid, text, text)'
  ] loop
    if not has_function_privilege('authenticated', fn, 'execute') or has_function_privilege('anon', fn, 'execute') then
      raise exception 'FAIL: management function grant changed for %', fn;
    end if;
  end loop;

  if (select prosecdef from pg_proc where oid = 'guard_program_delete()'::regprocedure) then
    raise exception 'FAIL: guard_program_delete must not be SECURITY DEFINER';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname <> 'delete_archived_program' and p.prosrc ~* 'delete\s+from\s+(public\.)?programs\M') then
    raise exception 'FAIL: another function deletes from programs';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in (
        'programs_guard_delete', 'programs_guard_created_at', 'enrollments_record_program_history',
        'batches_record_program_history', 'certificates_record_program_history')) <> 5 then
    raise exception 'FAIL: correction triggers missing';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'website_documents_kind')) !~ 'programs_listing'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'website_documents_kind')) !~ 'upcoming_batches' then
    raise exception 'FAIL: new page kinds missing';
  end if;
  raise notice 'PASS K1: internal helpers executable by no API role (incl. service_role and PUBLIC); management grants intact; guard is invoker-rights; no other Program-deleting function; correction triggers and page kinds present';
end
$$;

-- ===========================================================================
-- K3 creation time (as the owner, so only the trigger can refuse)

do $$
begin
  begin
    update programs set created_at = now() where id = '22b40000-0000-0000-0000-000000000021';
    raise exception 'FAIL: programs.created_at was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into programs (program_code, name, regular_fee, status, created_at)
    values ('P22B-FUTURE', 'Future dated', 1000, 'draft', now() + interval '2 days');
    raise exception 'FAIL: future-dated Program accepted';
  exception when sqlstate '22023' then null;
  end;
  update programs set name = name where id = '22b40000-0000-0000-0000-000000000021';
  raise notice 'PASS K3: Program creation time is fixed and never in the future; other updates unaffected';
end
$$;

-- ===========================================================================
-- K2 + K4 as Admin

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22b00000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  pl uuid; ub uuid; r1 record; r2 record; r3 record; v integer;
begin
  pl := website_create_page('programs_listing', 'programs');
  ub := website_create_page('upcoming_batches', 'upcoming-batches');
  begin
    perform website_create_page('programs_listing', 'programs-2');
    raise exception 'FAIL: second Programs-listing page accepted';
  exception when unique_violation then null;
  end;
  begin
    perform website_create_page('upcoming_batches', 'upcoming-2');
    raise exception 'FAIL: second Upcoming-Batches page accepted';
  exception when unique_violation then null;
  end;
  begin
    perform website_save_draft(pl, 0, 'Programs', null, null, null, null, null, null, null,
      '[{"key":"showcase","type":"program_showcase"}]'::jsonb);
    raise exception 'FAIL: program_showcase accepted on the listing page';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform website_save_draft(ub, 0, 'Upcoming Batches', null, null, null, null, null, null, null,
      '[{"key":"nav","type":"menu","items":[{"label":"x","href":"/x"}]}]'::jsonb);
    raise exception 'FAIL: menu accepted on the Upcoming Batches page';
  exception when sqlstate '22023' then null;
  end;

  select * into r1 from website_save_draft(pl, 0, 'Programs', 'Explore our programs', 'Programs | ROICIANS TECH', 'Practical technology programs', null, null, null, null,
    '[{"key":"intro","type":"hero","heading":"Explore Programs","cta":{"label":"Talk to an Advisor","href":"/contact"}},
      {"key":"about","type":"text","body":"Online-first programs."},
      {"key":"faq","type":"faq","items":[{"question":"How do I choose?","answer":"Talk to an advisor."}]},
      {"key":"banner","type":"banner","heading":"Corporate teams","cta":{"label":"Learn more","href":"/corporate-training"}},
      {"key":"points","type":"list","items":[{"title":"Online-first"}]},
      {"key":"cta","type":"cta","cta":{"label":"Explore","href":"/programs"}}]'::jsonb);
  select * into r2 from website_save_draft(ub, 0, 'Upcoming Batches', null, null, null, null, null, null, null,
    '[{"key":"intro","type":"text","body":"Cohorts open for registration."},
      {"key":"faq","type":"faq","items":[{"question":"No cohort listed?","answer":"Join the interest list."}]}]'::jsonb);

  perform website_publish_document(pl, r1.revision_id);
  perform website_publish_document(ub, r2.revision_id);
  select * into r3 from website_save_draft(pl, 1, 'Programs v2', null, null, null, null, null, null, null, '[]'::jsonb);
  if (select published_revision_id from website_documents where id = pl) <> r1.revision_id then
    raise exception 'FAIL: listing draft changed the published revision';
  end if;
  begin
    perform website_save_draft(pl, 1, 'stale', null, null, null, null, null, null, null, '[]'::jsonb);
    raise exception 'FAIL: stale listing save accepted';
  exception when sqlstate 'P2203' then null;
  end;
  select * into r3 from website_restore_revision(pl, r1.revision_id, 2);
  if r3.revision_number <> 3 or (select restored_from_revision_id from website_document_revisions where id = r3.revision_id) <> r1.revision_id then
    raise exception 'FAIL: listing restore';
  end if;
  v := website_unpublish_document(ub, (select version from website_documents where id = ub));
  if (select published_revision_id from website_documents where id = ub) is not null then
    raise exception 'FAIL: Upcoming Batches page not unpublished';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name like 'website\_%' and column_name ~ '(fee|price|capacity|seat)') then
    raise exception 'FAIL: page content gained a fact column';
  end if;

  -- K4: the authenticated role cannot call the helpers directly.
  begin
    perform website_audit('forged', 'program', gen_random_uuid(), null, null);
    raise exception 'FAIL: authenticated called website_audit';
  exception when insufficient_privilege then null;
  end;
  begin
    perform program_deletion_blockers_internal('22b40000-0000-0000-0000-000000000022');
    raise exception 'FAIL: authenticated called program_deletion_blockers_internal';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS K2/K4a: Programs-listing and Upcoming-Batches pages are single-instance with allowed sections only, support draft/publish/stable published/stale rejection/restore/unpublish; Admin workflow works while helpers stay uncallable';
end
$$;

-- K4b / K5 service_role
reset role;
set local role service_role;
set local "request.jwt.claims" to '{"role":"service_role"}';

do $$
begin
  begin
    perform website_insert_revision((select d from website_documents d limit 1), 'x', null, null, null, null, null, null, null, '[]'::jsonb, null);
    raise exception 'FAIL: service_role called website_insert_revision';
  exception when insufficient_privilege then null;
  end;
  begin
    perform website_audit('forged', 'program', gen_random_uuid(), null, null);
    raise exception 'FAIL: service_role called website_audit';
  exception when insufficient_privilege then null;
  end;
  begin
    perform program_unattributable_history('22b40000-0000-0000-0000-000000000001');
    raise exception 'FAIL: service_role called program_unattributable_history';
  exception when insufficient_privilege then null;
  end;
  -- Forged marker: the guard now also requires the owner execution context.
  perform set_config('roicians.program_delete_authorized', '22b40000-0000-0000-0000-000000000001', true);
  begin
    delete from programs where id = '22b40000-0000-0000-0000-000000000001';
    raise exception 'FAIL: service_role deleted a Program with a forged marker';
  exception when insufficient_privilege then null;
  end;
  perform set_config('roicians.program_delete_authorized', '', true);
  raise notice 'PASS K4b/K5a: service_role cannot call internal helpers, and a forged marker no longer lets it delete a Program';
end
$$;

reset role;

-- Application sessions: no DELETE privilege, marker or not.
do $$
declare
  who text;
begin
  foreach who in array array['anon', '22b00000-0000-0000-0000-000000000004', '22b00000-0000-0000-0000-000000000003',
                             '22b00000-0000-0000-0000-000000000002', '22b00000-0000-0000-0000-000000000001'] loop
    if who = 'anon' then
      execute 'set local role anon';
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    else
      execute 'set local role authenticated';
      perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
    end if;
    perform set_config('roicians.program_delete_authorized', '22b40000-0000-0000-0000-000000000001', true);
    begin
      delete from programs where id = '22b40000-0000-0000-0000-000000000001';
      raise exception 'FAIL: % deleted a Program with a forged marker', who;
    exception when insufficient_privilege then null;
    end;
    perform set_config('roicians.program_delete_authorized', '', true);
    execute 'reset role';
  end loop;
  if (select count(*) from program_modules where program_id = '22b40000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: module lost';
  end if;
  raise notice 'PASS K5b: anon, Student, Trainer, Admin and Super Admin sessions cannot delete a Program even with a self-set marker';
end
$$;

-- Owner limitation (documented, not a protection): inside a savepoint.
do $$
begin
  begin
    perform set_config('roicians.program_delete_authorized', '22b40000-0000-0000-0000-000000000001', true);
    delete from program_modules where program_id = '22b40000-0000-0000-0000-000000000001';
    delete from programs where id = '22b40000-0000-0000-0000-000000000001';
    raise exception 'owner_bypass_demonstrated';
  exception when raise_exception then
    if sqlerrm <> 'owner_bypass_demonstrated' then raise; end if;
  end;
  perform set_config('roicians.program_delete_authorized', '', true);
  if not exists (select 1 from programs where id = '22b40000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: savepoint did not restore the Program';
  end if;
  raise notice 'PASS K5c (limitation): a session running as the database owner can still satisfy the guard; this is outside what the application workflow can protect against';
end
$$;

-- Legitimate path.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22b00000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  a uuid;
begin
  if exists (select 1 from program_deletion_blockers('22b40000-0000-0000-0000-000000000002')) then
    raise exception 'FAIL: clean Program blocked: %', (select string_agg(code, ',') from program_deletion_blockers('22b40000-0000-0000-0000-000000000002'));
  end if;
  a := delete_archived_program('22b40000-0000-0000-0000-000000000002', 'P22B-SUPER-OK', 'Created in error');
  if exists (select 1 from programs where id = '22b40000-0000-0000-0000-000000000002')
     or (select action from audit_logs where id = a) <> 'program.deleted' then
    raise exception 'FAIL: Super Admin controlled deletion';
  end if;
  raise notice 'PASS K5d: the Super Admin controlled function still deletes a safe archived Program with its audit record';
end
$$;

-- ===========================================================================
-- K6 delete evidence through each route

reset role;
insert into enrollments (id, enrollment_code, student_id, program_id, regular_fee, agreed_fee, total_payable, status) values
  ('22b60000-0000-0000-0000-000000000011', 'P22B-ENR-11', '22b30000-0000-0000-0000-000000000001', '22b40000-0000-0000-0000-000000000011', 1000, 1000, 1000, 'cancelled'),
  ('22b60000-0000-0000-0000-000000000013', 'P22B-ENR-13', '22b30000-0000-0000-0000-000000000001', '22b40000-0000-0000-0000-000000000013', 1000, 1000, 1000, 'cancelled');
insert into batches (id, program_id, name, start_date, status) values
  ('22b50000-0000-0000-0000-000000000012', '22b40000-0000-0000-0000-000000000012', 'Fix Batch To Delete', current_date - 100, 'cancelled');
insert into certificates (id, certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, status, pdf_path) values
  ('22b70000-0000-0000-0000-000000000013', 'P22B-CERT-13', '22b60000-0000-0000-0000-000000000013', '22b30000-0000-0000-0000-000000000001', '22b40000-0000-0000-0000-000000000013', current_date - 5, current_date - 5, 'revoked', '22b30000-0000-0000-0000-000000000001/P22B-CERT-13.pdf');
-- Financial history recorded the way the application records it (enrollmentId only).
insert into audit_logs (actor_role, action, entity_type, entity_id, after_data) values
  ('admin', 'payment.recorded_offline', 'payment', '22b80000-0000-0000-0000-000000000011', '{"enrollmentId":"22b60000-0000-0000-0000-000000000011","amount":"500.00"}');

-- (a) enrollment removed by a privileged route (service role)
set local role service_role;
delete from enrollments where id = '22b60000-0000-0000-0000-000000000011';
reset role;
-- (b) Batch removed by an Admin through the existing batches_delete_admin policy
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22b00000-0000-0000-0000-000000000002","role":"authenticated"}';
delete from batches where id = '22b50000-0000-0000-0000-000000000012';
reset role;
-- (c) certificate (then its enrollment) removed by the owner
delete from certificates where id = '22b70000-0000-0000-0000-000000000013';
delete from enrollments where id = '22b60000-0000-0000-0000-000000000013';

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22b00000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  c record;
  codes text;
begin
  if exists (select 1 from batches where id = '22b50000-0000-0000-0000-000000000012') then
    raise exception 'FAIL: Admin Batch deletion permission changed';
  end if;
  for c in select * from (values
    ('22b40000-0000-0000-0000-000000000011'::uuid, 'enrollment.row_deleted'),
    ('22b40000-0000-0000-0000-000000000012'::uuid, 'batch.row_deleted'),
    ('22b40000-0000-0000-0000-000000000013'::uuid, 'certificate.row_deleted')
  ) as t(pid, act) loop
    if not exists (select 1 from audit_logs where action = c.act and before_data ->> 'programId' = c.pid::text
                   and after_data ->> 'source' = 'delete_trigger') then
      raise exception 'FAIL: no % evidence for %', c.act, c.pid;
    end if;
    select string_agg(b.code || ':' || b.detail, ' | ') into codes from program_deletion_blockers(c.pid) b;
    if codes is null or codes !~ 'audit_history' or codes !~ c.act then
      raise exception 'FAIL: Program % not blocked by its deleted history (blockers: %)', c.pid, codes;
    end if;
  end loop;
  if exists (select 1 from audit_logs where action like '%.row_deleted' and (before_data ? 'firstName' or before_data ? 'email' or before_data ? 'studentId')) then
    raise exception 'FAIL: deletion evidence copies personal data';
  end if;
  raise notice 'PASS K6: enrollment (service role), Batch (Admin policy) and certificate (owner) deletions each leave Program-naming evidence and the Program stays blocked; Admin Batch deletion still permitted; no personal data recorded';
end
$$;

-- ===========================================================================
-- K7 unattributable history

reset role;
-- Attributable legacy evidence (another Program is known): must not block others.
insert into audit_logs (actor_role, action, entity_type, entity_id, after_data, created_at) values
  ('admin', 'enrollment.create', 'enrollment', '22b60000-0000-0000-0000-0000000000a1', '{"programId":"22b40000-0000-0000-0000-000000000031"}', now() - interval '10 days'),
  ('admin', 'payment.recorded_offline', 'payment', '22b80000-0000-0000-0000-0000000000a1', '{"enrollmentId":"22b60000-0000-0000-0000-0000000000a1"}', now() - interval '10 days'),
  ('admin', 'refund.recorded_offline', 'refund', '22b90000-0000-0000-0000-0000000000a1', '{"paymentId":"22b80000-0000-0000-0000-0000000000a1"}', now() - interval '10 days'),
  ('admin', 'assignment.create', 'assignment', '22ba0000-0000-0000-0000-0000000000a1', '{"batchId":"22b50000-0000-0000-0000-0000000000a1"}', now() - interval '10 days'),
  ('admin', 'batch.row_deleted', 'batch', '22b50000-0000-0000-0000-0000000000a1', '{"programId":"22b40000-0000-0000-0000-000000000031"}', now() - interval '9 days'),
  ('student', 'submission.create_or_update', 'assignment_submission', '22bb0000-0000-0000-0000-0000000000a1', '{"assignmentId":"22ba0000-0000-0000-0000-0000000000a1"}', now() - interval '10 days');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22b00000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  if exists (select 1 from program_deletion_blockers('22b40000-0000-0000-0000-000000000021')) then
    raise exception 'FAIL: attributable history of another Program blocked an unrelated one: %',
      (select string_agg(code, ',') from program_deletion_blockers('22b40000-0000-0000-0000-000000000021'));
  end if;
  raise notice 'PASS K7a: legacy history attributable to a different Program (directly or through enrollment / payment / assignment / Batch evidence) does not block an unrelated Program';
end
$$;

reset role;
-- Unresolved legacy evidence 10 days ago: an enrollment and a Batch that no
-- longer exist and that nothing ties to a Program.
insert into audit_logs (actor_role, action, entity_type, entity_id, after_data, created_at) values
  ('admin', 'certificate.issue', 'certificate', '22b70000-0000-0000-0000-0000000000b1', '{"enrollmentId":"22b60000-0000-0000-0000-0000000000b1"}', now() - interval '10 days'),
  ('admin', 'payment.recorded_offline', 'payment', '22b80000-0000-0000-0000-0000000000b1', '{"enrollmentId":"22b60000-0000-0000-0000-0000000000b1"}', now() - interval '10 days'),
  ('admin', 'class_session.create', 'class_session', '22bc0000-0000-0000-0000-0000000000b1', '{"batchId":"22b50000-0000-0000-0000-0000000000b1"}', now() - interval '10 days');

create temp table k7_audit_before on commit drop as
  select (select count(*) from audit_logs) as n,
         (select md5(string_agg(id::text || coalesce(before_data::text,'') || coalesce(after_data::text,''), ',' order by id)) from audit_logs where action <> 'program.deleted') as h;

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22b00000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  codes text;
  a uuid;
begin
  select string_agg(code, ',') into codes from program_deletion_blockers('22b40000-0000-0000-0000-000000000021');
  if codes is distinct from 'unattributable_history' then
    raise exception 'FAIL: Program that existed during unresolved history not blocked (blockers: %)', codes;
  end if;
  begin
    perform delete_archived_program('22b40000-0000-0000-0000-000000000021', 'P22B-LEGACY-OLD', 'attempt');
    raise exception 'FAIL: deleted despite unresolved history';
  exception when sqlstate 'P2201' then null;
  end;
  -- A Program whose own audit trail predates the evidence is treated as existing then.
  select string_agg(code, ',') into codes from program_deletion_blockers('22b40000-0000-0000-0000-000000000023');
  if codes is distinct from 'unattributable_history' then
    raise exception 'FAIL: earliest audit record not used as creation time (blockers: %)', codes;
  end if;
  -- A genuinely new, unused archived Program created after the evidence is eligible.
  if exists (select 1 from program_deletion_blockers('22b40000-0000-0000-0000-000000000022')) then
    raise exception 'FAIL: new Program blocked: %', (select string_agg(code, ',') from program_deletion_blockers('22b40000-0000-0000-0000-000000000022'));
  end if;
  a := delete_archived_program('22b40000-0000-0000-0000-000000000022', 'P22B-NEW', 'Never used');
  if (select count(*) from audit_logs where entity_id = '22b40000-0000-0000-0000-000000000022'
        and action in ('program.create', 'program.status_change')) <> 2 then
    raise exception 'FAIL: routine audit records did not survive';
  end if;
  raise notice 'PASS K7b: unresolved legacy history blocks every Program that existed when it was recorded (incl. by earliest audit record) with no override; a Program created afterwards is eligible and its routine audit survives deletion';
end
$$;

reset role;
do $$
begin
  if (select n from k7_audit_before) + 1 <> (select count(*) from audit_logs)
     or (select h from k7_audit_before) <> (select md5(string_agg(id::text || coalesce(before_data::text,'') || coalesce(after_data::text,''), ',' order by id))
                                             from audit_logs where action <> 'program.deleted') then
    raise exception 'FAIL: evidence was modified (only the program.deleted record may be added)';
  end if;
  raise notice 'PASS K7c: eligibility checks never modify or remove audit evidence';
end
$$;

rollback;
