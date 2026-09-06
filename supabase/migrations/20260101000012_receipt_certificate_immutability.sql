-- Fix (Phase 2 verification finding): receipt_number and certificate_number
-- were unique but NOT protected against UPDATE, unlike student_code /
-- enrollment_code / payment_code which already have immutability triggers.
-- A financial/legal document number must never be silently changed after
-- issuance (REQUIREMENTS.md §26/§28, SECURITY_PLAN.md §15). This migration
-- closes that gap and also adds the updated_at column/trigger that receipts
-- was missing (needed for emailed_at, the one field on a receipt that is
-- legitimately set after creation, once the confirmation email is sent).

alter table receipts
  add column if not exists updated_at timestamptz not null default now();

create trigger receipts_set_updated_at
  before update on receipts
  for each row execute function set_updated_at();

create or replace function prevent_receipt_immutable_fields_change()
returns trigger
language plpgsql
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

comment on function prevent_receipt_immutable_fields_change() is
  'Only emailed_at (and updated_at) may change after a receipt is created — the number, the payment it belongs to, and the PDF itself are fixed at issuance.';

create trigger receipts_prevent_immutable_fields_change
  before update on receipts
  for each row execute function prevent_receipt_immutable_fields_change();

-- ---------------------------------------------------------------------------

create or replace function prevent_certificate_immutable_fields_change()
returns trigger
language plpgsql
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

comment on function prevent_certificate_immutable_fields_change() is
  'Only status/revoked_reason/revoked_at (and updated_at) may change after issuance — a reissue is a new row with a new certificate_number, not an edit of this one (REQUIREMENTS.md §28).';

create trigger certificates_prevent_immutable_fields_change
  before update on certificates
  for each row execute function prevent_certificate_immutable_fields_change();
