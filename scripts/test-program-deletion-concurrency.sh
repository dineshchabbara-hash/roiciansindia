#!/usr/bin/env bash
# Phase 22A concurrency proof for
#   20260101000041_program_deletion_safeguards.sql (controlled Program deletion)
#   20260101000040_website_content_foundation.sql (lost-update prevention)
# against a real local Postgres 16, with genuinely separate psql connections
# driven step by step over FIFOs.
#
# Unlike a timing-based race, every scenario forces one exact interleaving:
# session 1 does its first step inside an open transaction; session 2's call
# is then sent and the script waits until pg_stat_activity shows session 2
# BLOCKED ON A LOCK (proof it reached the critical section); only then does
# session 1 commit. The waits below poll an observable condition (a marker in
# a session's output, or a lock wait in pg_stat_activity) with a bounded
# number of attempts; they never sleep a fixed time to make a race "pass".
#
# Scenarios (all must hold):
#   1. module insert in flight, then deletion       -> deletion refused (dependency:program_modules);
#      program_modules is ON DELETE CASCADE, so without the lock this module
#      would be silently deleted with the Program
#   2. deletion in flight, then module insert       -> insert fails (FK), Program gone, no orphan
#   3. restore (status change) in flight, then deletion -> deletion refused (not_archived)
#   4. deletion in flight, then restore             -> restore updates 0 rows; Program gone
#   5. website document creation in flight, then deletion -> refused (dependency:website_documents)
#   6. two editors save from the same base revision -> second refused (P2203), one new revision
#   7. new draft saved while an older revision is being published -> publish refused (P2203)
set -euo pipefail

DB_NAME="program_deletion_concurrency_test_$$"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
SUPER_SUB="22ac0000-0000-0000-0000-000000000001"
ADMIN_SUB="22ac0000-0000-0000-0000-000000000002"

if ! pg_lsclusters --no-header | awk '{print $4}' | grep -q '^online$'; then
  echo "Starting local Postgres 16 cluster..."
  sudo pg_ctlcluster 16 main start
fi

