#!/usr/bin/env bash
# Real DB-level concurrency proof for Student portal provisioning
# (supabase/migrations/20260101000039_admin_identity_settings.sql,
# link_student_portal_account). Same harness as
# scripts/test-refund-concurrency.sh: genuinely separate psql connections,
# each driven over its own FIFO, both in flight at once (service role, as
# the server calls it).
#
# Round 1 — the same student, two different logins at the same moment
#   (two Admins clicking "Give portal access" with a race in between):
#   exactly one login is linked; the other call reports
#   student_has_other_account; the student ends with one login and only
#   that login has a role.
# Round 2 — one login, two different students at the same moment:
#   exactly one student is linked (the other call reports account_in_use,
#   serialized by a per-login lock — no constraint error); the login holds
#   one student role.
# Round 3 — the same student and login twice (a double submit):
#   one call reports linked, the other already_linked; one role row.
set -euo pipefail

DB_NAME="portal_provisioning_concurrency_test_$$"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"

if ! pg_lsclusters --no-header | awk '{print $4}' | grep -q '^online$'; then
  echo "Starting local Postgres 16 cluster..."
  sudo pg_ctlcluster 16 main start
fi

cleanup() {
  sudo -u postgres psql -q -c "drop database if exists ${DB_NAME};" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

sudo -u postgres psql -q -c "create database ${DB_NAME};"

run_sql() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$1" >/dev/null
}

run_sql "${REPO_ROOT}/supabase/tests/auth_schema_stub.sql"
for migration in "${REPO_ROOT}"/supabase/migrations/*.sql; do
  run_sql "${migration}"
done

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" >/dev/null <<'SQL'
insert into auth.users (id, email) values
  ('c1000000-0000-0000-0000-000000000001', 'conc-login-1@validation.local'),
  ('c1000000-0000-0000-0000-000000000002', 'conc-login-2@validation.local'),
  ('c1000000-0000-0000-0000-000000000003', 'conc-login-3@validation.local'),
  ('c1000000-0000-0000-0000-000000000004', 'conc-login-4@validation.local');
insert into students (id, student_code, first_name, last_name, phone, status) values
  ('c2000000-0000-0000-0000-000000000001', 'CONC-PORTAL-1', 'Concurrency', 'One', '9990009301', 'active'),
  ('c2000000-0000-0000-0000-000000000002', 'CONC-PORTAL-2', 'Concurrency', 'Two', '9990009302', 'active'),
  ('c2000000-0000-0000-0000-000000000003', 'CONC-PORTAL-3', 'Concurrency', 'Three', '9990009303', 'active'),
  ('c2000000-0000-0000-0000-000000000004', 'CONC-PORTAL-4', 'Concurrency', 'Four', '9990009304', 'active');
SQL

race() {
  local label="$1"
  local call_a="$2"
  local call_b="$3"
  rm -f "${WORKDIR}"/fifo_* "${WORKDIR}"/session-*.log
  mkfifo "${WORKDIR}/fifo_a" "${WORKDIR}/fifo_b"
  exec 3<>"${WORKDIR}/fifo_a"
  exec 4<>"${WORKDIR}/fifo_b"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -tA -d "${DB_NAME}" <&3 > "${WORKDIR}/session-a.log" 2>&1 &
  local pid_a=$!
  sudo -u postgres psql -v ON_ERROR_STOP=1 -tA -d "${DB_NAME}" <&4 > "${WORKDIR}/session-b.log" 2>&1 &
  local pid_b=$!
  for pair in "3|${call_a}" "4|${call_b}"; do
    local fd="${pair%%|*}"
    local call="${pair#*|}"
    cat >&"${fd}" <<SQL
set role service_role;
set "request.jwt.claims" to '{"role":"service_role"}';
begin;
select pg_sleep(1);
select 'OUTCOME=' || ${call};
select pg_sleep(1);
commit;
\q
SQL
  done
  exec 3>&- 4>&-
  set +e
  wait "${pid_a}"; EXIT_A=$?
  wait "${pid_b}"; EXIT_B=$?
  set -e
  echo "--- ${label}: session A exit ${EXIT_A} / session B exit ${EXIT_B} ---"
  cat "${WORKDIR}/session-a.log" "${WORKDIR}/session-b.log" | grep -v '^$' || true
  OUTCOMES="$(cat "${WORKDIR}"/session-*.log | grep -o 'OUTCOME=[a-z_]*' | sort | tr '\n' ' ')"
}

q() { sudo -u postgres psql -tA -d "${DB_NAME}" -c "$1"; }

# Round 1: one student, two logins.
race "same student, two logins" \
  "link_student_portal_account('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001')" \
  "link_student_portal_account('c2000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002')"
if [[ "${OUTCOMES}" != "OUTCOME=linked OUTCOME=student_has_other_account " ]]; then
  echo "FAIL (round 1): outcomes were '${OUTCOMES}'"
  exit 1
fi
if [[ "$(q "select count(*) from user_roles where auth_user_id in ('c1000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000002')")" != "1" ]]; then
  echo "FAIL (round 1): both logins received a role"
  exit 1
fi

# Round 2: one login, two students.
race "one login, two students" \
  "link_student_portal_account('c2000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000003')" \
  "link_student_portal_account('c2000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003')"
linked_students="$(q "select count(*) from students where auth_user_id = 'c1000000-0000-0000-0000-000000000003'")"
roles="$(q "select count(*) from user_roles where auth_user_id = 'c1000000-0000-0000-0000-000000000003'")"
if [[ "${linked_students}" != "1" || "${roles}" != "1" ]]; then
  echo "FAIL (round 2): ${linked_students} students linked, ${roles} role rows for one login"
  exit 1
fi
if [[ "${EXIT_A}" != "0" || "${EXIT_B}" != "0" || "${OUTCOMES}" != "OUTCOME=account_in_use OUTCOME=linked " ]]; then
  echo "FAIL (round 2): expected one linked and one account_in_use (no errors), got '${OUTCOMES}'"
  exit 1
fi

# Round 3: the same pair twice (double submit).
race "double submit" \
  "link_student_portal_account('c2000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004')" \
  "link_student_portal_account('c2000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004')"
if [[ "${OUTCOMES}" != "OUTCOME=already_linked OUTCOME=linked " ]]; then
  echo "FAIL (round 3): outcomes were '${OUTCOMES}'"
  exit 1
fi
if [[ "$(q "select count(*) from user_roles where auth_user_id = 'c1000000-0000-0000-0000-000000000004'")" != "1" ]]; then
  echo "FAIL (round 3): the double submit duplicated the role"
  exit 1
fi

echo
echo "PASS: concurrent portal provisioning never links a student twice, never links one login to two students, and a double submit creates one link and one role."
