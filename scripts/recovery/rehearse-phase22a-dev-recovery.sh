#!/usr/bin/env bash
# Rehearses the Phase 22A DEV recovery in DISPOSABLE LOCAL databases only.
# Never connects to Supabase.
#
#   A. Clean replay: migrations 1-42 (+ a simulated 42-row migration history).
#      Its final-state fingerprint becomes docs/recovery/phase22a_expected_final_state.txt
#      and the recovery script is (re)generated from the canonical files.
#   B. Recovery replay: migrations 1-39 + migration 40 WITHOUT the discard
#      function (the exact partial state fingerprinted on DEV) + a simulated
#      39-row history, then the generated recovery script.
#      Only two constants are substituted for the rehearsal — the DEV cluster
#      system identifier and the database name — and the diff is asserted to
#      be exactly those two lines.
#   Then: A and B are compared (final fingerprint, pg_dump --schema-only,
#   migration history); a repeated run, a wrong target and a simulated late
#   execution must all refuse; the Phase 22A SQL suites run on B.
#
# Env: PSQL_HOST / PSQL_PORT / PG_BIN to target a specific local cluster
# (e.g. PostgreSQL 17: PSQL_HOST=/var/tmp/pg17 PSQL_PORT=5433 PG_BIN=/var/tmp/pg17/bin).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
chmod 755 "${WORK}"
CLEAN="p22a_clean_$$"
PARTIAL="p22a_partial_$$"
SCRATCH="p22a_scratch_$$"
CONN=()
[[ -n "${PSQL_HOST:-}" ]] && CONN+=(-h "${PSQL_HOST}")
[[ -n "${PSQL_PORT:-}" ]] && CONN+=(-p "${PSQL_PORT}")
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
export LD_LIBRARY_PATH="${PG_BIN%/bin}/lib:${LD_LIBRARY_PATH:-}"

if [[ -z "${PSQL_HOST:-}" ]] && ! pg_lsclusters --no-header | awk '{print $4}' | grep -q '^online$'; then
  sudo pg_ctlcluster 16 main start
fi

psql_as() { sudo -u postgres env LD_LIBRARY_PATH="${LD_LIBRARY_PATH}" psql "${CONN[@]}" "$@"; }
run_file() { psql_as -v ON_ERROR_STOP=1 -q -d "$1" -f "$2" >/dev/null; }
cleanup() {
  for db in "${CLEAN}" "${PARTIAL}" "${SCRATCH}"; do psql_as -q -c "drop database if exists ${db};" >/dev/null 2>&1 || true; done
  rm -rf "${WORK}"
}
trap cleanup EXIT

echo "Server: $(psql_as -At -c 'select version()')"

