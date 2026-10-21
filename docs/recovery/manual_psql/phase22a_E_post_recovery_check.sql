-- =============================================================================
-- Phase 22A manual recovery handoff — STEP E: post-recovery read-only verification
-- READ-ONLY. Runs in a READ ONLY transaction that is rolled back; it cannot
-- change the database. Target: DEV project nqeaehqzhjhhgsilrgeo only.
-- Fingerprint queries are copied byte-for-byte from
-- docs/recovery/phase22a_dev_recovery.sql (SHA-256 018f460f...a562) at commit
-- 56c73406c1c4bf506d71d677b1f16f8787672c6a.
-- Every row must say PASS; the OVERALL row (999) must say ALL CHECKS PASS.
-- =============================================================================
begin transaction isolation level repeatable read read only;
set local timezone = 'UTC';
set local datestyle = 'ISO, MDY';
set local intervalstyle = 'postgres';
set local extra_float_digits = 0;
set local bytea_output = 'hex';

with c(n, check_name, expected, actual) as (
  select 1, 'identity: cluster system identifier', ('7678069749886157684')::text, ((select system_identifier::text from pg_control_system()))::text
  union all
  select 2, 'identity: database', ('postgres')::text, (current_database())::text
  union all
  select 3, 'identity: PostgreSQL major version', ('17')::text, ((current_setting('server_version_num')::int / 10000))::text
  union all
  select 4, 'identity: current_user', ('postgres')::text, (current_user)::text
  union all
  select 5, 'session: transaction is read-only', ('on')::text, (current_setting('transaction_read_only'))::text
  union all
  select 6, 'history: row count', ('42')::text, ((select count(*) from supabase_migrations.schema_migrations))::text
  union all
  select 7, 'history: fingerprint (migrations 1-42)', ('bf94f88d0d898a25a3910f3d4e287925')::text, ((select md5(string_agg(version || ':' || name, ',' order by version collate "C")) from supabase_migrations.schema_migrations))::text
  union all
  select 8, 'history: versions and names 40-42', ('20260101000040:website_content_foundation,20260101000041:program_deletion_safeguards,20260101000042:phase22a_corrections')::text, ((select string_agg(version || ':' || name, ',' order by version collate "C") from supabase_migrations.schema_migrations where version >= '20260101000040'))::text
  union all
  select 9, 'history: provenance records source SHA-256s', ('3')::text, ((select count(*) from supabase_migrations.schema_migrations where (version = '20260101000040' and statements[1] like '%e7f87f8a78a99e5156e3f45fea14820a12e20e0ed32da8186342e5a12c13b837%') or (version = '20260101000041' and statements[1] like '%8b3bd346844473cefe85bc71228e327088306a10a0397af19363901e38d3ad8e%') or (version = '20260101000042' and statements[1] like '%30274ead82bafbf234fadb9b5cdaf5b908b1bc9d72c8ccd5f8edd6df41acbc30%')))::text
  union all
  select 10, 'final Phase 22A fingerprint (15 lines)', ('bucket=website-media:false
functions.comments=0fecc839e7cffc030308404fe1b93bda
functions.count=37
functions.definitions=ce82b7734ffb685a84bb52ea4d0fb11f
functions.execute=40b2d2ed6d9c8c94e245eebd4b83104f
functions.owner_secdef_config=65d944564bf473a068a6e2e4619d6cbe
policies=6764f4d7809f738b5e2e2bb0c1f8d8e9
tables.columns=1f932f1fcdfbefafc21398f304c1c84b
tables.comments=2977f01dc8991852a609f7908e4b1342
tables.constraints=ca588a5094f322b9d40a72b660f266b0
tables.indexes=baabc1c6ea653fbda3a72f9bba29785d
tables.privileges=a6955f82299d57e3539d7c5c988db211
tables.rls=batch_website_publications=true,website_display_groups=true,website_document_revisions=true,website_documents=true,website_media_assets=true,website_program_slug_history=true,website_revision_media=true
triggers.count=13
triggers=c44fb3144dbf04d621e2a232de38af9d')::text, ((select string_agg(line, E'\n' order by line collate "C") from (
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
  ) q(line)))::text
  union all
  select 11, 'discard function present, SECURITY DEFINER', ('true')::text, ((select prosecdef from pg_proc where oid = to_regprocedure('public.website_discard_unpublished_document(uuid, integer)')))::text
  union all
  select 12, 'discard function EXECUTE anon/authenticated', ('false,true')::text, ((has_function_privilege('anon', to_regprocedure('public.website_discard_unpublished_document(uuid, integer)'), 'execute') || ',' || has_function_privilege('authenticated', to_regprocedure('public.website_discard_unpublished_document(uuid, integer)'), 'execute')))::text
  union all
  select 13, 'corrected guard: checks function owner and marker', ('true')::text, ((pg_get_functiondef(to_regprocedure('public.guard_program_delete()')) like '%pg_get_userbyid(p.proowner)%' and pg_get_functiondef(to_regprocedure('public.guard_program_delete()')) like '%roicians.program_delete_authorized%'))::text
  union all
  select 14, 'corrected guard is NOT security definer', ('false')::text, ((select prosecdef from pg_proc where oid = to_regprocedure('public.guard_program_delete()')))::text
  union all
  select 15, 'delete_archived_program is SECURITY DEFINER, owned by postgres', ('true:postgres')::text, ((select prosecdef || ':' || pg_get_userbyid(proowner) from pg_proc where oid = to_regprocedure('public.delete_archived_program(uuid, text, text)')))::text
  union all
  select 16, 'eligibility includes unattributable_history blocker', ('true')::text, ((pg_get_functiondef(to_regprocedure('public.program_deletion_blockers_internal(uuid)')) like '%unattributable_history%'))::text
  union all
  select 17, 'policy programs_delete_admin absent', ('0')::text, ((select count(*) from pg_policies where tablename = 'programs' and policyname = 'programs_delete_admin'))::text
  union all
  select 18, 'no direct Program DELETE for anon/authenticated', ('false,false')::text, ((has_table_privilege('anon', 'public.programs', 'delete') || ',' || has_table_privilege('authenticated', 'public.programs', 'delete')))::text
  union all
  select 19, '5 guard/evidence triggers present and enabled', ('5')::text, ((select count(*) from pg_trigger where not tgisinternal and tgenabled = 'O' and tgname in ('programs_guard_delete', 'programs_guard_created_at', 'enrollments_record_program_history', 'batches_record_program_history', 'certificates_record_program_history')))::text
  union all
  select 20, '17 internal helpers exist : none executable by anon/authenticated/service_role', ('17:0')::text, (((select count(to_regprocedure('public.' || h.sig)) from unnest(array['website_assert_manager()', 'website_clean_text(text, text, integer, boolean)', 'website_is_safe_href(text)', 'website_is_valid_slug(text)', 'website_allowed_section_types(text)', 'website_validate_sections(text, jsonb)', 'website_audit(text, text, uuid, jsonb, jsonb)', 'website_insert_revision(website_documents, text, text, text, text, text, text, uuid, uuid, jsonb, uuid)', 'guard_website_document_change()', 'guard_website_document_insert()', 'prevent_website_revision_update()', 'prevent_website_slug_history_change()', 'guard_program_delete()', 'program_deletion_blockers_internal(uuid)', 'guard_program_created_at()', 'record_program_history_on_delete()', 'program_unattributable_history(uuid)']) h(sig)) || ':' || (select count(*) from unnest(array['website_assert_manager()', 'website_clean_text(text, text, integer, boolean)', 'website_is_safe_href(text)', 'website_is_valid_slug(text)', 'website_allowed_section_types(text)', 'website_validate_sections(text, jsonb)', 'website_audit(text, text, uuid, jsonb, jsonb)', 'website_insert_revision(website_documents, text, text, text, text, text, text, uuid, uuid, jsonb, uuid)', 'guard_website_document_change()', 'guard_website_document_insert()', 'prevent_website_revision_update()', 'prevent_website_slug_history_change()', 'guard_program_delete()', 'program_deletion_blockers_internal(uuid)', 'guard_program_created_at()', 'record_program_history_on_delete()', 'program_unattributable_history(uuid)']) h(sig) where to_regprocedure('public.' || h.sig) is not null and (has_function_privilege('anon', to_regprocedure('public.' || h.sig), 'execute') or has_function_privilege('authenticated', to_regprocedure('public.' || h.sig), 'execute') or has_function_privilege('service_role', to_regprocedure('public.' || h.sig), 'execute')))))::text
  union all
  select 21, 'page kinds programs_listing and upcoming_batches', ('true')::text, ((pg_get_constraintdef((select oid from pg_constraint where conname = 'website_documents_kind')) ~ 'programs_listing' and pg_get_constraintdef((select oid from pg_constraint where conname = 'website_documents_kind')) ~ 'upcoming_batches'))::text
  union all
  select 22, 'website tables: RLS enabled on all 7', ('7')::text, ((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relrowsecurity and relname in ('website_display_groups', 'website_media_assets', 'website_documents', 'website_document_revisions', 'website_revision_media', 'website_program_slug_history', 'batch_website_publications')))::text
  union all
  select 23, 'website tables empty', ('0')::text, (((select count(*) from public.website_documents) + (select count(*) from public.website_document_revisions) + (select count(*) from public.website_display_groups) + (select count(*) from public.website_media_assets) + (select count(*) from public.website_revision_media) + (select count(*) from public.website_program_slug_history) + (select count(*) from public.batch_website_publications)))::text
  union all
  select 24, 'website-media bucket private and empty', ('false:0')::text, (((select public::text from storage.buckets where id = 'website-media') || ':' || (select count(*) from storage.objects where bucket_id = 'website-media')))::text
  union all
  select 25, 'no Phase 22A audit rows written', ('0')::text, ((select count(*) from public.audit_logs where action like 'website\_%' or action like 'batch\_website\_%' or action = 'program.deleted' or action like '%.row\_deleted'))::text
  union all
  select 26, 'quiet: other active client sessions', ('0')::text, ((select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend' and state <> 'idle'))::text
  union all
  select 27, 'quiet: advisory locks held by other sessions', ('0')::text, ((select count(*) from pg_locks where locktype = 'advisory' and pid <> pg_backend_pid()))::text
  union all
  select 28, 'quiet: locks on migration history by other sessions', ('0')::text, ((select count(*) from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'schema_migrations' and l.pid <> pg_backend_pid()))::text
  union all
  select 29, 'baseline unchanged: programs (rows:hash)', ('2:c1834eb9e7b01e37e4dcab86a62eaa79')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.programs x))::text
  union all
  select 30, 'baseline unchanged: program_modules (rows:hash)', ('0:')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.program_modules x))::text
  union all
  select 31, 'baseline unchanged: batches (rows:hash)', ('3:5e3e0131bd22040a08ec760b7cc5b203')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.batches x))::text
  union all
  select 32, 'baseline unchanged: enrollments (rows:hash)', ('11:460f53861d165cab44cc6c6568575f70')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.enrollments x))::text
  union all
  select 33, 'baseline unchanged: students (rows:hash)', ('11:a464f8b8e25987f635a5efe8f6c4b0d7')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.students x))::text
  union all
  select 34, 'baseline unchanged: payments (rows:hash)', ('0:')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.payments x))::text
  union all
  select 35, 'baseline unchanged: certificates (rows:hash)', ('0:')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.certificates x))::text
  union all
  select 36, 'baseline unchanged: audit_logs (rows:hash)', ('185:89e6249910bcea64ef1c92b236cceebc')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.audit_logs x))::text
),
r as (select n, check_name, expected, actual,
             case when expected is not distinct from actual then 'PASS' else 'FAIL' end as result from c)
select n, check_name,
       case when strpos(expected, E'\n') > 0 then 'md5:' || md5(expected) else expected end as expected,
       case when strpos(actual, E'\n') > 0 then 'md5:' || md5(actual) else actual end as actual,
       result,
       case when result = 'FAIL' and strpos(coalesce(actual, ''), E'\n') > 0 then actual end as fail_detail
from r
union all
select 999, 'OVERALL', null, null,
       case when bool_and(result = 'PASS') then 'ALL CHECKS PASS' else 'AT LEAST ONE CHECK FAILED - STOP' end, null
from r
order by 1;

rollback;