cleanup() {
  exec 5>&- 6>&- 2>/dev/null || true
  sudo -u postgres psql -q -c "drop database if exists ${DB_NAME} with (force);" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

sudo -u postgres psql -q -c "create database ${DB_NAME};"
run_sql() { sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" -f "$1" >/dev/null; }
q() { sudo -u postgres psql -tA -d "${DB_NAME}" -c "$1"; }

run_sql "${REPO_ROOT}/supabase/tests/auth_schema_stub.sql"
for migration in "${REPO_ROOT}"/supabase/migrations/*.sql; do
  run_sql "${migration}"
done

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" >/dev/null <<SQL
insert into auth.users (id, email) values
  ('${SUPER_SUB}', 'p22a-conc-super@validation.local'),
  ('${ADMIN_SUB}', 'p22a-conc-admin@validation.local');
insert into user_roles (auth_user_id, role) values ('${SUPER_SUB}', 'super_admin'), ('${ADMIN_SUB}', 'admin');
insert into programs (id, program_code, name, regular_fee, status) values
  ('22ac4000-0000-0000-0000-000000000001', 'CONC-DEL-1', 'Concurrency Delete 1', 1000, 'archived'),
  ('22ac4000-0000-0000-0000-000000000002', 'CONC-DEL-2', 'Concurrency Delete 2', 1000, 'archived'),
  ('22ac4000-0000-0000-0000-000000000003', 'CONC-DEL-3', 'Concurrency Delete 3', 1000, 'archived'),
  ('22ac4000-0000-0000-0000-000000000004', 'CONC-DEL-4', 'Concurrency Delete 4', 1000, 'archived'),
  ('22ac4000-0000-0000-0000-000000000005', 'CONC-DEL-5', 'Concurrency Delete 5', 1000, 'archived'),
  ('22ac4000-0000-0000-0000-000000000006', 'CONC-WEB-6', 'Concurrency Website 6', 1000, 'active');
SQL

# Website document with one published revision, created through the API as Admin.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" >/dev/null <<SQL
set role authenticated;
set "request.jwt.claims" to '{"sub":"${ADMIN_SUB}","role":"authenticated"}';
select website_create_program_document('22ac4000-0000-0000-0000-000000000006', 'conc-web-six');
select website_save_draft((select id from website_documents where slug = 'conc-web-six'), 0, 'Rev 1',
  null, null, null, null, null, null, null, '[]');
SQL
DOC_ID="$(q "select id from website_documents where slug = 'conc-web-six';")"

wait_until() {
  # wait_until <description> <command...>: polls an observable condition.
  local desc="$1"; shift
  local i
  for i in $(seq 1 300); do
    if "$@"; then return 0; fi
    sleep 0.1
  done
  echo "FAIL: timed out waiting for ${desc}"
  cat "${WORKDIR}"/s*.log 2>/dev/null || true
  exit 1
}
has_marker() { grep -q "$2" "${WORKDIR}/$1.log"; }
lock_waiting() {
  [[ "$(q "select count(*) from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock';")" == "1" ]]
}

open_sessions() {
  rm -f "${WORKDIR}"/fifo_* "${WORKDIR}"/s1.log "${WORKDIR}"/s2.log
  mkfifo "${WORKDIR}/fifo_1" "${WORKDIR}/fifo_2"
  exec 5<>"${WORKDIR}/fifo_1"
  exec 6<>"${WORKDIR}/fifo_2"
  sudo -u postgres psql -X -tA -d "${DB_NAME}" <&5 > "${WORKDIR}/s1.log" 2>&1 &
  PID1=$!
  sudo -u postgres psql -X -tA -d "${DB_NAME}" <&6 > "${WORKDIR}/s2.log" 2>&1 &
  PID2=$!
  printf '%s\n' "\\set VERBOSITY verbose" "set application_name = 'p22a_s1';" >&5
  printf '%s\n' "\\set VERBOSITY verbose" "set application_name = 'p22a_s2';" >&6
}
as_user() { printf '%s\n' "set role authenticated;" "set \"request.jwt.claims\" to '{\"sub\":\"$2\",\"role\":\"authenticated\"}';" >&"$1"; }
close_sessions() {
  printf '%s\n' '\q' >&5
  printf '%s\n' '\q' >&6
  exec 5>&- 6>&-
  wait "${PID1}" || true
  wait "${PID2}" || true
}

# scenario <name> <s1 user> <s1 first statement> <s2 user> <s2 statement>
# Session 1 runs its statement in an open transaction; session 2's statement
# must block on a lock; then session 1 commits and session 2 finishes.
scenario() {
  local name="$1" u1="$2" stmt1="$3" u2="$4" stmt2="$5"
  open_sessions
  as_user 5 "${u1}"
  as_user 6 "${u2}"
  printf '%s\n' "begin;" "${stmt1}" '\echo S1_STEP_DONE' >&5
  wait_until "session 1 first step (${name})" has_marker s1 'S1_STEP_DONE'
  if grep -q 'ERROR' "${WORKDIR}/s1.log"; then
    echo "FAIL (${name}): session 1 first step failed"; cat "${WORKDIR}/s1.log"; exit 1
  fi
  printf '%s\n' "begin;" "${stmt2}" '\echo S2_STEP_DONE' >&6
  wait_until "session 2 to block on a lock (${name})" lock_waiting p22a_s2
  printf '%s\n' "commit;" '\echo S1_COMMITTED' >&5
  wait_until "session 1 commit (${name})" has_marker s1 'S1_COMMITTED'
  wait_until "session 2 to finish (${name})" has_marker s2 'S2_STEP_DONE'
  printf '%s\n' "commit;" >&6
  close_sessions
  echo "--- ${name} ---"
  sed 's/^/  s1| /' "${WORKDIR}/s1.log" | grep -v '^  s1| SET$' || true
  sed 's/^/  s2| /' "${WORKDIR}/s2.log" | grep -v '^  s2| SET$' || true
}
expect_s2() {
  if ! grep -q "$2" "${WORKDIR}/s2.log"; then
    echo "FAIL ($1): session 2 output lacks '$2'"; exit 1
  fi
}

# 1 ---------------------------------------------------------------------------
scenario "1 module insert, then deletion" \
  "${ADMIN_SUB}" "insert into program_modules (id, program_id, title, sequence) values ('22ac5000-0000-0000-0000-000000000001', '22ac4000-0000-0000-0000-000000000001', 'Late Module', 1);" \
  "${SUPER_SUB}" "select delete_archived_program('22ac4000-0000-0000-0000-000000000001', 'CONC-DEL-1', 'Concurrent test');"
expect_s2 1 'P2201'
expect_s2 1 'dependency:program_modules'
[[ "$(q "select count(*) from programs where id = '22ac4000-0000-0000-0000-000000000001';")" == "1" ]] || { echo "FAIL (1): Program deleted"; exit 1; }
[[ "$(q "select count(*) from program_modules where id = '22ac5000-0000-0000-0000-000000000001';")" == "1" ]] || { echo "FAIL (1): module silently deleted"; exit 1; }
echo "PASS 1: deletion waited for the in-flight module insert, then saw it and refused (no silent cascade)"

# 2 ---------------------------------------------------------------------------
scenario "2 deletion, then module insert" \
  "${SUPER_SUB}" "select delete_archived_program('22ac4000-0000-0000-0000-000000000002', 'CONC-DEL-2', 'Concurrent test');" \
  "${ADMIN_SUB}" "insert into program_modules (id, program_id, title, sequence) values ('22ac5000-0000-0000-0000-000000000002', '22ac4000-0000-0000-0000-000000000002', 'Late Module 2', 1);"
expect_s2 2 '23503'
[[ "$(q "select count(*) from programs where id = '22ac4000-0000-0000-0000-000000000002';")" == "0" ]] || { echo "FAIL (2): Program not deleted"; exit 1; }
[[ "$(q "select count(*) from program_modules where program_id = '22ac4000-0000-0000-0000-000000000002';")" == "0" ]] || { echo "FAIL (2): orphan module"; exit 1; }
[[ "$(q "select count(*) from audit_logs where action = 'program.deleted' and entity_id = '22ac4000-0000-0000-0000-000000000002';")" == "1" ]] || { echo "FAIL (2): no deletion audit"; exit 1; }
echo "PASS 2: the module insert waited for the deletion, then failed its foreign key; no orphan; one audit record"

# 3 ---------------------------------------------------------------------------
scenario "3 restore, then deletion" \
  "${ADMIN_SUB}" "update programs set status = 'active' where id = '22ac4000-0000-0000-0000-000000000003';" \
  "${SUPER_SUB}" "select delete_archived_program('22ac4000-0000-0000-0000-000000000003', 'CONC-DEL-3', 'Concurrent test');"
expect_s2 3 'P2201'
expect_s2 3 'not_archived'
[[ "$(q "select status from programs where id = '22ac4000-0000-0000-0000-000000000003';")" == "active" ]] || { echo "FAIL (3): Program not restored"; exit 1; }
echo "PASS 3: deletion waited for the in-flight restore, then refused the now-active Program"

# 4 ---------------------------------------------------------------------------
scenario "4 deletion, then restore" \
  "${SUPER_SUB}" "select delete_archived_program('22ac4000-0000-0000-0000-000000000004', 'CONC-DEL-4', 'Concurrent test');" \
  "${ADMIN_SUB}" "update programs set status = 'active' where id = '22ac4000-0000-0000-0000-000000000004';"
expect_s2 4 'UPDATE 0'
[[ "$(q "select count(*) from programs where id = '22ac4000-0000-0000-0000-000000000004';")" == "0" ]] || { echo "FAIL (4): Program survived"; exit 1; }
echo "PASS 4: the restore waited for the deletion and then matched no row"

# 5 ---------------------------------------------------------------------------
q "update programs set status = 'active' where id = '22ac4000-0000-0000-0000-000000000005';" >/dev/null
scenario "5 website document creation, then deletion" \
  "${ADMIN_SUB}" "select website_create_program_document('22ac4000-0000-0000-0000-000000000005', 'conc-del-five'); update programs set status = 'archived' where id = '22ac4000-0000-0000-0000-000000000005';" \
  "${SUPER_SUB}" "select delete_archived_program('22ac4000-0000-0000-0000-000000000005', 'CONC-DEL-5', 'Concurrent test');"
expect_s2 5 'P2201'
expect_s2 5 'dependency:website_documents'
[[ "$(q "select count(*) from website_documents where program_id = '22ac4000-0000-0000-0000-000000000005';")" == "1" ]] || { echo "FAIL (5): website document lost"; exit 1; }
echo "PASS 5: deletion waited for the in-flight website document, then refused"

# 6 ---------------------------------------------------------------------------
scenario "6 two saves from the same base revision" \
  "${ADMIN_SUB}" "select revision_number from website_save_draft('${DOC_ID}', 1, 'Editor A', null, null, null, null, null, null, null, '[]');" \
  "${SUPER_SUB}" "select revision_number from website_save_draft('${DOC_ID}', 1, 'Editor B', null, null, null, null, null, null, null, '[]');"
expect_s2 6 'P2203'
[[ "$(q "select count(*) from website_document_revisions where document_id = '${DOC_ID}';")" == "2" ]] || { echo "FAIL (6): wrong revision count"; exit 1; }
[[ "$(q "select title from website_document_revisions where document_id = '${DOC_ID}' and revision_number = 2;")" == "Editor A" ]] || { echo "FAIL (6): editor A's save lost"; exit 1; }
echo "PASS 6: the second editor's save from a stale base was refused; no lost update"

# 7 ---------------------------------------------------------------------------
REV2="$(q "select id from website_document_revisions where document_id = '${DOC_ID}' and revision_number = 2;")"
scenario "7 new draft while publishing an older revision" \
  "${ADMIN_SUB}" "select revision_number from website_save_draft('${DOC_ID}', 2, 'Editor A rev 3', null, null, null, null, null, null, null, '[]');" \
  "${SUPER_SUB}" "select website_publish_document('${DOC_ID}', '${REV2}');"
expect_s2 7 'P2203'
[[ "$(q "select coalesce(published_revision_id::text, 'none') from website_documents where id = '${DOC_ID}';")" == "none" ]] || { echo "FAIL (7): an outdated revision was published"; exit 1; }
echo "PASS 7: publishing a revision that stopped being the latest was refused"

echo
echo "PASS: Program deletion and website publication are concurrency-safe in all 7 forced interleavings."
