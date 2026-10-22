# Phase 22A — Website Data Foundation and Program-Deletion Safeguards: Implementation Record

**Status: Implemented on branch; DEV recovered; structural and functional verification passed on DEV; ready for owner acceptance; not merged.**

> **Real-DEV functional verification passed (owner-run, recorded 2026-10-22).**
> The checksum matched; pre-test step E was 36/36; the run completed and ended in
> ROLLBACK with exit code 0; post-test step E was 36/36; existing data was unchanged
> and no sequence moved. See
> [`docs/recovery/PHASE_22A_DEV_RECOVERY_RECORD.md`](../recovery/PHASE_22A_DEV_RECOVERY_RECORD.md) §4, §5 and §7.

> **DEV recovery completed (recorded 2026-10-21).** The owner ran the reviewed
> recovery script (SHA-256 `018f460f…a562`) once from Windows PowerShell with
> psql over verified TLS. Checks B 7/7, C 30/30, D committed (exit 0), E 36/36.
> An independent read-only check confirmed that DEV's Phase 22A schema matches a
> clean install of migrations 1–42, and that existing data and audit history
> are unchanged. Evidence:
> [`docs/recovery/PHASE_22A_DEV_RECOVERY_RECORD.md`](../recovery/PHASE_22A_DEV_RECOVERY_RECORD.md).
Branch `claude/phase22a-website-foundation`; **not** merged to `main`.
Phase 22 is not complete; stages 22B–22J have not started.

> **Corrections (2026-10-20, migration 42).** The original migration 41 had two
> acknowledged weaknesses: a Program-history gap, and a deletion marker that a
> `service_role` SQL session could forge. Migration 40 also had no storage for
> Programs-listing / Upcoming-Batches page copy, and `service_role` kept
> EXECUTE on internal helpers. All four are corrected **forward** by
> `20260101000042_phase22a_corrections.sql`. Migrations 40 and 41 are
> unchanged. The corrections are locally verified and, since the DEV
> recovery, **structurally and functionally verified on DEV**.
> Details, tests and the DEV recovery proposal:
> [`docs/recovery/PHASE_22A_RECOVERY_REVIEW.md`](../recovery/PHASE_22A_RECOVERY_REVIEW.md).
> Where this record describes migration 41 below, migration 42 now adds:
> - delete-evidence triggers on enrollments, Batches and certificates;
> - the `unattributable_history` blocker;
> - an owner-context check in `guard_program_delete()`;
> - an immutable `programs.created_at`;
> - the `programs_listing` and `upcoming_batches` page kinds;
> - `service_role` revoked from the 17 internal helpers.

| Item | Value |
|---|---|
| Authority | [`PHASE_22_APPROVED_DESIGN.md`](PHASE_22_APPROVED_DESIGN.md) §5, §7, §8, §9, §14–§16 |
| Starting point | `main` = `9184c82`; migrations 1–39 |
| New migrations | `20260101000040_website_content_foundation.sql`, `20260101000041_program_deletion_safeguards.sql`, `20260101000042_phase22a_corrections.sql` (forward corrections) |
| Database enforcement for Program deletion | Implemented in migrations 41 + 42 and tested locally (PostgreSQL 16 and 17.6). **Applied to DEV** by the recovery (see "DEV status"). Production still has the old broad delete |
| Super Admin deletion screens (review, reason/confirmation, blocked explanations) | **Not implemented**; Phase 22B |
| Public reads of website content | **Not implemented**; Phase 22C. No public read path exists |

## 1. Data model (migration 40)

Website data lives in **new tables only**. No column was added to
`programs` or `batches`. Students and Trainers can already read whole
`batches` rows (`batches_select_student` / `_trainer`), and any signed-in
user can read non-draft `programs` rows (`programs_select_published`).
Adding columns there would have exposed them, so the website data is kept
in separate tables (a test asserts both column lists are unchanged).

