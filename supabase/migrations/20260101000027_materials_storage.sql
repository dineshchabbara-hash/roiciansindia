-- Phase 15 (Materials): private Storage bucket backing the pre-existing
-- `materials` metadata table. No existing bucket fits — `student-documents`
-- (20260101000018) is Admin-only, but Materials needs scoped Trainer
-- upload/read and scoped Student read too.
--
-- Object path convention: `{scopeType}/{scopeId}/{objectId}-{sanitizedName}`
-- where scopeType is one of program/batch/module/session and scopeId is
-- the same uuid stored in the corresponding materials.*_id column for that
-- row. This is a defense-in-depth, trusted-identifier path (never the sole
-- authorization mechanism — see below) needed only because, at the moment
-- of upload, the `materials` metadata row does not exist yet (the
-- established student-documents pattern uploads the object first, then
-- inserts metadata, rolling back the object if that insert fails) — so an
-- INSERT policy has nothing in the `materials` table to join against yet.
--
-- For every other operation (select/update/delete), the real metadata row
-- already exists by then, so those policies join storage.objects to the
-- `materials` table by its own stored file_path and apply the EXACT SAME
-- authorization logic the table's own RLS policies already use (single
-- source of truth — this file does not re-derive or duplicate the
-- materials_select_trainer/materials_select_student logic, it reuses it).
--
-- application-layer uploadMaterial() builds this path server-side from the
-- verified scope id and a freshly generated object id; the caller-supplied
-- original filename only ever contributes a sanitized cosmetic suffix,
-- never the path's authority.

insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Admin — unrestricted within the bucket, same shape as student-documents.

create policy materials_bucket_select_admin on storage.objects
  for select using (bucket_id = 'materials' and is_admin_or_super());

create policy materials_bucket_insert_admin on storage.objects
  for insert with check (bucket_id = 'materials' and is_admin_or_super());

create policy materials_bucket_update_admin on storage.objects
  for update
  using (bucket_id = 'materials' and is_admin_or_super())
  with check (bucket_id = 'materials' and is_admin_or_super());

create policy materials_bucket_delete_admin on storage.objects
  for delete using (bucket_id = 'materials' and is_admin_or_super());

-- ---------------------------------------------------------------------------
-- Trainer — insert only into a batch/session path they are actually
-- assigned to (path-encoded, since no materials row exists yet at insert
-- time); select scoped via the real materials row thereafter, mirroring
-- materials_select_trainer exactly. No program/session-less or module path
-- is ever permitted for Trainer insert — there is deliberately no branch
-- for them, matching materials_write_trainer's own table-level policy,
-- which has no program/module branch either. No update/delete for Trainer,
-- matching materials' own table policies (no materials_update_trainer /
-- materials_delete_trainer exists).

-- Pre-acceptance security review correction: the original policy used
-- split_part(name, '/', n) to read segments 1/2 but never checked how many
-- segments the name actually had — a 2-segment name ('batch/<id>', no
-- object suffix at all) or a 4+-segment name (an extra leading/trailing
-- segment, e.g. 'x/batch/<id>/y' or 'batch/<id>/y/z') would both still
-- satisfy segments 1/2 and be allowed, even though neither is a real
-- application-generated path (buildMaterialObjectPath,
-- lib/domain/materials.ts, always emits exactly 3 segments — the
-- sanitized filename segment can never itself contain '/', since
-- sanitizeFileNameForStorage replaces it with '_'). Corrected to
-- string_to_array(name, '/') with an explicit exact-3-segments check —
-- core PostgreSQL (not the Supabase-extension-only storage.foldername()
-- helper, and strictly more precise than plain split_part, which has no
-- segment-count check at all), portable to the plain-Postgres local test
-- stub (supabase/tests/auth_schema_stub.sql) this policy must also apply
-- against. Every segment comparison still casts the trusted DB column TO
-- text (never the untrusted path segment TO uuid), so a malformed/
-- truncated/non-UUID segment safely fails the comparison rather than
-- throwing a cast exception — see supabase/tests/phase15_materials_test.sql
-- for the full malformed-path test matrix (empty segment, non-UUID,
-- truncated UUID, extra leading/trailing segment, double slash, wrong
-- scope keyword, anonymous insertion).
create policy materials_bucket_insert_trainer on storage.objects
  for insert with check (
    bucket_id = 'materials'
    and array_length(string_to_array(name, '/'), 1) = 3
    and (string_to_array(name, '/'))[3] <> ''
    and (
      (
        (string_to_array(name, '/'))[1] = 'batch'
        and exists (
          select 1 from batch_trainers bt
          where bt.trainer_id = current_trainer_id()
            and bt.batch_id::text = (string_to_array(name, '/'))[2]
        )
      )
      or (
        (string_to_array(name, '/'))[1] = 'session'
        and exists (
          select 1 from class_sessions cs
          join batch_trainers bt on bt.batch_id = cs.batch_id
          where bt.trainer_id = current_trainer_id()
            and cs.id::text = (string_to_array(name, '/'))[2]
        )
      )
    )
  );

create policy materials_bucket_select_trainer on storage.objects
  for select using (
    bucket_id = 'materials'
    and exists (
      select 1 from materials m
      where m.file_path = storage.objects.name
        and (
          (m.batch_id is not null and exists (
            select 1 from batch_trainers bt
            where bt.batch_id = m.batch_id and bt.trainer_id = current_trainer_id()
          ))
          or (m.class_session_id is not null and exists (
            select 1 from class_sessions cs
            join batch_trainers bt on bt.batch_id = cs.batch_id
            where cs.id = m.class_session_id and bt.trainer_id = current_trainer_id()
          ))
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Student — read-only, scoped via the real materials row, mirroring
-- materials_select_student exactly (including the enrolled/active/on_hold/
-- completed status filter from 20260101000026 — never a looser rule at the
-- Storage layer than the table already enforces).

create policy materials_bucket_select_student on storage.objects
  for select using (
    bucket_id = 'materials'
    and exists (
      select 1 from materials m
      where m.file_path = storage.objects.name
        and (
          (m.program_id is not null and exists (
            select 1 from enrollments e
            where e.program_id = m.program_id
              and e.student_id = current_student_id()
              and e.status in ('enrolled', 'active', 'on_hold', 'completed')
          ))
          or (m.batch_id is not null and exists (
            select 1 from enrollments e
            where e.batch_id = m.batch_id
              and e.student_id = current_student_id()
              and e.status in ('enrolled', 'active', 'on_hold', 'completed')
          ))
          or (m.module_id is not null and exists (
            select 1 from program_modules pm
            join enrollments e on e.program_id = pm.program_id
            where pm.id = m.module_id
              and e.student_id = current_student_id()
              and e.status in ('enrolled', 'active', 'on_hold', 'completed')
          ))
          or (m.class_session_id is not null and exists (
            select 1 from class_sessions cs
            join enrollments e on e.batch_id = cs.batch_id
            where cs.id = m.class_session_id
              and e.student_id = current_student_id()
              and e.status in ('enrolled', 'active', 'on_hold', 'completed')
          ))
        )
    )
  );
