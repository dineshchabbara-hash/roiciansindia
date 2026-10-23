# Private staging preview on the existing Hostinger Business plan

Updated 2026-10-23. **Plan and preparation only.** Nothing has been deployed, no DNS has changed, no hosted database has been touched, and no account has been created. The final step is the owner's deployment approval (section 9).

## 1. Summary

The ROICIANS LMS runs as one Next.js Web App on the **existing Hostinger Business plan**. Supabase stays the separate managed service for database, login and file storage, in a **new staging-only project** holding fictional records.

The verification found **no incompatibility that needs a different host or an upgrade**. It found three issues in the application, two of which affect any self-hosting. Each is fixed by a small change, ready for approval on branch `claude/training-lms-architecture-nir7uy`:

| Commit | Change | Why |
|---|---|---|
| `1628076` | Uploads at the 10 MB limit | Next.js cuts request bodies passing through `proxy.ts` at 10 MB by default. A 10 MiB file plus form overhead exceeded that and failed, on every host, `main` and DEV included (9.9 MiB passed). Raised to 12 MB, matching the existing server-action limit |
| `df056ea` | Auth redirects and form origin behind a proxy | Behind a proxy, `/auth/callback` and `/auth/confirm` sent people to `https://localhost:<port>`. They now use `NEXT_PUBLIC_APP_URL`. An optional `SERVER_ACTIONS_ALLOWED_ORIGINS` keeps every form working if Hostinger's proxy does not pass the public host on |
| `798972b` | Private staging gate | Hostinger has no built-in password protection for Node.js Web Apps. A browser password prompt in front of the whole site, plus "do not index", switched on only by `STAGING_ACCESS_PASSWORD`. Off everywhere else |
| `2ece759` | Fail-closed staging seeder | Creates the four test logins only in an empty, explicitly confirmed staging project |
| (this commit) | Read-only staging verifier and this plan | Repeatable post-deploy checks without any keys |

The branch is `main` (`27f0ff2`) plus these commits. No completed LMS feature changes behaviour unless the new staging settings are set. Two exceptions, both corrections:
- uploads right at 10 MB now succeed;
- the two auth routes use the configured public address when one is set.

`proxy.ts` and the two auth routes are shared login code, so these commits need your approval before deployment.

## 2. Pre-deployment verification (your eight points)

| # | Check | Result | How it was checked |
|---|---|---|---|
| 1 | Free Web App slot | **You confirm in hPanel** (needs 1 of 5) | Section 4, step 1 |
| 2 | Next.js 16.3.4 Webpack build | **Verified.** `next build --webpack` succeeds (compiled in 26–29 s, about 70 s in total); `next start` honours Hostinger's `PORT`; the build keeps the 12 MB server-action limit | Local production builds of `main` and of the branch, with placeholder values and no DEV access |
| 3 | Supabase variables and auth callback URLs | **Verified.** The variable names below must be used exactly; Hostinger's own Supabase guide uses different names (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) that this app does not read. The callback fix was proven behind a simulated proxy | Code review plus local tests |
| 4 | Secure access protection | **Verified locally.** No password → 401; wrong password → 401; correct password → pages load, marked `noindex`; a password under 16 characters locks the whole site (503); the webhook bypasses the gate | 15 unit tests plus 13 checks against the running build |
| 5 | 5 MiB and 10 MiB uploads in all portals | **Fixed and verified at the app level:** 9.9, 10 and 11.5 MiB accepted; 12.3 MiB refused. **To confirm on Hostinger:** its front proxy's own upload limit, which nobody outside Hostinger can see | Local production build; the post-deploy upload matrix (section 7) |
| 6 | Razorpay TEST webhooks | **Verified.** The webhook route is outside the gate, reads the raw body for the signature check, and rejects an unsigned call with 400 | Local production build |
| 7 | Staging-only Supabase project and fail-closed seeding | **Prepared.** The seeder refuses unless every check passes (section 5.4). 16 unit tests pass; the no-settings run refused and wrote nothing. Its live checks first run in your `--dry-run` on the staging project | Unit tests plus a local refusal run |
| 8 | Four production hostnames | **Answered in section 8:** the app is designed as one instance for all four. Hostinger documents each domain or subdomain as its own website, so expect four Web Apps from the same branch, which fit the Business plan | Phase 22 design §3; Hostinger documentation |

The full unit suite passes on the branch (154 files, 1,969 tests), as do the type check, lint and formatting of the changed files.

## 3. Staging address

Pick one; both are free:
- **A. Hostinger's temporary domain** for the new Web App. **No DNS change**, so it needs no extra approval. This is the fastest route.
- **B. A subdomain of your domain**, e.g. `lms-staging.roicians.in`. Creating it in hPanel adds a DNS record, so it needs your separate DNS approval.

Below, `<staging host>` means the chosen address without `https://`.

## 4. Hostinger hPanel setup (do not click Deploy until section 9 is approved)

Labels may differ slightly in your hPanel.

