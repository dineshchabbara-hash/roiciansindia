-- Phase 22A regression suite for
--   20260101000040_website_content_foundation.sql
--   20260101000041_program_deletion_safeguards.sql
-- (docs/requirements/PHASE_22_APPROVED_DESIGN.md §5, §7, §8, §9, §14).
--
-- Website foundation:
--   W1  new tables private: RLS on, Admin/Super SELECT only, no write policy,
--       no direct write privilege; functions grant matrix; private bucket.
--   W2  no new column on programs/batches; LMS buckets unchanged.
--   W3  Admin: groups (create/rename/hide/reorder/archive/restore, stale).
--   W4  Admin: pages + Program documents, slug rules, structured-content
--       validation (no HTML, scripts, unsafe links, prices, unknown fields).
--   W5  drafts, explicit publish, stable published revision, restore as a new
--       revision, stale save/publish/restore rejection.
--   W6  media: draft assets cannot be published; approval needs alt text;
--       published assets cannot be withdrawn.
--   W7  placement (group/featured/order) and group archive guard.
--   W8  Batch publication separate from batches.status; Open/Closed/Full.
--   W9  slug after first publication: Admin refused (function AND direct
--       table write), Super Admin allowed with reserved history; revisions
--       immutable even for the table owner / service role.
--   W10 Trainer / Student / anon / inactive Admin: no rows, no mutations.
--   W11 audit rows written in-transaction; no content bodies in audit.
-- Program deletion:
--   D1  no DELETE policy/privilege on programs; guard trigger blocks even the
--       service role; Admin and inactive Super Admin refused.
--   D2  Super Admin: unarchived refused; confirmation and reason required.
--   D3  every dependency category blocks (batches, enrollments, certificates,
--       modules, materials, assignments, leads, website documents, a brand-new
--       FK table), plus thumbnail, stored files, published website history
--       (TI-7), website links, and audit evidence (by id, by code, unknown
--       Program action). Failed attempts change nothing.
--   D4  routine-audit-only archived Program is deleted; routine audit rows
--       survive; a durable program.deleted record is written.
--   D5  never-published website draft discarded -> Program becomes eligible.
--
-- Ends with ROLLBACK. Fixture ids use the 22a… prefix.

begin;

insert into auth.users (id, email) values
  ('22a00000-0000-0000-0000-000000000001', 'phase22a-super@validation.local'),
  ('22a00000-0000-0000-0000-000000000002', 'phase22a-admin@validation.local'),
  ('22a00000-0000-0000-0000-000000000003', 'phase22a-trainer@validation.local'),
  ('22a00000-0000-0000-0000-000000000004', 'phase22a-student@validation.local'),
  ('22a00000-0000-0000-0000-000000000005', 'phase22a-inactive-admin@validation.local'),
  ('22a00000-0000-0000-0000-000000000006', 'phase22a-inactive-super@validation.local');

