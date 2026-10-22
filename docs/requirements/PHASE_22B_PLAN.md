# Phase 22B — Admin Website Management: Plan

**Status (2026-10-22): 22B-1 implemented on this branch after the owner's go-ahead, awaiting review.**
- See [`PHASE_22B1_IMPLEMENTATION_REPORT.md`](PHASE_22B1_IMPLEMENTATION_REPORT.md).
- **Not done:** no migration, no SQL, no DEV change, no merge.
- **Browser tests:** NOT RUN until the isolated runner is approved.
- **Legal hold:** application-level only; the database guard is a separate proposal.
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
| BR1 | Public India website brand: **ROICIANS**. Website logo: the original ROICIANS logo only, without TECH. Legal name stays **Roicians Tech Pvt. Ltd.** The LMS company name and payment checkout are unchanged | Design §4 |
| BR2 | Future brand changes through one Super-Admin-controlled setting: `public_brand_name` in the existing Company Settings, with validation, permissions and audit logging. Public pages read it only through a narrow server-side accessor; private Company Settings data is never public. **Design approved; migration execution not approved.** Prepared for review in `docs/proposed-migrations/`; reviewed before 22C/22D. **Not needed for 22B-1** | Design §4.1 |
| C3 | DEV business data is protected. 22B-1 is accepted from the isolated environment, not by creating, drafting or publishing website pages on DEV. Any DEV trial needs separate authorization | This plan §5 |
| C4 | Unapproved legal wording is never published. Legal pages may be drafted (drafts are never public), but publishing a legal page is blocked until the owner records business/legal approval of that wording | This plan §4.2, §5 |

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
- **Legal pages (C4): publishing held.**
  - **Editor:** shows that legal wording needs business and legal approval before it can be published (design §5.2). Drafting, preview and history work as for other pages.
  - **Publish refused:** for the legal page kind, the Publish button is disabled, and the server action refuses to publish with a plain message. This is enforced on the server, not only hidden in the UI.
  - **Lifting the hold:** a small, separately authorized code change, made after the owner records approval of specific wording.
  - **Limit:** the hold is in the application. The 22A database publish function would still accept a direct database call from a signed-in Admin, and any such call would be audited. A database-level hold would need a migration, which is not proposed for 22B-1.
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
- **Browser (E2E):** isolated local environment only (B4); never against DEV or production. The specs are written with 22B-1, and they run once the environment in C2 is chosen.
- **Legal hold (C4):** unit tests show that the publish action refuses the legal page kind for both Admin and Super Admin, and that the button is disabled.
- **Known intermittent test:** `student-form-duplicate-override-flow.test.tsx` (outside 22B) can fail under parallel load and passes alone. It is recorded in `docs/recovery/PHASE_22A_DEV_RECOVERY_RECORD.md` §6 and is never skipped or disabled.
- **Gates:** typecheck, lint and the full unit suite.

### 4.4 Acceptance criteria for 22B-1

1. Admin and Super Admin can create, edit, save, publish, unpublish and restore every supported page type, except that legal pages cannot be published until their wording is approved (C4). Trainers, Students, inactive Admins and anonymous users cannot reach the area or call the actions.
2. Drafts never change published content until Publish. Restore creates a new draft.
3. Two editors cannot silently overwrite each other.
4. The preview is authenticated, `no-store` and `noindex`, and labelled.
5. Every publish, unpublish and restore is in the audit log with actor and time.
6. No existing LMS screen, data or audit history changes. No migration.
7. Accepted from the isolated environment. No website page, revision, test record or audit row is created on DEV for acceptance (C3).

## 5. Phase 22B-1 implementation readiness (2026-10-22)

### 5.1 Preconditions (verified on this branch)

| Precondition | State |
|---|---|
| Phase 22A merged | `main` at `83b7536`; this branch adds no application or database changes |
| Database functions 22B-1 calls | `website_create_page`, `website_save_draft`, `website_publish_document`, `website_unpublish_document`, `website_restore_revision` and `website_assert_manager` exist (migrations 40 and 42). DEV has migrations 1–42 |
| Validation and messages | `websiteDraftSchema(kind)` and `STALE_EDIT_MESSAGE` exist; the `legal` page kind exists |
| Migration needed for 22B-1 | **None** |
| Depends on the brand setting (BR2) or final visual approval (C1) | **No.** 22B-1 is Admin-only and shows no public pages |

### 5.2 Ready to implement once the owner gives the go-ahead