1. **Check the slot:** hPanel → **Websites**. Count the Node.js Web Apps; staging needs one free of five.
2. **Add the app:** **Websites → Add website → Node.js Web App** (or **Web App**). Choose **Import from GitHub**, authorise Hostinger's GitHub app for `dineshchabbara-hash/roiciansindia` only, and pick:
   - **Branch:** `claude/training-lms-architecture-nir7uy` (switch to `main` once these commits are merged). Hostinger rebuilds on each push to that branch.
   - **Domain:** the temporary domain (option A) or the approved subdomain (option B).
3. **Build settings:**

   | Setting | Value |
   |---|---|
   | Framework preset | Next.js |
   | Node.js version | **22.x** (what CI and all local tests use; 24.x is supported but untested here) |
   | Root directory | `/` |
   | Install command | `npm ci` |
   | Build command | `npm run build -- --webpack` |
   | Output directory | `.next` |
   | Start command | `npm start` (Hostinger supplies `PORT`) |

4. **Environment variables:** use **Add manually**, or **Import from .env** with a file kept only on your computer. Add them **before the first build**, because `NEXT_PUBLIC_` values are built into the app. Don't use the Database Connect wizard's names or its `DATABASE_URL`; this app needs only these:

   | Name | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging ref>.supabase.co` | Staging project only |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon (public) key | |
   | `SUPABASE_SERVICE_ROLE_KEY` | staging service-role key | Secret; server-only |
   | `NEXT_PUBLIC_APP_URL` | `https://<staging host>` | Used for auth redirects and reset links |
   | `SERVER_ACTIONS_ALLOWED_ORIGINS` | `<staging host>` | Host only, no `https://`. Keeps forms working whatever the proxy does |
   | `STAGING_ACCESS_USER` | e.g. `staging` | |
   | `STAGING_ACCESS_PASSWORD` | 16+ random characters | Secret. Keep it in your password manager |
   | `RAZORPAY_KEY_ID` | `rzp_test_…` | The app refuses live keys |
   | `RAZORPAY_KEY_SECRET` | test key secret | Secret |
   | `RAZORPAY_WEBHOOK_SECRET` | secret you choose in section 6 | Secret |
   | `APP_TIMEZONE` | `Asia/Kolkata` | |
   | `NEXT_TELEMETRY_DISABLED` | `1` | |

   **Do not add:**
   - `SUPABASE_DB_URL` or `DATABASE_URL`: the app doesn't use them at run time;
   - email or SMS keys (Phase 18b not built);
   - any DEV or production value.

   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are optional; without them the app uses its in-memory rate limiter.
5. **SSL:** confirm the address shows a valid certificate (Hostinger issues it automatically). The staging password must only travel over HTTPS.
6. **Stop here:** Deploy is section 9's final step.

## 5. Supabase staging project (on your computer; secrets never leave it)

1. **Create** a new project (e.g. `roicians-staging`, region Mumbai) with its own database password. It must not be DEV or production.
2. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". Admins and the seeder create accounts through the Admin API, which this setting doesn't affect.
3. **Authentication → URL Configuration:**
   - **Site URL:** `https://<staging host>`.
   - **Redirect URLs:** add `https://<staging host>/**`. That covers `/auth/callback?next=/reset-password` and `/auth/confirm`, and nothing outside staging.
4. **Apply migrations 1–42** (needs approval):

   ```
   npx supabase login
   npx supabase link --project-ref <staging ref>   # confirm the name shown is the STAGING project
   npx supabase db push --dry-run                   # lists migrations 1-42; nothing applied
   npx supabase db push
   ```

5. **Create the four test logins** (needs approval):

   ```
   export ROICIANS_TARGET=staging
   export STAGING_PROJECT_REF=<staging ref>
   export PROTECTED_PROJECT_REFS=<DEV ref>,<production ref>
   export NEXT_PUBLIC_SUPABASE_URL=https://<staging ref>.supabase.co
   export SUPABASE_SERVICE_ROLE_KEY=<staging service-role key>
   node scripts/staging/seed-staging-users.mjs --confirm <staging ref> --dry-run
   node scripts/staging/seed-staging-users.mjs --confirm <staging ref>
   ```

   It refuses, and writes nothing, unless all of these hold:
   - the target is staging;
   - the URL matches the typed ref;
   - DEV and production are listed as protected and excluded;
   - a JWT-style service key belongs to the same project;
   - migrations are present;
   - the project holds no records or logins other than its own.

   It prints four fresh passwords once, on your screen:
   - `superadmin@roicians-staging.example`
   - `admin@roicians-staging.example`
   - `trainer@roicians-staging.example`
   - `student@roicians-staging.example`

   The `.example` domain can never receive email.
6. **First fictional records:** about 20 minutes as Admin in the app, which also exercises the screens:
   1. Create a Program, then a Batch with the staging Trainer assigned.
   2. Open the staging Student's record and create an Enrollment with a payment plan.
   3. Add a class session, a material and an assignment.

   The Trainer and Student portals then show real content.

## 6. Razorpay TEST mode

In the Razorpay Dashboard, switched to **Test Mode**:
1. **API Keys:** generate a test key; put the ID and secret in hPanel (section 4).
2. **Webhooks → Add:**
   - URL `https://<staging host>/api/razorpay/webhook`;
   - a secret you choose (also `RAZORPAY_WEBHOOK_SECRET`);
   - events `payment.captured`, `refund.processed` and `refund.failed`.

