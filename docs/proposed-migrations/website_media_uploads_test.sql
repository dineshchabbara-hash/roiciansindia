-- PREPARED FOR REVIEW ONLY. Not wired into scripts/test-rls.sh. Run only in throwaway local databases (run_website_media_uploads_sql_tests.sh).
-- Regression suite for docs/proposed-migrations/website_media_uploads.sql, to
-- be run in an isolated local database after migrations 1-42, then
-- website_media_uploads_harness_stub.sql (plain-Postgres harness only), then
-- the proposal, once approved. Follows the conventions of
-- supabase/tests/phase22a_website_foundation_test.sql.
--
--   M1 Bucket stays private with 5 MiB and JPEG/PNG/WebP limits; exactly
--      three website-media storage policies (read, upload, delete) and no
--      update policy; every storage policy is bucket-scoped; grants; path rule.
--   M2 Upload: active Admin and Super Admin, safe paths only; Trainer,
--      Student, anon and inactive Admin refused.
--   M3 No overwrite or move (no update policy); no upload at a recorded path.
--   M4 Read isolation: Trainer, Student and anon see no website-media files.
--   M5 Recording checks the stored file: exists, caller's own upload, size
--      and type as stored, dimensions present; no direct table writes.
--   M6 Delete: only unrecorded files; own at once, others' after 24 hours;
--      recorded files never; Trainer and inactive Admin never.
--   M7 Incomplete uploads list: unrecorded and older than 24 hours only;
--      Admins only.
--   M8 Approval needs alt text; images used by published content cannot be
--      withdrawn or retired; retired images cannot enter new content; stale
--      versions refused; every change audited with status and alt text
--      before and after.
--   M9 Other buckets: website helpers never appear in their policies.
--
-- Ends with ROLLBACK. Fixture ids use the b3… prefix. Storage metadata (size,
-- mimetype) is set by the test as Supabase Storage would set it on upload.

begin;

insert into auth.users (id, email) values
  ('b3000000-0000-0000-0000-000000000001', 'media-super@validation.local'),
  ('b3000000-0000-0000-0000-000000000002', 'media-admin@validation.local'),
  ('b3000000-0000-0000-0000-000000000003', 'media-admin2@validation.local'),
  ('b3000000-0000-0000-0000-000000000004', 'media-trainer@validation.local'),
  ('b3000000-0000-0000-0000-000000000005', 'media-student@validation.local'),
  ('b3000000-0000-0000-0000-000000000006', 'media-inactive@validation.local');

insert into user_roles (auth_user_id, role) values
  ('b3000000-0000-0000-0000-000000000001', 'super_admin'),
  ('b3000000-0000-0000-0000-000000000002', 'admin'),
  ('b3000000-0000-0000-0000-000000000003', 'admin'),
  ('b3000000-0000-0000-0000-000000000004', 'trainer'),
  ('b3000000-0000-0000-0000-000000000005', 'student'),
  ('b3000000-0000-0000-0000-000000000006', 'admin');

insert into admins (auth_user_id, first_name, last_name, email, role_level, status) values
  ('b3000000-0000-0000-0000-000000000001', 'Media', 'Super', 'media-super@validation.local', 'super_admin', 'active'),
  ('b3000000-0000-0000-0000-000000000002', 'Media', 'Admin', 'media-admin@validation.local', 'admin', 'active'),
  ('b3000000-0000-0000-0000-000000000003', 'Media', 'AdminTwo', 'media-admin2@validation.local', 'admin', 'active'),
  ('b3000000-0000-0000-0000-000000000006', 'Media', 'Inactive', 'media-inactive@validation.local', 'admin', 'inactive');

create temporary table b3_ids (k text primary key, v uuid) on commit drop;
grant all on b3_ids to authenticated, anon;