No further design decision is needed for this scope:
1. **Website area:** a Website entry in the Admin sidebar, for Admin and Super Admin only.
2. **Pages screen:** every supported page with its status, last editor and publisher (§4.1).
3. **Structured editor:** title, summary, SEO and social fields, and the allowed sections (add, remove, reorder, show or hide). It supports Save draft, Publish and Unpublish, and keeps unsaved text on a stale edit.
4. **History and restore:** restoring creates a new draft.
5. **Structured preview:** authenticated, `no-store`, `noindex`, and labelled "Preview — not public" (B2).
6. **Legal publishing hold (C4):** enforced in the server action, with the Publish button disabled.
7. **Server actions** call only the existing 22A functions. Role checks run in the app and again in the database. Audit comes from the database functions, so there are no duplicate rows.
8. **Tests:** unit, component and route-header tests, plus E2E specs (written, not run against DEV). The gates are typecheck, lint and the full unit suite.
9. **Documentation, commits and pushes** to `claude/phase22b-website-management` only.

### 5.3 Still requires the owner's approval

| # | Item | Blocks |
|---|---|---|
| A1 | **Explicit go-ahead to start 22B-1 coding** on this branch | All of §5.2 |
| A2 | **C2: where browser tests run** (B4 is decided: isolated only). Options: (a) your Windows machine with Docker Desktop and the Supabase CLI; (b) a GitHub Actions workflow with a throwaway local Supabase stack, which adds a CI file and needs approval (recommended); (c) another Docker environment | Running E2E and browser acceptance of 22B-1 (not coding) |
| A3 | Any 22B-1 trial on DEV (C3). Website revisions and audit rows are permanent by design | Nothing in 22B-1; optional |
| A4 | **Merging 22B-1 to `main`,** and any deployment | Release |
| A5 | **Legal wording approval,** page by page, before any legal page can be published (C4) | Publishing legal pages only |
| A6 | **Brand migration (BR2):** review and approval of `docs/proposed-migrations/public_brand_name.sql`; then separately authorized DEV application, then production | 22C/22D (not 22B-1) |
| A7 | **Media-upload migration (B1, 22B-3):** prepared separately for review | 22B-3 |
| A8 | **Final visual approval** of the homepage and Programs page (C1) | Public pages, 22D–22G (not 22B-1) |
| A9 | Running SQL, applying migrations or changing DEV or production data | Always separate |

### 5.4 Protections that stay in force throughout 22B-1

- **No change to existing data:** no migration, no SQL and no change to DEV or production data. Existing LMS business records and audit history are untouched (B5).
- **No test data on DEV:** no synthetic records or published test content on DEV (B4, C3).
- **Legal pages:** never published until their wording is approved (C4).
- **Slugs:** slug change after publication stays disabled (B6). TI-7 and TI-3 protections are not bypassed (B7).
- **Branch:** no merge to `main` without separate authorization.


---

## 6. Owner authorization and security handoff — 2026-10-22

The owner requested updated Phase 22B documentation after reviewing the readiness assessment. The detailed scope and test/acceptance criteria are now maintained in:

- [PHASE_22B1_IMPLEMENTATION_HANDOFF.md](PHASE_22B1_IMPLEMENTATION_HANDOFF.md)
- [PHASE_22B1_SECURITY_AND_TESTING_GATES.md](PHASE_22B1_SECURITY_AND_TESTING_GATES.md)

**Status distinction:** the owner has approved the Phase 22B-1 development direction and instructed that coding begin in the conversation; this document update itself contains no implementation, SQL execution or deployment. Do not infer authorization for application of any proposed migration, DEV writes, CI activation, deployment, merge or Phase 22B-2. Use the written handoff to constrain actual 22B-1 implementation and return a separate implementation review.

**Confirmed brand:** public India website ROICIANS, original ROICIANS logo without TECH; tagline unchanged; legal name Roicians Tech Pvt. Ltd.; existing LMS company_name and checkout branding unchanged. The proposed public_brand_name column is separate and does not block 22B-1.

**Legal publishing:** legal-page Publish is disabled in the UI and refused by the server action during 22B-1. The existing database publishing RPC still permits direct authenticated Admin calls; this is a **known database bypass**, not fully enforced legal approval. A later revision-specific database-level guard is required before asserting full protection or releasing legal content.

**Browser testing:** prefer manually triggered, disposable GitHub Actions/Supabase test stack, without hosted secrets or deployment permissions. Workflow YAML must be independently reviewed before being committed or activated. Do not run E2E against DEV, where durable website revision/audit records would remain.

**Acceptance evidence:** actual Admin UI screenshots, role-denial matrix, stale-edit and publish behavior, private no-store/noindex preview headers, unit/component/typecheck/lint and full test suite, isolated E2E execution status, and clear statement of DEV/main untouched until separate approval.
