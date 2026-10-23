# Phase 22B-3: Implementation Report (Website Media Management)

**Date:** 2026-10-23.

**Branch:** `claude/phase22b3-website-media-management`, created from `main` at `27f0ff2` (Phase 22B-2 merged). Not merged.

**Status:** application built and unit/component tested; checkpoint for owner review.
- **Uploading needs the proposed migration**, which is **not applied** anywhere (§5).
- **Not done:** no migration applied, no SQL run, no deployment, no DEV or production data change, no CI activated, no Phase 22B-4.

Design: `PHASE_22B3_MEDIA_DESIGN.md`.

## 1. What was built

All screens are for Admin and Super Admin only, under `/admin/website`, with a new **Media** tab.

| Requirement | Screen | Behaviour |
|---|---|---|
| Upload | `/admin/website/media` | JPEG, PNG or WebP up to 5 MiB. The browser checks the bytes first; the file goes straight to the private bucket through a one-time signed link; the server reads the stored bytes back, checks them, and records the image as a **Draft** |
| Library and thumbnails | `/admin/website/media` | Grid with private previews, status, alt text, type, dimensions and size; filter by All, Draft, Approved or Retired |
| Details | `/admin/website/media/[id]` | Large private preview, file details, who uploaded and approved it, alt text, approval, and where the image is used (live, latest draft, version numbers) |
| Approval states | Details screen | Approve, Withdraw approval and Retire are each confirmed; Restore to Draft. A change that is not allowed is disabled with the reason |
| Alt text | Details screen and upload form | Required before approval: 5–250 characters, not a file name, no markup, no prices |
| Choosing images | Page and Program editors | Main image and social sharing image, plus an image for hero and banner sections. Only **Approved** images are offered |
| Publishing rule | Editor and database | A chosen image that is not Approved is flagged and Publish is held with the reason. The database refuses it too |
| Preview | Page and Program previews | Shows the chosen images with their alt text, and flags any that are not Approved |
| Failed and abandoned uploads | Media page | A failed check or recording deletes the file at once. Files never recorded are listed after 24 hours and can be removed (confirmed) |

## 2. How it is built

- **Reused from Phase 22A, unchanged in the application:**
  - `website_media_assets` and the private `website-media` bucket;
  - `website_register_media_asset()` and `website_update_media_asset()`;
  - the revision and publishing rules: only Approved images publish, retired images cannot enter new content, and images used by published content keep their approval.
- **New modules:**
  - `lib/domain/website-media.ts`: the content check, which reads real JPEG, PNG and WebP structure, end markers and dimensions with **no new dependency**; safe paths; states; alt text rules; image slots per page kind;
  - `lib/data/website-media.ts`: reads and writes on the Admin's own session;
  - `lib/actions/website-media.ts`: server actions;
  - `lib/website-media-upload.ts`: the browser upload;
  - `components/admin/website/media/*`: the screens.
- **Shared 22B-1/22B-2 changes (backwards-compatible):**
  - the editor takes optional `media` (without it, images are kept unchanged as before);
  - the publication panel takes an optional image reason;
  - the preview takes optional `media`;
  - the Website tabs gain "Media".

  The 22B-1 and 22B-2 browser suites pass unchanged against the new build (§6).
- **Hosting:** the file never passes through the application server on upload, so the roughly 4.5 MB Vercel function body limit does not apply. The server reads the stored file back (at most 5 MiB) to check it. This works on any standard Next.js host (Vercel or a Node host such as Hostinger).

## 3. Changed files (34, plus this report)

| Area | Files |
|---|---|
| Docs | `README.md`, `IMPLEMENTATION_PLAN.md` (22B-2 merged; 22B-3 in development), `docs/requirements/PHASE_22B3_MEDIA_DESIGN.md`, this report |
| Proposed migration (not applied) | `docs/proposed-migrations/website_media_uploads.sql`, `website_media_uploads_test.sql`, `website_media_uploads_harness_stub.sql`, `README.md` section |
| Domain, data, actions | `lib/domain/website-media.ts`, `lib/data/website-media.ts`, `lib/actions/website-media.ts`, `lib/website-media-upload.ts` |
| Screens | `app/admin/website/media/page.tsx`, `app/admin/website/media/[id]/page.tsx`, `components/admin/website/media/{media-image,media-library,media-uploader,incomplete-uploads,media-detail,media-picker}.tsx` |
| Shared screens (optional props) | `page-editor.tsx`, `publication-panel.tsx`, `page-preview.tsx`, `programs/website-area-nav.tsx`, the page and Program editor and preview routes |
| Tests | `lib/domain/__tests__/website-media.test.ts` (+ fictional image fixtures), `lib/data/__tests__/website-media.test.ts`, `lib/actions/__tests__/website-media.test.ts`, `components/admin/website/media/__tests__/media-screens.test.tsx` |
| Browser acceptance (prepared) | `e2e/phase22b3-website-media.spec.ts`, `e2e/support/phase22b3-fixtures.ts` |

