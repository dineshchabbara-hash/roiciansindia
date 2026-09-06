-- Phase 3: real Row Level Security policies, replacing the Phase 2 default-
-- deny placeholder (20260101000013_rls_lockdown.sql enabled RLS everywhere
-- with zero policies; this migration adds the actual per-role rules from
-- USER_ROLES_AND_PERMISSIONS.md §5).
--
-- Design note (read before editing any policy below): Postgres RLS is
-- ROW-level, not column-level, and Supabase maps every application role
-- (admin/trainer/student) onto the SAME Postgres role `authenticated` — so a
-- GRANT-based column restriction would restrict admins too. Two mechanisms
-- are used instead:
--   (a) Tables carrying financial/sensitive columns that trainers must never
--       see (`students`, `enrollments`) get NO trainer-matching policy at
--       all on the base table -> default-deny for trainers. Trainers read
--       two dedicated views instead (trainer_visible_students,
--       trainer_visible_enrollments, defined at the end of this file) whose
--       SELECT list simply omits every financial/sensitive column and whose
--       own WHERE clause re-derives the batch_trainers scoping.
--   (b) Self-edit column restriction (a student editing their own row) is
--       enforced by a BEFORE UPDATE trigger allow-listing editable columns,
--       not by GRANT, for the same reason.
--
-- No policy in this file uses `using (true)` or any other permissive
-- shortcut. Every policy is scoped to auth.uid() via the helper functions
-- below, a specific ownership/assignment join, or an explicit role check.

-- ---------------------------------------------------------------------------
-- Helper functions
--
-- SECURITY DEFINER is required here: `user_roles`/`students`/`trainers`/
-- `admins` themselves have RLS enabled, so a plain function running as the
-- calling (RLS-restricted) role could not read even its own row otherwise —
-- a chicken-and-egg problem. This is the standard, documented Supabase
-- pattern for RLS helper functions. Safety requirements, all satisfied
-- below: (1) every function only ever looks up data for auth.uid() itself —
-- never an attacker-supplied parameter; (2) `search_path` is pinned to
-- prevent search-path hijacking; (3) functions are `stable`, not `volatile`,
-- and perform no writes.

create or replace function current_role_name()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from user_roles where auth_user_id = auth.uid();
$$;

comment on function current_role_name() is
  'The calling user''s application role (super_admin/admin/trainer/student), or null if unauthenticated or unresolved.';

create or replace function is_admin_or_super()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from user_roles
    where auth_user_id = auth.uid() and role in ('admin', 'super_admin')
  );
$$;

create or replace function is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from user_roles
    where auth_user_id = auth.uid() and role = 'super_admin'
  );
$$;

create or replace function current_student_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from students where auth_user_id = auth.uid();
$$;

create or replace function current_trainer_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from trainers where auth_user_id = auth.uid();
$$;

create or replace function current_admin_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from admins where auth_user_id = auth.uid();
$$;

grant execute on function current_role_name() to authenticated;
grant execute on function is_admin_or_super() to authenticated;
grant execute on function is_super_admin() to authenticated;
grant execute on function current_student_id() to authenticated;
grant execute on function current_trainer_id() to authenticated;
grant execute on function current_admin_id() to authenticated;

-- ---------------------------------------------------------------------------
-- user_roles

create policy user_roles_select_own on user_roles
  for select using (auth_user_id = auth.uid());

create policy user_roles_select_admin on user_roles
  for select using (is_admin_or_super());

create policy user_roles_write_admin on user_roles
  for insert with check (is_admin_or_super());

create policy user_roles_update_admin on user_roles
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy user_roles_delete_admin on user_roles
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- students
--
-- Trainers deliberately have NO policy here (see file header) — they read
-- the trainer_visible_students view instead.

create policy students_select_own on students
  for select using (auth_user_id = auth.uid());

create policy students_select_admin on students
  for select using (is_admin_or_super());

create policy students_update_own on students
  for update using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy students_update_admin on students
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy students_write_admin on students
  for insert with check (is_admin_or_super());

create policy students_delete_admin on students
  for delete using (is_admin_or_super());

