#!/usr/bin/env node
// Generates docs/recovery/phase22a_dev_recovery.sql — an ENVIRONMENT-SPECIFIC
// recovery script for the Roicians India DEV project only. It is not a
// migration, is never picked up by `supabase db push`, and is NOT authorized
// for execution by being generated or committed.
//
// Inputs (all from the repository):
//   supabase/migrations/20260101000040_website_content_foundation.sql  (pinned SHA-256)
//   supabase/migrations/20260101000041_program_deletion_safeguards.sql (pinned SHA-256)
//   supabase/migrations/20260101000042_phase22a_corrections.sql        (SHA-256 recorded)
//   docs/recovery/sql/phase22a_partial_state_fingerprint.sql
//   docs/recovery/sql/phase22a_final_state_fingerprint.sql
//   docs/recovery/phase22a_expected_final_state.txt (output of the final
//     fingerprint on a clean local replay of migrations 1-42; written by
//     scripts/recovery/rehearse-phase22a-dev-recovery.sh)
//
// Usage: node scripts/recovery/generate-phase22a-dev-recovery.mjs
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIG = join(ROOT, "supabase", "migrations");
const OUT = join(ROOT, "docs", "recovery", "phase22a_dev_recovery.sql");

// DEV facts observed read-only on 2026-10-20 (docs/recovery/PHASE_22A_RECOVERY_REVIEW.md).
const DEV = {
  projectRef: "nqeaehqzhjhhgsilrgeo",
  systemIdentifier: "7678069749886157684",
  historyCount: 39,
  historyMd5: "7ee3ee94d20444544a690045aebf7833",
  partialFingerprint: [
    "B=website-media:false",
    "C=417572c22e822961772230e4a866931a",
    "COL=1f932f1fcdfbefafc21398f304c1c84b",
    "F=1e0f74199add9a55b5f421c66b7b6dd5",
    "FG=a33ff937b2981e3b7ecddcbe988883c6",
    "G=d99031c5b6e7a1a09fb0457f2796bb1d",
    "I=f8580b9b321f11c256c6f2893acbc445",
    "P=3336252ad938782e346204a4d1e97bf4",
    "RLS=batch_website_publications=true,website_display_groups=true,website_document_revisions=true,website_documents=true,website_media_assets=true,website_program_slug_history=true,website_revision_media=true",
    "T=4dbc96fb1a9ca6c05c1af2fa8fc74049",
  ],
};

const PINNED = {
  "20260101000040_website_content_foundation.sql":
    "e7f87f8a78a99e5156e3f45fea14820a12e20e0ed32da8186342e5a12c13b837",
  "20260101000041_program_deletion_safeguards.sql":
    "8b3bd346844473cefe85bc71228e327088306a10a0397af19363901e38d3ad8e",
};
const M42 = "20260101000042_phase22a_corrections.sql";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const md5 = (s) => createHash("md5").update(s).digest("hex");
const read = (p) => readFileSync(p, "utf8");

const sources = {};
for (const f of [...Object.keys(PINNED), M42]) {
  const text = read(join(MIG, f));
  const hash = sha256(text);
  if (PINNED[f] && PINNED[f] !== hash) {
    throw new Error(`${f} changed: ${hash} (pinned ${PINNED[f]})`);
  }
  sources[f] = { text, hash };
}

// History: version:name from the migration file names, as Supabase records them.
const migrationFiles = readdirSync(MIG)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const entry = (f) => `${f.slice(0, 14)}:${f.slice(15, -4)}`;
const first39 = migrationFiles.slice(0, 39).map(entry).join(",");
if (md5(first39) !== DEV.historyMd5) {
  throw new Error("migration file names 1-39 do not reproduce the DEV history checksum");
}
const all42 = migrationFiles.slice(0, 42).map(entry);
if (all42.length !== 42 || !all42[41].startsWith("20260101000042:")) {
  throw new Error("expected exactly migrations 1-42");
}
const finalHistoryMd5 = md5(all42.join(","));

// Only the one migration-40 object DEV is missing: the discard function.
const m40 = sources["20260101000040_website_content_foundation.sql"].text;
const discardStart = m40.indexOf(
  "create or replace function website_discard_unpublished_document",
);
const discardEnd = m40.indexOf(
  "-- ---------------------------------------------------------------------------\n-- 12. Media asset functions",
);
if (discardStart < 0 || discardEnd < 0)
  throw new Error("discard function not found in migration 40");
const discardFn = m40.slice(discardStart, discardEnd).trimEnd();

const stripQuery = (p) =>
  read(p)
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n")
    .trim()
    .replace(/;\s*$/, "");
