#!/usr/bin/env bash
# Phase 22A corrections — mutation check for
# supabase/tests/phase22a_corrections_test.sql.
#
# For each correction in 20260101000042_phase22a_corrections.sql, a
# disposable copy of the fully migrated database has that ONE correction
# removed again, and the corrections suite must then FAIL with the expected
# message. A mutation that the suite does not detect fails this script.
# Nothing here touches any shared or remote database.
#
# Optional: PSQL_HOST / PSQL_PORT to target another local cluster (for
# example a PostgreSQL 17 instance).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_DB="p22a_mutation_base_$$"
CONN=()
[[ -n "${PSQL_HOST:-}" ]] && CONN+=(-h "${PSQL_HOST}")
[[ -n "${PSQL_PORT:-}" ]] && CONN+=(-p "${PSQL_PORT}")

if [[ -z "${PSQL_HOST:-}" ]] && ! pg_lsclusters --no-header | awk '{print $4}' | grep -q '^online$'; then
  echo "Starting local Postgres 16 cluster..."
  sudo pg_ctlcluster 16 main start
fi

psql_as() { sudo -u postgres psql "${CONN[@]}" "$@"; }
DBS=("${BASE_DB}")
cleanup() {
  for db in "${DBS[@]}"; do psql_as -q -c "drop database if exists ${db};" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

psql_as -q -c "create database ${BASE_DB};"
psql_as -v ON_ERROR_STOP=1 -q -d "${BASE_DB}" -f "${REPO_ROOT}/supabase/tests/auth_schema_stub.sql" >/dev/null
for migration in "${REPO_ROOT}"/supabase/migrations/*.sql; do
  psql_as -v ON_ERROR_STOP=1 -q -d "${BASE_DB}" -f "${migration}" >/dev/null
done

# Sanity: the unmutated schema passes.
if ! psql_as -v ON_ERROR_STOP=1 -q -d "${BASE_DB}" -f "${REPO_ROOT}/supabase/tests/phase22a_corrections_test.sql" >/dev/null 2>&1; then
  echo "FAIL: the corrections suite does not pass on the unmutated schema"
  exit 1
fi
echo "baseline: corrections suite passes"

mutate() {
  local name="$1" sql="$2" expected="$3"
  local db="p22a_mutation_${#DBS[@]}_$$"
  DBS+=("${db}")
  psql_as -q -c "create database ${db} template ${BASE_DB};" >/dev/null
  psql_as -v ON_ERROR_STOP=1 -q -d "${db}" -c "${sql}" >/dev/null
  local out
  if out="$(psql_as -v ON_ERROR_STOP=1 -d "${db}" -f "${REPO_ROOT}/supabase/tests/phase22a_corrections_test.sql" 2>&1)"; then
    echo "FAIL (${name}): the suite still passed with the correction removed"
    exit 1
  fi
  if ! grep -q -- "${expected}" <<<"${out}"; then
    echo "FAIL (${name}): the suite failed, but not with: ${expected}"
    grep -m3 'ERROR' <<<"${out}" || true
    exit 1
  fi
  echo "DETECTED (${name}): ${expected}"
}

mutate "guard trusts the marker alone" \
  "do \$m\$ begin execute replace(pg_get_functiondef('guard_program_delete()'::regprocedure), 'if current_user <>', 'if false and current_user <>'); end \$m\$;" \
  "FAIL: service_role deleted a Program with a forged marker"

mutate "no enrollment delete-evidence trigger" \
  "alter table enrollments disable trigger enrollments_record_program_history;" \
  "FAIL: no enrollment.row_deleted evidence"

mutate "no Batch delete-evidence trigger" \
  "alter table batches disable trigger batches_record_program_history;" \
  "FAIL: no batch.row_deleted evidence"

mutate "unattributable history ignored" \
  "do \$m\$ begin execute replace(pg_get_functiondef('program_unattributable_history(uuid)'::regprocedure), 'where u.created_at >= prog.since', 'where false'); end \$m\$;" \
  "FAIL: Program that existed during unresolved history not blocked"

mutate "creation time taken from the editable row only" \
  "do \$m\$ begin execute replace(pg_get_functiondef('program_unattributable_history(uuid)'::regprocedure), 'select least(', 'select greatest('); end \$m\$;" \
  "FAIL: earliest audit record not used as creation time"

mutate "Program creation time editable again" \
  "alter table programs disable trigger programs_guard_created_at;" \
  "FAIL: programs.created_at was changed"

mutate "service_role regains an internal helper" \
  "grant execute on function website_audit(text, text, uuid, jsonb, jsonb) to service_role;" \
  "FAIL: service_role can execute internal helper"

mutate "page kinds reverted" \
  "alter table website_documents drop constraint website_documents_kind; alter table website_documents add constraint website_documents_kind check (kind in ('home','about','corporate_training','institutions','contact','legal','navigation','footer','program'));" \
  "FAIL: new page kinds missing"

echo
echo "PASS: every Phase 22A correction is guarded — removing any one of them makes the corrections suite fail."
