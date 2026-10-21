# Phase 22A: real-DEV functional verification handoff (Windows PowerShell + psql)

> ## ⛔ DO NOT RUN UNTIL THE OWNER EXPLICITLY AUTHORIZES THIS VERIFICATION.

- **Target:** Roicians India LMS Dev, `nqeaehqzhjhhgsilrgeo`, only.
- **Script:** `docs/recovery/phase22a_dev_post_recovery_verification.sql`, unchanged since review.

| Item | Value |
|---|---|
| SHA-256 | `bb3b32159716db06d4fbe1e716e33e813a5d4eceae095a38915d87891e308c2f` |
| Size | 243 lines, 13,585 bytes |
| Commit-pinned download | <https://raw.githubusercontent.com/dineshchabbara-hash/roiciansindia/56c73406c1c4bf506d71d677b1f16f8787672c6a/docs/recovery/phase22a_dev_post_recovery_verification.sql> |

Use the same PowerShell window setup as the recovery runbook
([`PHASE22A_MANUAL_RECOVERY_RUNBOOK.md`](PHASE22A_MANUAL_RECOVERY_RUNBOOK.md)):
- Step 0: `$Psql`, and no stray `PG*` settings.
- "Connection setup": `PGSSLMODE=verify-full`, the Supabase root certificate,
  `PGCLIENTENCODING=UTF8`.
- **Password:** typed only at psql's own prompt.

## 1. Download and verify (non-writing)

```powershell
$Dir = Join-Path $HOME 'phase22a'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$Url = 'https://raw.githubusercontent.com/dineshchabbara-hash/roiciansindia/56c73406c1c4bf506d71d677b1f16f8787672c6a/docs/recovery/phase22a_dev_post_recovery_verification.sql'
$File = Join-Path $Dir 'phase22a_dev_post_recovery_verification.sql'
Invoke-WebRequest -Uri $Url -OutFile $File -UseBasicParsing
$Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant()
if ($Actual -ne 'bb3b32159716db06d4fbe1e716e33e813a5d4eceae095a38915d87891e308c2f') { throw "CHECKSUM MISMATCH: $Actual - STOP. Do not edit the file." }
"OK  $Actual"
```

## 2. Read-only checks first

- **B** (`phase22a_B_identity_check.sql`) must pass: 7 / 7.
- **E** (`phase22a_E_post_recovery_check.sql`) must pass: 36 / 36. This
  confirms the recovered state and the data baseline immediately before the
  run.

## 3. The verification run (only after explicit authorization)

```powershell
& $Psql -X -v ON_ERROR_STOP=1 -b -P pager=off -f $File -L (Join-Path $Dir 'F_functional_verification.log')
"psql exit code: $LASTEXITCODE"
```

| Option | Why |
|---|---|
| `-f $File` | Runs the verified file unchanged |
| `-X` | Doesn't load any psqlrc startup file |
| `-v ON_ERROR_STOP=1` | Stops at the first failed check. The open transaction is never committed |
| `-b` | Echoes the failing statement |
| `-L` | Keeps a session log |
| (no `-1`) | The script has its own `begin; … rollback;` |
| (no retry) | Run it once |

**Expected success:**
- Six `NOTICE: PASS V2`, `V3`, `V3b`, `V4`, `V5`, `V6` lines.
- The final command tag is `ROLLBACK`.
- The exit code is **0**.

**Any other result:**

| Result | Meaning | Next step |
|---|---|---|
| Exit code **3** | A check failed, or a precondition refused. Nothing was committed, because the script never commits. | Send the last ~20 lines of the log. Do not re-run. |
| Exit code 1 or 2, a lost connection, or a hang | Outcome unknown | Run E again in a new window and send its output. Do not re-run. |

**Afterwards:** run **E** again (read-only). It must still pass 36 / 36,
including the unchanged business and audit baselines. That proves the run
left nothing behind.

## 4. What the script creates, and how it is removed

**The transaction**
- Everything runs inside one transaction: `begin` on line 27, `rollback` on
  line 243.
- There is **no `COMMIT` statement** in the script. The only occurrence of
  the word is line 60's `on commit drop`, which makes the sequence-snapshot
  temp table vanish with the transaction.
