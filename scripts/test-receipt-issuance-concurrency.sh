#!/usr/bin/env bash
# Real DB-level concurrency proof for receipt issuance
# (supabase/migrations/20260101000037_receipts_issuance.sql, FR-95).
# Same harness as scripts/test-enrollment-batch-uniqueness-concurrency.sh:
# genuinely separate psql connections, each driven over its own FIFO.
#
# Three sessions call issue_receipt() for the SAME paid payment, each
# inside its own open transaction that sleeps 1s (in Postgres) right
# before the call and holds its transaction open 1s after it, so all three
# are in flight at the same wall-clock moment and the later callers must
# queue on the payment row lock. Expected, and asserted, outcome — whatever
# the interleaving:
#   - all three sessions succeed (nobody gets an error);
#   - exactly one receipt row and one receipt.issued audit row exist;
#   - every session got back the SAME receipt number;
#   - exactly one session reports already_issued = false;
#   - receipt_number_seq advanced by exactly one (no number was burnt by
#     the losing callers).
set -euo pipefail

DB_NAME="receipt_issuance_concurrency_test_$$"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
PAYMENT_ID="e8000000-0000-0000-0000-000000000001"

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

# Committed fixtures (scratch DB, dropped on exit): one student, one active
# enrollment (with its batch), one paid offline payment.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" >/dev/null <<SQL
insert into students (id, student_code, first_name, last_name, phone) values
  ('e4000000-0000-0000-0000-000000000001', 'CONC-RCPT-STU', 'Concurrency', 'Receipt', '9990009101');
insert into programs (id, program_code, name, regular_fee, status) values
  ('e5000000-0000-0000-0000-000000000001', 'CONC-RCPT-PROG', 'Concurrency Receipt Program', 1000.00, 'active');
insert into batches (id, program_id, name, start_date, status) values
  ('e6000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'Concurrency Receipt Batch', current_date, 'active');
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('e7000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001', 1000.00, 1000.00, 1000.00, 'active');
insert into payments (id, student_id, enrollment_id, payment_type, amount, tax_amount, total_amount, method, status, paid_at) values
  ('${PAYMENT_ID}', 'e4000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'partial', 400.00, 0, 400.00, 'cash', 'paid', now());
SQL

SEQ_BEFORE="$(sudo -u postgres psql -tA -d "${DB_NAME}" -c \
  "select case when is_called then last_value else last_value - 1 end from receipt_number_seq;")"

PIDS=()
for s in a b c; do
  mkfifo "${WORKDIR}/fifo_${s}"
done
exec 3<>"${WORKDIR}/fifo_a"
exec 4<>"${WORKDIR}/fifo_b"
exec 5<>"${WORKDIR}/fifo_c"

sudo -u postgres psql -v ON_ERROR_STOP=1 -tA -d "${DB_NAME}" <&3 > "${WORKDIR}/session-a.log" 2>&1 &
PIDS+=($!)
sudo -u postgres psql -v ON_ERROR_STOP=1 -tA -d "${DB_NAME}" <&4 > "${WORKDIR}/session-b.log" 2>&1 &
PIDS+=($!)
sudo -u postgres psql -v ON_ERROR_STOP=1 -tA -d "${DB_NAME}" <&5 > "${WORKDIR}/session-c.log" 2>&1 &
PIDS+=($!)

send_script() {
  local fd="$1"
  cat >&"${fd}" <<SQL
set role service_role;
begin;
select pg_sleep(1);
select 'RESULT|' || receipt_number || '|' || already_issued from issue_receipt('${PAYMENT_ID}');
select pg_sleep(1);
commit;
\q
SQL
}

send_script 3
send_script 4
send_script 5
exec 3>&- 4>&- 5>&-

FAILED=0
for pid in "${PIDS[@]}"; do
  if ! wait "${pid}"; then FAILED=1; fi
done

for s in a b c; do
  echo "--- Session ${s} ---"
  cat "${WORKDIR}/session-${s}.log"
done

if [[ "${FAILED}" != "0" ]]; then
  echo "FAIL: a concurrent issue_receipt() call errored — issuance must be idempotent, not a race"
  exit 1
fi

NUMBERS="$(grep -h '^RESULT|' "${WORKDIR}"/session-*.log | cut -d'|' -f2 | sort -u)"
FRESH="$(grep -h '^RESULT|' "${WORKDIR}"/session-*.log | cut -d'|' -f3 | grep -c '^false$' || true)"
RESULTS="$(grep -h -c '^RESULT|' "${WORKDIR}"/session-*.log | paste -sd+ | bc)"

if [[ "${RESULTS}" != "3" ]]; then
  echo "FAIL: expected 3 results, got ${RESULTS}"
  exit 1
fi
if [[ "$(echo "${NUMBERS}" | wc -l)" != "1" ]]; then
  echo "FAIL: concurrent callers received different receipt numbers: ${NUMBERS}"
  exit 1
fi
if [[ "${FRESH}" != "1" ]]; then
  echo "FAIL: expected exactly one caller to issue (already_issued = false), got ${FRESH}"
  exit 1
fi

read -r RECEIPTS AUDITS SEQ_AFTER < <(sudo -u postgres psql -tA -F ' ' -d "${DB_NAME}" -c \
  "select (select count(*) from receipts where payment_id = '${PAYMENT_ID}'),
          (select count(*) from audit_logs where action = 'receipt.issued'),
          (select case when is_called then last_value else last_value - 1 end from receipt_number_seq);")

if [[ "${RECEIPTS}" != "1" ]]; then
  echo "FAIL: expected exactly 1 receipt, found ${RECEIPTS}"
  exit 1
fi
if [[ "${AUDITS}" != "1" ]]; then
  echo "FAIL: expected exactly 1 receipt.issued audit row, found ${AUDITS}"
  exit 1
fi
if [[ "$((SEQ_AFTER - SEQ_BEFORE))" != "1" ]]; then
  echo "FAIL: receipt_number_seq advanced by $((SEQ_AFTER - SEQ_BEFORE)), expected 1"
  exit 1
fi

echo
echo "PASS: three concurrent issue_receipt() calls for one paid payment — all in flight at once — produced exactly one receipt (${NUMBERS}), one audit row and one consumed sequence value; every caller received the same receipt number and only one reported a fresh issuance."
