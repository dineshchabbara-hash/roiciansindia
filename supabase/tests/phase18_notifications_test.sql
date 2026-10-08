-- Phase 18 (Notifications V1, in-app only) regression suite for
-- 20260101000034_notifications_v1_sender_and_immutability.sql on top of the
-- pre-existing `notifications` table (20260101000009) and its kept
-- recipient policies (20260101000014).
--
-- Every application role is exercised as itself (`authenticated` /
-- `anon` with a real JWT-claims GUC) — never as service_role — so these
-- results prove the policies a real browser/API caller is held to.
--
-- Covers, allowed and denied:
--   - anon: zero select/insert/update/delete.
--   - Admin / Super Admin: may send an `admin_message` only as themselves
--     (created_by = auth.uid()), unread, in-app, to an existing Student or
--     Trainer account; spoofed sender, null sender, non-recipient-role
--     target, role-less target, other types, and pre-read rows are all
--     rejected. Read access is own-sent only (another Admin sees nothing).
--     No update or delete of any notification, sent or not.
--   - Student / Trainer: read own received only (cross-student,
--     cross-trainer, and student<->trainer all denied); cannot insert or
--     delete; may change only status/read_at on their own row (title,
--     body, recipient, sender, type, data, channel, created_at all
--     rejected by the trigger); cannot touch another user's read state;
--     status/read_at must stay consistent.
--   - Internal no-JWT work: deleting a sender's auth account nulls
--     created_by via ON DELETE SET NULL without tripping the trigger, and
--     the recipient keeps the notification.
--
-- Run via scripts/test-rls.sh. Ends with ROLLBACK — no trace left
-- regardless of pass/fail.

begin;

insert into auth.users (id, email) values
  ('18000000-0000-0000-0000-000000000001', 'phase18-admin-a@validation.local'),
  ('18000000-0000-0000-0000-000000000002', 'phase18-admin-b@validation.local'),
  ('18000000-0000-0000-0000-000000000003', 'phase18-super@validation.local'),
  ('18000000-0000-0000-0000-000000000004', 'phase18-trainer-a@validation.local'),
  ('18000000-0000-0000-0000-000000000005', 'phase18-trainer-b@validation.local'),
  ('18000000-0000-0000-0000-000000000006', 'phase18-student-a@validation.local'),
  ('18000000-0000-0000-0000-000000000007', 'phase18-student-b@validation.local'),
  ('18000000-0000-0000-0000-000000000008', 'phase18-no-role@validation.local'),
  ('18000000-0000-0000-0000-000000000009', 'phase18-admin-c@validation.local');