-- Paths used below (all lower-case uuid folders).
--   ...a001/hero.png      Admin, recorded as a1
--   ...a002/banner.webp   Admin, recorded as a2
--   ...a003/other.jpg     Admin 2 (Admin may not record it)
--   ...a004/tmp.png       Admin, never recorded (own delete)
--   ...a005/tmp.png       Admin 2, never recorded (others' delete after 24h)
--   ...a006/young.png     Admin, never recorded, recent (not listed)

-- ---------------------------------------------------------------------------
-- M1 Bucket, policies, grants and the path rule.

do $$
declare
  bad text;
  pol_text text;
begin
  if not exists (
    select 1 from storage.buckets
     where id = 'website-media' and public = false and file_size_limit = 5242880
       and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'FAIL: website-media bucket is not private with 5 MiB and JPEG/PNG/WebP limits';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and coalesce(qual, '') || coalesce(with_check, '') like '%website-media%') <> 3 then
    raise exception 'FAIL: expected exactly three website-media storage policies';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
                and coalesce(qual, '') || coalesce(with_check, '') like '%website-media%') then
    raise exception 'FAIL: website-media has an update policy (overwrite would be possible)';
  end if;
  for pol_text in
    select coalesce(qual, '') || coalesce(with_check, '') from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
  loop
    if pol_text not like '%bucket_id%' then
      raise exception 'FAIL: a storage policy is not limited to a bucket: %', pol_text;
    end if;
  end loop;

  if has_function_privilege('anon', 'website_incomplete_media_uploads()', 'execute')
     or has_function_privilege('anon', 'website_register_media_asset(text, text, integer, integer, integer, text)', 'execute')
     or has_function_privilege('anon', 'website_update_media_asset(uuid, integer, text, text)', 'execute')
     or has_function_privilege('anon', 'website_media_object_is_registered(text)', 'execute') then
    raise exception 'FAIL: anon can execute a media function';
  end if;
  if not has_function_privilege('authenticated', 'website_incomplete_media_uploads()', 'execute')
     or not has_function_privilege('authenticated', 'website_media_path_is_valid(text)', 'execute')
     or not has_function_privilege('authenticated', 'website_media_object_is_registered(text)', 'execute') then
    raise exception 'FAIL: authenticated is missing a media function grant';
  end if;

  if not website_media_path_is_valid('b3000000-0000-4000-8000-00000000a001/hero.png')
     or not website_media_path_is_valid('b3000000-0000-4000-8000-00000000a001/Team_Photo-2.JPEG') then
    raise exception 'FAIL: a safe path was refused';
  end if;
  foreach bad in array array[
    'hero.png',
    'B3000000-0000-4000-8000-00000000A001/hero.png',
    'b3000000-0000-4000-8000-00000000a001/nested/hero.png',
    'b3000000-0000-4000-8000-00000000a001/hero.svg',
    'b3000000-0000-4000-8000-00000000a001/page.html',
    'b3000000-0000-4000-8000-00000000a001/.hidden.png',
    'b3000000-0000-4000-8000-00000000a001/a..b.png',
    '../b3000000-0000-4000-8000-00000000a001/hero.png',
    'b3000000-0000-4000-8000-00000000a001/hero.png.exe',
    'b3000000-0000-4000-8000-00000000a001/'
  ] loop
    if website_media_path_is_valid(bad) then
      raise exception 'FAIL: unsafe path accepted: %', bad;
    end if;
  end loop;
  if website_media_path_is_valid(null) then
    raise exception 'FAIL: null path accepted';
  end if;
  raise notice 'PASS M1: bucket private with limits; three bucket-scoped website-media policies, no update policy; grants; safe paths only';
end
$$;

-- ---------------------------------------------------------------------------
-- M2 Upload policy.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b3000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  bad text;
  me uuid := 'b3000000-0000-0000-0000-000000000002';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('website-media', 'b3000000-0000-4000-8000-00000000a001/hero.png', me, me::text),
    ('website-media', 'b3000000-0000-4000-8000-00000000a002/banner.webp', me, me::text),
    ('website-media', 'b3000000-0000-4000-8000-00000000a004/tmp.png', me, me::text),
    ('website-media', 'b3000000-0000-4000-8000-00000000a006/young.png', me, me::text);
  foreach bad in array array[
    'hero.png',
    'b3000000-0000-4000-8000-00000000a0aa/nested/hero.png',
    'b3000000-0000-4000-8000-00000000a0aa/hero.svg',
    'b3000000-0000-4000-8000-00000000a0aa/page.html',
    '../escape.png'
  ] loop
    begin
      insert into storage.objects (bucket_id, name, owner, owner_id) values ('website-media', bad, me, me::text);
      raise exception 'FAIL: Admin uploaded to an unsafe path: %', bad;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS M2a: active Admin uploads safe paths; unsafe paths refused';
