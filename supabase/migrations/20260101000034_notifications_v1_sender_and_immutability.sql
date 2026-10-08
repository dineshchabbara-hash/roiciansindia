-- Phase 18 V1 (in-app notifications only — see IMPLEMENTATION_PLAN.md
-- Phase 18 for the approved re-scope). Additive changes to the existing
-- `notifications` table (20260101000009) and its policies/trigger
-- (20260101000014, 20260101000016); neither earlier migration is edited.
--
-- 1. Sender identity. `created_by_auth_user_id` records who sent a
--    notification. Nullable so a future system-generated notification
--    (no human sender) stays valid, and so existing rows remain valid.
--    For an application insert it is not trusted from the client: the
--    insert policy below requires it to equal auth.uid(). ON DELETE SET
--    NULL keeps a recipient's notification when the sender's account is
--    later deleted; the protection trigger below exempts that internal
--    cascade (it runs with no application JWT), never an application role.
--
-- 2. Admin/Super Admin read access narrowed (approved decision C3): no
--    more read-all "for support". Every user reads only notifications
--    addressed to them; an Admin/Super Admin additionally reads only the
--    notifications they themselves sent (sender history).
--
-- 3. Sent content immutable for every application role, Admin included
--    (approved decision C4). The Admin UPDATE and DELETE policies are
--    dropped; recipients keep their own-row UPDATE policy, and the
--    replaced trigger lets them change only status/read_at. No
--    application role can hard-delete a notification (no DELETE policy
--    exists for anyone).

alter table notifications
  add column if not exists created_by_auth_user_id uuid
    references auth.users (id) on delete set null;

comment on column notifications.created_by_auth_user_id is
  'auth.users id of the sender, or null for a system-generated notification. For an application insert, RLS requires this to equal auth.uid() — never client-chosen.';

-- Inbox list (recipient, newest first) and sender history (sender, newest
-- first). The unread count is already served by notifications_recipient_idx
-- (recipient_auth_user_id, status) from 20260101000009.
create index if not exists notifications_recipient_created_idx
  on notifications (recipient_auth_user_id, created_at desc);
create index if not exists notifications_created_by_created_idx
  on notifications (created_by_auth_user_id, created_at desc);

-- Content and read-state integrity. Plain-text title/body only (rendered
-- as text by the application, never as HTML).
alter table notifications
  drop constraint if exists notifications_title_length_check;
alter table notifications
  add constraint notifications_title_length_check
    check (char_length(btrim(title)) between 1 and 200);

alter table notifications
  drop constraint if exists notifications_body_length_check;
alter table notifications
  add constraint notifications_body_length_check
    check (body is null or char_length(body) <= 2000);

alter table notifications
  drop constraint if exists notifications_read_state_check;
alter table notifications
  add constraint notifications_read_state_check
    check ((status = 'read') = (read_at is not null));

-- ---------------------------------------------------------------------------
-- Policies.

drop policy if exists notifications_select_admin on notifications;
drop policy if exists notifications_write_admin on notifications;
drop policy if exists notifications_update_admin on notifications;
drop policy if exists notifications_delete_admin on notifications;

-- notifications_select_own (recipient_auth_user_id = auth.uid()) and
-- notifications_update_own (same, using + with check) from 20260101000014
-- are kept unchanged.

drop policy if exists notifications_select_sent_by_self on notifications;
create policy notifications_select_sent_by_self on notifications
  for select using (
    created_by_auth_user_id = auth.uid() and is_admin_or_super()
  );

-- An Admin/Super Admin may create only a V1 admin message: sent as
-- themselves, unread, in-app, addressed to an existing Student or Trainer
-- account. user_roles is readable by Admin/Super Admin
-- (user_roles_select_admin), so the recipient check runs under the
-- caller's own RLS without any SECURITY DEFINER helper.
drop policy if exists notifications_insert_admin_message on notifications;
create policy notifications_insert_admin_message on notifications
  for insert with check (
    is_admin_or_super()
    and created_by_auth_user_id = auth.uid()
    and type = 'admin_message'
    and channel = 'in_app'
    and status = 'unread'
    and read_at is null
    and exists (
      select 1 from user_roles r
      where r.auth_user_id = notifications.recipient_auth_user_id
        and r.role in ('student', 'trainer')
    )
  );

-- ---------------------------------------------------------------------------
-- Protection trigger (replaces the 20260101000014 function body; the
-- trigger itself already exists and keeps pointing at this function).
-- Application sessions always carry an `anon` or `authenticated` JWT role
-- (PostgREST sets it on every request), so those are the sessions held to
-- the immutability rule — Admin/Super Admin included now. service_role and
-- internal database work with no JWT at all (migrations, or the ON DELETE
-- SET NULL cascade when GoTrue deletes a sender's account) are exempt.

create or replace function prevent_notification_self_edit_of_protected_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;

  if new.recipient_auth_user_id is distinct from old.recipient_auth_user_id
    or new.created_by_auth_user_id is distinct from old.created_by_auth_user_id
    or new.type is distinct from old.type
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.data is distinct from old.data
    or new.channel is distinct from old.channel
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Only status/read_at may change on a notification after it is sent.';
  end if;
  return new;
end;
$$;

comment on function prevent_notification_self_edit_of_protected_fields() is
  'Sent notifications are immutable for every application role (anon/authenticated JWT, Admin included): only status/read_at may change. service_role and internal no-JWT work are exempt.';

-- create or replace keeps the existing grants, but restate the minimum
-- (none) explicitly, matching 20260101000016: the function is invoked only
-- by its BEFORE UPDATE trigger.
revoke execute on function prevent_notification_self_edit_of_protected_fields() from public, anon, authenticated;
