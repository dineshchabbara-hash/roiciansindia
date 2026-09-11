#!/usr/bin/env bash
# Regression suite for RLS/trainer-isolation guarantees, against a real
# local Postgres 16 instance (not the stubbed unit-test layer). Applies
# every file in supabase/migrations/ to a scratch database, then runs
# supabase/tests/rls_trainer_isolation_test.sql, which proves trainer/
# student/admin isolation and cleans up after itself via ROLLBACK.
set -euo pipefail

DB_NAME="rls_regression_test_$$"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! pg_lsclusters --no-header | awk '{print $4}' | grep -q '^online$'; then
  echo "Starting local Postgres 16 cluster..."
  sudo pg_ctlcluster 16 main start
fi

cleanup() {
  sudo -u postgres psql -q -c "drop database if exists ${DB_NAME};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

sudo -u postgres psql -q -c "create database ${DB_NAME};"

run_sql() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$1"
}

run_sql "${REPO_ROOT}/supabase/tests/auth_schema_stub.sql"

for migration in "${REPO_ROOT}"/supabase/migrations/*.sql; do
  echo "Applying $(basename "${migration}")..."
  run_sql "${migration}"
done

echo "Running RLS regression assertions..."
run_sql "${REPO_ROOT}/supabase/tests/rls_trainer_isolation_test.sql"

echo "Running Phase 5 (Student Management) regression assertions..."
run_sql "${REPO_ROOT}/supabase/tests/phase5_student_management_test.sql"

echo "Running Phase 7 (Program Management) regression assertions..."
run_sql "${REPO_ROOT}/supabase/tests/phase7_program_management_test.sql"
