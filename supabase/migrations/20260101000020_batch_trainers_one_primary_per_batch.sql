-- Fix (manual QA finding, Phase 8 Batch Management): a Batch could end up
-- with more than one Primary Trainer. The prior mitigation (commit
-- 43b39b3) enforced the invariant with two independent PostgREST requests
-- (insert, then a demote UPDATE) plus a best-effort compensating DELETE on
-- failure — never a real database transaction, so a genuine race between
-- two concurrent "assign as Primary" requests could still corrupt the
-- invariant (proven in lib/data/__tests__/batches.test.ts: forcing both
-- inserts to land before either demote ran left the batch with *zero*
-- Primaries, since each demote only ever clears the *other* request's row
-- and never re-asserts its own target true). This migration makes the
-- database itself the source of truth for the invariant, and folds the
-- read-modify-write "replace" into one atomic function so a genuine race
-- can no longer produce a wrong end state at all: either one request wins
-- outright, or the other gets a clean, well-understood error — never a
-- silently corrupted row set.
--
-- unique(batch_id, trainer_id) (batch_trainers_unique, added in
-- 20260101000005_catalog_tables.sql) is untouched — duplicate-trainer
-- prevention is a separate concern from Primary uniqueness.

-- ---------------------------------------------------------------------------
-- 1. Partial unique index: the database itself never allows more than one
--    is_primary = true row per batch, regardless of which code path writes
--    to batch_trainers — the RPC below, any future admin tool, or a manual
--    psql session. This is the actual invariant; everything else here is
--    ergonomics around it.
create unique index if not exists batch_trainers_one_primary_per_batch
  on batch_trainers (batch_id)
  where is_primary;

comment on index batch_trainers_one_primary_per_batch is
  'Enforces at most one Primary Trainer per Batch at the database level. Duplicate-trainer prevention is unrelated and stays on batch_trainers_unique (batch_id, trainer_id).';

-- ---------------------------------------------------------------------------
-- 2. Atomic assign/replace-Primary RPC. Runs "capture the previous Primary
--    -> demote everyone else on the batch (only when the new assignment is
--    requested as Primary) -> insert the new assignment" as the single
--    transaction a Postgres function body always executes in: a failure at
--    any step (the insert hitting either unique constraint, or a bad
--    trainer_id hitting the foreign key) rolls back everything, including
--    the demote — never a half-applied state. This replaces the 43b39b3
--    app-layer insert+demote+compensating-delete workaround (two
--    independent PostgREST requests) as the one authoritative write path
--    for assigning a trainer to a batch.
--
--    SECURITY DEFINER is required: batch_trainers has RLS enabled, and this
--    function's demote step updates OTHER trainers' rows on the batch,
--    which the calling admin does not "own" in any row-scoped sense — the
--    same class of problem the RLS helper functions above solve. Safety:
--      (1) the function re-checks is_admin_or_super() before touching
--          anything, exactly like the existing self-edit-restriction
--          triggers, so it grants no more access than the RLS policies it
--          stands in for on this one operation — Trainer, Student, and
--          anon (all mapped to `authenticated` or `anon`, same as every
--          other role in this schema) are all rejected inside the
--          function body itself, not just by a grant;
--      (2) search_path is pinned, preventing search-path hijacking;
--      (3) no dynamic SQL — every statement is fixed, with parameters
--          passed as bind variables, never concatenated;
--      (4) EXECUTE is revoked from PUBLIC/anon/authenticated (Supabase
--          grants EXECUTE on every new function to all three by default;
--          see 20260101000016) and re-granted only to `authenticated` —
--          the in-function role check then narrows that to Admin/Super
--          Admin only, the same pattern already used for is_admin_or_super()
--          and friends.
create or replace function public.assign_batch_trainer(
  p_batch_id uuid,
  p_trainer_id uuid,
  p_is_primary boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_primary_trainer_id uuid;
begin
  if not is_admin_or_super() then
    raise exception 'Not authorized to assign trainers to batches.' using errcode = '42501';
  end if;

  if p_is_primary then
    select trainer_id into v_previous_primary_trainer_id
    from batch_trainers
    where batch_id = p_batch_id and is_primary;

    update batch_trainers
    set is_primary = false
    where batch_id = p_batch_id and is_primary;
  end if;

  insert into batch_trainers (batch_id, trainer_id, is_primary)
  values (p_batch_id, p_trainer_id, p_is_primary);

  return v_previous_primary_trainer_id;
end;
$$;

comment on function public.assign_batch_trainer(uuid, uuid, boolean) is
  'The one authoritative write path for assigning a Trainer to a Batch (optionally as Primary). Demotes any existing Primary and inserts the new assignment as a single atomic transaction, then relies on batch_trainers_one_primary_per_batch (a partial unique index) as the unconditional backstop even against a genuine race between two concurrent calls. Returns the previous Primary trainer_id (or null) for the caller''s audit event. Admin/Super Admin only, enforced inside the function body since SECURITY DEFINER bypasses batch_trainers'' own RLS policies.';

revoke execute on function public.assign_batch_trainer(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.assign_batch_trainer(uuid, uuid, boolean) to authenticated;
