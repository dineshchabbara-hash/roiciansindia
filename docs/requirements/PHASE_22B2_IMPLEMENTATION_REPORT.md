# Phase 22B-2: Implementation Report (Program Website Management)

**Date:** 2026-10-23.

**Branch:** `claude/phase22b2-program-website-management`, created from `main` at `ffeb31b` (Phase 22B-1 merged). Not merged.

**Status:** implemented and unit/component tested; awaiting owner acceptance.
- **Browser acceptance passed** on commit `6fc889a`: 16 of 16 (Phase 22B-1 and 22B-2 suites) against a disposable local Supabase stack in GitHub Actions run 39960977885.
- Display group archive and restore were added afterwards (§9). The commit containing them **needs its own acceptance run**.
- **Not done:** no migration, no SQL, no deployment, no DEV or production data change, no Phase 22B-3.

## 1. What was built

All screens are for Admin and Super Admin only, under `/admin/website`.

| Requirement | Screen | Behaviour |
|---|---|---|
| Program content, drafts, preview, publishing | `/admin/website/programs` and `/programs/[id]`, `/history`, `/preview` | Every LMS Program is listed with its website status. "Set up website content" creates an empty, unpublished entry with a web address (a suggestion from the Program's name, editable). The content editor is the 22B-1 editor: drafts, stale-edit protection, unsaved-change warnings, version history, restore and confirmed publish/unpublish. Nothing is copied from the LMS Program |
| Display groups | `/admin/website/groups` | Create, rename, describe, show or hide, and move up or down. A move submits the whole order that was shown, so a concurrent change is refused. **Archive and restore** (added after the first acceptance run, §9): archive is confirmed first; archived groups are listed separately with a Restore button |
| Featured Programs and order | `/programs/[id]/settings` and `/admin/website/featured` | Feature or unfeature a Program, set its group and order. Each change is confirmed first. The featured list can be reordered (confirmed) or a Program removed (confirmed) |
| Batch publication | `/programs/[id]/batches` | Per Batch: a public label and registration state (Open, Closed or Full), saved privately, then published or unpublished after confirmation. The internal Batch name is marked "never shown publicly". The preview shows only published labels and states |
| Role restrictions | All of the above | Page check, server-action check and database check (§3) |

**Navigation:** the Website area has tabs (Pages, Programs, Display groups, Featured Programs), and each Program has its own tabs.

## 2. How it is built

- **Reuse of Phase 22A database functions (no new SQL):**
  - `website_create_program_document`, `website_change_program_slug`, `website_update_program_placement`;
  - `website_save_draft`, `website_publish_document`, `website_unpublish_document`, `website_restore_revision`;
  - `website_create_display_group`, `website_update_display_group`, `website_reorder_display_groups`, `website_set_display_group_archived`;
  - `website_save_batch_publication`, `website_publish_batch`, `website_unpublish_batch`.
  - These check the active Admin/Super Admin role, enforce version checks and content rules, and write the audit log.
- **Reuse of Phase 22B-1 screens:** the editor, publication panel and history accept optional bindings (actions, paths, a held reason). Without bindings they behave exactly as before; the 22B-1 tests pass unchanged.
- **New modules:**
  - `lib/domain/website-programs.ts` (rules and labels);
  - `lib/data/website-programs.ts` (reads and writes on the user's own session);
  - `lib/actions/website-programs.ts` (server actions);
  - `components/admin/website/programs/*` (screens).
- **Shared changes:**
  - the 22B-1 history readers in `lib/data/website.ts` take an optional "program" scope;
  - the price check in `lib/domain/website.ts` is stricter (§3).

**Application rules stricter than the database:**

| Rule | Why | Enforced in |
|---|---|---|
| A published Program's web address cannot be changed, by Admin or Super Admin | Owner rule until redirects exist. The database would let a Super Admin change it (it reserves the old address for a redirect) | Settings screen (no field, reason shown) and the server action (refused before any database call) |
| Only a Program active in the LMS is sent to publication | Same as the database; refused earlier with a clear reason | Editor (Publish disabled, reason shown) and the server action |
| A Batch can only be managed from its own Program | Prevents cross-Program edits from a crafted request | Server action |
| Prices written as "Rs 4,999", "INR 50000" or "4,999/-" are refused | P22-09. The database refuses only the "₹" sign | Every website text field (pages, Programs, Batch labels) |

## 3. Security review

| Area | Finding |
|---|---|
| Access | **Anonymous:** every 22B-2 route redirects to `/login/admin` with no content (`307`, checked). **Student and Trainer:** sent to their own portal. **Inactive Admin:** treated as signed out (Phase 21C). **Server actions:** refuse non-Admins before touching data (unit tests: all 15 actions × Trainer, Student, no session). **Database functions:** refuse anyone who is not an active Admin or Super Admin |
| Privileged keys | None. Reads and writes use the signed-in user's session. A test fails if the data module imports the service-role client |
| Data minimisation | Only Program id, code, internal name and status, and Batch id, internal name, start date and status are read. A test fails if fee, tax, capacity, meeting link, location or notes columns appear in the data module. Nothing internal is shown in the preview or published |
| Caching and indexing | `proxy.ts` already sends `Cache-Control: private, no-store, max-age=0` and `X-Robots-Tag: noindex, nofollow, noarchive` for all `/admin/website/*`. Checked on all 8 new routes in the production build. The preview also has a robots `noindex` meta tag |
| Lost updates | Every write names the version the Admin was looking at. Stale writes are refused (unit tests, and browser test 7 with two editors) |
| Audit | Every change is audited by the database: created, draft_saved, published, unpublished, revision_restored, slug_changed, placement_updated, display group created/updated/reordered/archived/restored, and Batch publication draft_saved/published/unpublished. The application adds no audit rows |
| Content safety | Plain text only (no HTML), safe links only, no prices. Content is rendered as text |
| Input handling | Ids are checked as UUIDs; positions as whole numbers from 1 to 10000; JSON lists are checked for shape and size. Every value is re-validated by the database |
| Featured reorder | There is no all-at-once database function, so a move applies the changed positions one by one, each version-checked and audited. Nothing is written if the list changed since it was shown. If someone changes a Program in the middle of a move, the order can be left partly applied; the Admin is told to reload |

## 4. Owner safeguards

| Safeguard | Status |
|---|---|
| Preserve Programs, Batches, enrollments, payments, students, audit history | No writes to any LMS table. Browser test 1 checks the LMS Program row is unchanged after website work. Batch publication never changes the Batch's LMS status |
| No invented Program details; do not publish existing DEV Program content | The screens create nothing automatically. Opening them lists existing Programs read-only, as "Not created". Screenshots use clearly fictional "(sample)" data in a local stand-in, never DEV. Browser tests create synthetic records only in a disposable local stack |
| No public pricing or internal financial information | No fee fields are read, shown or editable; prices in text are refused (§2) |
| Published slugs not changed until redirect protection exists | Locked in the screen and the server action, for everyone (§2) |
| No new migrations | None. `supabase/migrations/` is unchanged |
| No media upload, Program deletion screens or public website | None built. Discard of never-published website content is also not exposed |
| Legal-page database safeguard | Still a separate, unapproved proposal (`docs/proposed-migrations/legal_publication_hold.sql`) |

## 5. Test results (this sandbox, 2026-10-23)

| Check | Result |
|---|---|
| Typecheck | Pass |
| Lint | Pass: 0 errors (the 4 warnings were already on `main`) |
| Prettier, every changed file | Pass |
| Full unit and component suite | **151 files, 1,915 tests, all pass, none skipped** (`main` at the start: 146 files, 1,818 tests) |
| New 22B-2 tests | Domain rules; data layer, including column privacy; all 15 actions, including the role matrix; screens; and the editor and history bindings |
| Production build | Pass. All 12 Website routes are dynamic |
| Browser walkthrough (production build, local stand-in) | Every screen loads with no console errors. Confirmed: published address locked, placement saved after confirmation, Batch published as "… · Full", completed Batch cannot be published, inactive Program cannot be published, featured reorder applied, preview shows no internal Batch names |
| 22B-2 browser spec, **local dry run** (not acceptance) | 8 of 8 ran and passed |
| 22B-1 browser spec on this build, local dry run | 8 of 8 ran and passed (regression) |
| Browser acceptance against a real isolated Supabase stack | **Passed on `6fc889a`:** 16 of 16, none skipped, failed or retried (run 39960977885). The §9 commit needs a new run |

## 6. Browser acceptance

- **Specs:** `e2e/phase22b2-program-website.spec.ts` (8 tests) with `e2e/support/phase22b2-fixtures.ts`.
- **Isolation:** they run only when `PHASE22B_E2E_ISOLATED=1` and the Supabase URL is local; the fixtures refuse any other database.
- **Workflow:** a 22B-2 version of the reviewed workflow (not committed) runs the 22B-1 and 22B-2 specs together and requires exactly 16 of 16 to pass. It can be run the same way as the 22B-1 acceptance run, against an approved commit of this branch.

## 7. Remaining issues

1. **Browser acceptance** passed on `6fc889a` (run 39960977885). The archive and restore commit (§9) needs a new run.
2. **Published slugs are locked only in the application.** A Super Admin calling `website_change_program_slug()` directly can still change one; the database then keeps the old address for a future redirect.
3. **Featured reorder is not atomic** (§3). An atomic database function would need a migration and separate approval.
4. **The database refuses only the "₹" sign for prices;** the stricter check is application-only.
5. **Which Batches the public page lists** (for example, active Batches) is the open TI-3 decision. The preview shows all published Batches.
6. ~~Display groups can be hidden but not archived.~~ **Done** (§9): archive and restore are on the Display groups screen.
7. **Program order within a group** is a number field, not drag and drop.
8. **Editor names:** an ordinary Admin sees other editors as "an admin" (RLS, as in 22B-1).
9. **Images:** cannot be edited until 22B-3 (media).
10. **Legal-page database guard:** separate and unapproved; legal pages remain held in the application only.
11. **Hosting** is not decided (Hostinger or Vercel). Response headers must be rechecked on the chosen host.

## 8. Confirmation

- `main` unchanged; nothing merged.
- **DEV and production:** no SQL, no migration, no deployment, and no website, Program, Batch, group or audit records created.
- **Not started:** Phase 22B-3.

## 9. Display group archive and restore (completion work)

Added after the first acceptance run (GitHub Actions run 39960977885, which tested `6fc889a`), as a missing approved requirement.

| Requirement | How it works |
|---|---|
| Archive and Restore on the Display groups screen | Each active group has "Archive…". Archived groups are listed separately under "Archived groups" with the date and a Restore button |
| Reuse the Phase 22A function | `website_set_display_group_archived()` only. No migration |
| Confirmation before archiving | "Archive…" opens a confirmation; Cancel changes nothing |
| Groups holding Programs cannot be archived | The Archive button is disabled with the reason ("first move its Programs to another group, or hide the group instead"). The server action re-reads the group and refuses with the same explanation, and the database refuses too. The Programs keep their group |
| Duplicate names on restore | If an active group uses the name, Restore is disabled with the reason. If the name was taken after the page was opened, the database refuses and the Admin is told to rename or archive the active group first. Nothing is restored |
| Restored group | Goes last in the display order (database rule) and keeps its visibility setting |
| Roles, stale protection, audit | Admin and Super Admin only (page, server action and database). The version the Admin saw is sent, so a concurrent change is refused. The database records `website_display_group.archived` and `website_display_group.restored` |
| Program assignments and LMS records | Archive is refused while a group holds Programs, so no assignment changes. No LMS table is written |

**Tests:** domain rules, data layer, both actions (including the role matrix, now 17 actions), the screen, and browser test 6, extended without removing any of its earlier checks: archive with confirmation and Cancel, refusal while the group holds a Program (from a second Admin's out-of-date page), refusal to restore over an active group's name (also from an out-of-date page), and restore after the name is freed, with the database state and audit checked at each step.

