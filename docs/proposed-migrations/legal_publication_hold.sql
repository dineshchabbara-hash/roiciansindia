-- =============================================================================
-- PREPARED FOR REVIEW ONLY. NOT APPLIED. NOT IN supabase/migrations/.
--
-- Phase 22B-1 identified that the legal-page publishing hold is enforced only
-- by the Admin UI and the server action: a signed-in Admin can still call
-- website_publish_document() directly (PHASE_22B1_SECURITY_AND_TESTING_GATES.md
-- §B). This proposal closes that gap in the database. It needs, in order:
--   1. owner review and approval of this design;
--   2. a verified migration number at approval time;
--   3. a run of legal_publication_hold_test.sql in an isolated local database;
--   4. separate authorization for DEV, then production.
-- It is NOT part of the approved 22B-1 code scope and does not block 22B-1.
-- =============================================================================
--
-- Design (revision-specific, not a global switch):
--   - A legal page's wording is approved PER REVISION by a Super Admin. The
--     approval records who approved it, when, and an optional reference note.
--   - The database refuses to make any legal-page revision live unless that
--     exact revision has an approval. A guard trigger on website_documents
--     enforces this for EVERY writer: the 22A publish function, a direct RPC
--     call, and direct SQL.
--   - Any later edit or restore creates a new revision, which has no approval
--     until a Super Admin approves it. Unpublishing is always allowed.
--   - Approvals are immutable. Ordinary Admins can read them but cannot create,
--     change or delete them. Only the security-definer approval function
--     writes them, after checking for an active Super Admin.
--   - Other page kinds are unaffected.

-- 1. Approval records -------------------------------------------------------------

create table if not exists website_legal_approvals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  revision_id uuid not null,
  approved_by uuid not null references auth.users (id) on delete restrict,
  approved_at timestamptz not null default now(),
  approval_note text,
  -- the approved revision must belong to the document
  constraint website_legal_approvals_revision_fk
    foreign key (document_id, revision_id)
    references website_document_revisions (document_id, id) on delete restrict,
  constraint website_legal_approvals_revision_key unique (revision_id),
  constraint website_legal_approvals_note_len
    check (approval_note is null or char_length(approval_note) <= 500)
);

comment on table website_legal_approvals is
  'Proposal (22B-1 follow-up): business/legal approval of one exact legal-page revision. Immutable. Written only by website_approve_legal_revision() for an active Super Admin; required before a legal revision can be published.';

alter table website_legal_approvals enable row level security;

create policy website_legal_approvals_select_admin on website_legal_approvals
  for select using (is_admin_or_super());

revoke all on website_legal_approvals from public, anon, authenticated;
grant select on website_legal_approvals to authenticated;

-- Approvals can never be changed or removed, even by direct SQL.
create or replace function prevent_website_legal_approval_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = '42501', message = 'A legal approval cannot be changed or removed';
end;
$$;

create trigger website_legal_approvals_immutable
  before update or delete on website_legal_approvals
  for each row execute function prevent_website_legal_approval_change();

-- 2. Approval function (active Super Admin only) ---------------------------------------

create or replace function website_approve_legal_revision(
  p_document_id uuid,
  p_revision_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d website_documents;
  v_id uuid;
  v_number integer;
begin
  if auth.uid() is null or not is_super_admin() then
    raise exception using errcode = '42501', message = 'Only an active Super Admin may approve legal wording';
  end if;
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null then
    raise exception using errcode = 'P2204', message = 'Website document not found';
  end if;
  if d.kind <> 'legal' then
    raise exception using errcode = 'P2206', message = 'Only legal pages need wording approval';
  end if;
  select revision_number into v_number
    from website_document_revisions
   where id = p_revision_id and document_id = d.id;
  if v_number is null then
    raise exception using errcode = 'P2204', message = 'That revision does not belong to this page';
  end if;
  if exists (select 1 from website_legal_approvals a where a.revision_id = p_revision_id) then
    raise exception using errcode = 'P2206', message = 'This revision is already approved';
  end if;

  insert into website_legal_approvals (document_id, revision_id, approved_by, approval_note)
  values (d.id, p_revision_id, auth.uid(),
          website_clean_text(p_note, 'Approval note', 500))
  returning id into v_id;

  perform website_audit('website_document.legal_revision_approved', 'website_document', d.id, null,
    jsonb_build_object('revisionId', p_revision_id, 'revisionNumber', v_number, 'approvalId', v_id));
  return v_id;
end;
$$;

comment on function website_approve_legal_revision(uuid, uuid, text) is
  'Proposal (22B-1 follow-up): records business/legal approval of one exact legal-page revision. Active Super Admin only; audited; immutable.';

revoke execute on function website_approve_legal_revision(uuid, uuid, text) from public, anon, authenticated;
grant execute on function website_approve_legal_revision(uuid, uuid, text) to authenticated;

-- 3. Publication guard for every writer ------------------------------------------------

create or replace function guard_legal_publication()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'legal'
     and new.published_revision_id is not null
     and new.published_revision_id is distinct from old.published_revision_id
     and not exists (
       select 1 from website_legal_approvals a
        where a.document_id = new.id and a.revision_id = new.published_revision_id
     ) then
    raise exception using errcode = 'P2206',
      message = 'This legal wording has not been approved for publication';
  end if;
  return new;
end;
$$;

comment on function guard_legal_publication() is
  'Proposal (22B-1 follow-up): a legal page can only publish a revision that a Super Admin has approved. Fires for every writer.';

revoke execute on function guard_legal_publication() from public, anon, authenticated;
revoke execute on function prevent_website_legal_approval_change() from public, anon, authenticated;

create trigger website_documents_legal_publication_guard
  before update of published_revision_id on website_documents
  for each row execute function guard_legal_publication();