insert into user_roles (auth_user_id, role) values
  ('18000000-0000-0000-0000-000000000001', 'admin'),
  ('18000000-0000-0000-0000-000000000002', 'admin'),
  ('18000000-0000-0000-0000-000000000003', 'super_admin'),
  ('18000000-0000-0000-0000-000000000004', 'trainer'),
  ('18000000-0000-0000-0000-000000000005', 'trainer'),
  ('18000000-0000-0000-0000-000000000006', 'student'),
  ('18000000-0000-0000-0000-000000000007', 'student'),
  -- Admin C has a role row only (no admins profile), so its auth account
  -- can be deleted later to prove the sender ON DELETE SET NULL path.
  ('18000000-0000-0000-0000-000000000009', 'admin');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('18100000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001', 'Phase18', 'AdminA', 'phase18-admin-a@validation.local', 'admin'),
  ('18100000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000002', 'Phase18', 'AdminB', 'phase18-admin-b@validation.local', 'admin'),
  ('18100000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000003', 'Phase18', 'Super', 'phase18-super@validation.local', 'super_admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('18200000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000004', 'Phase18', 'TrainerA', 'phase18-trainer-a@validation.local'),
  ('18200000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000005', 'Phase18', 'TrainerB', 'phase18-trainer-b@validation.local');

insert into students (id, auth_user_id, first_name, last_name, phone, email) values
  ('18300000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000006', 'Phase18', 'StudentA', '9990018001', 'phase18-student-a@validation.local'),
  ('18300000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000007', 'Phase18', 'StudentB', '9990018002', 'phase18-student-b@validation.local');

-- ---------------------------------------------------------------------------
-- Admin A — sends as themselves; every spoof/out-of-scope insert rejected.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
begin
  insert into notifications (id, recipient_auth_user_id, created_by_auth_user_id, type, title, body, channel, status)
  values
    ('18900000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000001', 'admin_message', 'To Student A #1', 'Body 1', 'in_app', 'unread'),
    ('18900000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000001', 'admin_message', 'To Student A #2', 'Body 2', 'in_app', 'unread'),
    ('18900000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000004', '18000000-0000-0000-0000-000000000001', 'admin_message', 'To Trainer A', 'Body 3', 'in_app', 'unread');
  raise notice 'PASS: admin can send an admin_message as themselves to a Student and to a Trainer (notifications_insert_admin_message)';
end
$$;

do $$
begin
  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000002', 'admin_message', 'Spoofed', 'x');
    raise exception 'FAIL: admin must not be able to send as another admin (spoofed created_by)';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: spoofed sender rejected';
  end;

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000006', null, 'admin_message', 'No sender', 'x');
    raise exception 'FAIL: admin must not be able to send with a null sender';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: null sender rejected for an application insert';
  end;

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000001', 'admin_message', 'To an admin', 'x');
    raise exception 'FAIL: admin must not be able to target an Admin account';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: Admin-account recipient rejected (Student/Trainer only)';
  end;

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000008', '18000000-0000-0000-0000-000000000001', 'admin_message', 'To no-role user', 'x');
    raise exception 'FAIL: admin must not be able to target an arbitrary auth user with no role';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: arbitrary role-less auth user rejected as recipient';
  end;

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000001', 'payment_receipt', 'Other type', 'x');
    raise exception 'FAIL: admin must not be able to create a non-admin_message type';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: non-admin_message type rejected for an application insert';
  end;

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body, status, read_at)
    values ('18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000001', 'admin_message', 'Pre-read', 'x', 'read', now());
    raise exception 'FAIL: admin must not be able to create an already-read notification';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: pre-read notification rejected';
  end;

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body, channel)
    values ('18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000001', 'admin_message', 'Email', 'x', 'email');
    raise exception 'FAIL: admin must not be able to create a non-in_app channel row in V1';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: non-in_app channel rejected';
  end;

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000001', 'admin_message', '   ', 'x');
    raise exception 'FAIL: a blank title must be rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: blank title rejected (notifications_title_length_check)';
  end;
end
$$;

do $$
declare
  cnt int;
  changed int;
begin
  select count(*) into cnt from notifications;
  if cnt <> 3 then
    raise exception 'FAIL: admin A should see exactly its own 3 sent notifications, got %', cnt;
  end if;
  raise notice 'PASS: admin sees its own sent notifications (notifications_select_sent_by_self)';

  update notifications set title = 'Rewritten' where id = '18900000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: admin must not be able to rewrite a sent notification, % row(s) changed', changed;
  end if;
  update notifications set status = 'read', read_at = now() where id = '18900000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: a sender must not be able to change the recipient read state, % row(s) changed', changed;
  end if;
  raise notice 'PASS: admin cannot update a sent notification (no admin update policy)';

  delete from notifications where id = '18900000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: admin must not be able to delete a notification, % row(s) deleted', changed;
  end if;
  raise notice 'PASS: admin cannot hard-delete a notification (no delete policy)';
end
$$;

-- ---------------------------------------------------------------------------
-- Super Admin — same send path; sees only its own sent rows.

set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  insert into notifications (id, recipient_auth_user_id, created_by_auth_user_id, type, title, body)
  values ('18900000-0000-0000-0000-000000000004', '18000000-0000-0000-0000-000000000007', '18000000-0000-0000-0000-000000000003', 'admin_message', 'To Student B', 'Body 4');

  select count(*) into cnt from notifications;
  if cnt <> 1 then
    raise exception 'FAIL: super admin should see only its own 1 sent notification (no read-all), got %', cnt;
  end if;
  raise notice 'PASS: super admin can send and sees only its own sent notification (no global read)';
end
$$;

-- Admin C sends one notification, used below for the sender-deletion path.
set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000009","role":"authenticated"}';
insert into notifications (id, recipient_auth_user_id, created_by_auth_user_id, type, title, body)
values ('18900000-0000-0000-0000-000000000005', '18000000-0000-0000-0000-000000000007', '18000000-0000-0000-0000-000000000009', 'admin_message', 'From Admin C', 'Body 5');

-- ---------------------------------------------------------------------------
-- Admin B — never sent anything, is not a recipient: sees nothing.

set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from notifications;
  if cnt <> 0 then
    raise exception 'FAIL: admin B must not see notifications sent by other admins, got %', cnt;
  end if;
  raise notice 'PASS: another admin cannot read someone else''s sent history';
end
$$;

