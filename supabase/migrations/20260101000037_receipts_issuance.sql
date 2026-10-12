-- Phase 21A (Receipts & Payment Documents). FR-94 (every successful
-- payment, online or offline, gets a sequential unique receipt number and
-- a downloadable PDF) and FR-95 (concurrency-safe numbering). The
-- `receipts` table, `receipt_number_seq`, the one-receipt-per-payment
-- unique index and the receipt_number/payment_id/pdf_path immutability
-- trigger already exist (20260101000007 / 20260101000012 /
-- 20260101000015). A read-only review of the dev project found these gaps:
--
--  1. No DB-side receipt number generator. Numbering rule confirmed at the
--     Phase 21A checkpoint (DECISIONS_NEEDED.md D7, receipt half): ONE
--     global receipt_number_seq that never resets; `{year}` in the
--     `REC-{year}-{seq:6}` format is a cosmetic label (the Asia/Kolkata
--     year of issue), exactly like certificates. Gaps from rolled-back
--     transactions are accepted; uniqueness and immutability are required.
--     The sequence is NOT reset or recreated.
--
--  2. Issuance needs to be atomic and idempotent per payment: lock the
--     payment, require status 'paid' (the only canonical successful
--     status — pending / authorized ("held for review") / failed /
--     cancelled never qualify), return the existing receipt if one exists
--     (no second number is consumed), otherwise mint the number and insert
--     the row with a server-built pdf_path, and write one `receipt.issued`
--     audit row in the same transaction. That is issue_receipt() below,
--     service_role only — receipts are a system consequence of a payment
--     becoming paid (offline recording or Razorpay finalization), so no
--     end-user role calls it directly.
--
--  3. pdf_path is NOT NULL and immutable, but the PDF is rendered by the
--     application after the row exists (so a render/upload failure never
--     loses or re-mints the number). pdf_generated_at records that the
--     object at pdf_path was actually written; until then the app can
--     retry the same path. It may be set once and never cleared.
--
--  4. receipts_write_admin / receipts_update_admin let an Admin session
--     INSERT or UPDATE receipts directly over the REST API. Both are
--     dropped (RLS default-deny): the only writer is the service-role
--     server path. SELECT policies (Admin all, Student own via the
--     payment) are unchanged; Trainer and anon have none.
--
--  5. Nothing stopped a receipt row for a non-paid payment. A BEFORE
--     INSERT trigger now requires payments.status = 'paid' for every
--     writer, service_role included.
--
--  6. No `receipts` Storage bucket existed. A private bucket is created;
--     Admin reads every object, a Student reads only objects whose path is
--     the pdf_path of a receipt for their own payment. No end-user write
--     policy of any kind (the server uploads with service_role).
--
-- No payment, Razorpay, refund or email behaviour is changed here.

-- 1. Receipt number ----------------------------------------------------------

create or replace function next_receipt_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fmt text;
  seq_value bigint;
  pad_width int;
  result text;
begin
  select receipt_number_format into fmt from company_settings where singleton limit 1;
  -- A format without a {seq:N} token could not produce unique numbers.
  if fmt is null or fmt !~ '\{seq:[0-9]+\}' then
    fmt := 'REC-{year}-{seq:6}';
  end if;
  seq_value := nextval('receipt_number_seq');
  result := replace(fmt, '{year}', extract(year from (now() at time zone 'Asia/Kolkata'))::text);
  pad_width := least(coalesce((regexp_match(result, '\{seq:([0-9]+)\}'))[1]::int, 6), 12);
  result := regexp_replace(result, '\{seq:[0-9]+\}', lpad(seq_value::text, pad_width, '0'));
  return result;
end;
$$;

comment on function next_receipt_number() is
  'Phase 21A: mints the next receipt number from the global, never-resetting receipt_number_seq (DECISIONS_NEEDED.md D7). {year} is the Asia/Kolkata year of issue, a label only. service_role only; called by issue_receipt().';

revoke execute on function next_receipt_number() from public, anon, authenticated;
grant execute on function next_receipt_number() to service_role;

-- Only the definer-rights functions above advance the sequence; end-user
-- roles cannot burn numbers directly.
revoke all on sequence receipt_number_seq from anon, authenticated;

-- 2. Document lifecycle + immutability ----------------------------------------

alter table receipts add column if not exists pdf_generated_at timestamptz;

