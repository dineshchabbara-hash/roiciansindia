# REQUIREMENTS.md

## Roicians India — Training Management System / LMS

**Status:** Draft v1.0 (Planning Phase)
**Owner:** Product/Engineering
**Last updated:** 2026-09-05

This document consolidates the complete requirement set for the platform, grouped by
category. Each requirement is tagged with a priority where useful:

- **P0** — Critical for V1 launch
- **P1** — Important, follows shortly after V1
- **P2** — Future / not built now, but architecture must not block it

Wherever the original request contained ambiguity, a contradiction, or a gap, a
**[DECISION]** or **[ASSUMPTION]** note is inline. Items requiring explicit business
sign-off are also listed in `DECISIONS_NEEDED.md`.

---

## 1. Business Requirements

- BR-1: Operate as a single-tenant platform for one IT training company in India (brand
  name/logo/contact details to be supplied via configurable Company Settings, not
  hard-coded). **[ASSUMPTION]** No company name was provided; we use `Roicians India`
  as a placeholder derived from the repository name and will not invent a different
  brand. All branding must be edited from Settings before go-live.
- BR-2: Support the full student lifecycle: Lead → Registration → Student record →
  Enrollment → Payment → Active → Completed/Withdrawn.
- BR-3: A Student ID is permanent and belongs to the person, not to any one enrollment.
  One student may hold multiple concurrent or historical enrollments across programs.
- BR-4: A Program (e.g. "AI Powered QA / Software Testing") is distinct from a Batch
  (a scheduled run of that program, e.g. "September 2026 Weekend Batch"). Many batches
  belong to one program; a program is never duplicated to represent a new batch.
- BR-5: Payments are tracked per-enrollment. A payment for one enrollment must never
  affect the outstanding balance of a different enrollment belonging to the same
  student.
- BR-6: The system must support online payment (Razorpay) and admin-recorded offline
  payment (cash/UPI/bank transfer/cheque), both producing receipts.
- BR-7: The system must scale to thousands of students without requiring architecture
  changes (pagination, indexing, no unbounded client-side loads).
- BR-8: Must be usable day-to-day by non-technical administrative staff.
- BR-9: Public marketing website and the operational portals (Admin/Trainer/Student)
  ship from the same codebase/brand system.
- BR-10: The platform must be defensible as a genuine institute-management product —
  no fake buttons, no placeholder numbers presented as real data (see `REQ-DEMO`
  below).

## 2. Functional Requirements

### 2.1 Identity & Access
- FR-1 (P0): Role-based accounts: Super Admin, Admin, Trainer, Student.
- FR-2 (P0): Email/password authentication with forgot/reset password flow, secure
  session handling, session expiry.
- FR-3 (P0): Role-based redirect after login: `/admin`, `/trainer`, `/student`.
  Direct URL access to another role's area must be blocked server-side, not just
  hidden in navigation.
- FR-4 (P0): Students cannot self-register as Trainer/Admin. Trainer accounts are
  created/invited by Admin/Super Admin only.
- FR-5 (P1): OTP, Google/Microsoft SSO reserved for future (P2) — auth abstraction
  must not block adding these later.

### 2.2 Student Management
- FR-10 (P0): Create/edit/view/deactivate student profiles; students are never hard
  deleted (see Delete Policy in `SECURITY_PLAN.md`).
- FR-11 (P0): Student ID auto-generated, starting at `10001`, sequential, unique,
  immutable, generated via a DB-safe sequence (never `MAX(id)+1`).
- FR-12 (P0): Search/filter by Student ID, name, email, phone, status, program, batch.
- FR-13 (P0): Student detail view aggregates enrollments, payments, attendance,
  assignments, certificates, and internal notes (staff-only, never shown to student).
- FR-14 (P1): Duplicate-detection warning (by email or phone) at creation time, with
  explicit Admin override allowed (family/shared-contact scenarios are legitimate).

### 2.3 Program & Batch Management
- FR-20 (P0): CRUD for Programs: name, unique program code, description, duration,
  delivery mode, regular fee, registration fee, tax rate/class, status, category,
  thumbnail, certificate eligibility, payment-plan availability.
- FR-21 (P0): Program codes are admin-defined (not system-generated) but enforced
  unique; format is free text validated against a configurable pattern.
- FR-22 (P0): CRUD for Batches, each batch belongs to exactly one Program; fields per
  spec §11 (schedule, capacity, trainer(s), status, meeting link/location).
- FR-23 (P0): Batch status lifecycle: Draft → Upcoming → Active → Completed /
  Cancelled → Archived.
- FR-24 (P1): Optional course structure: Program → Modules → Lessons, used to scope
  materials/assignments without forcing structure on every program.

