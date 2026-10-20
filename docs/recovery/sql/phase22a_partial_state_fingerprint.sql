-- Phase 22A partial-state fingerprint (read-only). This is the exact query run
-- against DEV on 2026-10-20; its output there is pinned as a recovery
-- precondition. It describes migration 40 WITHOUT website_discard_unpublished_document.
with t(n) as (values ('website_display_groups'),('website_media_assets'),('website_documents'),('website_document_revisions'),('website_revision_media'),('website_program_slug_history'),('batch_website_publications')),
parts as (
 select 'F' k, md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)) h from pg_proc p
  where p.pronamespace='public'::regnamespace and (p.proname like 'website\_%' or p.proname in ('guard_website_document_change','guard_website_document_insert','prevent_website_revision_update','prevent_website_slug_history_change')) and p.proname <> 'website_discard_unpublished_document'
 union all select 'C', md5(string_agg(c.conrelid::regclass||':'||c.conname||':'||pg_get_constraintdef(c.oid), '|' order by c.conrelid::regclass::text, c.conname)) from pg_constraint c join pg_class cl on cl.oid=c.conrelid where cl.relnamespace='public'::regnamespace and cl.relname in (select n from t)
 union all select 'I', md5(string_agg(indexdef, '|' order by indexname)) from pg_indexes where schemaname='public' and tablename in (select n from t)
 union all select 'P', md5(string_agg(tablename||':'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'')||':'||roles::text, '|' order by policyname)) from pg_policies where tablename in (select n from t) or policyname='website_media_bucket_select_admin'
 union all select 'T', md5(string_agg(pg_get_triggerdef(tr.oid), '|' order by tr.tgname)) from pg_trigger tr join pg_class cl on cl.oid=tr.tgrelid where not tr.tgisinternal and cl.relnamespace='public'::regnamespace and cl.relname in (select n from t)
 union all select 'COL', md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), '|' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public' and table_name in (select n from t)
 union all select 'G', md5(string_agg(n||':'||has_table_privilege('anon','public.'||n,'select')||has_table_privilege('authenticated','public.'||n,'select')||has_table_privilege('authenticated','public.'||n,'insert')||has_table_privilege('authenticated','public.'||n,'update')||has_table_privilege('authenticated','public.'||n,'delete'), '|' order by n)) from t
 union all select 'FG', md5(string_agg(p.proname||':'||has_function_privilege('anon',p.oid,'execute')||has_function_privilege('authenticated',p.oid,'execute'), '|' order by p.proname)) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'website\_%' and p.proname <> 'website_discard_unpublished_document'
 union all select 'RLS', string_agg(relname||'='||relrowsecurity, ',' order by relname) from pg_class where relnamespace='public'::regnamespace and relname in (select n from t)
 union all select 'B', (select id||':'||public from storage.buckets where id='website-media')
)
select k||'='||h from parts order by k;