**Not changed:** `supabase/` (migrations and SQL tests), `package.json` and the lockfile, `.github/`, `next.config.ts`, `proxy.ts`, `lib/auth/`, `lib/supabase/`, Company Settings and branding, other buckets.

## 4. Security assessment

| Area | Finding |
|---|---|
| Who can manage media | **Pages:** anonymous users go to `/login/admin`; Trainer and Student go to their own portal; an inactive Admin is treated as signed out. **Server actions:** all 5 check for Admin or Super Admin before any data or Storage call (unit test for Trainer, Student and signed out). **Database:** `website_assert_manager()` refuses anyone but an active Admin or Super Admin. **Storage (proposal):** upload and delete policies require an active Admin; read is Admin-only (22A) |
| File content | The bytes are checked, not the name or the declared type: real JPEG/PNG/WebP structure, end markers (so data hidden after the image is refused), 1–10000 px, ≤ 5 MiB. Tested with real encoder output, HTML, SVG, PDF, GIF, truncated files and files with data appended. **Defence in depth (proposal):** bucket limits; the database cross-checks the stored size and type and that the caller uploaded the file |
| Privacy | The bucket stays private; no public URL is ever created (a source test enforces this). Admin previews use 10-minute signed links made with the Admin's own session, on pages already sent `no-store` and `noindex` (checked on both new routes). A plain `<img>` with `no-referrer` is used, so the Next.js image optimizer never caches private images. **No service-role key** in application code (a source test enforces this) |
| Paths and overwrites | Paths are `<random uuid>/<cleaned name>.<extension from the detected type>`. **Proposal:** no update policy, so no overwrite, upsert or move; uploading at a recorded path is refused; one-time links are created without upsert |
| Orphans | Removed straight away on any failure. Abandoned files are listed after 24 hours. **Proposal:** delete only for never-recorded files (the uploader at once, others after 24 hours); recorded images can never be deleted |
| Approval and publishing | Alt text before approval (database and stricter application rule). Only Approved images publish (22A database rule). Images used by published content cannot be withdrawn or retired. Every change is version-checked |
| Audit | 22A records registration and every update. **Proposal:** before and after status **and** alt text, plus the kind of change. The application adds no audit rows |
| LMS buckets and data | No change to any other bucket or policy. The proposal's SQL test checks that every storage policy is bucket-scoped and that the website helpers appear in no other bucket's policy. No LMS table is written |

**Residual risks (for the reviewer):**
1. **Database cannot read file bytes.** An active Admin calling the database directly could record a file whose bytes are not a real image, as long as Storage accepted its declared type. The bucket is private and approval shows a preview. Phase 22C should re-encode images before public serving.
2. **Image metadata.** EXIF metadata, such as camera location, is not removed yet. This is planned for 22C, before public serving.
3. **Signed preview links** are bearer links for 10 minutes. They are only placed on no-store Admin pages.

## 5. Proposed migration and SQL tests (review only)