end
$$;

set local "request.jwt.claims" to '{"sub":"b3000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  me uuid := 'b3000000-0000-0000-0000-000000000003';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('website-media', 'b3000000-0000-4000-8000-00000000a003/other.jpg', me, me::text),
    ('website-media', 'b3000000-0000-4000-8000-00000000a005/tmp.png', me, me::text);
end
$$;

set local "request.jwt.claims" to '{"sub":"b3000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  me uuid := 'b3000000-0000-0000-0000-000000000001';
begin
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('website-media', 'b3000000-0000-4000-8000-00000000a007/super.png', me, me::text);
end
$$;

do $$
declare
  who text;
begin
  foreach who in array array[
    'b3000000-0000-0000-0000-000000000004',  -- Trainer
    'b3000000-0000-0000-0000-000000000005',  -- Student
    'b3000000-0000-0000-0000-000000000006'   -- inactive Admin
  ] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
    begin
      insert into storage.objects (bucket_id, name, owner, owner_id)
      values ('website-media', 'b3000000-0000-4000-8000-00000000a0bb/x.png', who::uuid, who);
      raise exception 'FAIL: % uploaded to website-media', who;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS M2b: Super Admin uploads; Trainer, Student and inactive Admin refused';
end
$$;

reset role;
set local role anon;
set local "request.jwt.claims" to '{"role":"anon"}';
do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values ('website-media', 'b3000000-0000-4000-8000-00000000a0cc/x.png');
    raise exception 'FAIL: anon uploaded to website-media';
  exception when insufficient_privilege then null;
  end;
  -- Existing LMS storage policies (migrations 18-32) apply to every role and
  -- call helpers anon cannot execute, so an anon read of storage.objects is
  -- refused outright. Zero rows and a permission refusal both mean anon sees
  -- nothing; any visible row fails.
  begin
    if (select count(*) from storage.objects where bucket_id = 'website-media') <> 0 then
      raise exception 'FAIL: anon can see website-media files';
    end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS M2c/M4a: anon cannot upload or list website-media files';
end
$$;
reset role;

-- Storage records size and type on upload; simulate that.
update storage.objects set metadata = '{"size": 20480, "mimetype": "image/png"}'
 where bucket_id = 'website-media' and name like '%/hero.png';
update storage.objects set metadata = '{"size": 30720, "mimetype": "image/webp"}'
 where bucket_id = 'website-media' and name like '%/banner.webp';
update storage.objects set metadata = '{"size": 1024, "mimetype": "image/jpeg"}'
 where bucket_id = 'website-media' and name like '%/other.jpg';
update storage.objects set metadata = '{"size": 512, "mimetype": "image/png"}'
 where bucket_id = 'website-media' and metadata is null;

-- ---------------------------------------------------------------------------
-- M4 Read isolation for Trainer and Student.

set local role authenticated;
do $$
declare
  who text;
