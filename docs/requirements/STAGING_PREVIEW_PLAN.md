# Private staging preview on the existing Hostinger Business plan

Updated 2026-10-23. **Prepared, not deployed.**
- Approved: the existing Hostinger Business plan as the staging platform.
- Not yet approved: deployment, creating the staging Supabase project, seeding, DNS changes.

Nothing has been deployed, no DNS has changed, no hosted database has been touched and no account has been created. Section 10 is the approval checkpoint.

## 1. Summary

- **One Node.js Web App** on the existing Business plan runs the ROICIANS LMS.
- **Supabase** stays the separate managed service for database, login and files, in a **new staging-only project** with fictional records.
- **Hostinger is connected to a dedicated release branch, `staging/lms-preview`.** It is pinned to the reviewed commit and moved only with the owner's approval, never to an active development branch.

**Web App slots:**
- Today: 1 of 5 used (your existing Node.js application; the WordPress sites don't use Web App slots).
- With ROICIANS staging: **2 of 5**, leaving 3 free.

The release branch is the stable LMS (`main`, `27f0ff2`) plus only these reviewed staging corrections:

| Commit | Change | Why |
|---|---|---|
| `1628076` | Uploads at the 10 MB limit | Next.js cuts request bodies passing through `proxy.ts` at 10 MB by default. A 10 MiB file plus form overhead exceeded that and failed on every host, `main` and DEV included (9.9 MiB passed). Raised to 12 MB, matching the existing server-action limit (see section 7 for the caveats) |
| `df056ea` | Public address for auth redirects; form-origin setting | Behind a proxy, `/auth/callback` and `/auth/confirm` redirected to `https://localhost:<port>`. They now use `NEXT_PUBLIC_APP_URL`. The optional `SERVER_ACTIONS_ALLOWED_ORIGINS` keeps forms working whatever Hostinger's proxy does with the host name |
| `798972b` + `f9068f6` | Private staging gate, fail-closed | A browser password prompt in front of every path except exactly the Razorpay webhook. Explicit `STAGING_MODE=1`; missing, empty or invalid credentials refuse everything. Off unless configured |
| `2ece759` | Fail-closed staging seeder | Creates the four fictional logins only in an empty, explicitly confirmed staging project |
| `595354d` + this commit | Read-only verifier and this plan | Repeatable post-deploy checks without keys |

With the staging settings unset, no completed LMS feature changes behaviour. Two exceptions, both corrections:
- uploads right at 10 MB now succeed;
- the auth routes use the configured public address when one is set.

## 2. Verification results (2026-10-23)

| # | Check | Result |
|---|---|---|
| 1 | Web App capacity | 2 of 5 with staging (section 1). You confirm the free slot in hPanel |
| 2 | Next.js 16.3.4 Webpack production build | Passed. `next build --webpack` compiles in about 27 s; `next start` honours Hostinger's `PORT` |
| 3 | Supabase variables and auth callback URLs | Variable names fixed (section 5). Both auth routes redirect to the public address behind a simulated proxy |
| 4 | Staging gate fails closed | Passed. `STAGING_MODE=1` without valid credentials → 503 on pages, private APIs and build files. Wrong or missing password → 401. Correct password → 200, `noindex`, `private, no-store`. With staging off, headers and caching are unchanged |
| 4a | No bypass through `proxy.ts` exclusions | **Fixed and tested.** The old matcher let these skip the gate: any path ending in an image extension (e.g. `/admin/students/x.png`); look-alike prefixes (`/favicon.icox`, `/api/razorpay/webhooks`, `/api/razorpay/webhook/extra`); build files; and `/_next/image`. Now only the exact `/api/razorpay/webhook` path is excluded. The regression test fails when run against the old matcher |
| 4b | Staging password stays secret | It is never written into the build output, and the value set in hPanel at run time is the one used |
| 5 | Uploads | 10 MiB accepted, 12.3 MiB refused (app level). Hostinger's own limits are still to test (section 7) |
| 6 | Razorpay TEST webhook | Only the exact path is outside the gate. A missing, empty or wrong signature → 400 before any database access; no webhook secret → 503 |
| 7 | Fail-closed seeding | 16 unit tests; with no settings it refuses and writes nothing |
| 8 | Four production hostnames | Section 9 |

Totals:
- type check: passed;
- lint: passed (whole repository);
- unit and component tests: see the release report;
- staging verifier against a local gated production build: 24 of 24.

## 3. What is in the release branch, and what is not

- **In:** every completed LMS feature on `main`, plus the corrections above.
- **Not in:** Phase 22B-3 (website images; awaiting approval) and any unreviewed work.

`staging/lms-preview` will only move when you approve a new reviewed commit. For extra safety you can turn on GitHub branch protection for `staging/*` (Settings → Branches); that's optional and your choice.

## 4. Staging address

Use **Hostinger's temporary domain** first: no DNS change, no extra approval. A subdomain of your own domain can come later, with your DNS approval. Below, `<staging host>` means that address without `https://`.

## 5. Owner checklist (in order; stop at each approval)

### A. Supabase staging project (in your browser; secrets stay on your computer)

1. supabase.com → **New project**:
   - name `roicians-staging`;
   - region Mumbai (`ap-south-1`);
   - a new database password, kept in your password manager.

   It must be a new project, separate from DEV and production. *(Approval: create the hosted project.)*
2. **Project Settings → General:** note the **Project ref** (20 characters).
3. **Project Settings → API:** note the **Project URL**, the **anon public** key and the **service_role** key. Paste them only into hPanel and your own terminal.
4. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up".
5. **Authentication → URL Configuration** (once the temporary domain is known, step B3):
   - **Site URL** `https://<staging host>`;
   - **Redirect URLs:** add `https://<staging host>/**`.
6. **Apply migrations 1–42** from your computer, in a checkout of `staging/lms-preview`. *(Approval: hosted migration.)*

   ```
   npx supabase login
   npx supabase link --project-ref <staging ref>   # the name shown must be roicians-staging
   npx supabase db push --dry-run                   # must list exactly migrations 1-42
   npx supabase db push
   ```

7. **Create the four fictional logins.** *(Approval: seeding.)*

   ```
   export ROICIANS_TARGET=staging
   export STAGING_PROJECT_REF=<staging ref>
   export PROTECTED_PROJECT_REFS=<DEV ref>,<production ref>
   export NEXT_PUBLIC_SUPABASE_URL=https://<staging ref>.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=<staging service_role key>
   node scripts/staging/seed-staging-users.mjs --confirm <staging ref> --dry-run
   node scripts/staging/seed-staging-users.mjs --confirm <staging ref>
   ```

   It refuses, and writes nothing, unless all of these hold:
   - the target is staging;
   - the URL matches the typed ref;
   - your DEV and production refs are listed as protected;
   - the key belongs to the same project;
   - migrations are present;
   - the project holds no records or logins other than its own.

   It prints four passwords once:
   - `superadmin@roicians-staging.example`
   - `admin@roicians-staging.example`
   - `trainer@roicians-staging.example`
   - `student@roicians-staging.example`

   The `.example` domain can never receive email.

### B. Hostinger hPanel (do not click Deploy until approved)

1. **Websites:** confirm 1 Node.js Web App in use and a free slot.
2. **Websites → Add website → Node.js Web App → Import from GitHub.** Authorise access to `dineshchabbara-hash/roiciansindia` only.
   - **Branch:** `staging/lms-preview`.
   - **Domain:** choose the **temporary domain**.
   - If hPanel offers automatic deployment on push, it's safe on this branch, which only moves with your approval.
3. **Build settings:**

   | Setting | Value |
   |---|---|
   | Framework preset | Next.js |
   | Node.js version | 22.x |
   | Root directory | `/` |
   | Install command | `npm ci` |
   | Build command | `npm run build -- --webpack` |
   | Output directory | `.next` |
   | Start command | `npm start` |

4. **Environment variables:** add them manually, **before the first build**. Use these names exactly; don't use the Database Connect wizard's `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `DATABASE_URL`.

   | Name | Value |
   |---|---|
   | `STAGING_MODE` | `1` |
   | `STAGING_ACCESS_USER` | a user name you choose (no `:`) |
   | `STAGING_ACCESS_PASSWORD` | 16–256 random characters; must not contain the user name; no spaces at either end |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key |
   | `SUPABASE_SERVICE_ROLE_KEY` | staging service_role key |
   | `NEXT_PUBLIC_APP_URL` | `https://<staging host>` |
   | `SERVER_ACTIONS_ALLOWED_ORIGINS` | `<staging host>` (host only) |
   | `RAZORPAY_KEY_ID` | `rzp_test_…` (the app refuses live keys) |
   | `RAZORPAY_KEY_SECRET` | Razorpay test key secret |
   | `RAZORPAY_WEBHOOK_SECRET` | the secret you set in step C2 |
   | `APP_TIMEZONE` | `Asia/Kolkata` |
   | `NEXT_TELEMETRY_DISABLED` | `1` |

   **Do not add:**
   - `SUPABASE_DB_URL` or `DATABASE_URL`;
   - email or SMS keys;
   - any DEV or production value.

   If any staging value is missing or invalid, the site refuses everyone (503); fix the value and restart.
5. **SSL:** the temporary domain must show a valid HTTPS certificate.
6. **Cache and CDN:** if hPanel offers a cache or CDN for this website, leave it **off** for staging. The app already marks every staging response uncacheable.
7. **Deploy:** only after section 10 is approved.

### C. Razorpay (Test Mode)

1. **API Keys:** generate a test key; put the ID and secret in hPanel.
2. **Webhooks → Add:**
   - URL `https://<staging host>/api/razorpay/webhook`;
   - your chosen secret;
   - events `payment.captured`, `refund.processed` and `refund.failed`.

## 6. After deploy: verification before your own testing

1. **Automatic check (read-only, on your computer):**

   ```
   export STAGING_URL=https://<staging host>
   export STAGING_ACCESS_USER=<gate user>
   export STAGING_ACCESS_PASSWORD=<gate password>
   node scripts/staging/verify-staging.mjs
   ```

   It runs 24 checks:
   - the gate covers pages, private APIs, build files, image-like paths and webhook look-alikes;
   - pages load with the password and are `noindex` and uncacheable;
   - signed-out visitors go to their login;
   - auth redirects use the public address;
   - only the exact webhook path is open, and it rejects unsigned calls.

   It must report 24 passed.
2. **The four roles:** sign in at `/login/admin` (Super Admin, then Admin), `/login/trainer` and `/login/student`.
3. **First fictional records (about 20 minutes, as Admin):**
   1. Create a Program, then a Batch with the staging Trainer assigned.
   2. Create an Enrollment for the staging Student, with a payment plan.
   3. Add a class session, a material and an assignment.
4. **Uploads on Hostinger:** section 7.
5. **Test payment:** as Student, pay one instalment with a Razorpay test card. Confirm the receipt, and the entry in the Admin ledger.

## 7. Uploads: what is proven and what still needs testing on Hostinger

- **Proven locally (production build, gate on):** 9.9, 10 and 11.5 MiB uploads reach the app; 12.3 MiB is refused by the 12 MB limit.
- **The fix uses an experimental Next.js setting.** `experimental.proxyClientMaxBodySize` is documented by Next.js 16.3.4 as **experimental**, so its name or behaviour may change in a later Next.js version. Re-check it on every Next.js upgrade; the upload matrix below is the test.
- **Not yet known, to test on staging:**
  - **Hostinger's front proxy limit.** It may refuse large requests before they reach the app; that shows as an error page from the host rather than from the LMS.
  - **Concurrent uploads.** The app holds each upload in memory twice (proxy buffer plus form parsing), so three simultaneous 10 MiB uploads use roughly 60–80 MB. Hostinger's process and memory limits under that load are unmeasured.

Upload matrix (a 4.9 MiB image and a 9.9 MiB PDF each; then the same 9.9 MiB PDF from three browser tabs at once):

| Portal | Where | 5 MiB image | 10 MiB document |
|---|---|---|---|
| Admin | Student → Documents | — | ✓ |
| Admin | Batch → Materials | ✓ | ✓ |
| Admin | Batch → Assignment attachment | ✓ | ✓ |
| Trainer | Batch → Materials | ✓ | ✓ |
| Trainer | Batch → Assignment attachment | ✓ | ✓ |
| Student | Enrollment → Assignment submission | ✓ | ✓ |

Also check the Student profile photo (2 MiB) and the Company Settings logo (1 MiB).

## 8. What you'll be able to test

- **Super Admin:**
  - Ready: Company Settings; Admin accounts; Programs, Students, Trainers and Batches; reports and CSV exports; audit log; website pages and Program website management.
  - Not yet: website images (22B-3); the public website.
- **Admin:**
  - Ready: Programs, Batches and sessions; Students, Trainers and portal logins; enrollments and payment plans; attendance, materials, assignments and certificates (inside each Batch or Enrollment); payments (offline, Razorpay test), receipts and refunds; notifications; website content.
  - Placeholders: the all-batches Attendance, Materials, Assignments and Certificates pages and Leads say "Coming soon".
- **Trainer:**
  - Ready: assigned Batches and Students; sessions and attendance; materials; assignments and submission review; notifications; profile.
  - Not yet: no single per-Student progress page.
- **Student:**
  - Ready: enrollments; materials and assignment submission; attendance; certificates; payment plan, Pay Online (test) and receipts; profile; notifications.
- **Not in the preview:**
  - email and SMS;
  - forgot-password emails (demo logins get passwords directly);
  - Zoho CRM;
  - live payments.

## 9. Production hostnames (future decision; does not delay staging)

The Phase 22 design proposes four hosts: `roicians.in`, `student.`, `trainer.` and `admin.roicians.in`. Corrected capacity:

| Option | Web Apps used | Fits the Business plan? |
|---|---|---|
| Four separate production Web Apps + staging + existing app | 6 | **No** (limit 5) |
| Four production Web Apps + existing app, staging removed at go-live | 5 | Only exactly, with no spare slot and no staging |
| **One production Web App serving all four hosts** (Hostinger "parked domain" aliases) + existing app (+ staging) | 2 (3) | Yes, **if** Hostinger confirms parked domains reach a Node.js Web App. Hostinger documents parked domains as showing the main site's content, but its Node.js guidance treats each domain as its own website, and no document confirms aliases for Node.js apps |
| **One production Web App on one host with path-based portals** (`/admin`, `/trainer`, `/student`, as the app works today); the subdomains become simple hPanel redirects | 2 (3) | Yes. Redirects use no Web App slot. Trade-off: one cookie host instead of the design's per-portal hosts, which is a Phase 22D design decision |

**Next step (no cost):** ask Hostinger support whether a parked or alias domain can serve an existing Node.js Web App. Or test it later with a spare subdomain, with your DNS approval. Decide at Phase 22D/25. The staging preview needs one slot either way.

## 10. Approval checkpoint

Each item needs your separate approval:
1. **Release branch:** approve `staging/lms-preview` at the reviewed commit given in the release report.
2. **Supabase:** create the staging project (5A.1) and apply migrations 1–42 (5A.6).
3. **Logins:** seed the four fictional logins (5A.7).
4. **Razorpay:** set up the test keys and webhook (5C).
5. **Deploy:** in hPanel (5B.7), then run section 6 and section 7 and report the results.

**Not requested and not done:**
- merging into `main` or merging 22B-3;
- activating CI;
- DNS changes;
- any change to DEV or production.