`docs/proposed-migrations/website_media_uploads.sql` (details in that folder's README):
- bucket limits;
- upload and delete policies;
- no update policy;
- stored-file cross-check on recording;
- fuller audit;
- the incomplete-uploads list.

`website_media_uploads_test.sql` (M1–M9) covers:
- bucket and policy inventory;
- upload by role and path;
- no overwrite or move;
- read isolation;
- recording cross-checks;
- delete rules;
- incomplete-uploads list;
- approval, publishing and audit;
- other buckets untouched.

**Checked so far:** all three SQL files parse with the PostgreSQL parser (pglast), including every PL/pgSQL body. **Nothing has been executed.**

**Changes needed on adoption:** two existing assertions in `supabase/tests/phase22a_website_foundation_test.sql`, W1 (no write policy) and W6 (records without a stored file), are listed in the README.

## 6. Test results (this sandbox)

| Check | Result |
|---|---|
| Typecheck | Pass |
| Lint | 0 errors (the 4 warnings already on `main`) |
| Unit and component suite | **155 files, 2,019 tests, all pass, none skipped** (`main`: 151 files, 1,938 tests) |
| New 22B-3 tests | 81: domain 18, data 17, actions 24, screens 22 |
| Production build (webpack, as CI uses) | Pass; `/admin/website/media` and `/admin/website/media/[id]` are dynamic |
| Browser dry run, local stand-in database (not acceptance) | **24 of 24 passed** in one run: 22B-1 (8), 22B-2 (8) and 22B-3 (8). The stand-in mirrors the proposal's Storage rules |
| Screenshot walkthrough | No console errors; every image loaded; both new routes send `private, no-store` and `noindex` |

Two real UI bugs were found by the dry run and screenshot review and fixed:
- the "Alt text saved." message disappeared after the page refreshed;
- a held-change reason was shown twice.

Both have regression tests.

## 7. Acceptance status

| Feature | Testable without the migration | Prepared browser test |
|---|---|---|
| Library, details, alt text, approve, withdraw, retire, restore | Yes (images placed by fixtures) | 4, 7 |
| Choosing images, preview, publish, unapproved image holds publishing | Yes | 5, 6 |
| Upload through the screen; content check; private storage | **No** | 1, 2 |
| Overwrite refused; bucket limits | **No** | 2 |
| Role isolation for the bucket and the new function | **No** (screens: yes) | 3 |
| Removing incomplete uploads | **No** | 8 |
| Fuller audit entries | **No** | 4, 7 |

The prepared suite runs only with `PHASE22B_E2E_ISOLATED=1` and `PHASE22B3_MEDIA_MIGRATION=1` against a local, disposable stack. Otherwise it skips with that reason.

## 8. Approvals needed for isolated database testing

1. **Design approval** of `website_media_uploads.sql`, including the reviewer points: content-check location, owner column, the 24-hour window and the audit payload.
2. **Plain-Postgres SQL run.** Authorization to run, in a throwaway local Postgres only, in this order:
   - `auth_schema_stub.sql`;
   - migrations 1–42;
   - `website_media_uploads_harness_stub.sql`;
   - the proposal;
   - `website_media_uploads_test.sql`;
   - the 22A suite with the two listed assertion updates.
3. **How the disposable browser-test stack gets the proposal.** Recommended: a CI-only workflow copies the proposal into `supabase/migrations/` **at run time** on the runner before `supabase start`, so the repository's active migrations stay unchanged. The alternative is committing it as migration `20260101000043`, which makes it active in the repository and needs separate approval.
4. **CI-only acceptance run** (same approach as 22B-1/22B-2), pinned to an exact commit:
   - 22B-1, 22B-2 and 22B-3 suites;
   - **24 of 24** required;
   - `PHASE22B3_MEDIA_MIGRATION=1`.
5. **Later, separately:** DEV application, then production.

## 9. Remaining limitations

1. Content-check location, image metadata and signed-link lifetime (§4 residual risks).
2. **Signed-upload owner:** that Storage records the link's creator as owner must be confirmed in the isolated run. The cross-check depends on it.
3. **Retired images are never deleted** (by design); storage use grows. A purge policy can be decided later.
4. **The picker** lists up to 300 Approved images with search; there is no paging. One file per upload; no cropping or resizing.
5. **The server-side byte check** for a caller who bypasses the browser is covered by unit tests, not the browser suite.
6. **Storage CORS on hosted Supabase** must allow browser uploads from the chosen site domain; check on DEV when authorized.
7. **Carried from 22B-2:** atomic featured order; database-level published-slug guard; database-level price rule; legal-page safeguard; TI-3 Batch listing.

## 10. Confirmation

- `main` unchanged (`27f0ff2`); nothing merged.
- **DEV and production:** no SQL, no migration, no deployment, no media or other records created.
- No CI activated. Phase 22B-4 not started.
- Screenshots used fictional sample illustrations in a local stand-in, never DEV.
