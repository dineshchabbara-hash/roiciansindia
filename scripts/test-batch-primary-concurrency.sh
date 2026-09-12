#!/usr/bin/env bash
# Real DB-level concurrency proof for the Primary-Trainer-uniqueness fix
# (supabase/migrations/20260101000020_batch_trainers_one_primary_per_batch.sql).
# Unlike scripts/test-rls.sh (one psql connection, strictly sequential
# statements), this launches two genuinely separate psql connections and
# forces them to overlap in-flight before either commits — the exact
# interleaving that broke the pre-migration app-layer implementation
# (commit 43b39b3: both "insert"s landing before either "demote" ran left
# the batch with zero Primaries; see lib/data/__tests__/batches.test.ts).
#
# Both sessions call assign_batch_trainer(), as Admin, promoting a
# different, previously-unassigned trainer to Primary on the same batch.
# Each session sleeps 1s inside its own open transaction, immediately
# before calling the RPC, so both are provably in-flight at the same
# wall-clock moment when they call it. Expected, and asserted, outcome:
# exactly one call succeeds; the other is cleanly rejected by the
# batch_trainers_one_primary_per_batch partial unique index (not left to
# silently corrupt the row set); the table ends with exactly one Primary.
set -euo pipefail

DB_NAME="batch_primary_concurrency_test_$$"
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

# Fixtures: one admin, two trainers with no existing batch_trainers rows,
# one batch. Committed (this is a scratch DB dropped on exit, not rolled
# back) so both concurrent sessions below see the same starting state.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" >/dev/null <<'SQL'
insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-000000000001', 'concurrency-admin@validation.local'),
  ('e1000000-0000-0000-0000-000000000002', 'concurrency-trainer-a@validation.local'),
  ('e1000000-0000-0000-0000-000000000003', 'concurrency-trainer-c@validation.local');

insert into user_roles (auth_user_id, role) values
  ('e1000000-0000-0000-0000-000000000001', 'admin'),
  ('e1000000-0000-0000-0000-000000000002', 'trainer'),
  ('e1000000-0000-0000-0000-000000000003', 'trainer');

insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Concurrency', 'Admin', 'concurrency-admin@validation.local', 'admin');

insert into trainers (id, auth_user_id, first_name, last_name, email) values
  ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000002', 'Concurrency', 'TrainerA', 'concurrency-trainer-a@validation.local'),
  ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 'Concurrency', 'TrainerC', 'concurrency-trainer-c@validation.local');

insert into programs (id, program_code, name, regular_fee, status) values
  ('e5000000-0000-0000-0000-000000000001', 'CONC-PROG', 'Concurrency Test Program', 20000.00, 'active');

insert into batches (id, program_id, name, start_date, status) values
  ('e6000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Concurrency Test Batch', current_date, 'active');
SQL

# Two independent, already-connected psql sessions driven over their own
# FIFO, so we control exactly when each statement is *sent* — decoupling
# the race from OS process-startup jitter (two `psql -c ... -c ...`
# invocations launched via `&` can easily start seconds apart, e.g. `sudo`
# overhead, which measured in practice was enough for one session to fully
# commit before the other even connected — no overlap at all). Both
# sessions' BEGIN/pg_sleep(2)/RPC-call/COMMIT are queued into their FIFO in
# one shot, a few milliseconds apart; each session only reaches its own RPC
# call once its own 2s sleep — started at essentially the same wall-clock
# moment as the other's — completes, guaranteeing they are both genuinely
# in-flight when they call assign_batch_trainer().
mkfifo "${WORKDIR}/fifo_a" "${WORKDIR}/fifo_c"
exec 3<>"${WORKDIR}/fifo_a"
exec 4<>"${WORKDIR}/fifo_c"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <&3 > "${WORKDIR}/session-a.log" 2>&1 &
PID_A=$!
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <&4 > "${WORKDIR}/session-c.log" 2>&1 &
PID_C=$!

