-- Local development seed data ONLY. Never run against production.
-- `supabase db reset` (or `supabase db push` + this file) applies this after
-- migrations. Contains no secrets — demo login accounts are created
-- separately by `scripts/seed-demo-users.mjs` (see README.md "Seed
-- instructions"), since creating real Supabase Auth users requires the
-- Admin API, not raw SQL.

insert into programs
  (program_code, name, description, category, duration_value, duration_unit,
   delivery_mode, regular_fee, registration_fee, status, certificate_eligible,
   installments_allowed)
values
  ('AIQAIN11', 'AI Powered QA / Software Testing',
   'Hands-on software testing and QA automation, augmented with AI-assisted tooling.',
   'Quality Engineering', 12, 'weeks', 'hybrid', 50000, 10000, 'active', true, true),
  ('DAAIN11', 'Data Analytics with AI',
   'Practical data analytics, from SQL and spreadsheets to AI-assisted analysis and dashboards.',
   'Data', 12, 'weeks', 'online', 45000, 10000, 'active', true, true),
  ('BAAIN11', 'Business Analyst with AI',
   'Requirements, process modeling, and stakeholder communication, with AI-assisted analysis techniques.',
   'Business', 10, 'weeks', 'online', 40000, 8000, 'active', true, true),
  ('PLAYIN11', 'Playwright Automation with AI',
   'End-to-end test automation with Playwright, including AI-assisted test authoring.',
   'Quality Engineering', 8, 'weeks', 'online', 35000, 7000, 'active', true, true),
  ('SQLAIN11', 'SQL with AI',
   'Practical SQL for analytics and engineering roles, with AI-assisted query authoring.',
   'Data', 6, 'weeks', 'online', 20000, 5000, 'active', true, false)
on conflict (program_code) do nothing;

-- batches has no unique constraint (multiple batches can share a name across
-- programs/terms), so these inserts are not idempotent — harmless for local
-- dev, since `supabase db reset` recreates the database before reseeding.

insert into batches
  (program_id, name, start_date, expected_end_date, days_of_week, start_time,
   end_time, timezone, delivery_mode, capacity, status)
select
  p.id,
  'September 2026 Weekend Batch',
  date '2026-09-06',
  date '2026-11-29',
  array['sat', 'sun'],
  time '10:00',
  time '13:00',
  'Asia/Kolkata',
  'hybrid',
  30,
  'upcoming'
from programs p
where p.program_code = 'AIQAIN11';

insert into batches
  (program_id, name, start_date, expected_end_date, days_of_week, start_time,
   end_time, timezone, delivery_mode, capacity, status)
select
  p.id,
  'October 2026 Evening Batch',
  date '2026-10-05',
  date '2026-12-28',
  array['mon', 'wed', 'fri'],
  time '19:00',
  time '21:00',
  'Asia/Kolkata',
  'online',
  25,
  'upcoming'
from programs p
where p.program_code = 'AIQAIN11';

insert into batches
  (program_id, name, start_date, expected_end_date, days_of_week, start_time,
   end_time, timezone, delivery_mode, capacity, status)
select
  p.id,
  'September 2026 Weekend Batch',
  date '2026-09-13',
  date '2026-12-06',
  array['sat', 'sun'],
  time '15:00',
  time '18:00',
  'Asia/Kolkata',
  'online',
  30,
  'upcoming'
from programs p
where p.program_code = 'DAAIN11';
