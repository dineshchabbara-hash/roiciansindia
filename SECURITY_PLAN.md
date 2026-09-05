# SECURITY_PLAN.md

## Roicians Tech — Training Management System / LMS

**Status:** Draft v1.0 (Planning Phase)

---

## 1. Threat Model Summary

The platform holds PII (student contact/address details), financial data (payments,
fees), and academic records (attendance, grades, certificates) for potentially
thousands of individuals. Primary risks: horizontal privilege escalation (a student
or trainer reading another's data by ID manipulation), payment tampering (client
supplying a lower amount, or spoofed webhook events), credential compromise, file
upload abuse, and data exposure through misconfigured storage or verbose errors.

## 2. Authentication

- Supabase Auth (email/password) for all four roles; no custom password hashing/
  session code is written — proven, audited infrastructure handles this.
- Password policy: minimum length 10, standard complexity guidance surfaced in the
  UI (Supabase Auth enforces its own minimum; we set a stricter client+server hint).
- Forgot/reset password via Supabase's signed, time-limited reset link flow.
- Session cookies: httpOnly, secure, SameSite=Lax, managed by `@supabase/ssr` —
  never stored in localStorage/sessionStorage (which would be readable by any
  injected script, i.e. an XSS would be an instant session theft).
- Session expiry: short-lived access token (Supabase default ~1hr) with refresh
  token rotation; server-side re-validation on every protected request, not a
  cached "logged in" flag.
- Admin/Trainer account creation is invite-only (no public signup route for these
  roles) to eliminate the "attacker registers as Admin" vector entirely.
- **Rate limiting on `/login` and `/forgot-password`**: per-IP and per-email token
  bucket (e.g. 5 attempts / 15 minutes) to blunt credential stuffing and enumeration.

## 3. Authorization (Server-Side, Defense in Depth)

Three independent layers, each of which must pass:

1. **Route-group layout check** — role read from the session and matched against
   the required role for `/admin`, `/trainer`, `/student`; mismatch → redirect.
   This stops casual navigation, not a determined attacker crafting raw requests.
2. **Server action / API route authorization** — the actual control. Every
   mutation and every non-trivial read:
   - Confirms the caller's role.
   - For Trainer: confirms the target batch/session/student is within the
     trainer's `batch_trainers` assignment — re-queried from the DB on every call,
     never cached client-side or trusted from a hidden form field.
   - For Student: confirms the target `student_id`/`enrollment_id`/`payment_id`
     belongs to the authenticated user's own `students` row — again, re-derived
     from the session's `auth_user_id`, never accepted as a client-supplied
     parameter used for authorization.
3. **Postgres Row Level Security** — a second, DB-level barrier so that even a
   defect in (2), or a stray direct Supabase client call from a client component,
   cannot leak another student's or trainer's rows. See
   `USER_ROLES_AND_PERMISSIONS.md` §5 for the policy summary.

**Explicit rule:** an object ID appearing in a URL or request body is *never* itself
sufficient authorization — it is always joined back to the authenticated identity
before use (prevents Insecure Direct Object Reference / IDOR).

## 4. Input Validation

- **Zod schemas** in `lib/validation/*`, one per entity/command (e.g.
  `createStudentSchema`, `recordOfflinePaymentSchema`). The same schema validates
  client-side (for UX) and is **re-run server-side** inside the server
  action/route handler — client validation is never trusted alone.
- Server actions/route handlers reject on the first validation failure with a
  generic, safe error message; the specific field-level messages returned to the
  client are drawn from the Zod schema's own messages (never raw exception text).
- Numeric/financial fields validated for correct precision/scale and non-negative
  values before ever reaching a domain calculation.

## 5. Output Handling / XSS Prevention

- React's default JSX escaping handles the vast majority of output safety; no use
  of `dangerouslySetInnerHTML` on any user-supplied content (notes, messages, lead
  submissions, assignment text). Where rich text is genuinely required later, it
  goes through a sanitizer (e.g. `sanitize-html`) with an allow-list, not a
  deny-list.
- Email templates that interpolate user-supplied text (student name, lead message)
  HTML-escape those values before interpolation.

## 6. SQL Injection Prevention

- All database access goes through parameterized queries — either the Supabase
  JS client's query builder or `pg`/`postgres.js` with tagged-template/parameterized
  calls. No string-concatenated SQL anywhere in the codebase (enforced by code
  review checklist and, where practical, a lint rule flagging raw template-literal
  SQL construction).

## 7. CSRF Considerations

