-- Reporting/read views. See DATABASE_SCHEMA.md §8 "Indexing & Performance Notes".
-- These exist to avoid N+1 queries on the Admin list/dashboard screens and to
-- give attendance-percentage a single, well-indexed source instead of
-- recomputing raw row sums in application code on every request.

create or replace view enrollment_summary as
select
  e.id,
  e.enrollment_code,
  e.status as enrollment_status,
  e.enrollment_date,
  e.total_payable,
  e.amount_paid_cache,
  e.outstanding_balance_cache,
  s.id as student_id,
  s.student_code,
  s.first_name as student_first_name,
  s.last_name as student_last_name,
  p.id as program_id,
  p.program_code,
  p.name as program_name,
  b.id as batch_id,
  b.name as batch_name,
  b.status as batch_status
from enrollments e
join students s on s.id = e.student_id
join programs p on p.id = e.program_id
left join batches b on b.id = e.batch_id;

comment on view enrollment_summary is
  'Denormalized read model for the Admin enrollment list/detail screens. Never used as a write target.';

-- ---------------------------------------------------------------------------

create or replace view student_attendance_summary as
select
  a.enrollment_id,
  a.student_id,
  a.batch_id,
  count(*) as total_sessions,
  count(*) filter (where a.status = 'present') as present_count,
  count(*) filter (where a.status = 'absent') as absent_count,
  count(*) filter (where a.status = 'late') as late_count,
  count(*) filter (where a.status = 'excused') as excused_count,
  case
    when count(*) = 0 then null
    else round(
      100.0 * count(*) filter (where a.status in ('present', 'late')) / count(*),
      2
    )
  end as attendance_percentage
from attendance a
group by a.enrollment_id, a.student_id, a.batch_id;

comment on view student_attendance_summary is
  'Per-enrollment attendance counts and computed percentage. "Late" counts toward attendance percentage as present; adjust here (single source) if the business rule differs.';
