# Proposed migrations (for review only)

Files here are **prepared for review and are not applied**:
- They are deliberately kept outside `supabase/migrations/`, so no database tooling picks them up.
- They have not been run against DEV, production or any database.

Each one needs the owner's approval before it is:
1. given its verified migration number;
2. copied into `supabase/migrations/`;
3. tested in an isolated local database;
4. applied to DEV (separate authorization), and later to production (separate authorization).

## `public_brand_name.sql`: public website brand name

| | |
|---|---|
| Decision | Owner, 2026-10-22: the **design** of this additive field is approved. **Execution is not.** |
| Design | `docs/requirements/PHASE_22_APPROVED_DESIGN.md` §4.1 |
| Needed by | Before Phase 22C/22D (public pages). **Phase 22B-1 does not depend on it.** |
| Expected number | `20260101000043`, verified at approval time |
| Test | `public_brand_name_test.sql` (follows the `supabase/tests` conventions; ends with ROLLBACK) |
| Checked so far | Both files parse as valid PostgreSQL and PL/pgSQL (parser only; nothing executed) |

### What it changes

1. **Adds `company_settings.public_brand_name`** (required).
   - The existing single settings row receives `ROICIANS`.
   - The column default is dropped straight after, so the name lives only in the settings row.
   - Filling the column this way does not fire the `updated_at` trigger.
2. **Adds a database check:** trimmed, 1–60 characters, no control or markup characters.
3. **Adds `website_public_brand()`:** returns only the public brand name and the legal name.
   - EXECUTE is granted to `service_role` only.
   - `anon` and `authenticated` cannot call it.

### What it deliberately does not change

- **Existing values:**
  - `company_name`, the LMS display name. The Admin portal and the payment checkout's merchant name keep using it.
  - `legal_name`, which stays **Roicians Tech Pvt. Ltd.**
  - Historical records and LMS business data.
- **Permissions** on `company_settings`:
  - no new or changed policy;
  - Admin and Super Admin read; Super Admin updates;
  - no insert or delete for anyone; nothing for `anon`.
- **No new table or branding system.**

### Application change that accompanies it (22C/22D; not started)

The field joins the existing Company Settings architecture (Phase 21C), so it gets the same validation, permissions and audit logging as `company_name`:

| Area | Change |
|---|---|
| Validation (`lib/validation/company-settings.ts`) | `publicBrandName`: trimmed, 1–60 characters, no control or markup characters (same rule as the database) |
| Domain (`lib/domain/company-settings.ts`) | Add the field to the settings type and to the audited diff fields |
| Data (`lib/data/company-settings.ts`) | Select and update `public_brand_name`; regenerate `database.types.ts` |
| Action (`lib/actions/company-settings.ts`) | No new action. The existing save keeps its Super Admin check and RLS backstop, and audits the change in the `company_settings.updated` entry with before and after values |
| Settings form and view | New field "Public website brand name", with help text explaining that it is separate from the LMS company name and from the legal name |
| Public accessor (22C) | `getPublicBrand()`: server-only. It reads `website_public_brand()` and is cached with published website data, and a settings save revalidates that cache |
| Guard test | Fails if a literal brand name appears in public-website source outside the accessor |

### Points for the reviewer

1. **Grant scope.** EXECUTE is limited to `service_role` until Phase 22C fixes the public read path.
   - The function returns only facts shown on every public page.
   - Widening it to `anon` later would expose nothing private. That would still be a 22C decision.
2. **Audit timing.** As for every Company Settings field today, the audit entry is written by the server straight after a successful save.
   - If that write fails, the error is logged and the save stands. This is the existing Phase 21C behaviour.
   - A database trigger could make the record unconditional, at the cost of one extra trigger. It is not included, to keep this change small.


## Phase 22B-1 handoff and outstanding security review (2026-10-22)

See [PHASE_22B1_IMPLEMENTATION_HANDOFF.md](../requirements/PHASE_22B1_IMPLEMENTATION_HANDOFF.md) and [PHASE_22B1_SECURITY_AND_TESTING_GATES.md](../requirements/PHASE_22B1_SECURITY_AND_TESTING_GATES.md).

The public-brand migration remains a **proposal outside** supabase/migrations. Before approval, examine the SECURITY DEFINER execution context, search_path, role grants and leak resistance, local SQL/RLS tests, migration numbering and whether public brand changes require transactionally guaranteed auditing rather than today's best-effort Company Settings audit. The new field must remain independent of company_name (LMS and checkout) and legal_name (financial/legal records).

An independent legal-page approval safeguard may require a **different** proposed migration. The 22B-1 application-level publication hold is not database-enforced because Admin users can still call the Phase 22A website publishing RPC directly. Do not combine either proposal with a live database change without separate owner authorization.

## `legal_publication_hold.sql`: database-enforced legal publishing hold

| | |
|---|---|
| Status | **Proposal only.** Not approved, not applied, not part of the 22B-1 code scope |
| Why | In 22B-1 the legal hold is enforced by the Admin UI and the server action only. A signed-in Admin can still call `website_publish_document()` directly, so the hold is **not** database-enforced yet |
| Test | `legal_publication_hold_test.sql` (follows the `supabase/tests` conventions; ends with ROLLBACK) |
| Checked so far | Both files parse as valid PostgreSQL and PL/pgSQL (parser only; nothing executed) |

