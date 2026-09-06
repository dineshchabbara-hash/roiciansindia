-- Shared helper: maintains updated_at on every table that has one.
-- gen_random_uuid() is built into Postgres 13+ (and available by default on
-- Supabase), so no extension needs to be enabled for UUID primary keys.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function set_updated_at() is
  'Row-level trigger: stamps updated_at = now() on every UPDATE. Attached per-table below.';
