-- PREPARED FOR REVIEW ONLY. Run only in throwaway local databases (see README). Never against a hosted project.
-- Plain-Postgres test harness only (scripts/test-rls.sh). Run after
-- supabase/tests/auth_schema_stub.sql and before website_media_uploads.sql.
--
-- The harness stub of Supabase Storage has only id/name/public on buckets and
-- id/bucket_id/name/owner on objects. A real Supabase project (hosted or
-- `supabase start`) already has the columns below, so this file is NOT part
-- of the migration and is never run against Supabase.

alter table storage.buckets
  add column if not exists file_size_limit bigint,
  add column if not exists allowed_mime_types text[];

alter table storage.objects
  add column if not exists owner_id text,
  add column if not exists metadata jsonb;
