-- Phase 21A (Receipts & Payment Documents) regression suite for
-- 20260101000037_receipts_issuance.sql:
--
--   - issue_receipt / next_receipt_number are service_role only; receipts
--     has SELECT policies only; the receipts bucket is private with SELECT
--     policies only; end-user roles cannot touch receipt_number_seq.
--   - issue_receipt: a paid offline payment and a paid Razorpay payment
--     each get exactly one receipt of the same shape (REC-{IST year}-
--     NNNNNN, path {student}/{receipt}.pdf) and one receipt.issued audit
--     row; a repeat call returns the same receipt without consuming a
--     number; pending / authorized (held) / failed / cancelled payments
--     and unknown ids are refused without consuming a number.
--   - Numbering: one global sequence, never reset, gaps allowed; the
--     configured format is honoured and a format without {seq:N} falls
--     back to the default.
--   - Immutability: receipt_number, payment_id, pdf_path, created_at are
--     frozen; pdf_generated_at is set once; a receipt for a non-paid
--     payment cannot be inserted by any writer.
--   - RLS: Admin reads all receipts and objects; a Student reads only own;
--     Trainer and anon read nothing; nobody but the server writes.
--   - Phase 14 parity: issuing receipts leaves every payment row and the
--     outstanding formula unchanged.
--
-- Concurrency across real connections is proven separately by
-- scripts/test-receipt-issuance-concurrency.sh. Ends with ROLLBACK.

begin;

insert into auth.users (id, email) values
  ('21a00000-0000-0000-0000-000000000001', 'phase21a-admin@validation.local'),
  ('21a00000-0000-0000-0000-000000000002', 'phase21a-trainer@validation.local'),
  ('21a00000-0000-0000-0000-000000000003', 'phase21a-student-a@validation.local'),
  ('21a00000-0000-0000-0000-000000000004', 'phase21a-student-b@validation.local');

