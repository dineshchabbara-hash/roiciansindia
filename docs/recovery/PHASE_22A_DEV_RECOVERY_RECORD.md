# Phase 22A — DEV Recovery Record and Acceptance Status

**Status: Implemented on branch; DEV recovered; structural and functional
verification passed on DEV; ready for owner acceptance; not merged.**

Evidence labels used below:
- **[Owner]** — results the owner reported from their own psql runs.
- **[Independent]** — results checked separately in the cloud session, read-only.
- **[Local]** — disposable local test databases only.

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

## 4. Real-DEV functional verification (completed)

[`phase22a_dev_post_recovery_verification.sql`](phase22a_dev_post_recovery_verification.sql),
SHA-256 `bb3b32159716db06d4fbe1e716e33e813a5d4eceae095a38915d87891e308c2f`.
The handoff (command and safety analysis) is
[`manual_psql/PHASE22A_FUNCTIONAL_VERIFICATION_HANDOFF.md`](manual_psql/PHASE22A_FUNCTIONAL_VERIFICATION_HANDOFF.md).

**Before the run**
- **[Independent]** The safety preconditions were re-checked read-only on
  2026-10-21, and all held:
  - History: 42 rows, migrations 1–42.
  - No HTTP extension, no `auth.users` triggers and no webhook triggers.
  - No synthetic ID, code, e-mail or phone collisions.
  - `postgres` may insert into every table the script writes.
  - No required column is missing.
  - No other active sessions.
- **[Local]** The script was rehearsed on PostgreSQL 17.6: 6 / 6 PASS, no
  residue.

**Results**

| Step | Result | Source |
|---|---|---|
| Script checksum matched `bb3b3215…` before use | Yes | [Owner] |
| Pre-test step E (`phase22a_E_post_recovery_check.sql`) | 36 / 36 PASS, exit code 0 | [Owner] |
| Functional verification, run once from Windows PowerShell with psql | Completed successfully, including the Admin and other role/security checks | [Owner] |
| What a successful run implies | Each check raises an error on failure, and `ON_ERROR_STOP` turns that into exit code 3. So exit code 0 means every check passed: V2 Admin website workflow and deletion refusals; V3/V3b Trainer, Student, inactive Admin and anon denial; V4 `service_role` helper and forged-marker denial; V5 Super Admin blockers and controlled synthetic deletion with audit kept; V6 no sequence advanced | Inference from the reviewed script and [Owner] exit code |
| End of the verification run | `ROLLBACK`, exit code 0 | [Owner] |
| Post-test step E | 36 / 36 PASS, `ALL CHECKS PASS`, exit code 0 | [Owner] |
| Existing Programs, Students, Batches, Enrollments and audit history | Unchanged: the step E row-hash baselines matched | [Owner] |
| Sequences | No change reported | [Owner] |

**Not independently re-checked after the run.** The owner asked that no
further database queries be made at this point. The most recent
**[Independent]** read of DEV is from 2026-10-21, before the functional run
(§2). The owner's post-test step E covers the same 36 checks. A single
read-only re-check can be made on request.

**Not covered by this script** (covered locally instead):
- Concurrency races, because the script runs in a single session. **[Local]**
  9 interleavings pass.
- The website-reference and stored-file blockers.

## 5. Acceptance status

| Gate | Status | Source |
|---|---|---|
| Migrations 40–42 applied to DEV, history recorded | Done | [Owner] + [Independent] |
| DEV schema equals a clean install of 1–42 | Done (15-aspect fingerprint match) | [Owner] step E + [Independent] |
| Existing DEV data and audit history unchanged by the recovery | Done (row-hash match) | [Owner] + [Independent] |
| Real-DEV functional verification | **Done**: passed, rolled back, no residue | [Owner] |
| Existing data unchanged after the functional run | Done (post-test step E 36 / 36) | [Owner] |
| Local SQL/RLS suite, concurrency (9 interleavings), mutation checks, typecheck, lint | Pass (re-run 2026-10-21; lint has 4 pre-existing warnings in `lib/actions/payment-plans.ts`, outside 22A) | [Local] |
| Unit suite | Clean full-suite runs, parallel and serial (§6); one intermittent test outside 22A recorded | [Local] |
| Documentation reflects DEV state | Done | — |
| Owner acceptance | **Pending owner decision** | — |
| Merge to `main` | **Not done**; needs separate authorization | — |

Known limitations accepted by design (not 22A defects):
- **TI-7:** previously published Programs stay blocked.
- **Both current DEV Programs are blocked** by 33 unattributable history rows;
  resolving that history is a business decision.
- **Batch deletion is unchanged:** `batches_delete_admin` still allows
  direct Batch deletion. Deletions are now evidenced; narrowing Batch
  deletion was not authorized in 22A.
- **`TRUNCATE`** bypasses row triggers.
- **Placement settings are live**, not drafts.
- **TI-3** (the public "upcoming" rule) is open.
- **No screens yet:** the Super Admin deletion screens are Phase 22B.
- **Production** still has the broad Program delete (TI-1). Merging does not
  change any database; production needs its own authorized deployment.

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
| Full suite, `npx vitest run --no-file-parallelism` | **139 / 139 files, 1,666 / 1,666 tests: clean**, exit 0 (234.5 s) |

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

