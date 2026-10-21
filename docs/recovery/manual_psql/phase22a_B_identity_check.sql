-- =============================================================================
-- Phase 22A manual recovery handoff — STEP B: connection and DEV identity check
-- READ-ONLY. Runs in a READ ONLY transaction that is rolled back; it cannot
-- change the database. Target: DEV project nqeaehqzhjhhgsilrgeo only.
-- Fingerprint queries are copied byte-for-byte from
-- docs/recovery/phase22a_dev_recovery.sql (SHA-256 018f460f...a562) at commit
-- 56c73406c1c4bf506d71d677b1f16f8787672c6a.
-- Every row must say PASS; the OVERALL row (999) must say ALL CHECKS PASS.
-- =============================================================================
\conninfo
begin transaction isolation level repeatable read read only;
set local timezone = 'UTC';
set local datestyle = 'ISO, MDY';
set local intervalstyle = 'postgres';
set local extra_float_digits = 0;
set local bytea_output = 'hex';

-- Information only (not a pass/fail check). On a Session pooler connection
-- this row describes the pooler-to-database link; your own link's TLS is
-- shown by \conninfo above and enforced by sslmode=verify-full.
select ssl, version as tls_version from pg_stat_ssl where pid = pg_backend_pid();

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
  select 6, 'session: server encoding', ('UTF8')::text, (current_setting('server_encoding'))::text
  union all
  select 7, 'session: client encoding', ('UTF8')::text, (current_setting('client_encoding'))::text
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
