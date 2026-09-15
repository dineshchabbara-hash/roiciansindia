-- Phase 9 manual-acceptance correction (approved business decision):
-- "Registered" and "Enrolled" are not separate Enrollment stages for
-- Roicians' workflow. Removes 'registered' from the enrollments.status
-- CHECK constraint. Final approved statuses: lead, applicant, enrolled,
-- active, on_hold, completed, withdrawn, cancelled.
--
-- Any existing 'registered' row is migrated to 'enrolled' — the next
-- operational stage — before the constraint stops allowing it. Nothing
-- else is touched: no other status value, no other column, no other table.
-- Inspection of this project's live dev data before writing this migration
-- found zero rows with status = 'registered', so this UPDATE is a no-op
-- guard here, kept so the migration is safe to apply anywhere a
-- 'registered' row might still exist.

update public.enrollments set status = 'enrolled' where status = 'registered';

alter table public.enrollments drop constraint enrollments_status_check;
alter table public.enrollments add constraint enrollments_status_check
  check (status in (
    'lead', 'applicant', 'enrolled', 'active',
    'on_hold', 'completed', 'withdrawn', 'cancelled'
  ));