history_table() {
  psql_as -v ON_ERROR_STOP=1 -q -d "$1" -c "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"
}
insert_history() { # db first last
  local db="$1" first="$2" last="$3"
  ls "${REPO_ROOT}"/supabase/migrations/*.sql | sort | sed -n "${first},${last}p" | while read -r f; do
    local b; b="$(basename "$f" .sql)"
    echo "insert into supabase_migrations.schema_migrations (version, name, statements) values ('${b:0:14}', '${b:15}', array['-- local replay']);"
  done | psql_as -v ON_ERROR_STOP=1 -q -d "${db}" >/dev/null
}
final_state() { # db -> text, aggregated exactly as the recovery script does
  { echo "select string_agg(line, E'\\n' order by line collate \"C\") from ("
    grep -v '^--' "${REPO_ROOT}/docs/recovery/sql/phase22a_final_state_fingerprint.sql"
    echo ") q(line);"; } > "${WORK}/final_wrapper.sql"
  psql_as -v ON_ERROR_STOP=1 -At -d "$1" -f "${WORK}/final_wrapper.sql"
}
partial_state() {
  { echo "select string_agg(line, E'\\n' order by line collate \"C\") from ("
    grep -v '^--' "${REPO_ROOT}/docs/recovery/sql/phase22a_partial_state_fingerprint.sql" | sed 's/;\s*$//'
    echo ") q(line);"; } > "${WORK}/partial_wrapper.sql"
  psql_as -v ON_ERROR_STOP=1 -At -d "$1" -f "${WORK}/partial_wrapper.sql"
}

# A. clean replay ------------------------------------------------------------
psql_as -q -c "create database ${CLEAN};"
run_file "${CLEAN}" "${REPO_ROOT}/supabase/tests/auth_schema_stub.sql"
history_table "${CLEAN}"
for m in "${REPO_ROOT}"/supabase/migrations/*.sql; do run_file "${CLEAN}" "$m"; done
insert_history "${CLEAN}" 1 42
final_state "${CLEAN}" > "${REPO_ROOT}/docs/recovery/phase22a_expected_final_state.txt"
echo "A. clean replay of 1-42: final state $(md5sum < "${REPO_ROOT}/docs/recovery/phase22a_expected_final_state.txt" | cut -c1-32)"
node "${REPO_ROOT}/scripts/recovery/generate-phase22a-dev-recovery.mjs"

# B. partial state = DEV ------------------------------------------------------
psql_as -q -c "create database ${PARTIAL};"
run_file "${PARTIAL}" "${REPO_ROOT}/supabase/tests/auth_schema_stub.sql"
history_table "${PARTIAL}"
for m in $(ls "${REPO_ROOT}"/supabase/migrations/*.sql | sort | head -39); do run_file "${PARTIAL}" "$m"; done
insert_history "${PARTIAL}" 1 39
node -e '
  const fs = require("fs");
  let s = fs.readFileSync(process.argv[1], "utf8");
  const a = s.indexOf("create or replace function website_discard_unpublished_document");
  const b = s.indexOf("-- ---------------------------------------------------------------------------\n-- 12. Media asset functions");
  s = s.slice(0, a) + s.slice(b);
  s = s.replace("    '"'"'website_discard_unpublished_document(uuid, integer)'"'"',\n", "");
  fs.writeFileSync(process.argv[2], s);
' "${REPO_ROOT}/supabase/migrations/20260101000040_website_content_foundation.sql" "${WORK}/m40_partial.sql"
run_file "${PARTIAL}" "${WORK}/m40_partial.sql"
EXPECTED_PARTIAL="$(node -e 'const m=require("fs").readFileSync(process.argv[1],"utf8"); const a=m.indexOf("partialFingerprint: ["); const b=m.indexOf("],",a); console.log(eval(m.slice(a+20,b+1)).join("\n"))' "${REPO_ROOT}/scripts/recovery/generate-phase22a-dev-recovery.mjs")"
if [[ "$(partial_state "${PARTIAL}")" != "${EXPECTED_PARTIAL}" ]]; then
  echo "FAIL: local partial state does not reproduce the DEV-observed fingerprint"; exit 1
fi
echo "B. partial state reproduces the DEV-observed migration-40 fingerprint"
psql_as -q -c "create database ${SCRATCH} template ${PARTIAL};"

# Rehearsal copy: substitute ONLY the cluster identity and database name.
LOCAL_SYSID="$(psql_as -At -d "${PARTIAL}" -c 'select system_identifier from pg_control_system()')"
sed -e "s/'7678069749886157684'/'${LOCAL_SYSID}'/" \
    -e "s/if current_database() <> 'postgres' or/if current_database() <> '${PARTIAL}' or/" \
    "${REPO_ROOT}/docs/recovery/phase22a_dev_recovery.sql" > "${WORK}/rehearsal.sql"
CHANGED="$(diff "${REPO_ROOT}/docs/recovery/phase22a_dev_recovery.sql" "${WORK}/rehearsal.sql" | grep -c '^>' || true)"
if [[ "${CHANGED}" != "2" ]]; then echo "FAIL: rehearsal copy differs in ${CHANGED} lines, expected exactly 2"; exit 1; fi
echo "rehearsal copy differs from the proposed script only in the cluster identifier and database name (2 lines)"
chmod 644 "${WORK}"/*.sql

# Refusals before running: wrong target.
if psql_as -v ON_ERROR_STOP=1 -q -d "${SCRATCH}" -f "${REPO_ROOT}/docs/recovery/phase22a_dev_recovery.sql" >"${WORK}/wrong.log" 2>&1; then
  echo "FAIL: the unmodified script ran against a non-DEV cluster"; exit 1
fi
grep -q 'wrong database cluster' "${WORK}/wrong.log" || { cat "${WORK}/wrong.log"; echo "FAIL: wrong target refused for an unexpected reason"; exit 1; }
echo "refused: wrong target cluster"

# The script requires PostgreSQL 17 (DEV). On another major version, prove the
# version precondition refuses and stop: a full rehearsal needs PostgreSQL 17.
if [[ "$(psql_as -At -c 'show server_version_num' | cut -c1-2)" != "17" ]]; then
  if psql_as -v ON_ERROR_STOP=1 -q -d "${PARTIAL}" -f "${WORK}/rehearsal.sql" >"${WORK}/version.log" 2>&1; then
    echo "FAIL: the recovery ran on a non-17 server"; exit 1
  fi
  grep -q 'unexpected database or PostgreSQL version' "${WORK}/version.log" || { cat "${WORK}/version.log"; exit 1; }
  echo "refused: PostgreSQL major version is not 17 (as required). Full rehearsal requires PostgreSQL 17 — rerun with PSQL_HOST/PSQL_PORT/PG_BIN of a 17 cluster."
  exit 0
fi

# The recovery itself.
psql_as -v ON_ERROR_STOP=1 -q -d "${PARTIAL}" -f "${WORK}/rehearsal.sql" >"${WORK}/recovery.log" 2>&1 || { cat "${WORK}/recovery.log"; echo "FAIL: recovery rehearsal failed"; exit 1; }
echo "recovery transaction committed on the partial replay"

# Compare A and B.
if [[ "$(final_state "${PARTIAL}")" != "$(cat "${REPO_ROOT}/docs/recovery/phase22a_expected_final_state.txt")" ]]; then
  echo "FAIL: final-state fingerprints differ"; exit 1
fi
echo "final-state fingerprint: recovery replay == clean replay"
cat > "${WORK}/catalog.sql" <<'SQL'
-- Full catalog listing (not hashed) of everything a migration could change.
select line from (
select 'fn ' || p.oid::regprocedure::text || E'\n' || pg_get_functiondef(p.oid) || E'\nowner=' || pg_get_userbyid(p.proowner)
       || ' acl=' || coalesce(p.proacl::text, 'default') || ' comment=' || coalesce(obj_description(p.oid, 'pg_proc'), '')
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
union all
select 'con ' || c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid)
  from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relnamespace = 'public'::regnamespace
union all
select 'idx ' || indexdef from pg_indexes where schemaname = 'public'
union all
select 'pol ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text || ' '
       || coalesce(qual, '') || ' | ' || coalesce(with_check, '') from pg_policies where schemaname in ('public', 'storage')
union all
select 'trg ' || tgrelid::regclass::text || ' ' || tgname || ' ' || tgenabled::text || ' ' || pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
union all
select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
  from information_schema.columns where table_schema in ('public', 'supabase_migrations')
union all
select 'rel ' || c.relname || ' kind=' || c.relkind::text || ' rls=' || c.relrowsecurity || ' owner=' || pg_get_userbyid(c.relowner)
       || ' acl=' || coalesce(c.relacl::text, 'default') || ' comment=' || coalesce(obj_description(c.oid, 'pg_class'), '')
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'S')
union all
select 'bucket ' || id || ' public=' || public from storage.buckets
union all
select 'history ' || version || ':' || name from supabase_migrations.schema_migrations
) x(line)
order by line collate "C";
SQL
chmod 644 "${WORK}/catalog.sql"
for db in "${CLEAN}" "${PARTIAL}"; do
  psql_as -v ON_ERROR_STOP=1 -At -d "${db}" -f "${WORK}/catalog.sql" > "${WORK}/${db}.catalog.txt"
done
if [[ ! -s "${WORK}/${CLEAN}.catalog.txt" ]]; then echo "FAIL: empty catalog listing"; exit 1; fi
if ! diff -u "${WORK}/${CLEAN}.catalog.txt" "${WORK}/${PARTIAL}.catalog.txt" > "${WORK}/catalog.diff"; then
  echo "FAIL: full catalog listings differ:"; head -60 "${WORK}/catalog.diff"; exit 1
fi
echo "full catalog listing (functions+ACLs, constraints, indexes, policies, triggers, columns, table ACLs, comments, buckets, history): identical ($(wc -l < "${WORK}/${CLEAN}.catalog.txt") lines)"
if [[ -x "${PG_BIN}/pg_dump" ]] && [[ "$("${PG_BIN}/pg_dump" --version | grep -o '[0-9]\+' | head -1)" == "$(psql_as -At -c 'show server_version_num' | cut -c1-2)" ]]; then
  for db in "${CLEAN}" "${PARTIAL}"; do
    sudo -u postgres env LD_LIBRARY_PATH="${LD_LIBRARY_PATH}" "${PG_BIN}/pg_dump" "${CONN[@]}" --schema-only \
      -n public -n storage -n auth -n supabase_migrations "${db}" \
      | grep -v '^-- Dumped\|^\\restrict\|^\\unrestrict' > "${WORK}/${db}.schema.sql"
  done
  if [[ ! -s "${WORK}/${CLEAN}.schema.sql" ]]; then echo "FAIL: empty pg_dump"; exit 1; fi
  if ! diff -u "${WORK}/${CLEAN}.schema.sql" "${WORK}/${PARTIAL}.schema.sql" > "${WORK}/schema.diff"; then
    echo "FAIL: pg_dump --schema-only differs:"; head -60 "${WORK}/schema.diff"; exit 1
  fi
  echo "pg_dump --schema-only (public, storage, auth, supabase_migrations): identical ($(wc -l < "${WORK}/${CLEAN}.schema.sql") lines)"
else
  echo "pg_dump for this server version not available locally: compared with the full catalog listing only"
fi
H_CLEAN="$(psql_as -At -d "${CLEAN}" -c "select string_agg(version||':'||name, ',' order by version) from supabase_migrations.schema_migrations")"
H_PART="$(psql_as -At -d "${PARTIAL}" -c "select string_agg(version||':'||name, ',' order by version) from supabase_migrations.schema_migrations")"
[[ "${H_CLEAN}" == "${H_PART}" ]] || { echo "FAIL: migration histories differ"; exit 1; }
echo "migration history: identical version:name lists (42 rows)"

# Repeated run must refuse and change nothing.
BEFORE="$(final_state "${PARTIAL}")"
if psql_as -v ON_ERROR_STOP=1 -q -d "${PARTIAL}" -f "${WORK}/rehearsal.sql" >"${WORK}/repeat.log" 2>&1; then
  echo "FAIL: a repeated recovery ran"; exit 1
fi
grep -q 'migration history differs' "${WORK}/repeat.log" || { cat "${WORK}/repeat.log"; echo "FAIL: repeat refused for an unexpected reason"; exit 1; }
[[ "$(final_state "${PARTIAL}")" == "${BEFORE}" ]] || { echo "FAIL: repeated run changed the schema"; exit 1; }
echo "refused: repeated execution (nothing changed)"

# Late execution of an earlier timed-out request (the discard function appearing) must refuse.
sed -i "s/if current_database() <> '${PARTIAL}' or/if current_database() <> '${SCRATCH}' or/" "${WORK}/rehearsal.sql"
node -e '
  const fs=require("fs"); const s=fs.readFileSync(process.argv[1],"utf8");
  const a=s.indexOf("create or replace function website_discard_unpublished_document");
  const b=s.indexOf("-- ---------------------------------------------------------------------------\n-- 12. Media asset functions");
  fs.writeFileSync(process.argv[2], s.slice(a,b));' "${REPO_ROOT}/supabase/migrations/20260101000040_website_content_foundation.sql" "${WORK}/late.sql"
chmod 644 "${WORK}/late.sql"
run_file "${SCRATCH}" "${WORK}/late.sql"
if psql_as -v ON_ERROR_STOP=1 -q -d "${SCRATCH}" -f "${WORK}/rehearsal.sql" >"${WORK}/late.log" 2>&1; then
  echo "FAIL: recovery ran after a simulated late execution"; exit 1
fi
grep -q 'Phase 22A recovery:' "${WORK}/late.log" || { cat "${WORK}/late.log"; echo "FAIL: late execution refused for an unexpected reason"; exit 1; }
echo "refused: simulated late execution of an earlier request ($(grep -o 'Phase 22A recovery: [^.]*' "${WORK}/late.log" | head -1))"

# Phase 22A suites on the recovered database.
for t in phase22a_website_foundation_test.sql phase22a_corrections_test.sql; do
  psql_as -v ON_ERROR_STOP=1 -d "${PARTIAL}" -f "${REPO_ROOT}/supabase/tests/${t}" >"${WORK}/${t}.log" 2>&1 || { tail -5 "${WORK}/${t}.log"; echo "FAIL: ${t} on the recovered database"; exit 1; }
  echo "${t} on the recovered database: $(grep -c 'NOTICE:  PASS' "${WORK}/${t}.log") PASS"
done

# Post-recovery verification script (same two substitutions), then prove it left nothing behind.
sed -e "s/'7678069749886157684'/'${LOCAL_SYSID}'/" \
    -e "s/if current_database() <> 'postgres' or/if current_database() <> '${PARTIAL}' or/" \
    "${REPO_ROOT}/docs/recovery/phase22a_dev_post_recovery_verification.sql" > "${WORK}/verify.sql"
CHANGED="$(diff "${REPO_ROOT}/docs/recovery/phase22a_dev_post_recovery_verification.sql" "${WORK}/verify.sql" | grep -c '^>' || true)"
[[ "${CHANGED}" == "2" ]] || { echo "FAIL: verification rehearsal copy differs in ${CHANGED} lines"; exit 1; }
chmod 644 "${WORK}/verify.sql"
CATALOG_BEFORE="$(psql_as -v ON_ERROR_STOP=1 -At -d "${PARTIAL}" -f "${WORK}/catalog.sql" | md5sum)"
ROWS_BEFORE="$(psql_as -At -d "${PARTIAL}" -c "select (select count(*) from programs)||','||(select count(*) from audit_logs)||','||(select count(*) from auth.users)||','||(select count(*) from website_documents)")"
psql_as -v ON_ERROR_STOP=1 -d "${PARTIAL}" -f "${WORK}/verify.sql" > "${WORK}/verify.log" 2>&1 || { tail -8 "${WORK}/verify.log"; echo "FAIL: post-recovery verification"; exit 1; }
[[ "$(psql_as -v ON_ERROR_STOP=1 -At -d "${PARTIAL}" -f "${WORK}/catalog.sql" | md5sum)" == "${CATALOG_BEFORE}" ]] || { echo "FAIL: verification changed the schema"; exit 1; }
[[ "$(psql_as -At -d "${PARTIAL}" -c "select (select count(*) from programs)||','||(select count(*) from audit_logs)||','||(select count(*) from auth.users)||','||(select count(*) from website_documents)")" == "${ROWS_BEFORE}" ]] || { echo "FAIL: verification left rows behind"; exit 1; }
echo "post-recovery verification script: $(grep -c 'NOTICE:  PASS' "${WORK}/verify.log") PASS, rolled back with no rows, schema or sequence change"

echo
echo "PASS: recovery rehearsal — the partial DEV state + recovery script equals a clean install of migrations 1-42; repeat, wrong-target and late-execution runs refuse."
