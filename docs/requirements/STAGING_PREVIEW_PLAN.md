# Private staging preview: plan for approval

Prepared 2026-10-23. **Plan only.** Nothing has been purchased, created, configured or deployed. Every step below that touches an account, a hosted database or a deployment waits for the owner's approval.

## 1. Recommendation in one paragraph

Deploy the latest stable `main` (`27f0ff2`) to **Vercel Pro** ($20 a month, monthly billing, cancel any time). Use a **new, separate Supabase project on the free plan** with fictional data only, and **Razorpay in Test Mode**. Turn on Vercel Authentication for **all deployments**, so only people the owner admits can open the site. The LMS's own role logins sit behind that. This needs **no code change** and no domain or DNS change. The owner keeps every key and password on their own computer.

Hostinger can run this app, but for a first private preview it means an application code change (a staging password gate) and more setup risk. It is the better choice only if the owner already has a suitable Hostinger plan and prefers to wait for that change. Section 4 has the details.

## 2. What the preview will show (from `main`, `27f0ff2`)

Legend: **Ready** = built, tested and demonstrable. **Partly** = works, with the gap noted. **Not built** = do not demo as working.

### Super Admin

| Feature | Status | Where |
|---|---|---|
| Login and dashboard | Ready | `/login/admin`, `/admin` |
| Company Settings | Ready | `/admin/settings` |
| Admin account management | Ready (Super Admin only) | `/admin/admins` |
| Programs, Students, Trainers, Batches | Ready | `/admin/programs`, `/admin/students`, `/admin/trainers`, `/admin/batches` |
| Financial reports and CSV exports | Ready | `/admin/reports`, `/admin/payments` |
| Audit log | Ready | `/admin/audit-log` |
| Website Management: pages, drafts, preview, publishing, history | Ready (22B-1) | `/admin/website` |
| Website Management: Program website content, display groups, featured | Ready (22B-2) | `/admin/website/programs`, `/groups`, `/featured` |
| Website Management: image library and uploads | **Not on `main`** (22B-3 awaits approval) | — |
| Public website that shows published content | **Not built** (22C–22J). `/` is a placeholder | — |

### Admin

| Feature | Status | Where |
|---|---|---|
| Login and dashboard | Ready | `/login/admin`, `/admin` |
| Program and Batch management, class sessions | Ready | `/admin/programs`, `/admin/batches` |
| Student and Trainer management, Student portal logins | Ready | `/admin/students`, `/admin/trainers` |
| Enrollments and payment plans | Ready | `/admin/enrollments` |
| Attendance | Ready inside each Batch's sessions. The all-batches page `/admin/attendance` says "Coming soon" | `/admin/batches/[id]/sessions/…/attendance` |
| Materials and assignments | Ready inside each Batch. `/admin/materials` and `/admin/assignments` say "Coming soon" | `/admin/batches/[id]` |
| Certificates (issue, revoke, reissue; public verification) | Ready inside each Enrollment. `/admin/certificates` says "Coming soon" | `/admin/enrollments/[id]`, `/verify-certificate` |
| Payments: offline ledger, Razorpay test payments, receipts, refunds | Ready (Test Mode only) | `/admin/payments` |
| In-app notifications | Ready (no email or SMS) | `/admin/notifications` |
| Website content and Program website management | As for Super Admin above | `/admin/website` |
| Leads | **Not built** (Phase 23, Zoho CRM). Page says "Coming soon" | `/admin/leads` |

### Trainer

| Feature | Status | Where |
|---|---|---|
| Login and dashboard | Ready | `/login/trainer`, `/trainer` |
| Assigned Batches and their Students | Ready | `/trainer/batches`, `/trainer/students` |
| Sessions and attendance | Ready | `/trainer/batches/[id]/sessions/…` |
| Training materials | Ready | `/trainer/batches/[id]` |
| Assignments and submission review | Ready | `/trainer/batches/[id]` |
| Student progress | **Partly.** Attendance and submissions per Batch. No single per-Student progress page (the Student page shows contact details only) | — |
| Notifications, profile | Ready | `/trainer/notifications`, `/trainer/profile` |

### Student