The webhook bypasses the staging password by design, and every call must carry Razorpay's valid signature. Use only Razorpay's test cards and UPI IDs.

## 7. Verification after deploy, before your personal testing

1. **Automatic, read-only (on your computer):**

   ```
   export STAGING_URL=https://<staging host>
   export STAGING_ACCESS_PASSWORD=<gate password>
   node scripts/staging/verify-staging.mjs
   ```

   It runs 13 checks:
   - the gate refuses wrong or missing passwords;
   - pages load and are marked `noindex`;
   - signed-out visitors go to the right login;
   - both auth routes redirect to `https://<staging host>`, not localhost;
   - the webhook is reachable and rejects unsigned calls.

   Against the local build it passed 13 of 13.
2. **Upload matrix on Hostinger.** This settles the one thing that can't be tested outside Hostinger, its proxy upload limit. Use a 4.9 MiB image and a 9.9 MiB PDF for each:

   | Portal | Where | 5 MiB image | 10 MiB document |
   |---|---|---|---|
   | Admin | Student → Documents | — | ✓ |
   | Admin | Batch → Materials | ✓ | ✓ |
   | Admin | Batch → Assignment attachment | ✓ | ✓ |
   | Trainer | Batch → Materials | ✓ | ✓ |
   | Trainer | Batch → Assignment attachment | ✓ | ✓ |
   | Student | Enrollment → Assignment submission | ✓ | ✓ |

   Also check the 2 MiB photo on the Student profile and the 1 MiB logo in Company Settings. If a large file fails only on Hostinger with an error page from the host, that's the proxy limit. Raise it with Hostinger support before going further. The application side is already proven.
3. **Each role:** sign in at `/login/admin` (Super Admin, then Admin), `/login/trainer` and `/login/student`. Walk the readiness list in section 10.
4. **Payment:** as Student, pay one instalment with a Razorpay test card. Confirm it shows as paid with a receipt, and that the Admin ledger shows it.

## 8. The four production hostnames

- **Design:** one application serves `roicians.in`, `student.roicians.in`, `trainer.roicians.in` and `admin.roicians.in`, routing by hostname. That routing is Phase 22D, not built yet.
- **Hostinger:** each domain or subdomain is its own website. The documentation has no option to attach several domains to one Node.js Web App. Unless Hostinger support confirms such an alias option, plan on **four Web Apps deployed from the same branch with the same settings**, each with its own `NEXT_PUBLIC_APP_URL`. The app keeps no state on the server (sessions are cookies, data is in Supabase), so separate instances behave the same.
- **Fit on Business:**
  - Slots: 4 production + 1 staging = **5 of 5**. Staging can be removed or reused at go-live.
  - Processes: Hostinger counts about 10–11 per Next.js app, so about 55 of the plan's 120.
  - Memory: within the plan's 3 GB.
- **Trade-offs to plan for at Phase 25:**
  - each release builds four times;
  - instances update a few minutes apart;
  - the in-memory rate limiter counts per instance, so add Upstash for production.

None of this blocks the staging preview.

## 9. Approval checkpoint (nothing below happens without your approval)

1. Approve the four code commits on `claude/training-lms-architecture-nir7uy` (section 1). Choose:
   - **deploy that branch now** (fastest), or
   - **merge into `main` first** via a pull request, then deploy `main`.
2. Choose the staging address: temporary domain (no DNS), or a subdomain (DNS approval).
3. Create the staging Supabase project and apply migrations 1–42 (section 5, steps 1–4).
4. Create the four test logins (section 5, step 5).
5. Set up Razorpay test keys and the webhook (section 6).
6. Click **Deploy** in hPanel. Then run section 7 and report the results; I'll diagnose any failure.

## 10. What you'll be able to test (from `main`)

- **Super Admin:**
  - Ready: login and dashboard; Company Settings; Admin accounts; Programs, Students, Trainers and Batches; reports and CSV exports; audit log; website pages and Program website management.
  - Not yet: website images (22B-3, awaiting approval); the public website (22C–22J).
- **Admin:**
  - Ready: Programs, Batches and sessions; Students, Trainers and portal logins; enrollments and payment plans; attendance, materials, assignments and certificates (inside each Batch or Enrollment); payments (offline, Razorpay test), receipts and refunds; in-app notifications; website content.
  - Placeholders: the all-batches Attendance, Materials, Assignments and Certificates pages say "Coming soon". Leads (Phase 23) is not built.
- **Trainer:**
  - Ready: dashboard; assigned Batches and Students; sessions and attendance; materials; assignments and submission review; notifications; profile.
  - Not yet: no single per-Student progress page.
- **Student:**
  - Ready: dashboard; enrollments; materials and assignment submission; attendance; certificates; payment plan, Pay Online (test) and receipts; profile; notifications.
- **Not in the preview:**
  - email and SMS delivery;
  - forgot-password emails (Supabase's built-in mailer only reaches project team members; demo logins get passwords directly);
  - Zoho CRM;
  - live payments.
