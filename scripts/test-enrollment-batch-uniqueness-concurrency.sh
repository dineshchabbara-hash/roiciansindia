#!/usr/bin/env bash
# Real DB-level concurrency proof for the Student+Batch uniqueness fix
# (supabase/migrations/20260101000025_enrollment_batch_integrity_constraints.sql).
# Unlike scripts/test-rls.sh (one psql connection, strictly sequential
# statements), this launches two genuinely separate psql connections and
# forces them to overlap in-flight before either commits — the exact
# interleaving the application-layer pre-check in
# lib/data/enrollments.ts's createEnrollmentRecord cannot close on its own
# (both requests can read "no existing Enrollment" before either commits).
#
# Both sessions insert a new Enrollment for the SAME Student + SAME Batch,
# each sleeping 1s inside its own open transaction immediately before its
# INSERT, so both are provably in-flight at the same wall-clock moment.
# Expected, and asserted, outcome: exactly one INSERT succeeds; the other
# is cleanly rejected by the enrollments_one_per_student_batch partial
# unique index (never silently creating a duplicate row); the table ends
# with exactly one Enrollment for that Student+Batch.
set -euo pipefail

DB_NAME="enrollment_batch_uniqueness_concurrency_test_$$"
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

# Fixtures: one admin, one student, one program, one batch. Committed (this
# is a scratch DB dropped on exit, not rolled back) so both concurrent
# sessions below see the same starting state.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" >/dev/null <<'SQL'
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-000000000001', 'concurrency-admin@validation.local'),
  ('d1000000-0000-0000-0000-000000000002', 'concurrency-student@validation.local');

insert into user_roles (auth_user_id, role) values
  ('d1000000-0000-0000-0000-000000000001', 'admin'),
  ('d1000000-0000-0000-0000-000000000002', 'student');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('d2000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Concurrency', 'Admin', 'concurrency-admin@validation.local', 'admin');

insert into students (id, auth_user_id, student_code, first_name, last_name, phone) values
  ('d4000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'CONC-STU', 'Concurrency', 'Student', '9990009001');

insert into programs (id, program_code, name, regular_fee, status) values
  ('d5000000-0000-0000-0000-000000000001', 'CONC-ENR-PROG', 'Concurrency Enrollment Test Program', 20000.00, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('d6000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'Concurrency Enrollment Test Batch', current_date, 'active');
SQL

# Two independent, already-connected psql sessions driven over their own
# FIFO, so we control exactly when each statement is *sent* — decoupling
# the race from OS process-startup jitter, same rationale as
# scripts/test-batch-primary-concurrency.sh. Both sessions' BEGIN/
# pg_sleep(2)/INSERT/COMMIT are queued into their FIFO in one shot, a few
# milliseconds apart; each session only reaches its own INSERT once its own
# 2s sleep — started at essentially the same wall-clock moment as the
# other's — completes, guaranteeing they are both genuinely in-flight when
# they insert.
mkfifo "${WORKDIR}/fifo_a" "${WORKDIR}/fifo_b"
exec 3<>"${WORKDIR}/fifo_a"
exec 4<>"${WORKDIR}/fifo_b"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <&3 > "${WORKDIR}/session-a.log" 2>&1 &
PID_A=$!
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <&4 > "${WORKDIR}/session-b.log" 2>&1 &
PID_B=$!

send_script() {
  local fd="$1"
  local enrollment_id="$2"
  cat >&"${fd}" <<SQL
set role authenticated;
set "request.jwt.claims" to '{"sub":"d1000000-0000-0000-0000-000000000001","role":"authenticated"}';
begin;
select pg_sleep(2);
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable)
values ('${enrollment_id}', 'd4000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', 'd6000000-0000-0000-0000-000000000001', 20000.00, 20000.00, 20000.00);
commit;
\q
SQL
}

send_script 3 "d7000000-0000-0000-0000-00000000000a"
send_script 4 "d7000000-0000-0000-0000-00000000000b"

exec 3>&- 4>&-

set +e
wait "${PID_A}"; EXIT_A=$?
wait "${PID_B}"; EXIT_B=$?
set -e

echo "--- Session A (inserting Enrollment a) — exit ${EXIT_A} ---"
cat "${WORKDIR}/session-a.log"
echo "--- Session B (inserting Enrollment b) — exit ${EXIT_B} ---"
cat "${WORKDIR}/session-b.log"

# A plain INSERT vs INSERT race on the same unique key is structurally a
# true collision: at most one commits, the other always fails with
# unique_violation (unlike the Primary-Trainer RPC, there is no
# demote-then-insert step that could let both sides legitimately succeed).
# So both succeeding, or both failing, would both be real anomalies here.
if [[ "${EXIT_A}" == "0" && "${EXIT_B}" == "0" ]]; then
  echo "FAIL: both concurrent Enrollment inserts for the same Student+Batch succeeded — the unique index did not prevent the race"
  exit 1
fi
if [[ "${EXIT_A}" != "0" && "${EXIT_B}" != "0" ]]; then
  echo "FAIL: both concurrent Enrollment inserts failed — expected exactly one to succeed"
  exit 1
fi
if [[ "${EXIT_A}" != "0" ]]; then
  if ! grep -q "enrollments_one_per_student_batch" "${WORKDIR}/session-a.log"; then
    echo "FAIL: session A's error did not reference the partial unique index"
    exit 1
  fi
fi
if [[ "${EXIT_B}" != "0" ]]; then
  if ! grep -q "enrollments_one_per_student_batch" "${WORKDIR}/session-b.log"; then
    echo "FAIL: session B's error did not reference the partial unique index"
    exit 1
  fi
fi

FINAL_COUNT="$(sudo -u postgres psql -tA -d "${DB_NAME}" -c \
  "select count(*) from enrollments where student_id = 'd4000000-0000-0000-0000-000000000001' and batch_id = 'd6000000-0000-0000-0000-000000000001';")"

if [[ "${FINAL_COUNT}" != "1" ]]; then
  echo "FAIL: expected exactly 1 Enrollment for this Student+Batch after the race, found ${FINAL_COUNT}"
  exit 1
fi

echo
echo "PASS: two concurrent Enrollment-creation requests for the same Student+Batch — forced to genuinely overlap in-flight via pg_sleep — resulted in exactly one surviving Enrollment. The losing request was cleanly rejected by the enrollments_one_per_student_batch database constraint; no duplicate Student+Batch row was ever created, not even transiently."