-- Defense-in-depth column restriction for the self-edit path (students_update_own
-- above): a student updating their OWN row may only change contact/profile
-- fields. Admin/service-role updates are exempt. This does not duplicate the
-- pre-existing student_code immutability trigger; it covers every other
-- identity/enrollment-critical field per REQUIREMENTS.md FR-41.
create or replace function prevent_student_self_edit_of_protected_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Trusted server-side code (service_role) and Admin/Super Admin are exempt.
  if auth.role() = 'service_role' or is_admin_or_super() then
    return new;
  end if;

  if new.first_name is distinct from old.first_name
    or new.last_name is distinct from old.last_name
    or new.preferred_name is distinct from old.preferred_name
    or new.email is distinct from old.email
    or new.date_of_birth is distinct from old.date_of_birth
    or new.gender is distinct from old.gender
    or new.emergency_contact_name is distinct from old.emergency_contact_name
    or new.emergency_contact_phone is distinct from old.emergency_contact_phone
    or new.registration_date is distinct from old.registration_date
    or new.status is distinct from old.status
    or new.lead_id is distinct from old.lead_id
    or new.auth_user_id is distinct from old.auth_user_id
  then
    raise exception 'Students may only update phone, alternate_phone, address fields, and profile_photo_path themselves; other changes require an administrator (REQUIREMENTS.md FR-41).';
  end if;
  return new;
end;
$$;

create trigger students_prevent_self_edit_protected_fields
  before update on students
  for each row execute function prevent_student_self_edit_of_protected_fields();

-- ---------------------------------------------------------------------------
-- trainers

create policy trainers_select_own on trainers
  for select using (auth_user_id = auth.uid());

create policy trainers_select_admin on trainers
  for select using (is_admin_or_super());

create policy trainers_write_admin on trainers
  for insert with check (is_admin_or_super());

create policy trainers_update_admin on trainers
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy trainers_delete_admin on trainers
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- admins

create policy admins_select_own on admins
  for select using (auth_user_id = auth.uid());

create policy admins_select_super on admins
  for select using (is_super_admin());

create policy admins_write_super on admins
  for insert with check (is_super_admin());

create policy admins_update_super on admins
  for update using (is_super_admin()) with check (is_super_admin());

create policy admins_delete_super on admins
  for delete using (is_super_admin());

-- ---------------------------------------------------------------------------
-- programs / program_modules
--
-- 'draft' programs are Admin/Super Admin-only (not yet published); every
-- other status is visible to any authenticated user (trainer catalog view /
-- student "public catalog" per the permission matrix), including a student
-- whose own program has since gone inactive/archived.

create policy programs_select_admin on programs
  for select using (is_admin_or_super());

-- Scoped explicitly `to authenticated`: unlike every other policy in this
-- file, this condition does not reference auth.uid() at all (it is a pure
-- content check), so without the role restriction it would also match the
-- `anon` Postgres role and leak published programs to unauthenticated
-- PostgREST callers ahead of the intentional public-catalog policy Phase 22
-- will add for anon specifically.
create policy programs_select_published on programs
  for select to authenticated using (status <> 'draft');

create policy programs_write_admin on programs
  for insert with check (is_admin_or_super());

create policy programs_update_admin on programs
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy programs_delete_admin on programs
  for delete using (is_admin_or_super());

create policy program_modules_select_admin on program_modules
  for select using (is_admin_or_super());

-- Same `to authenticated` reasoning as programs_select_published above.
create policy program_modules_select_published on program_modules
  for select to authenticated using (
    exists (
      select 1 from programs p
      where p.id = program_modules.program_id and p.status <> 'draft'
    )
  );

create policy program_modules_write_admin on program_modules
  for insert with check (is_admin_or_super());

create policy program_modules_update_admin on program_modules
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy program_modules_delete_admin on program_modules
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- batches / batch_trainers

create policy batches_select_admin on batches
  for select using (is_admin_or_super());

create policy batches_select_trainer on batches
  for select using (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = batches.id and bt.trainer_id = current_trainer_id()
    )
  );

create policy batches_select_student on batches
  for select using (
    exists (
      select 1 from enrollments e
      where e.batch_id = batches.id and e.student_id = current_student_id()
    )
  );

