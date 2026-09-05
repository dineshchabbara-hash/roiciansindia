# ARCHITECTURE.md

## Roicians Tech — Training Management System / LMS

**Status:** Draft v1.0 (Planning Phase)

---

## 1. High-Level Overview

A single Next.js (App Router) application serves four surfaces from one codebase and
one database:

```
                         ┌────────────────────────────────────────┐
                         │              Next.js App                │
                         │  (Vercel — Node.js serverless runtime)  │
                         │                                          │
   Public visitors ─────▶│  /               Public marketing site  │
   Students        ─────▶│  /student/*      Student Portal         │
   Trainers        ─────▶│  /trainer/*      Trainer Portal         │
   Admin/Super Admin ───▶│  /admin/*        Admin Portal           │
                         │                                          │
                         │  Server Actions / Route Handlers         │
                         │  (all privileged logic runs here)        │
                         └───────────────┬──────────────────────────┘
                                         │
                 ┌───────────────────────┼────────────────────────────┐
                 ▼                       ▼                            ▼
        ┌─────────────────┐   ┌──────────────────┐         ┌──────────────────┐
        │ Supabase Postgres │   │ Supabase Storage  │         │ Razorpay          │
        │ (+ Auth, RLS)     │   │ (materials, docs,  │         │ Orders/Checkout/  │
        │                   │   │  submissions)      │         │ Webhooks          │
        └─────────────────┘   └──────────────────┘         └──────────────────┘
                                         │
                                         ▼
                              ┌──────────────────┐
                              │ Email Provider     │
                              │ (Resend/SendGrid)  │
                              └──────────────────┘
```

One codebase, one Postgres database, role-scoped route groups. This avoids the
operational overhead of separate frontends/backends while still giving each portal
its own layout, navigation, and access boundary.

## 2. Why This Stack

- **Next.js (App Router) + TypeScript**: server components for data-heavy admin
  screens (fetch directly, no client-side waterfall), server actions for mutations
  colocated with the pages that need them, API route handlers where a stable HTTP
  contract is required (Razorpay webhooks, third-party callbacks).
