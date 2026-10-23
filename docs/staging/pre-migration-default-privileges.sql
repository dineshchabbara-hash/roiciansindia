-- Restores Supabase's pre-30-May-2026 default privileges for objects that
-- the role postgres creates in schema public, so migrations 1-42 produce the
-- same grants as on DEV and in CI. Later migrations' REVOKEs still apply.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;