insert into user_roles (auth_user_id, role) values
  ('22a00000-0000-0000-0000-000000000001', 'super_admin'),
  ('22a00000-0000-0000-0000-000000000002', 'admin'),
  ('22a00000-0000-0000-0000-000000000003', 'trainer'),
  ('22a00000-0000-0000-0000-000000000004', 'student'),
  ('22a00000-0000-0000-0000-000000000005', 'admin'),
  ('22a00000-0000-0000-0000-000000000006', 'super_admin');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level, status) values
  ('22a10000-0000-0000-0000-000000000001', '22a00000-0000-0000-0000-000000000001', 'Phase22A', 'Super', 'phase22a-super@validation.local', 'super_admin', 'active'),
  ('22a10000-0000-0000-0000-000000000002', '22a00000-0000-0000-0000-000000000002', 'Phase22A', 'Admin', 'phase22a-admin@validation.local', 'admin', 'active'),
  ('22a10000-0000-0000-0000-000000000005', '22a00000-0000-0000-0000-000000000005', 'Phase22A', 'InactiveAdmin', 'phase22a-inactive-admin@validation.local', 'admin', 'inactive'),
  ('22a10000-0000-0000-0000-000000000006', '22a00000-0000-0000-0000-000000000006', 'Phase22A', 'InactiveSuper', 'phase22a-inactive-super@validation.local', 'super_admin', 'inactive');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('22a20000-0000-0000-0000-000000000001', '22a00000-0000-0000-0000-000000000003', 'Phase22A', 'Trainer', 'phase22a-trainer@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email, status) values
  ('22a30000-0000-0000-0000-000000000001', '22a00000-0000-0000-0000-000000000004', 'Phase22A', 'Student', '9990022401', 'phase22a-student@validation.local', 'active');

-- Programs. 22a4…01-04: website tests. 22a4…1x: deletion fixtures.
insert into programs (id, program_code, name, regular_fee, status, thumbnail_path) values
  ('22a40000-0000-0000-0000-000000000001', 'P22A-ACTIVE-1', 'Phase22A Active One', 50000, 'active', null),
  ('22a40000-0000-0000-0000-000000000002', 'P22A-ACTIVE-2', 'Phase22A Active Two', 50000, 'active', null),
  ('22a40000-0000-0000-0000-000000000003', 'P22A-DRAFT-3', 'Phase22A Draft Three', 50000, 'draft', null),
  ('22a40000-0000-0000-0000-000000000004', 'P22A-ACTIVE-4', 'Phase22A Active Four', 50000, 'active', null),
  ('22a40000-0000-0000-0000-000000000010', 'P22A-SAFE', 'Phase22A Safe Archived', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000011', 'P22A-DEP-BATCH', 'Phase22A Dep Batch', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000012', 'P22A-DEP-ENROL', 'Phase22A Dep Enrollment', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000013', 'P22A-DEP-CERT', 'Phase22A Dep Certificate', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000014', 'P22A-DEP-MODULE', 'Phase22A Dep Module', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000015', 'P22A-DEP-MATERIAL', 'Phase22A Dep Material', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000016', 'P22A-DEP-ASSIGN', 'Phase22A Dep Assignment', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000017', 'P22A-DEP-LEAD', 'Phase22A Dep Lead', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000018', 'P22A-DEP-THUMB', 'Phase22A Dep Thumbnail', 1000, 'archived', 'program/22a40000-0000-0000-0000-000000000018/thumb.jpg'),
  ('22a40000-0000-0000-0000-000000000019', 'P22A-DEP-FILE', 'Phase22A Dep Stored File', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000020', 'P22A-EV-ID', 'Phase22A Evidence By Id', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000021', 'P22A-EV-CODE', 'Phase22A Evidence By Code', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000022', 'P22A-EV-ACTION', 'Phase22A Evidence Unknown Action', 1000, 'archived', null),
  ('22a40000-0000-0000-0000-000000000023', 'P22A-ACTIVE-DEL', 'Phase22A Active Not Archived', 1000, 'active', null),
  ('22a40000-0000-0000-0000-000000000024', 'P22A-DRAFT-WEB', 'Phase22A Never Published Web', 1000, 'active', null),
  ('22a40000-0000-0000-0000-000000000025', 'P22A-PUB-WEB', 'Phase22A Published Web', 1000, 'active', null),
  ('22a40000-0000-0000-0000-000000000026', 'P22A-LINKED', 'Phase22A Linked From Page', 1000, 'active', null),
  ('22a40000-0000-0000-0000-000000000027', 'P22A-NEW-FK', 'Phase22A Future FK Table', 1000, 'archived', null);

insert into batches (id, program_id, name, start_date, status, capacity, meeting_link, location, notes) values
  ('22a50000-0000-0000-0000-000000000001', '22a40000-0000-0000-0000-000000000001', 'INTERNAL Phase22A Upcoming', current_date + 30, 'upcoming', 25, 'https://meet.example/secret', 'Room 9', 'internal note'),
  ('22a50000-0000-0000-0000-000000000002', '22a40000-0000-0000-0000-000000000001', 'INTERNAL Phase22A Draft Batch', current_date + 60, 'draft', 25, null, null, null),
  ('22a50000-0000-0000-0000-000000000011', '22a40000-0000-0000-0000-000000000011', 'Phase22A Dep Batch', current_date - 300, 'archived', null, null, null, null),
  ('22a50000-0000-0000-0000-000000000016', '22a40000-0000-0000-0000-000000000016', 'Phase22A Assign Batch', current_date - 300, 'archived', null, null, null, null);

insert into batch_trainers (batch_id, trainer_id, is_primary) values
  ('22a50000-0000-0000-0000-000000000001', '22a20000-0000-0000-0000-000000000001', true);

insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('22a60000-0000-0000-0000-000000000001', '22a30000-0000-0000-0000-000000000001', '22a40000-0000-0000-0000-000000000001', '22a50000-0000-0000-0000-000000000001', 50000, 50000, 50000, 'active'),
  ('22a60000-0000-0000-0000-000000000012', '22a30000-0000-0000-0000-000000000001', '22a40000-0000-0000-0000-000000000012', null, 1000, 1000, 1000, 'cancelled'),
  ('22a60000-0000-0000-0000-000000000013', '22a30000-0000-0000-0000-000000000001', '22a40000-0000-0000-0000-000000000013', null, 1000, 1000, 1000, 'cancelled');

insert into certificates (id, certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, status, pdf_path) values
  ('22a70000-0000-0000-0000-000000000013', 'P22A-CERT-1', '22a60000-0000-0000-0000-000000000013', '22a30000-0000-0000-0000-000000000001', '22a40000-0000-0000-0000-000000000013', current_date - 10, current_date - 10, 'revoked', '22a30000-0000-0000-0000-000000000001/P22A-CERT-1.pdf');

insert into program_modules (program_id, title, sequence) values
  ('22a40000-0000-0000-0000-000000000014', 'Phase22A Module', 1);

insert into materials (program_id, title, material_type, external_url, uploaded_by, uploaded_by_type) values
  ('22a40000-0000-0000-0000-000000000015', 'Phase22A Material', 'link', 'https://example.com/p22a', '22a00000-0000-0000-0000-000000000002', 'admin');

insert into assignments (program_id, batch_id, trainer_id, title, due_date) values
  ('22a40000-0000-0000-0000-000000000016', '22a50000-0000-0000-0000-000000000016', '22a20000-0000-0000-0000-000000000001', 'Phase22A Assignment', current_date - 200);

insert into leads (name, program_id) values ('Phase22A Lead', '22a40000-0000-0000-0000-000000000017');

insert into storage.objects (bucket_id, name) values
  ('materials', 'program/22a40000-0000-0000-0000-000000000019/aaaaaaaa-0000-4000-8000-000000000019-orphan.pdf');

-- Routine audit history (does not block) and protected evidence (blocks).
insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, before_data, after_data) values
  ('22a00000-0000-0000-0000-000000000002', 'admin', 'program.create', 'program', '22a40000-0000-0000-0000-000000000010', null, '{"programCode":"P22A-SAFE"}'),
  ('22a00000-0000-0000-0000-000000000002', 'admin', 'program.update', 'program', '22a40000-0000-0000-0000-000000000010', null, '{"changedFields":["name"]}'),
  ('22a00000-0000-0000-0000-000000000002', 'admin', 'program.status_change', 'program', '22a40000-0000-0000-0000-000000000010', '{"status":"active"}', '{"status":"archived"}'),
  ('22a00000-0000-0000-0000-000000000002', 'admin', 'enrollment.create', 'enrollment', '22a60000-0000-0000-0000-0000000000ee', null, '{"studentId":"x","programId":"22a40000-0000-0000-0000-000000000020"}'),
  ('22a00000-0000-0000-0000-000000000002', 'admin', 'student.update', 'student', '22a30000-0000-0000-0000-000000000001', null, '{"note":{"programCode":"P22A-EV-CODE"}}'),
  ('22a00000-0000-0000-0000-000000000002', 'admin', 'program.legacy_fee_override', 'program', '22a40000-0000-0000-0000-000000000022', null, '{"x":1}');

-- ===========================================================================
-- W1 / W2 / D1 catalog checks

do $$
declare
  t text;
  fn text;
  r text;
begin
  foreach t in array array['website_display_groups', 'website_media_assets', 'website_documents',
                           'website_document_revisions', 'website_revision_media',
                           'website_program_slug_history', 'batch_website_publications'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      raise exception 'FAIL: RLS is not enabled on %', t;
    end if;
    if exists (select 1 from pg_policies where tablename = t and cmd <> 'SELECT') then
      raise exception 'FAIL: % has a non-SELECT policy', t;
    end if;
    if exists (select 1 from pg_policies where tablename = t and qual <> 'is_admin_or_super()') then
      raise exception 'FAIL: % has a SELECT policy other than is_admin_or_super()', t;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'insert') or has_table_privilege(r, 'public.' || t, 'update')
         or has_table_privilege(r, 'public.' || t, 'delete') or has_table_privilege(r, 'public.' || t, 'truncate') then
        raise exception 'FAIL: % has a direct write privilege on %', r, t;
      end if;
    end loop;
    if has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception 'FAIL: anon can select %', t;
    end if;
  end loop;

  foreach fn in array array[
    'website_create_display_group(text, text)', 'website_update_display_group(uuid, integer, text, text, boolean)',
    'website_reorder_display_groups(uuid[])', 'website_set_display_group_archived(uuid, integer, boolean)',
    'website_create_page(text, text)', 'website_create_program_document(uuid, text)',
    'website_change_program_slug(uuid, integer, text)',
    'website_update_program_placement(uuid, integer, uuid, boolean, integer, integer)',
    'website_save_draft(uuid, integer, text, text, text, text, text, text, uuid, uuid, jsonb)',
    'website_restore_revision(uuid, uuid, integer)', 'website_publish_document(uuid, uuid)',
    'website_unpublish_document(uuid, integer)', 'website_discard_unpublished_document(uuid, integer)',
    'website_register_media_asset(text, text, integer, integer, integer, text)',
    'website_update_media_asset(uuid, integer, text, text)',
    'website_save_batch_publication(uuid, integer, text, text)', 'website_publish_batch(uuid, integer)',
    'website_unpublish_batch(uuid, integer)', 'program_deletion_blockers(uuid)',
    'delete_archived_program(uuid, text, text)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'FAIL: anon can execute %', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'FAIL: authenticated cannot execute %', fn;
    end if;
  end loop;

  foreach fn in array array[
    'website_assert_manager()', 'website_clean_text(text, text, integer, boolean)', 'website_is_safe_href(text)',
    'website_is_valid_slug(text)', 'website_allowed_section_types(text)', 'website_validate_sections(text, jsonb)',
    'website_audit(text, text, uuid, jsonb, jsonb)',
    'website_insert_revision(website_documents, text, text, text, text, text, text, uuid, uuid, jsonb, uuid)',
    'guard_website_document_change()', 'guard_website_document_insert()', 'prevent_website_revision_update()',
    'prevent_website_slug_history_change()', 'guard_program_delete()', 'program_deletion_blockers_internal(uuid)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, fn, 'execute') then
        raise exception 'FAIL: % can execute internal function %', r, fn;
      end if;
    end loop;
  end loop;

  -- D1: no broad delete on programs.
  if exists (select 1 from pg_policies where tablename = 'programs' and cmd in ('DELETE', 'ALL')) then
    raise exception 'FAIL: programs still has a DELETE policy';
  end if;
  if has_table_privilege('authenticated', 'public.programs', 'delete') or has_table_privilege('anon', 'public.programs', 'delete') then
    raise exception 'FAIL: anon/authenticated still hold DELETE on programs';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'programs_guard_delete' and tgrelid = 'public.programs'::regclass) then
    raise exception 'FAIL: programs_guard_delete trigger missing';
  end if;
  -- Unchanged neighbours: Admin keeps archive/restore (UPDATE) on programs.
  if not exists (select 1 from pg_policies where tablename = 'programs' and policyname = 'programs_update_admin') then
    raise exception 'FAIL: programs_update_admin (archive/restore) was removed';
  end if;

  -- W2: no column added to programs or batches.
  if (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
       where table_schema = 'public' and table_name = 'programs')
     <> 'id,program_code,name,description,category,duration_value,duration_unit,delivery_mode,regular_fee,registration_fee,tax_rate_percent,status,thumbnail_path,certificate_eligible,installments_allowed,created_at,updated_at' then
    raise exception 'FAIL: programs columns changed';
  end if;
  if (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
       where table_schema = 'public' and table_name = 'batches')
     <> 'id,program_id,name,start_date,expected_end_date,days_of_week,start_time,end_time,timezone,delivery_mode,capacity,status,meeting_link,location,notes,created_at,updated_at' then
    raise exception 'FAIL: batches columns changed';
  end if;

  -- Buckets: website-media private; existing buckets unchanged.
  if (select string_agg(id || '=' || public::text, ',' order by id) from storage.buckets)
     <> 'assignment-attachments=false,assignment-submissions=false,branding=true,certificates=false,materials=false,profile-photos=false,receipts=false,student-documents=false,website-media=false' then
    raise exception 'FAIL: bucket visibility changed: %', (select string_agg(id || '=' || public::text, ',' order by id) from storage.buckets);
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'website_media%' and cmd <> 'SELECT') then
    raise exception 'FAIL: website-media has a write storage policy';
  end if;

  -- No fee/price column in any website table.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and (table_name like 'website_%' or table_name = 'batch_website_publications')
              and (column_name ~ '(fee|price|amount|tax|capacity|seat|meeting|location|note)')) then
    raise exception 'FAIL: a website table has a financial/private Batch column';
  end if;
  raise notice 'PASS W1/W2/D1: website tables private and write-locked; function grants correct; programs DELETE removed and guarded; programs/batches columns and bucket visibility unchanged; no fee/private columns';
