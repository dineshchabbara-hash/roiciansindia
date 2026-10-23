# Phase 22B-3: Website Media Management (design)

**Date:** 2026-10-23.

**Branch:** `claude/phase22b3-website-media-management`, created from `main` at `27f0ff2` (Phase 22B-2 merged).

**Status:** in development. Application code can be built and unit-tested now. Uploading needs the proposed migration (§6), which is **not applied** anywhere.

## 1. Objective

Admin and Super Admin teams upload, manage, preview, approve and select images for the website without developer help.

## 2. What Phase 22A already provides (reused, unchanged)

| Item | Behaviour |
|---|---|
| `website_media_assets` | One row per image: path, type, size, dimensions, alt text, status, approval, version |
| Database checks on each row | `<uuid>/<name>` path; JPEG, PNG or WebP; 1 byte to 5 MiB; 1–10000 px; alt text ≤ 250; Approved needs alt text |
| `website-media` bucket | **Private.** Active Admins and Super Admins can read. There is no upload, change or delete policy yet |
| `website_register_media_asset()` | Records an uploaded file as **Draft**. Audited as `website_media_asset.registered` |
| `website_update_media_asset()` | Changes alt text and status, with version check. Audited as `website_media_asset.updated` |
| Content rules | Retired images cannot be put into new content. Publishing refuses any image that is not Approved. An image used by published content cannot be withdrawn or retired |
| `website_revision_media` | Records which images each version uses |

## 3. Upload flow

The flow works on any standard Next.js host. The file itself never passes through the application server on the way in, so the roughly 4.5 MB request-body limit on Vercel functions does not apply.

1. **Browser.** The Admin picks a file. The browser reads its first bytes and checks the type and the 5 MiB size. This is for quick feedback only; nothing here is trusted.
2. **Server action: prepare.**
   - checks the role;
   - checks the declared size and type;
   - builds a safe, unique path, `<random uuid>/<cleaned name>.<extension for the detected type>`;
   - creates a **one-time signed upload URL** with the Admin's own session. This needs the proposed upload policy. The URL is for that one path only, cannot overwrite, and expires after 2 hours.
3. **Browser to Storage.** The file goes straight to the private bucket. The proposed bucket limits refuse anything over 5 MiB or of another type.
4. **Server action: complete.**
   - checks the role and the path;
   - downloads the stored file with the Admin's session;
   - **checks the actual bytes:** a real JPEG, PNG or WebP structure, the type matching the declared type, 1 byte to 5 MiB, and readable dimensions of 1–10000 px. The extension and the browser's claim are not trusted;
   - if the file is not valid, deletes it and explains why;
   - otherwise records it with `website_register_media_asset()` as **Draft**. The proposed database check confirms the file exists, the caller uploaded it, and the stored size and type match what is being recorded;
   - if recording fails, deletes the file.

**Unfinished uploads and orphaned files:**
- Every failure in step 4 deletes the file straight away. The proposed delete policy lets the uploader delete their own unrecorded file.
- If the browser closes between steps 3 and 4, or a clean-up fails, the file is left unrecorded. After 24 hours it is listed on the Media page under "Incomplete uploads", and any active Admin can remove it.
- **Recorded files can never be deleted** through Storage. Retire them instead, so content history never loses an image.

## 4. States and approval

| From | To | Rule | Confirmation |
|---|---|---|---|
| Draft | Approved | Alt text required (database), and must be suitable (application, §5) | Yes |
| Approved | Draft ("Withdraw approval") | Refused while published content uses the image | Yes |
| Draft or Approved | Retired | Refused while published content uses the image | Yes |
| Retired | Draft ("Restore") | Needs approval again before use | No |
| Any | Alt text change | Version-checked | No |

Every change is audited by the database. The proposal adds before and after alt text and status to the `website_media_asset.updated` entry (§6).

## 5. Alt text

- **Database:** required for approval; ≤ 250 characters; plain text, with no markup and no "₹".
- **Application (stricter):**
  - 5 to 250 characters;
  - not just a file name (such as `IMG_1234.jpg`);
  - no markup and no prices, the same rules as all website text.

## 6. Proposed migration (review only)

`docs/proposed-migrations/website_media_uploads.sql`, with `website_media_uploads_test.sql` (M1–M9) and, for the plain-Postgres test harness only, `website_media_uploads_harness_stub.sql`. **Not applied.** The proposals README lists two existing 22A test assertions that change on adoption.

| Change | Purpose |
|---|---|
| Bucket limits on `website-media` | 5 MiB maximum; JPEG, PNG and WebP only; private |
| Upload (INSERT) policy | Active Admin or Super Admin only, into `website-media` only, with a safe `<uuid>/<name>` path, never at a recorded file's path |
| No change (UPDATE) policy | No overwriting, including upsert |
| Delete policy | Active Admin or Super Admin; only **unrecorded** files; only their own, or anyone's after 24 hours |
| `website_register_media_asset()` cross-check | The file must exist in `website-media`, have been uploaded by the caller, and have the stored size and type being recorded |
| Richer audit | `website_media_asset.updated` records before and after status and alt text |
| `website_incomplete_media_uploads()` | Lists unrecorded files older than a minimum age (at least 1 hour), for Admins only |

**Unchanged:** every other bucket and its policies; LMS tables; existing website rules.

## 7. Choosing images in content

| Where | Image slots |
|---|---|
| Home, About, Corporate Training, Institutions, Programs listing, Upcoming Batches, Program | Main image, Social sharing image |
| Contact, legal pages | Social sharing image |
| Navigation, footer | None |
| Hero and banner sections | Section image |

- The picker offers **Approved** images only.
- If an image that is already chosen is no longer Approved, the editor warns and Publish is disabled with the reason. The database refuses it anyway.
- The structured preview shows the chosen images with their alt text.

## 8. Privacy, previews and hosting

- **The bucket stays private.** No public URL is created.
- **Admin previews** use signed links valid for 10 minutes, created with the Admin's own session and placed only on Admin pages that are already `no-store` and `noindex`. Anyone who obtained such a link could view that one image until it expires.
- **Images are shown with plain `<img>` tags.** The Next.js image optimizer is not used, so private images are never stored in its cache.
- **Before public serving (Phase 22C):**
  - re-encode the image, or remove its metadata (such as camera location in EXIF);
  - serve approved images only, with a fixed content type and `nosniff`;
  - decide on CDN caching.
  These belong to 22C and are not built here.

## 9. What can be acceptance-tested, and when

| Feature | Without the migration | With the approved migration (isolated stack) |
|---|---|---|
| Media library, details, alt text, approve, withdraw, retire, restore | Yes, with images placed by test fixtures | Yes |
| Choosing images in pages and Programs; preview; publish refused with an unapproved image | Yes, with fixture images | Yes |
| Uploading through the screen | **No** (no upload policy) | Yes |
| Overwrite refused; bucket limits; content check on stored bytes | **No** | Yes |
| Removing incomplete uploads | **No** | Yes |
| Richer audit entries | **No** | Yes |

The prepared browser suite (`e2e/phase22b3-website-media.spec.ts`) assumes the migration is applied. It runs only in an isolated local stack.
