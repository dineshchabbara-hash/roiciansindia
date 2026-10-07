-- Phase 16 (Assignments & Submissions): two private Storage buckets backing
-- the pre-existing `assignments`/`assignment_submissions` metadata tables
-- (20260101000008_academic_tables.sql, unchanged by this phase). No existing
-- bucket fits either file kind:
--   - `materials` (20260101000027) is Student READ-ONLY — Students never
--     get an insert policy there, but a Student submission upload is
--     exactly that.
--   - `student-documents` (20260101000018) is Admin-only.
-- Assignment attachments (Trainer/Admin-provided) and Student submissions
-- have different ownership rules entirely (see REQUIREMENTS §11/§12 of the
-- Phase 16 brief: "different ownership rules... do not reuse Student
-- submission path authorization carelessly") — kept as two separate
-- buckets rather than one bucket with path-prefix branching, so each
-- bucket's own policy set only ever has to reason about one write-
-- permission shape.
--
-- Object path convention, deterministic and server-built (never a
-- caller-supplied path) — see lib/domain/assignments.ts:
--   assignment-attachments: `{assignmentId}/{objectId}-{sanitizedName}`
--   assignment-submissions: `{assignmentId}/{studentId}/{objectId}-{sanitizedName}`
-- The original filename only ever contributes a sanitized cosmetic suffix
-- (lib/domain/students.ts's own sanitizeFileNameForStorage), never the
-- path's authority.
--
-- Unlike Materials (whose INSERT policy had to trust scope-type/id encoded
-- in the path, because no `materials` row existed yet at upload time), the
-- application-layer flow for assignments is: insert the `assignments` row
-- FIRST (attachment_path still null, every other column already known —
-- program_id/batch_id/trainer_id are never derived from the upload), THEN
-- upload the attachment keyed by the now-real assignment id, THEN update
-- `attachment_path`. The assignment row — and therefore its real
-- batch_id/trainer_id — already exists by the time of the Storage INSERT,
-- so the Trainer INSERT policy below can join directly to the real
-- `assignments`/`batch_trainers` rows instead of re-deriving trust from the
-- path text the way materials_bucket_insert_trainer had to. Every other
-- operation (select/update/delete) joins storage.objects to the owning
-- table by its own stored path column, the same single-source-of-truth
-- discipline 20260101000027 already established — this file does not
-- re-derive or duplicate assignments_select_trainer/_select_student/
-- assignment_submissions_select_* logic, it reuses it.

insert into storage.buckets (id, name, public)
values
  ('assignment-attachments', 'assignment-attachments', false),
  ('assignment-submissions', 'assignment-submissions', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- assignment-attachments — Admin unrestricted; Trainer insert/select scoped
-- via batch_trainers (any trainer assigned to the assignment's batch, the
-- same collaboration model assignments_update_trainer itself uses — not
-- only the single trainer named in assignments.trainer_id); Student
-- select-only, scoped via enrollments exactly like assignments_select_student
-- (no update/delete for Trainer or Student — matches the table's own
-- assignments_update_trainer/assignments_delete_admin shape, which has no
-- Student branch and no Trainer delete at all).

create policy assignment_attachments_select_admin on storage.objects
  for select using (bucket_id = 'assignment-attachments' and is_admin_or_super());

create policy assignment_attachments_insert_admin on storage.objects
  for insert with check (bucket_id = 'assignment-attachments' and is_admin_or_super());

create policy assignment_attachments_update_admin on storage.objects
  for update
  using (bucket_id = 'assignment-attachments' and is_admin_or_super())
  with check (bucket_id = 'assignment-attachments' and is_admin_or_super());

create policy assignment_attachments_delete_admin on storage.objects
  for delete using (bucket_id = 'assignment-attachments' and is_admin_or_super());

-- Insert: the assignment row already exists by upload time (see header
-- comment), so this joins directly to it by the trusted first path segment
-- — never trusting the path alone as authorization, exactly the same
-- "cast the trusted DB column to text, never the untrusted segment to uuid"
-- discipline as materials_bucket_insert_trainer, so a malformed/non-UUID
-- segment safely fails the comparison rather than throwing.
create policy assignment_attachments_insert_trainer on storage.objects
  for insert with check (
    bucket_id = 'assignment-attachments'
    and array_length(string_to_array(name, '/'), 1) = 2
    and (string_to_array(name, '/'))[2] <> ''
    and exists (
      select 1 from assignments a
      join batch_trainers bt on bt.batch_id = a.batch_id
      where a.id::text = (string_to_array(name, '/'))[1]
        and bt.trainer_id = current_trainer_id()
    )
  );

create policy assignment_attachments_select_trainer on storage.objects
  for select using (
    bucket_id = 'assignment-attachments'
    and exists (
      select 1 from assignments a
      join batch_trainers bt on bt.batch_id = a.batch_id
      where a.attachment_path = storage.objects.name
        and bt.trainer_id = current_trainer_id()
    )
  );

create policy assignment_attachments_select_student on storage.objects
  for select using (
    bucket_id = 'assignment-attachments'
    and exists (
      select 1 from assignments a
      join enrollments e on e.batch_id = a.batch_id
      where a.attachment_path = storage.objects.name
        and e.student_id = current_student_id()
    )
  );

-- ---------------------------------------------------------------------------
-- assignment-submissions — Admin unrestricted; Student insert/select own
-- only; Trainer select-only, scoped via batch_trainers; Admin may also
-- update/delete (mirrors assignment_submissions' own table policies, which
-- have no Trainer delete and no cross-student Student access at all).
--
-- Unlike assignment-attachments, no `assignment_submissions` row
-- necessarily exists yet at the Student's first-ever upload (same
-- chicken-and-egg timing materials_bucket_insert_trainer solved for
-- Trainer) — so the Student INSERT policy trusts the path's own encoded
-- {assignmentId}/{studentId}/ prefix, re-verified against the real
-- assignments/enrollments relationship (never the path text alone): the
-- second segment must equal the caller's own current_student_id(), AND the
-- first segment must name an assignment whose batch the caller is actually
-- enrolled in — the exact same ownership condition this migration's own
-- 20260101000028 just added to assignment_submissions_write_own at the
-- table level, so the Storage layer can never be looser than the table
-- layer it backs.

create policy assignment_submissions_bucket_select_admin on storage.objects
  for select using (bucket_id = 'assignment-submissions' and is_admin_or_super());

create policy assignment_submissions_bucket_insert_admin on storage.objects
  for insert with check (bucket_id = 'assignment-submissions' and is_admin_or_super());

create policy assignment_submissions_bucket_update_admin on storage.objects
  for update
  using (bucket_id = 'assignment-submissions' and is_admin_or_super())
  with check (bucket_id = 'assignment-submissions' and is_admin_or_super());

create policy assignment_submissions_bucket_delete_admin on storage.objects
  for delete using (bucket_id = 'assignment-submissions' and is_admin_or_super());

create policy assignment_submissions_bucket_insert_own on storage.objects
  for insert with check (
    bucket_id = 'assignment-submissions'
    and array_length(string_to_array(name, '/'), 1) = 3
    and (string_to_array(name, '/'))[3] <> ''
    and (string_to_array(name, '/'))[2] = current_student_id()::text
    and exists (
      select 1 from assignments a
      join enrollments e on e.batch_id = a.batch_id
      where a.id::text = (string_to_array(name, '/'))[1]
        and e.student_id = current_student_id()
    )
  );

-- Select/update/delete for a Student's own submission join through the
-- real `assignment_submissions` row by its stored file_path (the row
-- exists by then), mirroring materials_bucket_select_student's own
-- single-source-of-truth pattern — no separate path-segment re-derivation
-- once the metadata row is the thing actually being authorized.
create policy assignment_submissions_bucket_select_own on storage.objects
  for select using (
    bucket_id = 'assignment-submissions'
    and exists (
      select 1 from assignment_submissions s
      where s.file_path = storage.objects.name
        and s.student_id = current_student_id()
    )
  );

create policy assignment_submissions_bucket_update_own on storage.objects
  for update
  using (
    bucket_id = 'assignment-submissions'
    and exists (
      select 1 from assignment_submissions s
      where s.file_path = storage.objects.name
        and s.student_id = current_student_id()
    )
  )
  with check (
    bucket_id = 'assignment-submissions'
    and exists (
      select 1 from assignment_submissions s
      where s.file_path = storage.objects.name
        and s.student_id = current_student_id()
    )
  );

create policy assignment_submissions_bucket_select_trainer on storage.objects
  for select using (
    bucket_id = 'assignment-submissions'
    and exists (
      select 1 from assignment_submissions s
      join assignments a on a.id = s.assignment_id
      join batch_trainers bt on bt.batch_id = a.batch_id
      where s.file_path = storage.objects.name
        and bt.trainer_id = current_trainer_id()
    )
  );
