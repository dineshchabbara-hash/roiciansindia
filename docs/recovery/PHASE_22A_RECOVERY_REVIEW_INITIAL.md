> **SUPERSEDED — historical record only.** This is the first recovery review
> (2026-10-20). Its proposed script `phase22a-dev-remainder.sql`
> (SHA-256 `5bd38ec1755bdb59d2d424932f9dc28edccf4069f57f81efc050b291d90ad422`)
> applied migration 41 unchanged and **must not be submitted or executed**.
> Its full text and the prototype SQL are intentionally not reproduced here.
> The current proposal is [`PHASE_22A_RECOVERY_REVIEW.md`](PHASE_22A_RECOVERY_REVIEW.md);
> the corrections it recommended are implemented in migration
> `20260101000042_phase22a_corrections.sql`.

# Phase 22A — DEV Reconciliation, Safeguard Review and Recovery Proposal

**Status: Implemented on branch; not accepted; DEV migration incomplete.**
Review only: no DEV or production write, no script execution, no
migration-history change, no commit, push or merge was made during this review.

| Reference | Value (verified 2026-10-20) |
|---|---|
| Branch | `claude/phase22a-website-foundation` = `origin/…` = `8ec1be6d69ed583389830505ca3299c4dab2ddec`, clean tree |
| `main` / `origin/main` | `9184c82e2180334e2e9c0c5cb4f7151f0300d32c` (unchanged) |
| DEV | `nqeaehqzhjhhgsilrgeo`, "Roicians India LMS Dev", PostgreSQL 17.6, ACTIVE_HEALTHY |
| Repo migrations | 41 files; 40 and 41 exist only on the branch |

## 1. DEV reconciliation (read-only catalog queries)

**Migration history:** 39 rows; the latest is `20260101000039:admin_identity_settings`.
**No row for 40 or 41.**

**Migration 40 — present on DEV:**
- **Tables:** 7, all owned by `postgres` with RLS enabled: `website_display_groups`, `website_media_assets`, `website_documents`, `website_document_revisions`, `website_revision_media`, `website_program_slug_history`, `batch_website_publications`. Each has 0 rows.
- **Policies:** each table has exactly one policy, `*_select_admin`: SELECT, `is_admin_or_super()`.
- **Table grants:** `postgres` and `service_role` hold `arwdDxtm`; `authenticated` holds `r` only; `anon` has nothing.
- **Bucket:** `website-media` exists with `public=false` and 0 objects. Its only Storage policy is `website_media_bucket_select_admin` (SELECT, `bucket_id='website-media' and is_admin_or_super()`). There are no INSERT, UPDATE or DELETE Storage policies, and the other 8 buckets keep their visibility (only `branding` is public).
- **Functions:** 25 `website_*` functions plus 4 trigger functions. All are owned by `postgres` with `search_path=public, pg_temp`, and all `website_*` management and helper functions are SECURITY DEFINER.
- **Triggers:** updated-at, revision immutability, slug-history append-only, document guard and insert guard.
- **Audit:** 0 website audit rows.

**Migration 40 — absent on DEV:**
- `website_discard_unpublished_document(uuid, integer)`, together with its `revoke … from public, anon, authenticated` and `grant … to authenticated`.

**Effective EXECUTE in the current partial state** (from `has_function_privilege` and the ACL):

| Group | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| 17 management functions (`website_create_*`, `_update_*`, `_reorder_*`, `_set_*`, `_change_program_slug`, `_save_draft`, `_restore_revision`, `_publish_*`, `_unpublish_*`, `_register_media_asset`, `_save_batch_publication`) | no | no | **yes** (each self-checks `website_assert_manager()`) | yes |
| 8 internal helpers (`website_assert_manager`, `_clean_text`, `_is_safe_href`, `_is_valid_slug`, `_allowed_section_types`, `_validate_sections`, `_audit`, `_insert_revision`) | no | no | no | **yes** |
| 4 trigger functions | no | no | no | yes |

**Migration 41 — entirely absent on DEV:** no `guard_program_delete`,
`programs_guard_delete` trigger, `program_deletion_blockers(_internal)` or
`delete_archived_program`.

**Program DELETE on DEV (unchanged from migration 14):**
- `programs_delete_admin` is in force: DELETE to `{public}` using `is_admin_or_super()`.
- Table ACL: `anon`, `authenticated` and `service_role` all hold `arwdDxtm`, which includes DELETE and TRUNCATE.
- The only trigger on `programs` is `programs_set_updated_at`.