### 2.4 Enrollment
- FR-30 (P0): Enrollment links Student + Program + Batch, carries its own immutable
  Enrollment ID, financial terms (agreed fee, discount + reason, registration fee,
  tax, total payable), and a status lifecycle (Lead → Applicant → Registered →
  Enrolled → Active → On Hold → Completed → Withdrawn → Cancelled).
- FR-31 (P0): Outstanding balance is **derived**, not stored as a freely-editable
  number: `total payable − sum(valid payments) − sum(approved refunds/credits)`. See
  §91 logic, reproduced in `DATABASE_SCHEMA.md`.
- FR-32 (P0): A student can hold many enrollments; enrollments are never merged into
  a single "profile balance."

### 2.5 Student Portal
- FR-40 (P0): Dashboard: identity, current program(s)/batch(es), upcoming classes,
  attendance snapshot, assignment snapshot, payment status/outstanding, recent
  payments, certificates, announcements.
- FR-41 (P0): Self-service edit limited to phone, address, profile photo, password.
  Identity/enrollment-critical fields require Admin change (with audit trail).
- FR-42 (P0): View program/batch/trainer/schedule/materials/assignments scoped to the
  student's own enrollments only (enforced server-side + RLS).
- FR-43 (P0): View fees, installment schedule, payment history, outstanding balance;
  pay online via Razorpay; download receipts.
- FR-44 (P0): View own attendance (present/absent/late/excused) and computed
  attendance percentage.
- FR-45 (P1): View/submit assignments, see trainer feedback/marks.
- FR-46 (P1): View/download materials scoped to enrolled batches.
- FR-47 (P1): View/download issued certificates.

### 2.6 Trainer Portal
- FR-50 (P0): Dashboard: assigned programs/batches, upcoming classes, assigned
  student counts, pending review queue.
- FR-51 (P0): View assigned batches and their enrolled students (basic info only —
  no payment data).
- FR-52 (P0): Create class sessions; mark/edit attendance for authorized batches only
  (server-enforced batch-trainer assignment check).
- FR-53 (P1): Upload materials, create assignments, review submissions, add
  feedback/marks scoped to assigned batches.
- FR-54 (P0): Trainers explicitly cannot: view unrelated students, modify payments or
  fees, access Admin settings.

### 2.7 Class Sessions & Attendance
- FR-60 (P0): Class session entity per batch (date/time/topic/meeting
  link/status: Scheduled/Completed/Cancelled/Rescheduled).
- FR-61 (P0): Attendance rows link Student + Enrollment + Batch + Class Session,
  status (Present/Absent/Late/Excused), `marked_by`, timestamp, optional notes.
- FR-62 (P0): Attendance percentage computed on read (view/materialized aggregate),
  not manually maintained.
- FR-63 (P1): Audit trail for attendance changes after initial marking.

### 2.8 Materials & Course Structure
- FR-70 (P1): Upload PDFs/docs/slides/sheets/images/links/video links; attach to
  Program, Batch, Session, or Module.
- FR-71 (P1): Access to materials strictly scoped to the student's active enrollment
  in the related program/batch; storage URLs are never public/guessable.

### 2.9 Assignments
- FR-80 (P1): Assignment entity (program/batch/module, trainer, title, description,
  attachment, assigned/due date, max marks, status).
- FR-81 (P1): Submission entity (student, enrollment, assignment, timestamp, text
  and/or file, status, marks, feedback, reviewer, reviewed date).
- FR-82 (P1): Submission status lifecycle: Not Submitted → Submitted/Late → Reviewed
  → Resubmission Requested.

### 2.10 Payments
- FR-90 (P0): Payment types: registration fee, full payment, installment, partial,
  online (Razorpay), offline (admin-recorded), refund (tracked, P1/P2 execution).
- FR-91 (P0): Payment record is an **immutable transaction row** (see §21/§90 fields);
  balances are never edited directly — only new payment/refund rows change them.
- FR-92 (P0): Razorpay order creation is server-side; amount is always re-derived
  server-side from the enrollment/installment, never trusted from the client.
- FR-93 (P0): Razorpay signature verification on both the checkout-completion
  callback and the webhook; webhook processing is idempotent (dedup by Razorpay
  event ID / payment ID).
- FR-94 (P0): Every successful payment (online or offline) generates a sequential,
  unique receipt number and a downloadable PDF receipt; the student is emailed a
  copy.
- FR-95 (P0): Receipt numbering and Student ID generation must be concurrency-safe
  (Postgres sequences / `SELECT … FOR UPDATE` inside a transaction — never
  `MAX(x)+1` read-then-write).
- FR-96 (P1): Configurable installment plans per enrollment (amount, due date,
  status: Upcoming/Due/Partially Paid/Paid/Overdue/Waived).
- FR-97 (P2): Refund transactions link back to the original payment; original payment
  rows are never deleted or overwritten.

