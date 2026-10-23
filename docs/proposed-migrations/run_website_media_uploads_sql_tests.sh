#!/usr/bin/env bash
# PROPOSAL TEST RUNNER: not wired into scripts/test-rls.sh or CI.
#
# Runs the Phase 22B-3 media upload proposal against a THROWAWAY local
# Postgres 16 database (same harness as scripts/test-rls.sh), never a hosted
# project:
#   1. auth/storage stub, plus the harness-only storage columns
#      (website_media_uploads_harness_stub.sql; real Supabase has them);
#   2. every active migration (1-42), then the proposal, which is NOT copied
#      into supabase/migrations;
#   3. every regression suite that scripts/test-rls.sh runs, in the same
#      order, with the Phase 22A suite patched by
#      website_media_uploads_22a_test.patch (W1 and W6 only);
#   4. the proposal's own suite, website_media_uploads_test.sql (M1-M9).
# The database is dropped at the end, whatever the outcome.
set -euo pipefail

DB_NAME="media_proposal_test_$$"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="${REPO_ROOT}/docs/proposed-migrations"
WORK="$(mktemp -d)"

if ! pg_lsclusters --no-header | awk '{print $4}' | grep -q '^online$'; then
  echo "Starting local Postgres 16 cluster..."
  sudo pg_ctlcluster 16 main start
fi

cleanup() {
  sudo -u postgres psql -q -c "drop database if exists ${DB_NAME};" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

sudo -u postgres psql -q -c "create database ${DB_NAME};"
run_sql() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$1"
}

run_sql "${REPO_ROOT}/supabase/tests/auth_schema_stub.sql"
run_sql "${HERE}/website_media_uploads_harness_stub.sql"
for migration in "${REPO_ROOT}"/supabase/migrations/*.sql; do
  echo "Applying $(basename "${migration}")..."
  run_sql "${migration}"
done
echo "Applying PROPOSAL website_media_uploads.sql (runner database only)..."
run_sql "${HERE}/website_media_uploads.sql"

# The 22A suite as it would read after adoption.
cp "${REPO_ROOT}/supabase/tests/phase22a_website_foundation_test.sql" "${WORK}/phase22a.sql"
patch --quiet "${WORK}/phase22a.sql" "${HERE}/website_media_uploads_22a_test.patch"
chmod 755 "${WORK}"
chmod 644 "${WORK}/phase22a.sql"

mapfile -t suites < <(grep -o 'supabase/tests/[a-z0-9_]*_test\.sql' "${REPO_ROOT}/scripts/test-rls.sh")
for suite in "${suites[@]}"; do
  if [[ "${suite}" == "supabase/tests/phase22a_website_foundation_test.sql" ]]; then
    echo "Running ${suite} (patched for the proposal)..."
    run_sql "${WORK}/phase22a.sql"
  else
    echo "Running ${suite}..."
    run_sql "${REPO_ROOT}/${suite}"
  fi
done

echo "Running the proposal suite website_media_uploads_test.sql..."
run_sql "${HERE}/website_media_uploads_test.sql"
echo "ALL SUITES PASSED (with the proposal applied to a throwaway database)."