### What it adds

**Revision-specific approval, not a global switch:**
- `website_legal_approvals` records the approval of one exact legal-page revision: who approved it, when, and an optional reference note.
- Rows are immutable. Admins can read them; nobody can write them directly.

**`website_approve_legal_revision()`:**
- active Super Admin only;
- the revision must belong to that legal page;
- one approval per revision;
- audited as `website_document.legal_revision_approved`.

**`website_documents_legal_publication_guard`,** a trigger:
- a legal page can make a revision live only if that exact revision is approved;
- it fires for every writer: the 22A publish function, a direct RPC call, and direct SQL;
- any later edit or restore is a new revision and needs its own approval;
- unpublishing is always allowed;
- other page kinds are unaffected.

### When adopted

- **Application:**
  - the code-level `APPROVED_LEGAL_PAGE_KEYS` hold is replaced by "the latest revision has an approval";
  - a Super Admin approval screen is added;
  - the 22B-1 UI and action refusal stay as a first line.
- **Points for the reviewer:**
  - `approved_by` uses `on delete restrict`, which keeps approval provenance but prevents deleting that auth user;
  - confirm whether approval should also require a second person.

## `website_media_uploads.sql`: website media uploads (Phase 22B-3)

| | |
|---|---|
| Status | **Proposal only.** Not approved, not applied, not run against any database |
| Why | Phase 22A made `website-media` private with an Admin read policy only, so nothing can be uploaded. Phase 22B-3 needs uploads, safe clean-up of failed uploads, and a database check that a recorded image is the file actually stored |
| Design | `docs/requirements/PHASE_22B3_MEDIA_DESIGN.md` |
| Expected number | `20260101000043`, or the next free number, verified at approval time |
| Test | `website_media_uploads_test.sql` (M1–M9; follows the `supabase/tests` conventions; ends with ROLLBACK). In the plain-Postgres harness, run `website_media_uploads_harness_stub.sql` first; a real Supabase stack already has those columns |
| Checked so far | All three files parse as valid PostgreSQL, and every PL/pgSQL body parses (pglast parser only; nothing executed) |

### What it changes (website-media only)

1. **Bucket limits:** stays private; 5 MiB maximum; JPEG, PNG and WebP only. Storage refuses anything else at upload.
2. **Upload policy:**
   - active Admin or Super Admin only;
   - path `<uuid>/<name>.<jpg|jpeg|png|webp>`, one folder level, no `..`, no leading dot;
   - never at the path of a recorded image.
3. **No update policy:** nothing in `website-media` can be overwritten, upserted or moved.
4. **Delete policy:**
   - only files never recorded as media (failed or abandoned uploads);
   - the uploader's own at once, anyone's after 24 hours;
   - recorded images can never be deleted.
5. **`website_register_media_asset()`** (same signature) now requires:
   - the file exists in `website-media`;
   - it is the caller's own upload;
   - Storage's measured size and type equal the values recorded;
   - width and height are given.
6. **`website_update_media_asset()`** (same signature and rules) audits status **and** alt text before and after, plus the kind of change: `approved`, `approval_withdrawn`, `retired`, `restored` or `alt_text`.
7. **`website_incomplete_media_uploads()`:** lists unrecorded files older than 24 hours. Active Admins and Super Admins only.
8. **Two policy helpers:**
   - `website_media_path_is_valid(text)`;
   - `website_media_object_is_registered(text)`, which answers only for Admins.

### What it deliberately does not change

- Every other bucket and its policies. The test checks that every storage policy is bucket-scoped and that the website helpers appear in no other bucket's policy.
- The website-media read policy (Admin and Super Admin only).
- LMS tables.
- The 22A content rules: only Approved images publish; retired images cannot enter new content; images used by published content keep their approval.

### Existing tests that change on adoption

Two assertions in `supabase/tests/phase22a_website_foundation_test.sql` describe the pre-upload state and must be updated in the same change:

| Test | Today | After adoption |
|---|---|---|
| W1, lines 236–238 | "website-media has a write storage policy" fails on any write policy | Expect exactly the upload and delete policies above, and still **no** update policy |
| W6, line 486 | Records `…a001/hero.webp` with no stored file | First insert that object (as the Admin, with size and type metadata), because recording now requires the stored file |

### Points for the reviewer

1. **Content check location.** Postgres cannot read file bytes. The application checks the actual bytes after upload, and the database checks the stored size and type.
   - An active Admin calling the API directly could still record a file whose bytes are not a real image, as long as Storage accepted its declared type.
   - The bucket is private and approval shows a preview.
   - Phase 22C should re-encode images before public serving.
2. **Owner column.** Policies and checks use `coalesce(owner_id, owner::text)`, which covers both current Storage columns. Signed uploads should record the URL creator as owner; the isolated acceptance run must confirm this.
3. **24-hour window.** Another Admin can remove an unrecorded file only after 24 hours, so an upload in progress is never removed. The uploader can remove their own at any time.
