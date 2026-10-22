-- =============================================================================
-- PREPARED FOR REVIEW ONLY. NOT APPLIED. NOT IN supabase/migrations/.
--
-- The owner approved the DESIGN of this additive field (2026-10-22), not its
-- execution. Before it is used:
--   1. The owner approves this migration.
--   2. The next free migration number is verified at that time (expected
--      20260101000043, if nothing else lands first). The file is then copied
--      into supabase/migrations/.
--   3. It is tested in an isolated local database (with
--      public_brand_name_test.sql), never first on DEV.
--   4. It is applied to DEV only with separate authorization, and to
--      production only with separate authorization.
-- It is needed before Phase 22C/22D. Phase 22B-1 does not depend on it.
-- =============================================================================
--
-- Phase 22: the public website brand name in Company Settings (design doc
-- PHASE_22_APPROVED_DESIGN.md, section 4.1).
--
-- What it does:
--   1. Adds company_settings.public_brand_name (required). The existing single
--      row receives 'ROICIANS'. No other column or row changes: company_name
--      (the LMS display name, also the payment-checkout merchant name),
--      legal_name, updated_at and every historical record are untouched.
--   2. Validates the value in the database, mirroring the planned
--      application validation.
--   3. Adds website_public_brand(), a narrow read of the two public identity
--      facts (public brand name, legal name) for the server-side brand
--      accessor. Public pages never read company_settings itself.
--
-- What it does not do:
--   - No new table. No new or changed policy on company_settings. The
--     existing RLS stays: Admin and Super Admin SELECT, Super Admin UPDATE,
--     no INSERT or DELETE for anyone, nothing for anon.
--   - No grant to anon or authenticated. EXECUTE on website_public_brand()
--     goes to service_role only, for trusted server code. Phase 22C decides
--     the final public read path; because the function returns only facts
--     shown on every public page, widening it later exposes nothing private.
--   - No audit trigger. As with company_name today, a change is audited by
--     the existing Company Settings save action: a "company_settings.updated"
--     entry listing the changed fields with their before and after values.
--     That action, its Super Admin check and its form gain the new field in
--     the application change that accompanies this migration (see README).

-- 1. The field ----------------------------------------------------------------
-- ADD COLUMN ... DEFAULT fills the existing row without firing the
-- updated_at trigger. The default is then dropped, so the brand name is never
-- baked into the schema: it lives only in the settings row.

alter table company_settings
  add column public_brand_name text not null default 'ROICIANS';

alter table company_settings
  alter column public_brand_name drop default;

comment on column company_settings.public_brand_name is
  'Phase 22 (design section 4.1): the public website brand name for the India website, e.g. "ROICIANS". Separate from company_name (LMS display name and payment checkout) and from legal_name (legal and financial documents); never derived from either. Super Admin edits it in Company Settings; public pages read it only through website_public_brand() on the server.';

-- 2. Validation ------------------------------------------------------------------
-- Trimmed, 1-60 characters, no control characters and no markup characters.

alter table company_settings
  add constraint company_settings_public_brand_name_valid
  check (public_brand_name = btrim(public_brand_name)
         and char_length(public_brand_name) between 1 and 60
         and public_brand_name !~ '[[:cntrl:]<>]');

-- 3. Narrow server-side read -------------------------------------------------------
-- Returns only the public brand name and the legal name (both shown on every
-- public page). Nothing else from company_settings: no address, phone, GSTIN,
-- numbering formats, signatory or LMS display name.

create or replace function website_public_brand()
returns table (public_brand_name text, legal_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cs.public_brand_name, cs.legal_name
    from company_settings cs
   where cs.singleton
   limit 1;
$$;

comment on function website_public_brand() is
  'Phase 22 (design section 4.1): the public brand name and legal name only, for the server-side public brand accessor. service_role only; never exposes other Company Settings fields.';

revoke execute on function website_public_brand() from public, anon, authenticated;
grant execute on function website_public_brand() to service_role;
