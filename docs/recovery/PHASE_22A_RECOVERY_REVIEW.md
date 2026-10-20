# Phase 22A — Corrections and DEV Recovery Proposal

**Status: Implemented on branch; not accepted; DEV migration incomplete.**

The corrections below are **locally verified only** (disposable PostgreSQL 16
and 17.6 databases); nothing in this document has been run against DEV.
**TI-1 remains open on DEV.** **TI-7 remains blocked** until separately
resolved. **The DEV recovery below is a proposal awaiting explicit approval
of its exact SHA-256** — generating, reviewing or committing it is not
authorization to run it.

| Item | Value |
|---|---|
| Branch | `claude/phase22a-website-foundation` (corrections start from `8ec1be6`) |
| `main` | `9184c82e2180334e2e9c0c5cb4f7151f0300d32c` (unchanged, not merged) |
| DEV | `nqeaehqzhjhhgsilrgeo`, PostgreSQL 17.6, cluster system identifier `7678069749886157684` |
| Previous review | [`PHASE_22A_RECOVERY_REVIEW_INITIAL.md`](PHASE_22A_RECOVERY_REVIEW_INITIAL.md) (superseded) |
| Superseded script | `phase22a-dev-remainder.sql`, SHA-256 `5bd38ec1…90ad422` — **must not be submitted or executed** |

## 1. Acknowledged weaknesses of the original migration 41

Migration `20260101000041_program_deletion_safeguards.sql` is kept unchanged as
reviewed history. Its weaknesses (found in the first review, both reproduced
locally) were:

1. **Program-history gap.**
   - Eligibility looked only at live dependent rows, plus audit rows naming the Program by id or code.
   - Payment and certificate audit rows name only the enrollment, and Batch and class-session rows name only the Batch.
   - So once an enrollment or Batch row was removed by a privileged route (or by an Admin, for Batches), the Program could appear unused while its training or financial history still existed.
2. **Forgeable deletion marker.**
   - `guard_program_delete()` trusted the `roicians.program_delete_authorized` setting alone, and any session can set a custom setting.
   - A `service_role` SQL session could therefore delete a Program without the workflow. Every check was skipped and the Program's modules were cascade-deleted.

Also corrected:
- Migration 40 had no storage for the Programs-listing and Upcoming-Batches page copy.
- `service_role` kept EXECUTE on internal helpers through Supabase default grants.

## 2. The corrective migration (`20260101000042_phase22a_corrections.sql`)

Forward only; migrations 1–41 are byte-identical to `8ec1be6`.

| # | Change | Objects |
|---|---|---|
| 1 | Programs-listing and Upcoming-Batches pages | `website_documents_kind` check (+`programs_listing`, `upcoming_batches`), single-instance index, `website_allowed_section_types()` (both: hero, text, list, faq, cta, banner), `website_create_page()` |
| 2 | Trustworthy Program creation time | trigger `programs_guard_created_at` / `guard_program_created_at()`: `created_at` cannot change after insert or be set in the future |
| 3 | Durable deletion evidence | `record_program_history_on_delete()` (SECURITY DEFINER) + BEFORE DELETE triggers `enrollments_record_program_history`, `batches_record_program_history`, `certificates_record_program_history` |
| 4 | Unattributable history | `program_unattributable_history(uuid)` (read-only, internal) |
| 5 | Eligibility | `program_deletion_blockers_internal()` = migration-41 rules + `unattributable_history` |
| 6 | Guard | `guard_program_delete()` (invoker rights) also requires `current_user` = owner of `delete_archived_program()` |
| 7 | Helper privileges | 17 internal helpers: EXECUTE revoked from PUBLIC, anon, authenticated **and service_role** |

**Application files changed:**
- `lib/supabase/database.types.ts`: two new kinds.
- `lib/domain/website.ts`: kinds, single-instance list, section table, `unattributable_history` explanation.
- Unit tests, which now check the latest migration that defines each rule.

## 3. Program-history protection

### 3.1 Durable evidence (any route)

On every `DELETE` of an `enrollments`, `batches` or `certificates` row,
whether through the application (Admins can delete Batches through the
unchanged `batches_delete_admin` policy), the service role or SQL, the trigger
writes in the **same transaction** one audit row:

