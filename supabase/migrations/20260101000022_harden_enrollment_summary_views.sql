-- Security fix (manual review finding, discovered ahead of Phase 9 Enrollment
-- Management, approved before implementation continued): enrollment_summary
-- and student_attendance_summary (20260101000011_views.sql) are plain views
-- owned by `postgres`, a role with BYPASSRLS — so querying either view
-- silently skips every RLS policy on the underlying
-- enrollments/students/programs/batches/attendance tables, regardless of who
-- queries it. Confirmed directly against the live project
-- (information_schema.role_table_grants): both `anon` and `authenticated`
-- currently hold SELECT (plus unused INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER, from Supabase's default "alter default privileges"
-- bootstrap, never revoked) directly on both views — the same class of gap
-- 20260101000016/20260101000017 already closed for 8 other objects, missed
-- here because these two views predate that hardening pass.
--
-- Fix: mark both views security_invoker (Postgres 15+; this project runs
-- 17.6), so they re-evaluate RLS as the CALLING role instead of the owner —
-- Admin/Super Admin see everything via enrollments_select_admin, a Student
-- sees only their own row via enrollments_select_own (joined through their
-- own students row), a Trainer sees nothing (no trainer policy exists on
-- enrollments, by design — Trainers use trainer_visible_enrollments()
-- instead), anon sees nothing once its grant is revoked below. No new
-- policy is created anywhere; the views simply stop bypassing the policies
-- that already exist. service_role is untouched (not named in either
-- revoke or grant below), preserving its existing bypass-RLS behavior
-- exactly as the rest of this schema already relies on.

alter view enrollment_summary set (security_invoker = true);
alter view student_attendance_summary set (security_invoker = true);

revoke all on enrollment_summary, student_attendance_summary from anon, authenticated;
grant select on enrollment_summary, student_attendance_summary to authenticated;
