-- Phase 17 (Certificates): private Storage bucket backing the pre-existing
-- `certificates` metadata table (20260101000009_certificates_leads_
-- notifications.sql). No existing bucket fits — `materials` and
-- `assignment-*` are each scoped to a different ownership model entirely,
-- and `student-documents` is Admin-only with no issuance semantics.
--
-- Object path convention, deterministic and server-built — the caller
-- never supplies or controls the path: `{studentId}/{certificateNumber}.pdf`.
-- Unlike Materials/Assignment attachments, there is no "insert row first,
-- upload after" option here (certificates.pdf_path is NOT NULL and
-- immutable, 20260101000012 — see 20260101000031's own header comment for
-- the full ordering rationale): certificate_number is minted via RPC,
-- the PDF is rendered (the number is printed on it), the object is
-- uploaded, and ONLY THEN is the `certificates` row inserted with that
-- exact pdf_path. This means the Storage INSERT policy cannot join to a
-- real `certificates` row at upload time — but since only
-- is_admin_or_super() may ever write here at all (no Trainer certificate
-- access of any kind — USER_ROLES_AND_PERMISSIONS.md's own permission
-- matrix: Trainer "–" on certificates), the INSERT policy needs no
-- path-encoded trust the way materials_bucket_insert_trainer did for a
-- non-admin role; it is simply "Admin, full stop," identical in shape to
-- student-documents' own Admin-only bucket policies. SELECT, by contrast,
-- always happens after the owning row exists, so it joins to the real
-- `certificates` row by its own stored pdf_path, the same single-source-
-- of-truth discipline every prior private bucket in this schema already
-- uses — this file does not re-derive certificates_select_own's own logic.
--
-- No anon policy of any kind: public certificate verification
-- (/verify-certificate, FR-101) serves only the minimal non-sensitive
-- fields the `certificates` table comment itself already specifies
-- (certificate_number, student display name, program name, issue_date,
-- status) through a dedicated, rate-limited server action — never a raw
-- Storage object, never a signed URL, and never the PDF file itself.

insert into storage.buckets (id, name, public)
values ('certificates', 'certificates', false)
on conflict (id) do nothing;

create policy certificates_bucket_select_admin on storage.objects
  for select using (bucket_id = 'certificates' and is_admin_or_super());

create policy certificates_bucket_insert_admin on storage.objects
  for insert with check (bucket_id = 'certificates' and is_admin_or_super());

create policy certificates_bucket_update_admin on storage.objects
  for update
  using (bucket_id = 'certificates' and is_admin_or_super())
  with check (bucket_id = 'certificates' and is_admin_or_super());

create policy certificates_bucket_delete_admin on storage.objects
  for delete using (bucket_id = 'certificates' and is_admin_or_super());

-- Student — read-only, scoped via the real certificates row (own rows
-- only, mirroring certificates_select_own exactly).
create policy certificates_bucket_select_own on storage.objects
  for select using (
    bucket_id = 'certificates'
    and exists (
      select 1 from certificates c
      where c.pdf_path = storage.objects.name
        and c.student_id = current_student_id()
    )
  );