- Next.js Server Actions use framework-generated, single-use action references
  bound to the origin, which substantially mitigates classic CSRF for form
  submissions. Route handlers that accept browser-originated state-changing
  requests (rare — mostly reserved for webhooks, which use a different trust
  model) additionally check `Origin`/`Referer` headers where session cookies are
  involved.
- Webhook endpoints (`/api/razorpay/webhook`) are **not** session-authenticated and
  are exempt from CSRF concerns by nature (no cookie, no session); they are secured
  instead by HMAC signature verification (§10).

## 8. File Upload Security

- Every upload path (profile photo, student documents, materials, assignment
  attachments/submissions) enforces, server-side, before accepting the file:
  - **Extension allow-list** per upload context (e.g. images: `.jpg/.jpeg/.png/.webp`;
    documents: `.pdf/.doc/.docx/.ppt/.pptx/.xls/.xlsx`; optionally `.zip` only where
    explicitly enabled for a context).
  - **MIME sniffing** of the actual file bytes (not just the trusted `Content-Type`
    header) to confirm the content matches the claimed extension.
  - **Size limits** per context (e.g. 10MB for documents, 5MB for images),
    rejected before the full body is buffered where the storage API supports
    streaming limits.
- Storage keys are generated server-side using a random/opaque identifier plus the
  owning entity's UUID — never the user-supplied original filename directly in the
  path (avoids path traversal and predictable enumeration); the original filename
  is retained only as display metadata.
- All buckets are **private**; every download goes through a signed, time-limited
  URL minted only after the authorization check in §3 passes. No bucket is ever
  configured public, and no upload is ever executed as code (no upload path is
  served as an executable asset; static files are served with
  `Content-Disposition` hints to prevent inline execution of HTML/SVG uploads in a
  way that could enable stored XSS via a self-hosted "file view").
- Assignment submissions are private to the submitting student and the assigned
  trainer/admin — never listable by other students.

## 9. Payment Security

- **Server-authoritative amount:** the client never sends an amount to be charged;
  it sends an enrollment/installment identifier, and the server re-derives the
  exact amount from `enrollments`/`installments` before creating the Razorpay
  Order. A tampered client request changes nothing about what gets charged.
- **Razorpay Checkout signature verification:** on the client-side completion
  callback, the server verifies `razorpay_signature` against
  `razorpay_order_id|razorpay_payment_id` using the Razorpay key secret
  (`crypto.createHmac('sha256', keySecret)`) before treating the payment as
  provisionally successful.
- **Webhook signature verification:** the webhook handler independently verifies
  the `X-Razorpay-Signature` header against the raw request body using the
  webhook secret — this, not the client callback, is the ultimate source of truth
  for payment status.
- **Idempotency:** the `payments.razorpay_payment_id` column has a unique
  constraint; the webhook handler upserts by that key inside a transaction, so a
  redelivered event (Razorpay retries on non-2xx or on its own schedule) cannot
  create a duplicate payment row or double-apply a balance reduction. Every
  webhook delivery is additionally logged with its Razorpay event ID for
  troubleshooting.
- **Amount cross-check:** even after signature verification, the webhook handler
  confirms the paid amount matches the expected amount recorded when the order was
  created; a mismatch is flagged (payment held as `authorized`, not auto-marked
  `paid`) and surfaced to Admin rather than silently trusted.
- Razorpay key secret and webhook secret are server-only environment variables,
  never exposed to the browser (only the public `key_id` is sent client-side for
  Checkout initialization).

## 10. Webhook Security (General)

- Signature verification is mandatory for every inbound webhook (Razorpay today;
  the same pattern applies to any future provider webhook).
- Webhook routes reject requests without a valid signature with a generic 400,
  logged server-side with enough detail to investigate (not exposed to the
  caller).