- **Supabase (Postgres + Auth + Storage)**: gives us a managed, production-grade
  Postgres with Row Level Security, a battle-tested auth provider (avoids "don't
  roll your own auth"), and object storage with signed URLs — all reachable from
  Vercel serverless functions without new infrastructure to operate.
- **Tailwind + shadcn/ui**: fast to build a consistent, accessible, professional
  admin UI without shipping a heavy component runtime; shadcn components are copied
  into the repo (not an opaque dependency), so they can be customized freely to match
  brand colors.
- **Razorpay**: required by the brief; India-first payment gateway with Orders API,
  Checkout, and webhooks that fit the server-authoritative flow we need.
- **Vendor-neutrality**: business logic (enrollment rules, balance calculation,
  numbering, RBAC) lives in a `lib/domain/*` layer that talks to Postgres via a thin
  data-access layer — not through Supabase-specific client calls sprinkled through
  UI code. If we ever needed to move off Supabase (self-hosted Postgres + a
  different auth provider), only the data-access and auth-adapter layers change.

## 3. Frontend Architecture

```
app/
  (public)/                     -- marketing site, no auth required
    page.tsx                    -- Home
    about/
    programs/
      page.tsx                  -- Program list
      [slug]/page.tsx           -- Program detail
    corporate-training/
    contact/
    verify-certificate/
    login/
      student/
      trainer/
      admin/                    -- not linked from public nav
  admin/                         -- requires role in {admin, super_admin}
    layout.tsx                   -- sidebar + topbar, server-side role gate
    page.tsx                     -- dashboard
    students/
    trainers/
    programs/
    batches/
    enrollments/
    payments/
    attendance/
    materials/
    assignments/
    certificates/
    reports/
    leads/
    settings/
    audit-logs/
  trainer/                       -- requires role = trainer
    layout.tsx
    page.tsx
    batches/
    attendance/
    materials/
    assignments/
  student/                       -- requires role = student
    layout.tsx
    page.tsx
    programs/
    payments/
    attendance/
    assignments/
    materials/
    certificates/
    profile/
  api/
    razorpay/
      webhook/route.ts           -- signature-verified webhook receiver
      create-order/route.ts      -- (or a server action; see API doc)
    certificates/verify/route.ts -- public verification endpoint
components/
  ui/                            -- shadcn primitives
  admin/ trainer/ student/ public/  -- surface-specific composed components
lib/
  domain/                        -- pure business logic (framework-agnostic)
    student-id.ts
    enrollment-balance.ts
    receipt-numbering.ts
    certificate-numbering.ts
    rbac.ts
  data/                          -- data-access layer (Postgres queries)
  auth/                          -- session/role resolution, server-only
  email/                         -- EmailSender interface + provider adapters
  pdf/                           -- receipt/certificate PDF rendering
  validation/                    -- Zod schemas, one per entity, shared by
                                    client forms and server actions
  supabase/                      -- server client, browser client, admin client
```

Key rules:

- **Route groups gate by role at the layout level** (`app/admin/layout.tsx` etc.)
  by reading the authenticated session server-side and redirecting if the role
  doesn't match — this is the first of two enforcement layers (the second is
  per-query authorization + RLS, so a leaked/forged route render is still not enough
  to read another tenant's data).
- **Server Components by default** for read-heavy pages (tables, dashboards); client
  components only where interactivity is required (forms, modals, Razorpay Checkout
  widget, charts).
- **Server Actions** for form mutations that stay within one page; **Route Handlers**
  for anything needing a stable external contract (webhooks) or non-form invocation.
- **No privileged Supabase key ever ships to the browser.** The browser Supabase
  client uses the anon key and is subject to RLS; the service-role key lives only in
  server-only modules (`lib/supabase/admin.ts`, never imported from a `"use client"`
  file — enforced by a lint rule/import boundary).

## 4. Backend / Domain Architecture

Layered:

1. **Route/Action layer** — parses input, checks authentication, delegates to domain
   services. No business logic here.
2. **Domain/service layer** (`lib/domain`) — pure(ish) functions encoding business
   rules: student ID generation, enrollment balance calculation, receipt/certificate
   numbering, RBAC permission checks, installment status derivation. Fully unit
   testable without a database (given injected repositories).
3. **Data-access layer** (`lib/data`) — typed query functions against Postgres
   (via `@supabase/supabase-js` server client or `postgres.js`/`pg` directly for
   complex transactional operations that need explicit `BEGIN/COMMIT` and row
   locking beyond what the Supabase client conveniently exposes).
4. **Postgres** — source of truth, including generated/sequence-backed human IDs,
   constraints, and RLS policies as a second authorization layer.

Critical financial and ID-generation operations (payment confirmation + balance
recompute + receipt numbering; student creation + Student ID assignment) run inside
explicit Postgres transactions using `SELECT … FOR UPDATE` or dedicated
`bigint`-backed sequences, never optimistic read-then-write from application code.
This is what makes §92/§93 (receipt/Student ID concurrency safety) actually hold
under concurrent requests.

## 5. Authentication & Session Architecture

- **Provider:** Supabase Auth (email/password for V1; OTP/OAuth reserved for later —
  Supabase Auth supports both without a migration).
- **Session storage:** Supabase's SSR cookie-based session (httpOnly, secure,
  SameSite=Lax), read via `@supabase/ssr` in server components/middleware — no
  custom JWT handling to get wrong.
- **Role resolution:** Auth gives us *identity* (a `auth.users.id`); *role* is looked
  up from an application table (`user_roles`) keyed by that ID, not from a JWT custom
  claim we'd have to keep in sync manually for V1 simplicity. (A custom-claims/JWT
  hook is a reasonable P1 optimization once role-check volume justifies it — noted as
  a future perf improvement, not required now.)
- **Middleware** (`middleware.ts`) refreshes the Supabase session cookie and performs
  a coarse redirect (not-logged-in → login) on protected path prefixes; fine-grained
  role checks happen in each route group's server layout, which is the actual
  authorization boundary.
