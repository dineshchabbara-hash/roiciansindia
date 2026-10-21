# Phase 22A — DEV Recovery Record and Acceptance Status

**Status: Implemented on branch; DEV recovered and structurally verified;
real-DEV functional verification pending; not accepted; not merged.**

| Item | Value |
|---|---|
| Branch | `claude/phase22a-website-foundation` (not merged to `main`) |
| DEV project | Roicians India LMS Dev, `nqeaehqzhjhhgsilrgeo` (PostgreSQL 17.6, cluster `7678069749886157684`) |
| Recovery script | [`phase22a_dev_recovery.sql`](phase22a_dev_recovery.sql), SHA-256 `018f460fabad4d5d273035b295185a53827f5e6089161892f164470d6b21a562`, reviewed at commit `56c73406c1c4bf506d71d677b1f16f8787672c6a` |
| How it was run | By the owner, from Windows PowerShell with `psql`, over a TLS connection with certificate and hostname verification (`sslmode=verify-full`). The Supabase MCP connector was **not** used for the recovery (see "Connector history") |
| Runbook and check scripts | [`manual_psql/`](manual_psql/) — the exact files used (checksums below) |
| Recorded on | 2026-10-21 |

## 1. What was executed

The owner ran the runbook in [`manual_psql/PHASE22A_MANUAL_RECOVERY_RUNBOOK.md`](manual_psql/PHASE22A_MANUAL_RECOVERY_RUNBOOK.md).
That file is kept exactly as handed over, so its checksum stays verifiable.
Its step D still carries the "do not run until approved" warning it had at
handover; the owner approved and ran it.

| Step | Owner-reported result |
|---|---|
| A — file checksums | Recovery script `018f460f…a562` verified before use |
| B — connection and DEV identity (`phase22a_B_identity_check.sql`) | 7 / 7 PASS |
| C — fresh preflight and data baseline (`phase22a_C_preflight_check.sql`) | 30 / 30 PASS |
| D — recovery script, once, `psql -X -v ON_ERROR_STOP=1 -b -f` | Committed, exit code 0 |
| E — post-recovery verification (`phase22a_E_post_recovery_check.sql`) | 36 / 36 PASS, `ALL CHECKS PASS`, exit code 0 |

Check-script checksums (all three are read-only: one `READ ONLY` transaction,
ended by `ROLLBACK`):

| File | SHA-256 |
|---|---|
| `manual_psql/phase22a_B_identity_check.sql` | `e866df9fe1e5844334a4a4a1b2f826d7af2b82c0b97f04934efd8e1362c6b171` |
| `manual_psql/phase22a_C_preflight_check.sql` | `aa1aae6c2aba0d32625408a7586b80985c0f6497b1b0f1f868e27f7ff1a08b01` |
| `manual_psql/phase22a_E_post_recovery_check.sql` | `57759caa2e12e1f0b2cd849b68fc335303161455ced3bcef417e1e3bb1225f64` |

How the check scripts were built and tested:
- Their fingerprint queries are copied byte-for-byte from the recovery script.
- Before handover they were tested only on disposable local PostgreSQL 17.6
  databases:
  - C passed on a pre-recovery copy.
  - E passed on a recovered copy.
  - Both refused on the wrong state.
- Step D's exact command was also tested locally: it refused with exit code 3
  and changed nothing.

## 2. Independent read-only confirmation (2026-10-21)

Separately from the owner's run, read-only queries were made through the
Supabase connector. No writes.

| Check | Result |
|---|---|
| Cluster identity | DEV (`7678069749886157684`) |
| Migration history | 42 rows; fingerprint `bf94f88d0d898a25a3910f3d4e287925`; `20260101000040:website_content_foundation`, `20260101000041:program_deletion_safeguards`, `20260101000042:phase22a_corrections` |
| Final Phase 22A schema fingerprint (15 aspects) | md5 `c6e0250b5a53767c4e7e041adc4d0a10` = a clean install of migrations 1–42 (`phase22a_expected_final_state.txt`) |
| `programs_delete_admin` | Absent |
| Direct Program DELETE for `anon` / `authenticated` | None |
| Guard and evidence triggers | All 5 present and enabled; `guard_program_delete` runs with the caller's own rights; `website_discard_unpublished_document` runs with elevated rights (`SECURITY DEFINER`) |
| Website tables | All 7 have RLS on and are empty; `website-media` bucket private and empty |
| Phase 22A audit rows | None written |
| Existing data | `programs` 2, `program_modules` 0, `batches` 3, `enrollments` 11, `students` 11, `payments` 0, `certificates` 0, `audit_logs` 185 — row-hash identical to the pre-recovery baseline |

These baseline hashes were computed with the DEV session settings (`UTC`,
`ISO, MDY`, `extra_float_digits = 0`). The check scripts pin those same
settings.

**TI-1 is closed on DEV.** It remains open in production, where migrations
40–42 are not applied; merging does not change any database.

## 3. Connector history (for support; cause not established)

- **Recovery attempt, 2026-10-20 15:15:24Z.** A request carrying the full
  recovery script through the Supabase MCP connector (`execute_sql`) timed
  out after 60 seconds, with no response from the server and no visible
  approval prompt. Read-only checks showed nothing was committed and nothing
  was left running.
