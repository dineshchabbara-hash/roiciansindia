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
  or enquiry submissions, assignment text, Phase 22 website content). Where rich text is genuinely required later, it
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

### 9a. Offline payment recording (Phase 20A)

- Admin/Super Admin only, checked three times: the `/admin` layout gate plus
  an explicit role check in every Payments page and in
  `recordOfflinePaymentAction`; and inside `record_offline_payment()` itself
  (`is_admin_or_super()` + an `admins` profile). Trainers and Students have no
  route, no action path and no EXECUTE path (anon has no grant); Trainers
  still read no payment row; a Student still reads only their own.
- The database function is the only end-user write path into `payments`
  (no INSERT/UPDATE/DELETE policy remains). It derives `student_id` from the
  enrollment and `created_by` from the session — the form never submits a
  student, admin, status, tax or payment code (`recordOfflinePaymentSchema`
  has no such fields).
- FR-91 is enforced in the database, not by hiding an Edit button: a
  settled payment cannot be updated by any role, service_role included.
  Service-role deletion remains possible only for controlled operations
  (E2E fixture cleanup by exact id); no application path deletes payments.
- Overpayment and double submission are race-safe: the enrollment row is
  locked for the check-and-insert, and the form carries a server-minted
  payment id so a resubmission returns the existing payment.
- Audit: `payment.recorded_offline` via the existing `writeAuditLog`
  (service-role insert, append-only), minimal metadata, no free text.

### 9b. Online payments — Razorpay TEST MODE (Phase 20B)

- Trust boundary: the browser sends only an enrollment id + option
  (order) and Razorpay's Checkout result (verification). Amount, student,
  ownership and success are all decided server-side; success only by
  Razorpay (HMAC-verified callback + server-side fetch showing `captured`,
  or an HMAC-verified `payment.captured` webhook).