### 2.11 Certificates
- FR-100 (P1): Admin issues certificates per enrollment; sequential unique Certificate
  ID (e.g. `CERT-2026-000001`); PDF generation with company branding.
- FR-101 (P1): Public certificate verification page (`/verify-certificate`) returns
  only non-sensitive fields (student name, program, issue date, validity) given a
  Certificate ID.
- FR-102 (P1): Admin can revoke/reissue with audit history.

### 2.12 Notifications & Email
- FR-110 (P1): Transactional email for: welcome, enrollment confirmation, payment
  receipt, payment reminder, class reminder, assignment notice, certificate issued,
  password reset.
- FR-111 (P1): In-app notification feed per user.
- FR-112 (P2): Architecture leaves room for WhatsApp as an additional notification
  channel without redesign (channel-agnostic notification table + dispatcher).

### 2.13 Reporting
- FR-120 (P1): Student, Enrollment, Payment, Attendance, Trainer reports as listed in
  spec §32, each paginated server-side with CSV export.

### 2.14 Public Website & Leads
- FR-130 (P0): Public pages: Home, About, Programs, Program Detail, Corporate
  Training, Contact, Student Login, Trainer Login (Admin login is not publicly
  linked, but reachable at a known path).
- FR-131 (P1): Public inquiry/lead form; Admin-facing lead list with status pipeline
  (New → Contacted → Follow-up → Qualified → Converted → Not Interested → Closed).
- FR-132 (P1): Converting a lead to a student preserves the original lead source on
  the student/enrollment record.

### 2.15 Settings / Configuration
- FR-140 (P0): Centralized Company Settings (name, legal name, logo, address,
  contact, GSTIN, tax config, receipt/certificate numbering formats, certificate
  signatory, social links). No company detail is hard-coded in UI/code.
- FR-141 (P0): Tax configuration is explicit and off by default until GST details are
  supplied (see `DECISIONS_NEEDED.md`).

### 2.16 Anti-fake-implementation requirement (REQ-DEMO)
- FR-150 (P0): No UI control may claim to perform an action it does not actually
  perform end-to-end. Any temporarily mocked feature must be visibly labeled
  "(Preview / Not Yet Connected)" in the UI and must not appear as a real dashboard
  number, button, or download until backed by real persistence/integration.

## 3. Non-Functional Requirements

- NFR-1 (Scalability): Server-side pagination everywhere; indexed lookups on all
  foreign keys and search fields; no full-table client loads.
- NFR-2 (Performance): Avoid N+1 queries; use Postgres views/materialized aggregates
  for expensive rollups (attendance %, outstanding balances) where reads are
  frequent.
- NFR-3 (Availability): Stateless Next.js deployment on Vercel; Postgres (Supabase)
  as the durable store; no in-memory session state that would break horizontal
  scaling.
- NFR-4 (Usability): Clean, corporate UI; non-technical staff must be able to operate
  Admin Portal without training beyond onboarding docs.
- NFR-5 (Accessibility): WCAG-AA-oriented — keyboard nav, labeled forms, sufficient
  contrast, semantic HTML, accessible dialogs.
- NFR-6 (Responsiveness): Full functionality on desktop/tablet/mobile; complex admin
  tables provide a responsive card/list fallback below a breakpoint.
- NFR-7 (Maintainability): TypeScript strict mode, layered architecture (UI → server
  actions/API → domain/service layer → data access), no business logic embedded in
  components.
- NFR-8 (Auditability): All financially or academically significant mutations are
  audit-logged with before/after where feasible.
- NFR-9 (Internationalization of time): All timestamps stored UTC in Postgres;
  displayed in `Asia/Kolkata` by default via a configurable per-deployment timezone
  setting, not the visitor's browser timezone, for business-critical dates (due
  dates, class times).
- NFR-10 (Money correctness): All currency fields use Postgres `numeric(12,2)`
  (or integer paise where specified) — never IEEE-754 floats — in DB, transport, and
  calculation layers.

## 4. Security Requirements

(Full detail in `SECURITY_PLAN.md`; summarized here as requirements)

- SEC-1: Authorization is enforced server-side on every mutation and every sensitive
  read — UI hiding is a convenience only, never the control.
- SEC-2: Supabase Row Level Security enabled on all tables containing student/
  trainer/payment data, as defense-in-depth alongside application-layer checks.
- SEC-3: All external input (forms, API bodies, query params) validated with Zod on
  the server, regardless of client-side validation.
- SEC-4: File uploads validated by extension + sniffed MIME type + size cap; stored
  under non-guessable keys in private buckets; served via short-lived signed URLs.
- SEC-5: Razorpay webhook signature verification is mandatory; webhook handler is
  idempotent against replayed/duplicate deliveries.
- SEC-6: Payment amount is always recomputed server-side from the enrollment/
  installment record; client-submitted amounts are never trusted.