comment on column receipts.pdf_generated_at is
  'Set once by the server after the PDF at pdf_path has been uploaded. Null means the receipt is issued (number reserved) but its PDF is still to be generated; the server retries the same pdf_path.';

create or replace function prevent_receipt_immutable_fields_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
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
  if new.created_at is distinct from old.created_at then
    raise exception 'receipts.created_at is immutable and cannot be changed after creation';
  end if;
  if old.pdf_generated_at is not null
     and new.pdf_generated_at is distinct from old.pdf_generated_at then
    raise exception 'receipts.pdf_generated_at is set once and cannot be changed';
  end if;
  return new;
end;
$$;

-- 3. Only paid payments get receipts ------------------------------------------

create or replace function enforce_receipt_payment_paid()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from payments p where p.id = new.payment_id and p.status = 'paid') then
    raise exception using
      errcode = '23514',
      message = 'A receipt can only be issued for a paid payment (FR-94)';
  end if;
  return new;
end;
$$;

comment on function enforce_receipt_payment_paid() is
  'FR-94: a receipt row may only be inserted for a payment whose status is paid, for every writer.';

create trigger receipts_enforce_payment_paid
  before insert on receipts
  for each row execute function enforce_receipt_payment_paid();

-- 4. No end-user write path -----------------------------------------------------

drop policy if exists receipts_write_admin on receipts;
drop policy if exists receipts_update_admin on receipts;

-- 5. Issuance ---------------------------------------------------------------------

create or replace function issue_receipt(p_payment_id uuid)
returns table (
  receipt_id uuid,
  receipt_number text,
  pdf_path text,
  pdf_generated_at timestamptz,
  already_issued boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay record;
  existing record;
  new_id uuid;
  new_number text;
  new_path text;
begin
  if p_payment_id is null then
    raise exception using errcode = '22023', message = 'A payment id is required';
  end if;

  -- Serializes every issuance attempt for this payment: a concurrent
  -- caller waits here, then finds the receipt below instead of minting.
  select p.id, p.payment_code, p.student_id, p.status, p.total_amount, p.method
    into pay
    from payments p
   where p.id = p_payment_id
   for update;
  if pay.id is null then
    raise exception using errcode = 'P2104', message = 'Payment not found';
  end if;

  select r.id, r.receipt_number, r.pdf_path, r.pdf_generated_at
    into existing
    from receipts r
   where r.payment_id = p_payment_id;
  if existing.id is not null then
    return query select existing.id, existing.receipt_number, existing.pdf_path,
                        existing.pdf_generated_at, true;
    return;
  end if;

  if pay.status <> 'paid' then
    raise exception using
      errcode = 'P2101',
      message = 'A receipt can only be issued for a paid payment';
  end if;

  new_id := gen_random_uuid();
  new_number := next_receipt_number();
  new_path := pay.student_id::text || '/' || new_id::text || '.pdf';

  insert into receipts (id, receipt_number, payment_id, pdf_path)
  values (new_id, new_number, p_payment_id, new_path);

  insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, after_data)
  values (
    null, 'system', 'receipt.issued', 'receipt', new_id,
    jsonb_build_object(
      'receiptNumber', new_number,
      'paymentId', p_payment_id,
      'paymentCode', pay.payment_code,
      'amount', to_char(pay.total_amount, 'FM9999999999990.00'),
      'method', pay.method
    )
  );

  return query select new_id, new_number, new_path, null::timestamptz, false;
end;
$$;

comment on function issue_receipt(uuid) is
  'Phase 21A: the only way a receipt is created. Locks the payment, returns the existing receipt when there is one (no number consumed), requires status paid, mints the number DB-side, inserts the row with a server-built pdf_path and writes one receipt.issued audit row, all in one transaction. service_role only.';

revoke execute on function issue_receipt(uuid) from public, anon, authenticated;
grant execute on function issue_receipt(uuid) to service_role;

-- 6. Private Storage bucket ------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_bucket_select_admin on storage.objects
  for select using (bucket_id = 'receipts' and is_admin_or_super());

-- Student — read-only, scoped through the real receipt row and its payment
-- (mirrors receipts_select_own). No INSERT/UPDATE/DELETE policy for any
-- end-user role: the server writes with service_role.
create policy receipts_bucket_select_own on storage.objects
  for select using (
    bucket_id = 'receipts'
    and exists (
      select 1
      from receipts r
      join payments p on p.id = r.payment_id
      where r.pdf_path = storage.objects.name
        and p.student_id = current_student_id()
    )
  );