- Secrets: `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are read only
  in `lib/payments/razorpay-config.ts` (`server-only`); the key id reaches
  the browser per order, never via `NEXT_PUBLIC_`. Live keys (`rzp_live_`)
  are refused. Build-output scan: no secret name/value in `.next/static`.
- Signatures: HMAC-SHA256 with `timingSafeEqual` (the SDK's `===`
  comparators are not used); webhook HMAC over the raw body read before
  parsing; body capped at 256 KB.
- Authorization: order creation and verification are Student-only actions
  (rate-limited, SEC-7) operating on the session's own student id; the two
  database functions are service_role-only; `payment_orders` /
  `razorpay_webhook_events` have no end-user write policy; Trainers read
  nothing; Admins cannot forge an order or a finalization.
- Webhook endpoint: no session or cookie; excluded from the session proxy;
  responses carry no detail; non-2xx only for bad signature/body (400), not
  configured (503) or transient failure (500 → Razorpay redelivers).
- Data minimization: Roicians stores Razorpay ids, amount, currency and
  status only — no card/UPI/bank data, no signature, no webhook payload;
  order notes carry codes only (API_AND_INTEGRATIONS.md §2.9).

### 9c. Receipts & payment documents (Phase 21A)

- Issuance is server-only: `issue_receipt()` is service_role-only and is
  reached from the Admin recording action, the Razorpay finalization path
  (after a verified `recorded` outcome) and the download route — each after
  its own authorization. Receipt numbers are minted DB-side from a global
  sequence; end-user roles have no sequence privileges.
- Only `paid` payments qualify (function check + BEFORE INSERT trigger for
  every writer); one receipt per payment (unique constraint); number,
  payment, path and issue time are immutable; no end-user write or delete
  policy on `receipts` or the `receipts` bucket.
- Amounts and identities are read from the canonical ledger row and the
  database — never from request input, Razorpay's API or a Checkout
  callback; tax is never recalculated.
- Downloads: `GET /api/payments/[id]/receipt` reads through the viewer's
  own RLS session (payments, receipts, storage object) and streams the PDF
  with `Cache-Control: private, no-store`; the storage path is never sent
  to the browser; another Student's payment id → 404 (indistinguishable
  from unknown) and triggers no issuance; Trainer 403; anonymous 401.
- The PDF never contains auth ids, internal uuids, storage paths, Razorpay
  order ids, signatures, webhook data or card/bank details (unit-tested on
  the rendered PDF text).
- Audit: one `receipt.issued` row per receipt (system actor), written in
  the issuing transaction; downloads are not audited.

### 9d. Refunds (Phase 21B)

- Who: Admin and Super Admin only (server action role check **and** an
  `is_admin_or_super()` check inside each SECURITY DEFINER function).
  Students see their own refunds read-only (existing
  `payment_refunds_select_own`); Trainers and anonymous users have no
  access. No approval workflow.
- No end-user INSERT/UPDATE/DELETE on `payment_refunds` (write/update
  policies dropped); writes go only through `record_offline_refund`,
  `reserve_razorpay_refund` (authenticated, admin-checked) and
  `apply_razorpay_refund_status` / `fail_unsent_razorpay_refund`
  (service_role only).
- Over-refund is impossible at the database: a trigger locks the payment
  row and caps processed + in-progress refunds at the payment amount
  (proven with two concurrent sessions — exactly one of two over-cap
  refunds commits). A refund row's amount, payment, reason and initiator
  are immutable; processed/failed are final.
- Razorpay: the refund is always sent against the `razorpay_payment_id`
  stored on the payment, never request input; TEST keys only; refund
  webhooks are signature-verified, deduped by event id, and must match
  payment id, amount and currency before anything changes. Nothing from a
  webhook payload is stored beyond ids and the outcome.
- Financial integrity: a refund never edits the payment (stays `paid`,
  Phase 20A immutability unchanged), the receipt, or the enrollment's fee
  terms/installments. Only `processed` refunds change outstanding.
- Audit (append-only): `refund.recorded_offline`, `refund.initiated`
  (Admin actor), `refund.processed`, `refund.failed` (system actor, once per
  transition).

### 9e. Administration & identity (Phase 21C)

- **Role-escalation fix:** `user_roles` had Admin INSERT/UPDATE/DELETE
  policies, so any Admin could write a `super_admin` role. Dropped (migration
  39); end users now have SELECT only on `user_roles` and `admins`. Roles are
  written only by server code with a fixed role: trainer creation, Student
  provisioning (`student`) and Admin creation (`admin` — never
  `super_admin`). The browser never submits a role, a login id or a password.
- **Login links are server-authoritative:** a trigger refuses any end-user
  change of `students/trainers/admins.auth_user_id`; linking happens only in
  service-role functions under a profile row lock plus a per-login advisory
  lock (proven by `scripts/test-portal-provisioning-concurrency.sh`).
- **No passwords handled:** provisioned logins are created without
  supplying a password (Supabase Auth stores a random hash nobody knows);
  the owner sets theirs through Supabase Auth's recovery flow. A
  pre-existing login for the email is adopted only if it carries the
  service-role-only `app_metadata.lms_provisioned` marker, has no role, no
  profile link and has never signed in; anything else is refused. Tokens never pass
  through application code except `/auth/confirm`, which verifies a
  `token_hash` server-side (recovery/invite only, fixed destination).
- **Deactivated Admins:** `admins.status = 'inactive'` makes
  `is_admin_or_super()` false immediately (RLS), the session helper treats
  the user as signed out, and the login is banned (no new sign-in).
- **Company Settings:** Super Admin UPDATE only (RLS + action check), Admin
  read-only, others nothing; values constrained in the database (numbering
  formats keep `{seq:N}`, GSTIN pattern, logo path). Logo/photo uploads are
  type-checked by their bytes (PNG/JPEG/WebP only — no SVG) and size-capped;
  storage writes use the service role only after the caller's check.
- **Audit Log viewer:** read-only through the viewer's session; Admin sees
  everything except `admin_account` entries; displayed values are
  truncated and credential-like keys masked. Account and settings changes
  are audited (`student.portal_access_granted`, `admin_account.*`,
  `company_settings.*`, `student.profile_photo_*`).
- **FR-41 photos:** private bucket; readable by the owning student and Admins
  only; the path must sit in the student's own folder (check constraint);
  served through a session-checked route with `private, no-store`.

### 9f. Public website & Website Management (Phase 22 — approved design, not implemented)

Requirements recorded in
[`docs/requirements/PHASE_22_APPROVED_DESIGN.md`](docs/requirements/PHASE_22_APPROVED_DESIGN.md)
(§3, §5, §8, §9, §13, §14, §16); none of this exists yet.

- **Published-data contract:** the website reads only expressly published,
  permitted fields through a server-only contract (Phase 22C). No `anon`
  policy on any private LMS table; the migration 14 comment anticipating
  one is superseded. The service-role key never reaches browser code.
- **No leakage channel:** confidential LMS values must not leak through
  HTML, API responses, caches, preview pages, metadata, structured data,
  sitemaps or URLs. Never public: any course fee or financial value;
  Batch capacity, cohort size, enrollment counts, seats remaining, meeting
  links, internal names, notes, private locations; private Trainer or
  Student data.
- **Website Management authorization:** Admin and Super Admin only; Super
  Admin alone changes a published Program slug (audited, with redirect).
  Website editing grants no finance, authentication, role, RLS, deployment
  or Company Settings permission. New website tables are private by
  default.
- **Content safety:** structured forms and templates only — no unrestricted
  HTML/code editor; rich text, if any, passes an allow-list sanitizer
  (§5). Drafts and previews are authenticated, never cached publicly,
  never indexed.
- **Revisions and concurrency:** editor and publisher identity, timestamps,
  revision history, safe restoration and lost-update prevention; audit
  records carry no passwords, tokens, secrets or unnecessary private data.
- **Hostnames (Phase 22D):** allowlist of recognized hosts; unknown hosts
  refused; a portal host serves only its own area; portal session cookies
  host-only and never sent to the public website host; role checks and RLS
  remain the authority.
- **Enquiries (Phase 22H):** validation, spam protection, rate limiting and
  consent; no false success before Zoho delivery (Phase 23); no temporary
  CRM storage.
- **Public media:** approved public assets kept apart from every existing
  private LMS bucket, which stays protected.

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
- Public enquiry forms (Phase 22H: Talk to an Advisor, Program, Batch,
  Interest List, Corporate and Institutional enquiries)
- Public certificate verification (`/verify-certificate`) — prevents brute-forcing
  certificate numbers to enumerate student names
- Implementation: Upstash Redis (serverless-friendly, works well with Vercel) or a
  Postgres-table-backed limiter if avoiding an extra managed service is preferred;
  documented as configurable in `API_AND_INTEGRATIONS.md`.
  (Phase 17 implementation note: `/verify-certificate` reuses the
  Upstash-Redis-or-in-memory-fallback backend `lib/auth/rate-limit.ts`
  already built for `/login`/`/forgot-password` — 10 requests/60s per IP
  — rather than introducing a second, Postgres-table-backed mechanism; no
  certificate-specific conflict with that existing backend was found.)

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
- **Programs (Phase 22 decision P22-08, revised; design §7):** archive-first.
  Admin and Super Admin may archive and restore. Only Super Admin may
  permanently delete a verified safe, unused **archived** Program, through
  a controlled workflow: eligibility check, review, reason, Program-code
  confirmation, recheck, deletion, durable audit record. Any protected
  dependency (Batches, enrollments, certificates, financial records,
  sessions, attendance, assignments, modules, materials, enquiry or website
  references) blocks deletion; there is no override, no Admin delete, no
  direct deletion of an unarchived Program, no automatic or bulk deletion.
  Enforcement is server-side and in the database, independently verifies
  Super Admin authority, and is concurrency-safe; the audit record survives
  and carries no unnecessary personal data. File cleanup applies only to
  ownership-established public website assets and never to private
  learning, receipt, certificate or student-document storage. **TI-1:**
  migration 41 (Phase 22A branch, not merged; not yet applied to DEV)
  replaces the broad `programs_delete_admin` DELETE with a guard trigger and
  the Super-Admin-only `delete_archived_program()` (see
  `docs/requirements/PHASE_22A_IMPLEMENTATION.md` §4); until it is applied
  and merged, the broad delete remains in deployed databases. This
  rule is Program-specific and does not change the rules for other record
  types.
- Leads, which carry no downstream financial/academic dependency, may be
  hard-deleted more liberally (e.g. spam lead cleanup) without the same
  restriction. (The `leads` table is currently unused: leads are managed in
  Zoho CRM from Phase 23.) Notifications are no longer hard-deletable by any application
  role (Phase 18 V1, approved decision C4): sent content is immutable — only
  the recipient's read state changes — and there is no delete policy. A
  recipient's notifications are removed only when their auth account is
  deleted (FK cascade).

## 15a. Reports & CSV Export (Phase 19)

- Reports (`/admin/reports/*`) and exports (`/api/exports/[report]`) are
  Admin/Super Admin only, enforced three times: the `/admin` layout gate, an
  explicit role check in each report page and in the export Route Handler
  (which a layout cannot protect), and RLS — every report query runs on the
  caller's own session, never the service role, and both report views are
  `security_invoker` (pinned by `supabase/tests/phase19_reports_test.sql`).
- Read-only: no report screen or export performs any write.
- Minimal fields: Student report contact fields are limited to what the
  Admin Students list already shows (code, name, email, phone, status,
  registration date); no address, date of birth, emergency contact, auth or
  storage identifiers anywhere. Certificate exports never include `pdf_path`
  or a signed URL. The Trainer report shows only what Admin Trainer
  Management already shows (name, email, phone, status, specialization,
  date added, assigned-batch count) — never `auth_user_id` or `bio`.
- Filter input is validated/whitelisted (UUIDs, ISO dates, enum statuses,
  sort keys); free-text search is stripped of PostgREST filter syntax.
- CSV exports are capped (5,000 rows, refused above — never truncated) and
  neutralize spreadsheet formulas (`=`, `+`, `-`, `@`, tab, CR prefixes).

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
