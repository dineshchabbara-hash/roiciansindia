-- Phase 22A — Website Management data foundation
-- (docs/requirements/PHASE_22_APPROVED_DESIGN.md §5, §8, §9, §14).
--
-- What this migration adds (all private; no public read path — that is the
-- Phase 22C published-data contract):
--
--   website_display_groups        Admin-managed Program display groups (no enum).
--   website_media_assets          Metadata for website images held in the new
--                                 PRIVATE `website-media` bucket.
--   website_documents             One row per managed page (home, about,
--                                 corporate_training, institutions, contact,
--                                 legal, navigation, footer) or per Program
--                                 (kind = 'program'). A Program document holds
--                                 the public slug and its catalogue placement
--                                 (group, featured flag, ordering) and points at
--                                 its latest and its published revision.
--   website_document_revisions    Immutable content snapshots (headline/title,
--                                 summary, SEO + social metadata, image refs,
--                                 structured sections). Never edited in place.
--   website_revision_media        Which media assets each revision uses.
--   website_program_slug_history  Slugs a Program used after its first
--                                 publication (reserved for redirects).
--   batch_website_publications    Batch website publication: draft + published
--                                 public label and registration state
--                                 (open / closed / full), independent of the
--                                 operational batches.status.
--
-- Design rules enforced here:
--   * No new column is added to programs or batches. Students and Trainers can
--     already read whole batches rows (batches_select_student/_trainer) and any
--     authenticated user can read non-draft programs rows
--     (programs_select_published); keeping website data in separate tables
--     means none of it can leak through those existing reads.
--   * Every new table: RLS on, a SELECT policy for Admin/Super Admin only, no
--     INSERT/UPDATE/DELETE policy, and direct write privileges revoked from
--     anon/authenticated. All writes go through the SECURITY DEFINER functions
--     below, which check the caller's own session (is_admin_or_super() /
--     is_super_admin(), both excluding inactive Admins) — never a caller-
--     supplied actor id — and write an audit_logs row in the same transaction.
--   * Lost-update prevention: content saves name the revision number they were
--     based on; metadata edits name the row version they read. A stale value is
--     rejected (SQLSTATE P2203), never silently overwritten.
--   * Revisions are immutable; restoring an old revision creates a NEW revision
--     (restored_from_revision_id) that still needs an explicit publish.
--   * The slug is not part of revision content, so it cannot be changed by
--     saving, restoring or publishing content. After a Program's first
--     publication only a Super Admin may change it; a trigger enforces this for
--     every writer and records the old slug in website_program_slug_history.
--   * Structured content only: an allowlist of section types and keys,
--     length limits, safe link forms, no HTML-like tags, no ₹ symbol, and no
--     fee/price fields (P22-09). Rendering (22C+) still escapes all text.
--   * No seed data: no groups, pages, Programs, Batches or content are created.

-- ---------------------------------------------------------------------------
-- 1. Shared helpers (internal; not executable by API roles)

create or replace function website_assert_manager()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not is_admin_or_super() then
    raise exception using errcode = '42501', message = 'Only an active Admin or Super Admin may manage website content';
  end if;
end;
$$;

comment on function website_assert_manager() is
  'Phase 22A: raises 42501 unless the caller''s own session is an active Admin or Super Admin.';

