# Phase 22B-1: Implementation Report (Admin Website Management)

**Date:** 2026-10-22.

**Branch:** `claude/phase22b-website-management`. Not merged; `main` is unchanged at `83b7536`.

**Status:** implemented and unit/component tested, awaiting owner review.
- Browser (E2E) tests are written but **NOT RUN**, because the isolated runner is awaiting approval.
- **Not done:** no migration applied, no SQL executed, no deployment, and no DEV or production data touched.

**Specification:**
- [`PHASE_22B1_IMPLEMENTATION_HANDOFF.md`](PHASE_22B1_IMPLEMENTATION_HANDOFF.md)
- [`PHASE_22B1_SECURITY_AND_TESTING_GATES.md`](PHASE_22B1_SECURITY_AND_TESTING_GATES.md)
- [`PHASE_22B_PLAN.md`](PHASE_22B_PLAN.md) §4–§5

## 1. Admin screens

| Route | What it does |
|---|---|
| `/admin/website` | Every supported page with its status, last edit and last publication (see below) |
| `/admin/website/pages/[id]` | Structured editor (see below) |
| `/admin/website/pages/[id]/history` | Every saved version, with the live version and the latest draft marked, and "Restored from version N" shown. Restore (after confirmation) copies a version into a **new** draft; the latest version cannot be "restored" onto itself |
| `/admin/website/pages/[id]/preview` | Authenticated structured preview of the latest saved version, or `?revision=` from the history. Labelled "Preview: not public". Content is rendered as text only (no markup is ever interpreted), hidden sections are marked, and buttons show their target but are not links |

**Dashboard** (`/admin/website`):
- **Statuses:** Not created, Created (nothing saved), Draft, Published, Published with unpublished changes, Unpublished.
- **Pages:** one-per-site pages (Home, About, Corporate Training, For Institutions, Contact, Programs listing, Upcoming Batches, Navigation, Footer) are always listed and created in one click. Legal pages are created by key.
- **Legal hold:** each legal page shows "Publishing held: wording not yet approved".

**Editor** (`/admin/website/pages/[id]`):
- **Fields:** title, summary, sections, and search and social fields. Sections can be added, edited, hidden, reordered and removed, using only the section types the page supports. There is no HTML and no page builder.
- **Save draft:** shows a counter for every limited field. The browser warns before leaving with unsaved changes. On phones and tablets a save bar is pinned to the bottom of the screen.
- **Publish:** needs a confirmation. It is disabled with unsaved changes, before the first save, and for legal pages (reason shown).
- **Unpublish:** needs a confirmation.
- **Navigation:** links to the preview and the version history.

**Sidebar:** a new "Website" entry, shown to Admin and Super Admin.

Program pages (22B-2), media (22B-3) and deletion screens (22B-4) are not included.

## 2. How it is built

- **Reads:** `lib/data/website.ts`, through the signed-in user's own session (the Admin RLS read policies). No service-role key; a unit test fails if that module ever imports the service-role client.
- **Writes:** only the Phase 22A database functions `website_create_page`, `website_save_draft`, `website_publish_document`, `website_unpublish_document` and `website_restore_revision`. They re-check the active Admin or Super Admin role and the stale-edit guard, validate content, and write the audit log. The application writes no audit rows of its own.
- **Server actions** (`lib/actions/website.ts`):
  - check the role from the session;
  - validate with `websiteDraftSchema(kind)`, using the page type loaded from the database, never one sent by the browser;
  - return field errors by path.
- **Domain rules** (`lib/domain/website-admin.ts`): status, labels, the legal hold, messages and the section-editor helpers.
- **Response headers:** `proxy.ts` adds `Cache-Control: private, no-store, max-age=0` and `X-Robots-Tag: noindex, nofollow, noarchive` to every `/admin/website` response. The pages are rendered on demand (`force-dynamic`), and the preview also carries a robots `noindex` meta tag.

## 3. Security and role matrix

| Who | Pages (direct URL) | Server actions | Database (22A functions and RLS) |
|---|---|---|---|
| Anonymous | Redirected to `/login/admin` | Refused | No rows, no execution |
| Student, Trainer | Redirected to their own portal | Refused | No rows; `42501` |
| Inactive Admin | Treated as signed out (Phase 21C session rule), so redirected to login | Refused | `is_admin_or_super()` is false: no rows; `42501` |
| Admin, Super Admin | Allowed | Allowed | Allowed and audited |

**Evidence:**

| Layer | Status |
|---|---|
| Actions | Unit tests: every action refuses a Trainer, a Student and no session without touching data (`lib/actions/__tests__/website.test.ts`) |
| Inactive Admin | Phase 21C session test (`lib/auth/__tests__/session.test.ts`) |
| Database | The existing 22A SQL suites (`phase22a_website_foundation_test.sql` W10, `phase22a_corrections_test.sql`); not re-run in 22B-1, which adds no SQL |
| Browser | E2E spec test 1. NOT RUN |

## 4. Lost-update protection

- **Save:** every save sends the version number the editor started from. If someone saved first, the database refuses the save.
  - The user's text **stays on screen**, with a clear message.
  - They can open the latest version in a new tab, or deliberately "Save my version anyway…" (with a confirmation). Their version becomes the newest draft, and the other person's version stays in history.
