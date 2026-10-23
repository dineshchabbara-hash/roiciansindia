-- =============================================================================
-- PREPARED FOR REVIEW ONLY. NOT APPLIED. NOT IN supabase/migrations/.
--
-- Phase 22B-3 (website media): lets active Admins and Super Admins upload
-- images into the existing PRIVATE `website-media` bucket and record them in
-- the existing Phase 22A `website_media_assets` table. It needs, in order:
--   1. owner review and approval of this design;
--   2. a verified migration number at approval time (expected 20260101000043
--      or the next free number);
--   3. a run of website_media_uploads_test.sql in an isolated local database;
--   4. separate authorization for DEV, then production.
-- Design: docs/requirements/PHASE_22B3_MEDIA_DESIGN.md.
-- =============================================================================
--
-- What it changes (website-media only):
--   1. Bucket limits: private, 5 MiB, JPEG/PNG/WebP (Storage refuses anything
--      else at upload time).
--   2. Storage upload (INSERT) policy: active Admin/Super Admin, a safe
--      "<uuid>/<name>.<jpg|jpeg|png|webp>" path, never a recorded file's path.
--      There is still NO update policy, so nothing can be overwritten or
--      moved (upsert included).
--   3. Storage delete policy: only files that were never recorded as media
--      (failed or abandoned uploads): the uploader's own at any time, anyone's
--      after 24 hours. Recorded files can never be deleted.
--   4. website_register_media_asset(): the file must exist in website-media,
--      be the caller's own upload, and have exactly the stored size and type
--      being recorded. Dimensions are required.
--   5. website_update_media_asset(): same rules; the audit entry now records
--      status AND alt text before and after, and which change it was.
--   6. website_incomplete_media_uploads(): lists unrecorded files older than
--      24 hours, for the clean-up screen (Admins only).
--
-- What it does NOT change: any other bucket or storage policy; the existing
-- website-media read policy (Admin/Super Admin only); LMS tables; the
-- publish/revision rules (only Approved images publish; retired images cannot
-- be referenced; images used by published content cannot be withdrawn).

-- 1. Bucket limits -----------------------------------------------------------

update storage.buckets
   set public = false,
       file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'website-media';

do $$
begin
  if not exists (
    select 1 from storage.buckets
     where id = 'website-media' and public = false and file_size_limit = 5242880
  ) then
    raise exception 'website-media bucket is missing; apply the Phase 22A migrations first';
  end if;
end
$$;

-- 2. Path and registration helpers -------------------------------------------

-- A safe new upload path: "<lower-case uuid>/<name>.<jpg|jpeg|png|webp>",
-- one folder level, no "..", no leading dot. Same shape as the 22A table check.
create or replace function website_media_path_is_valid(p_name text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_name is not null
     and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$'
     and p_name ~* '\.(jpe?g|png|webp)$'
     and position('..' in p_name) = 0;
$$;

comment on function website_media_path_is_valid(text) is
  'Phase 22B-3: true for a safe website-media upload path "<uuid>/<name>.<jpg|jpeg|png|webp>".';

-- Whether a website-media path is recorded as a media asset. Answers only for
-- an active Admin/Super Admin (false for anyone else), so it reveals nothing
-- to other users. Used by the storage policies below.
create or replace function website_media_object_is_registered(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select is_admin_or_super() and exists (
    select 1 from website_media_assets m
     where m.storage_bucket = 'website-media' and m.storage_path = p_name
  );
$$;

comment on function website_media_object_is_registered(text) is
  'Phase 22B-3: true if the website-media path is a recorded media asset (Admin/Super Admin callers only).';

-- 3. Storage policies (website-media only) ----------------------------------

create policy website_media_bucket_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'website-media'
    and is_admin_or_super()
    and website_media_path_is_valid(name)
    and not website_media_object_is_registered(name)
  );

-- Deliberately no UPDATE policy: no overwrite, upsert or move in website-media.

create policy website_media_bucket_delete_unregistered on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'website-media'
    and is_admin_or_super()
    and not website_media_object_is_registered(name)
    and (
      coalesce(owner_id, owner::text) = auth.uid()::text
      or created_at < now() - interval '24 hours'
    )
  );

-- 4. Registration checks the stored file ---------------------------------------