**Foreign keys to `programs` on DEV:** `assignments` (CASCADE), `batches` (RESTRICT), `certificates` (RESTRICT), `enrollments` (RESTRICT), `leads` (SET NULL), `materials` (CASCADE), `program_modules` (CASCADE), and new `website_documents` (RESTRICT). New FK to `batches`: `batch_website_publications` (RESTRICT).

**What the earlier fingerprints prove:** the ten fingerprints matched the local build only for the **applied portion**: the 25 present functions plus trigger functions, constraints, indexes, policies, triggers, columns, grants, RLS flags and the bucket. They do **not** show that DEV matches the complete migrations 40 and 41.

**Exposure and operational limitations of the partial state** (it is not harmless):
1. **TI-1 is open on DEV.** Any active Admin or Super Admin session can DELETE a Program through the REST API. That silently cascades into modules, program-level materials and assignments, nulls `leads.program_id`, and leaves Storage files behind. Only Programs with Batches, enrollments, certificates or website documents are protected, by RESTRICT.
2. **Website write functions are live with no UI.** DEV Admin and Super Admin sessions can already create, edit and publish website data through RPC. This is audited and private (no public read path), but it is reachable outside any reviewed screen.
3. **Missing discard function.** Never-published drafts cannot be discarded, so a never-published Program document created now would keep blocking that Program's deletion until migration 40 is complete.
4. **Migration-history drift.** 40 objects exist without a history row. `supabase db push` / `npm run db:migrate` against DEV would re-run migration 40 and fail (`trigger … already exists`), which blocks the CLI path until reconciled.
5. **No Program deletion function on DEV.** The 22A safeguards cannot be tested there.
6. **`service_role` retains EXECUTE on internal helpers** (Supabase default grants), including `website_insert_revision` (skips validation and authorization) and `website_audit` (writes arbitrary audit rows). `service_role` already has full table privileges and bypasses RLS, so this adds no new capability, but it is unnecessary surface. Recommended: revoke it.
7. **TRUNCATE.** `anon` and `authenticated` hold TRUNCATE on `programs` and the other existing tables (pre-existing Phase 24 item). PostgREST does not expose TRUNCATE, and TRUNCATE bypasses row triggers, including the planned guard.
8. **The repository's generated types describe complete 40 and 41**, which DEV does not have. No application code calls these functions yet.

**Status of earlier connector requests:** the connector's own approval queue
cannot be read from here. Database evidence (latest check during this review)
is: no history row for 40 or 41; the discard function is absent; no
`programs_guard_delete`; no in-progress or idle-in-transaction session touching
these objects. So, as of now, **none of the timed-out or cancelled requests
executed**:

| Request | Status | Effect if it were approved late |
|---|---|---|
| Full `apply_migration` of 40 | Timed out | Fails at an existing trigger (atomic no-op) |
| Part "4" via `execute_sql` | Timed out | Would complete 40 **and** insert its history row |
| Part "4a" via `execute_sql` | Timed out | Would create the discard function with Supabase default grants (anon and authenticated EXECUTE; the function self-checks) |
| Final remainder | **Cancelled** | Not pending |

**Recommended:** check the Supabase connector or claude.ai approval UI and
decline any prompt still pending for those requests. The proposed script's
precondition block refuses to run if either of those late executions has
happened (function count or history no longer as expected).

## 2. Proposed recovery script (for review; NOT to be executed as-is — see §7)

| Item | Value |
|---|---|
| File | `phase22a-dev-remainder.sql` (sent with this review) |
| SHA-256 | `5bd38ec1755bdb59d2d424932f9dc28edccf4069f57f81efc050b291d90ad422` (373 lines, 17,940 bytes) |
| Source commit | `8ec1be6d69ed583389830505ca3299c4dab2ddec` |
| Sources | `supabase/migrations/20260101000040_website_content_foundation.sql` (SHA-256 `e7f87f8a…c13b837`; the `website_discard_unpublished_document` definition is byte-identical) and `supabase/migrations/20260101000041_program_deletion_safeguards.sql` (SHA-256 `8b3bd346…3ad8e`; included verbatim) |

**Preconditions, checked inside the transaction by the `$guard$` block:**
- no history row for `20260101000040` or `20260101000041`;
- exactly 25 `website_*` functions in `public` (that is, the discard function is absent).

Otherwise it raises and nothing changes. **Recommended additions:** also
assert that `programs_delete_admin` exists, `programs_guard_delete` does not,
the 7 tables exist, and the history count is 39.

**Objects created or changed:**