- Replay protection via the idempotency key described in §9; additionally, events
  older than a reasonable window (e.g. 24h, per Razorpay's own timestamp) are
  logged but not reprocessed if already terminal.

## 11. Rate Limiting

Applied (token-bucket, per-IP and/or per-account as appropriate) to:
- `/login`, `/forgot-password`, `/reset-password`
- Payment initiation endpoints (`create-order`)
- Public lead/inquiry form
- Public certificate verification (`/verify-certificate`) — prevents brute-forcing
  certificate numbers to enumerate student names
- Implementation: Upstash Redis (serverless-friendly, works well with Vercel) or a
  Postgres-table-backed limiter if avoiding an extra managed service is preferred;
  documented as configurable in `API_AND_INTEGRATIONS.md`.

## 12. Error Handling & Safe Messaging

- All server actions/route handlers catch and normalize errors into a small set of
  user-safe messages ("Something went wrong. Please try again." / specific
  validation messages from Zod). Stack traces, SQL errors, and provider error
  payloads are logged server-side only (see §13) and never included in the
  response body sent to the browser.
- A shared `AppError` class distinguishes expected domain errors (safe to show a
  specific message, e.g. "This batch is at capacity") from unexpected errors
  (generic message + full server-side log).

## 13. Logging

- Structured server-side logs for: payment failures, webhook failures/signature
  mismatches, authentication failures beyond a threshold, and unhandled
  exceptions.
- **Never logged:** passwords, Supabase/Razorpay/email API secrets, full
  Razorpay signatures/keys, session tokens, full payment card data (never handled
  by us at all — Razorpay Checkout keeps card data off our servers entirely).
- Audit logs (`audit_logs` table, business-level trail) are distinct from
  operational logs (system-level trail) — see `DATABASE_SCHEMA.md` §4 for the
  audit table's own redaction rule.

## 14. Data Protection & Privacy

- Collect only the personal data explicitly required (per REQUIREMENTS.md §7,
  §7-item-7 — DOB/gender/emergency contact are optional, not mandatory).
- Student contact email is not required to be globally unique (accommodates shared
  family emails); **authentication** email/identity is always unique at the
  Supabase Auth level — this separation is documented so the distinction is never
  lost during implementation (see `REQUIREMENTS.md` §7 item 4).
- Public certificate verification returns only non-identifying-enough data (name,
  program, issue date, status) — no email, phone, address, or payment info.
- Internal staff notes (`student_notes`) are never exposed to the student portal.

## 15. Delete Policy

- Students, Enrollments, Payments, Certificates, Batches: never hard-deleted once
  they carry real history. Lifecycle uses `status` (`active`/`inactive`/
  `archived`, or entity-specific equivalents like `withdrawn`/`cancelled`/
  `revoked`).
- Genuine hard-delete (e.g. a duplicate test record created by mistake, before any
  payment/attendance exists) is permitted only for Super Admin, requires a
  confirmation step, and is itself audit-logged (who deleted what, when) even
  though the deleted row itself is gone.
- Leads and notifications, which carry no downstream financial/academic
  dependency, may be hard-deleted more liberally (e.g. spam lead cleanup) without
  the same restriction.

## 16. Secrets & Environment Variables

- No secret is ever committed. `.env.example` lists every required variable name
  with a placeholder value and a comment describing where to obtain it.
- Service-role Supabase key, Razorpay key secret, Razorpay webhook secret, and the
  email provider API key exist only in server-side environment variables (Vercel
  project settings per environment) and are imported only from server-only
  modules — never from a file marked `"use client"`.
- Distinct credential sets for local/dev, staging, and production (separate
  Supabase projects, separate Razorpay test/live keys).

## 17. Dependency & Supply Chain Hygiene

- Dependencies kept minimal and from well-maintained, widely used packages
  (Next.js, Supabase SDK, Zod, shadcn/ui, Razorpay Node SDK, a PDF library, an
  email provider SDK). `npm audit`/Dependabot-equivalent alerts reviewed
  periodically; no dependency is installed with `--force`/ignored peer
  vulnerabilities without review.

## 18. Security Testing Priorities (see also TESTING in IMPLEMENTATION_PLAN.md)

Mapped to the brief's §58 list:
- Authentication flows (login, reset, session expiry).
- Authorization/permission boundaries (student cannot read another student's
  enrollment/payment/attendance by ID substitution; trainer cannot access
  unassigned batch).
- Student ID generation uniqueness/concurrency (parallel creation test).
- Program code uniqueness constraint.
- Payment amount derivation correctness (server-computed vs. any client-supplied
  value is ignored).
- Razorpay signature verification (valid/invalid/tampered signature cases).
- Webhook duplicate-delivery handling (same event delivered twice → one payment
  row, one balance update).
- Receipt number uniqueness under concurrent payment confirmation.
- Attendance authorization (trainer cannot mark attendance for a batch they are
  not assigned to).

## 19. Ongoing Security Practices

- New server actions/route handlers touching student, payment, or trainer data go
  through a short security checklist at review time: role check present? ownership
  re-derived from session (not trusted from input)? Zod validation present? audit
  log written where required?
- The `security-review` skill (already available in this environment) should be
  run against the diff before merging any phase that touches authentication,
  payments, or file uploads, as an additional automated pass.
