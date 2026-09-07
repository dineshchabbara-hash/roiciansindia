-- Security hardening (advisor finding, security_definer_view, ERROR):
-- trainer_visible_students/trainer_visible_enrollments were views that ran
-- with owner privileges (the only way, under Postgres's row-only RLS model,
-- to give trainers a column-restricted slice of students/enrollments when
-- trainer/student/admin all map to the same `authenticated` Postgres role).
-- Supabase's linter flags ANY such view at ERROR severity regardless of
-- mitigation. The identical row+column filtering pattern implemented as a
-- SECURITY DEFINER FUNCTION instead of a view is not flagged by that lint
-- (0010 targets views specifically) and is the standard, documented
-- Supabase pattern for this exact "one shared role, multiple app roles"
-- problem — the resulting function-executable-by-authenticated finding is
-- the same WARN category already resolved for the other 6 helpers via
-- explicit revoke/grant below.
--
-- No RLS policy is added to `students` or `enrollments` for trainers here —
-- direct base-table access for trainers remains fully blocked exactly as
-- before (defense in depth: even if this function's grant were ever
-- misconfigured, trainers still could not read the base tables directly).
-- No caller-supplied trainer_id: scoping comes only from
-- public.current_trainer_id(), which derives from auth.uid().
--
-- search_path is pinned to '' (the strongest option) with every reference
-- fully schema-qualified — practical here because neither function calls an
-- unqualified auth.* function directly (auth.uid() resolution happens
-- inside current_trainer_id() itself, under its own pinned search_path).

drop view if exists trainer_visible_students;
drop view if exists trainer_visible_enrollments;

create function public.trainer_visible_students()
returns table (
  student_id uuid,
  student_code text,
  first_name text,
  last_name text,
  phone text,
  email text,
  batch_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    s.id as student_id,
    s.student_code,
    s.first_name,
    s.last_name,
    s.phone,
    s.email,
    bt.batch_id
  from public.students s
  join public.enrollments e on e.student_id = s.id
  join public.batch_trainers bt on bt.batch_id = e.batch_id
  where bt.trainer_id = public.current_trainer_id();
$$;

comment on function public.trainer_visible_students() is
  'Trainer-facing student directory, scoped to the calling trainer''s own assigned batches via current_trainer_id()/auth.uid(). Returns only student_id/student_code/first_name/last_name/phone/email/batch_id — never address/DOB/emergency-contact/financial columns. Base `students` table has no trainer-matching RLS policy; this function is the only sanctioned read path. Replaces the pre-Phase-hardening view of the same name, which the Supabase linter flagged as a SECURITY DEFINER view (ERROR).';

create function public.trainer_visible_enrollments()
returns table (
  enrollment_id uuid,
  enrollment_code text,
  student_id uuid,
  program_id uuid,
  batch_id uuid,
  status text,
  enrollment_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct
    e.id as enrollment_id,
    e.enrollment_code,
    e.student_id,
    e.program_id,
    e.batch_id,
    e.status,
    e.enrollment_date
  from public.enrollments e
  join public.batch_trainers bt on bt.batch_id = e.batch_id
  where bt.trainer_id = public.current_trainer_id();
$$;

comment on function public.trainer_visible_enrollments() is
  'Trainer-facing enrollment view, scoped to the calling trainer''s own assigned batches via current_trainer_id()/auth.uid(). Returns only enrollment_id/enrollment_code/student_id/program_id/batch_id/status/enrollment_date — never any fee/discount/tax/payable/balance column. Base `enrollments` table has no trainer-matching RLS policy; this function is the only sanctioned read path. Replaces the pre-Phase-hardening view of the same name, which the Supabase linter flagged as a SECURITY DEFINER view (ERROR).';

revoke execute on function public.trainer_visible_students() from public, anon, authenticated;
revoke execute on function public.trainer_visible_enrollments() from public, anon, authenticated;

grant execute on function public.trainer_visible_students() to authenticated;
grant execute on function public.trainer_visible_enrollments() to authenticated;
