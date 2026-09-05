# API_AND_INTEGRATIONS.md

## Roicians India — Training Management System / LMS

**Status:** Draft v1.0 (Planning Phase)

---

## 1. Internal API Surface

Most mutations use **Next.js Server Actions** colocated with the pages that invoke
them (no separate REST contract needed for internal UI operations). A small set of
endpoints are implemented as **Route Handlers** (`app/api/**/route.ts`) because they
need a stable HTTP contract for an external caller or a non-form invocation:

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/razorpay/create-order` | POST | Create a Razorpay order for a specific enrollment/installment | Student session (self only) or Admin (recording context) |
| `/api/razorpay/webhook` | POST | Receive Razorpay payment/refund events | Razorpay signature only (no session) |
| `/api/certificates/verify` | GET | Public certificate lookup by certificate number | None (public, rate-limited) |
| `/api/exports/[report]` | GET | Stream CSV export for a given report | Admin/Super Admin session |

All other reads (dashboards, tables, detail pages) are handled by Server Components
fetching directly via the data-access layer — no internal REST layer is built purely
for the sake of having one.

## 2. Razorpay Integration

### 2.1 Why Razorpay
Required by the brief; India-first, supports UPI/cards/netbanking/wallets, has a
mature Orders + Webhooks model that fits a server-authoritative payment flow.

### 2.2 Credentials
- `RAZORPAY_KEY_ID` — public, safe to send to the browser for Checkout init.
- `RAZORPAY_KEY_SECRET` — server-only, used to create orders and verify checkout
  signatures.
- `RAZORPAY_WEBHOOK_SECRET` — server-only, used to verify webhook payload
  signatures. **Distinct** from the key secret; configured separately in the
  Razorpay Dashboard's webhook settings.

### 2.3 Order Creation Flow (Server-Authoritative)

```
Student clicks "Pay ₹20,000 – Installment 2"
        │
        ▼
Server Action / POST /api/razorpay/create-order
  body: { enrollmentId, installmentId? }        <-- no amount, ever
        │
        ▼
1. Load session -> confirm caller is this student (or Admin acting on their behalf)
2. Load enrollment + installment from DB
3. Compute expectedAmount = outstanding amount for that installment/enrollment
   (re-derived server-side per DATABASE_SCHEMA.md §6 — never trust any client value)
4. razorpay.orders.create({
     amount: expectedAmount * 100,   // paise
     currency: 'INR',
     receipt: internal reference,
     notes: { studentId, enrollmentId, programCode }  // no phone/email in notes
   })
5. Insert `payments` row: status='pending', razorpay_order_id=order.id,
   amount=expectedAmount
6. Return { orderId, amount, keyId } to client
        │
        ▼
Client opens Razorpay Checkout with { key: keyId, order_id: orderId, amount }
```

### 2.4 Checkout Completion Verification

```
Razorpay Checkout success handler returns:
  razorpay_order_id, razorpay_payment_id, razorpay_signature
        │
        ▼
Server Action: verifyPayment(...)
1. Recompute expected signature:
   hmac_sha256(order_id + "|" + payment_id, RAZORPAY_KEY_SECRET)