| Source | Change |
|---|---|
| 40 | Create `website_discard_unpublished_document(uuid, integer)`; revoke EXECUTE from PUBLIC, anon, authenticated; grant to authenticated |
| 41 | `drop policy if exists programs_delete_admin`; `revoke delete on programs from anon, authenticated` |
| 41 | Create `guard_program_delete()` and trigger `programs_guard_delete` (BEFORE DELETE) |
| 41 | Create `program_deletion_blockers_internal(uuid)` (no API execute) |
| 41 | Create `program_deletion_blockers(uuid)` and `delete_archived_program(uuid, text, text)` (EXECUTE: authenticated only; each self-checks an active Super Admin) |
| 41 | Comments on functions |

**DELETE in function bodies vs. deletions at run time:**
- **Function definitions that contain DELETE:** `website_discard_unpublished_document` (`delete from website_documents …`) and `delete_archived_program` (`delete from programs …`). These run only when someone later calls them; creating them deletes nothing.
- **Statements that delete data when the script runs: none.** No `DELETE` or `TRUNCATE` is executed. The only `DROP` removes one RLS policy (a permission change, not data). The only row writes are the two `schema_migrations` inserts.

**History reconciliation:** two rows are inserted **in the same transaction**
as the objects they describe. `20260101000040` is recorded only together
with the creation of the last missing 40 object, so 40 is genuinely complete
when its row commits. `20260101000041` is recorded with all of 41.
Nothing is marked applied without its objects.

**Postconditions:**
- 41 history rows (latest `20260101000041`);
- 26 `website_*` functions;
- `programs_delete_admin` absent;
- DELETE on `programs` revoked from anon and authenticated (service_role keeps the table privilege but is refused by the trigger);
- `programs_guard_delete` present;
- `program_deletion_blockers` and `delete_archived_program` executable by authenticated only;
- Program, Batch, audit and Storage data unchanged.

**If the transaction fails:** everything rolls back (one explicit
`begin … commit`; an error aborts it and the final `commit` becomes a
rollback). DEV stays in today's partial state.

**Duplicate or late execution:** a second run refuses ("already applied").
If any earlier timed-out request is approved late, the function count or
history no longer matches and the script refuses. `create trigger
programs_guard_delete` would also fail on a duplicate, so it cannot apply
twice. The script contains no retry logic.

**Why it should not be executed unchanged:** it would apply migration 41
exactly as committed, including the two weaknesses in §4–§5. The
recommended path (§7) corrects 41 first, then regenerates and re-checksums
this script for a fresh approval.

## 3. Current privilege and security findings (summary)

| Area | Finding |
|---|---|
| Website tables (DEV) | Private as designed: Admin/Super Admin SELECT only, no write path except the self-checking functions, anon no privilege |
| Website functions (DEV) | No PUBLIC or anon EXECUTE; authenticated EXECUTE only on the 17 self-checking management functions; internal helpers not callable by API sessions; `service_role` can call everything (default grants), recommended revoke for the internal helpers |
| `website-media` (DEV) | Private bucket, Admin SELECT only, no write policies; other buckets unchanged |
| Program DELETE (DEV) | **Broad Admin DELETE still live (TI-1 open)**; cascades possible |
| Program DELETE (branch, migration 41) | No direct DELETE for API roles; guard marker is forgeable by any SQL session that can run as a role holding the DELETE privilege (§5) |
| Deletion eligibility (branch) | Misses history whose enrollment/Batch/payment rows were removed by a privileged path and whose surviving audit rows do not name the Program (§4) |
| Page copy (branch) | No storage for the Programs-listing or Upcoming-Batches page copy (§6) |

## 4. Program-history eligibility

**Rule (design §7.2):** Programs with training or financial history stay
protected, including history known only from audit evidence. "No current
dependent rows" is not proof of "never used". If eligibility cannot be
established, deletion stays blocked.

**How the committed migration 41 works:**
- **Live dependents:** any live row with an FK to `programs` blocks (enrollments, Batches, certificates and everything beneath them).
- **Audit evidence:** blocks only when an audit row names the Program by id or `program_code`. That covers `enrollment.create` (`programId`) and program-level `material.create` (`scopeId`).

**Gap — reproduced in a disposable local database:**
1. An archived Program has an enrollment that was inserted without an `enrollment.create` audit row.
2. Payment and certificate audit rows exist that name only `enrollmentId`, which is how the application records them.
3. The enrollment row is then removed by a privileged path (service role or SQL).
4. Result: `program_deletion_blockers` returned `dependency:enrollments` before step 3 and **`none` after it**, even though payment and certificate history exists.

Likewise, `batch.*` and `class_session.*` audit rows do not name the Program,
so a deleted Batch's history is unattributable.