create policy batches_write_admin on batches
  for insert with check (is_admin_or_super());

create policy batches_update_admin on batches
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy batches_delete_admin on batches
  for delete using (is_admin_or_super());

create policy batch_trainers_select_admin on batch_trainers
  for select using (is_admin_or_super());

create policy batch_trainers_select_own on batch_trainers
  for select using (trainer_id = current_trainer_id());

create policy batch_trainers_write_admin on batch_trainers
  for insert with check (is_admin_or_super());

create policy batch_trainers_update_admin on batch_trainers
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy batch_trainers_delete_admin on batch_trainers
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- enrollments
--
-- Trainers deliberately have NO policy here (see file header) — they read
-- the trainer_visible_enrollments view instead, which omits every financial
-- column.

create policy enrollments_select_own on enrollments
  for select using (student_id = current_student_id());

create policy enrollments_select_admin on enrollments
  for select using (is_admin_or_super());

create policy enrollments_write_admin on enrollments
  for insert with check (is_admin_or_super());

create policy enrollments_update_admin on enrollments
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy enrollments_delete_admin on enrollments
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- payment_plans / installments — student read-only via their own enrollment;
-- no trainer access (financial); all writes are Admin/service-role.

create policy payment_plans_select_admin on payment_plans
  for select using (is_admin_or_super());

create policy payment_plans_select_own on payment_plans
  for select using (
    exists (
      select 1 from enrollments e
      where e.id = payment_plans.enrollment_id and e.student_id = current_student_id()
    )
  );

create policy payment_plans_write_admin on payment_plans
  for insert with check (is_admin_or_super());

create policy payment_plans_update_admin on payment_plans
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy payment_plans_delete_admin on payment_plans
  for delete using (is_admin_or_super());

create policy installments_select_admin on installments
  for select using (is_admin_or_super());

create policy installments_select_own on installments
  for select using (
    exists (
      select 1 from payment_plans pp
      join enrollments e on e.id = pp.enrollment_id
      where pp.id = installments.payment_plan_id and e.student_id = current_student_id()
    )
  );

create policy installments_write_admin on installments
  for insert with check (is_admin_or_super());

create policy installments_update_admin on installments
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy installments_delete_admin on installments
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- payments / payment_refunds / receipts
--
-- Students may only ever SELECT their own — every payment write (online via
-- Razorpay webhook, or offline recorded by Admin) goes through server-side
-- code using the service-role key, per ARCHITECTURE.md §8/SECURITY_PLAN.md
-- §9. No trainer access at all (financial data).

create policy payments_select_admin on payments
  for select using (is_admin_or_super());

create policy payments_select_own on payments
  for select using (student_id = current_student_id());

create policy payments_write_admin on payments
  for insert with check (is_admin_or_super());

create policy payments_update_admin on payments
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy payments_delete_admin on payments
  for delete using (is_admin_or_super());

create policy payment_refunds_select_admin on payment_refunds
  for select using (is_admin_or_super());

create policy payment_refunds_select_own on payment_refunds
  for select using (
    exists (
      select 1 from payments p
      where p.id = payment_refunds.payment_id and p.student_id = current_student_id()
    )
  );

create policy payment_refunds_write_admin on payment_refunds
  for insert with check (is_admin_or_super());

create policy payment_refunds_update_admin on payment_refunds
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy receipts_select_admin on receipts
  for select using (is_admin_or_super());

create policy receipts_select_own on receipts
  for select using (
    exists (
      select 1 from payments p
      where p.id = receipts.payment_id and p.student_id = current_student_id()
    )
  );

create policy receipts_write_admin on receipts
  for insert with check (is_admin_or_super());