- **Publish:** publishing names the exact latest version and is refused if a newer one exists.
- **Restore and unpublish:** both carry the expected version.

## 5. Legal pages: application-level hold only

- **What is enforced:** legal pages can be drafted, previewed and restored. Publish is disabled in the editor, and the server action refuses publication **before any database call**, for both Admin and Super Admin. Both are covered by unit and component tests.
- **Unresolved limitation:** this is **not** enforced by the database. A signed-in Admin who calls the Phase 22A function `website_publish_document()` directly, outside this application, could still publish a legal page; the call would be audited.
- **Proposal (not approved or applied):** a database-level, revision-specific approval guard is in [`../proposed-migrations/legal_publication_hold.sql`](../proposed-migrations/legal_publication_hold.sql), with a test and README notes.

The hold must not be described as fully enforced until a database guard is approved, applied and verified.

## 6. Test results (this sandbox, 2026-10-22)

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`) | Pass |
| Lint (`npm run lint`) | Pass: 0 errors. The 4 warnings are pre-existing, in `lib/actions/payment-plans.ts` |
| Prettier, every file changed in 22B-1 | Pass. `lib/domain/__tests__/certificates.test.ts` is already unformatted on `main`; it was not touched |
| Full unit and component suite | **145 files, 1,779 tests, all pass.** Baseline before 22B-1: 139 files, 1,666 tests. No test skipped or disabled |
| Production build (`next build`) | Pass. All four Website routes are dynamic (`ƒ`) |
| Production response headers, preview route | `Cache-Control: private, no-store, max-age=0`, `X-Robots-Tag: noindex, nofollow, noarchive`, `<meta name="robots" content="noindex, nofollow, nocache">` |
| Anonymous preview request | `307` to `/login/admin`; no draft content in the response |
| Browser console on the Website screens (production build) | No errors |
| E2E (`e2e/phase22b-website-management.spec.ts`) | **NOT RUN.** It runs only on an isolated local stack (`PHASE22B_E2E_ISOLATED=1` and a 127.0.0.1/localhost Supabase URL); the runner awaits approval |
| SQL/RLS suites | Not run. 22B-1 adds no database code; the user asked for no SQL execution |

**Intermittent test:** `student-form-duplicate-override-flow.test.tsx`, recorded earlier, passed in the final run. It was not skipped.

### How the screenshots and header checks were produced

**Local and isolated:**
- The real application, as a production build and in dev mode.
- A small **in-memory mock** of the Supabase Auth and REST endpoints these screens use, running on 127.0.0.1.
- Clearly fictional sample content.
- Every Supabase environment variable overridden to the mock, with the DEV database URL removed.

**What the mock does and does not mirror:**
- It reproduces the 22A rules that matter to the screens: stale save, publish and restore checks, publishing the latest version only, and version-checked unpublish.
- It is **not** a database test and does not replace the isolated E2E run.

**Clean-up:** the local build output was deleted afterwards, because it contained the mock settings.

**Two findings fixed during this work:**
- My earlier screenshot script's URL check matched `/login/admin` as `/admin`. The same flaw was in the E2E spec's role checks, which now match exact paths.
- On phones, Save draft was only at the bottom of the page. A pinned save bar was added.

## 7. Browser-test runner (proposal, not committed)

`docs/proposed-workflows/phase22b-isolated-e2e.yml` is kept **uncommitted** and **outside** `.github/workflows`, for owner review.
- Manual trigger only, with `contents: read` permissions.
- Uses no secrets.
- Runs a local Supabase stack in Docker on a disposable runner, refusing to continue unless the URL is local.
- Runs only the 22B-1 spec, uploads the report, and stops the stack.

## 8. Remaining limitations and decisions

1. **Legal hold:** application-level only (§5). Approving the database guard proposal is a separate decision.
2. **E2E:** not run until the workflow above is approved and executed.
3. **Editor names:** an ordinary Admin sees other editors as "an admin". RLS lets an Admin read only their own `admins` row, as in the existing Audit Log viewer. A Super Admin sees names.
4. **Dev-mode headers:** in `next dev` only, Next.js replaces the `Cache-Control` header with `no-cache, must-revalidate`. Production sends `private, no-store` as required. Hosted-environment headers must be re-checked at deployment (gates §F).
5. **Images:** hero, social and section images are kept unchanged when saving but cannot be edited; media management is 22B-3.
6. **Brand migration:** `public_brand_name` remains a proposal in `docs/proposed-migrations/`. It was not moved or executed and does not affect 22B-1.

## 9. Confirmation

- `main`: unchanged at `83b7536`.
- **DEV and production:**
  - no SQL executed, no migration applied, no deployment;
  - no website pages, drafts, revisions, publications or audit rows created;
  - no LMS business record, student information, payment workflow, authentication setting or historical audit record changed.
- **Phases 1–21C:** unchanged except for two items:
  - the Admin sidebar's new "Website" entry, with the navigation tests updated to expect it;
  - `proxy.ts` adds headers to `/admin/website` responses only. The session refresh is unchanged, and other routes are unaffected (tested).
- **Not started:** Phase 22B-2. Nothing has been merged.