| action / entity | `before_data` | `after_data` |
|---|---|---|
| `enrollment.row_deleted` / enrollment | `programId`, `batchId`, `status` | `{"source":"delete_trigger"}` |
| `batch.row_deleted` / batch | `programId`, `status` | same |
| `certificate.row_deleted` / certificate | `programId`, `enrollmentId`, `status` | same |

- **Minimal content:** no names, emails, student ids or amounts are recorded. The actor is `auth.uid()` (null for service role or SQL), and `actor_role` is `system`.
- **No permission changes:** no permission is granted or removed. If the deletion fails, its evidence rolls back with it.
- **Effect on eligibility:** the existing `audit_history` check then blocks that Program, because the row names its `programId`.

**Other deletion routes examined:**

| Table | Who can delete | Effect | Covered by |
|---|---|---|---|
| `programs` | nobody directly (41) | — | guard + workflow |
| `batches` | Admin (policy, unchanged) | cascades sessions, attendance, Batch materials and assignments; detaches enrollments | Batch evidence; enrollments survive |
| `enrollments` | no application role (privileged routes only) | cascades plans, attendance, submissions; payments, certificates and orders RESTRICT | enrollment evidence |
| `certificates` | no application role | — | certificate evidence |
| `payments`, `payment_refunds`, `receipts` | no application role; RESTRICT chains | — | enrollment survives or has evidence |
| `attendance`, `class_sessions`, `assignments`, `payment_plans`, `installments` | Admin (policies, unchanged) | the enrollment and Batch rows survive | live FKs, or Batch evidence |
| `students` | Admin | RESTRICT while enrollments exist | — |

### 3.2 Unattributable history (fail-closed)

- **Evidence considered:** read-only audit rows of protected records:
  - entity types `enrollment`, `batch`, `payment`, `certificate`, `class_session`, `attendance`, `assignment`, `assignment_submission`, `payment_plan`, `installment`, `refund`, `receipt`;
  - plus every payload reference to an `enrollmentId`, `batchId`, `paymentId` or `assignmentId`.
- **Attributable:** the record still exists (its foreign keys tie it to a Program), or some audit row about it carries a `programId`, `enrollmentId`, `batchId`, `paymentId` or `assignmentId`. The onward reference is then checked the same way, for example submission → assignment → Batch → Program, or refund → payment → enrollment → Program.
- **Unattributable:** everything else. Its Program cannot be established.
- **Known history** (the chain reaches this Program) blocks as `audit_history` or as a live `dependency:*`. Known history of a *different* Program does not block this one.
- **Scope of `unattributable_history`:** it blocks every Program whose creation is on or before the evidence timestamp.
  - "Creation" is the earlier of `programs.created_at` and the Program's first audit record.
  - `programs.created_at` can no longer be changed or set in the future (change 2), so the window cannot be moved.
- **Why a later Program is exempt:** every protected record requires its Program to exist first, so evidence recorded before a Program existed cannot belong to it. That is the only exemption. There is no override, no "Delete anyway", and no relabelling, deleting or ignoring of evidence.
- **Which Programs this affects on DEV:** 33 unattributable audit rows exist there (payments, plans, an instalment edit, certificate issue and reissue for 22 enrollments that no longer exist). All of them postdate both current DEV Programs, so **both existing DEV Programs would be blocked** by `unattributable_history`. A Program created after that evidence is not affected. The evidence is treated as real history; it is **not** assumed to be test residue and is not cleaned up.
- **Routine history:** `program.create`, `program.update` and `program.status_change`, plus never-published website drafting, still survive deletion and do not block on their own.

## 4. Deletion guard, roles and the database-owner limit

`guard_program_delete()` is deliberately **not** SECURITY DEFINER, so inside
it `current_user` is the role that issued the `DELETE`. It now requires both:

- `current_user` = owner of `delete_archived_program()`. That function is SECURITY DEFINER, so this holds inside it and in an owner session.
- the per-Program marker that `delete_archived_program()` sets after its own checks.

**Local results** (PostgreSQL 16 and 17.6):