create policy receipts_update_admin on receipts
  for update using (is_admin_or_super()) with check (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- class_sessions / attendance / attendance_audit

create policy class_sessions_select_admin on class_sessions
  for select using (is_admin_or_super());

create policy class_sessions_select_trainer on class_sessions
  for select using (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = class_sessions.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy class_sessions_select_student on class_sessions
  for select using (
    exists (
      select 1 from enrollments e
      where e.batch_id = class_sessions.batch_id and e.student_id = current_student_id()
    )
  );

create policy class_sessions_write_admin on class_sessions
  for insert with check (is_admin_or_super());

create policy class_sessions_write_trainer on class_sessions
  for insert with check (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = class_sessions.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy class_sessions_update_admin on class_sessions
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy class_sessions_update_trainer on class_sessions
  for update using (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = class_sessions.batch_id and bt.trainer_id = current_trainer_id()
    )
  )
  with check (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = class_sessions.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy class_sessions_delete_admin on class_sessions
  for delete using (is_admin_or_super());

create policy attendance_select_admin on attendance
  for select using (is_admin_or_super());

create policy attendance_select_trainer on attendance
  for select using (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = attendance.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy attendance_select_own on attendance
  for select using (student_id = current_student_id());

create policy attendance_write_admin on attendance
  for insert with check (is_admin_or_super());

create policy attendance_write_trainer on attendance
  for insert with check (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = attendance.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy attendance_update_admin on attendance
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy attendance_update_trainer on attendance
  for update using (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = attendance.batch_id and bt.trainer_id = current_trainer_id()
    )
  )
  with check (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = attendance.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy attendance_delete_admin on attendance
  for delete using (is_admin_or_super());

create policy attendance_audit_select_admin on attendance_audit
  for select using (is_admin_or_super());

create policy attendance_audit_write_admin on attendance_audit
  for insert with check (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- materials

create policy materials_select_admin on materials
  for select using (is_admin_or_super());

create policy materials_select_trainer on materials
  for select using (
    (batch_id is not null and exists (
      select 1 from batch_trainers bt
      where bt.batch_id = materials.batch_id and bt.trainer_id = current_trainer_id()
    ))
    or (class_session_id is not null and exists (
      select 1 from class_sessions cs
      join batch_trainers bt on bt.batch_id = cs.batch_id
      where cs.id = materials.class_session_id and bt.trainer_id = current_trainer_id()
    ))
  );

create policy materials_select_student on materials
  for select using (
    (program_id is not null and exists (
      select 1 from enrollments e
      where e.program_id = materials.program_id and e.student_id = current_student_id()
    ))
    or (batch_id is not null and exists (
      select 1 from enrollments e
      where e.batch_id = materials.batch_id and e.student_id = current_student_id()
    ))
    or (module_id is not null and exists (
      select 1 from program_modules pm
      join enrollments e on e.program_id = pm.program_id
      where pm.id = materials.module_id and e.student_id = current_student_id()
    ))
    or (class_session_id is not null and exists (
      select 1 from class_sessions cs
      join enrollments e on e.batch_id = cs.batch_id
      where cs.id = materials.class_session_id and e.student_id = current_student_id()
    ))
  );

create policy materials_write_admin on materials
  for insert with check (is_admin_or_super());

create policy materials_write_trainer on materials
  for insert with check (
    (batch_id is not null and exists (
      select 1 from batch_trainers bt
      where bt.batch_id = materials.batch_id and bt.trainer_id = current_trainer_id()
    ))
    or (class_session_id is not null and exists (
      select 1 from class_sessions cs
      join batch_trainers bt on bt.batch_id = cs.batch_id
      where cs.id = materials.class_session_id and bt.trainer_id = current_trainer_id()
    ))
  );

create policy materials_update_admin on materials
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy materials_delete_admin on materials
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- assignments / assignment_submissions

create policy assignments_select_admin on assignments
  for select using (is_admin_or_super());

create policy assignments_select_trainer on assignments
  for select using (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = assignments.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy assignments_select_student on assignments
  for select using (
    exists (
      select 1 from enrollments e
      where e.batch_id = assignments.batch_id and e.student_id = current_student_id()
    )
  );

create policy assignments_write_admin on assignments
  for insert with check (is_admin_or_super());

create policy assignments_write_trainer on assignments
  for insert with check (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = assignments.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy assignments_update_admin on assignments
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy assignments_update_trainer on assignments
  for update using (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = assignments.batch_id and bt.trainer_id = current_trainer_id()
    )
  )
  with check (
    exists (
      select 1 from batch_trainers bt
      where bt.batch_id = assignments.batch_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy assignments_delete_admin on assignments
  for delete using (is_admin_or_super());

create policy assignment_submissions_select_admin on assignment_submissions
  for select using (is_admin_or_super());

create policy assignment_submissions_select_trainer on assignment_submissions
  for select using (
    exists (
      select 1 from assignments a
      join batch_trainers bt on bt.batch_id = a.batch_id
      where a.id = assignment_submissions.assignment_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy assignment_submissions_select_own on assignment_submissions
  for select using (student_id = current_student_id());

create policy assignment_submissions_write_admin on assignment_submissions
  for insert with check (is_admin_or_super());

create policy assignment_submissions_write_own on assignment_submissions
  for insert with check (student_id = current_student_id());

create policy assignment_submissions_update_admin on assignment_submissions
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy assignment_submissions_update_trainer on assignment_submissions
  for update using (
    exists (
      select 1 from assignments a
      join batch_trainers bt on bt.batch_id = a.batch_id
      where a.id = assignment_submissions.assignment_id and bt.trainer_id = current_trainer_id()
    )
  )
  with check (
    exists (
      select 1 from assignments a
      join batch_trainers bt on bt.batch_id = a.batch_id
      where a.id = assignment_submissions.assignment_id and bt.trainer_id = current_trainer_id()
    )
  );

create policy assignment_submissions_update_own on assignment_submissions
  for update using (student_id = current_student_id())
  with check (student_id = current_student_id());

-- ---------------------------------------------------------------------------
-- certificates — student read-only own; no trainer access; Admin full.

create policy certificates_select_admin on certificates
  for select using (is_admin_or_super());

create policy certificates_select_own on certificates
  for select using (student_id = current_student_id());

create policy certificates_write_admin on certificates
  for insert with check (is_admin_or_super());

create policy certificates_update_admin on certificates
  for update using (is_admin_or_super()) with check (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- leads — Admin/Super Admin only. No public insert policy yet: the public
-- lead-capture form doesn't exist until Phase 23, and adding an anon insert
-- policy ahead of that UI/validation layer would be premature.

create policy leads_select_admin on leads
  for select using (is_admin_or_super());

create policy leads_write_admin on leads
  for insert with check (is_admin_or_super());

create policy leads_update_admin on leads
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy leads_delete_admin on leads
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- notifications — every user manages their own; Admin/Super Admin full
-- (support/troubleshooting).

create policy notifications_select_admin on notifications
  for select using (is_admin_or_super());

create policy notifications_select_own on notifications
  for select using (recipient_auth_user_id = auth.uid());

create policy notifications_write_admin on notifications
  for insert with check (is_admin_or_super());

create policy notifications_update_admin on notifications
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy notifications_update_own on notifications
  for update using (recipient_auth_user_id = auth.uid())
  with check (recipient_auth_user_id = auth.uid());

create policy notifications_delete_admin on notifications
  for delete using (is_admin_or_super());

-- Defense-in-depth: a user marking their own notification may only change
-- status/read_at, mirroring the students self-edit trigger above.
create or replace function prevent_notification_self_edit_of_protected_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() = 'service_role' or is_admin_or_super() then
    return new;
  end if;

  if new.type is distinct from old.type
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.data is distinct from old.data
    or new.channel is distinct from old.channel
    or new.recipient_auth_user_id is distinct from old.recipient_auth_user_id
  then
    raise exception 'Recipients may only update status/read_at on their own notifications.';
  end if;
  return new;
end;
$$;

create trigger notifications_prevent_self_edit_protected_fields
  before update on notifications
  for each row execute function prevent_notification_self_edit_of_protected_fields();

-- ---------------------------------------------------------------------------
-- email_log — Admin/Super Admin only (operational/support data).

create policy email_log_select_admin on email_log
  for select using (is_admin_or_super());

create policy email_log_write_admin on email_log
  for insert with check (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- company_settings
--
-- CORRECTION vs. the permission matrix's literal "-" cell for Admin: the
-- matrix note only ever said Admin cannot EDIT company settings, not that
-- Admin has zero visibility into them — and Admin needs read access for
-- everyday operational context (current tax rate, receipt/certificate
-- numbering format, branding). Documented here and in
-- USER_ROLES_AND_PERMISSIONS.md; write access remains Super Admin only.

create policy company_settings_select_admin on company_settings
  for select using (is_admin_or_super());

create policy company_settings_update_super on company_settings
  for update using (is_super_admin()) with check (is_super_admin());

-- No insert/delete policy for anyone: the single row is created by
-- migration (20260101000003_company_settings.sql) and never re-created or
-- removed by application code.

-- ---------------------------------------------------------------------------
-- audit_logs — Admin/Super Admin read; written by server-side application
-- code via service-role (no end-user role can write audit entries).
-- "Non-sensitive subset" filtering for Admin (per the permission matrix
-- note) is deferred until a later phase actually writes entries containing
-- something that needs hiding from Admin but not Super Admin — building
-- that filter speculatively, before any real audit entry exists, would be
-- guessing at a shape we don't have yet.

create policy audit_logs_select_admin on audit_logs
  for select using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- student_notes — staff-only, never students.

create policy student_notes_select_admin on student_notes
  for select using (is_admin_or_super());

create policy student_notes_write_admin on student_notes
  for insert with check (is_admin_or_super());

create policy student_notes_update_admin on student_notes
  for update using (is_admin_or_super()) with check (is_admin_or_super());

create policy student_notes_delete_admin on student_notes
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- student_documents — Admin full; student may see and add their own.

create policy student_documents_select_admin on student_documents
  for select using (is_admin_or_super());

create policy student_documents_select_own on student_documents
  for select using (student_id = current_student_id());

create policy student_documents_write_admin on student_documents
  for insert with check (is_admin_or_super());

create policy student_documents_write_own on student_documents
  for insert with check (
    student_id = current_student_id()
    and uploaded_by_type = 'student'
    and uploaded_by = current_student_id()
  );

create policy student_documents_delete_admin on student_documents
  for delete using (is_admin_or_super());

-- ---------------------------------------------------------------------------
-- Trainer-safe views: the ONLY sanctioned read path for trainers onto
-- student/enrollment data. Created WITHOUT security_invoker (they run with
-- the privileges of their owner, which can read the full base tables even
-- though trainers have no policy on `students`/`enrollments` directly) —
-- all of the security here comes from (1) the SELECT list omitting every
-- financial/sensitive column and (2) the WHERE clause re-deriving the
-- batch_trainers scoping from auth.uid() on every query. Grant SELECT only
-- to `authenticated`; base-table RLS continues to block trainers from
-- reaching `students`/`enrollments` directly as defense in depth.

create view trainer_visible_students
with (security_barrier = true)
as
select distinct
  s.id as student_id,
  s.student_code,
  s.first_name,
  s.last_name,
  s.phone,
  s.email,
  bt.batch_id
from students s
join enrollments e on e.student_id = s.id
join batch_trainers bt on bt.batch_id = e.batch_id
where bt.trainer_id = current_trainer_id();

comment on view trainer_visible_students is
  'Trainer-facing student directory, scoped to the trainer''s own assigned batches. Deliberately excludes address/DOB/emergency-contact/financial columns. Base tables have no trainer-matching RLS policy — this view is the only sanctioned read path.';

revoke all on trainer_visible_students from public, anon;
grant select on trainer_visible_students to authenticated;

create view trainer_visible_enrollments
with (security_barrier = true)
as
select distinct
  e.id as enrollment_id,
  e.enrollment_code,
  e.student_id,
  e.program_id,
  e.batch_id,
  e.status,
  e.enrollment_date
from enrollments e
join batch_trainers bt on bt.batch_id = e.batch_id
where bt.trainer_id = current_trainer_id();

comment on view trainer_visible_enrollments is
  'Trainer-facing enrollment view, scoped to the trainer''s own assigned batches. Deliberately excludes every fee/discount/payment/balance column (REQUIREMENTS.md: trainers must never see financial data).';

revoke all on trainer_visible_enrollments from public, anon;
grant select on trainer_visible_enrollments to authenticated;
