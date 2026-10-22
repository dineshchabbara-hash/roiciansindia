-- PREPARED FOR REVIEW ONLY. NOT RUN. Not wired into scripts/test-rls.sh.
-- Regression suite for docs/proposed-migrations/legal_publication_hold.sql, to
-- be run in an isolated local database after migrations 1-42 and the proposal,
-- once approved. It follows the conventions of
-- supabase/tests/phase22a_website_foundation_test.sql.
--
--   L1 An Admin cannot publish an unapproved legal revision, either through
--      website_publish_document() or by a direct table write.
--   L2 An Admin cannot approve legal wording or write approvals directly.
--   L3 A Super Admin approves one exact revision; that revision then publishes.
--   L4 A later draft, or a restore of the approved revision, is a new revision
--      and is refused until it is approved too. Unpublishing still works.
--   L5 Approvals are immutable, even for the table owner.
--   L6 Other page kinds publish exactly as before.
--   L7 Trainer, Student and anon cannot approve.
--
-- Ends with ROLLBACK. Fixture ids use the 1e9… prefix.

begin;

insert into auth.users (id, email) values
  ('1e900000-0000-0000-0000-000000000001', 'legal-super@validation.local'),
  ('1e900000-0000-0000-0000-000000000002', 'legal-admin@validation.local'),
  ('1e900000-0000-0000-0000-000000000003', 'legal-trainer@validation.local');

insert into user_roles (auth_user_id, role) values
  ('1e900000-0000-0000-0000-000000000001', 'super_admin'),
  ('1e900000-0000-0000-0000-000000000002', 'admin'),
  ('1e900000-0000-0000-0000-000000000003', 'trainer');

insert into admins (auth_user_id, first_name, last_name, email, role_level, status) values
  ('1e900000-0000-0000-0000-000000000001', 'Legal', 'Super', 'legal-super@validation.local', 'super_admin', 'active'),
  ('1e900000-0000-0000-0000-000000000002', 'Legal', 'Admin', 'legal-admin@validation.local', 'admin', 'active');

create temporary table legal_ids (name text primary key, id uuid) on commit drop;
grant all on legal_ids to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Admin drafts a legal page and a Contact page.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"1e900000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  doc uuid;
  contact uuid;
  r record;
begin
  doc := website_create_page('legal', 'legal-test-terms');
  select * into r from website_save_draft(doc, 0, 'Terms of use', null, null, null, null, null, null, null,
    '[{"key":"terms","type":"text","visible":true,"body":"Draft wording."}]'::jsonb);
  insert into legal_ids values ('doc', doc), ('rev1', r.revision_id);

  contact := website_create_page('contact', 'legal-test-contact');
  select * into r from website_save_draft(contact, 0, 'Contact', null, null, null, null, null, null, null, '[]'::jsonb);
  insert into legal_ids values ('contact', contact), ('contact_rev', r.revision_id);
end
$$;

-- L1 / L2 / L6
do $$
declare
  doc uuid := (select id from legal_ids where name = 'doc');
  rev1 uuid := (select id from legal_ids where name = 'rev1');
begin
  begin
    perform website_publish_document(doc, rev1);
    raise exception 'FAIL: an unapproved legal revision was published through the RPC';
  exception when sqlstate 'P2206' then null;
  end;
  begin
    perform website_approve_legal_revision(doc, rev1, 'self-approval');
    raise exception 'FAIL: an Admin approved legal wording';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into website_legal_approvals (document_id, revision_id, approved_by)
    values (doc, rev1, '1e900000-0000-0000-0000-000000000002');
    raise exception 'FAIL: an Admin wrote an approval row directly';
  exception when insufficient_privilege then null;
  end;
  perform website_publish_document((select id from legal_ids where name = 'contact'),
                                   (select id from legal_ids where name = 'contact_rev'));
  raise notice 'PASS: L1/L2/L6 unapproved legal publish refused; Admin cannot approve; Contact publishes normally';
end
$$;

-- L1 via direct SQL as the table owner (bypasses RLS and the publish function).
reset role;
do $$
begin
  update website_documents
     set published_revision_id = (select id from legal_ids where name = 'rev1'),
         published_at = now(), first_published_at = now()
   where id = (select id from legal_ids where name = 'doc');
  raise exception 'FAIL: a direct write published unapproved legal wording';
exception when sqlstate 'P2206' then
  raise notice 'PASS: L1 the guard trigger also stops direct writes';
end
$$;

-- L3 Super Admin approves revision 1; it publishes.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"1e900000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare
  doc uuid := (select id from legal_ids where name = 'doc');
  rev1 uuid := (select id from legal_ids where name = 'rev1');
begin
  perform website_approve_legal_revision(doc, rev1, 'Approved by counsel, ref T-1');
  perform website_publish_document(doc, rev1);
  if (select published_revision_id from website_documents where id = doc) is distinct from rev1 then
    raise exception 'FAIL: the approved revision did not publish';
  end if;
  if not exists (select 1 from audit_logs where entity_id = doc and action = 'website_document.legal_revision_approved') then
    raise exception 'FAIL: approval was not audited';
  end if;
  raise notice 'PASS: L3 approved revision publishes; approval audited';
end
$$;

-- L4 a new draft and a restore both need fresh approval; unpublish is allowed.
set local "request.jwt.claims" to '{"sub":"1e900000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  doc uuid := (select id from legal_ids where name = 'doc');
  rev1 uuid := (select id from legal_ids where name = 'rev1');
  r record;
begin
  select * into r from website_save_draft(doc, 1, 'Terms of use', null, null, null, null, null, null, null,
    '[{"key":"terms","type":"text","visible":true,"body":"Changed wording."}]'::jsonb);
  begin
    perform website_publish_document(doc, r.revision_id);
    raise exception 'FAIL: an edited, unapproved revision was published';
  exception when sqlstate 'P2206' then null;
  end;
  select * into r from website_restore_revision(doc, rev1, 2);
  begin
    perform website_publish_document(doc, r.revision_id);
    raise exception 'FAIL: a restored copy was published without its own approval';
  exception when sqlstate 'P2206' then null;
  end;
  perform website_unpublish_document(doc, (select version from website_documents where id = doc));
  raise notice 'PASS: L4 new and restored revisions need approval; unpublish allowed';
end
$$;

-- L5 approvals are immutable, even for the owner.
reset role;
do $$
begin
  begin
    update website_legal_approvals set approval_note = 'edited';
    raise exception 'FAIL: an approval was changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from website_legal_approvals;
    raise exception 'FAIL: an approval was deleted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: L5 approvals are immutable';
end
$$;

-- L7 other roles cannot approve.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"1e900000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  perform website_approve_legal_revision((select id from legal_ids where name = 'doc'),
                                         (select id from legal_ids where name = 'rev1'), null);
  raise exception 'FAIL: a Trainer approved legal wording';
exception when insufficient_privilege then
  raise notice 'PASS: L7 Trainer cannot approve';
end
$$;

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $$
begin
  perform website_approve_legal_revision((select id from legal_ids where name = 'doc'),
                                         (select id from legal_ids where name = 'rev1'), null);
  raise exception 'FAIL: anon approved legal wording';
exception when insufficient_privilege then
  raise notice 'PASS: L7 anon cannot approve';
end
$$;
reset role;

rollback;