-- ---------------------------------------------------------------------------
-- Student A — own received only; read-state only.

set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000006","role":"authenticated"}';

do $$
declare
  cnt int;
  changed int;
begin
  select count(*) into cnt from notifications;
  if cnt <> 2 then
    raise exception 'FAIL: student A should see exactly its own 2 notifications, got %', cnt;
  end if;
  select count(*) into cnt from notifications
  where id in ('18900000-0000-0000-0000-000000000003', '18900000-0000-0000-0000-000000000004', '18900000-0000-0000-0000-000000000005');
  if cnt <> 0 then
    raise exception 'FAIL: student A must not see the Trainer''s or Student B''s notifications, got %', cnt;
  end if;
  raise notice 'PASS: student sees only own notifications (cross-student and student->trainer denied)';

  begin
    update notifications set title = 'Tampered' where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: recipient must not be able to change title';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: recipient cannot change title';
  end;
  begin
    update notifications set body = 'Tampered' where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: recipient must not be able to change body';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: recipient cannot change body';
  end;
  begin
    update notifications set created_by_auth_user_id = '18000000-0000-0000-0000-000000000002' where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: recipient must not be able to change sender';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: recipient cannot change sender';
  end;
  begin
    update notifications set created_by_auth_user_id = null where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: recipient must not be able to null out the sender';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: recipient cannot null out the sender';
  end;
  begin
    update notifications set created_at = now() - interval '1 year' where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: recipient must not be able to change created_at';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: recipient cannot change created_at';
  end;
  begin
    update notifications set type = 'other', data = '{"x":1}'::jsonb, channel = 'email' where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: recipient must not be able to change type/data/channel';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: recipient cannot change type/data/channel';
  end;
  begin
    -- Moving a row to another recipient: blocked by the trigger and by
    -- notifications_update_own's WITH CHECK either way.
    update notifications set recipient_auth_user_id = '18000000-0000-0000-0000-000000000007' where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: recipient must not be able to re-address a notification';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: recipient cannot change recipient';
  end;
  begin
    update notifications set status = 'read' where id = '18900000-0000-0000-0000-000000000001';
    raise exception 'FAIL: status=read without read_at must be rejected';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: inconsistent read state rejected (notifications_read_state_check)';
  end;

  update notifications set status = 'read', read_at = now() where id = '18900000-0000-0000-0000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'FAIL: recipient should be able to mark own notification read, % row(s) changed', changed;
  end if;
  raise notice 'PASS: recipient can mark own notification read';

  update notifications set status = 'read', read_at = now() where id = '18900000-0000-0000-0000-000000000004';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: student A must not change Student B''s read state, % row(s) changed', changed;
  end if;
  raise notice 'PASS: recipient cannot change another user''s read state';

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000006', 'admin_message', 'Self-sent', 'x');
    raise exception 'FAIL: student must not be able to insert a notification';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: student cannot insert';
  end;

  delete from notifications where id = '18900000-0000-0000-0000-000000000002';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: student must not be able to delete own notification, % row(s) deleted', changed;
  end if;
  raise notice 'PASS: student cannot delete';
end
$$;

-- ---------------------------------------------------------------------------
-- Student B — own received only.

set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000007","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from notifications;
  if cnt <> 2 then
    raise exception 'FAIL: student B should see exactly its own 2 notifications, got %', cnt;
  end if;
  select count(*) into cnt from notifications
  where id in ('18900000-0000-0000-0000-000000000001', '18900000-0000-0000-0000-000000000002');
  if cnt <> 0 then
    raise exception 'FAIL: student B must not see student A''s notifications';
  end if;
  raise notice 'PASS: second student cannot see first student''s notifications';
end
$$;

-- ---------------------------------------------------------------------------
-- Trainer A — own received only; no insert/delete; read-state only.

set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  cnt int;
  changed int;