end
$$;

-- ===========================================================================
-- W3–W8, W11 as Admin

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22a00000-0000-0000-0000-000000000002","role":"authenticated"}';

create temp table p22a_ids (k text primary key, v uuid) on commit drop;
grant all on p22a_ids to authenticated;

do $$
declare
  g1 uuid; g2 uuid; v integer;
begin
  g1 := website_create_display_group('Career & Technology Programs', null);
  g2 := website_create_display_group('Specialist & Professional Programs', 'Second group');
  insert into p22a_ids values ('g1', g1), ('g2', g2);

  begin
    perform website_create_display_group(' career & technology programs ', null);
    raise exception 'FAIL: duplicate group name accepted';
  exception when unique_violation then null;
  end;
  begin
    perform website_create_display_group('<b>Bold</b>', null);
    raise exception 'FAIL: markup in group name accepted';
  exception when sqlstate '22023' then null;
  end;

  v := website_update_display_group(g2, 1, 'Specialist Programs', null, true);
  if v <> 2 then raise exception 'FAIL: rename did not bump version'; end if;
  begin
    perform website_update_display_group(g2, 1, 'Stale Rename', null, true);
    raise exception 'FAIL: stale group edit accepted';
  exception when sqlstate 'P2203' then null;
  end;
  v := website_update_display_group(g2, 2, 'Specialist Programs', null, false);  -- hide

  begin
    perform website_reorder_display_groups(array[g2]);
    raise exception 'FAIL: partial reorder accepted';
  exception when sqlstate 'P2203' then null;
  end;
  perform website_reorder_display_groups(array[g2, g1]);
  if (select display_order from website_display_groups where id = g2) <> 1
     or (select display_order from website_display_groups where id = g1) <> 2 then
    raise exception 'FAIL: reorder not applied';
  end if;

  v := (select version from website_display_groups where id = g2);
  v := website_set_display_group_archived(g2, v, true);
  if (select archived_at from website_display_groups where id = g2) is null then
    raise exception 'FAIL: group not archived';
  end if;
  begin
    perform website_update_display_group(g2, v, 'Edit Archived', null, true);
    raise exception 'FAIL: archived group edited';
  exception when sqlstate 'P2206' then null;
  end;
  v := website_set_display_group_archived(g2, v, false);
  if (select archived_at from website_display_groups where id = g2) is not null then
    raise exception 'FAIL: group not restored';
  end if;
  raise notice 'PASS W3: Admin creates, renames, hides, reorders, archives and restores display groups; duplicates, markup and stale edits refused';
end
$$;

do $$
declare
  home uuid; d1 uuid; d2 uuid; d4 uuid; r record; r2 record; r3 record; other uuid;
  bad jsonb;
