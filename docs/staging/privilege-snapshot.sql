-- Expected on staging after migrations 1-42 (same as DEV and CI):
--   grants 549 | authenticated 183 | service_role 226 | digest b62ffbb84312a7d5a5f95480cc13c59d
-- READ-ONLY privilege snapshot for the app roles in schema public.
with roles(r) as (values ('anon'), ('authenticated'), ('service_role')),
lines as (
  select format('%s|%s|%s|%s', c.relkind, c.relname, r, p) as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join roles cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) priv(p)
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
    and has_table_privilege(r, c.oid, p)
  union all
  select format('S|%s|%s|%s', c.relname, r, p)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join roles cross join (values ('USAGE'), ('SELECT')) priv(p)
  where n.nspname = 'public' and c.relkind = 'S' and has_sequence_privilege(r, c.oid, p)
  union all
  select format('f|%s(%s)|%s|EXECUTE', f.proname, pg_get_function_identity_arguments(f.oid), r)
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace cross join roles
  where n.nspname = 'public' and has_function_privilege(r, f.oid, 'EXECUTE')
)
select count(*) as grants,
       count(*) filter (where line like '%|authenticated|%') as authenticated_grants,
       count(*) filter (where line like '%|service_role|%') as service_role_grants,
       md5(string_agg(line, E'\n' order by line)) as digest
from lines;
