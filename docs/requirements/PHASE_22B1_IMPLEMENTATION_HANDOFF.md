# Phase 22B-1 — Implementation Handoff and Acceptance Specification

**Updated:** 2026-10-22  
**Status:** Documentation prepared for owner review. Phase 22B-1 application coding has NOT been authorized by this document or started as part of this update.  
**Working branch:** claude/phase22b-website-management; do not change main without separate approval.  
**Authority:** PHASE_22_APPROVED_DESIGN.md, sections 4, 5, 7, 10, 14 and 15; PHASE_22B_PLAN.md. Where they differ, the approved design prevails.

## 1. Purpose and business identity

Build the Admin-side Website Management interface on the already accepted Phase 22A data foundation, without changing accepted LMS workflows or existing DEV data.

- **India public-facing brand:** ROICIANS; use the supplied, unchanged ROICIANS logo without TECH. White and soft-blue website palette.
- **Supporting line:** Practical technology training for the AI era.
- **Legal entity:** Roicians Tech Pvt. Ltd.; remain unchanged in legal/financial records.
- **Existing LMS company name and Razorpay merchant display:** unchanged.
- **Future public-brand setting:** a proposed additive Company Settings field named public_brand_name is designed but not approved for execution; it is not a 22B-1 dependency.
- **Public site:** its final visual approval and launch are later stages. The 22B-1 preview is structured and private, not the final public homepage.

## 2. In scope: Admin website-management routes

| Route | Required behavior |
|---|---|
| /admin/website | List every supported public page kind, including Home, About, Corporate Training, Institutions, Contact, Legal, Navigation, Footer, Programs listing and Upcoming Batches; show not-created/draft/published/unpublished-changes status and relevant editor/publisher metadata. |
| /admin/website/pages/[id] | Authenticated structured editor, allowed sections only; edit titles, summary, SEO and social fields; add/reorder/hide sections; Save Draft, Publish and Unpublish with confirmation and clear feedback. |
| /admin/website/pages/[id]/history | Read immutable revisions, authors and timestamps; restoring an older version creates a NEW draft rather than changing published content silently. |
| /admin/website/pages/[id]/preview | Private, clearly labelled structured draft preview; fresh server render; no-store, noindex/nofollow and no information leak to public pages. |

Admin and Super Admin can access ordinary page-management functions. Anonymous users, Students, Trainers and inactive Admins cannot access routes or server actions.

## 3. Implementation contract

- Reuse the accepted Phase 22A database functions: website_create_page, website_save_draft, website_publish_document, website_unpublish_document and website_restore_revision, including their database-side actor checks and audit.
- Read via the authenticated caller's existing Supabase/RLS access; never put a service-role credential or unpublished content in the browser bundle.
- Validate at the server boundary using the existing websiteDraftSchema(kind) and allowed-section rules. Do not introduce unrestricted HTML or a general drag-and-drop builder.
- Preserve published content until an explicit Publish action. A new draft is not automatically public.
- For edits, send the version the editor originally loaded. Refuse stale edits and preserve unsaved typed content on screen with a clear reload/reconcile choice.
- Provide confirmable publication and unpublication actions. Make permissions and status understandable to nontechnical Admin users.
- Render preview only for authorized users; enforce private, no-store cache semantics and noindex/nofollow headers/metadata; ensure navigation, direct URL access and server actions all uphold access restrictions.
- Maintain an audit trail through the approved database functions; do not duplicate database audit rows in the application.

## 4. Legal-page restriction: explicit limitation

Legal and consent text may be **drafted**, but may not be published until the owner approves the exact wording.

For 22B-1, both the Publish UI and the server action must refuse legal-page publication with a clear message. This is NOT yet a complete database security restriction: the Phase 22A publishing RPC can still be called directly by a signed-in Admin. The acceptance report must disclose that bypass and must not claim database-level enforcement.

A database-level, revision-aware legal approval guard must be designed, reviewed and separately authorized before relying on the hold for any real public/legal launch. It is NOT part of the currently approved 22B-1 code scope. See PHASE_22B1_SECURITY_AND_TESTING_GATES.md.

## 5. Explicit non-goals for 22B-1

- No Phase 22B-2 Program website editor, display-group editing or Batch publishing UI.
- No Phase 22B-3 media-upload policy/migration, public asset serving or storage integration.
- No Phase 22B-4 Super Admin permanent Program deletion UI or previously published slug changes.
- No public read API, public-facing pages, domain routing, Zoho integration or production launch.
- No change to existing LMS Program/Batch/student/enrollment/finance/auth flows or historical records.
- No DEV website test fixtures, drafts, revisions, publications or audit writes.
- No application of proposed SQL migrations; do not relocate them into the active migrations directory.

## 6. Test and acceptance gates

1. **Static/build:** typecheck, lint, full unit suite and relevant local SQL/RLS tests pass; document pre-existing lint warnings and the previously identified intermittent Student form test without disabling it.
2. **Roles:** Admin and Super Admin can operate the editor; all unauthorized roles cannot list, preview, mutate or invoke server actions, including by direct URL.
3. **Content state:** save, publish, unpublish, independent drafts and prior-revision restoration work, with meaningful status and audit.
4. **Concurrency:** stale saves/publishes refuse overwrites without losing the user's text.
5. **Preview:** authorized-only, private no-store, robots noindex/nofollow; verify response headers and absence of draft content from publicly reachable output.
6. **Legal-page hold:** both the button and server action refuse publication; document the direct-RPC bypass as an unresolved database-layer risk.
7. **Regression:** unchanged LMS behavior, no migration, no use of production or DEV synthetic website data.
8. **Browser tests:** write E2E specs against an isolated disposable Supabase environment. Preferred proposed runner: manually triggered GitHub Actions with read-only repository permissions, local test database, no deployment and no hosted DEV/production secrets. The workflow itself requires separate review before committing or enabling it.

## 7. Evidence to return at 22B-1 review

- Changed-file inventory and commits on the Phase 22B branch; main remains unchanged.
- Screenshots of the actual Admin Website dashboard, editor, history and structured preview (real UI, not the standalone marketing prototype).
- Unit/component/route-header checks, full-suite results, security-role test matrix, and E2E specs/results where the isolated runner is approved.
- Clear account of preview caching/robots protections, stale edit behavior and legal-publication limitation.
- Confirmation of zero DEV/production SQL, writes, migrations, deployments or existing LMS data changes.
- Remaining blockers, owner decisions and a separate merge request. Do not start 22B-2 automatically.

## 8. Owner decisions and authorization checkpoints

| Checkpoint | State |
|---|---|
| Public ROICIANS branding, original logo, legal/LMS separation | **Approved design** |
| Phase 22A foundation | **Accepted and merged** |
| Proposed public_brand_name migration | **Design approved; execution NOT approved** |
| 22B-1 plan and safeguards | **Prepared and reviewed; code go-ahead must be explicit** |
| Isolated GitHub Actions runner | **Recommended; proposed workflow requires separate review/approval before adding to .github/workflows** |
| Any DEV trial or data write | **Not approved** |
| Real legal-page publication / database guard | **Not approved; wording and guard require separate decisions** |
| 22B-1 merge, deployment, 22B-2 work | **Not approved** |
| Final public homepage and Programs page visual acceptance | **Pending, but does not block Admin-only 22B-1 coding once authorized** |

**Next action:** The owner can separately authorize coding for precisely the 22B-1 scope above. This document does not itself execute or authorize code changes, SQL, migrations, deployment or merge.