begin
  home := website_create_page('home', 'home');
  insert into p22a_ids values ('home', home);
  begin
    perform website_create_page('home', 'home-2');
    raise exception 'FAIL: second home page accepted';
  exception when unique_violation then null;
  end;
  begin
    perform website_create_page('program', 'not-allowed');
    raise exception 'FAIL: program kind via create_page accepted';
  exception when sqlstate '22023' then null;
  end;
  perform website_create_page('navigation', 'main-navigation');
  perform website_create_page('footer', 'site-footer');
  perform website_create_page('legal', 'privacy-policy');
  perform website_create_page('about', 'about');

  d1 := website_create_program_document('22a40000-0000-0000-0000-000000000001', 'phase22a-alpha');
  d2 := website_create_program_document('22a40000-0000-0000-0000-000000000002', 'phase22a-beta');
  d4 := website_create_program_document('22a40000-0000-0000-0000-000000000003', 'phase22a-draft-program');
  insert into p22a_ids values ('d1', d1), ('d2', d2), ('d3', d4);
  begin
    perform website_create_program_document('22a40000-0000-0000-0000-000000000004', 'phase22a-alpha');
    raise exception 'FAIL: duplicate slug accepted';
  exception when sqlstate 'P2205' then null;
  end;
  begin
    perform website_create_program_document('22a40000-0000-0000-0000-000000000001', 'phase22a-alpha-two');
    raise exception 'FAIL: second document for one Program accepted';
  exception when sqlstate 'P2205' then null;
  end;
  begin
    perform website_create_program_document('22a40000-0000-0000-0000-000000000004', 'Bad Slug!');
    raise exception 'FAIL: invalid slug accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform website_create_program_document('22a40000-0000-0000-0000-000000000010', 'phase22a-archived');
    raise exception 'FAIL: website document for an archived Program accepted';
  exception when sqlstate 'P2206' then null;
  end;

  -- Structured-content validation (W4).
  foreach bad in array array[
    '[{"key":"a","type":"text","body":"<script>alert(1)</script>"}]'::jsonb,
    '[{"key":"a","type":"text","body":"Fee only ₹49,999"}]'::jsonb,
    '[{"key":"a","type":"text","fee":"49999"}]'::jsonb,
    '[{"key":"a","type":"cta","cta":{"label":"Go","href":"javascript:alert(1)"}}]'::jsonb,
    '[{"key":"a","type":"cta","cta":{"label":"Go","href":"//evil.example"}}]'::jsonb,
    '[{"key":"a","type":"cta","cta":{"label":"Go","href":"http://insecure.example"}}]'::jsonb,
    '[{"key":"a","type":"menu","items":[{"label":"X","href":"/x"}]}]'::jsonb,
    '[{"key":"a","type":"faq","items":[{"question":"Q","price":"1"}]}]'::jsonb,
    '[{"key":"a","type":"text"},{"key":"a","type":"text"}]'::jsonb,
    '[{"key":"Bad Key","type":"text"}]'::jsonb,
    '{"key":"a"}'::jsonb
  ] loop
    begin
      perform website_save_draft(d1, 0, 'Headline', null, null, null, null, null, null, null, bad);
      raise exception 'FAIL: unsafe/unsupported content accepted: %', bad;
    exception when sqlstate '22023' then null;
    end;
  end loop;

  -- W5 drafts / publish / restore.
  select * into r from website_save_draft(d1, 0, 'Alpha headline v1', 'Summary v1', 'SEO v1', 'SEO desc v1', null, null, null, null,
    '[{"key":"overview","type":"text","heading":"Overview","body":"Plain text body."},
      {"key":"faq","type":"faq","visible":false,"items":[{"question":"Who is it for?","answer":"Working professionals."}]},
      {"key":"cta","type":"cta","cta":{"label":"Talk to an Advisor","href":"/contact?topic=program"}}]'::jsonb);
  if r.revision_number <> 1 then raise exception 'FAIL: first revision number %', r.revision_number; end if;
  insert into p22a_ids values ('d1r1', r.revision_id);
  if (select sections -> 1 ->> 'visible' from website_document_revisions where id = r.revision_id) <> 'false'
     or (select sections -> 0 ->> 'visible' from website_document_revisions where id = r.revision_id) <> 'true' then
    raise exception 'FAIL: section visibility not normalized';
  end if;
  begin
    perform website_save_draft(d1, 0, 'Concurrent stale save', null, null, null, null, null, null, null, '[]');
    raise exception 'FAIL: stale draft save accepted';
  exception when sqlstate 'P2203' then null;
  end;
  if (select published_revision_id from website_documents where id = d1) is not null then
    raise exception 'FAIL: draft was published without an explicit publish';
  end if;

  perform website_publish_document(d1, r.revision_id);
  if (select published_revision_id from website_documents where id = d1) <> r.revision_id
     or (select first_published_at from website_documents where id = d1) is null
     or (select published_by from website_documents where id = d1) <> '22a00000-0000-0000-0000-000000000002' then
    raise exception 'FAIL: publish did not record revision/time/publisher';
  end if;

  select * into r2 from website_save_draft(d1, 1, 'Alpha headline v2', 'Summary v2', null, null, null, null, null, null, '[]');
  insert into p22a_ids values ('d1r2', r2.revision_id);
  if (select published_revision_id from website_documents where id = d1) <> r.revision_id then
    raise exception 'FAIL: saving a new draft changed the published revision';
  end if;
  if (select title from website_document_revisions where id = r.revision_id) <> 'Alpha headline v1' then
    raise exception 'FAIL: published revision content changed';
  end if;
  begin
    perform website_publish_document(d1, r.revision_id);
    raise exception 'FAIL: publishing a non-latest revision accepted';
  exception when sqlstate 'P2203' then null;
  end;
  perform website_publish_document(d1, r2.revision_id);
  begin
    perform website_publish_document(d1, r2.revision_id);
    raise exception 'FAIL: republishing the same revision accepted';
  exception when sqlstate 'P2206' then null;
  end;

  begin
    perform website_restore_revision(d1, r.revision_id, 1);
    raise exception 'FAIL: stale restore accepted';
  exception when sqlstate 'P2203' then null;
  end;
  select id into other from website_document_revisions where document_id <> d1 limit 1;
  begin
    perform website_restore_revision(d1, coalesce(other, gen_random_uuid()), 2);
    raise exception 'FAIL: restoring a revision of another document accepted';
  exception when sqlstate 'P2204' then null;
  end;
  select * into r3 from website_restore_revision(d1, r.revision_id, 2);
  if r3.revision_number <> 3
     or (select restored_from_revision_id from website_document_revisions where id = r3.revision_id) <> r.revision_id
     or (select title || '|' || sections::text from website_document_revisions where id = r3.revision_id)
        <> (select title || '|' || sections::text from website_document_revisions where id = r.revision_id) then
    raise exception 'FAIL: restore did not create a faithful new revision';
  end if;
  if (select published_revision_id from website_documents where id = d1) <> r2.revision_id then
    raise exception 'FAIL: restore changed the published revision without a publish';
  end if;
  if (select count(*) from website_document_revisions where document_id = d1) <> 3 then
    raise exception 'FAIL: revision history not kept';
  end if;

  -- Publishing requires an active Program (draft Program refused).
  select * into r from website_save_draft(d4, 0, 'Draft program headline', null, null, null, null, null, null, null, '[]');
  begin
    perform website_publish_document(d4, r.revision_id);
    raise exception 'FAIL: published website content for a draft Program';
  exception when sqlstate 'P2206' then null;
  end;

  -- Pages: navigation menu + home sections with safe links.
  select * into r from website_save_draft(home, 0, 'Home', null, 'ROICIANS TECH', 'Practical technology training for the AI era', 'ROICIANS TECH', null, null, null,
    '[{"key":"hero","type":"hero","heading":"Practical technology training for the AI era","cta":{"label":"Talk to an Advisor","href":"/contact"}},
      {"key":"programs","type":"program_showcase","heading":"Explore Programs"},
      {"key":"mail","type":"text","body":"Write to us.","items":[{"label":"Email","href":"mailto:info@example.com"},{"label":"Call","href":"tel:+91 98765 43210"},{"label":"External","href":"https://www.roicians.com/"}]}]'::jsonb);
  perform website_publish_document(home, r.revision_id);
  raise notice 'PASS W4/W5: pages and Program documents created; slug/duplicate rules; unsafe content refused; drafts private until explicit publish; published revision stable while drafting; stale save/publish/restore refused; restore is a new recorded revision';
