# Phase 22B — Admin Website Management: Plan

**Status: Planning only. No application code, no migration and no DEV change.**
- Branch: `claude/phase22b-website-management`, from `main` at `83b7536` (Phase 22A merged).
- Authority: [`PHASE_22_APPROVED_DESIGN.md`](PHASE_22_APPROVED_DESIGN.md) §5, §5.5 (22B decisions, 2026-10-22), §7.4, §10 and §15.

## 1. Owner decisions recorded (2026-10-22)

| # | Decision | Where recorded |
|---|---|---|
| V1 | Public website palette: white `#FFFFFF`, soft blue `#F1F6FF`, cobalt `#2347D0`, dark-navy text `#14263F`. No dark sections; the Corporate/GCC section becomes a light-blue band. No glow, heavy gradients, generic AI imagery or clutter. Branding and logo rules unchanged | Design §10 |
| B1 | Media uploads: Admin and Super Admin only, private `website-media` bucket, file validation, size limits, audit. Migration prepared separately; not applied without approval | Design §5.5 |
| B2 | Secure authenticated structured preview in 22B; drafts never public, publicly cached or indexed | Design §5.5 |
| B3 | Featured and display order stay live, with confirmation, permissions and audit. No placement migration | Design §5.5 |
| B4 | Browser tests only in an isolated local environment. No permanent test records or published test content on DEV | Design §5.5 |
| B5 | Existing DEV Program content is not published or modified without separate authorization | Design §5.5 |
| B6 | Slug history recorded; post-publication slug change disabled until redirects are verified | Design §5.5 |
| B7 | TI-7, TI-3 and audit-history limitations stay documented and enforced | Design §5.5 |

## 2. Visual prototype (for approval before 22D–22G)

- **v1** (`../prototypes/roicians-tech-homepage-prototype.html`): **not approved** by the owner (2026-10-22). Kept as a record.
- **v2** (`../prototypes/website-v2/`): redesign under review. See its `README.md`.
- **Provisional owner decisions (2026-10-22):**
  - Original logo and colour preserved.
  - **Website logo (decision, 2026-10-22):** the original ROICIANS logo without TECH.
    - Header: the original symbol and wordmark side by side.
    - Footer: the original stacked logo, with the tagline as normal text.
    - Favicon: the R symbol alone.
    - The earlier TECH lockups are superseded; their history is in `../brand/WEBSITE_LOGO_DECISIONS.md`.
    - The legal name Roicians Tech Pvt. Ltd. is unchanged.
  - **Public brand name (decision, 2026-10-22):**
    - **ROICIANS** replaces ROICIANS TECH as the India website's public brand, in page titles, branding labels, navigation and future SEO metadata.
    - The tagline is kept, and the legal name stays Roicians Tech Pvt. Ltd.
    - The LMS, legal company settings, historical records, database, domain plans and Canada website are unchanged.
    - The future website reads the name from one setting, so a rename needs no code edits across components and no migration (design doc §4.1). That setting needs one small additive Company Settings field, prepared separately and not applied without approval.
  - Palette kept.
  - Program-card illustrations kept.
  - Licensed photography planned for the live hero and Corporate Training sections.
  - "Explore our technology programs" replaces the unsubstantiated demand heading.
- Final visual approval of the homepage and Programs page is still pending. No 22B application code starts before it.

**v2 contents:**
- **Pages:** homepage, Programs listing, website logo and review notes.
- **Logo:** the original ROICIANS logo without TECH; R symbol favicon.
- **Imagery:** original illustrations only.
- **Copy:** a single prototype notice. Sample copy is kept separate from approved facts.

**Review link** (private to the owner): given in the review message.

## 3. Stage breakdown

| Stage | Scope | Needs a migration? |
|---|---|---|
| **22B-1** | Website Management area, page editors, drafts, publish, unpublish, revision history and restore, structured preview | No |
| 22B-2 | Program website content editor; display groups; featured and order (live, audited); Batch publication label and Open/Closed/Full | No (22A functions exist) |
| 22B-3 | Media upload to `website-media` with validation and approval | **Yes**: upload policy, prepared separately for review |
| 22B-4 | Super Admin Program-deletion screens (eligibility review, reason, type-the-code confirmation, blocked explanations); discard unpublished draft | No |

Post-publication slug change is **not** built in 22B (B6).

## 4. 22B-1 implementation plan (proposed; not started)

### 4.1 Scope

**Admin portal: a new "Website" area** for Admin and Super Admin only:

