-- Phase 22A final-state fingerprint (read-only). Describes every object of
-- migrations 40, 41 and 42: function definitions (incl. SECURITY DEFINER and
-- search_path), owners, effective EXECUTE for PUBLIC/anon/authenticated/
-- service_role, website table constraints/indexes/columns/privileges/RLS,
-- policies (website tables, website-media, programs), the named 22A triggers
-- and their enabled state, comments and the website-media bucket.
-- One "key=value" line per aspect; compared verbatim by the recovery script.
with fns as (
  select p.oid, p.proname
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'website\_%'
          or p.proname in ('guard_website_document_change', 'guard_website_document_insert',
                           'prevent_website_revision_update', 'prevent_website_slug_history_change',
                           'guard_program_delete', 'guard_program_created_at', 'program_deletion_blockers',
                           'program_deletion_blockers_internal', 'delete_archived_program',
                           'record_program_history_on_delete', 'program_unattributable_history'))
),
t(n) as (values ('website_display_groups'), ('website_media_assets'), ('website_documents'),
                ('website_document_revisions'), ('website_revision_media'), ('website_program_slug_history'),
                ('batch_website_publications')),
trg(n) as (values ('website_display_groups_set_updated_at'), ('website_media_assets_set_updated_at'),
                  ('website_documents_set_updated_at'), ('website_document_revisions_immutable'),
                  ('website_program_slug_history_append_only'), ('website_documents_guard'),
                  ('website_documents_guard_insert'), ('batch_website_publications_set_updated_at'),
                  ('programs_guard_delete'), ('programs_guard_created_at'), ('enrollments_record_program_history'),
                  ('batches_record_program_history'), ('certificates_record_program_history')),
parts(k, v) as (
  select 'functions.count', count(*)::text from fns
  union all
  select 'functions.definitions', md5(string_agg(pg_get_functiondef(f.oid), '|' order by f.proname collate "C")) from fns f
  union all
  select 'functions.owner_secdef_config',
         md5(string_agg(f.proname || ':' || pg_get_userbyid(p.proowner) || ':' || p.prosecdef || ':'
                        || coalesce(array_to_string(p.proconfig, ';'), ''), '|' order by f.proname collate "C"))
    from fns f join pg_proc p on p.oid = f.oid
  union all
  select 'functions.execute',
         md5(string_agg(f.proname || ':'
                        || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                    where a.grantee = 0 and a.privilege_type = 'EXECUTE') || ','
                        || has_function_privilege('anon', f.oid, 'execute') || ','
                        || has_function_privilege('authenticated', f.oid, 'execute') || ','
                        || has_function_privilege('service_role', f.oid, 'execute'), '|' order by f.proname collate "C"))
    from fns f join pg_proc p on p.oid = f.oid
  union all
  select 'functions.comments', md5(string_agg(f.proname || ':' || coalesce(obj_description(f.oid, 'pg_proc'), ''), '|' order by f.proname collate "C")) from fns f
  union all
  select 'tables.constraints',
         md5(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':' || pg_get_constraintdef(c.oid), '|'
                        order by c.conrelid::regclass::text collate "C", c.conname collate "C"))
    from pg_constraint c join pg_class cl on cl.oid = c.conrelid
   where cl.relnamespace = 'public'::regnamespace and cl.relname in (select n from t)
  union all
  select 'tables.indexes', md5(string_agg(indexdef, '|' order by indexname collate "C"))
    from pg_indexes where schemaname = 'public' and tablename in (select n from t)
  union all
  select 'tables.columns',
         md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':'
                        || coalesce(column_default, ''), '|' order by table_name collate "C", ordinal_position))
    from information_schema.columns where table_schema = 'public' and table_name in (select n from t)
  union all
  select 'tables.comments', md5(string_agg(n || ':' || coalesce(obj_description(('public.' || n)::regclass, 'pg_class'), ''), '|' order by n collate "C")) from t
  union all
  select 'tables.privileges',
         md5(string_agg(x.n || ':' || r.role || ':'
                        || has_table_privilege(r.role, 'public.' || x.n, 'select') || ','
                        || has_table_privilege(r.role, 'public.' || x.n, 'insert') || ','
                        || has_table_privilege(r.role, 'public.' || x.n, 'update') || ','
                        || has_table_privilege(r.role, 'public.' || x.n, 'delete'), '|' order by x.n collate "C", r.role collate "C"))
    from (select n from t union all select 'programs') x(n)
    cross join (values ('anon'), ('authenticated'), ('service_role')) r(role)
  union all
  select 'tables.rls', string_agg(relname || '=' || relrowsecurity, ',' order by relname collate "C")
    from pg_class where relnamespace = 'public'::regnamespace and relname in (select n from t)
  union all
  select 'policies',
         md5(string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || cmd || ':' || roles::text || ':'
                        || coalesce(qual, '') || ':' || coalesce(with_check, ''), '|' order by schemaname collate "C", tablename collate "C", policyname collate "C"))
    from pg_policies
   where (schemaname = 'public' and (tablename in (select n from t) or tablename = 'programs'))
      or policyname = 'website_media_bucket_select_admin'
  union all
  select 'triggers',
         md5(string_agg(tr.tgname || ':' || tr.tgenabled::text || ':' || pg_get_triggerdef(tr.oid), '|' order by tr.tgname collate "C"))
    from pg_trigger tr where not tr.tgisinternal and tr.tgname in (select n from trg)
  union all
  select 'triggers.count', count(*)::text from pg_trigger tr where not tr.tgisinternal and tr.tgname in (select n from trg)
  union all
  select 'bucket', coalesce((select id || ':' || public from storage.buckets where id = 'website-media'), 'missing')
)
select k || '=' || v from parts order by k collate "C"