- SEC-7: Rate limiting on auth endpoints, payment-initiation endpoints, and the
  public lead form / certificate verification endpoint.
- SEC-8: No secrets in source control; all credentials via environment variables;
  `.env.example` documents required variables with placeholders only.
- SEC-9: Error responses never leak stack traces, SQL, or credential material to the
  client; full detail goes to server-side logs only.
- SEC-10: Sensitive actions (fee override, discount, status change, refund) require
  Admin/Super Admin role and are audit-logged.

## 5. Integration Requirements

- INT-1 (P0): Razorpay — Orders API, Checkout, signature verification, Webhooks.
- INT-2 (P0): Supabase — Postgres, Auth, Storage, RLS.
- INT-3 (P1): Transactional email provider (Resend recommended, SendGrid as
  alternative) via an abstracted `EmailSender` interface so the provider can be
  swapped without touching call sites.
- INT-4 (P1): PDF generation for receipts/certificates via a server-side renderer
  (`@react-pdf/renderer` or headless-Chromium HTML→PDF) — see
  `API_AND_INTEGRATIONS.md` for the recommendation and trade-offs.
- INT-5 (P2): WhatsApp Business API, Zoom/Google Meet, Google Calendar, CRM, Meta
  Leads, accounting software, mobile app, AI assistant, placement/job-board module —
  none built now; notification, meeting-link, and identity models are kept
  provider-agnostic to avoid blocking these later.

## 6. Future Requirements (P2 — Not Built Now)

- FUT-1: Multi-branch support (branch/location/business-unit fields reserved but not
  enforced in V1; see `ARCHITECTURE.md` §SaaS/Branch readiness).
- FUT-2: Multi-company SaaS — would require introducing a `tenant_id` on every table
  and rescoping RLS policies; deliberately not done now (see architecture notes on
  what changes later).
- FUT-3: Placement/career module (resume, interview prep, referrals) — data model
  leaves room (student ↔ future `placement_profile` 1:1) but is not implemented.
- FUT-4: Refunds — schema supports it (`payment_refunds` table) but the operational
  refund workflow (Razorpay refund API call) ships after V1 unless required sooner.
- FUT-5: Advanced analytics, mobile app, automation — explicitly deferred.

## 7. Requirements Changed / Clarified From the Original Brief

These are called out explicitly per the "identify missing requirements,
contradictions" instruction:

1. **Program Code format** — the brief gives example codes but says "Admin should be
   able to define program codes" — this is implemented as free-text + uniqueness
   constraint + optional regex validation configured in Settings, not a fixed
   generator, to avoid contradicting the "admin-defined" requirement while still
   preventing collisions.
2. **Student ID vs. Enrollment ID vs. Payment ID** — the brief asks for three
   independent identifier spaces; we use one canonical strategy for all three
   (DB `bigserial`/sequence-backed human-readable codes with distinct prefixes/ranges)
   documented once in `DATABASE_SCHEMA.md` §ID Strategy, rather than three bespoke
   schemes, to keep the concurrency-safety guarantee (§92/§93) consistent everywhere.
3. **"Amount paid" on enrollment** — the brief lists `amount_paid` and
   `outstanding_balance` as enrollment fields (§12) but also mandates (§91) that
   balance must be derived from transactions, not stored as an editable number. We
   resolve this by keeping `amount_paid`/`outstanding_balance` as **cached, derived,
   server-recomputed** columns (never directly editable by any client), refreshed
   transactionally whenever a payment/refund posts. This satisfies both the "show it
   fast" and "never trust a hand-edited number" requirements — see §91 note in
   `DATABASE_SCHEMA.md`.
4. **Email uniqueness** — §95 flags that not every student may have a unique personal
   email (e.g., shared family email) while auth requires unique login identities. We
   resolve this by decoupling **auth identity** (Supabase Auth `users.email`, always
   unique) from **student contact email** (`students.email`, not
   database-unique, so Admin can record a shared family email while still creating a
   uniquely-authenticated portal login, typically via a distinct login email or by
   deferring portal-account creation for that student). Documented fully in
   `SECURITY_PLAN.md`.
5. **Trainer "multiple trainers per batch"** — modeled as a join table
   (`batch_trainers`) rather than a single FK, with one trainer optionally flagged
   primary, so co-taught batches are representable from day one.
6. **Receipt vs Invoice** — kept as two distinct future document types sharing a
   numbering-and-template subsystem; invoice generation itself is not built until tax
   requirements (GST invoice rules) are confirmed (`DECISIONS_NEEDED.md`).
7. **"Do not add unnecessary personal information"** — Date of birth, gender, and
   emergency contact are modeled as **nullable/optional** fields, collected only if
   the enrollment/program requires them, not mandatory on every student.

---

*See `DECISIONS_NEEDED.md` for the short list of items that need explicit business
input rather than an engineering default.*