- On success, the final `ROLLBACK` discards every row.
- On any error, psql stops (`ON_ERROR_STOP`) and the aborted transaction is
  rolled back when the session ends.
- Either way, no row is ever committed.

**Synthetic fixtures.** All use fixed IDs that the preconditions check are
unused.

| Table | Rows |
|---|---|
| `auth.users` | 5: `22d00000-…-000000000001…005`, `p22d-{super,admin,trainer,student,inactive}@validation.local` |
| `user_roles` | 5: one per synthetic user |
| `admins` | 3: Super Admin, Admin, inactive Admin (`22d10000-…`) |
| `trainers` | 1 (`22d20000-…`) |
| `students` | 1: `P22D-STU-1`, phone `9990022901` (`22d30000-…`) |
| `programs` | 4: `P22D-ACTIVE` (active); `P22D-SAFE`, `P22D-MODULE`, `P22D-ENROL` (archived) (`22d40000-…`) |
| `program_modules` | 1, under `P22D-MODULE` |
| `enrollments` | 1: `P22D-ENR-4` (cancelled) under `P22D-ENROL` |
| `audit_logs` | 1 synthetic `program.create` for `P22D-SAFE` |

**Created indirectly by the functions being tested:**
- **Website rows** for the synthetic Program: a document and its revisions,
  plus a `programs_listing` page and an `upcoming_batches` page.
- **Audit rows:**
  - website audit rows;
  - an `enrollment.row_deleted` row, when `service_role` removes the
    synthetic enrollment;
  - a `program.deleted` row, when Super Admin deletes the synthetic
    `P22D-SAFE`.

**The only deletions** in the script target synthetic rows:

| Statement | Target | Expected outcome |
|---|---|---|
| `delete from programs` as Admin | `P22D-SAFE` | Refused |
| `delete from programs` as `service_role` with a forged marker | `P22D-MODULE` | Refused |
| `delete from enrollments` | `P22D-ENR-4` | Succeeds, inside the transaction |
| `delete_archived_program` | `P22D-SAFE` | Succeeds, inside the transaction |

## 5. Why existing LMS records cannot be changed or deleted

1. **No statement names an existing record.**
   - Every insert, delete and function call uses the synthetic IDs or codes.
   - Direct deletes are by exact synthetic `id`.
   - `delete_archived_program` deletes only the exact Program it is given, and
     its guard refuses any other row.
   - `P22D-SAFE` has no modules, so nothing cascades.
2. **The whole run is rolled back.** Even the synthetic rows do not survive.
3. **Non-transactional side effects are ruled out or checked:**
   - **Sequences:** every fixture supplies its own code, and check V6 fails
     the run if any `public` sequence moved.
   - **Outbound calls:** no HTTP extension or webhook trigger exists, and
     `auth.users` has no triggers. The script refuses if any appear.
   - **Auth e-mails:** these come from the Auth API, not from `auth.users`
     rows.
   - **Realtime:** it only streams committed changes.
4. **Locks:** row locks are taken on synthetic rows only. Lock waits are
   capped at 10 seconds.

**What can remain:**
- Server logs, WAL and `pg_stat_statements` can still record the synthetic
  statements and values: P22D names and `@validation.local` addresses. These
  contain no real personal data.
- Re-running E afterwards proves no business or audit data changed.

## 6. Preconditions re-checked read-only on DEV (2026-10-21)

All hold:
- DEV cluster, database `postgres`, user `postgres`.
- History equals migrations 1–42 (`bf94f88d…`).
- No `pg_net` / `http` extension.
- 0 `auth.users` triggers; 0 webhook triggers.
- No `P22D-%` Program codes.
- No synthetic `auth.users`, staff, student, enrollment or Program ID / code /
  e-mail / phone collisions.
- `postgres` holds INSERT on all nine tables the script writes.
- No required column is missing from the script's inserts.
- 0 other active sessions.

Triggers on the written tables are all internal: `updated_at`, protected-link
and code guards, the Program guards, and the delete-history evidence. None can
make an outbound call.

**Not covered by this script:**
- **Concurrency races:** single session. They are covered by the local
  concurrency suite.
- **Storage uploads:** there is no upload path in 22A.