| Session | Self-set marker + `DELETE` | Result |
|---|---|---|
| anon, Student, Trainer, Admin, Super Admin (`authenticated`) | yes | `permission denied` (no DELETE privilege) |
| `service_role` | yes | refused by the guard (42501); module intact |
| Super Admin via `delete_archived_program()` | (set by the function) | deleted with `program.deleted` audit |
| database owner (`postgres`) session | yes | **deletes** (documented limitation) |

**Limitation:**
- The owner can satisfy the guard, or disable triggers.
- Unrestricted database-owner or administrator access is **outside what this application workflow can protect against**.
- Neither the marker nor the owner comparison proves entry through one particular function. Together they require an owner-privileged context, and a test asserts that no other function in `public` deletes from `programs`.
- On DEV, `service_role` is NOLOGIN and reachable through PostgREST (which cannot set arbitrary settings) or through an administrative login.

## 5. Programs-listing and Upcoming-Batches page content

- **Kinds:** `programs_listing` and `upcoming_batches` are single-instance. They allow hero, text, list, faq, cta and banner sections; `program_showcase` and `menu` are rejected.
- **Same machinery as other pages:** both support draft, revision, publish, unpublish, restore and stale-edit rejection.
- **No duplicated facts:** they hold only the pages' own copy (introduction, FAQs, banners, CTAs, SEO). The listed Programs and Batches come from their authoritative records through the Phase 22C contract. No fact columns are added.
- **Not built:** no UI, route, public read path or seed content.

## 6. Effective helper privileges (after migration 42)

| Functions | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| 17 internal helpers and trigger functions (`website_assert_manager`, `website_clean_text`, `website_is_safe_href`, `website_is_valid_slug`, `website_allowed_section_types`, `website_validate_sections`, `website_audit`, `website_insert_revision`, 4 website trigger functions, `guard_program_delete`, `program_deletion_blockers_internal`, `guard_program_created_at`, `record_program_history_on_delete`, `program_unattributable_history`) | no | no | no | **no** |
| 18 website management functions | no | no | yes (self-checking) | yes (unchanged; they refuse without an Admin session) |
| `program_deletion_blockers`, `delete_archived_program` | no | no | yes (Super Admin self-check) | yes (unchanged; they refuse without a Super Admin session) |

**How this was tested:**
- **Checked with** `has_function_privilege` and `aclexplode`, so inherited and default grants are included.
- **Still working:** trigger firing does not require EXECUTE, so deletions by `service_role` still record evidence, and the authorized workflows still work (tested).
- **Unchanged:** no global default privileges and no unrelated LMS function grants.
- **Known consequence:** direct `service_role` writes to `website_documents` now fail, because the check constraint calls the revoked `website_is_valid_slug`. `service_role` is not an intended writer.

## 7. Tests (commands, versions, counts)

| Category | Command | PostgreSQL 16.13 | PostgreSQL 17.6 |
|---|---|---|---|
| Corrections suite (K1–K7) | in `bash scripts/test-rls.sh` | 11/11 PASS | 11/11 PASS |
| Full SQL/RLS suite (22 files) | `bash scripts/test-rls.sh` | 454 PASS, 0 errors, exit 0 | 454 PASS, 0 errors, exit 0 |
| Concurrency (9 interleavings) | `bash scripts/test-program-deletion-concurrency.sh` | 9/9 PASS | 9/9 PASS |
| Mutation check (8 corrections removed one at a time) | `bash scripts/test-phase22a-correction-mutations.sh` | 8/8 detected | 8/8 detected |
| Recovery rehearsal | `bash scripts/recovery/rehearse-phase22a-dev-recovery.sh` | refuses (version precondition), as designed | PASS (§8) |
| Unit (Vitest) | `npx vitest run` | 139 files, 1,666 tests PASS (56 website-focused) | — |
| Typecheck / lint / build | `npm run typecheck`, `npm run lint`, `npm run build -- --webpack` | clean / 0 errors (4 existing warnings) / success | — |

**How the PostgreSQL 17.6 runs were done:**
- They used the official 17.6 binaries from the npm package `@embedded-postgres/linux-x64@17.6.0-beta.15`, in a disposable cluster on port 5433, with the PostgreSQL 17 commands pointed at it (`PSQL_HOST=/var/tmp/pg17 PSQL_PORT=5433 PG_BIN=/var/tmp/pg17/bin`).
- That package has no `pg_dump`, so on 17.6 the schema comparison uses the full catalog listing (§8).
- The local auth and Storage objects are stubs. The **real** DEV Auth, Storage and PostgREST stack, and hosted default grants, are **not** exercised locally (see §10).

