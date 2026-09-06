# Roicians Tech — Training Management System / LMS

Roicians Tech Pvt. Ltd.'s training management system: public marketing site,
Admin Portal, Trainer Portal, and Student Portal, built on Next.js and
Supabase, with Razorpay for payments.

Before touching code, read the planning docs at the repo root — they are the
source of truth for scope and design decisions:

- `REQUIREMENTS.md` — business/functional/non-functional/security requirements
- `ARCHITECTURE.md` — system architecture and rationale
- `DATABASE_SCHEMA.md` — full schema, ID strategy, ERD
- `USER_ROLES_AND_PERMISSIONS.md` — RBAC matrix
- `SECURITY_PLAN.md` — authn/authz/payment/webhook security
- `API_AND_INTEGRATIONS.md` — Razorpay/Supabase/email integration design
- `IMPLEMENTATION_PLAN.md` — phase-by-phase build plan (current phase status
  lives here)
- `DECISIONS_NEEDED.md` — open business decisions

## Prerequisites

- Node.js 20+ and npm
- A [Supabase](https://supabase.com) project (a free-tier hosted project is
  fine for local development — you do not need the Supabase CLI's local
  Docker stack, though it works too if you have Docker installed)
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
  (invoked here via `npx supabase`, so a global install isn't required)
- A [Razorpay](https://razorpay.com) account (test mode is enough for
  development)
- A transactional email provider account: [Resend](https://resend.com)
  (default) or [SendGrid](https://sendgrid.com)

## Installation

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with real values as described below. Never commit
`.env.local` — it's already covered by `.gitignore`.

## Environment Variables

Every variable is listed with a placeholder and a comment in `.env.example`.
Summary of where to find each one:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page — **server-only**, never expose to the browser |
| `SUPABASE_DB_URL` | Supabase Dashboard → Project Settings → Database → Connection string |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Settings → API Keys (use test-mode keys for dev) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard → Settings → Webhooks (set when you create the webhook — see below) |
| `RESEND_API_KEY` / `SENDGRID_API_KEY` | Your chosen provider's dashboard (only the selected `EMAIL_PROVIDER`'s key is required) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Optional — [Upstash](https://upstash.com) Redis for rate limiting; safe to leave blank locally |

Use separate Supabase projects and separate Razorpay test/live key sets for
local/dev, staging, and production — never point a preview deployment at the
production database (`ARCHITECTURE.md` §12).

## Database Setup & Migrations

Schema is defined entirely in `supabase/migrations/*.sql`, applied in
filename order. Never hand-edit a production database — every change is a
new migration file.

**Option A — hosted Supabase project (recommended, no Docker needed):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies all migrations
```

**Option B — full local stack (requires Docker):**

```bash
npx supabase start            # boots local Postgres + Auth + Storage + Studio
npx supabase db reset         # (re)applies all migrations, then seed.sql
```

`npm run db:migrate` / `npm run db:reset` are shortcuts for the two commands
above once your Supabase CLI session is configured.

### Seed data

`supabase/seed.sql` inserts development-only sample data (the five example
programs from the brief, plus a few upcoming batches) and runs automatically
after `supabase db reset`. It contains no secrets and is safe to commit.

Demo login accounts (Super Admin / Admin / Trainer / Student) are **not**
created by SQL, because creating a real Supabase Auth user correctly requires
the Admin API, not a raw insert. Instead, once your Supabase project and
`.env.local` are set up, run:

```bash
npm run db:seed:users
```

This creates (or reuses, if already present) one demo account per role, each
with a freshly generated password printed once to your terminal — never
hard-coded, never committed. Re-run it any time; it won't duplicate existing
accounts.

## Running Locally

```bash
npm run dev
```

Visit `http://localhost:3000`. The Admin/Trainer/Student portals and the
public marketing site are built out phase by phase — see
`IMPLEMENTATION_PLAN.md` for what's live at any given point; the home page
itself tells you where the build currently stands.

## Testing

```bash
npm run typecheck      # tsc --noEmit (via next typegen first)
npm run lint           # ESLint
npm run format:check   # Prettier
npm run test           # Vitest unit/domain tests
npm run test:e2e       # Playwright end-to-end tests (builds and serves the app)
```

Playwright is pinned to an exact version (`1.56.0`) matched to whichever
Chromium build is already installed in your environment. If you see a
"browser not found" error, either run `npx playwright install` to fetch the
matching browser for your currently installed Playwright version, or check
`npx playwright --version` against your local browser cache and adjust the
pinned version to match — don't just bump the version without checking,
since Playwright ties each release to a specific bundled browser revision.

## Production Build

```bash
npm run build
npm run start
```

## Vercel Deployment

1. Import the repository into Vercel.
2. Set every variable from `.env.example` in the Vercel project's
   Environment Variables settings, scoped per environment (Production /
   Preview / Development) — use separate Supabase projects and Razorpay key
   sets per scope, per `ARCHITECTURE.md` §12.
3. Deploy. Vercel builds with `next build` automatically.
4. Apply the latest migrations to the target Supabase project (`npx supabase
   db push` against the linked project) as part of your release process —
   migrations are not applied automatically by Vercel.

## Razorpay Webhook Configuration

1. Razorpay Dashboard → Settings → Webhooks → Add New Webhook.
2. URL: `https://<your-deployment-domain>/api/razorpay/webhook`
3. Subscribe to at least: `payment.captured`, `payment.failed`,
   `refund.processed`.
4. Copy the generated webhook secret into `RAZORPAY_WEBHOOK_SECRET` for that
   environment. Use a separate webhook (and secret) per environment
   (dev/staging/production) pointed at that environment's own URL.

See `API_AND_INTEGRATIONS.md` §2 and `SECURITY_PLAN.md` §9 for the full
payment/webhook verification flow.

## Email Configuration

Set `EMAIL_PROVIDER` to `resend` (default) or `sendgrid`, and provide that
provider's API key. Verify your sending domain with the provider before
going to production — an unverified domain will have transactional emails
land in spam or be rejected outright. `EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME`
control the sender identity shown to recipients.

## Project Structure

See `ARCHITECTURE.md` §3 for the target route/module layout. In short:

- `app/` — Next.js App Router pages (public site + `/admin`, `/trainer`,
  `/student` portals, `/api` route handlers) — built out phase by phase
- `components/ui/` — base UI primitives (in the shadcn/ui style)
- `components/{admin,trainer,student,public}/` — surface-specific components,
  added as each phase needs them
- `lib/` — `utils.ts` today; `domain/`, `data/`, `auth/`, `email/`, `pdf/`,
  `validation/`, `supabase/` are added by the phases that first populate them
  (see `IMPLEMENTATION_PLAN.md`), rather than scaffolded empty up front
- `supabase/migrations/` — versioned schema migrations (source of truth for
  the database)
- `supabase/seed.sql` — local/dev-only sample data
- `scripts/` — one-off operational scripts (e.g. demo account seeding)
- `e2e/` — Playwright end-to-end tests

### A note on `components.json` / shadcn/ui

`components.json` is present so `npx shadcn add <component>` works in a
normal development environment. In some sandboxed CI/build environments,
outbound requests to `ui.shadcn.com` may be blocked by network policy; if
`shadcn add` fails there, add the component manually (copy the standard
shadcn/ui source for that component into `components/ui/`) from an
environment with full network access instead.

## Backups

Application code does not provide backups on its own. Use Supabase's own
point-in-time recovery / scheduled backup features (available from the Pro
plan and above) for the production project, and verify restore procedures
periodically — a backup that has never been restored is unverified.