- **Earlier connector requests.** Their state cannot be observed and is
  recorded as unknown. The recovery script refuses to run twice; a repeat or
  late execution is refused (rehearsed).
- **Read-only query, 2026-10-21.** A large read-only query (about 18 KB, no
  write statements) also timed out after 60 seconds. Smaller read-only
  queries succeeded. So the timeouts are not explained only by Supabase's
  confirmation of destructive SQL; the cause is not established.
- **Support summary.** It was kept outside the repository. It contains no
  secrets.

## 4. Real-DEV functional verification (pending; separately approved)

[`phase22a_dev_post_recovery_verification.sql`](phase22a_dev_post_recovery_verification.sql),
SHA-256 `bb3b32159716db06d4fbe1e716e33e813a5d4eceae095a38915d87891e308c2f`.
It is unchanged since review and rehearsed locally (6 / 6 PASS, no residue).
It is **not yet run on DEV**, and needs the owner's separate approval.

What it does:
1. It runs as one transaction that ends in `ROLLBACK`.
2. It creates synthetic fixtures with fixed `22d…` IDs, `P22D-…` codes and
   `@validation.local` e-mails.
3. It exercises the hosted roles: Admin, Trainer, Student, inactive Admin,
   `anon`, `service_role` and Super Admin.
4. It fails if any `public` sequence moves.

The handoff, with the command and safety analysis, is in
[`manual_psql/PHASE22A_FUNCTIONAL_VERIFICATION_HANDOFF.md`](manual_psql/PHASE22A_FUNCTIONAL_VERIFICATION_HANDOFF.md).

Its safety preconditions were re-checked read-only on 2026-10-21, and all
hold:
- History: 42 rows, migrations 1–42.
- No HTTP extension, no `auth.users` triggers and no webhook triggers.
- No synthetic ID, code, e-mail or phone collisions.
- `postgres` may insert into every table the script writes.
- No required column is missing.
- No other active sessions.

## 5. Acceptance status

| Gate | Status |
|---|---|
| Migrations 40–42 applied to DEV, history recorded | Done (owner run; independently confirmed) |
| DEV schema equals clean install of 1–42 | Done (fingerprint match) |
| Existing DEV data and audit history unchanged | Done (row-hash match) |
| Local SQL/RLS suite, concurrency (9 interleavings), mutation checks, typecheck, lint | Pass (re-run 2026-10-21; lint has 4 pre-existing warnings in `lib/actions/payment-plans.ts`, outside 22A) |
| Unit suite | See §6 — one intermittent failure unrelated to 22A |
| Real-DEV functional verification | **Pending owner approval** |
| Documentation reflects DEV state | Done (this commit) |
| Owner acceptance; merge to `main` | **Not given**; merge needs separate authorization |

Known limitations accepted by design (not 22A defects):
- **TI-7:** previously published Programs stay blocked.
- **Both current DEV Programs are blocked** by 33 unattributable history rows;
  resolving that history is a business decision.
- **Batch deletion is unchanged:** `batches_delete_admin` still allows
  direct Batch deletion.
- **`TRUNCATE`** bypasses row triggers.
- **Placement settings are live**, not drafts.
- **TI-3** (the public "upcoming" rule) is open.
- **No screens yet:** the Super Admin deletion screens are Phase 22B.

## 6. Intermittent unit-test failure (outside 22A)

**Test.**
`components/admin/students/__tests__/student-form-duplicate-override-flow.test.tsx`
— "shows the duplicate warning on the first submit, creates nothing, then
creates on the second submit once confirmed with a reason".

**Observed (2026-10-21, branch head `56c7340`, 4-CPU environment).**

| Run | Result |
|---|---|
| Full suite, default parallel run #1 | 138 / 139 files, 1,665 / 1,666 tests. This test failed: `Unable to find an element with the text: /possible duplicate/i` |
| The file alone, 3 runs | 2 / 2 tests pass each time |
| Full suite, default parallel run #2 | **139 / 139 files, 1,666 / 1,666 tests: clean**, exit 0 |

The Phase 22A branch changes no Student code, component or action.

**Likely cause.** The test types a whole form, submits through the real
server action, and then waits with Testing Library's default 1-second
`findByText` limit. Under full-suite CPU load that can exceed one second. It
is a timing sensitivity of the test, not a Phase 22A regression.

**To obtain a clean full-suite result:**
1. Run the full suite with test files one at a time:
   `npx vitest run --no-file-parallelism`. Record the result together with
   one ordinary parallel run.
2. If the serial run is clean, accept that as the full-suite result for 22A,
   with this justified exception:
   - the failing file is outside the branch diff;
   - it passes alone and when run serially;
   - its failure mode is a timeout, not a wrong assertion.
3. Fix the test separately, with its own authorization. Preferred fix: wait
   on the actual server-action completion, or render with less work, rather
   than raising the timeout. That keeps the test meaningful.

A clean full-suite result has already been obtained (parallel run #2 above).
The intermittent failure is recorded so that a future red run of this one
test is recognised rather than retried blindly.