**On DEV (read-only counts; no records printed):**
- 33 audit rows record payments, payment plans, an instalment edit and certificate issue/reissue for **22 enrollments that no longer exist** and have no surviving record naming their Program. This is most likely residue from earlier synthetic-fixture cleanups.
- All of these rows postdate both DEV Programs, so neither Program could be shown to be unrelated to them.
- 0 orphaned Batch audit entities.
- DEV's archived Program still has 2 live Batches and 6 enrollments, so the committed rule would block it anyway. **The gap is real in general, but not reachable for DEV's current Programs.**

**Smallest proposed correction** (prototyped and tested locally; file
`proposed-history-correction.sql`):
- **(A) Delete-evidence trigger.** `record_program_history_on_delete()`, BEFORE DELETE on `enrollments`, `batches` and `certificates`, writes `audit_logs` (`<table>.row_deleted`, `before_data = {programId}`) on every deletion by any path (application, service role or SQL). This changes no policy or privilege and adds an audit side effect only. **Batch deletion stays allowed exactly as today.** The existing `audit_history` check then blocks the named Program automatically.
- **(B) `unattributable_history` blocker.** It considers audit evidence referring to an enrollment, Batch or payment that no longer exists, where no surviving record ties it to a Program. Such evidence blocks every Program created on or before the evidence timestamp. This is the fail-closed case for history removed before (A) existed, or with triggers disabled.

**Local results:**

| Scenario | Result |
|---|---|
| Pre-trigger residue | Blocks the Program that existed (count 1) |
| Deletion after the fix | Recorded with `programId` and blocked as `audit_history` |
| Program created after the evidence | Not blocked (count 0) |

**On DEV**, (B) would block both existing Programs, the archived one included (33 rows). That is the intended fail-closed outcome.

**Known limits that remain:**
- (A) can be disabled by a database owner.
- Deletions of other dependent rows (payments, plans, receipts, refunds) are already prevented or restricted by FKs and policies; (B) still treats unresolved `paymentId` references as unattributable.
- Learning-content-only history (program modules or materials later deleted) blocks only where the audit row names the Program (program-level `material.create` does).

**Authorization needed:**
- (A) adds triggers to the existing `enrollments`, `batches` and `certificates` tables. This changes no permission but is outside the "Program DELETE narrowing" already authorized.
- (B) changes migration 41's eligibility function.
- Both require approval, plus a decision on where they go: amend the unapplied migration 41 (recommended; it is applied nowhere) or add a new migration 42.

## 5. Transaction-marker guard (`roicians.program_delete_authorized`)

Any role can set a custom dotted setting. No privilege is needed; for
example, `set_config('roicians.program_delete_authorized', '<id>', true)`
succeeds even for `authenticated`. The marker therefore **does not prove**
entry through `delete_archived_program()`.

**Disposable local test** (migrations 1–41; the session sets the marker itself, then runs `DELETE`):

| Session | Result |
|---|---|
| anon / Student / Trainer / Admin / Super Admin (role `authenticated`) | `permission denied for table programs` (DELETE privilege revoked by 41) |
| service_role SQL session | **DELETE 1: bypass.** With a module attached, the module was **silently cascade-deleted** and no eligibility check ran |
| service_role **without** marker | Refused by the guard |
| Database owner (`postgres`) | DELETE 1 (expected; the owner can also disable triggers) |

**What this means on DEV:**
- App sessions cannot reach the bypass: they have no DELETE privilege after 41, PostgREST cannot set arbitrary settings, and no public function calls `set_config`.
- `service_role` is NOLOGIN. It is reachable only through PostgREST (which cannot set the marker) or by an administrative login (`postgres`, `supabase_admin`, `authenticator`) switching roles.
- In practice, only holders of database credentials could forge the marker. Those are trusted administrators who can bypass any in-database control, so this is a **limitation, not a protection** against unrestricted administrators.

**Proposed correction** (prototyped locally): the guard also requires
`current_user` to equal the owner of `delete_archived_program()`. Because
that function is SECURITY DEFINER, `current_user` is its owner only inside
it.

**Prototype results:**
- service_role with a forged marker: refused.
- The legitimate Super Admin workflow: still deletes.
- The owner session: can still bypass. This is documented, not fixable in-database.

Optional hardening: replace the setting with a row in a private table that
only the definer can write.

## 6. Local vs real DEV verification, and the missing page-copy storage

