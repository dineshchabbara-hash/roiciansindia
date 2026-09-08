-- Security hardening (advisor findings, anon/authenticated_security_definer
-- _function_executable, WARN): every SECURITY DEFINER function is created
-- with EXECUTE granted to PUBLIC by default in Postgres, and Supabase
-- projects additionally grant EXECUTE directly to `anon`/`authenticated` on
-- every new function via `alter default privileges in schema public grant
-- execute on functions to anon, authenticated, service_role` at project
-- bootstrap. The prior migration granted EXECUTE to `authenticated` on the
-- 6 RLS helper functions but never revoked either of those default grants,
-- so `anon` could also call them via PostgREST RPC
-- (e.g. /rest/v1/rpc/is_admin_or_super). Revoking both explicitly, then
-- re-granting only what is actually required, closes that gap.
--
-- Confirmed via a full-repo search for `.rpc(`: nothing in the application
-- calls any of these 8 functions directly. The 6 role/identity helpers are
-- referenced only inside RLS policy `using`/`with check` expressions across
-- this schema — policy evaluation does not require the querying role to
-- hold a separate EXECUTE grant on functions referenced in the policy body,
-- so re-granting to `authenticated` here is for supported direct use (e.g.
-- a future rpc() call from application code) and documented parity with
-- Supabase's own recommended helper-function pattern, not a functional
-- requirement for RLS itself. The 2 self-edit trigger functions are invoked
-- only by their BEFORE UPDATE triggers, which likewise need no EXECUTE grant
-- on the triggering role — so their minimum required grant is none.

revoke execute on function current_role_name() from public, anon, authenticated;
revoke execute on function is_admin_or_super() from public, anon, authenticated;
revoke execute on function is_super_admin() from public, anon, authenticated;
revoke execute on function current_student_id() from public, anon, authenticated;
revoke execute on function current_trainer_id() from public, anon, authenticated;
revoke execute on function current_admin_id() from public, anon, authenticated;
revoke execute on function prevent_student_self_edit_of_protected_fields() from public, anon, authenticated;
revoke execute on function prevent_notification_self_edit_of_protected_fields() from public, anon, authenticated;

-- Minimum required: the 6 policy-referenced helpers back to authenticated
-- only. The 2 trigger-only functions get no grant at all — anon and
-- authenticated should both have zero ability to call them via RPC.
grant execute on function current_role_name() to authenticated;
grant execute on function is_admin_or_super() to authenticated;
grant execute on function is_super_admin() to authenticated;
grant execute on function current_student_id() to authenticated;
grant execute on function current_trainer_id() to authenticated;
grant execute on function current_admin_id() to authenticated;