## 7. Acceptance criteria review (design §5.3, §5.4, §7.5)

**Program deletion (§7.5)**

| # | Criterion | Evidence |
|---|---|---|
| 1 | Admin cannot permanently delete a Program | [Local] D tests; [Owner] DEV V2: direct and functional deletion refused; [Independent] no `programs_delete_admin`, no anon/authenticated DELETE |
| 2 | Super Admin cannot delete an unarchived Program | [Local]; [Owner] DEV V5 `not_archived` |
| 3 | A verified safe, unused archived Program can be deleted by Super Admin | [Local]; [Owner] DEV V5: synthetic Program deleted inside the rolled-back run |
| 4 | Any protected dependency blocks deletion | [Local] every FK dependency and blocker; [Owner] DEV V5 `dependency:program_modules` |
| 5 | Academic and financial history protected and unchanged | [Local]; [Owner] + [Independent] DEV baselines unchanged |
| 6 | Concurrent changes cannot bypass eligibility | [Local] 9 forced interleavings with real connections (not testable in the single-session DEV script) |
| 7 | Audit history, including the deletion record, survives | [Local]; [Owner] DEV V5: `program.deleted` written, `program.create` kept |
| 8 | Unsafe public references or unresolved file cleanup block deletion | [Local] `website_published_history`, `website_link_reference`, `stored_files`, `stored_file_reference` |
| 9 | Routine audit alone does not block | [Local]; [Owner] DEV V5: a Program whose only history was `program.create` was deleted |
| 10 | History known only from audit evidence blocks | [Local] incl. `unattributable_history`; [Owner] DEV V5: removed enrollment → `audit_history` |

**Data foundation (§5.4)**
- **Requirements:** Program website content; Batch publication metadata;
  display groups; pages and sections (including the Programs-listing and
  Upcoming-Batches kinds); revisions and concurrency; audit; public media
  metadata in a private bucket; private by default.
- **Evidence:**
  - [Local] website tests W1–W11.
  - [Independent] DEV schema fingerprint and empty, RLS-protected tables.
  - [Owner] DEV V2 exercised documents, both listing page kinds,
    publication and restore.
  - [Owner] V3/V3b showed no read access for other roles or anon.

**Draft and publish data rules (§5.3)**
- **At data level:**
  - Drafts are private ([Owner] V3/V3b).
  - Publishing is explicit (V2).
  - Timestamps and editor/publisher identity are recorded ([Local] W tests).
  - History is kept.
  - Restore is a recorded change (V2).
  - Lost updates are prevented: V2 refused the stale save and stale publish;
    [Local] concurrency also passes.
- **Authenticated preview** is a 22B screen concern (TI-6).

**Permissions (§5.2):** slug change after first publication is Super Admin
only ([Local] tests, mutation-checked). The Admin and Super Admin deletion
boundaries are covered above.

**Result:** no open Phase 22A acceptance blocker. Owner acceptance and merge
authorization remain the owner's decisions.

## 8. Phase 22B scope (carried forward; not started)

Per design §15 ("Admin Website Management, drafts, preview and publishing")
and §7.4:

1. **Website Management area** in the Admin portal, built from structured
   forms only:
   - page editors for every supported kind: home, about, corporate,
     institutions, contact, legal, navigation, footer, Programs listing and
     Upcoming Batches;
   - the Program website content editor: headline, sections, SEO and social
     metadata, image references.
2. **Draft, publish, unpublish and restore** screens, with revision history,
   editor and publisher identity, and clear stale-edit messages.
3. **Authenticated preview** that is never cached or indexed (TI-6).
4. **Display groups and placement:** create, rename, reorder, hide, archive
   and restore groups; featured and ordering. Decide whether placement
   becomes a drafted change (currently live).
5. **Batch publication:** public label, and the Open / Closed / Full
   registration state.
6. **Public media:** an upload path into the private `website-media`
   bucket, with metadata and approval. Public serving is 22C.
7. **Super Admin slug change** after first publication, with the redirect
   safeguard.
8. **Program deletion workflow screens:**
   - eligibility review;
   - reason entry and confirmation by typing the Program code;
   - blocked-deletion explanations (the wording is already mapped in
     `lib/domain/website.ts`);
   - the discard-unpublished-draft action.
9. **Server actions and data wrappers** with role checks, and unit,
   component and browser tests.

**Decisions to carry alongside 22B (not 22B build work unless authorized):**
- TI-7 design (previously published Programs: slugs, redirects, references,
  assets).
- Whether to narrow `batches_delete_admin`.
- The business decision on the 33 unattributable DEV history rows.
- Fixing the intermittent Student-form test.
- The production deployment of migrations 40–42.
- The Supabase connector timeout support ticket.

**Later stages:** the public read contract (22C), routing (22D), public pages
(22E–22G), enquiries (22H), SEO, accessibility and performance (22I), and the
browser and security audit (22J). TI-3 must be settled before 22E/22F.