**Local proof covered:** PostgreSQL 16 with repository stubs (`auth.uid()`
from a setting; minimal `storage` tables; stub default grants), plus real
concurrent connections. **Not covered:** PostgreSQL 17, the real Supabase
Auth/Storage/PostgREST stack, hosted default privileges (for example
`service_role` grants, `postgres` being non-superuser with BYPASSRLS), and
connector behaviour.

**Proposed post-recovery DEV verification** (requires explicit
authorization; nothing has been run):
1. **Catalog:** 41 history rows; fingerprint **all** 40 and 41 objects (functions including discard and the 41 functions, triggers including `programs_guard_delete`, policies with `programs_delete_admin` absent, `programs` ACL without DELETE for anon and authenticated, EXECUTE matrix) against a local build of the approved commit.
2. **Functional checks in one transaction that ends in ROLLBACK** (no residue). Synthetic `auth.users`, `user_roles` and `admins` rows with fixed ids (prefix `22adev…`) and explicit codes, so no sequence defaults are consumed. Then, via `set local role` and `request.jwt.claims`:
   - anon, Student, Trainer and inactive Admin see 0 rows and get 42501 on writes;
   - Admin creates a page, saves a draft (private) and publishes; a stale save and stale publish give P2203;
   - restore creates a new revision; the draft media asset is refused at publish;
   - Admin direct `DELETE from programs` → permission denied;
   - Super Admin on an unarchived synthetic Program → P2201 `not_archived`;
   - synthetic archived Program with a module → `dependency:program_modules`;
   - synthetic Program with a payment audit row naming a removed enrollment → `unattributable_history` (after correction B);
   - eligible synthetic archived Program → deleted, with a `program.deleted` audit row and its routine audit rows retained (all inside the rolled-back transaction).
3. **Concurrency** stays proven locally only. The connector offers a single session, and a DEV race needs a separately authorized two-session harness.
4. **Afterwards:** re-check row counts (Programs, audit, website tables) and the sequence values recorded before the run.

**Programs-listing and Upcoming-Batches copy:** **not covered.** Migration 40's
`kind` values are `home`, `about`, `corporate_training`, `institutions`,
`contact`, `legal`, `navigation`, `footer` and `program`. The approved scope
(§5.1 "Program listings", §11 "Programs" and "Upcoming Batches") needs
editable intro, SEO and empty-state copy for both pages. Because migration 40
is already partly on DEV with this check constraint, the fix must be a
**forward migration**. It would add two single-instance kinds,
`programs_listing` and `upcoming_batches`, with sections hero, text, list,
faq, cta and banner, and update `website_allowed_section_types`,
`website_create_page`, the single-instance index, the TypeScript kind list and
the tests.

## 7. Remaining blockers and proposed fixes

| # | Blocker | Proposed fix | Needs |
|---|---|---|---|
| 1 | DEV migration 40 incomplete, 41 absent, history drift; TI-1 open on DEV | Regenerated, re-checksummed recovery script after fixes 2–4, fresh explicit approval, one execution | Owner approval of the exact script |
| 2 | Guard marker forgeable by SQL sessions holding DELETE (service_role) | `current_user` = owner of `delete_archived_program()` check in `guard_program_delete()` | Approval to amend migration 41 (unapplied) |
| 3 | History gap: deleted enrollments/Batches/payments unattributable | (A) delete-evidence trigger on enrollments/batches/certificates; (B) `unattributable_history` blocker | Approval (touches existing tables via triggers; no policy change) |
| 4 | No storage for Programs-listing / Upcoming-Batches copy | New migration 42 adding two page kinds | Approval |
| 5 | `service_role` EXECUTE on internal helpers | Revoke from `service_role` (with 2–4) | Approval |
| 6 | Recovery-script preconditions are minimal | Add the extra assertions in §2 | Part of 1 |
| 7 | Possible pending connector prompts | Owner checks and declines any pending prompts | Owner |

Not changed by this proposal: Batch deletion permission
(`batches_delete_admin`) stays as it is; narrowing it remains a separate
decision for 22B or Phase 24.

## 8. Precise next operation requiring approval

**Approve or adjust fixes 2–5** (amend the unapplied migration 41 and add
migration 42 on the branch, with tests), so I can implement them on the
branch, re-run the full local suites, then regenerate the DEV recovery
script with its new SHA-256 for a separate, explicit approval of that exact
script. No DEV write happens before that second approval.

Alternative, if you prefer to close TI-1 on DEV first: approve executing
`phase22a-dev-remainder.sql` with SHA-256 `5bd38ec1…90ad422` exactly as
reviewed, accepting that the §4 and §5 weaknesses would then be corrected
afterwards by a forward migration. I don't recommend this.

---