-- Plain text check for every website string: length bounds, no HTML-like tag,
-- no ₹ symbol (P22-09: no public pricing). Returns the trimmed value (null for
-- empty when not required).
create or replace function website_clean_text(
  p_value text,
  p_field text,
  p_max integer,
  p_required boolean default false
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then
    if p_required then
      raise exception using errcode = '22023', message = format('%s is required', p_field);
    end if;
    return null;
  end if;
  if char_length(v) > p_max then
    raise exception using errcode = '22023', message = format('%s must be at most %s characters', p_field, p_max);
  end if;
  if v ~ '<[A-Za-z/!?]' then
    raise exception using errcode = '22023', message = format('%s must be plain text (no HTML or markup tags)', p_field);
  end if;
  if position('₹' in v) > 0 then
    raise exception using errcode = '22023', message = format('%s must not contain prices (the public website shows no pricing)', p_field);
  end if;
  return v;
end;
$$;

-- Safe link forms only: site-relative paths, https URLs, mailto:, tel:.
create or replace function website_is_safe_href(p_href text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_href is not null
    and char_length(p_href) <= 500
    and p_href !~ '[<>"''`\\]'
    and (p_href ~ '^tel:' or p_href !~ '\s')
    and (
      (p_href ~ '^/' and p_href !~ '^//')
      or p_href ~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?(/.*)?$'
      or p_href ~* '^mailto:[^@/:]+@[a-z0-9.-]+$'
      or p_href ~ '^tel:\+?[0-9][0-9 -]{3,20}$'
    );
$$;

create or replace function website_is_valid_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_slug is not null
    and char_length(p_slug) between 3 and 100
    and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;

-- Section types each document kind supports (code templates own rendering).
create or replace function website_allowed_section_types(p_kind text)
returns text[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'program' then array['text', 'list', 'faq', 'cta']
    when 'home' then array['hero', 'text', 'list', 'faq', 'cta', 'banner', 'program_showcase']
    when 'about' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    when 'corporate_training' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    when 'institutions' then array['hero', 'text', 'list', 'faq', 'cta', 'banner']
    when 'contact' then array['hero', 'text', 'contact_details', 'cta']
    when 'legal' then array['text', 'consent_text']
    when 'navigation' then array['menu']
    when 'footer' then array['footer_column', 'text']
    else array[]::text[]
  end;
$$;

-- Validates and normalizes a structured sections array. Shape of each section:
--   { "key": "<a-z0-9- ≤40, unique>", "type": "<allowed type>", "visible": bool,
--     "heading"?: text≤150, "body"?: text≤5000, "imageAssetId"?: uuid,
--     "cta"?: {"label": text≤60, "href": safe link},
--     "items"?: [ {"title"?, "text"?, "question"?, "answer"?, "label"?, "href"?} ] ≤50 }
-- Order = array position. Unknown keys are rejected, so no other field
-- (fees, internal Batch data, scripts) can be stored in content.
create or replace function website_validate_sections(p_kind text, p_sections jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  allowed text[] := website_allowed_section_types(p_kind);
  section jsonb;
  item jsonb;
  k text;
  keys text[] := array[]::text[];
  sec_key text;
  sec_type text;
  out_sections jsonb := '[]'::jsonb;
  out_section jsonb;
  out_items jsonb;
  out_item jsonb;
  v text;
  idx integer := 0;
begin
  if p_sections is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_sections) <> 'array' then
    raise exception using errcode = '22023', message = 'Sections must be a list';
  end if;
  if jsonb_array_length(p_sections) > 40 then
    raise exception using errcode = '22023', message = 'At most 40 sections are allowed';
  end if;

  for section in select value from jsonb_array_elements(p_sections) loop
    idx := idx + 1;
    if jsonb_typeof(section) <> 'object' then
      raise exception using errcode = '22023', message = format('Section %s must be an object', idx);
    end if;
    for k in select jsonb_object_keys(section) loop
      if k <> all (array['key', 'type', 'visible', 'heading', 'body', 'imageAssetId', 'cta', 'items']) then
        raise exception using errcode = '22023', message = format('Section %s has an unsupported field "%s"', idx, k);
      end if;
    end loop;

    sec_key := section ->> 'key';
    if sec_key is null or sec_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(sec_key) > 40 then
      raise exception using errcode = '22023', message = format('Section %s needs a key of lowercase letters, digits and hyphens (max 40)', idx);
    end if;
    if sec_key = any (keys) then
      raise exception using errcode = '22023', message = format('Section key "%s" is used twice', sec_key);
    end if;
    keys := keys || sec_key;

    sec_type := section ->> 'type';
    if sec_type is null or sec_type <> all (allowed) then
      raise exception using errcode = '22023', message = format('Section "%s" has a type not supported on this page', sec_key);
    end if;
    if section ? 'visible' and jsonb_typeof(section -> 'visible') <> 'boolean' then
      raise exception using errcode = '22023', message = format('Section "%s" visibility must be true or false', sec_key);
    end if;

    out_section := jsonb_build_object(
      'key', sec_key,
      'type', sec_type,
      'visible', coalesce((section ->> 'visible')::boolean, true)
    );

    if section ? 'heading' then
      if jsonb_typeof(section -> 'heading') <> 'string' then
        raise exception using errcode = '22023', message = format('Section "%s" heading must be text', sec_key);
      end if;
      v := website_clean_text(section ->> 'heading', 'Section heading', 150);
      if v is not null then out_section := out_section || jsonb_build_object('heading', v); end if;
    end if;
    if section ? 'body' then
      if jsonb_typeof(section -> 'body') <> 'string' then
        raise exception using errcode = '22023', message = format('Section "%s" body must be text', sec_key);
      end if;
      v := website_clean_text(section ->> 'body', 'Section text', 5000);
      if v is not null then out_section := out_section || jsonb_build_object('body', v); end if;
    end if;
    if section ? 'imageAssetId' then
      if jsonb_typeof(section -> 'imageAssetId') <> 'string'
         or (section ->> 'imageAssetId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception using errcode = '22023', message = format('Section "%s" image must be a media asset id', sec_key);
      end if;
      out_section := out_section || jsonb_build_object('imageAssetId', lower(section ->> 'imageAssetId'));
    end if;
    if section ? 'cta' then
      if jsonb_typeof(section -> 'cta') <> 'object'
         or exists (select 1 from jsonb_object_keys(section -> 'cta') ck where ck <> all (array['label', 'href'])) then
        raise exception using errcode = '22023', message = format('Section "%s" call to action must have only a label and a link', sec_key);
      end if;
      if not website_is_safe_href(section -> 'cta' ->> 'href') then
        raise exception using errcode = '22023', message = format('Section "%s" call-to-action link must be a site path, https URL, mailto: or tel: link', sec_key);
      end if;
      out_section := out_section || jsonb_build_object('cta', jsonb_build_object(
        'label', website_clean_text(section -> 'cta' ->> 'label', 'Call-to-action label', 60, true),
        'href', section -> 'cta' ->> 'href'));
    end if;
    if section ? 'items' then
      if jsonb_typeof(section -> 'items') <> 'array' or jsonb_array_length(section -> 'items') > 50 then
        raise exception using errcode = '22023', message = format('Section "%s" items must be a list of at most 50', sec_key);
      end if;
      out_items := '[]'::jsonb;
      for item in select value from jsonb_array_elements(section -> 'items') loop
        if jsonb_typeof(item) <> 'object' then
          raise exception using errcode = '22023', message = format('Section "%s" items must be objects', sec_key);
        end if;
        out_item := '{}'::jsonb;
        for k in select jsonb_object_keys(item) loop
          if k <> all (array['title', 'text', 'question', 'answer', 'label', 'href']) then
            raise exception using errcode = '22023', message = format('Section "%s" item has an unsupported field "%s"', sec_key, k);
          end if;
          if jsonb_typeof(item -> k) <> 'string' then
            raise exception using errcode = '22023', message = format('Section "%s" item field "%s" must be text', sec_key, k);
          end if;
          if k = 'href' then
            if not website_is_safe_href(item ->> k) then
              raise exception using errcode = '22023', message = format('Section "%s" item link must be a site path, https URL, mailto: or tel: link', sec_key);
            end if;
            out_item := out_item || jsonb_build_object('href', item ->> k);
          else
            v := website_clean_text(item ->> k, 'Item ' || k,
                   case k when 'text' then 2000 when 'answer' then 2000 when 'label' then 80 else 200 end);
            if v is not null then out_item := out_item || jsonb_build_object(k, v); end if;
          end if;
        end loop;
        if out_item = '{}'::jsonb then
          raise exception using errcode = '22023', message = format('Section "%s" has an empty item', sec_key);
        end if;
        out_items := out_items || jsonb_build_array(out_item);
      end loop;
      out_section := out_section || jsonb_build_object('items', out_items);
    end if;

    out_sections := out_sections || jsonb_build_array(out_section);
  end loop;

  return out_sections;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Display groups

create table if not exists website_display_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  display_order integer not null,
  is_visible boolean not null default true,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint website_display_groups_name_len check (char_length(btrim(name)) between 1 and 80),
  constraint website_display_groups_description_len check (description is null or char_length(description) <= 300),
  constraint website_display_groups_order_positive check (display_order > 0),
  constraint website_display_groups_version_positive check (version > 0)
);

comment on table website_display_groups is
  'Phase 22A: Admin-managed Program display groups for the public website (P22-06/07). Names and order are data, never an enum. Archived groups keep their row (restore is possible). Private: Admin/Super Admin read; writes only through website_* functions.';

create unique index if not exists website_display_groups_active_name_key
  on website_display_groups (lower(btrim(name))) where archived_at is null;

create trigger website_display_groups_set_updated_at
  before update on website_display_groups
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Media assets (metadata only; files live in the private website-media bucket)

create table if not exists website_media_assets (
  id uuid primary key default gen_random_uuid(),
  storage_bucket text not null default 'website-media',
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null,
  width integer,
  height integer,
  alt_text text,
  status text not null default 'draft',
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint website_media_assets_bucket check (storage_bucket = 'website-media'),
  constraint website_media_assets_path_shape check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$'
  ),
  constraint website_media_assets_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint website_media_assets_size check (byte_size between 1 and 5242880),
  constraint website_media_assets_dimensions check (
    (width is null or width between 1 and 10000) and (height is null or height between 1 and 10000)
  ),
  constraint website_media_assets_alt_len check (alt_text is null or char_length(alt_text) <= 250),
  constraint website_media_assets_status check (status in ('draft', 'approved', 'retired')),
  constraint website_media_assets_approved_has_alt check (status <> 'approved' or alt_text is not null),
  constraint website_media_assets_version_positive check (version > 0)
);

comment on table website_media_assets is
  'Phase 22A: metadata for website images stored in the PRIVATE website-media bucket. status draft -> approved (needs alt text) -> retired. Only approved assets may be referenced by a published revision. No delete path and no public serving yet (22B/22C); cleanup behaviour is intentionally not implemented (fail-closed).';

create unique index if not exists website_media_assets_path_key on website_media_assets (storage_bucket, storage_path);

create trigger website_media_assets_set_updated_at
  before update on website_media_assets
  for each row execute function set_updated_at();

-- Private bucket for website images. NOT public: draft assets are never
-- publicly reachable by being uploaded. Admin/Super Admin may read; there is
-- deliberately no INSERT/UPDATE/DELETE storage policy yet (uploads arrive with
-- the 22B editor; public serving is designed in 22C).
insert into storage.buckets (id, name, public)
values ('website-media', 'website-media', false)
on conflict (id) do nothing;

create policy website_media_bucket_select_admin on storage.objects
  for select using (bucket_id = 'website-media' and is_admin_or_super());

-- ---------------------------------------------------------------------------
-- 4. Documents (pages and Program website entries)

create table if not exists website_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  page_key text not null,
  program_id uuid references programs (id) on delete restrict,
  slug text,
  display_group_id uuid references website_display_groups (id) on delete restrict,
  is_featured boolean not null default false,
  featured_order integer,
  display_order integer,
  latest_revision_id uuid,
  latest_revision_number integer not null default 0,
  published_revision_id uuid,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  first_published_at timestamptz,
  unpublished_at timestamptz,
  unpublished_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint website_documents_kind check (kind in (
    'home', 'about', 'corporate_training', 'institutions', 'contact', 'legal', 'navigation', 'footer', 'program'
  )),
  constraint website_documents_page_key_shape check (
    char_length(page_key) between 2 and 100 and page_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  -- Program documents: tied to exactly one Program, with a valid slug; other
  -- kinds have no Program, slug or catalogue placement.
  constraint website_documents_program_shape check (
    (kind = 'program' and program_id is not null and slug is not null and website_is_valid_slug(slug))
    or (kind <> 'program' and program_id is null and slug is null and display_group_id is null
        and is_featured = false and featured_order is null and display_order is null)
  ),
  constraint website_documents_orders_positive check (
    (featured_order is null or featured_order > 0) and (display_order is null or display_order > 0)
  ),
  constraint website_documents_published_consistent check (
    (published_revision_id is null) or (published_at is not null and first_published_at is not null)
  ),
  constraint website_documents_revision_number_nonneg check (latest_revision_number >= 0),
  constraint website_documents_version_positive check (version > 0)
);

comment on table website_documents is
  'Phase 22A: one managed website document per page (home/about/corporate_training/institutions/contact/legal/navigation/footer) or per Program (kind=program, program_id unique, public slug, display group/featured/order placement). Points at its latest and published revision. first_published_at is permanent publication history (TI-7). Private; writes only through website_* functions.';

create unique index if not exists website_documents_page_key_key on website_documents (page_key);
create unique index if not exists website_documents_program_key on website_documents (program_id) where program_id is not null;
create unique index if not exists website_documents_slug_key on website_documents (slug) where slug is not null;
-- Singleton pages: at most one home/about/corporate/institutions/contact/navigation/footer.
create unique index if not exists website_documents_singleton_kind_key on website_documents (kind)
  where kind in ('home', 'about', 'corporate_training', 'institutions', 'contact', 'navigation', 'footer');
create index if not exists website_documents_group_idx on website_documents (display_group_id);

create trigger website_documents_set_updated_at
  before update on website_documents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Revisions (immutable content snapshots)

create table if not exists website_document_revisions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references website_documents (id) on delete cascade,
  revision_number integer not null,
  title text not null,
  summary text,
  seo_title text,
  seo_description text,
  social_title text,
  social_description text,
  hero_image_asset_id uuid references website_media_assets (id) on delete restrict,
  social_image_asset_id uuid references website_media_assets (id) on delete restrict,
  sections jsonb not null default '[]'::jsonb,
  restored_from_revision_id uuid references website_document_revisions (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint website_document_revisions_number_positive check (revision_number > 0),
  constraint website_document_revisions_title_len check (char_length(title) between 1 and 150),
  constraint website_document_revisions_summary_len check (summary is null or char_length(summary) <= 500),
  constraint website_document_revisions_seo_title_len check (seo_title is null or char_length(seo_title) <= 70),
  constraint website_document_revisions_seo_desc_len check (seo_description is null or char_length(seo_description) <= 170),
  constraint website_document_revisions_social_title_len check (social_title is null or char_length(social_title) <= 100),
  constraint website_document_revisions_social_desc_len check (social_description is null or char_length(social_description) <= 200),
  constraint website_document_revisions_sections_array check (jsonb_typeof(sections) = 'array'),
  constraint website_document_revisions_number_key unique (document_id, revision_number),
  -- lets website_documents point at (document, revision) pairs safely
  constraint website_document_revisions_doc_id_key unique (document_id, id)
);

comment on table website_document_revisions is
  'Phase 22A: immutable content snapshot of a website document. Editor identity = created_by/created_at. Restorations are new rows with restored_from_revision_id. Holds no slug, fee, price or internal Batch field. Private; writes only through website_* functions.';

-- A document's latest/published revision must be one of ITS OWN revisions.
alter table website_documents
  add constraint website_documents_latest_revision_fk
    foreign key (id, latest_revision_id) references website_document_revisions (document_id, id),
  add constraint website_documents_published_revision_fk
    foreign key (id, published_revision_id) references website_document_revisions (document_id, id);

create or replace function prevent_website_revision_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = '42501', message = 'Website revisions are immutable; save a new revision instead';
end;
$$;

create trigger website_document_revisions_immutable
  before update on website_document_revisions
  for each row execute function prevent_website_revision_update();

create table if not exists website_revision_media (
  revision_id uuid not null references website_document_revisions (id) on delete cascade,
  asset_id uuid not null references website_media_assets (id) on delete restrict,
  primary key (revision_id, asset_id)
);

comment on table website_revision_media is
  'Phase 22A: media assets used by each revision (hero/social image columns and imageAssetId values inside sections). Blocks asset removal while referenced and lets publication require approved assets.';

create index if not exists website_revision_media_asset_idx on website_revision_media (asset_id);

-- ---------------------------------------------------------------------------
-- 6. Program slug history

create table if not exists website_program_slug_history (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references website_documents (id) on delete restrict,
  old_slug text not null,
  new_slug text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users (id) on delete set null,
  constraint website_program_slug_history_old_slug_key unique (old_slug)
);

comment on table website_program_slug_history is
  'Phase 22A: a Program document''s previous public slugs after its first publication (P22-05 redirect safeguard). An old slug can never be reused by any Program. Append-only.';

create or replace function prevent_website_slug_history_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using errcode = '42501', message = 'Slug history is append-only';
end;
$$;

create trigger website_program_slug_history_append_only
  before update or delete on website_program_slug_history
  for each row execute function prevent_website_slug_history_change();

-- Integrity guard on website_documents for EVERY writer (including direct SQL
-- or the service role): identity columns are fixed, publication history is
-- permanent, and a published Program's slug changes only for a Super Admin,
-- with the old slug reserved in website_program_slug_history.
create or replace function guard_website_document_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.first_published_at is not null then
      raise exception using errcode = '42501', message = 'A website document that was ever published cannot be removed';
    end if;
    return old;
  end if;

  if new.kind is distinct from old.kind or new.page_key is distinct from old.page_key
     or new.program_id is distinct from old.program_id then
    raise exception using errcode = '42501', message = 'A website document''s kind, page key and Program are fixed';
  end if;
  if old.first_published_at is not null and new.first_published_at is distinct from old.first_published_at then
    raise exception using errcode = '42501', message = 'First-publication history cannot be changed';
  end if;
  if new.latest_revision_number < old.latest_revision_number then
    raise exception using errcode = '42501', message = 'Revision numbering cannot go backwards';
  end if;

  if new.slug is distinct from old.slug then
    if exists (select 1 from website_program_slug_history h where h.old_slug = new.slug) then
      raise exception using errcode = 'P2205', message = 'That slug was used before and is reserved for a redirect';
    end if;
    if old.first_published_at is not null then
      if auth.uid() is null or not is_super_admin() then
        raise exception using errcode = '42501', message = 'Only a Super Admin may change the slug of a Program that has been published';
      end if;
      insert into website_program_slug_history (document_id, old_slug, new_slug, changed_by)
      values (old.id, old.slug, new.slug, auth.uid());
    end if;
  end if;
  return new;
end;
$$;

create trigger website_documents_guard
  before update or delete on website_documents
  for each row execute function guard_website_document_change();

-- A slug can never equal a reserved historical slug (also on insert).
create or replace function guard_website_document_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.slug is not null and exists (select 1 from website_program_slug_history h where h.old_slug = new.slug) then
    raise exception using errcode = 'P2205', message = 'That slug was used before and is reserved for a redirect';
  end if;
  if new.first_published_at is not null or new.published_revision_id is not null then
    raise exception using errcode = '42501', message = 'A new website document starts unpublished';
  end if;
  return new;
end;
$$;

create trigger website_documents_guard_insert
  before insert on website_documents
  for each row execute function guard_website_document_insert();

-- ---------------------------------------------------------------------------
-- 7. Batch website publication

create table if not exists batch_website_publications (
  batch_id uuid primary key references batches (id) on delete restrict,
  draft_public_label text,
  draft_registration_state text not null default 'closed',
  is_published boolean not null default false,
  published_label text,
  published_registration_state text,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  first_published_at timestamptz,
  unpublished_at timestamptz,
  unpublished_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint batch_website_publications_draft_label_len check (draft_public_label is null or char_length(draft_public_label) between 1 and 120),
  constraint batch_website_publications_published_label_len check (published_label is null or char_length(published_label) between 1 and 120),
  constraint batch_website_publications_draft_state check (draft_registration_state in ('open', 'closed', 'full')),
  constraint batch_website_publications_published_state check (published_registration_state is null or published_registration_state in ('open', 'closed', 'full')),
  constraint batch_website_publications_published_complete check (
    not is_published or (published_label is not null and published_registration_state is not null
                         and published_at is not null and first_published_at is not null)
  ),
  constraint batch_website_publications_version_positive check (version > 0)
);

comment on table batch_website_publications is
  'Phase 22A: website publication of a Batch (P22-10), separate from operational batches.status. Draft label/state are edited privately; publishing copies them to published_*. Registration state open/closed/full only — no capacity, counts, meeting links, location, notes, Trainer or internal name, and no Batch-level Coming Soon. Private; writes only through website_* functions.';

create trigger batch_website_publications_set_updated_at
  before update on batch_website_publications
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. RLS and privileges: private by default

alter table website_display_groups enable row level security;
alter table website_media_assets enable row level security;
alter table website_documents enable row level security;
alter table website_document_revisions enable row level security;
alter table website_revision_media enable row level security;
alter table website_program_slug_history enable row level security;
alter table batch_website_publications enable row level security;

create policy website_display_groups_select_admin on website_display_groups
  for select using (is_admin_or_super());
create policy website_media_assets_select_admin on website_media_assets
  for select using (is_admin_or_super());
create policy website_documents_select_admin on website_documents
  for select using (is_admin_or_super());
create policy website_document_revisions_select_admin on website_document_revisions
  for select using (is_admin_or_super());
create policy website_revision_media_select_admin on website_revision_media
  for select using (is_admin_or_super());
create policy website_program_slug_history_select_admin on website_program_slug_history
  for select using (is_admin_or_super());
create policy batch_website_publications_select_admin on batch_website_publications
  for select using (is_admin_or_super());

revoke all on website_display_groups, website_media_assets, website_documents,
  website_document_revisions, website_revision_media, website_program_slug_history,
  batch_website_publications from anon, authenticated;
grant select on website_display_groups, website_media_assets, website_documents,
  website_document_revisions, website_revision_media, website_program_slug_history,
  batch_website_publications to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Internal audit helper

create or replace function website_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into audit_logs (actor_auth_user_id, actor_role, action, entity_type, entity_id, before_data, after_data)
  values (
    auth.uid(),
    case when is_super_admin() then 'super_admin' else 'admin' end,
    p_action, p_entity_type, p_entity_id, p_before, p_after
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Display group functions

create or replace function website_create_display_group(p_name text, p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_desc text;
  v_id uuid;
  v_order integer;
begin
  perform website_assert_manager();
  v_name := website_clean_text(p_name, 'Group name', 80, true);
  v_desc := website_clean_text(p_description, 'Group description', 300);
  perform pg_advisory_xact_lock(hashtext('website_display_groups'));
  if exists (select 1 from website_display_groups g where g.archived_at is null and lower(btrim(g.name)) = lower(v_name)) then
    raise exception using errcode = '23505', message = 'A display group with that name already exists';
  end if;
  select coalesce(max(display_order), 0) + 1 into v_order from website_display_groups where archived_at is null;
  insert into website_display_groups (name, description, display_order, created_by, updated_by)
  values (v_name, v_desc, v_order, auth.uid(), auth.uid())
  returning id into v_id;
  perform website_audit('website_display_group.created', 'website_display_group', v_id, null,
    jsonb_build_object('name', v_name, 'displayOrder', v_order));
  return v_id;
end;
$$;

create or replace function website_update_display_group(
  p_group_id uuid,
  p_expected_version integer,
  p_name text,
  p_description text,
  p_is_visible boolean
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  v_name text;
  v_desc text;
begin
  perform website_assert_manager();
  v_name := website_clean_text(p_name, 'Group name', 80, true);
  v_desc := website_clean_text(p_description, 'Group description', 300);
  if p_is_visible is null then
    raise exception using errcode = '22023', message = 'Visibility is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('website_display_groups'));
  select * into g from website_display_groups where id = p_group_id for update;
  if g.id is null then
    raise exception using errcode = 'P2204', message = 'Display group not found';
  end if;
  if g.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This display group was changed by someone else; reload and try again';
  end if;
  if g.archived_at is not null then
    raise exception using errcode = 'P2206', message = 'Restore the display group before editing it';
  end if;
  if exists (select 1 from website_display_groups o where o.id <> g.id and o.archived_at is null
             and lower(btrim(o.name)) = lower(v_name)) then
    raise exception using errcode = '23505', message = 'A display group with that name already exists';
  end if;
  update website_display_groups
     set name = v_name, description = v_desc, is_visible = p_is_visible,
         version = g.version + 1, updated_by = auth.uid()
   where id = g.id;
  perform website_audit('website_display_group.updated', 'website_display_group', g.id,
    jsonb_build_object('name', g.name, 'isVisible', g.is_visible),
    jsonb_build_object('name', v_name, 'isVisible', p_is_visible));
  return g.version + 1;
end;
$$;

-- Reorders ALL active groups at once; the list must be exactly the current
-- set of active groups (a concurrent create/archive makes it stale).
create or replace function website_reorder_display_groups(p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_ids uuid[];
  i integer;
begin
  perform website_assert_manager();
  perform pg_advisory_xact_lock(hashtext('website_display_groups'));
  perform 1 from website_display_groups where archived_at is null for update;
  select coalesce(array_agg(id order by id), array[]::uuid[]) into current_ids
    from website_display_groups where archived_at is null;
  if p_ordered_ids is null
     or cardinality(p_ordered_ids) <> cardinality(current_ids)
     or (select array_agg(x order by x) from unnest(p_ordered_ids) x) is distinct from current_ids
     or cardinality(p_ordered_ids) <> (select count(distinct x) from unnest(p_ordered_ids) x) then
    raise exception using errcode = 'P2203', message = 'The group list changed; reload and try again';
  end if;
  for i in 1 .. cardinality(p_ordered_ids) loop
    update website_display_groups
       set display_order = i, version = version + 1, updated_by = auth.uid()
     where id = p_ordered_ids[i] and display_order <> i;
  end loop;
  perform website_audit('website_display_group.reordered', 'website_display_group', p_ordered_ids[1], null,
    jsonb_build_object('order', to_jsonb(p_ordered_ids)));
end;
$$;

create or replace function website_set_display_group_archived(
  p_group_id uuid,
  p_expected_version integer,
  p_archived boolean
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g record;
  v_order integer;
begin
  perform website_assert_manager();
  if p_archived is null then
    raise exception using errcode = '22023', message = 'Archive flag is required';
  end if;
  perform pg_advisory_xact_lock(hashtext('website_display_groups'));
  select * into g from website_display_groups where id = p_group_id for update;
  if g.id is null then
    raise exception using errcode = 'P2204', message = 'Display group not found';
  end if;
  if g.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This display group was changed by someone else; reload and try again';
  end if;
  if p_archived = (g.archived_at is not null) then
    raise exception using errcode = 'P2206', message = case when p_archived then 'The display group is already archived' else 'The display group is not archived' end;
  end if;
  if p_archived then
    -- Fail-safe: a group still holding Programs is not archived out from under
    -- them; move the Programs first (hiding the group is always allowed).
    if exists (select 1 from website_documents d where d.display_group_id = g.id) then
      raise exception using errcode = 'P2206', message = 'Move the Programs out of this group before archiving it';
    end if;
    update website_display_groups
       set archived_at = now(), archived_by = auth.uid(), version = g.version + 1, updated_by = auth.uid()
     where id = g.id;
  else
    if exists (select 1 from website_display_groups o where o.archived_at is null and lower(btrim(o.name)) = lower(btrim(g.name))) then
      raise exception using errcode = '23505', message = 'An active display group already uses that name; rename one first';
    end if;
    select coalesce(max(display_order), 0) + 1 into v_order from website_display_groups where archived_at is null;
    update website_display_groups
       set archived_at = null, archived_by = null, display_order = v_order,
           version = g.version + 1, updated_by = auth.uid()
     where id = g.id;
  end if;
  perform website_audit(
    case when p_archived then 'website_display_group.archived' else 'website_display_group.restored' end,
    'website_display_group', g.id, null, jsonb_build_object('name', g.name));
  return g.version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Document functions

create or replace function website_create_page(p_kind text, p_page_key text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  perform website_assert_manager();
  if p_kind is null or p_kind = 'program'
     or p_kind <> all (array['home', 'about', 'corporate_training', 'institutions', 'contact', 'legal', 'navigation', 'footer']) then
    raise exception using errcode = '22023', message = 'Unsupported page type';
  end if;
  if p_page_key is null or char_length(p_page_key) not between 2 and 100 or p_page_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception using errcode = '22023', message = 'Page key must be lowercase letters, digits and hyphens';
  end if;
  begin
    insert into website_documents (kind, page_key, created_by, updated_by)
    values (p_kind, p_page_key, auth.uid(), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'That page already exists';
  end;
  perform website_audit('website_document.created', 'website_document', v_id, null,
    jsonb_build_object('kind', p_kind, 'pageKey', p_page_key));
  return v_id;
end;
$$;

create or replace function website_create_program_document(p_program_id uuid, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prog record;
  v_id uuid;
begin
  perform website_assert_manager();
  if not website_is_valid_slug(p_slug) then
    raise exception using errcode = '22023', message = 'Slug must be 3-100 lowercase letters, digits and single hyphens';
  end if;
  select p.id, p.program_code, p.status into prog from programs p where p.id = p_program_id for key share;
  if prog.id is null then
    raise exception using errcode = 'P2204', message = 'Program not found';
  end if;
  if prog.status = 'archived' then
    raise exception using errcode = 'P2206', message = 'An archived Program cannot get website content';
  end if;
  begin
    insert into website_documents (kind, page_key, program_id, slug, created_by, updated_by)
    values ('program', 'program-' || prog.id::text, prog.id, p_slug, auth.uid(), auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception using errcode = 'P2205', message = 'That Program already has website content, or the slug is taken';
  end;
  perform website_audit('website_document.created', 'website_document', v_id, null,
    jsonb_build_object('kind', 'program', 'programId', prog.id, 'slug', p_slug));
  return v_id;
end;
$$;

create or replace function website_change_program_slug(
  p_document_id uuid,
  p_expected_version integer,
  p_new_slug text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d record;
begin
  perform website_assert_manager();
  if not website_is_valid_slug(p_new_slug) then
    raise exception using errcode = '22023', message = 'Slug must be 3-100 lowercase letters, digits and single hyphens';
  end if;
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null or d.kind <> 'program' then
    raise exception using errcode = 'P2204', message = 'Program website document not found';
  end if;
  if d.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This Program''s website settings were changed by someone else; reload and try again';
  end if;
  if d.slug = p_new_slug then
    raise exception using errcode = 'P2206', message = 'The slug is unchanged';
  end if;
  if d.first_published_at is not null and not is_super_admin() then
    raise exception using errcode = '42501', message = 'Only a Super Admin may change the slug of a Program that has been published';
  end if;
  begin
    update website_documents
       set slug = p_new_slug, version = d.version + 1, updated_by = auth.uid()
     where id = d.id;
  exception when unique_violation then
    raise exception using errcode = 'P2205', message = 'That slug is already used by another Program';
  end;
  perform website_audit('website_document.slug_changed', 'website_document', d.id,
    jsonb_build_object('slug', d.slug),
    jsonb_build_object('slug', p_new_slug, 'programId', d.program_id,
                       'redirectReserved', d.first_published_at is not null));
  return d.version + 1;
end;
$$;

create or replace function website_update_program_placement(
  p_document_id uuid,
  p_expected_version integer,
  p_display_group_id uuid,
  p_is_featured boolean,
  p_display_order integer,
  p_featured_order integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d record;
begin
  perform website_assert_manager();
  if p_is_featured is null then
    raise exception using errcode = '22023', message = 'Featured flag is required';
  end if;
  if (p_display_order is not null and p_display_order not between 1 and 10000)
     or (p_featured_order is not null and p_featured_order not between 1 and 10000) then
    raise exception using errcode = '22023', message = 'Display order must be between 1 and 10000';
  end if;
  if not p_is_featured and p_featured_order is not null then
    raise exception using errcode = '22023', message = 'Only a featured Program has a featured order';
  end if;
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null or d.kind <> 'program' then
    raise exception using errcode = 'P2204', message = 'Program website document not found';
  end if;
  if d.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This Program''s website settings were changed by someone else; reload and try again';
  end if;
  if p_display_group_id is not null then
    perform 1 from website_display_groups g where g.id = p_display_group_id and g.archived_at is null for key share;
    if not found then
      raise exception using errcode = 'P2206', message = 'Choose an active display group';
    end if;
  end if;
  update website_documents
     set display_group_id = p_display_group_id, is_featured = p_is_featured,
         display_order = p_display_order, featured_order = p_featured_order,
         version = d.version + 1, updated_by = auth.uid()
   where id = d.id;
  perform website_audit('website_document.placement_updated', 'website_document', d.id,
    jsonb_build_object('displayGroupId', d.display_group_id, 'isFeatured', d.is_featured,
                       'displayOrder', d.display_order, 'featuredOrder', d.featured_order),
    jsonb_build_object('programId', d.program_id, 'displayGroupId', p_display_group_id, 'isFeatured', p_is_featured,
                       'displayOrder', p_display_order, 'featuredOrder', p_featured_order));
  return d.version + 1;
end;
$$;

-- Internal: inserts one revision (already validated) and its media usage,
-- advancing the document's latest revision. Caller holds the document lock.
create or replace function website_insert_revision(
  p_document website_documents,
  p_title text,
  p_summary text,
  p_seo_title text,
  p_seo_description text,
  p_social_title text,
  p_social_description text,
  p_hero_image_asset_id uuid,
  p_social_image_asset_id uuid,
  p_sections jsonb,
  p_restored_from uuid
)
returns table (revision_id uuid, revision_number integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_number integer := p_document.latest_revision_number + 1;
  asset_ids uuid[];
  missing integer;
begin
  select coalesce(array_agg(distinct a), array[]::uuid[]) into asset_ids from (
    select p_hero_image_asset_id as a
    union all select p_social_image_asset_id
    union all select (s ->> 'imageAssetId')::uuid from jsonb_array_elements(p_sections) s where s ? 'imageAssetId'
  ) x where a is not null;

  select count(*) into missing from unnest(asset_ids) a
   where not exists (select 1 from website_media_assets m where m.id = a and m.status <> 'retired');
  if missing > 0 then
    raise exception using errcode = 'P2206', message = 'An image refers to a media asset that does not exist or is retired';
  end if;
  perform 1 from website_media_assets m where m.id = any (asset_ids) for key share;

  insert into website_document_revisions (
    document_id, revision_number, title, summary, seo_title, seo_description,
    social_title, social_description, hero_image_asset_id, social_image_asset_id,
    sections, restored_from_revision_id, created_by
  ) values (
    p_document.id, v_number, p_title, p_summary, p_seo_title, p_seo_description,
    p_social_title, p_social_description, p_hero_image_asset_id, p_social_image_asset_id,
    p_sections, p_restored_from, auth.uid()
  ) returning id into v_id;

  insert into website_revision_media (revision_id, asset_id)
  select v_id, a from unnest(asset_ids) a;

  update website_documents
     set latest_revision_id = v_id, latest_revision_number = v_number,
         version = version + 1, updated_by = auth.uid()
   where id = p_document.id;

  return query select v_id, v_number;
end;
$$;

-- Saves a new draft revision. p_base_revision_number is the latest revision
-- number the editor loaded (0 for the first save); anything else is stale.
create or replace function website_save_draft(
  p_document_id uuid,
  p_base_revision_number integer,
  p_title text,
  p_summary text,
  p_seo_title text,
  p_seo_description text,
  p_social_title text,
  p_social_description text,
  p_hero_image_asset_id uuid,
  p_social_image_asset_id uuid,
  p_sections jsonb
)
returns table (revision_id uuid, revision_number integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d website_documents;
  v_sections jsonb;
  r record;
begin
  perform website_assert_manager();
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null then
    raise exception using errcode = 'P2204', message = 'Website document not found';
  end if;
  if d.latest_revision_number <> coalesce(p_base_revision_number, -1) then
    raise exception using errcode = 'P2203', message = 'A newer version of this content was saved by someone else; reload and try again';
  end if;
  v_sections := website_validate_sections(d.kind, p_sections);

  select * into r from website_insert_revision(
    d,
    website_clean_text(p_title, case when d.kind = 'program' then 'Headline' else 'Title' end, 150, true),
    website_clean_text(p_summary, 'Summary', 500),
    website_clean_text(p_seo_title, 'SEO title', 70),
    website_clean_text(p_seo_description, 'SEO description', 170),
    website_clean_text(p_social_title, 'Social title', 100),
    website_clean_text(p_social_description, 'Social description', 200),
    p_hero_image_asset_id, p_social_image_asset_id, v_sections, null);

  perform website_audit('website_document.draft_saved', 'website_document', d.id, null,
    jsonb_build_object('revisionId', r.revision_id, 'revisionNumber', r.revision_number,
                       'programId', d.program_id));
  return query select r.revision_id, r.revision_number;
end;
$$;

-- Restores an earlier revision as a NEW draft revision (copying content
-- columns only from a revision of the same document). Needs a separate publish.
create or replace function website_restore_revision(
  p_document_id uuid,
  p_source_revision_id uuid,
  p_base_revision_number integer
)
returns table (revision_id uuid, revision_number integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d website_documents;
  src website_document_revisions;
  r record;
begin
  perform website_assert_manager();
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null then
    raise exception using errcode = 'P2204', message = 'Website document not found';
  end if;
  if d.latest_revision_number <> coalesce(p_base_revision_number, -1) then
    raise exception using errcode = 'P2203', message = 'A newer version of this content was saved by someone else; reload and try again';
  end if;
  select * into src from website_document_revisions s where s.id = p_source_revision_id and s.document_id = d.id;
  if src.id is null then
    raise exception using errcode = 'P2204', message = 'That revision does not belong to this document';
  end if;

  -- Re-validated against today's rules so a restore cannot bring back
  -- content the current rules reject.
  select * into r from website_insert_revision(
    d,
    website_clean_text(src.title, 'Title', 150, true),
    website_clean_text(src.summary, 'Summary', 500),
    website_clean_text(src.seo_title, 'SEO title', 70),
    website_clean_text(src.seo_description, 'SEO description', 170),
    website_clean_text(src.social_title, 'Social title', 100),
    website_clean_text(src.social_description, 'Social description', 200),
    src.hero_image_asset_id, src.social_image_asset_id,
    website_validate_sections(d.kind, src.sections), src.id);

  perform website_audit('website_document.revision_restored', 'website_document', d.id, null,
    jsonb_build_object('revisionId', r.revision_id, 'revisionNumber', r.revision_number,
                       'restoredFromRevisionId', src.id, 'restoredFromRevisionNumber', src.revision_number,
                       'programId', d.program_id));
  return query select r.revision_id, r.revision_number;
end;
$$;

-- Publishes the document's LATEST revision. Naming any other revision (for
-- example because a newer draft was saved meanwhile) is stale.
create or replace function website_publish_document(p_document_id uuid, p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d website_documents;
  prog_status text;
  unapproved integer;
  v_number integer;
begin
  perform website_assert_manager();
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null then
    raise exception using errcode = 'P2204', message = 'Website document not found';
  end if;
  if d.latest_revision_id is null then
    raise exception using errcode = 'P2206', message = 'Save content before publishing';
  end if;
  if p_revision_id is distinct from d.latest_revision_id then
    raise exception using errcode = 'P2203', message = 'A newer version of this content exists; review it before publishing';
  end if;
  if d.published_revision_id = d.latest_revision_id then
    raise exception using errcode = 'P2206', message = 'This version is already published';
  end if;
  if d.kind = 'program' then
    select p.status into prog_status from programs p where p.id = d.program_id for share;
    if prog_status is distinct from 'active' then
      raise exception using errcode = 'P2206', message = 'Only an active Program can be published on the website';
    end if;
  end if;
  select count(*) into unapproved
    from website_revision_media rm join website_media_assets m on m.id = rm.asset_id
   where rm.revision_id = d.latest_revision_id and m.status <> 'approved';
  if unapproved > 0 then
    raise exception using errcode = 'P2206', message = 'Every image must be an approved media asset before publishing';
  end if;
  perform 1 from website_media_assets m
    join website_revision_media rm on rm.asset_id = m.id and rm.revision_id = d.latest_revision_id
    for share of m;

  update website_documents
     set published_revision_id = d.latest_revision_id, published_at = now(), published_by = auth.uid(),
         first_published_at = coalesce(d.first_published_at, now()),
         version = d.version + 1, updated_by = auth.uid()
   where id = d.id;
  select revision_number into v_number from website_document_revisions where id = d.latest_revision_id;
  perform website_audit('website_document.published', 'website_document', d.id,
    jsonb_build_object('publishedRevisionId', d.published_revision_id),
    jsonb_build_object('publishedRevisionId', d.latest_revision_id, 'revisionNumber', v_number,
                       'programId', d.program_id, 'slug', d.slug, 'firstPublication', d.first_published_at is null));
end;
$$;

create or replace function website_unpublish_document(p_document_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d website_documents;
begin
  perform website_assert_manager();
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null then
    raise exception using errcode = 'P2204', message = 'Website document not found';
  end if;
  if d.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This content was changed by someone else; reload and try again';
  end if;
  if d.published_revision_id is null then
    raise exception using errcode = 'P2206', message = 'This content is not published';
  end if;
  update website_documents
     set published_revision_id = null, published_at = null, published_by = null,
         unpublished_at = now(), unpublished_by = auth.uid(),
         version = d.version + 1, updated_by = auth.uid()
   where id = d.id;
  perform website_audit('website_document.unpublished', 'website_document', d.id,
    jsonb_build_object('publishedRevisionId', d.published_revision_id),
    jsonb_build_object('programId', d.program_id, 'slug', d.slug));
  return d.version + 1;
end;
$$;

-- Removes a document that was NEVER published (with its draft revisions).
-- Anything ever published is kept (trigger-enforced): its slug, links and
-- assets are publication history (TI-7).
create or replace function website_discard_unpublished_document(p_document_id uuid, p_expected_version integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d website_documents;
begin
  perform website_assert_manager();
  select * into d from website_documents where id = p_document_id for update;
  if d.id is null then
    raise exception using errcode = 'P2204', message = 'Website document not found';
  end if;
  if d.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This content was changed by someone else; reload and try again';
  end if;
  if d.first_published_at is not null then
    raise exception using errcode = 'P2206', message = 'Content that was ever published cannot be discarded; unpublish it instead';
  end if;
  update website_documents set latest_revision_id = null, published_revision_id = null where id = d.id;
  delete from website_documents where id = d.id;
  perform website_audit('website_document.discarded', 'website_document', d.id,
    jsonb_build_object('kind', d.kind, 'pageKey', d.page_key, 'programId', d.program_id,
                       'slug', d.slug, 'revisionCount', d.latest_revision_number),
    null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Media asset functions

-- Registers metadata for an object already stored in website-media (the
-- upload path itself arrives with 22B). Starts as draft.
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
begin
  perform website_assert_manager();
  v_alt := website_clean_text(p_alt_text, 'Alt text', 250);
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
    jsonb_build_object('storagePath', p_storage_path, 'mimeType', p_mime_type, 'byteSize', p_byte_size));
  return v_id;
end;
$$;

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
  update website_media_assets
     set alt_text = v_alt, status = p_status,
         approved_at = case when p_status = 'approved' and m.status <> 'approved' then now()
                            when p_status = 'approved' then m.approved_at else null end,
         approved_by = case when p_status = 'approved' and m.status <> 'approved' then auth.uid()
                            when p_status = 'approved' then m.approved_by else null end,
         version = m.version + 1, updated_by = auth.uid()
   where id = m.id;
  perform website_audit('website_media_asset.updated', 'website_media_asset', m.id,
    jsonb_build_object('status', m.status), jsonb_build_object('status', p_status));
  return m.version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Batch website publication functions

-- Creates (p_expected_version = 0) or edits the PRIVATE draft label/state.
create or replace function website_save_batch_publication(
  p_batch_id uuid,
  p_expected_version integer,
  p_public_label text,
  p_registration_state text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pub record;
  v_label text;
begin
  perform website_assert_manager();
  v_label := website_clean_text(p_public_label, 'Public label', 120);
  if p_registration_state is null or p_registration_state not in ('open', 'closed', 'full') then
    raise exception using errcode = '22023', message = 'Registration state must be Open, Closed or Full';
  end if;
  perform 1 from batches b where b.id = p_batch_id for key share;
  if not found then
    raise exception using errcode = 'P2204', message = 'Batch not found';
  end if;
  perform pg_advisory_xact_lock(hashtext('batch_website_publication:' || p_batch_id::text));
  select * into pub from batch_website_publications where batch_id = p_batch_id for update;
  if pub.batch_id is null then
    if coalesce(p_expected_version, -1) <> 0 then
      raise exception using errcode = 'P2203', message = 'This Batch''s website settings changed; reload and try again';
    end if;
    insert into batch_website_publications (batch_id, draft_public_label, draft_registration_state, created_by, updated_by)
    values (p_batch_id, v_label, p_registration_state, auth.uid(), auth.uid());
    perform website_audit('batch_website_publication.draft_saved', 'batch_website_publication', p_batch_id, null,
      jsonb_build_object('publicLabel', v_label, 'registrationState', p_registration_state));
    return 1;
  end if;
  if pub.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This Batch''s website settings were changed by someone else; reload and try again';
  end if;
  update batch_website_publications
     set draft_public_label = v_label, draft_registration_state = p_registration_state,
         version = pub.version + 1, updated_by = auth.uid()
   where batch_id = p_batch_id;
  perform website_audit('batch_website_publication.draft_saved', 'batch_website_publication', p_batch_id,
    jsonb_build_object('publicLabel', pub.draft_public_label, 'registrationState', pub.draft_registration_state),
    jsonb_build_object('publicLabel', v_label, 'registrationState', p_registration_state));
  return pub.version + 1;
end;
$$;

-- Publishes the draft label/state. Only an upcoming or active Batch may be
-- published (operational status stays the LMS's own field; TI-3 still
-- decides how 22C treats active Batches).
create or replace function website_publish_batch(p_batch_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pub record;
  b_status text;
begin
  perform website_assert_manager();
  select b.status into b_status from batches b where b.id = p_batch_id for share;
  if b_status is null then
    raise exception using errcode = 'P2204', message = 'Batch not found';
  end if;
  select * into pub from batch_website_publications where batch_id = p_batch_id for update;
  if pub.batch_id is null then
    raise exception using errcode = 'P2206', message = 'Save the Batch''s public label and registration state first';
  end if;
  if pub.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This Batch''s website settings were changed by someone else; reload and try again';
  end if;
  if b_status not in ('upcoming', 'active') then
    raise exception using errcode = 'P2206', message = 'Only an upcoming or active Batch can be published on the website';
  end if;
  if pub.draft_public_label is null then
    raise exception using errcode = '22023', message = 'A public label is required to publish a Batch';
  end if;
  update batch_website_publications
     set is_published = true, published_label = pub.draft_public_label,
         published_registration_state = pub.draft_registration_state,
         published_at = now(), published_by = auth.uid(),
         first_published_at = coalesce(pub.first_published_at, now()),
         version = pub.version + 1, updated_by = auth.uid()
   where batch_id = p_batch_id;
  perform website_audit('batch_website_publication.published', 'batch_website_publication', p_batch_id,
    jsonb_build_object('publishedLabel', pub.published_label, 'registrationState', pub.published_registration_state),
    jsonb_build_object('publishedLabel', pub.draft_public_label, 'registrationState', pub.draft_registration_state));
  return pub.version + 1;
end;
$$;

create or replace function website_unpublish_batch(p_batch_id uuid, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pub record;
begin
  perform website_assert_manager();
  select * into pub from batch_website_publications where batch_id = p_batch_id for update;
  if pub.batch_id is null or not pub.is_published then
    raise exception using errcode = 'P2206', message = 'This Batch is not published';
  end if;
  if pub.version <> coalesce(p_expected_version, -1) then
    raise exception using errcode = 'P2203', message = 'This Batch''s website settings were changed by someone else; reload and try again';
  end if;
  update batch_website_publications
     set is_published = false, unpublished_at = now(), unpublished_by = auth.uid(),
         version = pub.version + 1, updated_by = auth.uid()
   where batch_id = p_batch_id;
  perform website_audit('batch_website_publication.unpublished', 'batch_website_publication', p_batch_id, null, null);
  return pub.version + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Function privileges
-- Internal helpers and trigger functions: no API role may call them.
-- Management functions: authenticated only, each self-checks the session.

revoke execute on function website_assert_manager() from public, anon, authenticated;
revoke execute on function website_clean_text(text, text, integer, boolean) from public, anon, authenticated;
revoke execute on function website_is_safe_href(text) from public, anon, authenticated;
revoke execute on function website_is_valid_slug(text) from public, anon, authenticated;
revoke execute on function website_allowed_section_types(text) from public, anon, authenticated;
revoke execute on function website_validate_sections(text, jsonb) from public, anon, authenticated;
revoke execute on function website_audit(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function website_insert_revision(website_documents, text, text, text, text, text, text, uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke execute on function prevent_website_revision_update() from public, anon, authenticated;
revoke execute on function prevent_website_slug_history_change() from public, anon, authenticated;
revoke execute on function guard_website_document_change() from public, anon, authenticated;
revoke execute on function guard_website_document_insert() from public, anon, authenticated;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'website_create_display_group(text, text)',
    'website_update_display_group(uuid, integer, text, text, boolean)',
    'website_reorder_display_groups(uuid[])',
    'website_set_display_group_archived(uuid, integer, boolean)',
    'website_create_page(text, text)',
    'website_create_program_document(uuid, text)',
    'website_change_program_slug(uuid, integer, text)',
    'website_update_program_placement(uuid, integer, uuid, boolean, integer, integer)',
    'website_save_draft(uuid, integer, text, text, text, text, text, text, uuid, uuid, jsonb)',
    'website_restore_revision(uuid, uuid, integer)',
    'website_publish_document(uuid, uuid)',
    'website_unpublish_document(uuid, integer)',
    'website_discard_unpublished_document(uuid, integer)',
    'website_register_media_asset(text, text, integer, integer, integer, text)',
    'website_update_media_asset(uuid, integer, text, text)',
    'website_save_batch_publication(uuid, integer, text, text)',
    'website_publish_batch(uuid, integer)',
    'website_unpublish_batch(uuid, integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;