end
$$;

-- W6 media.
do $$
declare
  d2 uuid := (select v from p22a_ids where k = 'd2');
  a1 uuid; r record; v integer;
begin
  begin
    perform website_register_media_asset('not-a-valid-path.svg', 'image/svg+xml', 100, null, null, null);
    raise exception 'FAIL: unsafe media accepted';
  exception when sqlstate '22023' then null;
  end;
  a1 := website_register_media_asset('aaaaaaaa-0000-4000-8000-00000000a001/hero.webp', 'image/webp', 120000, 1600, 900, null);
  insert into p22a_ids values ('a1', a1);
  if (select status from website_media_assets where id = a1) <> 'draft' then
    raise exception 'FAIL: new media asset is not draft';
  end if;
  begin
    perform website_save_draft(d2, 0, 'Beta', null, null, null, null, null, gen_random_uuid(), null, '[]');
    raise exception 'FAIL: unknown media asset reference accepted';
  exception when sqlstate 'P2206' then null;
  end;
  select * into r from website_save_draft(d2, 0, 'Beta headline', null, null, null, null, null, a1, a1,
    format('[{"key":"intro","type":"text","body":"Intro","imageAssetId":"%s"}]', a1)::jsonb);
  if (select count(*) from website_revision_media where revision_id = r.revision_id and asset_id = a1) <> 1 then
    raise exception 'FAIL: media usage not recorded';
  end if;
  begin
    perform website_publish_document(d2, r.revision_id);
    raise exception 'FAIL: published content with a draft (unapproved) image';
  exception when sqlstate 'P2206' then null;
  end;
  begin
    perform website_update_media_asset(a1, 1, null, 'approved');
    raise exception 'FAIL: approved an image without alt text';
  exception when sqlstate '22023' then null;
  end;
  v := website_update_media_asset(a1, 1, 'Learners at work', 'approved');
  perform website_publish_document(d2, r.revision_id);
  begin
    perform website_update_media_asset(a1, v, 'Learners at work', 'retired');
    raise exception 'FAIL: retired an image used by published content';
  exception when sqlstate 'P2206' then null;
  end;
  raise notice 'PASS W6: media is registered as draft in a private bucket; only approved images publish; usage tracked; published images cannot be withdrawn';
end
$$;

-- W7 placement + W8 Batch publication.
do $$
declare
  d1 uuid := (select v from p22a_ids where k = 'd1');
  g1 uuid := (select v from p22a_ids where k = 'g1');
  g2 uuid := (select v from p22a_ids where k = 'g2');
  v integer; bv integer;
