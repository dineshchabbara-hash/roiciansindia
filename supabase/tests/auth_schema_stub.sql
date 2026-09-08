-- Minimal local stand-in for Supabase's built-in `auth` schema, so the real
-- migrations (which reference `auth.users`, `auth.uid()`, `auth.role()`) can
-- be applied to a plain local Postgres instance for RLS regression testing
-- without a live Supabase project. Mirrors Supabase's actual, documented
-- implementation: auth.uid()/auth.role() read the `request.jwt.claims` GUC
-- that PostgREST sets per-request from the caller's JWT — the exact
-- mechanism exercised live against the real project during the Real
-- Supabase Development Validation Gate. NOT used by the application itself;
-- test-only.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- Matches Supabase's real project bootstrap: every subsequently-created
-- table/function in `public` is auto-granted to these three roles, with RLS
-- (once enabled) then doing the actual access control.
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