create or replace function website_register_media_asset(
  p_storage_path text,
  p_mime_type text,
  p_byte_size integer,
  p_width integer,
  p_height integer,
  p_alt_text text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_alt text;
  v_uploader text;
  v_size text;
  v_type text;
  v_found boolean := false;
begin
  perform website_assert_manager();
  v_alt := website_clean_text(p_alt_text, 'Alt text', 250);
  if not website_media_path_is_valid(p_storage_path)
     or p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
     or p_byte_size is null or p_byte_size not between 1 and 5242880
     or p_width is null or p_height is null
     or p_width not between 1 and 10000 or p_height not between 1 and 10000 then
    raise exception using errcode = '22023',
      message = 'Media must be a JPEG, PNG or WebP image up to 5 MB, with its dimensions, stored under a <uuid>/<file name> path';
  end if;

  -- The file must already be in the private bucket, uploaded by the caller,
  -- with exactly the size and type being recorded (as Storage measured them).
  select true, coalesce(o.owner_id, o.owner::text), o.metadata ->> 'size', lower(o.metadata ->> 'mimetype')
    into v_found, v_uploader, v_size, v_type
    from storage.objects o
   where o.bucket_id = 'website-media' and o.name = p_storage_path
   for share;
  if not coalesce(v_found, false) then
    raise exception using errcode = 'P2204', message = 'The uploaded file was not found; upload it again';
  end if;
  if v_uploader is distinct from auth.uid()::text then
    raise exception using errcode = '42501', message = 'Only the person who uploaded a file can record it';
  end if;
  if v_size is null or v_size !~ '^[0-9]{1,10}$' or v_size::bigint <> p_byte_size then
    raise exception using errcode = '22023', message = 'The file size does not match the uploaded file';
  end if;
  if v_type is distinct from p_mime_type then
    raise exception using errcode = '22023', message = 'The file type does not match the uploaded file';
  end if;

  begin
    insert into website_media_assets (storage_path, mime_type, byte_size, width, height, alt_text, created_by, updated_by)
    values (p_storage_path, p_mime_type, p_byte_size, p_width, p_height, v_alt, auth.uid(), auth.uid())
    returning id into v_id;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'That file is already registered';
    when check_violation then
      raise exception using errcode = '22023', message = 'Media must be a JPEG, PNG or WebP image up to 5 MB stored under a <uuid>/<file name> path';
  end;
  perform website_audit('website_media_asset.registered', 'website_media_asset', v_id, null,
    jsonb_build_object('storagePath', p_storage_path, 'mimeType', p_mime_type, 'byteSize', p_byte_size,
                       'width', p_width, 'height', p_height, 'altText', v_alt, 'status', 'draft'));
  return v_id;
end;
$$;

-- 5. Status and alt text changes, with a fuller audit entry ---------------------

create or replace function website_update_media_asset(
  p_asset_id uuid,
  p_expected_version integer,
  p_alt_text text,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m record;
  v_alt text;
  v_change text;
begin
  perform website_assert_manager();
  v_alt := website_clean_text(p_alt_text, 'Alt text', 250);
  if p_status is null or p_status not in ('draft', 'approved', 'retired') then
    raise exception using errcode = '22023', message = 'Unknown media status';
  end if;
  select * into m from website_media_assets where id = p_asset_id for update;
  if m.id is null then
    raise exception using errcode = 'P2204', message = 'Media asset not found';
  end if;
  if m.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This media asset was changed by someone else; reload and try again';
  end if;
  if p_status = 'approved' and v_alt is null then
    raise exception using errcode = '22023', message = 'Alt text is required before an image is approved';
  end if;
  -- An asset used by currently published content keeps its approval: it
  -- cannot be withdrawn or retired until no published revision uses it.
  if m.status = 'approved' and p_status <> 'approved' and exists (
    select 1 from website_revision_media rm
      join website_documents d on d.published_revision_id = rm.revision_id
     where rm.asset_id = m.id
  ) then
    raise exception using errcode = 'P2206', message = 'This image is used by published content; publish a version without it first';
  end if;
  v_change := case
    when p_status = m.status then 'alt_text'
    when p_status = 'approved' then 'approved'
    when p_status = 'retired' then 'retired'
    when m.status = 'retired' then 'restored'
    else 'approval_withdrawn'
  end;
  update website_media_assets
     set alt_text = v_alt, status = p_status,
         approved_at = case when p_status = 'approved' and m.status <> 'approved' then now()
                            when p_status = 'approved' then m.approved_at else null end,
         approved_by = case when p_status = 'approved' and m.status <> 'approved' then auth.uid()
                            when p_status = 'approved' then m.approved_by else null end,
         version = m.version + 1, updated_by = auth.uid()
   where id = m.id;
  perform website_audit('website_media_asset.updated', 'website_media_asset', m.id,
    jsonb_build_object('status', m.status, 'altText', m.alt_text),
    jsonb_build_object('status', p_status, 'altText', v_alt, 'change', v_change));
  return m.version + 1;
end;
$$;

-- 6. Incomplete uploads (for the clean-up screen) ------------------------------

create or replace function website_incomplete_media_uploads()
returns table (storage_path text, uploaded_at timestamptz, byte_size bigint, uploaded_by_me boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform website_assert_manager();
  return query
    select o.name::text,
           o.created_at,
           case when (o.metadata ->> 'size') ~ '^[0-9]{1,10}$' then (o.metadata ->> 'size')::bigint end,
           coalesce(o.owner_id, o.owner::text) = auth.uid()::text
      from storage.objects o
     where o.bucket_id = 'website-media'
       and o.created_at < now() - interval '24 hours'
       and not exists (
         select 1 from website_media_assets m
          where m.storage_bucket = 'website-media' and m.storage_path = o.name
       )
     order by o.created_at
     limit 500;
end;
$$;

comment on function website_incomplete_media_uploads() is
  'Phase 22B-3: website-media files older than 24 hours that were never recorded as media (failed or abandoned uploads). Active Admin/Super Admin only.';

-- 7. Grants ---------------------------------------------------------------------
-- Policy helpers must be executable by the role a policy is evaluated for.

revoke execute on function website_media_path_is_valid(text) from public, anon;
grant execute on function website_media_path_is_valid(text) to authenticated;
revoke execute on function website_media_object_is_registered(text) from public, anon;
grant execute on function website_media_object_is_registered(text) to authenticated;
revoke execute on function website_incomplete_media_uploads() from public, anon;
grant execute on function website_incomplete_media_uploads() to authenticated;
revoke execute on function website_register_media_asset(text, text, integer, integer, integer, text) from public, anon;
grant execute on function website_register_media_asset(text, text, integer, integer, integer, text) to authenticated;
revoke execute on function website_update_media_asset(uuid, integer, text, text) from public, anon;
grant execute on function website_update_media_asset(uuid, integer, text, text) to authenticated;
