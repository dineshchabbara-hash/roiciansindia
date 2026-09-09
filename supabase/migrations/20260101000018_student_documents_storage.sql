-- Phase 5 (Student Management): Storage bucket backing the pre-existing
-- `student_documents` metadata table. Admin/Super-Admin only for this
-- phase, per explicit scope decision — no student-facing Storage grant yet
-- (that belongs with the Student Portal phase). The metadata table's own
-- RLS (20260101000014_rls_policies.sql: student_documents_select_own /
-- student_documents_write_own) is untouched and unrelated to this bucket's
-- access control; a student's ability to see their own document ROW is not
-- the same as being able to read the underlying file bytes, and no such
-- Storage grant is added here.

insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

create policy student_documents_bucket_select_admin on storage.objects
  for select using (bucket_id = 'student-documents' and is_admin_or_super());

create policy student_documents_bucket_insert_admin on storage.objects
  for insert with check (bucket_id = 'student-documents' and is_admin_or_super());

create policy student_documents_bucket_update_admin on storage.objects
  for update
  using (bucket_id = 'student-documents' and is_admin_or_super())
  with check (bucket_id = 'student-documents' and is_admin_or_super());

create policy student_documents_bucket_delete_admin on storage.objects
  for delete using (bucket_id = 'student-documents' and is_admin_or_super());
