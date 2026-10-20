-- Phase 22A — forward corrections to migrations 40 and 41
-- (docs/recovery/PHASE_22A_RECOVERY_REVIEW.md; approved 2026-10-20).
--
-- Migrations 40 and 41 are left exactly as committed. This migration:
--
--   1. Page content: adds the `programs_listing` and `upcoming_batches`
--      single-instance page kinds (intro, FAQs and other supported sections
--      for the Programs and Upcoming Batches pages). Program and Batch facts
--      themselves still come from their own records.
--   2. Programs keep a trustworthy creation time: `programs.created_at`
--      cannot be changed after insert or set in the future. Eligibility (5)
--      relies on it.
--   3. Durable deletion evidence: deleting an enrollment, Batch or
--      certificate row by ANY route (application, service role, SQL) writes
--      an audit row naming its Program, in the same transaction. No
--      permission is added or removed.
--   4. Unattributable history: audit evidence of training or financial
--      records that no longer exist and that no surviving record ties to a
--      Program. It blocks deletion of every Program that already existed
--      when that evidence was recorded (fail-closed; no override).
--   5. program_deletion_blockers_internal() gains the
--      `unattributable_history` blocker.
--   6. guard_program_delete() additionally requires the DELETE to run as the
--      owner of delete_archived_program(): a self-set
--      roicians.program_delete_authorized marker is no longer enough for
--      anon, authenticated or service_role. The database owner itself is
--      outside what this workflow can protect against.
--   7. Phase 22 internal helpers lose EXECUTE for service_role (and stay
--      revoked from PUBLIC, anon, authenticated). Self-checking management
--      functions keep their grants.

-- ---------------------------------------------------------------------------
-- 1. Programs-listing and Upcoming-Batches page kinds

alter table website_documents drop constraint website_documents_kind;
alter table website_documents add constraint website_documents_kind check (kind in (
  'home', 'about', 'corporate_training', 'institutions', 'contact', 'legal', 'navigation', 'footer', 'program',
  'programs_listing', 'upcoming_batches'
));

drop index if exists website_documents_singleton_kind_key;
create unique index website_documents_singleton_kind_key on website_documents (kind)
  where kind in ('home', 'about', 'corporate_training', 'institutions', 'contact', 'navigation', 'footer',
                 'programs_listing', 'upcoming_batches');