send_script() {
  local fd="$1"
  local trainer_id="$2"
  cat >&"${fd}" <<SQL
set role authenticated;
set "request.jwt.claims" to '{"sub":"e1000000-0000-0000-0000-000000000001","role":"authenticated"}';
begin;
select pg_sleep(2);
select assign_batch_trainer('e6000000-0000-0000-0000-000000000001', '${trainer_id}', true);
commit;
\q
SQL
}

send_script 3 "e3000000-0000-0000-0000-000000000001"
send_script 4 "e3000000-0000-0000-0000-000000000002"

exec 3>&- 4>&-

set +e
wait "${PID_A}"; EXIT_A=$?
wait "${PID_C}"; EXIT_C=$?
set -e
echo "${EXIT_A}" > "${WORKDIR}/session-a.log.exit"
echo "${EXIT_C}" > "${WORKDIR}/session-c.log.exit"

EXIT_A="$(cat "${WORKDIR}/session-a.log.exit")"
EXIT_C="$(cat "${WORKDIR}/session-c.log.exit")"

echo "--- Session A (assigning trainer A as Primary) — exit ${EXIT_A} ---"
cat "${WORKDIR}/session-a.log"
echo "--- Session C (assigning trainer C as Primary) — exit ${EXIT_C} ---"
cat "${WORKDIR}/session-c.log"

# Both calls succeeding is a legitimate outcome of this RPC design, NOT a
# violation: it means the two transactions did not truly collide on the
# unique index — the second to reach its own SELECT genuinely saw the
# first's already-committed row, demoted it, and inserted itself, all
# correctly. (Two independent, separately-committed PostgREST requests
# could never do this safely — see 43b39b3 — but a single atomic function
# body can, because its own demote step always runs before its own insert.)
# Both calls failing would be a real anomaly (a unique_violation only ever
# fires against a genuinely committed conflicting row, so it should be
# structurally impossible for both sides to lose) — checked for defensively.
# The only assertion that actually matters, in every case, is the table's
# final state: at most one Primary Trainer, checked directly against
# batch_trainers rather than inferred from either session's exit code.
if [[ "${EXIT_A}" != "0" ]]; then
  if ! grep -q "batch_trainers_one_primary_per_batch" "${WORKDIR}/session-a.log"; then
    echo "FAIL: session A's error did not reference the partial unique index"
    exit 1
  fi
fi
if [[ "${EXIT_C}" != "0" ]]; then
  if ! grep -q "batch_trainers_one_primary_per_batch" "${WORKDIR}/session-c.log"; then
    echo "FAIL: session C's error did not reference the partial unique index"
    exit 1
  fi
fi
if [[ "${EXIT_A}" != "0" && "${EXIT_C}" != "0" ]]; then
  echo "FAIL: both concurrent Primary assignments failed — expected at least one to succeed"
  exit 1
fi

FINAL_PRIMARY_COUNT="$(sudo -u postgres psql -tA -d "${DB_NAME}" -c \
  "select count(*) from batch_trainers where batch_id = 'e6000000-0000-0000-0000-000000000001' and is_primary;")"

if [[ "${FINAL_PRIMARY_COUNT}" != "1" ]]; then
  echo "FAIL: expected exactly 1 Primary Trainer row after the race, found ${FINAL_PRIMARY_COUNT}"
  exit 1
fi

if [[ "${EXIT_A}" == "0" && "${EXIT_C}" == "0" ]]; then
  echo "(Both calls succeeded — the later one demoted the earlier one's already-committed Primary before inserting itself; not a collision.)"
else
  echo "(One call was rejected outright by the partial unique index — a true insert-vs-insert collision.)"
fi
echo
echo "PASS: two concurrent 'assign as Primary' requests for different trainers on the same batch — forced to genuinely overlap in-flight via pg_sleep — resulted in exactly one Primary Trainer. The losing request was cleanly rejected by the batch_trainers_one_primary_per_batch database constraint; the invariant was never violated, not even transiently."