| Feature | Status | Where |
|---|---|---|
| Login and dashboard (with payment status) | Ready | `/login/student`, `/student` |
| My Programs and Enrollments | Ready | `/student/enrollments` |
| Learning materials and assignments (submit work) | Ready | `/student/enrollments/[id]` |
| Attendance record | Ready | `/student/enrollments/[id]` |
| Certificates (download) | Ready | `/student/enrollments/[id]` |
| Payment plan, Pay Online (Razorpay test), receipts | Ready (Test Mode only) | `/student/enrollments/[id]` |
| Profile, notifications | Ready | `/student/profile`, `/student/notifications` |

### Not available anywhere in the preview

- Email and SMS delivery (Phase 18b); notifications are in-app only.
- Forgot password: uses Supabase's built-in mailer. On a new project it sends only to the project's own team members, at a low hourly limit. Demo accounts get passwords directly instead.
- Zoho CRM and Leads (Phase 23); live Razorpay (Phase 25); the public website (22C–22J); 22B-3 media and 22B-4 deletion screens.

## 3. What the app needs from a host

Checked against `main`:
- Next.js 16.3.4 needs Node.js 20.9 or later; Node 22 is recommended (CI uses 22).
- Runs as a normal `next build` and `next start` server, with server actions (body limit 12 MB), API routes and `proxy.ts`.
- Routes the host must support:
  - CSV exports;
  - receipt PDFs (generated in-process by `@react-pdf/renderer`);
  - Student photos;
  - the Razorpay webhook;
  - the auth callbacks.