begin
  select count(*) into cnt from notifications;
  if cnt <> 1 then
    raise exception 'FAIL: trainer A should see exactly its own 1 notification, got %', cnt;
  end if;
  raise notice 'PASS: trainer sees only own notifications (trainer->student denied)';

  begin
    update notifications set title = 'Tampered' where id = '18900000-0000-0000-0000-000000000003';
    raise exception 'FAIL: trainer must not be able to change title';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: trainer cannot change title';
  end;

  update notifications set status = 'read', read_at = now() where id = '18900000-0000-0000-0000-000000000003';
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'FAIL: trainer should be able to mark own notification read';
  end if;
  raise notice 'PASS: trainer can mark own notification read';

  begin
    insert into notifications (recipient_auth_user_id, created_by_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-000000000004', 'admin_message', 'From trainer', 'x');
    raise exception 'FAIL: trainer must not be able to insert a notification';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise notice 'PASS: trainer cannot insert';
  end;

  delete from notifications where id = '18900000-0000-0000-0000-000000000003';
  get diagnostics changed = row_count;
  if changed <> 0 then
    raise exception 'FAIL: trainer must not be able to delete';
  end if;
  raise notice 'PASS: trainer cannot delete';
end
$$;

-- Trainer B — sees nothing.
set local "request.jwt.claims" to '{"sub":"18000000-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  cnt int;
begin
  select count(*) into cnt from notifications;
  if cnt <> 0 then
    raise exception 'FAIL: trainer B must not see trainer A''s notification, got %', cnt;
  end if;
  raise notice 'PASS: second trainer cannot see first trainer''s notification';
end
$$;

-- ---------------------------------------------------------------------------
-- anon — zero access.

set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';

-- Same convention as phase17_certificates_test.sql: anon is denied either
-- by 0 rows or by `permission denied` evaluating a policy helper it holds
-- no EXECUTE grant on (is_admin_or_super(), revoked from anon in
-- 20260101000016). Both are denial; any other error is a failure.
do $$
declare
  cnt int;
  changed int;
begin
  begin
    select count(*) into cnt from notifications;
    if cnt <> 0 then
      raise exception 'FAIL: anon must see no notifications, got %', cnt;
    end if;
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like '%permission denied%' then raise; end if;
  end;
  raise notice 'PASS: anon cannot select notifications';

  begin
    insert into notifications (recipient_auth_user_id, type, title, body)
    values ('18000000-0000-0000-0000-000000000006', 'admin_message', 'anon', 'x');
    raise exception 'FAIL: anon must not be able to insert';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'PASS: anon cannot insert notifications';

  begin
    update notifications set title = 'anon' where id = '18900000-0000-0000-0000-000000000002';
    get diagnostics changed = row_count;
    if changed <> 0 then
      raise exception 'FAIL: anon must not be able to update';
    end if;
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like '%permission denied%' then raise; end if;
  end;
  raise notice 'PASS: anon cannot update notifications';

  begin
    delete from notifications where id = '18900000-0000-0000-0000-000000000002';
    get diagnostics changed = row_count;
    if changed <> 0 then
      raise exception 'FAIL: anon must not be able to delete';
    end if;
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like '%permission denied%' then raise; end if;
  end;
  raise notice 'PASS: anon cannot delete notifications';
end
$$;

-- ---------------------------------------------------------------------------
-- Ground truth as the migration owner (no JWT): nothing was rewritten or
-- deleted by any denied attempt above, and the sender-deletion cascade
-- works without tripping the immutability trigger.

reset role;
reset "request.jwt.claims";

do $$
declare
  rec record;
  cnt int;
begin
  select title, body, status, read_at, created_by_auth_user_id into rec
  from notifications where id = '18900000-0000-0000-0000-000000000001';
  if rec.title <> 'To Student A #1' or rec.body <> 'Body 1'
    or rec.created_by_auth_user_id <> '18000000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: notification 1 content/sender changed: %', rec;
  end if;
  if rec.status <> 'read' or rec.read_at is null then
    raise exception 'FAIL: notification 1 should be read by its recipient';
  end if;

  select status into rec from notifications where id = '18900000-0000-0000-0000-000000000004';
  if rec.status <> 'unread' then
    raise exception 'FAIL: student B''s notification must still be unread';
  end if;

  select count(*) into cnt from notifications;
  if cnt <> 5 then
    raise exception 'FAIL: all 5 notifications must still exist (no deletes succeeded), got %', cnt;
  end if;
  raise notice 'PASS: denied attempts left content, sender, read state, and row count unchanged';

  delete from auth.users where id = '18000000-0000-0000-0000-000000000009';
  select created_by_auth_user_id into rec from notifications where id = '18900000-0000-0000-0000-000000000005';
  if not found then
    raise exception 'FAIL: deleting the sender must not delete the recipient''s notification';
  end if;
  if rec.created_by_auth_user_id is not null then
    raise exception 'FAIL: deleting the sender should null created_by_auth_user_id';
  end if;
  raise notice 'PASS: sender account deletion keeps the notification and nulls created_by (ON DELETE SET NULL, trigger exempt for no-JWT work)';
end
$$;

rollback;