- **Account provisioning:**
  - Admin/Super Admin: created directly by Super Admin via Admin Portal (invite
    flow — Supabase Auth admin API creates the user, sends a set-password email).
  - Trainer: created/invited by Admin the same way.
  - Student: portal account is created **after** the student record exists and the
    registration/enrollment step is confirmed by Admin (see
    `DECISIONS_NEEDED.md` for the alternative of self-serve signup) — this keeps a
    clean separation between "we have a lead/registration" and "this person has a
    login," and avoids orphaned auth users with no student record.

## 6. Database Architecture

See `DATABASE_SCHEMA.md` for full table detail. Architectural points:

- Single Postgres schema (`public`), managed exclusively through migrations
  (`supabase/migrations/*.sql`), never hand-edited in production.
- Every business entity has both a `uuid` primary key (`id`) for internal
  relationships and, where the business needs a human-readable identifier (students,
  enrollments, payments, receipts, certificates), a separate sequence-backed
  `*_number`/`*_code` column. UUIDs are never exposed as the "official" ID a staff
  member reads over the phone; the human number is.
- RLS is enabled on every table touching student/trainer/payment data (defense in
  depth alongside server-side checks — see `SECURITY_PLAN.md`).
- Monetary columns are `numeric(12,2)` throughout; no floats anywhere in the money
  path (DB, TypeScript domain layer uses a decimal-safe library, not raw `number`
  arithmetic for money — see `DATABASE_SCHEMA.md` §Money Handling).

## 7. Storage Architecture

- Supabase Storage buckets, private by default:
  - `materials` — course materials (program/batch/module scoped)
  - `submissions` — student assignment submissions
  - `documents` — student-uploaded documents, profile photos
  - `certificates` — generated certificate PDFs
  - `receipts` — generated receipt PDFs
- Access exclusively via short-lived signed URLs minted server-side after an
  authorization check (never a public bucket, never a permanently-guessable path).
- Uploads validated server-side (extension allow-list, sniffed MIME type, size cap)
  before a signed upload URL is issued or before the file is accepted.

## 8. Payment Architecture

Full flow and idempotency strategy detailed in `API_AND_INTEGRATIONS.md`. Summary:

1. Client requests "pay" for a specific enrollment/installment — sends **only** an
   identifier, never an amount.
2. Server loads the enrollment/installment, re-derives the exact amount owed,
   creates a Razorpay Order server-side (amount from the server, not the client),
   and persists a `payments` row in `pending` status with the Razorpay Order ID.
3. Client completes Razorpay Checkout using that order.
4. Razorpay redirects/callbacks with `razorpay_payment_id`,
   `razorpay_order_id`, `razorpay_signature` — server verifies the HMAC signature
   before trusting anything.
5. Razorpay also calls our webhook endpoint independently; the webhook handler
   verifies its own signature and treats the event as the source of truth for final
   status, using the Razorpay payment/event ID as an idempotency key (unique
   constraint + upsert) so duplicate deliveries never double-post a payment.
6. On confirmed success: payment row transitions to `paid` inside a transaction that
   also recomputes the enrollment's cached balance and mints the next receipt number
   from a dedicated sequence.
7. Receipt PDF is generated and emailed; dashboards read the updated, already-
   persisted state — nothing is computed client-side.

## 9. Email Architecture

- `lib/email/EmailSender` interface (`send(templateKey, to, data)`); concrete
  adapters for Resend (default) and SendGrid (alternative), selected by env var —
  swapping providers never touches call sites.
- Templates stored as React Email components (or MJML) rendered server-side to HTML;
  template content is data-driven from Company Settings (logo, address, footer) so
  no company detail is hard-coded in a template file.
- Every transactional send is logged (recipient, template, status, provider message
  ID) for troubleshooting, without logging full message bodies containing PII beyond
  what's operationally necessary.

## 10. Notification Architecture (In-App + Future Channels)

- A single `notifications` table: `user_id`, `type`, `title`, `body`, `data (jsonb)`,
  `channel`, `status`, `read_at`, `created_at`.