const partialQuery = stripQuery(
  join(ROOT, "docs/recovery/sql/phase22a_partial_state_fingerprint.sql"),
);
const finalQuery = stripQuery(
  join(ROOT, "docs/recovery/sql/phase22a_final_state_fingerprint.sql"),
);
const expectedFinal = read(
  join(ROOT, "docs/recovery/phase22a_expected_final_state.txt"),
).trim();
for (const s of [expectedFinal, ...DEV.partialFingerprint]) {
  if (s.includes("$")) throw new Error("unexpected $ in a pinned value");
}

const absentFunctions = [
  "website_discard_unpublished_document",
  "guard_program_delete",
  "program_deletion_blockers",
  "program_deletion_blockers_internal",
  "delete_archived_program",
  "guard_program_created_at",
  "record_program_history_on_delete",
  "program_unattributable_history",
];
const absentTriggers = [
  "programs_guard_delete",
  "programs_guard_created_at",
  "enrollments_record_program_history",
  "batches_record_program_history",
  "certificates_record_program_history",
];
const sqlList = (xs) => xs.map((x) => `'${x}'`).join(", ");
const note = (f) =>
  `-- Phase 22A DEV recovery (docs/recovery/phase22a_dev_recovery.sql): ${f} applied with its preconditions and verified postconditions; source SHA-256 ${sources[f].hash}`;

