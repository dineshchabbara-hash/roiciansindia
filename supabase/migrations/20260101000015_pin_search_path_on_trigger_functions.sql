-- Security hardening (advisor finding, function_search_path_mutable, WARN):
-- these 6 trigger functions predate the search_path-pinning pattern
-- established by the Phase 3 RLS helper functions. Pinning search_path
-- prevents search-path hijacking (a malicious search_path could otherwise
-- shadow unqualified references with attacker-controlled objects). Bodies
-- are unchanged — only the function header gains `set search_path`.
-- create or replace preserves existing triggers that reference these by name.

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function prevent_student_code_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.student_code is distinct from old.student_code then
    raise exception 'student_code is immutable and cannot be changed after creation';
  end if;
  return new;
end;
$$;

create or replace function prevent_enrollment_code_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.enrollment_code is distinct from old.enrollment_code then
    raise exception 'enrollment_code is immutable and cannot be changed after creation';
  end if;
  return new;
end;
$$;

create or replace function prevent_payment_code_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.payment_code is distinct from old.payment_code then
    raise exception 'payment_code is immutable and cannot be changed after creation';
  end if;
  return new;
end;
$$;

create or replace function prevent_receipt_immutable_fields_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.receipt_number is distinct from old.receipt_number then
    raise exception 'receipt_number is immutable and cannot be changed after creation';
  end if;
  if new.payment_id is distinct from old.payment_id then
    raise exception 'receipts.payment_id is immutable and cannot be changed after creation';
  end if;
  if new.pdf_path is distinct from old.pdf_path then
    raise exception 'receipts.pdf_path is immutable and cannot be changed after creation';
  end if;
  return new;
end;
$$;

create or replace function prevent_certificate_immutable_fields_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.certificate_number is distinct from old.certificate_number then
    raise exception 'certificate_number is immutable and cannot be changed after creation';
  end if;
  if new.enrollment_id is distinct from old.enrollment_id
    or new.student_id is distinct from old.student_id
    or new.program_id is distinct from old.program_id
  then
    raise exception 'certificates.enrollment_id/student_id/program_id are immutable after creation';
  end if;
  if new.completion_date is distinct from old.completion_date
    or new.issue_date is distinct from old.issue_date
  then
    raise exception 'certificates.completion_date/issue_date are immutable after creation';
  end if;
  if new.pdf_path is distinct from old.pdf_path then
    raise exception 'certificates.pdf_path is immutable after creation';
  end if;
  return new;
end;
$$;
