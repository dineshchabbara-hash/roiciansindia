-- Security fix (Phase 2 verification finding): every table in this schema
-- currently has Row Level Security DISABLED. Supabase's default project
-- setting (`auto_expose_new_tables`, see supabase/config.toml) exposes every
-- table in the `public` schema to the PostgREST Data API for the `anon` and
-- `authenticated` roles unless RLS says otherwise. Concretely, today, if this
-- schema were pushed to a live Supabase project, anyone holding the public
-- anon key (which ships in the browser bundle by design) could read or write
-- `students`, `payments`, `audit_logs`, etc. directly over the REST API,
-- bypassing the Next.js application entirely.
--
-- This migration enables RLS on every table with NO policies defined yet.
-- With RLS on and zero policies, Postgres denies ALL access to `anon` and
-- `authenticated` by default — the safe default-deny posture — while the
-- `service_role` key (BYPASSRLS in Supabase) continues to work unaffected,
-- so nothing built so far (seed script, future server-side domain code) is
-- broken by this change.
--
-- Real per-role policies (Super Admin/Admin/Trainer/Student access rules)
-- are Phase 3 work — they need `auth.uid()`/`user_roles` wired up to write
-- and test meaningfully. Do NOT treat "RLS enabled, no policies" as done:
-- it only prevents accidental public exposure; it does not yet implement
-- the access model in USER_ROLES_AND_PERMISSIONS.md.

alter table user_roles enable row level security;
alter table students enable row level security;
alter table trainers enable row level security;
alter table admins enable row level security;
alter table programs enable row level security;
alter table program_modules enable row level security;
alter table batches enable row level security;
alter table batch_trainers enable row level security;
alter table enrollments enable row level security;
alter table payment_plans enable row level security;
alter table installments enable row level security;
alter table payments enable row level security;
alter table payment_refunds enable row level security;
alter table receipts enable row level security;
alter table class_sessions enable row level security;
alter table attendance enable row level security;
alter table attendance_audit enable row level security;
alter table materials enable row level security;
alter table assignments enable row level security;
alter table assignment_submissions enable row level security;
alter table certificates enable row level security;
alter table leads enable row level security;
alter table notifications enable row level security;
alter table email_log enable row level security;
alter table company_settings enable row level security;
alter table audit_logs enable row level security;
alter table student_notes enable row level security;
alter table student_documents enable row level security;

-- ---------------------------------------------------------------------------
-- Views bypass the RLS of their underlying tables unless created with
-- security_invoker: by default a view runs with the privileges of its
-- OWNER (the migration-running role, which has BYPASSRLS in Supabase), so
-- once real RLS policies exist on `enrollments`/`attendance`/etc., these
-- views would silently ignore them and leak every row to any caller with
-- SELECT on the view — defeating the RLS just enabled above. Postgres 15+
-- supports security_invoker to make a view respect the querying role's own
-- RLS instead. Both of our reporting views need it.

alter view enrollment_summary set (security_invoker = true);
alter view student_attendance_summary set (security_invoker = true);
