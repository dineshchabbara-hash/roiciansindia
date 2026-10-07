-- Phase 17 (Certificates) schema-completion fix (not a new design decision),
-- same category as 20260101000019 (student_code) / 20260101000021
-- (enrollment_code): `certificate_number_seq` and `company_settings.
-- certificate_number_format` (default 'CERT-{year}-{seq:6}') already
-- existed from Phase 2 — no mechanism existed yet to actually generate a
-- certificate_number from them. A plain column DEFAULT (student_code/
-- enrollment_code's own approach) is not enough here: unlike those two
-- simple fixed-prefix cases, the certificate format is a configurable
-- template read from `company_settings` with a `{year}`/`{seq:N}`
-- placeholder syntax, which needs a function body, not a single inline
-- expression.
--
-- Checkpoint-confirmed decision (DECISIONS_NEEDED.md D7): the sequence is
-- GLOBAL and MONOTONIC, never reset per calendar year — `{year}` in the
-- format string is a cosmetic label computed from the current date, not a
-- per-year-restarting counter. This matches the sequence's own original
-- documented behavior (20260101000002_sequences.sql: "never reset by
-- calendar year at the database level").
--
-- No SECURITY DEFINER: the only RLS-permitted inserter of a `certificates`
-- row is already is_admin_or_super() (certificates_write_admin,
-- 20260101000014_rls_policies.sql), and company_settings_select_admin
-- grants that same role direct SELECT on company_settings — so this
-- function needs no elevated privilege of its own, least-privilege by
-- construction. search_path is still pinned, matching the project's own
-- established hardening pattern (20260101000015) for every function that
-- isn't trivially inline.
--
-- The application calls this directly via RPC (not only through the
-- column DEFAULT below): issuance needs the real certificate_number
-- BEFORE rendering the PDF (the number is printed on the document itself,
-- per FR-100), and pdf_path is both NOT NULL and immutable
-- (20260101000012), so the row cannot be inserted first and "filled in"
-- afterward the way Materials/Assignments handle their own optional
-- attachments. The explicit is_admin_or_super() check inside the function
-- body is this function's own authorization gate for that direct RPC path
-- — Supabase grants EXECUTE on every new function to anon/authenticated by
-- default (20260101000016's own header comment), so this is revoked and
-- re-granted explicitly, the same hardening discipline already applied to
-- every other sensitive helper function in this schema. A non-admin
-- caller (including anon, which has no grant at all) gets a clean
-- exception; an admin caller gets a real, sequence-consumed number.
-- Skipped sequence numbers from an admin RPC call that is never followed
-- by a real insert are accepted the same way as every other id sequence in
-- this schema already does (20260101000021's own comment: "sequence gaps
-- remain valid").

create or replace function generate_certificate_number()
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  fmt text;
  seq_value bigint;
  pad_width int;
  result text;
begin
  if not is_admin_or_super() then
    raise exception using
      errcode = '42501',
      message = 'Only Admin/Super Admin may generate a certificate number';
  end if;

  select certificate_number_format into fmt from company_settings where singleton limit 1;
  if fmt is null then
    fmt := 'CERT-{year}-{seq:6}';
  end if;

  seq_value := nextval('certificate_number_seq');

  result := replace(fmt, '{year}', extract(year from current_date)::text);

  pad_width := coalesce((regexp_match(result, '\{seq:(\d+)\}'))[1]::int, 6);
  result := regexp_replace(result, '\{seq:\d+\}', lpad(seq_value::text, pad_width, '0'));

  return result;
end;
$$;

comment on function generate_certificate_number() is
  'Formats a new certificate_number from company_settings.certificate_number_format ({year}/{seq:N} placeholders) using the global, never-reset certificate_number_seq (DECISIONS_NEEDED.md D7 — checkpoint-confirmed: monotonic, not per-calendar-year-restarting). Callable directly via RPC by Admin/Super Admin (self-checked inside the function body); also wired as the certificates.certificate_number column DEFAULT as a defense-in-depth fallback for any insert path that omits it.';

revoke execute on function generate_certificate_number() from public, anon, authenticated;
grant execute on function generate_certificate_number() to authenticated;

alter table certificates
  alter column certificate_number set default generate_certificate_number();