create or replace function website_allowed_section_types(p_kind text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'program' then array['text', 'list', 'faq', 'cta']
    when 'home' then array['hero', 'text', 'list', 'faq', 'cta', 'banner', 'program_showcase']
    when 'about' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    when 'corporate_training' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    when 'institutions' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    when 'contact' then array['hero', 'text', 'contact_details', 'cta']
    when 'legal' then array['text', 'consent_text']
    when 'navigation' then array['menu']
    when 'footer' then array['footer_column', 'text']
    when 'programs_listing' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    when 'upcoming_batches' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    else array[]::text[]
  end;
$$;

create or replace function website_create_page(p_kind text, p_page_key text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform website_assert_manager();
  if p_kind is null or p_kind = 'program'
     or p_kind <> all (array['home', 'about', 'corporate_training', 'institutions', 'contact', 'legal', 'navigation', 'footer',
                             'programs_listing', 'upcoming_batches']) then
    raise exception using errcode = '22023', message = 'Unsupported page type';
  end if;
  if p_page_key is null or char_length(p_page_key) not between 2 and 100 or p_page_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'Page key must be lowercase letters, digits and hyphens';
  end if;
  begin
    insert into website_documents (kind, page_key, created_by, updated_by)
    values (p_kind, p_page_key, auth.uid(), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'That page already exists';
  end;
  perform website_audit('website_document.created', 'website_document', v_id, null,
    jsonb_build_object('kind', p_kind, 'pageKey', p_page_key));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Trustworthy Program creation time

create or replace function guard_program_created_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at > now() + interval '5 minutes' then
      raise exception using errcode = '22023', message = 'A Program cannot be created with a future creation time';
    end if;
  elsif new.created_at is distinct from old.created_at then
    raise exception using errcode = '42501', message = 'A Program''s creation time cannot be changed';
  end if;
  return new;
end;
$$;

comment on function guard_program_created_at() is
  'Phase 22A correction: programs.created_at is fixed after insert and never in the future, so deletion eligibility can rely on it.';

create trigger programs_guard_created_at
  before insert or update of created_at on programs
  for each row execute function guard_program_created_at();

-- ---------------------------------------------------------------------------
-- 3. Durable evidence when a Program-linked record is deleted (any route)

create or replace function record_program_history_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entity text;
  v_before jsonb;
begin
  if tg_table_name = 'enrollments' then
    v_entity := 'enrollment';
    v_before := jsonb_build_object('programId', old.program_id, 'batchId', old.batch_id, 'status', old.status);
  elsif tg_table_name = 'batches' then
    v_entity := 'batch';
    v_before := jsonb_build_object('programId', old.program_id, 'status', old.status);
  elsif tg_table_name = 'certificates' then
    v_entity := 'certificate';
    v_before := jsonb_build_object('programId', old.program_id, 'enrollmentId', old.enrollment_id, 'status', old.status);
  else
    raise exception using errcode = '42501', message = 'record_program_history_on_delete attached to an unsupported table';
  end if;

  insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, before_data, after_data)
  values (auth.uid(), 'system', v_entity || '.row_deleted', v_entity, old.id, v_before,
          jsonb_build_object('source', 'delete_trigger'));
  return old;
end;
$$;

comment on function record_program_history_on_delete() is
  'Phase 22A correction: BEFORE DELETE on enrollments, batches and certificates. Records <entity>.row_deleted with the Program id (and Batch/enrollment link, status) in audit_logs, in the deleting transaction, whatever the route. Grants and deletes nothing.';

create trigger enrollments_record_program_history
  before delete on enrollments
  for each row execute function record_program_history_on_delete();
create trigger batches_record_program_history
  before delete on batches
  for each row execute function record_program_history_on_delete();
create trigger certificates_record_program_history
  before delete on certificates
  for each row execute function record_program_history_on_delete();

-- ---------------------------------------------------------------------------
-- 4. Unattributable training / financial history

-- Evidence considered (from audit_logs only; nothing is modified):
--   * rows whose entity is a protected record (enrollment, batch, payment,
--     certificate, class_session, attendance, assignment, assignment_submission,
--     payment_plan, installment, refund, receipt);
--   * references inside any row's payload to an enrollmentId, batchId,
--     paymentId or assignmentId.
-- A reference is ATTRIBUTABLE when its record still exists (its foreign keys
-- tie it to a Program), or when some audit row about that record carries a
-- programId, enrollmentId, batchId, paymentId or assignmentId (the onward
-- reference is then checked the same way). Anything else is UNATTRIBUTABLE: it cannot be shown
-- to belong to any particular Program.
-- A Program is affected when unattributable evidence was recorded at or after
-- the Program's creation (the earlier of programs.created_at and its first
-- audit record). Evidence recorded before a Program existed cannot concern
-- it: every protected record requires its Program to exist first.
create or replace function program_unattributable_history(p_program_id uuid)
returns table (evidence_count bigint, latest_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with prog as (
    select least(
             p.created_at,
             coalesce((select min(a.created_at) from audit_logs a
                        where a.entity_id = p.id
                           or a.after_data ->> 'programId' = p.id::text
                           or a.before_data ->> 'programId' = p.id::text), p.created_at)
           ) as since
      from programs p where p.id = p_program_id
  ),
  refs as (
    select a.created_at, a.entity_type as kind, a.entity_id::text as ref
      from audit_logs a
     where a.entity_type in ('enrollment', 'batch', 'payment', 'certificate', 'class_session', 'attendance',
                             'assignment', 'assignment_submission', 'payment_plan', 'installment', 'refund', 'receipt')
    union all
    select a.created_at, k.kind, coalesce(a.after_data ->> k.key, a.before_data ->> k.key)
      from audit_logs a
      cross join (values ('enrollmentId', 'enrollment'), ('batchId', 'batch'), ('paymentId', 'payment'),
                         ('assignmentId', 'assignment')) as k(key, kind)
     where coalesce(a.after_data ->> k.key, a.before_data ->> k.key)
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  unresolved as (
    select r.created_at
      from refs r
     where not (case r.kind
                  when 'enrollment' then exists (select 1 from enrollments x where x.id::text = r.ref)
                  when 'batch' then exists (select 1 from batches x where x.id::text = r.ref)
                  when 'payment' then exists (select 1 from payments x where x.id::text = r.ref)
                  when 'certificate' then exists (select 1 from certificates x where x.id::text = r.ref)
                  when 'class_session' then exists (select 1 from class_sessions x where x.id::text = r.ref)
                  when 'attendance' then exists (select 1 from attendance x where x.id::text = r.ref)
                  when 'assignment' then exists (select 1 from assignments x where x.id::text = r.ref)
                  when 'assignment_submission' then exists (select 1 from assignment_submissions x where x.id::text = r.ref)
                  when 'payment_plan' then exists (select 1 from payment_plans x where x.id::text = r.ref)
                  when 'installment' then exists (select 1 from installments x where x.id::text = r.ref)
                  when 'refund' then exists (select 1 from payment_refunds x where x.id::text = r.ref)
                  when 'receipt' then exists (select 1 from receipts x where x.id::text = r.ref)
                  else false
                end)
       and not exists (
             select 1 from audit_logs x
              where x.entity_type = r.kind and x.entity_id::text = r.ref
                and (   jsonb_strip_nulls(coalesce(x.after_data, '{}'::jsonb))  ?| array['programId', 'enrollmentId', 'batchId', 'paymentId', 'assignmentId']
                     or jsonb_strip_nulls(coalesce(x.before_data, '{}'::jsonb)) ?| array['programId', 'enrollmentId', 'batchId', 'paymentId', 'assignmentId']))
  )
  select count(*), max(u.created_at)
    from unresolved u, prog
   where u.created_at >= prog.since;
$$;

comment on function program_unattributable_history(uuid) is
  'Phase 22A correction: counts audit evidence of protected records that no longer exist and cannot be attributed to any Program, recorded while the given Program existed. Internal; read-only.';

-- ---------------------------------------------------------------------------
-- 5. Eligibility: migration 41 rules + unattributable history

create or replace function program_deletion_blockers_internal(p_program_id uuid)
returns table (code text, detail text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prog record;
  fk record;
  n bigint;
  v_id text := p_program_id::text;
  slugs text[];
  routine_program text[] := array['program.create', 'program.update', 'program.status_change'];
  routine_website text[] := array[
    'website_document.created', 'website_document.draft_saved', 'website_document.revision_restored',
    'website_document.placement_updated', 'website_document.slug_changed', 'website_document.discarded'
  ];
  ev record;
  u record;
begin
  select p.id, p.program_code, p.status, p.thumbnail_path into prog from programs p where p.id = p_program_id;
  if prog.id is null then
    return query select 'not_found'::text, 'Program not found'::text;
    return;
  end if;

  if prog.status <> 'archived' then
    return query select 'not_archived'::text, format('Program status is %s; archive it first', prog.status);
  end if;

  -- Every foreign key that references programs, from the live catalog.
  for fk in
    select c.conname, c.conrelid::regclass as tbl, c.conkey, n2.nspname, cl.relname
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n2 on n2.oid = cl.relnamespace
     where c.contype = 'f' and c.confrelid = 'public.programs'::regclass
     order by cl.relname, c.conname
  loop
    if array_length(fk.conkey, 1) <> 1 then
      return query select 'uncertain_dependency'::text, format('%s (%s)', fk.relname, fk.conname);
      continue;
    end if;
    execute format('select count(*) from %I.%I where %I = $1',
                   fk.nspname, fk.relname,
                   (select a.attname from pg_attribute a where a.attrelid = fk.tbl and a.attnum = fk.conkey[1]))
      into n using p_program_id;
    if n > 0 then
      return query select ('dependency:' || fk.relname)::text, format('%s linked %s record(s)', n, fk.relname);
    end if;
  end loop;

  if prog.thumbnail_path is not null then
    return query select 'stored_file_reference'::text, 'The Program has a thumbnail file reference'::text;
  end if;

  select count(*) into n from storage.objects o where position(v_id in o.name) > 0;
  if n > 0 then
    return query select 'stored_files'::text, format('%s stored file(s) are filed under this Program', n);
  end if;

  -- Website publication history (TI-7).
  if exists (select 1 from website_documents d where d.program_id = p_program_id and d.first_published_at is not null)
     or exists (
       select 1 from audit_logs a
        where a.action in ('website_document.published', 'website_document.unpublished')
          and coalesce(a.after_data ->> 'programId', '') = v_id
     ) then
    return query select 'website_published_history'::text,
      'The Program''s website content was published before; safe handling of its old slug, links and assets is not designed yet (TI-7)'::text;
  end if;

  -- Slugs this Program ever had, then any website revision linking to /programs/<slug>.
  select coalesce(array_agg(distinct s), array[]::text[]) into slugs from (
    select d.slug as s from website_documents d where d.program_id = p_program_id and d.slug is not null
    union all
    select h.old_slug from website_program_slug_history h
      join website_documents d on d.id = h.document_id where d.program_id = p_program_id
    union all
    select a.after_data ->> 'slug' from audit_logs a
     where a.entity_type = 'website_document' and coalesce(a.after_data ->> 'programId', '') = v_id
       and a.after_data ? 'slug'
    union all
    select a.before_data ->> 'slug' from audit_logs a
     where a.entity_type = 'website_document' and coalesce(a.before_data ->> 'programId', a.after_data ->> 'programId', '') = v_id
       and a.before_data ? 'slug'
  ) x where s is not null and s ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
  if cardinality(slugs) > 0 then
    select count(*) into n from website_document_revisions r
     where exists (
       select 1 from unnest(slugs) s
        where r.sections::text ~ ('"/programs/' || s || '([/?#][^"]*)?"')
     );
    if n > 0 then
      return query select 'website_link_reference'::text, format('%s website revision(s) link to this Program''s page', n);
    end if;
  end if;

  -- Audit evidence naming this Program beyond routine maintenance /
  -- never-published drafting (includes *.row_deleted evidence).
  for ev in
    select a.action, count(*) as c
      from audit_logs a
     where (
             a.entity_id = p_program_id
             or jsonb_path_exists(coalesce(a.before_data, 'null'::jsonb), '$.** ? (@ == $v)', jsonb_build_object('v', v_id))
             or jsonb_path_exists(coalesce(a.after_data, 'null'::jsonb), '$.** ? (@ == $v)', jsonb_build_object('v', v_id))
             or (a.entity_type <> 'program' and (
                  jsonb_path_exists(coalesce(a.before_data, 'null'::jsonb), '$.** ? (@ == $v)', jsonb_build_object('v', prog.program_code))
                  or jsonb_path_exists(coalesce(a.after_data, 'null'::jsonb), '$.** ? (@ == $v)', jsonb_build_object('v', prog.program_code))))
           )
       and not (a.entity_type = 'program' and a.entity_id = p_program_id and a.action = any (routine_program))
       and not (a.entity_type = 'website_document' and a.action = any (routine_website))
       and a.action not in ('website_document.published', 'website_document.unpublished')
     group by a.action
     order by a.action
  loop
    return query select 'audit_history'::text, format('%s audit record(s) of %s', ev.c, ev.action);
  end loop;

  -- History that can no longer be tied to any Program (fail-closed).
  select h.evidence_count, h.latest_at into u from program_unattributable_history(p_program_id) h;
  if u.evidence_count > 0 then
    return query select 'unattributable_history'::text,
      format('%s audit record(s) of training or financial history recorded while this Program existed (latest %s) can no longer be linked to any Program, so this Program cannot be shown to be unused',
             u.evidence_count, to_char(u.latest_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Deletion guard: marker AND owner execution context

create or replace function guard_program_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Deliberately NOT security definer: current_user here is the role that
  -- issued the DELETE. Inside delete_archived_program() (SECURITY DEFINER)
  -- that is its owner; in anon / authenticated / service_role sessions it is
  -- that role, so a self-set marker no longer suffices. A session running as
  -- the owner itself can still satisfy both conditions (and can disable
  -- triggers): unrestricted owner/administrator access is outside what this
  -- workflow can protect against.
  if current_user <> (select pg_get_userbyid(p.proowner) from pg_proc p
                       where p.oid = 'public.delete_archived_program(uuid, text, text)'::regprocedure)
     or coalesce(current_setting('roicians.program_delete_authorized', true), '') <> old.id::text then
    raise exception using
      errcode = '42501',
      message = 'Programs are permanently deleted only through the controlled Super Admin workflow (delete_archived_program); archive the Program instead';
  end if;
  return old;
end;
$$;

do $$
begin
  if (select prosecdef from pg_proc where oid = 'public.guard_program_delete()'::regprocedure) then
    raise exception 'guard_program_delete must not be SECURITY DEFINER';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.delete_archived_program(uuid, text, text)'::regprocedure) then
    raise exception 'delete_archived_program must be SECURITY DEFINER';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: internal helpers are not executable by any API role

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'website_assert_manager()',
    'website_clean_text(text, text, integer, boolean)',
    'website_is_safe_href(text)',
    'website_is_valid_slug(text)',
    'website_allowed_section_types(text)',
    'website_validate_sections(text, jsonb)',
    'website_audit(text, text, uuid, jsonb, jsonb)',
    'website_insert_revision(website_documents, text, text, text, text, text, text, uuid, uuid, jsonb, uuid)',
    'guard_website_document_change()',
    'guard_website_document_insert()',
    'prevent_website_revision_update()',
    'prevent_website_slug_history_change()',
    'guard_program_delete()',
    'program_deletion_blockers_internal(uuid)',
    'guard_program_created_at()',
    'record_program_history_on_delete()',
    'program_unattributable_history(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end
$$;
