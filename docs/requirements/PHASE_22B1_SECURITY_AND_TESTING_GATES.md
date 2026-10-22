# Phase 22B-1 — Security, Legal Publication and Isolated Testing Gates

**Updated:** 2026-10-22  
**Status:** Review and implementation constraints; NOT a migration or executable workflow; no database/deployment access authorized.  
**Related:** PHASE_22B1_IMPLEMENTATION_HANDOFF.md, PHASE_22B_PLAN.md, PHASE_22_APPROVED_DESIGN.md and docs/proposed-migrations/README.md.

## A. Role and data security

The Website Management interface serves Admin and Super Admin only. Authorization must be checked at the route/layout level, in each server action and in the database. RLS reads must use the caller's own session. No client-facing service-role key, public SELECT grants on private website tables, unrestricted HTML editing or unreviewed public endpoints.

Test both authorized use and role-denied direct access for anonymous users, Students, Trainers and inactive Admins. An invisible UI control does NOT constitute a security boundary.

## B. Legal-page publishing hold — known database bypass

**Business rule:** legal/consent wording is drafted privately; actual publication requires owner approval of the specific wording.

**22B-1 implementation:** hide/disable Publish for legal pages AND refuse it in server actions; show a human-readable message. Keep drafts/preview/history available to authorized editors.

**Unresolved:** the existing Phase 22A website_publish_document RPC accepts a direct authenticated Admin call for a legal page. An Admin who bypasses the web app could still publish, with audit. Therefore the app-level hold alone must never be described as full enforcement.

**Proposed later database safeguard, NOT approved or implemented:**
- Introduce an explicit, separately reviewed, revision-specific legal approval mechanism (not a global boolean that automatically approves every future draft).
- Make the DB publish path refuse legal-page publication unless the exact revision carries valid approval made by the authorized owner/Super Admin workflow.
- Record approval identity and time; ensure the approval cannot be forged by ordinary Admin clients.
- Make later edits/revisions require new approval. Confirm restore/unpublish behavior.
- Verify the database denies direct RPC calls, not just application actions; test role impersonation and concurrent edits.
- Keep legal pages out of the public-data contract until approval and the database safeguard are complete.

This requires a separately numbered/reviewed migration, isolated test run and explicit DEV authorization. Do not add it to active migrations or silently apply it as part of 22B-1.

## C. Preview and cache isolation

A private preview must require a valid Admin/Super Admin session on every request. Ensure route checks also protect a direct URL. Use private, no-store response headers, robots noindex/nofollow and avoid static rendering, metadata, sitemaps and shared caches that can expose drafts.

Test both rendered HTML and HTTP headers, including unauthenticated redirects/denials, stale sessions and prohibited client-side cache behavior. The structured preview is not a substitute for the final public pages or approved public copy.

## D. Browser tests without touching DEV

**Preferred test environment (proposal only):** a manually triggered GitHub Actions workflow that starts an ephemeral Supabase stack and Next.js application on the runner, seeds disposable synthetic users/roles and executes Playwright browser tests.

Minimum constraints for any proposed workflow:
1. Trigger manually via workflow_dispatch initially; keep the file OUTSIDE .github/workflows until the owner reviews and approves it.
2. Minimal repository permissions, ideally contents: read. No repository writes, releases, cloud deployments or pull-request mutation.
3. Do not load Supabase DEV/production database passwords, service-role keys, hosted project refs or other external production secrets.
4. Explicitly use local, generated Supabase test URLs/keys only. Never call supabase db push, reset or other migration commands targeting a hosted project.
5. Set tight job timeouts and dispose of the runner afterwards. No persistent E2E test fixtures.
6. Test Admin/Super Admin, forbidden roles, save/publish/unpublish, history/restore, stale edits, legal hold and preview cache isolation.
7. Show the exact workflow YAML and reviewed file list before creating or enabling it. Availability of Docker/Supabase inside CI must be validated before claiming browser coverage.
8. Until this runner is approved, write and review E2E specs but report their execution status as NOT RUN.

Running manual browser tests against DEV is NOT an automatic substitute: Phase 22A stores durable website revisions and audit history, so DEV test content can become permanent.

## E. Proposed public-brand migration — no execution yet

The existing LMS company_name remains the LMS-facing identity and Razorpay merchant display; legal_name remains Roicians Tech Pvt. Ltd. The new public_brand_name is proposed for the India public site only.

The SQL draft in docs/proposed-migrations/public_brand_name.sql:
- Adds one required column, initialized for the existing settings row to ROICIANS.
- Restricts values and defines a narrow website_public_brand() function returning only public brand and legal name.
- Does NOT alter existing LMS or legal identity fields, policies or business records.
- Is stored outside the active migration directory and is NOT applied anywhere.

**Review requirements before approval:** validate exact target migration number and source version; run SQL and role tests on a disposable local database; inspect SECURITY DEFINER owner/search_path and effective EXECUTE privileges including PUBLIC inheritance; verify only the intended two output columns; prove no private settings values leak; confirm application compatibility and controlled cache invalidation.

**Audit limitation:** the current Company Settings save writes audit logs after the settings update, with a timeout and error handling. A successful settings update can therefore survive a failed audit write. This existing best-effort behavior must be disclosed in the migration review; decide separately whether public-brand changes need a transactionally guaranteed audit trigger/function and tests preventing duplicate audit rows. Do not claim guaranteed audit until implemented and verified.

## F. Required release decisions

| Risk or change | Before coding 22B-1 | Before merge | Before public release |
|---|---|---|---|
| Legal pages app-level hold | Implement and test | Disclose DB bypass, get explicit residual-risk decision if needed | Enforce approved wording with a separately authorized DB guard |
| Preview privacy | Implement | Verify tests/headers | Verify production host and cache behavior |
| Isolated E2E environment | Specs can be written | Run when approved; disclose if not run | Full browser/security acceptance required |
| Public-brand migration | Not required | Not required for 22B-1 | Review, isolate-test, explicitly authorize DEV and later production application |
| Media-upload policy | Not required | Not required for 22B-1 | Separate 22B-3 migration review |
| Historical LMS data | Do not touch | Show no-change evidence | Preserve across all deployments |
| Production/domain configuration | Not required | No deployment | Separate approvals and Phase 25 checks |

No step here authorizes a new database change, workflow activation, merge, deployment, or access to actual hosted data.
