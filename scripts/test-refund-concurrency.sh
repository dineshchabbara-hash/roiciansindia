#!/usr/bin/env bash
# Real DB-level concurrency proof for the refund cap
# (supabase/migrations/20260101000038_refund_workflow.sql). Same harness as
# scripts/test-receipt-issuance-concurrency.sh: genuinely separate psql
# connections, each driven over its own FIFO, both in flight at once.
#
# Scenario (Phase 21B checkpoint example): a ₹10,000.00 payment with a
# ₹2,000.00 refund already processed; two Admin sessions each try to refund
# ₹5,000.00 at the same moment — first two offline refunds, then two
# Razorpay reservations against a ₹10,000.00 Razorpay payment. Expected, and
# asserted, outcome in both rounds — whatever the interleaving:
#   - exactly one session succeeds; the other is refused with P2101
#     (refundable balance exceeded) — never a silent over-refund;
#   - processed + in-progress refunds end at exactly ₹7,000.00 (≤ 10,000).
set -euo pipefail

DB_NAME="refund_concurrency_test_$$"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
ADMIN_SUB="e1000000-0000-0000-0000-000000000001"

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

# Committed fixtures (scratch DB, dropped on exit).
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" >/dev/null <<SQL
insert into auth.users (id, email) values ('${ADMIN_SUB}', 'refund-concurrency-admin@validation.local');
insert into user_roles (auth_user_id, role) values ('${ADMIN_SUB}', 'admin');
insert into admins (id, auth_user_id, first_name, last_name, email, role_level) values
  ('e2000000-0000-0000-0000-000000000001', '${ADMIN_SUB}', 'Refund', 'Admin', 'refund-concurrency-admin@validation.local', 'admin');
insert into students (id, student_code, first_name, last_name, phone) values
  ('e4000000-0000-0000-0000-000000000002', 'CONC-RFND-STU', 'Concurrency', 'Refund', '9990009201');
insert into programs (id, program_code, name, regular_fee, status) values
  ('e5000000-0000-0000-0000-000000000002', 'CONC-RFND-PROG', 'Concurrency Refund Program', 20000.00, 'active');
insert into batches (id, program_id, name, start_date, status) values
  ('e6000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000002', 'Concurrency Refund Batch', current_date, 'active');
insert into enrollments (id, student_id, program_id, batch_id, regular_fee, agreed_fee, total_payable, status) values
  ('e7000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000002', 'e5000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000002', 20000.00, 20000.00, 20000.00, 'active');
insert into payments (id, student_id, enrollment_id, payment_type, amount, tax_amount, total_amount, method, status, paid_at) values
  ('e8000000-0000-0000-0000-00000000000a', 'e4000000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000002', 'partial', 10000.00, 0, 10000.00, 'cash', 'paid', now() - interval '1 day');
insert into payments (id, student_id, enrollment_id, payment_type, amount, tax_amount, total_amount, method, status, razorpay_order_id, razorpay_payment_id, paid_at) values
  ('e8000000-0000-0000-0000-00000000000b', 'e4000000-0000-0000-0000-000000000002', 'e7000000-0000-0000-0000-000000000002', 'partial', 10000.00, 0, 10000.00, 'razorpay', 'paid', 'order_CONC_B', 'pay_CONC_B', now() - interval '1 day');
insert into payment_refunds (payment_id, amount, reason, status, refunded_on, processed_at) values
  ('e8000000-0000-0000-0000-00000000000a', 2000.00, 'Earlier refund', 'processed', current_date, now()),
  ('e8000000-0000-0000-0000-00000000000b', 2000.00, 'Earlier refund', 'processed', current_date, now());
SQL

race() {
  local label="$1"
  local call_a="$2"
  local call_b="$3"
  local payment="$4"
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
set role authenticated;
set "request.jwt.claims" to '{"sub":"${ADMIN_SUB}","role":"authenticated"}';
begin;
select pg_sleep(1);
select ${call};
select pg_sleep(1);
commit;
\q
SQL
  done
  exec 3>&- 4>&-
  set +e
  wait "${pid_a}"; local exit_a=$?
  wait "${pid_b}"; local exit_b=$?
  set -e
  echo "--- ${label}: session A exit ${exit_a} / session B exit ${exit_b} ---"
  cat "${WORKDIR}/session-a.log" "${WORKDIR}/session-b.log"

  if [[ "${exit_a}" == "0" && "${exit_b}" == "0" ]]; then
    echo "FAIL (${label}): both concurrent ₹5,000 refunds succeeded"
    exit 1
  fi
  if [[ "${exit_a}" != "0" && "${exit_b}" != "0" ]]; then
    echo "FAIL (${label}): both refunds failed — exactly one must succeed"
    exit 1
  fi
  if ! grep -qh "refundable balance" "${WORKDIR}"/session-*.log; then
    echo "FAIL (${label}): the losing session was not refused by the refundable-balance check"
    exit 1
  fi
  local total
  total="$(sudo -u postgres psql -tA -d "${DB_NAME}" -c \
    "select sum(amount) from payment_refunds where payment_id = '${payment}' and status in ('initiated','processed');")"
  if [[ "${total}" != "7000.00" ]]; then
    echo "FAIL (${label}): committed refunds total ${total}, expected 7000.00"
    exit 1
  fi
  echo "PASS (${label}): one ₹5,000 refund succeeded, the other was refused; committed refunds = ₹${total} of ₹10,000.00"
}

race "offline refunds" \
  "record_offline_refund(gen_random_uuid(), 'e8000000-0000-0000-0000-00000000000a', 5000.00, 'Concurrent A', (now() at time zone 'Asia/Kolkata')::date, null)" \
  "record_offline_refund(gen_random_uuid(), 'e8000000-0000-0000-0000-00000000000a', 5000.00, 'Concurrent B', (now() at time zone 'Asia/Kolkata')::date, null)" \
  "e8000000-0000-0000-0000-00000000000a"

race "Razorpay reservations" \
  "reserve_razorpay_refund(gen_random_uuid(), 'e8000000-0000-0000-0000-00000000000b', 5000.00, 'Concurrent A')" \
  "reserve_razorpay_refund(gen_random_uuid(), 'e8000000-0000-0000-0000-00000000000b', 5000.00, 'Concurrent B')" \
  "e8000000-0000-0000-0000-00000000000b"

echo
echo "PASS: concurrent refunds can never over-refund a payment — in both the offline and the Razorpay path, two simultaneous ₹5,000 refunds against ₹8,000 of remaining capacity produce exactly one refund."