begin
  foreach who in array array['b3000000-0000-0000-0000-000000000004', 'b3000000-0000-0000-0000-000000000005',
                              'b3000000-0000-0000-0000-000000000006'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
    if (select count(*) from storage.objects where bucket_id = 'website-media') <> 0 then
      raise exception 'FAIL: % can see website-media files', who;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  if (select count(*) from storage.objects where bucket_id = 'website-media') < 6 then
    raise exception 'FAIL: Admin cannot see website-media files';
  end if;
  raise notice 'PASS M4: Trainer, Student and inactive Admin see no website-media files; Admin does';
end
$$;

-- ---------------------------------------------------------------------------
-- M5 Recording checks the stored file.

set local "request.jwt.claims" to '{"sub":"b3000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  a1 uuid;
  a2 uuid;
begin
  begin
    perform website_register_media_asset('b3000000-0000-4000-8000-00000000a0dd/missing.png', 'image/png', 100, 10, 10, null);
    raise exception 'FAIL: recorded a file that was never uploaded';
  exception when sqlstate 'P2204' then null;
  end;
  begin
    perform website_register_media_asset('b3000000-0000-4000-8000-00000000a003/other.jpg', 'image/jpeg', 1024, 10, 10, null);
    raise exception 'FAIL: recorded another Admin''s upload';
  exception when insufficient_privilege then null;
  end;
  begin
    perform website_register_media_asset('b3000000-0000-4000-8000-00000000a001/hero.png', 'image/png', 99999, 1600, 900, null);
    raise exception 'FAIL: recorded a size different from the stored file';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform website_register_media_asset('b3000000-0000-4000-8000-00000000a001/hero.png', 'image/jpeg', 20480, 1600, 900, null);
    raise exception 'FAIL: recorded a type different from the stored file';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform website_register_media_asset('b3000000-0000-4000-8000-00000000a001/hero.png', 'image/png', 20480, null, 900, null);
    raise exception 'FAIL: recorded an image without dimensions';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform website_register_media_asset('b3000000-0000-4000-8000-00000000a001/hero.png', 'image/svg+xml', 20480, 1600, 900, null);
    raise exception 'FAIL: recorded an SVG';
  exception when sqlstate '22023' then null;
  end;

  a1 := website_register_media_asset('b3000000-0000-4000-8000-00000000a001/hero.png', 'image/png', 20480, 1600, 900, null);
  a2 := website_register_media_asset('b3000000-0000-4000-8000-00000000a002/banner.webp', 'image/webp', 30720, 1200, 400, 'Sample banner');
  insert into b3_ids values ('a1', a1), ('a2', a2);
  if (select status from website_media_assets where id = a1) <> 'draft' then
    raise exception 'FAIL: a recorded image is not Draft';
  end if;
  begin
    perform website_register_media_asset('b3000000-0000-4000-8000-00000000a001/hero.png', 'image/png', 20480, 1600, 900, null);
    raise exception 'FAIL: recorded the same file twice';
  exception when unique_violation then null;
  end;
  begin
    insert into website_media_assets (storage_path, mime_type, byte_size, width, height)
    values ('b3000000-0000-4000-8000-00000000a004/tmp.png', 'image/png', 512, 1, 1);
    raise exception 'FAIL: Admin wrote website_media_assets directly';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS M5a: recording requires the caller''s own stored file with matching size and type and dimensions; no duplicates; no direct writes';
end
$$;

do $$
declare
  who text;
begin
  foreach who in array array['b3000000-0000-0000-0000-000000000004', 'b3000000-0000-0000-0000-000000000006'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
    begin
      perform website_register_media_asset('b3000000-0000-4000-8000-00000000a004/tmp.png', 'image/png', 512, 1, 1, null);
      raise exception 'FAIL: % recorded media', who;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS M5b: Trainer and inactive Admin cannot record media';
end
$$;

reset role;
do $$
begin
  if not exists (
    select 1 from audit_logs
     where entity_id = (select v from b3_ids where k = 'a2')
       and action = 'website_media_asset.registered'
       and after_data ->> 'width' = '1200' and after_data ->> 'status' = 'draft'
       and actor_auth_user_id = 'b3000000-0000-0000-0000-000000000002'
  ) then
    raise exception 'FAIL: registration not audited with its details';
  end if;
  raise notice 'PASS M5c: registration audited';
end
$$;

-- ---------------------------------------------------------------------------
-- M3 No overwrite or move; no upload at a recorded path.

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b3000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  n integer;
  me uuid := 'b3000000-0000-0000-0000-000000000002';
begin
  update storage.objects set metadata = '{"size": 1, "mimetype": "image/png"}', name = 'b3000000-0000-4000-8000-00000000a0ee/moved.png'
   where bucket_id = 'website-media';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL: an Admin changed or moved a website-media file';
  end if;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values ('website-media', 'b3000000-0000-4000-8000-00000000a001/hero.png', me, me::text);
    raise exception 'FAIL: uploaded over a recorded image path';
  exception when insufficient_privilege or unique_violation then null;
  end;
  raise notice 'PASS M3: no overwrite, upsert or move; recorded paths cannot be uploaded again';
end
$$;

-- ---------------------------------------------------------------------------
-- M6 Delete policy.

do $$
declare
  n integer;
begin
  -- Admin deletes their own unrecorded upload straight away.
  delete from storage.objects where bucket_id = 'website-media' and name = 'b3000000-0000-4000-8000-00000000a004/tmp.png';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: uploader could not remove their own unrecorded file'; end if;
  -- Admin cannot delete another Admin's recent unrecorded upload.
  delete from storage.objects where bucket_id = 'website-media' and name = 'b3000000-0000-4000-8000-00000000a005/tmp.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: removed another Admin''s recent upload'; end if;
  -- Nobody deletes a recorded file, not even its uploader.
  delete from storage.objects where bucket_id = 'website-media' and name = 'b3000000-0000-4000-8000-00000000a001/hero.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: removed a recorded image'; end if;
  raise notice 'PASS M6a: own unrecorded file removable; others'' recent files and recorded files are not';
end
$$;

reset role;
update storage.objects set created_at = now() - interval '25 hours'
 where bucket_id = 'website-media' and name in (
   'b3000000-0000-4000-8000-00000000a005/tmp.png',
   'b3000000-0000-4000-8000-00000000a001/hero.png',
   'b3000000-0000-4000-8000-00000000a003/other.jpg');

-- M7 Incomplete uploads list (before any further delete).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"b3000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  listed text[];
begin
  select array_agg(storage_path order by storage_path) into listed from website_incomplete_media_uploads();
  if listed is distinct from array[
       'b3000000-0000-4000-8000-00000000a003/other.jpg',
       'b3000000-0000-4000-8000-00000000a005/tmp.png'] then
    raise exception 'FAIL: incomplete uploads list is wrong: %', listed;
  end if;
  if exists (select 1 from website_incomplete_media_uploads() where uploaded_by_me) then
    raise exception 'FAIL: another Admin''s file is marked as mine';
  end if;
  raise notice 'PASS M7a: only unrecorded files older than 24 hours are listed (recorded and recent files are not)';
end
$$;

do $$
declare
  who text;
begin
  foreach who in array array['b3000000-0000-0000-0000-000000000004', 'b3000000-0000-0000-0000-000000000006'] loop
    perform set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', who), true);
    begin
      perform website_incomplete_media_uploads();
      raise exception 'FAIL: % listed incomplete uploads', who;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS M7b: Trainer and inactive Admin cannot list incomplete uploads';
end
$$;

do $$
declare
  n integer;
begin
  -- Trainer and inactive Admin cannot delete even an old unrecorded file.
  perform set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  delete from storage.objects where bucket_id = 'website-media' and name = 'b3000000-0000-4000-8000-00000000a005/tmp.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Trainer removed a website-media file'; end if;
  perform set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
  delete from storage.objects where bucket_id = 'website-media' and name = 'b3000000-0000-4000-8000-00000000a005/tmp.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: inactive Admin removed a website-media file'; end if;
  -- Any active Admin removes an unrecorded file after 24 hours; never a recorded one.
  perform set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  delete from storage.objects where bucket_id = 'website-media' and name = 'b3000000-0000-4000-8000-00000000a005/tmp.png';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: Admin could not remove an abandoned upload after 24 hours'; end if;
  delete from storage.objects where bucket_id = 'website-media' and name = 'b3000000-0000-4000-8000-00000000a001/hero.png';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: removed a recorded image after 24 hours'; end if;
  raise notice 'PASS M6b: abandoned uploads removable by any active Admin after 24 hours; recorded files never; Trainer and inactive Admin never';
end
$$;

-- ---------------------------------------------------------------------------
-- M8 Approval, publishing rules and audit.

do $$
declare
  a1 uuid := (select v from b3_ids where k = 'a1');
  a2 uuid := (select v from b3_ids where k = 'a2');
  doc uuid;
  r record;
  v1 integer;
  v2 integer;
begin
  begin
    perform website_update_media_asset(a1, 1, null, 'approved');
    raise exception 'FAIL: approved an image without alt text';
  exception when sqlstate '22023' then null;
  end;
  v1 := website_update_media_asset(a1, 1, 'Learners in a classroom (sample)', 'draft');
  begin
    perform website_update_media_asset(a1, 1, 'Stale edit', 'draft');
    raise exception 'FAIL: stale media update accepted';
  exception when sqlstate 'P2203' then null;
  end;
  v1 := website_update_media_asset(a1, v1, 'Learners in a classroom (sample)', 'approved');

  doc := website_create_page('about', 'about-media-test');
  insert into b3_ids values ('doc', doc);
  select * into r from website_save_draft(doc, 0, 'About us', null, null, null, null, null, a1, null, '[]');
  perform website_publish_document(doc, r.revision_id);

  begin
    perform website_update_media_asset(a1, v1, 'Learners in a classroom (sample)', 'draft');
    raise exception 'FAIL: withdrew approval of an image used by published content';
  exception when sqlstate 'P2206' then null;
  end;
  begin
    perform website_update_media_asset(a1, v1, 'Learners in a classroom (sample)', 'retired');
    raise exception 'FAIL: retired an image used by published content';
  exception when sqlstate 'P2206' then null;
  end;

  -- a2: approve, retire, then it cannot enter new content; restore to draft.
  v2 := website_update_media_asset(a2, 1, 'Sample banner', 'approved');
  v2 := website_update_media_asset(a2, v2, 'Sample banner', 'retired');
  begin
    perform website_save_draft(doc, (select latest_revision_number from website_documents where id = doc),
      'About us', null, null, null, null, null, a2, null, '[]');
    raise exception 'FAIL: a retired image was put into new content';
  exception when sqlstate 'P2206' then null;
  end;
  v2 := website_update_media_asset(a2, v2, 'Sample banner', 'draft');
  if (select status from website_media_assets where id = a2) <> 'draft' then
    raise exception 'FAIL: retired image not restored to Draft';
  end if;
  raise notice 'PASS M8a: approval needs alt text; stale refused; published images keep approval; retired images cannot enter content; restore returns to Draft';
end
$$;

reset role;
do $$
declare
  a1 uuid := (select v from b3_ids where k = 'a1');
  a2 uuid := (select v from b3_ids where k = 'a2');
begin
  if not exists (select 1 from audit_logs where entity_id = a1 and action = 'website_media_asset.updated'
                  and after_data ->> 'change' = 'alt_text'
                  and before_data ? 'altText' and before_data ->> 'altText' is null
                  and after_data ->> 'altText' = 'Learners in a classroom (sample)') then
    raise exception 'FAIL: alt text change not audited with before and after';
  end if;
  if not exists (select 1 from audit_logs where entity_id = a1 and after_data ->> 'change' = 'approved'
                  and before_data ->> 'status' = 'draft' and after_data ->> 'status' = 'approved') then
    raise exception 'FAIL: approval not audited';
  end if;
  -- All rows share one transaction timestamp, so check each transition's
  -- before and after status rather than row order.
  if (select string_agg(format('%s>%s:%s', before_data ->> 'status', after_data ->> 'status',
                               after_data ->> 'change'), ',' order by after_data ->> 'change')
        from audit_logs where entity_id = a2 and action = 'website_media_asset.updated')
     is distinct from 'draft>approved:approved,retired>draft:restored,approved>retired:retired' then
    raise exception 'FAIL: a2 audit trail is wrong: %', (
      select string_agg(format('%s>%s:%s', before_data ->> 'status', after_data ->> 'status',
                               after_data ->> 'change'), ',' order by after_data ->> 'change')
        from audit_logs where entity_id = a2 and action = 'website_media_asset.updated');
  end if;
  if exists (select 1 from audit_logs where entity_id = a1 and action = 'website_media_asset.updated'
              and after_data ->> 'change' in ('approval_withdrawn', 'retired')) then
    raise exception 'FAIL: a refused change was audited';
  end if;
  raise notice 'PASS M8b: every change audited with status and alt text before and after; refused changes leave no audit row';
end
$$;

-- ---------------------------------------------------------------------------
-- M9 Other buckets' policies do not use the website helpers.

do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and coalesce(qual, '') || coalesce(with_check, '') like '%website_media%'
       and coalesce(qual, '') || coalesce(with_check, '') not like '%website-media%'
  ) then
    raise exception 'FAIL: a website media helper appears in another bucket''s policy';
  end if;
  if (select public from storage.buckets where id = 'website-media') then
    raise exception 'FAIL: website-media became public';
  end if;
  raise notice 'PASS M9: other buckets'' policies untouched by the website media helpers';
end
$$;

rollback;
