-- Phase 17 (Certificates) regression suite. Covers the pre-existing
-- `certificates` table policies (added ahead of schedule in Phase 2,
-- 20260101000014_rls_policies.sql — unchanged this phase) and the three
-- migrations this phase actually adds:
--   - 20260101000031_certificate_number_generation.sql: generate_certificate_
--     number(), Admin/Super Admin only (self-checked inside the function
--     body), also wired as the certificate_number column DEFAULT.
--   - 20260101000032_certificates_storage.sql: the private `certificates`
--     Storage bucket and its own policies (Admin full, Student own-only
--     select, no anon policy of any kind).
--   - 20260101000033_reissue_certificate_function.sql: reissue_certificate(),
--     the atomic insert-new-row + revoke-original operation, Admin/Super
--     Admin only.
--
-- Eligibility (enrollment.status='completed' AND program.
-- certificate_eligible AND outstanding balance = 0) is pure application
-- logic (lib/domain/certificates.ts's resolveCertificateEligibility,
-- covered by its own Vitest unit tests including the 5 required A-E
-- cases) — no RLS policy or DB trigger enforces it, so this SQL suite
-- does not seed payment/balance data at all; it proves WHO can read/write
-- a `certificates` row regardless of its eligibility, which is the actual
-- RLS/DB-layer responsibility.
--
-- Covers, both allowed and denied:
--   - Admin/Super Admin: full select/insert/update on certificates, any
--     Student; immutable fields (certificate_number, enrollment_id/
--     student_id/program_id, completion_date/issue_date, pdf_path) blocked
--     from change even for Admin (prevent_certificate_immutable_fields_
--     change trigger); NO delete policy exists for anyone at all — proven
--     as a 0-row no-op, not an exception, matching "no hard-delete
--     certificate UI ever" at the DB layer too; full select/insert/update/
--     delete on the certificates Storage bucket.
--   - generate_certificate_number(): Admin gets a real, unique, sequential-
--     suffix value; a non-admin authenticated caller (Student/Trainer) is
--     denied by the function's own internal is_admin_or_super() check;
--     anon is denied at the GRANT level entirely (EXECUTE was revoked from
--     anon/public, never re-granted).
--   - reissue_certificate(): Admin can atomically replace a currently-
--     issued certificate (new row inserted, original flips to revoked,
--     history preserved); reissuing an already-revoked or nonexistent
--     certificate raises; non-admin/anon denied the same way as
--     generate_certificate_number().
--   - Student: select own certificates only (cross-student denied); zero
--     insert access (no student insert policy — raises, since the only
--     insert policy's WITH CHECK requires is_admin_or_super()); zero
--     update access (no student update policy at all — a 0-row no-op, not
--     an exception, since there is no USING clause for Student to even
--     match); Storage select scoped to their own certificate's real
--     pdf_path only, zero Storage insert/update/delete.
--   - Trainer: zero access to the certificates table or Storage bucket at
--     all (no trainer policy of any kind exists) — not an authorization
--     error, simply 0 rows visible regardless of how many real rows exist.
--   - anon: zero table access, zero Storage access. The public
--     /verify-certificate page never queries through anon's own RLS-scoped
--     session at all — it uses the service-role client
--     (lib/supabase/admin.ts) with an explicit minimal column allow-list
--     at the APPLICATION layer (never select('*')); this suite proves
--     service_role's BYPASSRLS can read the table (so that mechanism is
--     actually possible) and separately proves anon itself has none of
--     that access — the minimal-column discipline itself is an
--     application-layer contract, not something a self-contained SQL
--     fixture can re-verify.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('17000000-0000-0000-0000-000000000001', 'phase17-admin@validation.local'),
  ('17000000-0000-0000-0000-000000000002', 'phase17-trainer@validation.local'),
  ('17000000-0000-0000-0000-000000000003', 'phase17-student-x@validation.local'),
  ('17000000-0000-0000-0000-000000000004', 'phase17-student-y@validation.local');