- A `NotificationDispatcher` service takes a domain event (e.g.
  `payment.confirmed`) and fans it out to configured channels (in-app row + email
  today). Adding WhatsApp later means adding a `WhatsAppSender` adapter and a channel
  entry — no schema change, no rewrite of call sites.

## 11. PDF Generation Architecture

- Server-side only (never generate financial/certificate PDFs in the browser).
- Recommended: `@react-pdf/renderer` for receipts (structured, fast, no headless
  browser needed) and either `@react-pdf/renderer` or a headless-Chromium HTML
  template (via `@sparticuz/chromium` + `puppeteer-core`) for certificates if a more
  design-flexible, HTML/CSS-driven layout is wanted for the certificate's visual
  design. Trade-offs documented in `API_AND_INTEGRATIONS.md`.
- Generated PDFs are stored in Supabase Storage (not regenerated on every download)
  and served via signed URL, so a receipt is a durable artifact, not a live render.

## 12. Deployment Architecture

- **Hosting:** Vercel (Next.js-native), production + preview deployments per PR.
- **Database:** Supabase-hosted Postgres (managed backups — see `README.md` backup
  section); migrations applied via Supabase CLI in CI before/at deploy.
- **Environment separation:** distinct Supabase projects (and Razorpay
  test/live key sets) for local/dev, staging/preview, and production — never share a
  production database with preview deployments.
- **Secrets:** Vercel Environment Variables (per-environment), never committed;
  `.env.example` documents names/placeholders only.
- **Webhooks:** Razorpay webhook URL points at the deployed route handler
  (`/api/razorpay/webhook`); the webhook secret is validated per request.

## 13. Security Architecture (Summary — full detail in SECURITY_PLAN.md)

- Defense in depth: server-side authorization **and** Postgres RLS, not either alone.
- All privileged mutations run through Zod-validated server actions/route handlers.
- CSRF exposure is inherently reduced by using Next.js Server Actions (same-origin,
  POST-only, framework-issued action IDs); route handlers that accept
  state-changing requests from a browser form additionally check `Origin`/`Referer`
  where relevant. Webhook routes are exempt from CSRF concerns (no cookies/session
  involved) but require signature verification instead.
- Rate limiting via a lightweight token-bucket (e.g. Upstash Redis or a Postgres-
  backed limiter) on `/login`, `/forgot-password`, `/api/razorpay/*`, the public
  lead form, and `/verify-certificate`.

## 14. Scalability & Performance Notes

- All list views paginated server-side (cursor or offset+limit with indexed sort
  columns); no "load all students" query.
- Heavy aggregates (attendance %, per-enrollment balance, dashboard KPIs) computed
  via indexed SQL views/materialized views refreshed on write, not recomputed by
  fetching raw rows into Node and summing in JavaScript.
- Images (logos, thumbnails, certificates preview) served via Next.js Image
  optimization; large files (materials, recordings) are links/streamed from Storage,
  not bundled.

## 15. Multi-Branch / SaaS Readiness (Not Implemented Now)

To keep future multi-branch or multi-tenant SaaS evolution realistic without
building it now:

- `company_settings` is already a single-row-per-tenant-shaped table (not scattered
  constants), so adding a `tenant_id` column and turning it into a multi-row table
  later is a schema change, not a rewrite.
- Domain/service functions take an explicit context object (current user, and later
  current tenant/branch) rather than reading global singletons, so threading a
  `tenant_id` through later is mechanical.
- **What would actually need to change for multi-company SaaS:** add `tenant_id`
  (or `organization_id`) to every table, extend every RLS policy to filter by
  tenant, scope every sequence (Student ID, receipt numbers, etc.) per tenant instead
  of globally, and introduce a tenant-resolution step (subdomain or path prefix) in
  middleware. This is a deliberate, scoped future project — not attempted in V1.

## 16. What We Are Explicitly Not Building in V1

Per the brief's own prioritization (§79, §75–78): WhatsApp integration, Zoom/Meet/
Calendar sync, CRM/Meta Leads integration, accounting software integration, mobile
app, AI assistant, placement/job module, multi-branch enforcement, multi-tenant SaaS.
The architecture above avoids decisions that would make any of these harder later.