| Table | Purpose |
|---|---|
| `website_display_groups` | Admin-managed Program groups: name, description, `display_order`, `is_visible` (hide), `archived_at` (archive/restore), `version`. No enum; active names are unique, case-insensitive. Not seeded. |
| `website_documents` | One row per managed page or Program. `kind` ∈ home, about, corporate_training, institutions, contact, legal, navigation, footer, program; `page_key` is unique; home, about, corporate_training, institutions, contact, navigation and footer are single-instance. A Program document (`kind = 'program'`) has a unique `program_id` (FK RESTRICT), a unique public `slug`, and placement: `display_group_id`, `is_featured`, `featured_order`, `display_order`. Holds pointers `latest_revision_id` / `published_revision_id` (each must be one of the document's own revisions), publication timestamps and actors, a permanent `first_published_at`, and `version`. |
| `website_document_revisions` | Immutable content snapshots: `title` (the Program headline), `summary`, `seo_title`, `seo_description`, `social_title`, `social_description`, `hero_image_asset_id`, `social_image_asset_id`, structured `sections` (jsonb), `restored_from_revision_id`, `created_by`/`created_at` (editor identity). A trigger refuses every UPDATE. |
| `website_revision_media` | Which media assets each revision uses, from both image columns and `imageAssetId` values inside sections. An asset cannot be removed while any revision references it. |
| `website_program_slug_history` | Previous slugs, recorded once a Program has been published. Append-only (trigger); an old slug can never be reused by any Program. |
| `website_media_assets` | Metadata for images in the new **private** `website-media` bucket. Path is `<uuid>/<file>`; JPEG, PNG or WebP up to 5 MB; `status` draft → approved (alt text required) → retired. |
| `batch_website_publications` | One row per Batch (FK RESTRICT). Holds a private draft label and draft registration state (open / closed / full), `is_published`, the published label and state, publication timestamps and actors, `first_published_at`, and `version`. It is separate from the operational `batches.status`. There is no Batch-level Coming Soon state and no capacity, count, meeting link, location, notes, Trainer or internal name. |

**Not duplicated:** Program name, duration, delivery mode and fees stay in
`programs`. No fee, price, tax or capacity column exists in any website
table (a test checks this).

**Structured content only** (`website_validate_sections`):
- **Section shape:** each section is `{key, type, visible, heading?, body?, imageAssetId?, cta?{label, href}, items?[{title|text|question|answer|label|href}]}`. Order is the position in the array. Section and item types are allow-listed per page kind, and unknown fields are rejected.
- **Text rules:** every text field has a length limit. HTML-like tags (`<x`, `</`, `<!`) and the ₹ symbol are rejected.
- **Links:** only a site path (`/…`, not `//`), an `https://` URL, `mailto:` or `tel:` is accepted.
- **No HTML or scripts:** there is no HTML field, no script field and no page builder.

## 2. Permissions

- **Read access:** every new table has RLS on, with a single SELECT policy, `is_admin_or_super()`.
- **No direct writes:** there are no INSERT, UPDATE or DELETE policies, and direct write privileges are revoked from `anon` and `authenticated`. Anonymous callers have no privilege at all.
- **Writes go through functions:** every write is a SECURITY DEFINER function granted to `authenticated` only. Each one checks the caller's own session through `is_admin_or_super()` or `is_super_admin()`, which already exclude inactive Admins (migration 39). No function accepts a caller-supplied actor.
- **Internal helpers are locked:** helpers and trigger functions cannot be executed by `anon` or `authenticated`.
- **Trainers, Students and inactive Admins** read zero rows and every mutation returns 42501.
- **Unchanged areas:** Company Settings, account management, the existing Program archive/restore (`programs_update_admin`) and all LMS reads are untouched.
- **Storage:** `website-media` is private, with an Admin SELECT policy only. There is no upload, update or delete storage policy yet; uploads come with the 22B editor. Existing buckets keep their visibility, and a test asserts the full bucket list.

## 3. Drafts, publication, restoration and concurrency

| Function | Behaviour |
|---|---|
| `website_create_display_group`, `website_update_display_group`, `website_reorder_display_groups`, `website_set_display_group_archived` | Create; rename/describe/hide; reorder all active groups (the list must match the current set exactly); archive/restore. A group still holding Programs cannot be archived (hiding is always allowed). |
| `website_create_page(kind, page_key)`, `website_create_program_document(program, slug)` | Create documents. A Program document needs a valid, unused, never-reserved slug and a non-archived Program. |
| `website_save_draft(doc, base_revision_number, …)` | Validates and inserts a new revision. `base_revision_number` must equal the latest revision number (0 for the first save), otherwise P2203 (stale). Published content is never touched. |
| `website_publish_document(doc, revision_id)` | Publishes only the latest revision; naming an older one is stale (P2203). Program documents require an `active` Program. Every referenced image must be approved. Records `published_at`/`published_by` and, the first time, `first_published_at`. |
| `website_restore_revision(doc, source_revision, base)` | Copies the content columns of one of the document's own revisions into a **new** revision (`restored_from_revision_id`), re-validated against current rules. It still needs an explicit publish. |
| `website_unpublish_document`, `website_discard_unpublished_document` | Unpublish keeps all history. Discard removes a document and its drafts **only if it was never published**; a trigger also refuses deleting any ever-published document. |
| `website_change_program_slug` | Before first publication, Admin or Super Admin. After it, **Super Admin only**. The `website_documents` trigger enforces this for every writer, including direct SQL and the service role, and records the old slug in the history table. Slugs are not part of revision content, so saving, restoring or publishing content cannot change them. |
| `website_update_program_placement` | Group, featured flag and ordering are live arrangement settings, versioned and audited. They affect the public site only for published Programs (22C). |
| `website_register_media_asset`, `website_update_media_asset` | Register metadata (draft); approve (alt text needed), withdraw or retire. An image used by currently published content cannot be withdrawn or retired. |
| `website_save_batch_publication`, `website_publish_batch`, `website_unpublish_batch` | Edit the draft label and state (version 0 creates the row); publish copies draft to published (only `upcoming` or `active` Batches, label required); unpublish. `batches.status` is never written. |

**Lost-update prevention:**
- **Content:** saves name the base revision number.
- **Metadata:** edits name the row `version` they read.
- **Locking:** each function locks its row (`FOR UPDATE`), so concurrent editors serialize and the second one gets P2203.
- **Proof:** the concurrency script exercises this with real interleavings (§6).

**Audit:**
- **What is logged:** every change writes an `audit_logs` row in the same transaction with the actor, role, action, entity, and minimal before/after values: ids, revision numbers, slug, label, state, status.
- **What is not logged:** content bodies (sections) are never copied into audit.
- **Actions:**
  - `website_display_group.*`
  - `website_document.{created, draft_saved, revision_restored, published, unpublished, discarded, slug_changed, placement_updated}`
  - `website_media_asset.*`
  - `batch_website_publication.*`

**Error codes:**

| SQLSTATE | Meaning |
|---|---|
| 42501 | Not allowed |
| P2203 | Stale edit |
| P2204 | Not found |
| P2205 | Slug taken or reserved |
| P2206 | Invalid state |
| 22023 | Validation failed |
| 23505 | Duplicate |
| P2201 | Deletion blocked |

## 4. Program deletion safeguards (migration 41) — database enforcement

- **No direct delete:** `programs_delete_admin` is dropped and DELETE on `programs` is revoked from `anon` and `authenticated`. Admins, and every other API role, now get "permission denied" on a direct delete.
- **`programs_guard_delete` trigger:** refuses any Program delete, including by the table owner or the service role, unless `delete_archived_program()` has authorized that exact Program id within the current transaction.
- **`program_deletion_blockers(program)`:** active Super Admin only, read-only. Returns every blocker for the 22B review screen.
- **`delete_archived_program(program, confirmation_code, reason)`**, the only deletion path:
  1. The caller's session must be an active Super Admin.
  2. A reason is required (at most 500 characters).
  3. The Program row is locked `FOR UPDATE`.
  4. The typed confirmation must equal `program_code` exactly.
  5. All blockers are rechecked **under the lock**. If any exists, it raises P2201, nothing changes, and the detail lists the blocker codes.
  6. On success it writes a durable `program.deleted` audit row (actor, `super_admin`, Program id, code, name, prior status, created-at, reason, count of retained audit rows), then deletes. Nothing cascades, because every FK-dependent row is a blocker.
- **Concurrency:** any insert of a row that references the Program needs a KEY SHARE lock on it, so it either finishes first and is seen by the check, or waits and then fails its foreign key. A concurrent status change (restore) is serialized the same way.

**Blockers (any one blocks; no override):**

| Code | Meaning |
|---|---|
| `not_found`, `not_archived` | Program missing / not archived |
| `dependency:<table>` | Any row in **any** table with a foreign key to `programs`, discovered from the catalog at call time: `batches`, `enrollments`, `certificates`, `program_modules`, `materials`, `assignments`, `leads`, `website_documents`, and any future table. A multi-column FK is reported as `uncertain_dependency`. |
| `stored_file_reference` | `programs.thumbnail_path` is set (file cleanup not designed) |
| `stored_files` | A Storage object path contains the Program id (e.g. a left-over program-level material file) |
| `website_published_history` | The Program's website content was ever published (TI-7) |
| `website_link_reference` | A website revision links to `/programs/<slug>` for any slug the Program ever had |
| `audit_history` | Audit evidence beyond routine maintenance: any audit row naming the Program by id or code other than `program.create` / `program.update` / `program.status_change` on the Program itself, or never-published website drafting. For example, an `enrollment.create` that names it, or an unknown Program action. |

**Retained audit:** routine `program.create`, `program.update` and
`program.status_change` rows survive the deletion and do not block on their
own. Audit rows are never deleted or changed, and no sequence is reset.

## 5. TI-1 and TI-7

- **TI-1 (broad Program DELETE):** fixed **in the repository** by migrations 41 + 42 and proven locally (§6 and the recovery review). The original 41 guard alone was forgeable by `service_role` SQL sessions; migration 42 corrects that. TI-1 is **closed on DEV**: the recovery applied 41 and 42, and `programs_delete_admin` is gone. It is still **open in production**, where 40–42 are not applied. It is fully resolved only once the branch is accepted and merged and the migrations reach production through a separately authorized deployment.
- **TI-7 (previously published Programs):** a temporary implementation restriction, not a change to the business rule. Any Program whose website content was ever published stays blocked (`website_published_history`; ever-published documents cannot be removed). Safe handling of old slugs, redirects, website references and owned or shared public assets is still to be designed and verified (22B and later). The rule itself remains "verified safe, unused archived Program" (design §7.3); it is not narrowed to "never published only".
- **Also temporary:** a Program that has a never-published website draft is blocked until that draft is discarded (`website_discard_unpublished_document`).

## 6. Tests

| Category | What | Result |
|---|---|---|
| Local SQL (Postgres 16 + repo auth/storage stubs) | `supabase/tests/phase22a_website_foundation_test.sql`: 16 assertion groups W1–W11 and D1–D5 (privacy, grants, unchanged columns/buckets, groups, pages, slugs, content validation, draft/publish/restore, stale edits, media, placement, Batch publication, direct-write and owner bypass attempts, Trainer/Student/anon/inactive-Admin denial, audit, every deletion blocker, eligible deletion with audit, routine audit survives, TI-7) | Pass |
| Full local SQL/RLS suite | `scripts/test-rls.sh`: 21 files, 443 PASS notices | Pass, exit 0 |
| Local concurrency (real separate connections, forced interleavings; waits poll a lock-wait or output marker, never a fixed sleep) | `scripts/test-program-deletion-concurrency.sh`: 7 scenarios (module insert vs deletion both ways, restore vs deletion both ways, website document vs deletion, two editors from the same base, publish vs newer draft) | Pass. The five existing concurrency scripts also pass |
| Mutation checks (temporary, not committed) | Removing the row lock, the slug Super Admin check, or the audit-evidence check, or keeping `programs_delete_admin`, each makes a test fail | All four detected |
| Unit (Vitest) | `lib/domain/__tests__/website.test.ts`, `lib/validation/__tests__/website.test.ts`: 50 tests, including a check that the TypeScript section-type table matches the SQL | Pass. Full suite: 139 files / 1,660 tests at the time. On re-run (2026-10-21, 1,666 tests), one unrelated test (`components/admin/students/__tests__/student-form-duplicate-override-flow.test.tsx`) failed intermittently under parallel load; it passes alone. See the DEV recovery record §6 |
| DEV (real Supabase) | **Structural, after the recovery (confirmed 2026-10-21):** owner-run checks B 7/7, C 30/30, E 36/36. Independent read-only confirmation: schema fingerprint equals a clean install of 1–42, and existing data is unchanged. **Functional (owner-run, recorded 2026-10-22):** `phase22a_dev_post_recovery_verification.sql` completed; ROLLBACK, exit code 0; step E 36/36 before and after; no data or sequence change | Pass |
| Browser (Playwright) | Not run; no UI in this stage | Not applicable |

No existing test asserted the old broad DELETE, so no existing test was changed.

Commands (Linux SQL runner):

```bash
bash scripts/test-rls.sh                        # full SQL/RLS suite incl. Phase 22A
bash scripts/test-program-deletion-concurrency.sh
npm run test:rls:concurrency:program-deletion   # same script via npm
```

Cross-platform:

```bash
npm run typecheck && npm run lint && npx vitest run
```

## 7. DEV status (project `nqeaehqzhjhhgsilrgeo`)

**Current state (recorded 2026-10-21): migrations 40, 41 and 42 are applied, and their history is recorded.**

- **How:** the owner ran the reviewed recovery script `docs/recovery/phase22a_dev_recovery.sql` (SHA-256 `018f460fabad4d5d273035b295185a53827f5e6089161892f164470d6b21a562`) once. It ran from Windows PowerShell with psql, over TLS with certificate and hostname verification, following [`docs/recovery/manual_psql/`](../recovery/manual_psql/). The Supabase connector was not used for it.
- **Results:** identity check B 7/7; preflight C 30/30; recovery D committed, exit code 0; post-recovery check E 36/36.
- **Independent read-only confirmation (2026-10-21):**
  - History has 42 rows, ending with 40/41/42 under their migration names.
  - The 15-aspect Phase 22A fingerprint equals a clean install of migrations 1–42.
  - `programs_delete_admin` is gone, and anon/authenticated have no Program DELETE.
  - All 5 guard and evidence triggers are enabled.
  - The website tables are empty with RLS on; the bucket is private and empty.
  - Programs, modules, Batches, enrollments, students, payments, certificates and audit history are row-hash identical to the pre-recovery baseline.
- **Pending:** the real-DEV functional verification (`docs/recovery/phase22a_dev_post_recovery_verification.sql`, SHA-256 `bb3b3215…`). It needs the owner's separate approval.
- **Full record:** [`docs/recovery/PHASE_22A_DEV_RECOVERY_RECORD.md`](../recovery/PHASE_22A_DEV_RECOVERY_RECORD.md).

*History (superseded):*
- The first attempt applied migration 40 in verified parts, but missed one function (`website_discard_unpublished_document`) and wrote no history row.
- The connector request for the remainder did not complete.
- A later full-script connector request timed out after 60 s without a visible approval prompt. Nothing was committed.
- The cause of those connector timeouts is not established; a read-only query has also timed out since.
- The earlier remainder script (SHA-256 `5bd38ec1…`) was superseded and never executed.

## 8. Not in this stage

- No 22B or later work.
- No admin screens or deletion UI.
- No public website, routing, public read API or sitemap.
- No upload path.
- No Zoho, email, live payment or Canada work.
- No production change and no deployment.

## 9. Known limitations and items for 22B onwards

1. **22B:** Super Admin eligibility review, reason and Program-code confirmation screen, blocked explanations (`lib/domain/website.ts` already maps blocker codes to the §7.4 wording), the Website Management editor, preview (TI-6) and media upload.
2. **TI-7:** design safe handling of old slugs, redirects, references and public assets before a previously published Program can qualify.
3. **Batch deletion is unchanged:** `batches_delete_admin` (migration 14) still lets an Admin delete a Batch directly. Since migration 42, every Batch, enrollment or certificate deletion (any route) records `<entity>.row_deleted` naming the Program, so that Program stays blocked. History removed before migration 42 that cannot be attributed blocks every Program that existed at the time (`unattributable_history`). Narrowing Batch deletion itself remains outside 22A's authorization.
4. **TRUNCATE:** `TRUNCATE` bypasses row triggers. API roles hold default TRUNCATE grants (already noted for Phase 24), but `programs` cannot be truncated while referenced.
5. **TI-3:** the public "upcoming" rule is still open. Publishing allows `upcoming` and `active` Batches; 22C must also filter by status, and must hide Programs that are no longer active.
6. **Placement:** group and featured arrangement changes are live settings rather than drafts (design Proposal; reviewable in 22B).