insert into user_roles (auth_user_id, role) values
  ('21a00000-0000-0000-0000-000000000001', 'admin'),
  ('21a00000-0000-0000-0000-000000000002', 'trainer'),
  ('21a00000-0000-0000-0000-000000000003', 'student'),
  ('21a00000-0000-0000-0000-000000000004', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('21a10000-0000-0000-0000-000000000001', '21a00000-0000-0000-0000-000000000001', 'Phase21A', 'Admin', 'phase21a-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('21a20000-0000-0000-0000-000000000001', '21a00000-0000-0000-0000-000000000002', 'Phase21A', 'Trainer', 'phase21a-trainer@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('21a30000-0000-0000-0000-000000000001', '21a00000-0000-0000-0000-000000000003', 'Phase21A', 'StudentA', '9990021101', 'phase21a-student-a@validation.local'),
  ('21a30000-0000-0000-0000-000000000002', '21a00000-0000-0000-0000-000000000004', 'Phase21A', 'StudentB', '9990021102', 'phase21a-student-b@validation.local');

insert into programs (id, program_code, name, regular_fee, registration_fee, status) values
  ('21a40000-0000-0000-0000-000000000001', 'PHASE21A-PROG', 'Phase 21A Program', 5000.00, 0, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('21a50000-0000-0000-0000-000000000001', '21a40000-0000-0000-0000-000000000001', 'Phase 21A Batch', current_date, 'active');

insert into batch_trainers (id, batch_id, trainer_id, is_primary) values
  ('21a60000-0000-0000-0000-000000000001', '21a50000-0000-0000-0000-000000000001', '21a20000-0000-0000-0000-000000000001', true);

insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('21a70000-0000-0000-0000-000000000001', '21a30000-0000-0000-0000-000000000001', '21a40000-0000-0000-0000-000000000001', '21a50000-0000-0000-0000-000000000001', 5000.00, 5000.00, 5000.00, 'active'),
  ('21a70000-0000-0000-0000-000000000002', '21a30000-0000-0000-0000-000000000002', '21a40000-0000-0000-0000-000000000001', '21a50000-0000-0000-0000-000000000001', 5000.00, 5000.00, 5000.00, 'active');

-- Payments (inserted as the server would, with service_role): A1 offline
-- paid (Student A), A2 Razorpay paid (Student A), B1 offline paid
-- (Student B), plus one of every non-qualifying status for Student A.
set local role service_role;

insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, tax_amount, total_amount, method, status, internal_reference, created_by, paid_at) values
  ('21a80000-0000-0000-0000-000000000001', 'PAY-P21A-A1', '21a30000-0000-0000-0000-000000000001', '21a70000-0000-0000-0000-000000000001', 'partial', 1000.00, 0, 1000.00, 'cash', 'paid', 'CASH-1', '21a10000-0000-0000-0000-000000000001', now()),
  ('21a80000-0000-0000-0000-000000000003', 'PAY-P21A-B1', '21a30000-0000-0000-0000-000000000002', '21a70000-0000-0000-0000-000000000002', 'partial', 700.00, 0, 700.00, 'upi', 'paid', null, '21a10000-0000-0000-0000-000000000001', now());

insert into payments (id, payment_code, student_id, enrollment_id, payment_type, amount, tax_amount, total_amount, method, status, razorpay_order_id, razorpay_payment_id, paid_at) values
  ('21a80000-0000-0000-0000-000000000002', 'PAY-P21A-A2', '21a30000-0000-0000-0000-000000000001', '21a70000-0000-0000-0000-000000000001', 'partial', 1500.00, 0, 1500.00, 'razorpay', 'paid', 'order_P21A_A2', 'pay_P21A_A2', now()),
  ('21a80000-0000-0000-0000-000000000010', 'PAY-P21A-PEND', '21a30000-0000-0000-0000-000000000001', '21a70000-0000-0000-0000-000000000001', 'partial', 10.00, 0, 10.00, 'razorpay', 'pending', 'order_P21A_P', null, null),
  ('21a80000-0000-0000-0000-000000000011', 'PAY-P21A-HELD', '21a30000-0000-0000-0000-000000000001', '21a70000-0000-0000-0000-000000000001', 'partial', 11.00, 0, 11.00, 'razorpay', 'authorized', 'order_P21A_H', 'pay_P21A_H', now()),
  ('21a80000-0000-0000-0000-000000000012', 'PAY-P21A-FAIL', '21a30000-0000-0000-0000-000000000001', '21a70000-0000-0000-0000-000000000001', 'partial', 12.00, 0, 12.00, 'razorpay', 'failed', 'order_P21A_F', 'pay_P21A_F', null),
  ('21a80000-0000-0000-0000-000000000013', 'PAY-P21A-CANC', '21a30000-0000-0000-0000-000000000001', '21a70000-0000-0000-0000-000000000001', 'partial', 13.00, 0, 13.00, 'razorpay', 'cancelled', 'order_P21A_C', null, null);

reset role;

-- ---------------------------------------------------------------------------
-- Schema, grants, bucket.

do $$
declare
  fn text;
  r text;
begin
  foreach fn in array array['issue_receipt(uuid)', 'next_receipt_number()'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, fn, 'execute') then
        raise exception 'FAIL: % must not execute %', r, fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'FAIL: service_role must execute %', fn;
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if has_sequence_privilege(r, 'receipt_number_seq', 'usage')
       or has_sequence_privilege(r, 'receipt_number_seq', 'update') then
      raise exception 'FAIL: % must not use receipt_number_seq', r;
    end if;
  end loop;
  if exists (select 1 from pg_policies where tablename = 'receipts' and cmd <> 'SELECT') then
    raise exception 'FAIL: receipts must have SELECT policies only';
  end if;
  if (select public from storage.buckets where id = 'receipts') is distinct from false then
    raise exception 'FAIL: receipts bucket must exist and be private';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'storage' and tablename = 'objects'
                and policyname like 'receipts_bucket_%' and cmd <> 'SELECT') then
    raise exception 'FAIL: receipts bucket must have SELECT policies only';
  end if;
  raise notice 'PASS: receipt functions are service_role-only; receipts table and bucket have no end-user write policy; bucket is private';
end
$$;

-- ---------------------------------------------------------------------------
-- Issuance (as the server's service-role client).

set local role service_role;

do $$
declare
  r record;
  r2 record;
  seq_before bigint;
  seq_after bigint;
  expected_prefix text := 'REC-' || extract(year from (now() at time zone 'Asia/Kolkata'))::text || '-';
  n int;
begin
  select * into r from issue_receipt('21a80000-0000-0000-0000-000000000001');
  if r.already_issued then raise exception 'FAIL: first issuance reported already_issued'; end if;
  if r.receipt_number !~ ('^' || expected_prefix || '[0-9]{6}$') then
    raise exception 'FAIL: unexpected receipt number format %', r.receipt_number;
  end if;
  if r.pdf_path <> '21a30000-0000-0000-0000-000000000001/' || r.receipt_id::text || '.pdf' then
    raise exception 'FAIL: unexpected pdf_path %', r.pdf_path;
  end if;
  if r.pdf_generated_at is not null then raise exception 'FAIL: new receipt must have no PDF yet'; end if;

  select last_value into seq_before from receipt_number_seq;
  select * into r2 from issue_receipt('21a80000-0000-0000-0000-000000000001');
  select last_value into seq_after from receipt_number_seq;
  if not r2.already_issued or r2.receipt_id <> r.receipt_id or r2.receipt_number <> r.receipt_number then
    raise exception 'FAIL: repeat issuance must return the same receipt';
  end if;
  if seq_after <> seq_before then raise exception 'FAIL: repeat issuance consumed a number'; end if;

  select count(*) into n from receipts where payment_id = '21a80000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: expected 1 receipt for A1, got %', n; end if;
  select count(*) into n from audit_logs where action = 'receipt.issued' and entity_id = r.receipt_id;
  if n <> 1 then raise exception 'FAIL: expected 1 receipt.issued audit row, got %', n; end if;
  if not exists (select 1 from audit_logs
                  where entity_id = r.receipt_id
                    and actor_role = 'system' and actor_auth_user_id is null
                    and after_data ->> 'paymentCode' = 'PAY-P21A-A1'
                    and after_data ->> 'amount' = '1000.00'
                    and after_data ->> 'method' = 'cash'
                    and after_data ->> 'receiptNumber' = r.receipt_number) then
    raise exception 'FAIL: receipt.issued audit payload mismatch';
  end if;
  raise notice 'PASS: a paid offline payment gets one receipt (format, path, audit) and a repeat call reuses it without consuming a number';
end
$$;

do $$
declare
  r_off record;
  r_rzp record;
  num_off bigint;
  num_rzp bigint;
begin
  select * into r_off from receipts where payment_id = '21a80000-0000-0000-0000-000000000001';
  select * into r_rzp from issue_receipt('21a80000-0000-0000-0000-000000000002');
  if r_rzp.already_issued then raise exception 'FAIL: Razorpay issuance reported already_issued'; end if;
  num_off := substring(r_off.receipt_number from '([0-9]+)$')::bigint;
  num_rzp := substring(r_rzp.receipt_number from '([0-9]+)$')::bigint;
  if num_rzp <= num_off then
    raise exception 'FAIL: receipt numbers must increase across payment methods (% then %)', r_off.receipt_number, r_rzp.receipt_number;
  end if;
  if (select count(*) from receipts where payment_id = '21a80000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'FAIL: Razorpay payment must have exactly one receipt';
  end if;
  perform issue_receipt('21a80000-0000-0000-0000-000000000003');
  raise notice 'PASS: a paid Razorpay payment gets the same kind of receipt from the same global sequence';
end
$$;

do $$
declare
  pid uuid;
  seq_before bigint;
  seq_after bigint;
begin
  select last_value into seq_before from receipt_number_seq;
  foreach pid in array array[
    '21a80000-0000-0000-0000-000000000010'::uuid,
    '21a80000-0000-0000-0000-000000000011'::uuid,
    '21a80000-0000-0000-0000-000000000012'::uuid,
    '21a80000-0000-0000-0000-000000000013'::uuid
  ] loop
    begin
      perform issue_receipt(pid);
      raise exception 'FAIL: issued a receipt for non-paid payment %', pid;
    exception when sqlstate 'P2101' then null;
    end;
  end loop;
  begin
    perform issue_receipt('21a80000-0000-0000-0000-0000000000ff');
    raise exception 'FAIL: issued a receipt for an unknown payment';
  exception when sqlstate 'P2104' then null;
  end;
  begin
    perform issue_receipt(null);
    raise exception 'FAIL: issued a receipt for a null payment';
  exception when sqlstate '22023' then null;
  end;
  select last_value into seq_after from receipt_number_seq;
  if seq_after <> seq_before then raise exception 'FAIL: refused issuance consumed a number'; end if;
  if exists (select 1 from receipts where payment_id in (
      '21a80000-0000-0000-0000-000000000010', '21a80000-0000-0000-0000-000000000011',
      '21a80000-0000-0000-0000-000000000012', '21a80000-0000-0000-0000-000000000013')) then
    raise exception 'FAIL: a non-paid payment has a receipt';
  end if;

  -- Even the server cannot insert a receipt for a non-paid payment directly.
  begin
    insert into receipts (receipt_number, payment_id, pdf_path)
    values ('REC-FORGED-1', '21a80000-0000-0000-0000-000000000011', 'x/forged.pdf');
    raise exception 'FAIL: inserted a receipt for a held payment';
  exception when check_violation then null;
  end;
  -- ...nor a second receipt for a payment that already has one.
  begin
    insert into receipts (receipt_number, payment_id, pdf_path)
    values ('REC-FORGED-2', '21a80000-0000-0000-0000-000000000001', 'x/forged2.pdf');
    raise exception 'FAIL: inserted a second receipt for one payment';
  exception when unique_violation then null;
  end;
  raise notice 'PASS: pending / held / failed / cancelled / unknown payments get no receipt and consume no number; one receipt per payment is a DB constraint';
end
$$;

do $$
declare
  rid uuid;
begin
  select id into rid from receipts where payment_id = '21a80000-0000-0000-0000-000000000001';
  begin
    update receipts set receipt_number = 'REC-EDITED' where id = rid;
    raise exception 'FAIL: receipt_number changed';
  exception when raise_exception then null;
  end;
  begin
    update receipts set payment_id = '21a80000-0000-0000-0000-000000000003' where id = rid;
    raise exception 'FAIL: payment_id changed';
  exception when raise_exception or unique_violation then null;
  end;
  begin
    update receipts set pdf_path = 'elsewhere.pdf' where id = rid;
    raise exception 'FAIL: pdf_path changed';
  exception when raise_exception then null;
  end;
  begin
    update receipts set created_at = now() - interval '1 day' where id = rid;
    raise exception 'FAIL: created_at changed';
  exception when raise_exception then null;
  end;
  update receipts set pdf_generated_at = now() where id = rid and pdf_generated_at is null;
  begin
    update receipts set pdf_generated_at = null where id = rid;
    raise exception 'FAIL: pdf_generated_at cleared';
  exception when raise_exception then null;
  end;
  begin
    update receipts set pdf_generated_at = now() + interval '1 hour' where id = rid;
    raise exception 'FAIL: pdf_generated_at changed twice';
  exception when raise_exception then null;
  end;
  update receipts set emailed_at = now() where id = rid;
  raise notice 'PASS: receipt number, payment, path and issue time are immutable; pdf_generated_at is set once';
end
$$;

-- Numbering format: configured format honoured; a format without {seq:N}
-- falls back to the default; the sequence is never reset.
reset role;
do $$
declare
  num text;
  last_before bigint;
begin
  select last_value into last_before from receipt_number_seq;
  update company_settings set receipt_number_format = 'RCPT/{year}/{seq:8}' where singleton;
  set local role service_role;
  num := next_receipt_number();
  reset role;
  if num !~ ('^RCPT/' || extract(year from (now() at time zone 'Asia/Kolkata'))::text || '/[0-9]{8}$') then
    raise exception 'FAIL: configured format not honoured: %', num;
  end if;
  if substring(num from '([0-9]+)$')::bigint <> last_before + 1 then
    raise exception 'FAIL: numbering is not the next value of the global sequence';
  end if;
  -- Since migration 39 a format without {seq:N} cannot be saved; drop the
  -- constraint inside this rolled-back transaction to simulate a row from
  -- before it, so the database's own fallback stays proven.
  alter table company_settings drop constraint company_settings_receipt_format_valid;
  update company_settings set receipt_number_format = 'NO-SEQ-TOKEN' where singleton;
  set local role service_role;
  num := next_receipt_number();
  reset role;
  if num !~ '^REC-[0-9]{4}-[0-9]{6}$' then
    raise exception 'FAIL: a format without {seq:N} must fall back to the default, got %', num;
  end if;
  update company_settings set receipt_number_format = 'REC-{year}-{seq:6}' where singleton;
  raise notice 'PASS: receipt format comes from company_settings, falls back safely, and draws from the one global sequence';
end
$$;

-- Phase 14 parity: receipts change no payment and no outstanding figure.
do $$
declare
  outstanding numeric;
begin
  select greatest(0, e.total_payable
                     - coalesce((select sum(p.total_amount) from payments p
                                  where p.enrollment_id = e.id and p.status = 'paid'), 0))
    into outstanding
    from enrollments e where e.id = '21a70000-0000-0000-0000-000000000001';
  if outstanding <> 2500.00 then
    raise exception 'FAIL: outstanding after receipts should be 2500.00, got %', outstanding;
  end if;
  if (select count(*) from payments where id::text like '21a80000-%' and status = 'paid') <> 3 then
    raise exception 'FAIL: payment statuses changed';
  end if;
  raise notice 'PASS: issuing receipts leaves payments and the Phase 14 outstanding untouched';
end
$$;

-- Storage objects for the three issued receipts (as the server uploads).
set local role service_role;
insert into storage.objects (bucket_id, name)
select 'receipts', pdf_path from receipts
 where payment_id in ('21a80000-0000-0000-0000-000000000001',
                      '21a80000-0000-0000-0000-000000000002',
                      '21a80000-0000-0000-0000-000000000003');
reset role;

-- ---------------------------------------------------------------------------
-- Admin.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"21a00000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  n int;
  u int;
begin
  select count(*) into n from receipts r join payments p on p.id = r.payment_id where p.id::text like '21a80000-%';
  if n <> 3 then raise exception 'FAIL: admin should read 3 receipts, got %', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'receipts';
  if n <> 3 then raise exception 'FAIL: admin should read 3 receipt objects, got %', n; end if;

  update receipts set emailed_at = now();
  get diagnostics u = row_count;
  if u <> 0 then raise exception 'FAIL: admin updated % receipts', u; end if;
  delete from receipts;
  get diagnostics u = row_count;
  if u <> 0 then raise exception 'FAIL: admin deleted % receipts', u; end if;
  begin
    insert into receipts (receipt_number, payment_id, pdf_path)
    values ('REC-ADMIN', '21a80000-0000-0000-0000-000000000003', 'x/admin.pdf');
    raise exception 'FAIL: admin inserted a receipt';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    perform issue_receipt('21a80000-0000-0000-0000-000000000003');
    raise exception 'FAIL: admin executed issue_receipt';
  exception when insufficient_privilege then null;
  end;
  begin
    perform nextval('receipt_number_seq');
    raise exception 'FAIL: admin advanced the receipt sequence';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', 'x/admin-upload.pdf');
    raise exception 'FAIL: admin uploaded a receipt object';
  exception when insufficient_privilege then null;
  end;
  delete from storage.objects where bucket_id = 'receipts';
  get diagnostics u = row_count;
  if u <> 0 then raise exception 'FAIL: admin deleted % receipt objects', u; end if;
  raise notice 'PASS: Admin reads every receipt and PDF but cannot create, edit or delete either';
end
$$;

-- ---------------------------------------------------------------------------
-- Student A: own two receipts only.

set local "request.jwt.claims" to '{"sub":"21a00000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  n int;
  u int;
begin
  select count(*) into n from receipts;
  if n <> 2 then raise exception 'FAIL: student A should read own 2 receipts, got %', n; end if;
  select count(*) into n from receipts r join payments p on p.id = r.payment_id
   where p.student_id <> '21a30000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL: student A read a foreign receipt'; end if;
  select count(*) into n from storage.objects where bucket_id = 'receipts';
  if n <> 2 then raise exception 'FAIL: student A should read own 2 objects, got %', n; end if;
  select count(*) into n from storage.objects
   where bucket_id = 'receipts' and name like '21a30000-0000-0000-0000-000000000002/%';
  if n <> 0 then raise exception 'FAIL: student A read student B''s PDF'; end if;

  update receipts set emailed_at = now();
  get diagnostics u = row_count;
  if u <> 0 then raise exception 'FAIL: student updated % receipts', u; end if;
  begin
    perform issue_receipt('21a80000-0000-0000-0000-000000000003');
    raise exception 'FAIL: student executed issue_receipt';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('receipts', '21a30000-0000-0000-0000-000000000001/forged.pdf');
    raise exception 'FAIL: student uploaded a receipt object';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: Student A reads only own receipts and PDFs and cannot write';
end
$$;

-- Student B: own one receipt only.
set local "request.jwt.claims" to '{"sub":"21a00000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  if (select count(*) from receipts) <> 1 then raise exception 'FAIL: student B should read 1 receipt'; end if;
  if (select count(*) from storage.objects where bucket_id = 'receipts') <> 1 then
    raise exception 'FAIL: student B should read 1 object';
  end if;
  if exists (select 1 from storage.objects
              where bucket_id = 'receipts' and name like '21a30000-0000-0000-0000-000000000001/%') then
    raise exception 'FAIL: student B read student A''s PDF by path';
  end if;
  raise notice 'PASS: Student B never reads Student A receipts or PDFs, even by exact path';
end
$$;

-- Assigned Trainer: nothing.
set local "request.jwt.claims" to '{"sub":"21a00000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  if (select count(*) from receipts) <> 0 then raise exception 'FAIL: trainer read receipts'; end if;
  if (select count(*) from storage.objects where bucket_id = 'receipts') <> 0 then
    raise exception 'FAIL: trainer read receipt PDFs';
  end if;
  begin
    perform issue_receipt('21a80000-0000-0000-0000-000000000003');
    raise exception 'FAIL: trainer executed issue_receipt';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: an assigned Trainer reads no receipts or PDFs and cannot issue';
end
$$;

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $$
begin
  -- Same convention as phase20b_razorpay_test.sql: zero rows or a
  -- permission-denied error from a policy helper are both denial.
  begin
    if (select count(*) from receipts) <> 0 then raise exception 'FAIL: anon read receipts'; end if;
  exception when others then
    if sqlerrm not like 'permission denied%' then raise; end if;
  end;
  begin
    if (select count(*) from storage.objects where bucket_id = 'receipts') <> 0 then
      raise exception 'FAIL: anon read receipt PDFs';
    end if;
  exception when others then
    if sqlerrm not like 'permission denied%' then raise; end if;
  end;
  begin
    perform issue_receipt('21a80000-0000-0000-0000-000000000003');
    raise exception 'FAIL: anon executed issue_receipt';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anon reads no receipts or PDFs and cannot issue';
end
$$;

rollback;
