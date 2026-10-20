-- Phase 22A — Program deletion safeguards (database enforcement)
-- (docs/requirements/PHASE_22_APPROVED_DESIGN.md §7, P22-08 revised; TI-1, TI-7).
--
-- Replaces the broad Program DELETE of migration 14 (programs_delete_admin:
-- any Admin or Super Admin could delete any Program, cascading into modules,
-- program-level materials and assignments and detaching leads) with ONE
-- controlled path:
--
--   * programs_delete_admin is dropped and DELETE on programs is revoked from
--     anon/authenticated: no role can delete a Program row directly.
--   * A BEFORE DELETE trigger refuses every Program delete — including from
--     the service role or direct SQL — unless it is issued by
--     delete_archived_program() for that exact Program in that transaction.
--   * delete_archived_program(program, confirmation code, reason): the
--     caller's OWN session must be an active Super Admin (is_super_admin();
--     never a caller-supplied actor), the Program must be archived, the typed
--     confirmation must equal its program_code, and program_deletion_blockers()
--     must return nothing. The Program row is locked FOR UPDATE before the
--     final check, so a concurrent insert of any FK-dependent row (which needs
--     a KEY SHARE lock on the Program) or a concurrent status change waits and
--     is then either seen by the check or rejected by the FK — never slipped
--     in between the check and the delete. A durable audit_logs row is written
--     in the same transaction. Nothing is cascaded, detached or rewritten: a
--     Program with any dependent row is refused.
--   * program_deletion_blockers(program): Super Admin only, read-only; the
--     same checks, for the Phase 22B eligibility review screen.
--
-- Blockers (any one blocks; there is no override):
--   not_found, not_archived;
--   dependency:<table> — ANY row in ANY table holding a foreign key to
--     programs (discovered from the catalog at call time, so batches,
--     enrollments, certificates, program_modules, materials, assignments,
--     leads and the Phase 22A website_documents are all covered, as is any
--     future table); a multi-column FK is reported as uncertain_dependency;
--   stored_file_reference — programs.thumbnail_path is set (file cleanup is
--     not designed; fail-closed);
--   stored_files — a Storage object path contains the Program id (e.g. a
--     program-level material file left behind);
--   website_published_history — the Program's website content was ever
--     published, per its website document or audit evidence (TI-7: the old
--     slug, redirects and references have no designed handling yet);
--   website_link_reference — any website revision links to /programs/<slug>
--     for a slug this Program ever had;
--   audit_history — audit evidence of anything other than routine
--     create/update/status-change of the Program itself (or routine
--     never-published website drafting) referencing the Program by id or code,
--     e.g. an enrollment.create naming it.
-- Routine program.create / program.update / program.status_change audit rows
-- are retained and do NOT block on their own (§7.2 "Audit records").
--
-- Existing operational data is not modified by this migration.

-- ---------------------------------------------------------------------------
-- 1. Remove the broad delete permission (TI-1)

drop policy if exists programs_delete_admin on programs;
revoke delete on programs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guard trigger: only the controlled workflow can delete a Program row

create or replace function guard_program_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('roicians.program_delete_authorized', true), '') <> old.id::text then
    raise exception using
      errcode = '42501',
      message = 'Programs are permanently deleted only through the controlled Super Admin workflow (delete_archived_program); archive the Program instead';
  end if;
  return old;
end;
$$;

comment on function guard_program_delete() is
  'Phase 22A (TI-1): refuses every DELETE on programs unless delete_archived_program() authorized that exact Program id for the current transaction.';

create trigger programs_guard_delete
  before delete on programs
  for each row execute function guard_program_delete();

-- ---------------------------------------------------------------------------
-- 3. Eligibility (no authorization check; internal)

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

  -- Slugs this Program ever had (current document + website audit payloads),
  -- then any website revision linking to /programs/<slug>.
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

  -- Audit evidence beyond routine Program maintenance / never-published drafting.
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
end;
$$;

comment on function program_deletion_blockers_internal(uuid) is
  'Phase 22A: every reason a Program cannot be permanently deleted (empty = eligible). Internal; no API role may call it.';

revoke execute on function program_deletion_blockers_internal(uuid) from public, anon, authenticated;
revoke execute on function guard_program_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Super Admin API

create or replace function program_deletion_blockers(p_program_id uuid)
returns table (code text, detail text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not is_super_admin() then
    raise exception using errcode = '42501', message = 'Only an active Super Admin may review Program deletion';
  end if;
  return query select b.code, b.detail from program_deletion_blockers_internal(p_program_id) b;
end;
$$;

comment on function program_deletion_blockers(uuid) is
  'Phase 22A: read-only deletion eligibility review for an active Super Admin (Phase 22B screen). Empty result = eligible at this moment; delete_archived_program() rechecks under lock.';

revoke execute on function program_deletion_blockers(uuid) from public, anon, authenticated;
grant execute on function program_deletion_blockers(uuid) to authenticated;

create or replace function delete_archived_program(
  p_program_id uuid,
  p_confirmation_code text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prog record;
  v_reason text;
  blockers text;
  routine_count bigint;
  audit_id uuid;
  deleted integer;
begin
  if auth.uid() is null or not is_super_admin() then
    raise exception using errcode = '42501', message = 'Only an active Super Admin may permanently delete a Program';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'A deletion reason of at most 500 characters is required';
  end if;

  -- Lock first: concurrent dependent inserts (FK KEY SHARE) and status
  -- changes wait for this transaction; the check below sees committed state.
  select p.id, p.program_code, p.name, p.status, p.created_at into prog
    from programs p where p.id = p_program_id for update;
  if prog.id is null then
    raise exception using errcode = 'P2204', message = 'Program not found';
  end if;
  if p_confirmation_code is null or p_confirmation_code <> prog.program_code then
    raise exception using errcode = '22023', message = 'The confirmation does not match the Program code';
  end if;

  select string_agg(b.code, ', ' order by b.code) into blockers from program_deletion_blockers_internal(p_program_id) b;
  if blockers is not null then
    raise exception using
      errcode = 'P2201',
      message = 'This Program cannot be permanently deleted. It can remain archived, and its historical records will be preserved.',
      detail = blockers;
  end if;

  select count(*) into routine_count from audit_logs a
   where a.entity_type = 'program' and a.entity_id = p_program_id;

  insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, before_data, after_data)
  values (
    auth.uid(), 'super_admin', 'program.deleted', 'program', p_program_id,
    jsonb_build_object('programCode', prog.program_code, 'name', prog.name, 'status', prog.status,
                       'createdAt', prog.created_at),
    jsonb_build_object('reason', v_reason, 'confirmedByCode', true,
                       'retainedAuditRecords', routine_count)
  )
  returning id into audit_id;

  perform set_config('roicians.program_delete_authorized', p_program_id::text, true);
  delete from programs where id = p_program_id;
  get diagnostics deleted = row_count;
  perform set_config('roicians.program_delete_authorized', '', true);
  if deleted <> 1 then
    raise exception using errcode = 'P2201', message = 'The Program could not be deleted';
  end if;

  return audit_id;
end;
$$;

comment on function delete_archived_program(uuid, text, text) is
  'Phase 22A: the only Program deletion path. Active Super Admin session only; archived Program; confirmation must equal program_code; reason required; locks the Program and rechecks program_deletion_blockers_internal() before deleting; writes a durable program.deleted audit row. Raises P2201 (detail = blocker codes) when ineligible. No cascade, detach or override.';

revoke execute on function delete_archived_program(uuid, text, text) from public, anon, authenticated;
grant execute on function delete_archived_program(uuid, text, text) to authenticated;