| Route | Shows |
|---|---|
| `/admin/website` | Every supported page: Home, About, Corporate Training, For Institutions, Contact, Legal, Navigation, Footer, Programs listing, Upcoming Batches. For each: status (Not created / Draft / Published / Published with unpublished changes), last editor and time, and the publisher and time |
| `/admin/website/pages/[id]` | Structured editor: title, summary, SEO title and description, social fields, and the sections allowed for that page type (add, remove, reorder, show/hide). Save draft, Publish, Unpublish |
| `/admin/website/pages/[id]/history` | Revisions with editor and time; restore any revision as a new draft (never a silent overwrite) |
| `/admin/website/pages/[id]/preview` | Authenticated structured preview of the latest draft |

**Not in 22B-1:** Program content, display groups, Batches, media, deletion screens, slug change and public pages.

### 4.2 How it is built (existing patterns)

- **Reads** — `lib/data/website.ts`:
  - read through the existing Admin RLS read policies on the website tables;
  - never with the service role.
- **Writes** — `lib/actions/website.ts`:
  - server actions;
  - each calls an existing 22A database function: `website_create_page`, `website_save_draft`, `website_publish_document`, `website_unpublish_document`, `website_restore_revision`.
- **Validation:** the existing `websiteDraftSchema(kind)` in `lib/validation/website.ts`. It enforces section types per page kind, no markup, no prices and safe links.
- **Role checks:** each action checks the Admin/Super Admin role. The database functions check again (`website_assert_manager`). Trainers, Students and inactive Admins are refused at both layers.
- **Audit:** done by the database functions, so the app adds no duplicate audit rows.
- **Lost-update protection:**
  - every save carries the revision number it started from;
  - a stale save shows the existing `STALE_EDIT_MESSAGE`;
  - the user's unsaved text stays on screen so nothing typed is lost.
- **Preview security (B2):**
  - rendered on demand only, never prebuilt;
  - `Cache-Control: private, no-store`;
  - `X-Robots-Tag: noindex, nofollow` and a robots meta tag;
  - lives under `/admin`, behind the existing Admin session check;
  - labelled "Preview — not public".

  It shows the content structure, not the final public design; the visual preview comes with the public pages in 22D–22G.
- **Legal pages:** the editor shows a notice that legal wording needs business and legal approval before publishing (design §5.2).
- **Navigation:** add "Website" to the Admin sidebar for Admin and Super Admin.

### 4.3 Tests

- **Unit:**
  - actions: role refusal, validation, mapping database errors to plain messages (stale edit, not found, not allowed);
  - data mapping;
  - status calculation (draft vs published vs unpublished changes).
- **Component:**
  - the section editor (add, reorder, hide, type restrictions);
  - the stale-edit message keeps input;
  - publish and unpublish confirmations;
  - the history and restore flow;
  - the preview labels.
- **Route checks:** the preview response headers (`no-store`, `noindex`).
- **SQL:** no new database code. The existing 22A suites keep running.
- **Browser (E2E):** isolated local environment only (B4). See decision C2.
- **Gates:** typecheck, lint and the full unit suite.

### 4.4 Acceptance criteria for 22B-1

1. Admin and Super Admin can create, edit, save, publish, unpublish and restore every supported page type. Trainers, Students, inactive Admins and anonymous users cannot reach the area or call the actions.
2. Drafts never change published content until Publish. Restore creates a new draft.
3. Two editors cannot silently overwrite each other.
4. The preview is authenticated, `no-store` and `noindex`, and labelled.
5. Every publish, unpublish and restore is in the audit log with actor and time.
6. No existing LMS screen, data or audit history changes. No migration.

## 5. Decisions needed before 22B-1 coding

- **C1 — Prototype approval.** Approve the visual direction (or request changes) before the public pages (22D–22G). 22B-1 is Admin-only and does not depend on it, but you asked to review the prototype first.
- **C2 — Where browser tests run.** This cloud sandbox cannot run a local Supabase stack (its Docker daemon is unavailable). Options:
  - **(a)** you run the 22B E2E suite on your Windows machine with Docker Desktop and the Supabase CLI;
  - **(b)** a GitHub Actions workflow that starts a throwaway local Supabase stack, runs the tests and deploys nothing. This adds a CI file, so it needs your approval;
  - **(c)** an environment with Docker.

  Recommended: **(b)**, for repeatable results.
- **C3 — Manual acceptance on DEV.** Website revisions and audit rows are permanent by design. If you try the editor on DEV, any page you create leaves permanent revision and audit rows, even if it is never published. Options:
  - use only real draft content you intend to keep, and do not publish without authorization;
  - accept 22B-1 from the isolated environment only.
- **C4 — Legal pages.** Allow drafting now, with publishing held by a notice (proposed). Alternatively, hide the legal page type until the wording is approved.
