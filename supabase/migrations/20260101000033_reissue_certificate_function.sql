-- Phase 17 (Certificates): atomic reissue (replace) operation.
--
-- A reissue must insert the new certificate row AND mark the original
-- 'revoked' as a single all-or-nothing step — two Admin/Student-visible
-- 'issued' rows for the same completion event at once would break the
-- "replace" relationship the certificates table comment documents
-- ("Reissue creates a new row... and marks the prior one revoked —
-- history is preserved", 20260101000009). Doing this as two separate
-- PostgREST calls from the application risks a real partial failure (the
-- insert succeeds, the follow-up update to the original fails) with no way
-- to roll back the first half — a plain multi-statement plpgsql function
-- body, by contrast, runs as a single statement in the caller's
-- transaction, so either both rows change or neither does.
--
-- Minting the certificate_number and rendering/uploading the PDF still
-- happen in application code BEFORE this function is called (same
-- ordering constraint as plain issuance, see 20260101000031's header
-- comment) — this function only performs the two row mutations once the
-- new PDF object already exists at p_new_pdf_path. If this function
-- raises, the application rolls back by removing that now-orphaned
-- Storage object; no `certificates` row is ever touched on failure.
--
-- No SECURITY DEFINER: the only RLS-permitted inserter/updater of
-- `certificates` is already is_admin_or_super() (certificates_write_admin/
-- _update_admin, 20260101000014), so this function needs no elevated
-- privilege of its own — it runs as the caller, gated by the same explicit
-- is_admin_or_super() check used throughout this schema's non-trivial
-- functions, with search_path pinned per the project's established
-- hardening convention (20260101000015).

create or replace function reissue_certificate(
  p_original_id uuid,
  p_new_certificate_number text,
  p_new_pdf_path text,
  p_reason text
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  original record;
  new_id uuid;
  effective_reason text;
begin
  if not is_admin_or_super() then
    raise exception using
      errcode = '42501',
      message = 'Only Admin/Super Admin may reissue a certificate';
  end if;

  select * into original from certificates where id = p_original_id for update;
  if original.id is null then
    raise exception 'Certificate not found';
  end if;
  if original.status <> 'issued' then
    raise exception 'Only a currently issued certificate can be reissued';
  end if;

  effective_reason := coalesce(p_reason, 'Replaced by reissued certificate ' || p_new_certificate_number);

  insert into certificates (
    certificate_number, enrollment_id, student_id, program_id,
    completion_date, issue_date, status, pdf_path
  ) values (
    p_new_certificate_number, original.enrollment_id, original.student_id, original.program_id,
    original.completion_date, current_date, 'issued', p_new_pdf_path
  )
  returning id into new_id;

  update certificates
  set status = 'revoked', revoked_reason = effective_reason, revoked_at = now()
  where id = p_original_id;

  return new_id;
end;
$$;

comment on function reissue_certificate(uuid, text, text, text) is
  'Atomically inserts a replacement certificate row and marks the original revoked, preserving verification history (certificates table comment / REQUIREMENTS.md §28). Admin/Super Admin only (self-checked inside the function body); the new certificate_number and pdf_path must already be minted/uploaded by the caller before this is invoked.';

revoke execute on function reissue_certificate(uuid, text, text, text) from public, anon, authenticated;
grant execute on function reissue_certificate(uuid, text, text, text) to authenticated;