2. Compare (constant-time) to razorpay_signature — reject if mismatched
3. Do NOT mark payment 'paid' based on this alone if the webhook has not yet
   confirmed — this callback provides fast UI feedback ("Payment received,
   confirming..."), while the webhook (2.5) is the authoritative status setter.
   [ARCHITECTURAL DECISION: see §2.6 below for why both paths exist]
```

### 2.5 Webhook Flow (Source of Truth)

```
Razorpay -> POST /api/razorpay/webhook
  headers: X-Razorpay-Signature
  body: raw JSON (payment.captured / payment.failed / refund.processed / ...)
        │
        ▼
1. Read raw body (must not be pre-parsed/mutated — signature is over raw bytes)
2. Verify HMAC-SHA256(raw body, RAZORPAY_WEBHOOK_SECRET) == X-Razorpay-Signature
   -> reject with 400 if invalid, log the attempt
3. Extract event.id, event.payload.payment.entity.id, order_id, amount, status
4. BEGIN transaction:
     a. Upsert into `payments` keyed by unique(razorpay_payment_id):
        - if row already 'paid' -> no-op (idempotent, handles duplicate delivery)
        - else set status per event type, paid_at = now()
     b. Cross-check event amount == expected amount recorded at order creation
        -> if mismatch, set status='authorized' (held) instead of 'paid', flag
           for Admin review, do NOT recompute balance yet
     c. If now 'paid': recompute enrollment amount_paid_cache/outstanding_balance_cache
        (DATABASE_SCHEMA.md §6), update installment status if applicable
     d. Mint next receipt_number from sequence, insert `receipts` row (pdf
        generated async/next step, not required to block the transaction)
   COMMIT
5. Return 200 quickly (Razorpay retries on non-2xx / timeout — handler must be
   fast; PDF generation and email are dispatched after the DB transaction commits,
   not inside it)
6. Trigger receipt PDF generation + email send (can be a fire-and-forget
   background task or a subsequent request from a queue — for V1 scale, direct
   async call immediately after commit is sufficient; documented as an
   opportunity to move to a queue if volume grows)
```

### 2.6 Why Both Client Callback and Webhook Exist
The client-side callback gives the student immediate UI feedback ("processing your
payment") without waiting for the asynchronous webhook, which can arrive seconds
later. The webhook remains the **only** path that flips a payment to `paid` and
recomputes balances — the client callback path never itself finalizes the payment,
precisely so a user closing the browser tab or a spoofed client-side call cannot
fake a successful payment. This satisfies both the UX requirement (fast feedback)
and the security requirement (server/webhook-authoritative state).

### 2.7 Webhook Idempotency
`payments.razorpay_payment_id` carries a unique constraint (partial index, only
where non-null). The upsert in §2.5 step 4a is the idempotency mechanism — Razorpay
redelivering the same `payment.captured` event (which it does on any non-2xx
response, and can also do spontaneously) can never create a second payment row or
apply the balance reduction twice.

### 2.8 Refunds (P2, Schema-Ready)
- Admin-initiated from the Admin Portal → calls `razorpay.payments.refund(paymentId,
  { amount })` server-side → inserts a `payment_refunds` row (`status='initiated'`).
- A corresponding `refund.processed` webhook event updates the row to `processed`
  and triggers the enrollment balance recompute (adds back to outstanding balance).
- The original `payments` row is never modified in place — its `status` may move to
  `refunded`/`partially_refunded` as a derived label, but `amount`/`total_amount`
  stay as originally recorded (§90 compliance).

### 2.9 Payment Metadata Guidance
Razorpay `notes` on an order includes only: Student ID (`student_code`), Enrollment
ID (`enrollment_code`), Program Code. Deliberately **excludes** phone/email/full
name to minimize PII sent to a third party beyond what Razorpay itself already
collects during Checkout (which is necessary for the payment method itself) — a
tighter stance than the brief's example list, per §23's own instruction not to
include unnecessary personal data.

## 3. Supabase Integration

### 3.1 Postgres
- Accessed via `@supabase/supabase-js` (browser: anon key, RLS-bound) and via a
  server-only client (service-role key) for privileged operations (Student ID
  assignment, payment confirmation, receipt numbering) that must run inside an
  explicit transaction with row locking beyond what the anon-key client can do
  through PostgREST alone. For these transactional operations we use a direct
  Postgres connection (`postgres.js`/`pg` via Supabase's connection string, or a
  Postgres function/RPC called through the Supabase client) rather than composing
  multiple separate REST calls that could interleave.
- Migrations via Supabase CLI (`supabase migration new`, `supabase db push`).

### 3.2 Auth
- Supabase Auth (email/password V1). Server-side session read via
  `@supabase/ssr`'s `createServerClient` in Server Components/Route Handlers/
  Middleware. Admin operations (inviting a Trainer/Admin user) use the Supabase
  Admin API (`auth.admin.createUser` / `inviteUserByEmail`) from server-only code
  with the service-role key.

### 3.3 Storage
- Buckets: `materials`, `submissions`, `documents`, `certificates`, `receipts`
  (see `DATABASE_SCHEMA.md` §7). All private; access via
  `createSignedUrl(path, expiresInSeconds)` minted only after the authorization
  check for that specific file's owning entity passes.
- Uploads: either (a) client uploads directly to a signed upload URL issued by the
  server after validating the intended file's metadata, or (b) small files proxy
  through a server action that validates content before writing to Storage.
  Approach (b) is preferred for anything requiring MIME-sniffing before acceptance
  (§8 of `SECURITY_PLAN.md`), since a pure client-side signed-upload cannot
  inspect file bytes before they land in Storage.

## 4. Transactional Email Integration

- Abstracted behind `lib/email/EmailSender`:
  ```ts
  interface EmailSender {
    send(input: { to: string; templateKey: string; data: Record<string, unknown> }): Promise<{ providerMessageId: string }>;
  }
  ```
- **Recommended provider: Resend** — simple API, good deliverability, first-class
  React Email template support, generous free tier suitable for an early-stage
  institute's volume. **SendGrid** documented as the drop-in alternative (same
  interface, different adapter) if the business already has a SendGrid relationship
  or needs its specific compliance/deliverability tooling.
- Templates authored as React Email components (`lib/email/templates/*.tsx`),
  rendered to HTML server-side; all branding fields (logo, company name, address,
  footer) pulled from `company_settings` at render time — no hard-coded company
  detail in a template file.
- Every send recorded in `email_log` (recipient, template key, provider message ID,
  status, related entity) for support/troubleshooting.
- `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME` are configurable environment
  variables tied to the sending domain verified with the provider.

## 5. PDF Generation

### 5.1 Receipts
- **Recommended: `@react-pdf/renderer`.** Receipts are structurally simple
  (header, line items, totals, footer) and benefit from a typed, component-based
  layout with fast, dependency-light server-side rendering (no headless browser
  process needed, which matters for Vercel serverless cold-start time and cost).
- Generated once, at payment confirmation time, and stored in the `receipts`
  bucket — never regenerated on each download (a receipt's content must be
  immutable once issued, matching its role as a financial record).

### 5.2 Certificates
- **Recommended: `@react-pdf/renderer` for V1**, matching the receipt approach for
  consistency and simplicity; if the business later wants a highly designed,
  graphic-heavy certificate (custom fonts, background artwork, precise pixel
  layout), an HTML/CSS-driven headless-Chromium render
  (`puppeteer-core` + `@sparticuz/chromium`, viable on Vercel serverless) is the
  documented upgrade path — noted as a P1 decision point depending on how
  elaborate the desired certificate design turns out to be (flagged in
  `DECISIONS_NEEDED.md` only if the business has a strong design requirement;
  otherwise `@react-pdf/renderer` ships by default).
- Certificate PDFs, once issued, are stored and never mutated; a "reissue" creates
  a new certificate row (new number) and marks the prior one `revoked`, preserving
  history per §28 of the brief.

## 6. Public Certificate Verification API

- `GET /api/certificates/verify?number=CERT-2026-000001`
- No authentication; rate-limited (see `SECURITY_PLAN.md` §11) to prevent
  enumeration abuse.
- Response includes only: student display name (first name + last initial, or full
  name per business preference — flagged in `DECISIONS_NEEDED.md`), program name,
  issue date, and status (`issued`/`revoked`). Returns a generic "not found" for
  any non-existent or malformed number — never distinguishes "wrong format" from
  "doesn't exist" in a way that would aid enumeration.

## 7. CSV Export

- `GET /api/exports/[report]?filters=...` — Admin/Super Admin only, streams a CSV
  built from the same paginated query used by the on-screen report but iterated
  server-side in bounded batches (not loading the full result set into memory at
  once for very large exports), using Node's streaming response support in Route
  Handlers.

## 8. Future Integrations — Design Notes (Not Built Now)

| Integration | What the architecture already allows | What would need to be added |
|---|---|---|
| WhatsApp Business API | `notifications.channel` already models multi-channel; `NotificationDispatcher` is adapter-based | A `WhatsAppSender` adapter, opt-in consent field on `students`, template approval with Meta |
| Zoom / Google Meet | `batches.meeting_link` / `class_sessions.meeting_link` are plain URLs today | An adapter that calls the provider's API to auto-create a meeting and populate that same field — no schema change needed |
| Google Calendar | Class sessions already have date/time/timezone fields | A sync service publishing `.ics` or calling the Calendar API per session |
| CRM / Meta Leads | `leads` table already has `source` and status pipeline | An ingestion adapter mapping external lead payloads into the existing `leads` schema |
| Accounting software (e.g. Tally/Zoho Books) | `payments`/`receipts` are already immutable, sequential, and exportable | An export/sync adapter mapping our payment records to the target system's ledger format |
| Mobile app | All business logic already lives server-side behind server actions/route handlers, not embedded in page components | Exposing a subset of routes as a versioned JSON API (most server actions would need Route Handler equivalents for non-browser clients) |
| AI assistant | N/A architecturally | Would consume the same data-access layer read APIs — no blocker |
| Placement/job module | `students`/`enrollments` provide the anchor entities | New tables (`placement_profiles`, `job_postings`, `referrals`) as a self-contained addition |
| Multi-branch | `company_settings` is already isolated from scattered constants | Add `branch_id` to batches/enrollments/leads and a `branches` table |
| Multi-tenant SaaS | Domain functions already take an explicit context object rather than reading globals | Add `tenant_id` everywhere, rescope RLS and sequences per tenant, add tenant resolution in middleware (see `ARCHITECTURE.md` §15) |

None of these are implemented in V1; they are listed here specifically to show the
current architecture does not foreclose them.