const sql = `-- =============================================================================
-- Phase 22A DEV RECOVERY — ENVIRONMENT-SPECIFIC, NOT A MIGRATION.
-- Target: Supabase project ${DEV.projectRef} ("Roicians India LMS Dev") ONLY.
-- NOT AUTHORIZED FOR EXECUTION until the owner explicitly approves THIS exact
-- file by its SHA-256 (see docs/recovery/PHASE_22A_RECOVERY_REVIEW.md).
--
-- Generated by scripts/recovery/generate-phase22a-dev-recovery.mjs from:
${[...Object.keys(PINNED), M42].map((f) => `--   supabase/migrations/${f}  sha256 ${sources[f].hash}`).join("\n")}
--
-- One transaction. In order:
--   0. preconditions (target cluster, exact partial state, history, no prior or
--      late execution, no website data, exclusive migration lock);
--   A. the ONLY missing migration-40 object: website_discard_unpublished_document
--      (+ its EXECUTE revoke/grant), verbatim from migration 40;
--   B. migration 41, verbatim;
--   C. migration 42, verbatim (replaces the migration-41 guard and eligibility
--      function before commit, so the original migration-41 guard is never the
--      committed end state);
--   D. postconditions: the full 22A schema fingerprint must equal a clean
--      replay of migrations 1-42;
--   E. migration history rows 40, 41, 42 — written only after D passed — and
--      the resulting 42-row history verified.
-- Any failure raises; nothing is committed. No row of any existing table is
-- updated or deleted. Function bodies that CONTAIN a DELETE statement are only
-- defined here, never executed.
-- =============================================================================

begin;

set local lock_timeout = '10s';
set local statement_timeout = '5min';

-- 0. Preconditions --------------------------------------------------------------
do $pre$
declare
  p22a_fp text;
  p22a_rows bigint;
begin
  if (select system_identifier::text from pg_control_system()) <> '${DEV.systemIdentifier}' then
    raise exception 'Phase 22A recovery: wrong database cluster (system identifier does not match DEV ${DEV.projectRef})';
  end if;
  if current_database() <> 'postgres' or current_setting('server_version_num')::int not between 170000 and 179999 then
    raise exception 'Phase 22A recovery: unexpected database or PostgreSQL version';
  end if;
  if current_user <> 'postgres' then
    raise exception 'Phase 22A recovery: must run as postgres (objects must be owned like a normal migration), not %', current_user;
  end if;

  -- No concurrent migration activity.
  if not pg_try_advisory_xact_lock(hashtext('roicians.phase22a.dev_recovery')) then
    raise exception 'Phase 22A recovery: another recovery attempt is running';
  end if;
  lock table supabase_migrations.schema_migrations in share row exclusive mode nowait;

  -- Exact migration history: 39 rows, unchanged; nothing for 40-42.
  select count(*), md5(string_agg(version || ':' || name, ',' order by version collate "C"))
    into p22a_rows, p22a_fp from supabase_migrations.schema_migrations;
  if p22a_rows <> ${DEV.historyCount} or p22a_fp <> '${DEV.historyMd5}' then
    raise exception 'Phase 22A recovery: migration history differs from the reviewed state (% rows) - already applied, partly applied or changed', p22a_rows;
  end if;

  -- Exact partial migration-40 state as fingerprinted on DEV.
  select string_agg(line, E'\\n' order by line collate "C") into p22a_fp from (
${partialQuery}
  ) q(line);
  if p22a_fp is distinct from $expected_partial$${DEV.partialFingerprint.join("\n")}$expected_partial$ then
    raise exception 'Phase 22A recovery: the migration-40 objects differ from the reviewed partial state'
      using detail = coalesce(p22a_fp, '(none)');
  end if;

  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'website\\_%') <> 25 then
    raise exception 'Phase 22A recovery: expected exactly 25 website_* functions';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in (${sqlList(absentFunctions)})) then
    raise exception 'Phase 22A recovery: migration 40/41/42 functions already exist (late or earlier execution)';
  end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname in (${sqlList(absentTriggers)})) then
    raise exception 'Phase 22A recovery: migration 41/42 triggers already exist';
  end if;
  if (select string_agg(pg_get_userbyid(proowner) || ':' || has_function_privilege('service_role', oid, 'execute'), ',')
        from (select distinct proowner, oid from pg_proc
               where pronamespace = 'public'::regnamespace
                 and (proname like 'website\\_%' or proname in ('guard_website_document_change', 'guard_website_document_insert',
                                                                'prevent_website_revision_update', 'prevent_website_slug_history_change'))) f)
     <> repeat('postgres:true,', 28) || 'postgres:true' then
    raise exception 'Phase 22A recovery: website function owners or service_role grants differ from the reviewed state';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'programs'
                  and policyname = 'programs_delete_admin' and cmd = 'DELETE' and qual = 'is_admin_or_super()')
     or not has_table_privilege('authenticated', 'public.programs', 'delete') then
    raise exception 'Phase 22A recovery: Program DELETE permissions differ from the reviewed pre-41 state';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'website_documents_kind')) ~ 'programs_listing' then
    raise exception 'Phase 22A recovery: migration 42 page kinds already present';
  end if;

  -- No website data, files or Phase 22A audit activity (would indicate use or late execution).
  if exists (select 1 from website_documents) or exists (select 1 from website_document_revisions)
     or exists (select 1 from website_display_groups) or exists (select 1 from website_media_assets)
     or exists (select 1 from website_revision_media) or exists (select 1 from website_program_slug_history)
     or exists (select 1 from batch_website_publications)
     or exists (select 1 from storage.objects where bucket_id = 'website-media') then
    raise exception 'Phase 22A recovery: website tables or the website-media bucket are not empty';
  end if;
  if exists (select 1 from audit_logs where action like 'website\\_%' or action like 'batch\\_website\\_%'
                or action = 'program.deleted' or action like '%.row\\_deleted') then
    raise exception 'Phase 22A recovery: Phase 22A audit activity already exists';
  end if;
end
$pre$;

-- A. Migration 40 — the only missing object ---------------------------------------
${discardFn}

revoke execute on function website_discard_unpublished_document(uuid, integer) from public, anon, authenticated;
grant execute on function website_discard_unpublished_document(uuid, integer) to authenticated;

-- B. Migration 41 (verbatim) ---------------------------------------------------------
${sources["20260101000041_program_deletion_safeguards.sql"].text.trimEnd()}

-- C. Migration 42 (verbatim) ---------------------------------------------------------
${sources[M42].text.trimEnd()}

-- D. Postconditions ----------------------------------------------------------------
do $post$
declare
  p22a_fp text;
begin
  select string_agg(line, E'\\n' order by line collate "C") into p22a_fp from (
${finalQuery}
  ) q(line);
  if p22a_fp is distinct from $expected_final$${expectedFinal}$expected_final$ then
    raise exception 'Phase 22A recovery: resulting schema differs from a clean install of migrations 1-42'
      using detail = coalesce(p22a_fp, '(none)');
  end if;
  if exists (select 1 from pg_policies where tablename = 'programs' and policyname = 'programs_delete_admin')
     or has_table_privilege('authenticated', 'public.programs', 'delete') then
    raise exception 'Phase 22A recovery: broad Program DELETE still present';
  end if;
end
$post$;

-- E. Migration history (only after D) ---------------------------------------------
insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20260101000040', 'website_content_foundation',
   array['${note("20260101000040_website_content_foundation.sql")}']),
  ('20260101000041', 'program_deletion_safeguards',
   array['${note("20260101000041_program_deletion_safeguards.sql")}']),
  ('20260101000042', 'phase22a_corrections',
   array['${note(M42)}']);

do $hist$
begin
  if (select md5(string_agg(version || ':' || name, ',' order by version collate "C")) from supabase_migrations.schema_migrations)
     <> '${finalHistoryMd5}' then
    raise exception 'Phase 22A recovery: resulting migration history is not migrations 1-42';
  end if;
end
$hist$;

commit;
`;

writeFileSync(OUT, sql);
const outHash = sha256(sql);
writeFileSync(`${OUT}.sha256`, `${outHash}  phase22a_dev_recovery.sql\n`);
console.log(`wrote ${OUT}`);
console.log(`sha256 ${outHash}`);
for (const f of Object.keys(sources)) console.log(`source ${f} ${sources[f].hash}`);
console.log(`final history md5 ${finalHistoryMd5}`);