**Not run:**
- browser (Playwright) tests: there is no UI in this stage;
- any DEV test.

## 8. Clean install vs. partial-DEV recovery (PostgreSQL 17.6)

`scripts/recovery/rehearse-phase22a-dev-recovery.sh`:

1. **A, clean replay:** migrations 1–42 plus a simulated 42-row history.
2. **B, recovery replay:** migrations 1–39, then migration 40 without the discard function, plus a 39-row history. B reproduces the DEV-observed partial fingerprint exactly. Then the recovery script runs. The rehearsal copy differs from the proposed file in **exactly 2 lines**: the cluster identifier and the database name.
3. **A vs B:** the final-state fingerprint is equal, and the **full catalog listing is identical (4,263 lines)**. It covers every function definition with owner, ACL and comment, constraints, indexes, policies (public + storage), triggers, columns, table ACLs and comments, buckets, and the migration `version:name` list (42 rows).
4. **Refusals:** the unmodified script refused on a non-DEV cluster. A repeated run refused (history) and changed nothing. A simulated late execution of an earlier timed-out request (the discard function appearing) refused.
5. **Suites on the recovered database:** both Phase 22A suites pass, and the post-recovery verification script passes 6/6 and leaves no rows, schema or sequence change.

## 9. The proposed DEV recovery

| Item | Value |
|---|---|
| File | [`docs/recovery/phase22a_dev_recovery.sql`](phase22a_dev_recovery.sql) — environment-specific, not a migration, **not authorized for execution** |
| SHA-256 | `018f460fabad4d5d273035b295185a53827f5e6089161892f164470d6b21a562` (also in `phase22a_dev_recovery.sql.sha256`); 1,072 lines, 58,190 bytes |
| Generator | `node scripts/recovery/generate-phase22a-dev-recovery.mjs` (deterministic; refuses if 40/41 differ from the pinned hashes) |
| Sources | `…000040_website_content_foundation.sql` `e7f87f8a…13b837`; `…000041_program_deletion_safeguards.sql` `8b3bd346…3ad8e`; `…000042_phase22a_corrections.sql` `30274ead82bafbf234fadb9b5cdaf5b908b1bc9d72c8ccd5f8edd6df41acbc30` |

**Structure:** one transaction (`begin … commit`), with `lock_timeout 10s` and
`statement_timeout 5min`.

**0. Preconditions** (any failure raises; nothing changes):
- **Target:** cluster system identifier = DEV's; database `postgres`; PostgreSQL 17.x; `current_user = postgres`.
- **No concurrency:** a transaction advisory lock, plus `lock table supabase_migrations.schema_migrations … nowait`.
- **History:** exactly the 39 reviewed rows (count + checksum `7ee3ee94…`).
- **Exact partial state:** the 10 DEV-observed fingerprints (functions, constraints, indexes, policies, triggers, columns, grants, function grants, RLS, bucket); exactly 25 `website_*` functions; all 29 owned by `postgres`, with the reviewed service_role EXECUTE state.
- **Not yet present:** none of the 8 functions or 5 triggers of 40-remainder, 41 and 42; `programs_delete_admin` present and authenticated still holding DELETE (the pre-41 state); page kinds not yet present.
- **No use or late execution:** website tables and the `website-media` bucket are empty, and there are no website, Batch-publication, `program.deleted` or `*.row_deleted` audit rows.

**A–C. Body:**
- **A:** the only missing migration-40 object, `website_discard_unpublished_document`, verbatim, with its revoke and grant.
- **B:** migration 41, verbatim.
- **C:** migration 42, verbatim. It replaces the migration-41 guard and eligibility function **before commit**, so the original guard is never the committed end state.

**D. Postconditions:** the full final-state fingerprint must equal a clean
install of 1–42 ([`phase22a_expected_final_state.txt`](phase22a_expected_final_state.txt));
`programs_delete_admin` must be absent; authenticated must have no DELETE.

**E. History:** rows `20260101000040`, `…41` and `…42` are inserted **only
after D passed**. Each row's `statements` note records its source SHA-256. The
resulting 42-row history must match `bf94f88d…` (the version:name list of the
canonical files).

