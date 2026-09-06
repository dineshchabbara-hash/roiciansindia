-- Centralized, single-row company/branding/tax/numbering configuration.
-- See DATABASE_SCHEMA.md §4 `company_settings` and DECISIONS_NEEDED.md D1/D2.

create table if not exists company_settings (
  id uuid primary key default gen_random_uuid(),

  -- Singleton enforcement: exactly one settings row ever exists.
  singleton boolean not null default true,

  -- Brand/display name shown throughout the UI (nav, dashboards, marketing,
  -- emails). Distinct from legal_name by design — see REQUIREMENTS.md FR-140.
  company_name text not null default 'Roicians Tech',
  -- Full registered legal entity name, used on legal/financial documents
  -- (receipts, invoices, certificates, payment records, legal disclosures).
  legal_name text not null default 'Roicians Tech Pvt. Ltd.',
  logo_path text,

  address text,
  phone text,
  email text,
  website text,
  country text not null default 'India',

  gstin text,
  tax_enabled boolean not null default false,
  default_tax_rate_percent numeric(5, 2) not null default 0,
  tax_label text not null default 'GST',

  student_id_prefix text not null default '',
  receipt_number_format text not null default 'REC-{year}-{seq:6}',
  certificate_number_format text not null default 'CERT-{year}-{seq:6}',
  program_code_pattern text,

  certificate_signatory_name text,
  certificate_signatory_title text,
  social_links jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint company_settings_singleton unique (singleton),
  constraint company_settings_singleton_true check (singleton)
);

comment on table company_settings is
  'Single-row centralized configuration. No company/brand/tax detail should ever be hard-coded in application code — see REQUIREMENTS.md FR-140.';
comment on column company_settings.company_name is
  'Display/brand name used in UI, portals, and marketing (e.g. "Roicians Tech").';
comment on column company_settings.legal_name is
  'Full legal entity name used on receipts, invoices, certificates, and other legal/financial documents (e.g. "Roicians Tech Pvt. Ltd.").';

create trigger company_settings_set_updated_at
  before update on company_settings
  for each row execute function set_updated_at();

-- Seed the single settings row with the confirmed company identity
-- (DECISIONS_NEEDED.md D1 — resolved) plus safe defaults for everything
-- still outstanding (logo, address, GSTIN, tax, brand colors, etc.).
insert into company_settings (company_name, legal_name, country)
values ('Roicians Tech', 'Roicians Tech Pvt. Ltd.', 'India')
on conflict (singleton) do nothing;
