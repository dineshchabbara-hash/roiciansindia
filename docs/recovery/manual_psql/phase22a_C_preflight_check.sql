-- =============================================================================
-- Phase 22A manual recovery handoff — STEP C: fresh preflight and existing-data baseline
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
  select 6, 'history: row count', ('39')::text, ((select count(*) from supabase_migrations.schema_migrations))::text
  union all
  select 7, 'history: fingerprint', ('7ee3ee94d20444544a690045aebf7833')::text, ((select md5(string_agg(version || ':' || name, ',' order by version collate "C")) from supabase_migrations.schema_migrations))::text
  union all
  select 8, 'history: no rows for 40-42', ('0')::text, ((select count(*) from supabase_migrations.schema_migrations where version >= '20260101000040'))::text
  union all
  select 9, 'partial migration-40 fingerprint (10 lines)', ('B=website-media:false
C=417572c22e822961772230e4a866931a
COL=1f932f1fcdfbefafc21398f304c1c84b
F=1e0f74199add9a55b5f421c66b7b6dd5
FG=a33ff937b2981e3b7ecddcbe988883c6
G=d99031c5b6e7a1a09fb0457f2796bb1d
I=f8580b9b321f11c256c6f2893acbc445
P=3336252ad938782e346204a4d1e97bf4
RLS=batch_website_publications=true,website_display_groups=true,website_document_revisions=true,website_documents=true,website_media_assets=true,website_program_slug_history=true,website_revision_media=true
T=4dbc96fb1a9ca6c05c1af2fa8fc74049')::text, ((select string_agg(line, E'\n' order by line collate "C") from (
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
select k||'='||h from parts order by k
  ) q(line)))::text
  union all
  select 10, 'exactly 25 website_* functions', ('25')::text, ((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'website\_%'))::text
  union all
  select 11, 'none of the 8 new functions exist', ('0')::text, ((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('website_discard_unpublished_document', 'guard_program_delete', 'program_deletion_blockers', 'program_deletion_blockers_internal', 'delete_archived_program', 'guard_program_created_at', 'record_program_history_on_delete', 'program_unattributable_history')))::text
  union all
  select 12, 'none of the 5 new triggers exist', ('0')::text, ((select count(*) from pg_trigger where not tgisinternal and tgname in ('programs_guard_delete', 'programs_guard_created_at', 'enrollments_record_program_history', 'batches_record_program_history', 'certificates_record_program_history')))::text
  union all
  select 13, 'website function owners and service_role grants', ('true')::text, (((select string_agg(pg_get_userbyid(proowner) || ':' || has_function_privilege('service_role', oid, 'execute'), ',') from (select distinct proowner, oid from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'website\_%' or proname in ('guard_website_document_change', 'guard_website_document_insert', 'prevent_website_revision_update', 'prevent_website_slug_history_change'))) f) = repeat('postgres:true,', 28) || 'postgres:true'))::text
  union all
  select 14, 'pre-41 policy programs_delete_admin present', ('1')::text, ((select count(*) from pg_policies where schemaname = 'public' and tablename = 'programs' and policyname = 'programs_delete_admin' and cmd = 'DELETE' and qual = 'is_admin_or_super()'))::text
  union all
  select 15, 'pre-41 authenticated DELETE on programs', ('true')::text, (has_table_privilege('authenticated', 'public.programs', 'delete'))::text
  union all
  select 16, 'page kinds from migration 42 absent', ('false')::text, ((pg_get_constraintdef((select oid from pg_constraint where conname = 'website_documents_kind')) ~ 'programs_listing'))::text
  union all
  select 17, 'website tables empty', ('0')::text, (((select count(*) from public.website_documents) + (select count(*) from public.website_document_revisions) + (select count(*) from public.website_display_groups) + (select count(*) from public.website_media_assets) + (select count(*) from public.website_revision_media) + (select count(*) from public.website_program_slug_history) + (select count(*) from public.batch_website_publications)))::text
  union all
  select 18, 'website-media bucket empty', ('0')::text, ((select count(*) from storage.objects where bucket_id = 'website-media'))::text
  union all
  select 19, 'no Phase 22A audit rows', ('0')::text, ((select count(*) from public.audit_logs where action like 'website\_%' or action like 'batch\_website\_%' or action = 'program.deleted' or action like '%.row\_deleted'))::text
  union all
  select 20, 'quiet: other active client sessions', ('0')::text, ((select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend' and state <> 'idle'))::text
  union all
  select 21, 'quiet: advisory locks held by other sessions', ('0')::text, ((select count(*) from pg_locks where locktype = 'advisory' and pid <> pg_backend_pid()))::text
  union all
  select 22, 'quiet: locks on migration history by other sessions', ('0')::text, ((select count(*) from pg_locks l join pg_class c on c.oid = l.relation where c.relname = 'schema_migrations' and l.pid <> pg_backend_pid()))::text
  union all
  select 23, 'baseline unchanged: programs (rows:hash)', ('2:c1834eb9e7b01e37e4dcab86a62eaa79')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.programs x))::text
  union all
  select 24, 'baseline unchanged: program_modules (rows:hash)', ('0:')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.program_modules x))::text
  union all
  select 25, 'baseline unchanged: batches (rows:hash)', ('3:5e3e0131bd22040a08ec760b7cc5b203')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.batches x))::text
  union all
  select 26, 'baseline unchanged: enrollments (rows:hash)', ('11:460f53861d165cab44cc6c6568575f70')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.enrollments x))::text
  union all
  select 27, 'baseline unchanged: students (rows:hash)', ('11:a464f8b8e25987f635a5efe8f6c4b0d7')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.students x))::text
  union all
  select 28, 'baseline unchanged: payments (rows:hash)', ('0:')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.payments x))::text
  union all
  select 29, 'baseline unchanged: certificates (rows:hash)', ('0:')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.certificates x))::text
  union all
  select 30, 'baseline unchanged: audit_logs (rows:hash)', ('185:89e6249910bcea64ef1c92b236cceebc')::text, ((select count(*)::text || ':' || coalesce(md5(string_agg(md5(x::text), '' order by x.id)), '') from public.audit_logs x))::text
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
