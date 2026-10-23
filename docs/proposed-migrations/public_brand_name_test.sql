-- PREPARED FOR REVIEW ONLY. NOT RUN. Not wired into scripts/test-rls.sh.
-- Regression suite for docs/proposed-migrations/public_brand_name.sql, to be
-- run in an isolated local database after the migration, once approved. It
-- follows the conventions of supabase/tests/phase21c_admin_identity_test.sql.
--
--   - The field exists, is required and has no lasting default. The existing
--     row holds 'ROICIANS'.
--   - The database rejects blank, padded, too-long, markup and control-character
--     values, and accepts ordinary names.
--   - Permissions are unchanged: Super Admin updates; Admin reads but cannot
--     update; Trainer, Student and anon read nothing. There is still no
--     INSERT/DELETE policy and no anon policy on company_settings.
--   - website_public_brand() returns exactly two columns (the public brand
--     name and the legal name). Only service_role can execute it; anon and
--     authenticated cannot.
--
-- Ends with ROLLBACK.

begin;

insert into auth.users (id, email, encrypted_password) values
  ('b7a00000-0000-0000-0000-000000000001', 'brand-super@validation.local', 'x'),
  ('b7a00000-0000-0000-0000-000000000002', 'brand-admin@validation.local', 'x'),
  ('b7a00000-0000-0000-0000-000000000003', 'brand-trainer@validation.local', 'x'),
  ('b7a00000-0000-0000-0000-000000000004', 'brand-student@validation.local', 'x');

insert into user_roles (auth_user_id, role) values
  ('b7a00000-0000-0000-0000-000000000001', 'super_admin'),
  ('b7a00000-0000-0000-0000-000000000002', 'admin'),
  ('b7a00000-0000-0000-0000-000000000003', 'trainer'),
  ('b7a00000-0000-0000-0000-000000000004', 'student');

-- ---------------------------------------------------------------------------
-- Structure (as the database owner).

do $$
declare
  col record;
begin
  select is_nullable, column_default into col
    from information_schema.columns
   where table_name = 'company_settings' and column_name = 'public_brand_name';
  if col is null then raise exception 'FAIL: public_brand_name is missing'; end if;
  if col.is_nullable <> 'NO' then raise exception 'FAIL: public_brand_name must be required'; end if;
  if col.column_default is not null then raise exception 'FAIL: public_brand_name must have no lasting default'; end if;
  if (select public_brand_name from company_settings where singleton) <> 'ROICIANS' then
    raise exception 'FAIL: the existing settings row must hold ROICIANS';
  end if;
  if exists (select 1 from pg_policies where tablename = 'company_settings' and cmd in ('INSERT', 'DELETE')) then
    raise exception 'FAIL: company_settings must have no insert/delete policy';
  end if;
  if exists (select 1 from pg_policies where tablename = 'company_settings' and 'anon' = any (roles)) then
    raise exception 'FAIL: company_settings must have no anon policy';
  end if;
  raise notice 'PASS: public_brand_name is required, has no lasting default, holds ROICIANS; policies unchanged';
end
$$;

do $$
begin
  if has_function_privilege('anon', 'website_public_brand()', 'execute') then
    raise exception 'FAIL: anon can execute website_public_brand()';
  end if;
  if has_function_privilege('authenticated', 'website_public_brand()', 'execute') then
    raise exception 'FAIL: authenticated can execute website_public_brand()';
  end if;
  if not has_function_privilege('service_role', 'website_public_brand()', 'execute') then
    raise exception 'FAIL: service_role cannot execute website_public_brand()';
  end if;
  raise notice 'PASS: website_public_brand() is executable by service_role only';
end
$$;

-- The accessor returns exactly the two public facts, matching the row.
do $$
declare
  r record;
  cols text[];
begin
  select array_agg(a order by n) into cols
    from unnest((select proargnames from pg_proc where proname = 'website_public_brand'))
         with ordinality as t(a, n);
  if cols is distinct from array['public_brand_name', 'legal_name'] then
    raise exception 'FAIL: website_public_brand() must return exactly public_brand_name and legal_name, got %', cols;
  end if;
  select * into r from website_public_brand();
  if r.public_brand_name <> (select public_brand_name from company_settings where singleton)
     or r.legal_name <> (select legal_name from company_settings where singleton) then
    raise exception 'FAIL: website_public_brand() does not match the settings row';
  end if;
  raise notice 'PASS: website_public_brand() returns only the public brand name and legal name';
end
$$;

-- ---------------------------------------------------------------------------
-- Super Admin: edits the field; the database validates it.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b7a00000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  n int;
  bad text;
begin
  update company_settings set public_brand_name = 'Roicians Academy' where singleton;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: Super Admin could not update public_brand_name'; end if;

  foreach bad in array array['', '   ', ' ROICIANS', 'ROICIANS ', repeat('R', 61), '<b>ROICIANS</b>', e'ROI\nCIANS'] loop
    begin
      update company_settings set public_brand_name = bad where singleton;
      raise exception 'FAIL: an invalid public brand name was accepted: %', quote_literal(bad);
    exception when check_violation then null;
    end;
  end loop;

  update company_settings set public_brand_name = 'ROICIANS' where singleton;
  raise notice 'PASS: Super Admin edits public_brand_name; blank, padded, long, markup and control values are rejected';
end
$$;

-- Admin: reads the field, cannot change it.
set local "request.jwt.claims" to '{"sub":"b7a00000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  n int;
begin
  if (select public_brand_name from company_settings where singleton) is null then
    raise exception 'FAIL: Admin cannot read public_brand_name';
  end if;
  update company_settings set public_brand_name = 'Changed by Admin' where singleton;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Admin changed public_brand_name'; end if;
  raise notice 'PASS: Admin reads public_brand_name but cannot change it';
end
$$;

-- Trainer and Student: see no settings row.
set local "request.jwt.claims" to '{"sub":"b7a00000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  if exists (select 1 from company_settings) then raise exception 'FAIL: Trainer can read company_settings'; end if;
  raise notice 'PASS: Trainer sees no company settings';
end $$;

set local "request.jwt.claims" to '{"sub":"b7a00000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  if exists (select 1 from company_settings) then raise exception 'FAIL: Student can read company_settings'; end if;
  raise notice 'PASS: Student sees no company settings';
end $$;

-- Anonymous: no settings row and no accessor.
reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $$ begin
  -- anon cannot even evaluate the role helpers (no EXECUTE): a denial either way.
  begin
    if exists (select 1 from company_settings) then raise exception 'FAIL: anon can read company_settings'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    perform website_public_brand();
    raise exception 'FAIL: anon executed website_public_brand()';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon sees no company settings and cannot call the accessor';
end $$;

reset role;

rollback;