insert into user_roles (auth_user_id, role) values
  ('17000000-0000-0000-0000-000000000001', 'admin'),
  ('17000000-0000-0000-0000-000000000002', 'trainer'),
  ('17000000-0000-0000-0000-000000000003', 'student'),
  ('17000000-0000-0000-0000-000000000004', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('17100000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'Phase17', 'Admin', 'phase17-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('17200000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002', 'Phase17', 'Trainer', 'phase17-trainer@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('17300000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000003', 'Phase17', 'StudentX', '9990017001', 'phase17-student-x@validation.local'),
  ('17300000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000004', 'Phase17', 'StudentY', '9990017002', 'phase17-student-y@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status, certificate_eligible) values
  ('17400000-0000-0000-0000-000000000001', 'PHASE17-PROG', 'Phase 17 Program', 25000.00, 0, 'active', true);

insert into batches (id, program_id, name, start_date, status) values
  ('17500000-0000-0000-0000-000000000001', '17400000-0000-0000-0000-000000000001', 'Phase 17 Batch', current_date, 'active');

insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('17700000-0000-0000-0000-000000000001', '17300000-0000-0000-0000-000000000001', '17400000-0000-0000-0000-000000000001', '17500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'completed'),
  ('17700000-0000-0000-0000-000000000002', '17300000-0000-0000-0000-000000000002', '17400000-0000-0000-0000-000000000001', '17500000-0000-0000-0000-000000000001', 25000.00, 25000.00, 25000.00, 'completed');

-- One pre-existing issued certificate per Student, each against their OWN
-- enrollment — the legitimate baseline every cross-student test below
-- attempts to read or write around. A third, already-revoked certificate
-- (for Student X) proves revoked rows stay permanently visible/queryable,
-- never hard-deleted.
insert into certificates (id, certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, status, pdf_path) values
  ('17900000-0000-0000-0000-000000000001', 'PHASE17-CERT-X1', '17700000-0000-0000-0000-000000000001', '17300000-0000-0000-0000-000000000001', '17400000-0000-0000-0000-000000000001', current_date, current_date, 'issued', '17300000-0000-0000-0000-000000000001/PHASE17-CERT-X1.pdf'),
  ('17900000-0000-0000-0000-000000000002', 'PHASE17-CERT-Y1', '17700000-0000-0000-0000-000000000002', '17300000-0000-0000-0000-000000000002', '17400000-0000-0000-0000-000000000001', current_date, current_date, 'issued', '17300000-0000-0000-0000-000000000002/PHASE17-CERT-Y1.pdf'),
  ('17900000-0000-0000-0000-000000000003', 'PHASE17-CERT-X0', '17700000-0000-0000-0000-000000000001', '17300000-0000-0000-0000-000000000001', '17400000-0000-0000-0000-000000000001', current_date - 30, current_date - 30, 'revoked', '17300000-0000-0000-0000-000000000001/PHASE17-CERT-X0.pdf');

update certificates set revoked_reason = 'Superseded', revoked_at = now() - interval '1 day'
  where id = '17900000-0000-0000-0000-000000000003';

insert into storage.objects (bucket_id, name) values
  ('certificates', '17300000-0000-0000-0000-000000000001/PHASE17-CERT-X1.pdf'),
  ('certificates', '17300000-0000-0000-0000-000000000002/PHASE17-CERT-Y1.pdf'),
  ('certificates', '17300000-0000-0000-0000-000000000001/PHASE17-CERT-X0.pdf');

-- ---------------------------------------------------------------------------
-- Admin — full access, any Student.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"17000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from certificates
  where id in (
    '17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-000000000002',
    '17900000-0000-0000-0000-000000000003'
  );
  if cnt <> 3 then
    raise exception 'FAIL: admin should see all 3 certificates regardless of student, got count=%', cnt;
  end if;
  raise notice 'PASS: admin sees all certificates regardless of student (certificates_select_admin)';
end
$$;

do $$
declare
  minted_1 text;
  minted_2 text;
  new_id uuid;
begin
  select generate_certificate_number() into minted_1;
  select generate_certificate_number() into minted_2;
  if minted_1 is null or minted_2 is null or minted_1 = minted_2 then
    raise exception 'FAIL: generate_certificate_number() should return a real, unique value each call, got % and %', minted_1, minted_2;
  end if;
  raise notice 'PASS: admin can call generate_certificate_number() and gets distinct values (%, %)', minted_1, minted_2;

  insert into certificates (certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, pdf_path)
  values (minted_1, '17700000-0000-0000-0000-000000000001', '17300000-0000-0000-0000-000000000001', '17400000-0000-0000-0000-000000000001', current_date, current_date, '17300000-0000-0000-0000-000000000001/' || minted_1 || '.pdf')
  returning id into new_id;
  if new_id is null then
    raise exception 'FAIL: admin should be able to insert a certificate';
  end if;

  update certificates set status = 'revoked', revoked_reason = 'scratch cleanup', revoked_at = now() where id = new_id;
  if not found then
    raise exception 'FAIL: admin should be able to update status/revoked_reason/revoked_at on a certificate';
  end if;
  raise notice 'PASS: admin can insert a certificate (with a freshly minted number) and update its status/revoked_reason/revoked_at (certificates_write_admin/_update_admin)';
end
$$;

do $$
begin
  begin
    update certificates set certificate_number = 'TAMPERED' where id = '17900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: admin should NOT be able to change certificate_number after creation';
  exception
    when others then
      raise notice 'PASS: certificate_number is immutable even for admin (prevent_certificate_immutable_fields_change)';
  end;

  begin
    update certificates set pdf_path = 'tampered/path.pdf' where id = '17900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: admin should NOT be able to change pdf_path after creation';
  exception
    when others then
      raise notice 'PASS: pdf_path is immutable even for admin (prevent_certificate_immutable_fields_change)';
  end;

  begin
    update certificates set student_id = '17300000-0000-0000-0000-000000000002' where id = '17900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: admin should NOT be able to reassign student_id after creation';
  exception
    when others then
      raise notice 'PASS: student_id/enrollment_id/program_id are immutable even for admin (prevent_certificate_immutable_fields_change)';
  end;

  begin
    update certificates set completion_date = current_date - 1 where id = '17900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: admin should NOT be able to change completion_date after creation';
  exception
    when others then
      raise notice 'PASS: completion_date/issue_date are immutable even for admin (prevent_certificate_immutable_fields_change)';
  end;
end
$$;

do $$
declare
  row_count int;
begin
  delete from certificates where id = '17900000-0000-0000-0000-000000000002';
  get diagnostics row_count = row_count;
  if row_count <> 0 then
    raise exception 'FAIL: no certificates_delete_* policy exists for ANY role, including admin — delete should be a 0-row no-op, got % rows deleted', row_count;
  end if;
  raise notice 'PASS: certificates can never be hard-deleted at the RLS layer, not even by admin (no delete policy exists at all)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'certificates';
  if cnt <> 3 then
    raise exception 'FAIL: admin should see all 3 Storage objects in the certificates bucket, got count=%', cnt;
  end if;
  raise notice 'PASS: admin can select from the certificates Storage bucket (certificates_bucket_select_admin)';
end
$$;

do $$
declare
  affected int;
begin
  with attempt as (
    insert into storage.objects (bucket_id, name) values ('certificates', 'scratch/admin-scratch.pdf')
    returning 1
  )
  select count(*) into affected from attempt;
  if affected <> 1 then
    raise exception 'FAIL: admin should be able to insert into the certificates bucket';
  end if;
  delete from storage.objects where bucket_id = 'certificates' and name = 'scratch/admin-scratch.pdf';
  raise notice 'PASS: admin can insert into and delete from the certificates Storage bucket (…_insert_admin/_delete_admin)';
end
$$;

-- ---------------------------------------------------------------------------
-- reissue_certificate() — atomic replace, admin only.

do $$
declare
  new_id uuid;
  minted text;
  original_status text;
  new_row_enrollment uuid;
  new_row_student uuid;
  new_row_completion date;
begin
  select generate_certificate_number() into minted;
  select reissue_certificate(
    '17900000-0000-0000-0000-000000000001', minted,
    '17300000-0000-0000-0000-000000000001/' || minted || '.pdf', 'Corrected spelling'
  ) into new_id;

  if new_id is null then
    raise exception 'FAIL: reissue_certificate should return the new row''s id';
  end if;

  select status into original_status from certificates where id = '17900000-0000-0000-0000-000000000001';
  if original_status <> 'revoked' then
    raise exception 'FAIL: the original certificate should now be revoked, got status=%', original_status;
  end if;

  select enrollment_id, student_id, completion_date into new_row_enrollment, new_row_student, new_row_completion
  from certificates where id = new_id;
  if new_row_enrollment <> '17700000-0000-0000-0000-000000000001' or new_row_student <> '17300000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: the reissued certificate should carry over the same enrollment_id/student_id';
  end if;
  if new_row_completion <> current_date then
    raise exception 'FAIL: the reissued certificate should carry over the original completion_date';
  end if;

  raise notice 'PASS: reissue_certificate() atomically inserts a new certificate and revokes the original, preserving enrollment/student/completion_date history';
end
$$;

do $$
begin
  begin
    perform reissue_certificate('17900000-0000-0000-0000-000000000003', 'SHOULD-NOT-EXIST', 'x/SHOULD-NOT-EXIST.pdf', null);
    raise exception 'FAIL: reissuing an already-revoked certificate should raise';
  exception
    when others then
      raise notice 'PASS: reissue_certificate() refuses to reissue a certificate that is not currently issued';
  end;

  begin
    perform reissue_certificate('00000000-0000-0000-0000-000000000000', 'SHOULD-NOT-EXIST-2', 'x/SHOULD-NOT-EXIST-2.pdf', null);
    raise exception 'FAIL: reissuing a nonexistent certificate should raise';
  exception
    when others then
      raise notice 'PASS: reissue_certificate() refuses a nonexistent original certificate id';
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Trainer — zero access to certificates at all (no trainer policy of any
-- kind exists on the table or the Storage bucket).

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"17000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from certificates;
  if cnt <> 0 then
    raise exception 'FAIL: trainer should see zero certificates, got count=%', cnt;
  end if;
  raise notice 'PASS: trainer has zero select access to certificates (no trainer policy exists)';
end
$$;

do $$
declare
  row_count int;
begin
  begin
    insert into certificates (certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, pdf_path)
    values ('PHASE17-TRAINER-ATTEMPT', '17700000-0000-0000-0000-000000000001', '17300000-0000-0000-0000-000000000001', '17400000-0000-0000-0000-000000000001', current_date, current_date, 'x/trainer-attempt.pdf');
    raise exception 'FAIL: trainer should not be able to insert a certificate';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: trainer cannot insert a certificate (no trainer insert policy — WITH CHECK requires is_admin_or_super())';
  end;

  update certificates set revoked_reason = 'trainer attempt' where id = '17900000-0000-0000-0000-000000000001';
  get diagnostics row_count = row_count;
  if row_count <> 0 then
    raise exception 'FAIL: trainer should not be able to update any certificate, affected % rows', row_count;
  end if;
  raise notice 'PASS: trainer cannot update a certificate (no trainer update policy at all — 0-row no-op)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'certificates';
  if cnt <> 0 then
    raise exception 'FAIL: trainer should see zero objects in the certificates bucket, got count=%', cnt;
  end if;
  raise notice 'PASS: trainer has zero Storage access to the certificates bucket';
end
$$;

do $$
begin
  perform generate_certificate_number();
  raise exception 'FAIL: trainer should not be able to generate a certificate number';
exception
  when others then
    raise notice 'PASS: trainer is denied by generate_certificate_number()''s own is_admin_or_super() check';
end
$$;

do $$
begin
  perform reissue_certificate('17900000-0000-0000-0000-000000000001', 'X', 'x/x.pdf', null);
  raise exception 'FAIL: trainer should not be able to call reissue_certificate()';
exception
  when others then
    raise notice 'PASS: trainer is denied by reissue_certificate()''s own is_admin_or_super() check';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Student X — select own certificates only; zero write access.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"17000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
  other_cnt int;
begin
  -- Scoped to the two original fixture ids by exact id (not an unscoped
  -- count by student_id) — the earlier Admin-section tests above also
  -- inserted/reissued additional certificates against this same student's
  -- enrollment, which a blanket count would otherwise pick up too (same
  -- "scope to exact ids" discipline Phase 16's own test suite settled on).
  select count(*) into cnt from certificates
  where id in ('17900000-0000-0000-0000-000000000001', '17900000-0000-0000-0000-000000000003');
  if cnt <> 2 then
    raise exception 'FAIL: student X should see both of their own original certificates (issued + revoked), got count=%', cnt;
  end if;

  select count(*) into other_cnt from certificates where student_id = '17300000-0000-0000-0000-000000000002';
  if other_cnt <> 0 then
    raise exception 'FAIL: student X should see zero of student Y''s certificates, got count=%', other_cnt;
  end if;
  raise notice 'PASS: student sees own certificates (issued and revoked both) and zero of another student''s (certificates_select_own)';
end
$$;

do $$
declare
  row_count int;
begin
  begin
    insert into certificates (certificate_number, enrollment_id, student_id, program_id, completion_date, issue_date, pdf_path)
    values ('PHASE17-STUDENT-ATTEMPT', '17700000-0000-0000-0000-000000000001', '17300000-0000-0000-0000-000000000001', '17400000-0000-0000-0000-000000000001', current_date, current_date, 'x/student-attempt.pdf');
    raise exception 'FAIL: student should not be able to insert their own certificate';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student cannot self-issue a certificate (no student insert policy — WITH CHECK requires is_admin_or_super())';
  end;

  update certificates set revoked_reason = 'student self-edit attempt' where id = '17900000-0000-0000-0000-000000000001';
  get diagnostics row_count = row_count;
  if row_count <> 0 then
    raise exception 'FAIL: student should not be able to update even their own certificate, affected % rows', row_count;
  end if;
  raise notice 'PASS: student cannot update even their own certificate (no student update policy at all — 0-row no-op)';
end
$$;

do $$
declare
  row_count int;
begin
  delete from certificates where id = '17900000-0000-0000-0000-000000000001';
  get diagnostics row_count = row_count;
  if row_count <> 0 then
    raise exception 'FAIL: student should not be able to delete their own certificate, affected % rows', row_count;
  end if;
  raise notice 'PASS: student cannot delete even their own certificate (no delete policy exists for any role)';
end
$$;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from storage.objects
  where bucket_id = 'certificates' and name = '17300000-0000-0000-0000-000000000001/PHASE17-CERT-X1.pdf';
  if cnt <> 1 then
    raise exception 'FAIL: student X should be able to select their own certificate''s Storage object';
  end if;

  select count(*) into cnt from storage.objects
  where bucket_id = 'certificates' and name = '17300000-0000-0000-0000-000000000002/PHASE17-CERT-Y1.pdf';
  if cnt <> 0 then
    raise exception 'FAIL: student X should NOT be able to select student Y''s certificate Storage object';
  end if;
  raise notice 'PASS: student can select only their own certificate''s Storage object, scoped via the real certificates row (certificates_bucket_select_own)';
end
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values ('certificates', 'scratch/student-attempt.pdf');
    raise exception 'FAIL: student should not be able to insert into the certificates bucket';
  exception
    when insufficient_privilege or others then
      raise notice 'PASS: student cannot insert into the certificates Storage bucket (no student insert policy)';
  end;
end
$$;

do $$
begin
  perform generate_certificate_number();
  raise exception 'FAIL: student should not be able to generate a certificate number';
exception
  when others then
    raise notice 'PASS: student is denied by generate_certificate_number()''s own is_admin_or_super() check';
end
$$;

do $$
begin
  perform reissue_certificate('17900000-0000-0000-0000-000000000001', 'X', 'x/x.pdf', null);
  raise exception 'FAIL: student should not be able to call reissue_certificate()';
exception
  when others then
    raise notice 'PASS: student is denied by reissue_certificate()''s own is_admin_or_super() check';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- anon — zero table access, zero Storage access, zero function access.

set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from certificates;
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon is blocked from querying certificates (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anon is blocked from querying certificates (permission denied evaluating a policy helper function — current_student_id() has no anon grant)';
      else
        raise exception 'FAIL: unexpected error querying certificates as anon: %', sqlerrm;
      end if;
  end;
  if cnt is not null and cnt <> 0 then
    raise exception 'FAIL: anon should see zero certificates, got %', cnt;
  end if;
end
$$;

do $$
declare
  cnt int;
begin
  begin
    select count(*) into cnt from storage.objects where bucket_id = 'certificates';
  exception
    when insufficient_privilege then
      raise notice 'PASS: anon is blocked from querying the certificates Storage bucket (insufficient_privilege)';
    when others then
      if sqlerrm like '%permission denied%' then
        raise notice 'PASS: anon is blocked from querying the certificates Storage bucket (permission denied evaluating a policy helper function)';
      else
        raise exception 'FAIL: unexpected error querying certificates Storage objects as anon: %', sqlerrm;
      end if;
  end;
  if cnt is not null and cnt <> 0 then
    raise exception 'FAIL: anon should see zero Storage objects in the certificates bucket, got %', cnt;
  end if;
end
$$;

do $$
begin
  perform generate_certificate_number();
  raise exception 'FAIL: anon should not even be able to call generate_certificate_number()';
exception
  when insufficient_privilege or others then
    raise notice 'PASS: anon is denied EXECUTE on generate_certificate_number() at the grant level (revoked from public/anon/authenticated, re-granted only to authenticated)';
end
$$;

do $$
begin
  perform reissue_certificate('17900000-0000-0000-0000-000000000001', 'X', 'x/x.pdf', null);
  raise exception 'FAIL: anon should not even be able to call reissue_certificate()';
exception
  when insufficient_privilege or others then
    raise notice 'PASS: anon is denied EXECUTE on reissue_certificate() at the grant level';
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- service_role (BYPASSRLS) — the mechanism lib/supabase/admin.ts's
-- createSupabaseAdminClient() and the public /verify-certificate flow rely
-- on. Proves the bypass itself is real and available; the minimal-column
-- selection discipline is enforced at the application layer
-- (lib/data/certificates.ts's verifyCertificatePublic never selects('*')),
-- which this fixture cannot re-verify on its own.

set local role service_role;

do $$
declare
  cnt int;
begin
  select count(*) into cnt from certificates;
  if cnt < 3 then
    raise exception 'FAIL: service_role should see all certificates regardless of RLS, got count=%', cnt;
  end if;
  raise notice 'PASS: service_role (BYPASSRLS) can read certificates regardless of table RLS — the mechanism the public verification flow and admin client rely on';
end
$$;

reset role;

rollback;