- Talks to Supabase over HTTPS only at run time. `SUPABASE_DB_URL` is used by scripts, not the app, so the host needs no outbound Postgres access.
- Needs no WebSockets, background workers or cron. Optional Upstash rate limiting falls back to an in-memory limiter when unset.
- Environment variables (server-side, set in the host's dashboard by the owner):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`;
  - `NEXT_PUBLIC_APP_URL`, `APP_TIMEZONE`;
  - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (test values; the app refuses `rzp_live_` keys).

## 4. Hostinger versus Vercel for this project

Prices are from public pages and reviews found on 2026-10-23. They change often; confirm before buying.

| | Vercel Pro | Hostinger Business or Cloud (Node.js web apps) |
|---|---|---|
| Next.js 16 and Node | Built by the Next.js team; Node 22/24 | Supported; Node 18/20/22/24 offered |
| Server actions and API routes | Native | Standard `next start`; should work. Not yet tried with this app |
| Supabase login and secure cookies | Works (HTTPS, `proxy.ts`) | Should work; needs a trial deploy |
| Private documents and uploads | Fine: files go to Supabase Storage through short-lived signed links | Same |
| Razorpay test payments and webhooks | Payments fine. The webhook is blocked by Vercel Authentication unless its URL carries Vercel's automation bypass token; test payments still confirm through Checkout without it | Fine: the webhook path is already outside `proxy.ts` |
| Keeping staging private | **Built in:** Vercel Authentication for all deployments; Vercel adds `noindex` to preview URLs | **Not built in for Node apps:** needs an application change (a staging password gate in `proxy.ts`, switched on by an environment variable, plus `noindex`). That touches shared auth plumbing, so it needs separate approval |
| Four future domains or subdomains | Unlimited domains per project | Business: 5 Node.js apps; Cloud: 10 |
| Limits that matter | Function time and size limits are generous for this app | All sites on the plan share one process limit (Business 120; one Next.js app uses about 10–11 threads, and `www` and the bare domain each run their own process). 120-second request limit. Hitting the limit returns 503 errors |
| Deploys and rollback | Every push builds; one-click rollback; per-deploy logs | Builds from GitHub; rollback and logs are simpler |
| Maintenance | None for the server | Low, but shared-hosting limits must be watched as traffic grows |
| Cost | $20 a month (one seat), monthly, no upfront payment. Hobby is free but for non-commercial use only, and cannot protect the main URL | About $3.50–4 a month only with a 48-month prepayment (about $170–190 upfront), renewing at about $17 a month. $0 extra if the owner already has a Business or Cloud plan with Node.js web apps |

**Significant Hostinger limitation for this preview:** it has no built-in way to keep a Node.js app private. To use it safely I would first have to add and test the staging gate in `proxy.ts`. Its shared process limit also makes it a weaker home for four subdomains later.

**Recommendation:** Vercel Pro for the private preview now. Leave the production host decision open; it can be revisited once the public website (22C onwards) is built, with real traffic estimates.

## 5. Staging cost

| Item | Upfront | Monthly |
|---|---|---|
| Vercel Pro (one seat) | $0 | $20 (about ₹1,700) |
| Supabase staging project (free plan: pauses after 7 days without use; data kept; one-click restore) | $0 | $0 ($25 if it must never pause) |
| Razorpay Test Mode | $0 | $0 |
| Domain | $0: use the `*.vercel.app` address | $0 |
| **Total** | **$0** | **$20** |

## 6. What the owner must provide or do

No secret is ever pasted into this conversation or committed.

1. **Approve** this plan, the hosting choice and a $20 a month Vercel Pro subscription.
2. **Supabase:** create a new project, e.g. `roicians-staging`, region Mumbai, with its own strong database password.
   - Keep its keys on your computer.
   - In Authentication settings, turn off "Allow new users to sign up" (accounts are created by Admins and scripts only).
   - Set the Site URL to the staging address once it exists.
3. **Apply migrations 1–42 to the staging project only**, from your computer:
   - `npx supabase link --project-ref <staging-ref>`;
   - confirm the ref is the staging project, **not** DEV;
   - `npx supabase db push`.
   - Alternatively, approve a one-off GitHub Actions job that reads staging secrets you add in GitHub.
4. **Test logins:** with the staging URL and service-role key exported in your own terminal, run `node scripts/seed-demo-users.mjs`. It creates one Super Admin, Admin, Trainer and Student and prints fresh passwords once, on your screen only. Store them in your password manager.
5. **Razorpay:** in Test Mode, take a test key ID and secret. Create a test webhook to `https://<staging>/api/razorpay/webhook` with a secret you choose; if Vercel protection is on, add Vercel's automation bypass token to that URL.
6. **Vercel:**
   - create a Pro team and import the GitHub repository;
   - set Node.js 22 and the environment variables in section 3 (staging values; leave email and Upstash empty; do **not** add `SUPABASE_DB_URL`);
   - set Deployment Protection to Vercel Authentication for **all deployments**;
   - deploy `main`.
7. **Fictional records:** either create them through the Admin screens (about an hour; also a good walkthrough), or approve a small staging seed script (section 7).

## 7. What I can do, once approved

| Task | Needs approval because |
|---|---|
| Write a staging seed script for fictional Programs, Batches, Trainers, Students, Enrollments, sessions, attendance, materials, assignments, offline payments and a certificate. It will refuse any project not named in an explicit staging allowlist, and you run it on your computer | New tooling |
| Run every existing browser test suite on `main` against a disposable local Supabase stack in GitHub Actions, as a full regression before the preview. The older suites have not yet run in this isolated mode, so the first run may need fixture fixes, which I would report | Activates GitHub Actions |
| A read-only smoke check after deploy: log in as each of the four roles and open every page in section 2. Either a script you run locally, or a workflow using secrets you add to GitHub | Uses staging credentials |
| Only if Hostinger is chosen: the env-gated staging password gate and `noindex` in `proxy.ts`, with tests | Changes shared auth plumbing |

I cannot create accounts, buy plans, enter secrets, apply migrations to a hosted project or deploy without your access and approval.

## 8. Verifying every portal before you test personally

1. **Before deploy:** full browser regression of `main` against a disposable local stack (section 7). The Phase 22B suites already pass this way (22B-1 8/8, 22B-2 16/16 with 22B-1).
2. **After deploy, before handing over:** the smoke check (section 7) walks every page listed in section 2 for the matching role. It also checks that:
   - each role is refused the other portals;
   - a Razorpay test payment completes and issues a receipt;
   - responses carry `noindex`;
   - opening the site without Vercel access is refused.
3. **Your walkthrough:** a one-page checklist per role, generated from section 2.

## 9. Exact steps to make the demo available

1. You approve the plan, Vercel Pro and the optional items in section 7.
2. You do section 6, steps 2–3 (staging Supabase, migrations).
3. I deliver the seed script, if approved; you run it and `seed-demo-users.mjs` (steps 4 and 7).
4. You do steps 5–6 (Razorpay test keys, Vercel project and protection), then deploy `main`.
5. The smoke check runs; I report the results, with any failure stated plainly.
6. You open `https://<project>.vercel.app`, pass Vercel's login, then sign in with a role account.

Estimated time: about 2–3 hours of your time spread over one day, with no waiting on purchases beyond the Vercel subscription.