begin
  v := (select version from website_documents where id = d1);
  v := website_update_program_placement(d1, v, g1, true, 1, 1);
  begin
    perform website_update_program_placement(d1, v - 1, g2, false, 2, null);
    raise exception 'FAIL: stale placement accepted';
  exception when sqlstate 'P2203' then null;
  end;
  begin
    perform website_update_program_placement(d1, v, g1, false, 1, 3);
    raise exception 'FAIL: featured order on a non-featured Program accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform website_set_display_group_archived(g1, (select version from website_display_groups where id = g1), true);
    raise exception 'FAIL: archived a group that still holds a Program';
  exception when sqlstate 'P2206' then null;
  end;
  perform website_set_display_group_archived(g2, (select version from website_display_groups where id = g2), true);
  begin
    perform website_update_program_placement(d1, v, g2, true, 1, 1);
    raise exception 'FAIL: assigned a Program to an archived group';
  exception when sqlstate 'P2206' then null;
  end;

  -- Batch publication.
  begin
    perform website_save_batch_publication('22a50000-0000-0000-0000-000000000001', 0, 'September Weekend Cohort', 'waitlist');
    raise exception 'FAIL: unknown registration state accepted';
  exception when sqlstate '22023' then null;
  end;
  bv := website_save_batch_publication('22a50000-0000-0000-0000-000000000001', 0, 'September Weekend Cohort', 'open');
  begin
    perform website_save_batch_publication('22a50000-0000-0000-0000-000000000001', 0, 'Other', 'open');
    raise exception 'FAIL: stale Batch publication save accepted';
  exception when sqlstate 'P2203' then null;
  end;
  if (select is_published from batch_website_publications where batch_id = '22a50000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: Batch published without an explicit publish';
  end if;
  bv := website_publish_batch('22a50000-0000-0000-0000-000000000001', bv);
  bv := website_save_batch_publication('22a50000-0000-0000-0000-000000000001', bv, 'Renamed Draft Label', 'full');
  if (select published_label || '|' || published_registration_state from batch_website_publications
       where batch_id = '22a50000-0000-0000-0000-000000000001') <> 'September Weekend Cohort|open' then
    raise exception 'FAIL: draft Batch edit changed the published label/state';
  end if;
  if (select status from batches where id = '22a50000-0000-0000-0000-000000000001') <> 'upcoming' then
    raise exception 'FAIL: publication changed operational batches.status';
  end if;
  bv := website_publish_batch('22a50000-0000-0000-0000-000000000001', bv);
  if (select published_registration_state from batch_website_publications where batch_id = '22a50000-0000-0000-0000-000000000001') <> 'full' then
    raise exception 'FAIL: Full not published';
  end if;
  bv := website_unpublish_batch('22a50000-0000-0000-0000-000000000001', bv);

  perform website_save_batch_publication('22a50000-0000-0000-0000-000000000002', 0, 'Draft Batch Label', 'open');
  begin
    perform website_publish_batch('22a50000-0000-0000-0000-000000000002', 1);
    raise exception 'FAIL: published a Batch whose operational status is draft';
  exception when sqlstate 'P2206' then null;
  end;
  raise notice 'PASS W7/W8: placement versioned; archived groups protected; Batch publication is explicit, separate from batches.status, open/closed/full only, published values stable while drafting';
end
$$;

-- Direct table writes by an Admin are refused (no privilege), including
-- attempts to rewrite a slug or a revision.
do $$
begin
  begin
    update website_documents set slug = 'phase22a-hijack' where id = (select v from p22a_ids where k = 'd1');
    raise exception 'FAIL: Admin updated website_documents directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update website_document_revisions set title = 'tampered' where id = (select v from p22a_ids where k = 'd1r1');
    raise exception 'FAIL: Admin updated a revision directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into website_document_revisions (document_id, revision_number, title)
    values ((select v from p22a_ids where k = 'd1'), 99, 'smuggled');
    raise exception 'FAIL: Admin inserted a revision directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into batch_website_publications (batch_id, is_published) values ('22a50000-0000-0000-0000-000000000002', true);
    raise exception 'FAIL: Admin inserted a Batch publication directly';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from website_program_slug_history;
    raise exception 'FAIL: Admin deleted slug history directly';
  exception when insufficient_privilege then null;
  end;
  -- W9: Admin cannot change a published Program's slug through the function.
  begin
    perform website_change_program_slug((select v from p22a_ids where k = 'd1'),
      (select version from website_documents where id = (select v from p22a_ids where k = 'd1')), 'phase22a-alpha-renamed');
    raise exception 'FAIL: Admin changed a published Program slug';
  exception when insufficient_privilege then null;
  end;
  -- ...but can before first publication.
  perform website_change_program_slug((select v from p22a_ids where k = 'd3'),
    (select version from website_documents where id = (select v from p22a_ids where k = 'd3')), 'phase22a-draft-renamed');
  if exists (select 1 from website_program_slug_history) then
    raise exception 'FAIL: a never-published slug change reserved a redirect';
  end if;
  raise notice 'PASS W9a: Admin has no direct write path; published slug change refused for Admin; pre-publication slug change allowed without history';
end
$$;

-- W11 audit.
do $$
begin
  if (select count(*) from audit_logs where actor_auth_user_id = '22a00000-0000-0000-0000-000000000002'
        and action like 'website_%') < 15 then
    raise exception 'FAIL: website changes were not audited';
  end if;
  if exists (select 1 from audit_logs where (action like 'website_%' or action like 'batch_website_%')
               and (after_data ? 'sections' or after_data ? 'body' or before_data ? 'sections')) then
    raise exception 'FAIL: audit rows copy content bodies';
  end if;
  if not exists (select 1 from audit_logs where action = 'website_document.published' and actor_role = 'admin'
                 and after_data ->> 'programId' = '22a40000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: publish not audited with publisher and Program';
  end if;
  raise notice 'PASS W11: every website change audited in-transaction with actor/role; no content bodies copied';
end
$$;

-- ===========================================================================
-- W9 Super Admin slug change + owner/service role cannot bypass

set local "request.jwt.claims" to '{"sub":"22a00000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  d1 uuid := (select v from p22a_ids where k = 'd1');
begin
  perform website_change_program_slug(d1, (select version from website_documents where id = d1), 'phase22a-alpha-renamed');
  if (select slug from website_documents where id = d1) <> 'phase22a-alpha-renamed' then
    raise exception 'FAIL: Super Admin slug change not applied';
  end if;
  if not exists (select 1 from website_program_slug_history where document_id = d1 and old_slug = 'phase22a-alpha'
                 and new_slug = 'phase22a-alpha-renamed' and changed_by = '22a00000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: slug history not recorded';
  end if;
  begin
    perform website_create_program_document('22a40000-0000-0000-0000-000000000004', 'phase22a-alpha');
    raise exception 'FAIL: reserved historical slug reused';
  exception when sqlstate 'P2205' then null;
  end;
  begin
    perform website_change_program_slug(d1, (select version from website_documents where id = d1), 'phase22a-alpha');
    raise exception 'FAIL: Program moved back onto its own reserved slug';
  exception when sqlstate 'P2205' then null;
  end;
  raise notice 'PASS W9b: Super Admin changes a published slug; the old slug is reserved and never reusable';
end
$$;

reset role;

do $$
declare
  d1 uuid := (select v from p22a_ids where k = 'd1');
begin
  -- Table owner / service role with no Super Admin session.
  perform set_config('request.jwt.claims', '', true);
  begin
    update website_documents set slug = 'phase22a-owner-bypass' where id = d1;
    raise exception 'FAIL: published slug changed without a Super Admin session';
  exception when insufficient_privilege then null;
  end;
  begin
    update website_document_revisions set title = 'owner tamper' where id = (select v from p22a_ids where k = 'd1r1');
    raise exception 'FAIL: revision updated by the table owner';
  exception when insufficient_privilege then null;
  end;
  begin
    update website_documents set first_published_at = null where id = d1;
    raise exception 'FAIL: first-publication history cleared';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from website_documents where id = d1;
    raise exception 'FAIL: a published website document was deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    update website_documents set published_revision_id = (select id from website_document_revisions
      where document_id = (select v from p22a_ids where k = 'd2') limit 1) where id = d1;
    raise exception 'FAIL: document pointed at another document''s revision';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS W9c: even the table owner cannot change a published slug without a Super Admin session, rewrite revisions, clear publication history, delete published content or cross-link revisions';
end
$$;

-- ===========================================================================
-- W10 Trainer / Student / anon / inactive Admin

set local role authenticated;

do $$
declare
  who text;
  n bigint;
begin
  foreach who in array array['22a00000-0000-0000-0000-000000000003', '22a00000-0000-0000-0000-000000000004',
                             '22a00000-0000-0000-0000-000000000005'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
    select (select count(*) from website_display_groups) + (select count(*) from website_documents)
         + (select count(*) from website_document_revisions) + (select count(*) from website_media_assets)
         + (select count(*) from website_revision_media) + (select count(*) from website_program_slug_history)
         + (select count(*) from batch_website_publications)
      into n;
    if n <> 0 then raise exception 'FAIL: % can read % website management rows', who, n; end if;
    begin
      perform website_create_display_group('Intruder Group', null);
      raise exception 'FAIL: % created a display group', who;
    exception when insufficient_privilege then null;
    end;
    begin
      perform website_save_draft((select v from p22a_ids where k = 'd1'), 3, 'x', null, null, null, null, null, null, null, '[]');
      raise exception 'FAIL: % saved website content', who;
    exception when insufficient_privilege then null;
    end;
    begin
      perform website_publish_batch('22a50000-0000-0000-0000-000000000001', 1);
      raise exception 'FAIL: % published a Batch', who;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- Existing Student/Trainer Batch reads are unchanged and expose no
  -- website management field (the columns do not exist on batches).
  perform set_config('request.jwt.claims', '{"sub":"22a00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  if (select count(*) from batches where id = '22a50000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: Student lost read access to their own Batch';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"22a00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  if (select count(*) from batches where id = '22a50000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'FAIL: Trainer lost read access to their assigned Batch';
  end if;
  if (select count(*) from storage.objects where bucket_id = 'website-media') <> 0 then
    raise exception 'FAIL: Trainer sees website-media objects';
  end if;
  raise notice 'PASS W10: Trainer, Student and inactive Admin read no website management rows and cannot mutate; existing Batch reads unchanged';
end
$$;

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

do $$
begin
  begin
    perform 1 from website_documents limit 1;
    raise exception 'FAIL: anon selected website_documents';
  exception when insufficient_privilege then null;
  end;
  begin
    perform website_create_display_group('Anon Group', null);
    raise exception 'FAIL: anon executed a website function';
  exception when insufficient_privilege then null;
  end;
  begin
    perform program_deletion_blockers('22a40000-0000-0000-0000-000000000010');
    raise exception 'FAIL: anon executed program_deletion_blockers';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS W10b: anon has no access to website tables or functions';
end
$$;

-- ===========================================================================
-- D1 Admin / inactive Super Admin cannot delete

reset role;
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22a00000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
begin
  begin
    delete from programs where id = '22a40000-0000-0000-0000-000000000010';
    raise exception 'FAIL: Admin deleted a Program directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform delete_archived_program('22a40000-0000-0000-0000-000000000010', 'P22A-SAFE', 'Admin attempt');
    raise exception 'FAIL: Admin used delete_archived_program';
  exception when insufficient_privilege then null;
  end;
  begin
    perform program_deletion_blockers('22a40000-0000-0000-0000-000000000010');
    raise exception 'FAIL: Admin reviewed deletion eligibility';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"22a00000-0000-0000-0000-000000000006","role":"authenticated"}', true);
  begin
    perform delete_archived_program('22a40000-0000-0000-0000-000000000010', 'P22A-SAFE', 'Inactive super attempt');
    raise exception 'FAIL: inactive Super Admin deleted a Program';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"22a00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  begin
    perform delete_archived_program('22a40000-0000-0000-0000-000000000010', 'P22A-SAFE', 'Trainer attempt');
    raise exception 'FAIL: Trainer deleted a Program';
  exception when insufficient_privilege then null;
  end;
  if not exists (select 1 from programs where id = '22a40000-0000-0000-0000-000000000010') then
    raise exception 'FAIL: Program missing after refused attempts';
  end if;
  raise notice 'PASS D1: Admin (direct DELETE and function), inactive Super Admin and Trainer cannot delete a Program';
end
$$;

-- Owner / service role: the guard trigger refuses a raw delete.
reset role;
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    delete from programs where id = '22a40000-0000-0000-0000-000000000010';
    raise exception 'FAIL: table owner deleted a Program outside the controlled workflow';
  exception when insufficient_privilege then null;
  end;
  perform set_config('roicians.program_delete_authorized', '22a40000-0000-0000-0000-0000000000ff', true);
  begin
    delete from programs where id = '22a40000-0000-0000-0000-000000000010';
    raise exception 'FAIL: guard accepted an authorization for a different Program';
  exception when insufficient_privilege then null;
  end;
  perform set_config('roicians.program_delete_authorized', '', true);
  raise notice 'PASS D1b: the guard trigger refuses raw Program deletes by the table owner/service role';
end
$$;
set local role service_role;
do $$
begin
  begin
    delete from programs where id = '22a40000-0000-0000-0000-000000000010';
    raise exception 'FAIL: service_role deleted a Program outside the controlled workflow';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS D1c: service_role (bypasses RLS) is still refused by the guard trigger';
end
$$;

-- ===========================================================================
-- D2–D5 Super Admin

reset role;
-- Extra fixtures needing website state, created as Admin via the functions.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22a00000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  dw uuid; dp uuid; dl uuid; r record; home uuid := (select v from p22a_ids where k = 'home');
begin
  -- never-published website draft (P22A-DRAFT-WEB)
  dw := website_create_program_document('22a40000-0000-0000-0000-000000000024', 'phase22a-never-published');
  perform website_save_draft(dw, 0, 'Never published', null, null, null, null, null, null, null, '[]');
  insert into p22a_ids values ('dw', dw);
  -- published then unpublished (P22A-PUB-WEB)
  dp := website_create_program_document('22a40000-0000-0000-0000-000000000025', 'phase22a-was-published');
  select * into r from website_save_draft(dp, 0, 'Was published', null, null, null, null, null, null, null, '[]');
  perform website_publish_document(dp, r.revision_id);
  perform website_unpublish_document(dp, (select version from website_documents where id = dp));
  insert into p22a_ids values ('dp', dp);
  -- a page links to P22A-LINKED's slug, then its own draft document is discarded
  dl := website_create_program_document('22a40000-0000-0000-0000-000000000026', 'phase22a-linked');
  perform website_save_draft(home, (select latest_revision_number from website_documents where id = home),
    'Home', null, null, null, null, null, null, null,
    '[{"key":"hero","type":"hero","heading":"Hello","cta":{"label":"See it","href":"/programs/phase22a-linked?ref=home"}}]'::jsonb);
  perform website_discard_unpublished_document(dl, (select version from website_documents where id = dl));
  begin
    perform website_discard_unpublished_document(dp, (select version from website_documents where id = dp));
    raise exception 'FAIL: discarded a document that was published';
  exception when sqlstate 'P2206' then null;
  end;
end
$$;

reset role;
update programs set status = 'archived'
 where id in ('22a40000-0000-0000-0000-000000000024', '22a40000-0000-0000-0000-000000000025', '22a40000-0000-0000-0000-000000000026');
-- A table added in the future with an FK to programs is covered automatically.
create table p22a_future_refs (id serial primary key, program_id uuid references programs (id) on delete cascade);
insert into p22a_future_refs (program_id) values ('22a40000-0000-0000-0000-000000000027');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"22a00000-0000-0000-0000-000000000001","role":"authenticated"}';

create temp table p22a_snapshot on commit drop as
select
  (select count(*) from programs where id::text like '22a4%') as programs,
  (select count(*) from batches where id::text like '22a5%') as batches,
  (select count(*) from enrollments where id::text like '22a6%') as enrollments,
  (select count(*) from certificates where id::text like '22a7%') as certificates,
  (select count(*) from program_modules where program_id::text like '22a4%') as modules,
  (select count(*) from materials where program_id::text like '22a4%') as materials,
  (select count(*) from assignments where program_id::text like '22a4%') as assignments,
  (select count(*) from leads where program_id is not null and program_id::text like '22a4%') as leads,
  (select count(*) from audit_logs) as audit_rows;

do $$
declare
  c record;
  codes text;
  expected text;
  st text; msg text; det text;
begin
  -- D2: unarchived, wrong confirmation, missing reason.
  select string_agg(code, ',' order by code) into codes from program_deletion_blockers('22a40000-0000-0000-0000-000000000023');
  if codes is distinct from 'not_archived' then raise exception 'FAIL: unarchived blockers = %', codes; end if;
  begin
    perform delete_archived_program('22a40000-0000-0000-0000-000000000023', 'P22A-ACTIVE-DEL', 'Unarchived attempt');
    raise exception 'FAIL: deleted an unarchived Program';
  exception when sqlstate 'P2201' then
    get stacked diagnostics det = pg_exception_detail;
    if det <> 'not_archived' then raise exception 'FAIL: unarchived detail %', det; end if;
  end;
  begin
    perform delete_archived_program('22a40000-0000-0000-0000-000000000010', 'p22a-safe', 'Wrong case confirmation');
    raise exception 'FAIL: confirmation mismatch accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform delete_archived_program('22a40000-0000-0000-0000-000000000010', 'P22A-SAFE', '   ');
    raise exception 'FAIL: missing reason accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform delete_archived_program(gen_random_uuid(), 'X', 'Missing Program');
    raise exception 'FAIL: missing Program accepted';
  exception when sqlstate 'P2204' then null;
  end;

  -- D3: each category blocks, with the expected reason.
  for c in select * from (values
    ('22a40000-0000-0000-0000-000000000011'::uuid, 'P22A-DEP-BATCH', 'dependency:batches'),
    ('22a40000-0000-0000-0000-000000000012'::uuid, 'P22A-DEP-ENROL', 'dependency:enrollments'),
    ('22a40000-0000-0000-0000-000000000013'::uuid, 'P22A-DEP-CERT', 'dependency:certificates,dependency:enrollments'),
    ('22a40000-0000-0000-0000-000000000014'::uuid, 'P22A-DEP-MODULE', 'dependency:program_modules'),
    ('22a40000-0000-0000-0000-000000000015'::uuid, 'P22A-DEP-MATERIAL', 'dependency:materials'),
    ('22a40000-0000-0000-0000-000000000016'::uuid, 'P22A-DEP-ASSIGN', 'dependency:assignments,dependency:batches'),
    ('22a40000-0000-0000-0000-000000000017'::uuid, 'P22A-DEP-LEAD', 'dependency:leads'),
    ('22a40000-0000-0000-0000-000000000018'::uuid, 'P22A-DEP-THUMB', 'stored_file_reference'),
    ('22a40000-0000-0000-0000-000000000019'::uuid, 'P22A-DEP-FILE', 'stored_files'),
    ('22a40000-0000-0000-0000-000000000020'::uuid, 'P22A-EV-ID', 'audit_history'),
    ('22a40000-0000-0000-0000-000000000021'::uuid, 'P22A-EV-CODE', 'audit_history'),
    ('22a40000-0000-0000-0000-000000000022'::uuid, 'P22A-EV-ACTION', 'audit_history'),
    ('22a40000-0000-0000-0000-000000000024'::uuid, 'P22A-DRAFT-WEB', 'dependency:website_documents'),
    ('22a40000-0000-0000-0000-000000000025'::uuid, 'P22A-PUB-WEB', 'dependency:website_documents,website_published_history'),
    ('22a40000-0000-0000-0000-000000000026'::uuid, 'P22A-LINKED', 'website_link_reference'),
    ('22a40000-0000-0000-0000-000000000027'::uuid, 'P22A-NEW-FK', 'dependency:p22a_future_refs')
  ) as t(pid, code, expected_codes)
  loop
    select string_agg(b.code, ',' order by b.code) into codes from program_deletion_blockers(c.pid) b;
    if codes is distinct from c.expected_codes then
      raise exception 'FAIL: % blockers = %, expected %', c.code, codes, c.expected_codes;
    end if;
    begin
      perform delete_archived_program(c.pid, c.code, 'Blocked attempt');
      raise exception 'FAIL: deleted % despite %', c.code, codes;
    exception when sqlstate 'P2201' then
      get stacked diagnostics det = pg_exception_detail, msg = message_text;
      if det is distinct from replace(c.expected_codes, ',', ', ') then
        raise exception 'FAIL: % refusal detail %', c.code, det;
      end if;
      if msg not like '%can remain archived%' then
        raise exception 'FAIL: refusal message lacks the archive alternative';
      end if;
    end;
  end loop;

  -- No partial change from any refused attempt.
  if (select row(programs, batches, enrollments, certificates, modules, materials, assignments, leads, audit_rows)::text from p22a_snapshot)
     <> (select row(
          (select count(*) from programs where id::text like '22a4%'),
          (select count(*) from batches where id::text like '22a5%'),
          (select count(*) from enrollments where id::text like '22a6%'),
          (select count(*) from certificates where id::text like '22a7%'),
          (select count(*) from program_modules where program_id::text like '22a4%'),
          (select count(*) from materials where program_id::text like '22a4%'),
          (select count(*) from assignments where program_id::text like '22a4%'),
          (select count(*) from leads where program_id is not null and program_id::text like '22a4%'),
          (select count(*) from audit_logs))::text) then
    raise exception 'FAIL: a refused deletion changed data or wrote audit rows';
  end if;
  if exists (select 1 from audit_logs where action = 'program.deleted') then
    raise exception 'FAIL: a refused deletion left a program.deleted record';
  end if;
  raise notice 'PASS D2/D3: unarchived, mismatched confirmation, missing reason and every dependency/file/website/audit-evidence category are refused with reasons and the archive alternative; nothing changed';
end
$$;

do $$
declare
  audit_id uuid;
  rec record;
begin
  -- D4: routine-audit-only safe archived Program.
  if exists (select 1 from program_deletion_blockers('22a40000-0000-0000-0000-000000000010')) then
    raise exception 'FAIL: routine audit records blocked an otherwise eligible Program';
  end if;
  audit_id := delete_archived_program('22a40000-0000-0000-0000-000000000010', 'P22A-SAFE', 'Created in error during setup');
  if exists (select 1 from programs where id = '22a40000-0000-0000-0000-000000000010') then
    raise exception 'FAIL: eligible Program not deleted';
  end if;
  if (select count(*) from audit_logs where entity_id = '22a40000-0000-0000-0000-000000000010'
        and action in ('program.create', 'program.update', 'program.status_change')) <> 3 then
    raise exception 'FAIL: routine audit records did not survive';
  end if;
  select * into rec from audit_logs where id = audit_id;
  if rec.action <> 'program.deleted' or rec.entity_type <> 'program'
     or rec.entity_id <> '22a40000-0000-0000-0000-000000000010'
     or rec.actor_auth_user_id <> '22a00000-0000-0000-0000-000000000001' or rec.actor_role <> 'super_admin'
     or rec.before_data ->> 'programCode' <> 'P22A-SAFE'
     or rec.after_data ->> 'reason' <> 'Created in error during setup'
     or (rec.after_data ->> 'retainedAuditRecords')::int <> 3 then
    raise exception 'FAIL: deletion audit record incomplete: %', row_to_json(rec);
  end if;
  if coalesce(current_setting('roicians.program_delete_authorized', true), '') <> '' then
    raise exception 'FAIL: delete authorization left set after the call';
  end if;

  -- D5: discard the never-published draft, then the Program is eligible.
  perform set_config('request.jwt.claims', '{"sub":"22a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  perform website_discard_unpublished_document((select v from p22a_ids where k = 'dw'),
    (select version from website_documents where id = (select v from p22a_ids where k = 'dw')));
  perform set_config('request.jwt.claims', '{"sub":"22a00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  if exists (select 1 from program_deletion_blockers('22a40000-0000-0000-0000-000000000024')) then
    raise exception 'FAIL: routine never-published website drafting blocked deletion: %',
      (select string_agg(code, ',') from program_deletion_blockers('22a40000-0000-0000-0000-000000000024'));
  end if;
  perform delete_archived_program('22a40000-0000-0000-0000-000000000024', 'P22A-DRAFT-WEB', 'Never launched');
  if exists (select 1 from programs where id = '22a40000-0000-0000-0000-000000000024') then
    raise exception 'FAIL: Program with discarded draft not deleted';
  end if;

  -- Still blocked: the published/unpublished Program (TI-7).
  if not exists (select 1 from program_deletion_blockers('22a40000-0000-0000-0000-000000000025') where code = 'website_published_history') then
    raise exception 'FAIL: previously published Program not blocked';
  end if;
  raise notice 'PASS D4/D5: eligible archived Program deleted by Super Admin with a durable audit record; routine audit rows survive and do not block; never-published drafts can be discarded; previously published Programs stay blocked (TI-7)';
end
$$;

rollback;