**What runs vs. what is only defined:**

| Category | Statements |
|---|---|
| Rows changed when the script runs | **only** the 3 `supabase_migrations.schema_migrations` inserts |
| Schema changes | `create or replace function` (functions of 40-remainder, 41, 42), `create trigger` ×5, `drop policy programs_delete_admin`, `revoke delete on programs`, `drop index` + `create unique index` (single-instance kinds), `alter table website_documents drop/add constraint website_documents_kind` (table verified empty), revoke/grant, comments |
| DELETE inside function definitions (never executed by the script) | `website_discard_unpublished_document` (`delete from website_documents`), `delete_archived_program` (`delete from programs`) |
| UPDATE, DELETE or TRUNCATE executed | none |

**Locks:**
- `create trigger` takes short SHARE ROW EXCLUSIVE locks on `programs`, `enrollments`, `batches` and `certificates`.
- `drop policy` and `alter table` take locks on `programs` and `website_documents`.
- `lock_timeout` makes the script fail rather than wait.

**Failure:** any error aborts the whole transaction. DEV stays exactly in
today's partial state; no history row is written.

**Repeated, stale or late execution:** a second run refuses (history). If an
earlier timed-out connector request executed late, the function count,
fingerprints or history no longer match and the script refuses. A wrong
cluster refuses.

**Outstanding approvals:**
- Earlier timed-out connector requests (the full `apply_migration` of 40, part "4", part "4a") may still have approval prompts. They are **not assumed cancelled**. Please decline any that are pending.
- Before any DEV operation, DEV must be re-read and the outstanding prompts resolved. The script's preconditions re-check the state at run time.

This is not a blanket "safe to run" statement. The exact file and SHA-256
above require separate review and explicit approval.

## 10. Real-DEV post-recovery verification (separate approval; not run)

[`docs/recovery/phase22a_dev_post_recovery_verification.sql`](phase22a_dev_post_recovery_verification.sql)
is one transaction that ends in **ROLLBACK**. It preconditions on:
- DEV's cluster identifier;
- the 42-row history;
- no HTTP extension, auth.users triggers or webhook triggers;
- unused synthetic codes.

It then checks, under the real hosted roles and RLS:
- Admin drafting, publishing, restoring, stale save and publish rejection, both new page kinds, and helper denial;
- Admin direct and functional Program deletion denied;
- Trainer, Student, inactive Admin and anon denied;
- `service_role` helper denial and forged-marker denial;
- the deletion-evidence path;
- Super Admin `not_archived`, `dependency`, `audit_history` and successful synthetic deletion with audit retained.

**Side effects:**
- **Sequences:** they are not transactional, so every fixture supplies its own code (no payments or certificates are created). The script snapshots all `public` sequences and fails if any moved.
- **Messages:** none can be sent (precondition above). Supabase Auth e-mails come from the Auth API, not from `auth.users` rows.
- **Remaining traces:** server logs, WAL and `pg_stat_statements` can still record the synthetic statements. ROLLBACK alone is not claimed to remove everything.
- **Rehearsal:** on the recovered local database it passed 6/6 and left no row, schema or sequence change.

**Not covered there:** concurrency races. The connector is a single session.

## 11. Remaining blockers

1. The DEV recovery is **not applied**. TI-1 stays open on DEV until the approved script commits.
2. Possibly pending connector approval prompts from earlier timed-out requests.
3. The real-DEV verification awaits separate approval after recovery.
4. TI-7 (previously published Programs) is still blocked by design until safe slug, link and asset handling is designed.
5. The Phase 22B screens (eligibility review, reason and confirmation, explanations) are not built.
6. On DEV, both current Programs will be blocked by `unattributable_history` (§3.2). Resolving that history is a business decision, not something this workflow can override.

**Next operation requiring approval:** executing exactly
`docs/recovery/phase22a_dev_recovery.sql` with SHA-256
`018f460fabad4d5d273035b295185a53827f5e6089161892f164470d6b21a562` against
DEV `nqeaehqzhjhhgsilrgeo`. Any pending connector prompts must be resolved
and DEV re-read first. Then, separately, the post-recovery verification
script.
