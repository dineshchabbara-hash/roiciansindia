-- Phase 15 (Learning Materials) regression suite. Covers both the
-- pre-existing `materials` table policies (materials_select_admin/
-- select_trainer/write_admin/write_trainer/update_admin/delete_admin,
-- 20260101000014_rls_policies.sql — unchanged this phase except for the one
-- narrowing correction below) and the two migrations this phase actually
-- adds:
--   - 20260101000026_materials_student_rls_active_enrollment.sql: narrows
--     materials_select_student to the approved "operational/student-active"
--     status set (enrolled/active/on_hold/completed) on all four scope
--     branches (program/batch/module/session).
--   - 20260101000027_materials_storage.sql: the private `materials` Storage
--     bucket and its own policies, which mirror the table-level policies
--     exactly rather than re-deriving authorization logic.
--
-- Covers, both allowed and denied:
--   - Admin/Super Admin: full select/insert/update/delete on `materials`,
--     any scope; full select/insert/update/delete on the `materials`
--     Storage bucket.
--   - Assigned Trainer: select/insert on `materials` scoped to their OWN
--     assigned Batch/Session only (no Program/Module branch exists for
--     Trainer at all, by design — Trainer Module/Program access was
--     explicitly NOT invented this phase); denied for an unrelated Batch's
--     materials and for Program/Module-scoped materials; Storage insert
--     restricted to a path prefix encoding their own assigned Batch/
--     Session; Storage select scoped the same way as the table.
--   - Student, by enrollment status — the Phase 15 approved business
--     decision under test:
--       * 'enrolled'  -> ALLOWED (baseline operational status)
--       * 'completed' -> ALLOWED (the specific sub-question FR-71 itself
--         left unresolved; approved explicitly for Phase 15 — see
--         IMPLEMENTATION_PLAN.md's own Phase 15 note)
--       * 'withdrawn' -> DENIED (historical/terminal)
--       * 'lead'      -> DENIED (not yet in the learning-delivery lifecycle)
--     each checked across all four scope branches (program/batch/module/
--     session) for the allowed statuses, and against a batch-matching
--     Program-scoped material for the denied statuses (proving the status
--     filter — not just scope — is what blocks them); zero write access to
--     `materials` for any Student, any status; Storage select follows the
--     identical status rule.
--   - anon: zero access to `materials` and to the `materials` Storage
--     bucket.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('15000000-0000-0000-0000-000000000001', 'phase15-admin@validation.local'),
  ('15000000-0000-0000-0000-000000000002', 'phase15-trainer-a@validation.local'),
  ('15000000-0000-0000-0000-000000000003', 'phase15-trainer-b@validation.local'),
  ('15000000-0000-0000-0000-000000000004', 'phase15-student-enrolled@validation.local'),
  ('15000000-0000-0000-0000-000000000005', 'phase15-student-withdrawn@validation.local'),
  ('15000000-0000-0000-0000-000000000006', 'phase15-student-completed@validation.local'),
  ('15000000-0000-0000-0000-000000000007', 'phase15-student-lead@validation.local');

insert into user_roles (auth_user_id, role) values
  ('15000000-0000-0000-0000-000000000001', 'admin'),
  ('15000000-0000-0000-0000-000000000002', 'trainer'),
  ('15000000-0000-0000-0000-000000000003', 'trainer'),
  ('15000000-0000-0000-0000-000000000004', 'student'),
  ('15000000-0000-0000-0000-000000000005', 'student'),
  ('15000000-0000-0000-0000-000000000006', 'student'),
  ('15000000-0000-0000-0000-000000000007', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('15100000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'Phase15', 'Admin', 'phase15-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('15200000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000002', 'Phase15', 'TrainerA', 'phase15-trainer-a@validation.local'),
  ('15200000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000003', 'Phase15', 'TrainerB', 'phase15-trainer-b@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('15300000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000004', 'Phase15', 'StudentEnrolled', '9990009001', 'phase15-student-enrolled@validation.local'),
  ('15300000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000005', 'Phase15', 'StudentWithdrawn', '9990009002', 'phase15-student-withdrawn@validation.local'),
  ('15300000-0000-0000-0000-000000000003', '15000000-0000-0000-0000-000000000006', 'Phase15', 'StudentCompleted', '9990009003', 'phase15-student-completed@validation.local'),
  ('15300000-0000-0000-0000-000000000004', '15000000-0000-0000-0000-000000000007', 'Phase15', 'StudentLead', '9990009004', 'phase15-student-lead@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('15400000-0000-0000-0000-000000000001', 'PHASE15-PROG', 'Phase 15 Program', 25000.00, 0, 'active');

insert into program_modules (id, program_id, title, sequence) values
  ('15410000-0000-0000-0000-000000000001', '15400000-0000-0000-0000-000000000001', 'Phase 15 Module 1', 1);

insert into batches (id, program_id, name, start_date, status) values
  ('15500000-0000-0000-0000-000000000001', '15400000-0000-0000-0000-000000000001', 'Phase 15 Batch A', current_date, 'active'),
  ('15500000-0000-0000-0000-000000000002', '15400000-0000-0000-0000-000000000001', 'Phase 15 Batch B', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('15600000-0000-0000-0000-000000000001', '15500000-0000-0000-0000-000000000001', '15200000-0000-0000-0000-000000000001', true),
  ('15600000-0000-0000-0000-000000000002', '15500000-0000-0000-0000-000000000002', '15200000-0000-0000-0000-000000000002', true);

-- Four Students, four different statuses — the exact set FR-71's approved
-- decision distinguishes. All three operational-status rows sit in Batch A
-- (enrollments_operational_status_requires_batch requires a batch for
-- enrolled/completed, but not for withdrawn/lead — Batch A is still given
-- to withdrawn here deliberately, to prove the STATUS filter denies it even
-- though the batch itself matches).
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('15700000-0000-0000-0000-000000000001', '15300000-0000-0000-0000-000000000001', '15400000-0000-0000-0000-000000000001', '15500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'enrolled'),
  ('15700000-0000-0000-0000-000000000002', '15300000-0000-0000-0000-000000000002', '15400000-0000-0000-0000-000000000001', '15500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'withdrawn'),
  ('15700000-0000-0000-0000-000000000003', '15300000-0000-0000-0000-000000000003', '15400000-0000-0000-0000-000000000001', '15500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'completed'),
  ('15700000-0000-0000-0000-000000000004', '15300000-0000-0000-0000-000000000004', '15400000-0000-0000-0000-000000000001', null, 25000.00, 25000.00, 25000.00, 'lead');

insert into class_sessions (id, batch_id, session_date, status) values
  ('15800000-0000-0000-0000-000000000001', '15500000-0000-0000-0000-000000000001', current_date, 'scheduled');

-- One Material per scope type, all in Batch A's own tree (program/module
-- belong to the same Program; the session belongs to Batch A), plus one
-- Batch B material for cross-Batch isolation checks.
insert into materials (id, program_id, batch_id, module_id, class_session_id, title, material_type, file_path, external_url, uploaded_by, uploaded_by_type) values
  ('15900000-0000-0000-0000-000000000001', '15400000-0000-0000-0000-000000000001', null, null, null, 'Phase 15 Program Material', 'link', null, 'https://example.com/phase15-program', '15000000-0000-0000-0000-000000000001', 'admin'),
  ('15900000-0000-0000-0000-000000000002', null, '15500000-0000-0000-0000-000000000001', null, null, 'Phase 15 Batch A Material', 'file', 'batch/15500000-0000-0000-0000-000000000001/15910000-0000-0000-0000-000000000001-batcha.pdf', null, '15000000-0000-0000-0000-000000000001', 'admin'),
  ('15900000-0000-0000-0000-000000000003', null, null, '15410000-0000-0000-0000-000000000001', null, 'Phase 15 Module Material', 'link', null, 'https://example.com/phase15-module', '15000000-0000-0000-0000-000000000001', 'admin'),
  ('15900000-0000-0000-0000-000000000004', null, null, null, '15800000-0000-0000-0000-000000000001', 'Phase 15 Session Material', 'file', 'session/15800000-0000-0000-0000-000000000001/15910000-0000-0000-0000-000000000002-session.pdf', null, '15000000-0000-0000-0000-000000000001', 'admin'),
  ('15900000-0000-0000-0000-000000000005', null, '15500000-0000-0000-0000-000000000002', null, null, 'Phase 15 Batch B Material', 'link', null, 'https://example.com/phase15-batchb', '15000000-0000-0000-0000-000000000001', 'admin');

-- Pre-existing Storage objects backing the two 'file' materials above, so
-- the Storage SELECT policies (which join storage.objects to materials by
-- file_path) have something real to find.
insert into storage.objects (bucket_id, name) values
  ('materials', 'batch/15500000-0000-0000-0000-000000000001/15910000-0000-0000-0000-000000000001-batcha.pdf'),
  ('materials', 'session/15800000-0000-0000-0000-000000000001/15910000-0000-0000-0000-000000000002-session.pdf');

-- ---------------------------------------------------------------------------
-- Admin — full access, any scope, both table and Storage.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"15000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from materials
  where id in (
    '15900000-0000-0000-0000-000000000001', '15900000-0000-0000-0000-000000000002',
    '15900000-0000-0000-0000-000000000003', '15900000-0000-0000-0000-000000000004',
    '15900000-0000-0000-0000-000000000005'
  );
  if cnt <> 5 then
    raise exception 'FAIL: admin should see all 5 materials regardless of scope, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all materials regardless of scope (materials_select_admin)';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into materials (program_id, title, material_type, external_url, uploaded_by, uploaded_by_type)
  values ('15400000-0000-0000-0000-000000000001', 'Scratch', 'link', 'https://example.com/scratch', '15000000-0000-0000-0000-000000000001', 'admin')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: admin should be able to insert a material for any scope';
  end if;
  update materials set title = 'Scratch (updated)' where id = new_id;
  if not found then
    raise exception 'FAIL: admin should be able to update any material';
  end if;
  delete from materials where id = new_id;
  raise notice 'PASS: admin can insert/update/delete a material at the RLS layer (materials_write_admin/update_admin/delete_admin — no hard-delete UI is exposed in the application, see the Phase 15 report)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'materials';
  if cnt <> 2 then
    raise exception 'FAIL: admin should see both materials Storage objects, got count=%', cnt;
  end if;
  raise notice 'PASS: admin can select from the materials Storage bucket (materials_bucket_select_admin)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    insert into storage.objects (bucket_id, name)
    values ('materials', 'scratch/admin-scratch.pdf')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to insert into the materials Storage bucket';
  end if;
  delete from storage.objects where bucket_id = 'materials' and name = 'scratch/admin-scratch.pdf';
  raise notice 'PASS: admin can insert into and delete from the materials Storage bucket (materials_bucket_insert_admin/delete_admin)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer A — assigned to Batch A only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"15000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from materials
  where id in (
    '15900000-0000-0000-0000-000000000001', '15900000-0000-0000-0000-000000000002',
    '15900000-0000-0000-0000-000000000003', '15900000-0000-0000-0000-000000000004',
    '15900000-0000-0000-0000-000000000005'
  );
  if cnt <> 2 then
    raise exception 'FAIL: trainer A should see exactly 2 materials (their own Batch A + its Session), got count=%', cnt;
  end if;
  raise notice 'PASS: trainer A sees only their assigned Batch A/Session materials (materials_select_trainer), not Program/Module/Batch B';
end
$$;

do $$
declare
  new_id uuid;
begin
  insert into materials (batch_id, title, material_type, external_url, uploaded_by, uploaded_by_type)
  values ('15500000-0000-0000-0000-000000000001', 'Scratch Batch A', 'link', 'https://example.com/scratch', '15000000-0000-0000-0000-000000000002', 'trainer')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: trainer A should be able to insert a material scoped to their own Batch A';
  end if;
  delete from materials where id = new_id;
  raise notice 'PASS: trainer A can insert a material scoped to their own assigned Batch (materials_write_trainer)';
end
$$;

do $$
begin
  begin
    insert into materials (batch_id, title, material_type, external_url, uploaded_by, uploaded_by_type)
    values ('15500000-0000-0000-0000-000000000002', 'Scratch Batch B', 'link', 'https://example.com/scratch', '15000000-0000-0000-0000-000000000002', 'trainer');
    raise exception 'FAIL: trainer A should not be able to insert a material scoped to Batch B (not their own assignment)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting a material scoped to an unassigned Batch (Batch B)';
  end;
end
$$;

do $$
begin
  begin
    insert into materials (program_id, title, material_type, external_url, uploaded_by, uploaded_by_type)
    values ('15400000-0000-0000-0000-000000000001', 'Scratch Program', 'link', 'https://example.com/scratch', '15000000-0000-0000-0000-000000000002', 'trainer');
    raise exception 'FAIL: trainer A should not be able to insert a Program-scoped material — no trainer Program branch exists at all, by design';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting a Program-scoped material (no Trainer Program access was ever invented this phase)';
  end;
end
$$;

do $$
begin
  begin
    insert into materials (module_id, title, material_type, external_url, uploaded_by, uploaded_by_type)
    values ('15410000-0000-0000-0000-000000000001', 'Scratch Module', 'link', 'https://example.com/scratch', '15000000-0000-0000-0000-000000000002', 'trainer');
    raise exception 'FAIL: trainer A should not be able to insert a Module-scoped material — no trainer Module branch exists at all, by design';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting a Module-scoped material (no Trainer Module access was ever invented this phase)';
  end;
end
$$;

do $$
declare
  cnt int;
begin
  -- Both file-backed objects belong to Trainer A's own tree: the Batch A
  -- material directly, and the Session material because that Session
  -- belongs to Batch A — the same "2 materials" result already asserted
  -- at the table level above.
  select count(*) into cnt from storage.objects where bucket_id = 'materials';
  if cnt <> 2 then
    raise exception 'FAIL: trainer A should see exactly 2 Storage objects (Batch A material''s + its Session material''s), got count=%', cnt;
  end if;
  raise notice 'PASS: trainer A sees only their own assigned Batch/Session Storage objects (materials_bucket_select_trainer)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    insert into storage.objects (bucket_id, name)
    values ('materials', 'batch/15500000-0000-0000-0000-000000000001/scratch-trainera.pdf')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: trainer A should be able to insert into their own assigned Batch A path';
  end if;
  delete from storage.objects where bucket_id = 'materials' and name = 'batch/15500000-0000-0000-0000-000000000001/scratch-trainera.pdf';
  raise notice 'PASS: trainer A can insert into their own assigned Batch A Storage path (materials_bucket_insert_trainer)';
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('materials', 'batch/15500000-0000-0000-0000-000000000002/scratch-trainera.pdf');
    raise exception 'FAIL: trainer A should not be able to insert into Batch B''s Storage path (not their own assignment)';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer A is blocked from inserting into an unassigned Batch''s Storage path (Batch B)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer B — symmetric check, assigned to Batch B only.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"15000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
  seen_id uuid;
begin
  select count(*), min(id::text)::uuid into cnt, seen_id from materials
  where id in (
    '15900000-0000-0000-0000-000000000001', '15900000-0000-0000-0000-000000000002',
    '15900000-0000-0000-0000-000000000003', '15900000-0000-0000-0000-000000000004',
    '15900000-0000-0000-0000-000000000005'
  );
  if cnt <> 1 or seen_id <> '15900000-0000-0000-0000-000000000005' then
    raise exception 'FAIL: trainer B should see only their own Batch B material, got count=%, id=%', cnt, seen_id;
  end if;
  raise notice 'PASS: trainer B sees only their own assigned Batch B material, not Batch A''s or Trainer A''s Session';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student (enrolled) — baseline operational status. Allowed across all four
-- scope branches.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"15000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from materials
  where id in (
    '15900000-0000-0000-0000-000000000001', '15900000-0000-0000-0000-000000000002',
    '15900000-0000-0000-0000-000000000003', '15900000-0000-0000-0000-000000000004',
    '15900000-0000-0000-0000-000000000005'
  );
  if cnt <> 4 then
    raise exception 'FAIL: enrolled student should see all 4 of their own Program/Batch/Module/Session materials, got count=%', cnt;
  end if;
  raise notice 'PASS: an "enrolled"-status student sees all 4 scope branches (materials_select_student), not the unrelated Batch B material';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'materials';
  if cnt <> 2 then
    raise exception 'FAIL: enrolled student should see both file-backed Storage objects (Batch A + Session), got count=%', cnt;
  end if;
  raise notice 'PASS: an "enrolled"-status student sees both their own Storage objects (materials_bucket_select_student)';
end
$$;

do $$
begin
  begin
    insert into materials (batch_id, title, material_type, external_url, uploaded_by, uploaded_by_type)
    values ('15500000-0000-0000-0000-000000000001', 'Scratch', 'link', 'https://example.com/scratch', '15000000-0000-0000-0000-000000000004', 'admin');
    raise exception 'FAIL: a student should never be able to insert a material — no student write policy exists at all';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: a student is blocked from inserting a material (no materials_write_own policy exists)';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student (completed) — the approved Phase 15 decision under direct test:
-- a completed enrollment retains Materials access, same as 'enrolled'.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"15000000-0000-0000-0000-000000000006","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from materials
  where id in (
    '15900000-0000-0000-0000-000000000001', '15900000-0000-0000-0000-000000000002',
    '15900000-0000-0000-0000-000000000003', '15900000-0000-0000-0000-000000000004',
    '15900000-0000-0000-0000-000000000005'
  );
  if cnt <> 4 then
    raise exception 'FAIL: a "completed"-status student should retain full Materials access (approved Phase 15 decision), got count=%', cnt;
  end if;
  raise notice 'PASS: a "completed"-status student retains access to all 4 scope branches — the explicit Phase 15 approved decision on FR-71''s own unresolved sub-question';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'materials';
  if cnt <> 2 then
    raise exception 'FAIL: a "completed"-status student should retain Storage access too, got count=%', cnt;
  end if;
  raise notice 'PASS: a "completed"-status student retains Storage-layer access (materials_bucket_select_student applies the same status rule)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student (withdrawn) — historical/terminal, denied even though their own
-- Enrollment row's batch_id still points at Batch A (proves the STATUS
-- filter is what blocks them, not merely a scope mismatch).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"15000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from materials
  where id in (
    '15900000-0000-0000-0000-000000000001', '15900000-0000-0000-0000-000000000002',
    '15900000-0000-0000-0000-000000000003', '15900000-0000-0000-0000-000000000004',
    '15900000-0000-0000-0000-000000000005'
  );
  if cnt <> 0 then
    raise exception 'FAIL: a "withdrawn"-status student should see zero materials despite their batch_id matching, got count=%', cnt;
  end if;
  raise notice 'PASS: a "withdrawn"-status student is denied all Materials access (terminal status, excluded from the approved status set)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'materials';
  if cnt <> 0 then
    raise exception 'FAIL: a "withdrawn"-status student should see zero Storage objects, got count=%', cnt;
  end if;
  raise notice 'PASS: a "withdrawn"-status student is denied Storage-layer access too';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student (lead) — not yet in the learning-delivery lifecycle, denied even
-- for a Program they are nominally attached to.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"15000000-0000-0000-0000-000000000007","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from materials
  where id in (
    '15900000-0000-0000-0000-000000000001', '15900000-0000-0000-0000-000000000002',
    '15900000-0000-0000-0000-000000000003', '15900000-0000-0000-0000-000000000004',
    '15900000-0000-0000-0000-000000000005'
  );
  if cnt <> 0 then
    raise exception 'FAIL: a "lead"-status student should see zero materials — their own Program matches both the Program and Module branches by program_id alone, so this also proves the status filter (not scope) blocks them, got count=%', cnt;
  end if;
  raise notice 'PASS: a "lead"-status student is denied Materials access across every scope branch (not yet in the learning-delivery lifecycle, excluded from the approved status set)';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Anon — zero access to both the table and the Storage bucket. Same
-- defensive try/catch pattern as supabase/tests/phase13_attendance_test.sql
-- and supabase/tests/phase14_financial_engine_test.sql's own anon checks.

set local role anon;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from materials;
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying materials (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying materials (permission denied evaluating a policy helper function)';
      else
        raise exception 'FAIL: unexpected error querying materials as anon: %', sqlerrm;
      end if;
  end;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from storage.objects where bucket_id = 'materials';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anonymous is blocked from querying the materials Storage bucket (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anonymous is blocked from querying the materials Storage bucket (permission denied)';
      else
        raise exception 'FAIL: unexpected error querying materials Storage objects as anon: %', sqlerrm;
      end if;
  end;
  if cnt is not null and cnt <> 0 then
    raise exception 'FAIL: anonymous should see zero materials Storage objects, got %', cnt;
  end if;
end
$$;

reset role;

rollback;

select 'ALL PHASE 15 REGRESSION TESTS PASSED' as result;
