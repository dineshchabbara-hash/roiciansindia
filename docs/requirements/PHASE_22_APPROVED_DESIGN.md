# Phase 22 — Roicians India Public Website: Approved Design

**Status:** Approved design. The **new Phase 22 capabilities** described here —
the public website, Website Management, the published-data contract,
hostname routing, the enquiry interfaces and the controlled Program deletion
workflow — are **not implemented**; each exists only once the stage that
builds it (22A–22J, §15) is separately authorized, implemented, accepted and
merged. **Existing LMS functionality** this document refers to — for example
Program and Batch records with their status lifecycle (including Program
archive/restore through `status`), Company Settings, the internal
`/admin`, `/student` and `/trainer` portals and `/verify-certificate` — was
delivered in Phases 1–21C, keeps its accepted status and is reused, not
rebuilt.

**Role of this document:** the single authoritative Phase 22 decision
register. Other project documents summarize and cross-reference it; where
they differ on Phase 22, this document wins.

| Item | Value |
|---|---|
| Approved by | Project owner (business design discussions, closed 2026-10-17) |
| Baseline when recorded | `main` = `0ab29ad`; migrations 1–39 (last `20260101000039_admin_identity_settings.sql`); Phases 1–21C complete |
| Governing architecture | [`ARCHITECTURE.md` §1a](../../ARCHITECTURE.md#1a-roicians-india-and-roicians-canada--country-catalogues-decision) (country catalogues) and §1b (hostnames) |
| Roadmap | [`IMPLEMENTATION_PLAN.md`](../../IMPLEMENTATION_PLAN.md) — Phase 22, then 23 → 18b → 24 → 25 |

### Decision precedence

1. Verified, implemented and accepted functionality from Phases 1–21C is
   preserved.
2. For Phase 22, the approved decisions below supersede conflicting older
   proposals, including the earlier design report, the "Project Record &
   Phase 22 Plan" and the pre-approval text of `IMPLEMENTATION_PLAN.md`.
3. Items marked **Proposal** are technical recommendations compatible with
   the decisions; they are not business decisions and may be refined during
   implementation.
4. An approved requirement is not evidence that anything is implemented.
5. Missing business decisions and launch content are listed in §17, never
   invented.

---

## 1. Decision register

| ID | Decision | Section |
|---|---|---|
| P22-01 | Same repository; subdomain-based hostnames; internal `/admin`, `/student`, `/trainer` paths kept | §3 |
| P22-02 | Canada stays at `https://www.roicians.com`, untouched and operationally independent | §3.4 |
| P22-03 | Public brand ROICIANS TECH; supporting line "Practical technology training for the AI era"; legal name Roicians Tech Pvt. Ltd. | §4 |
| P22-04 | Structured Website Management in the Admin portal; Admin and Super Admin manage the complete ordinary public website | §5 |
| P22-05 | Super Admin only: slug change after first publication and other sensitive structural operations | §5.2 |
| P22-06 | Ten launch Programs in two editable display groups | §6 |
| P22-07 | "AI Quality Engineering: Testing LLMs, RAG & AI Agents" removed; no curriculum change to AI-Powered Software Testing & QA | §6.3 |
| P22-08 | Archive-first: Admin and Super Admin archive/restore; only Super Admin permanently deletes a verified safe, unused archived Program (revised; supersedes the earlier absolute ban) | §7 |
| P22-09 | No course pricing or LMS financial information anywhere on the public website | §8 |
| P22-10 | Public Batch privacy; registration states Open, Closed, Full | §9 |
| P22-11 | "Next Cohort: Coming Soon" + "Join Interest List" when a published Program has no published upcoming Batch | §9.3 |
| P22-12 | Visual direction: Concept A — Refined Enterprise Tech, with restrained Concept B elements | §10 |
| P22-13 | Primary CTA "Talk to an Advisor"; secondary "Explore Programs" | §10.3 |
| P22-14 | Public website scope (pages listed in §11); dynamic Program template | §11 |
| P22-15 | Online-first delivery; flexibility for future in-person/hybrid | §12 |
| P22-16 | Zoho CRM stays the CRM; Phase 22 builds enquiry interfaces only; Phase 23 integrates | §13 |
| P22-17 | Safe, server-only published-data contract; no anonymous access to LMS tables | §14 |
| P22-18 | Staged implementation 22A–22J; next migration number verified at 22A | §15 |

---

## 2. Scope boundary

**In Phase 22:** the Roicians India public website on `roicians.in`, the
Admin-portal Website Management area that edits it, the published-data
contract that feeds it, hostname routing for the four India hosts, and the
enquiry interfaces prepared for Zoho.

**Not in Phase 22:** Zoho integration (Phase 23), transactional email
(Phase 18b), production deployment, DNS, live Razorpay and production SMTP
(Phase 25), any change to the Canada website or its data, any redesign of
the existing Admin, Trainer or Student portals, any change to internal LMS
finance.

---

## 3. Domains and hostname architecture (P22-01, P22-02)

### 3.1 Approved hosts

| Host | Purpose | Internal application area (today) |
|---|---|---|
| `roicians.in` | Public India website (primary public host) | Website route group (to be built) + existing `/verify-certificate` |
| `student.roicians.in` | Student portal | Existing `/student/*`, `/login/student` |
| `trainer.roicians.in` | Trainer portal | Existing `/trainer/*`, `/login/trainer` |
| `admin.roicians.in` | Admin / Super Admin portal | Existing `/admin/*`, `/login/admin` |
| `www.roicians.com` | Existing Canada website | Outside this system |

**Proposal:** `www.roicians.in` redirects to `roicians.in`, subject to
deployment verification.

These hosts are **design targets**. No hostname routing, DNS or deployment
configuration exists yet; routing is built in **Phase 22D**, DNS and
production hosting in Phase 25.

### 3.2 Requirements

1. Same Next.js repository; no separate website or portal repositories.
2. The completed portals are not rebuilt. Internal routes `/admin`,
   `/student`, `/trainer` (and their login and auth routes) stay as they
   are; the routing layer maps each host onto its existing area.
3. Public website routes never require LMS authentication.
4. Private portals stay protected by role-based authorization (layouts,
   server actions) and database RLS, unchanged.
5. Incorrect hostname routing must never grant cross-portal access: a portal
   host serves only its own area; role checks remain the authority.
6. The public website never receives private portal session credentials.
7. Incoming `Host` values are checked against an allowlist of recognized
   hosts; unknown hosts are refused.
8. Local development and the existing automated tests keep working,
   including path-based workflows.
9. The public website can later move to its own repository by re-hosting
   the published-data contract (§14), without changing the business data
   model.

### 3.3 Technical points Phase 22D must specify (Proposal)

- **Cookies:** session cookies host-only per portal; never scoped to
  `.roicians.in`; the website host sets and reads no LMS session cookie and
  skips the Supabase session refresh.
- **Supabase callbacks and activation links:** each portal's
  `/auth/callback` and `/auth/confirm` registered as allowed redirect URLs;
  student activation and password-reset links target
  `student.roicians.in`; staff links their own host.
- **Redirects:** portal paths requested on `roicians.in` redirect to their
  subdomain; website paths requested on a portal host redirect to
  `roicians.in`; one portal's paths on another portal's host are refused.
- **Canonical URLs and SEO:** canonical URLs and the sitemap cover
  `roicians.in` only; portal hosts are not indexed.
- **Deployment configuration:** host allowlist per environment (dev,
  staging, production) via configuration; `*.localhost` plus a path-based
  fallback for local development and tests.
- **Server Actions:** origin checks verified under each host.

### 3.4 Canada boundary (P22-02)

- Country switcher: India → `https://roicians.in`; Canada →
  `https://www.roicians.com`.
- No change to the Canada website, authentication, catalogue or
  operational data.
- India and Canada are never forced into a shared student, Program, Batch
  or financial database (see `ARCHITECTURE.md` §1a).
- India and Canada Program pages are not declared as equivalents for search
  engines (no `hreflang` pairing), because the catalogues differ.

---

## 4. Public brand (P22-03)

| Element | Value |
|---|---|
| Primary public brand and logo identity | **ROICIANS TECH** |
| Supporting line | **Practical technology training for the AI era** |
| India legal name (footer, legal documents) | **Roicians Tech Pvt. Ltd.** |
| Normal copy | May use "At Roicians, we…" |
| Not used as brand or logo | "Roicians India" |

Brand and legal names continue to come from the existing Company Settings
(`company_name`, `legal_name`), whose permissions are unchanged: Super Admin
edits, Admin reads (decision D5). The logo itself is not redesigned.

---

## 5. Website Management (P22-04, P22-05)

A structured **Website Management** area inside the existing Admin portal.
"Staff" here means authorized **Admin and Super Admin** users only — never
Trainers, Students or employees in general.

### 5.1 Capabilities (Admin and Super Admin)

- Homepage content and sections
- About, Corporate Training, Institutions and Contact pages
- Program listings and Program detail content
- Batch public content and publishing
- FAQs
- Homepage banners and approved images
- Calls to action
- Navigation menus and footer
- Program grouping, featured Programs and ordering
- Approved public media and assets
- Page titles and SEO descriptions
- Social-sharing metadata
- Visibility and ordering of supported sections
- Draft editing
- Authenticated preview
- Explicit publishing and unpublishing
- Content revision history
- Safe restoration of previous content versions
- Auditing of meaningful changes

The interface uses structured forms, templates and controlled sections.
There is **no** unrestricted code/HTML editor and no complex drag-and-drop
page builder. Ordinary changes — text, Program descriptions, images, section
order, featured content within supported templates — must never need a
developer.

### 5.2 Permission boundaries

| Action | Super Admin | Admin |
|---|:---:|:---:|
| Ordinary website management (all of §5.1) | Yes | Yes |
| Change a Program slug after its first publication (audited, with redirect safeguard) | Yes | No |
| Other sensitive structural operations identified during implementation | Yes | No |
| Archive or restore a Program | Yes | Yes |
| Permanently delete a verified safe, unused **archived** Program through the controlled workflow (§7) | Yes | No |
| Delete an unarchived Program, or delete despite a protected dependency | No | No |

Website Management confers **no** new permission over private LMS finance,
authentication, role assignment, RLS policies, deployment settings or the
Super-Admin-only Company Settings. Legal and consent text is managed through
Website Management only after the underlying wording has business/legal
approval.

### 5.3 Draft, preview and publishing

1. Draft changes are never exposed publicly.
2. Authorized users preview unpublished changes (authenticated; never
   cached or indexed).
3. Publishing is an explicit action.
4. Publication timestamps are recorded.
5. Editor identity and publisher identity are recorded.
6. Change history is kept.
7. A previous version can be restored safely (restoration is itself a
   recorded change, not a silent overwrite).
8. Concurrent editors cannot silently overwrite each other (lost-update
   prevention).

### 5.4 Data foundation requirement for Phase 22A

Phase 22A designs and builds the data foundation for **complete** Website
Management — not only Program and Batch publication flags. The foundation
must accommodate:

- **Program website content:** public slug, headline/summary, structured
  public content, SEO and social metadata, publication state and
  timestamps, featured selection and order, display group, safe image
  references, draft/published revision relationships. Operational facts the
  LMS already holds (name, duration, delivery mode) are referenced, never
  duplicated.
- **Batch publication metadata:** explicit website publication state,
  approved public display label, public registration state (Open, Closed,
  Full), publication metadata — independent of the internal Batch
  lifecycle. No public capacity or enrollment calculation.
- **Display groups:** Admin-managed create, rename, reorder, hide/archive,
  restore and Program assignment; no hard-coded values or enum.
- **Pages and sections:** page identity and supported page type, sections
  with order and visibility, text and approved image references, CTA
  labels and links, FAQs, navigation and footer content, page-level SEO.
- **Revisions and concurrency:** draft and published revisions, version
  tracking, traceable restoration, lost-update prevention.
- **Audit:** who edited, who published, when; reusing the existing
  `audit_logs` architecture where appropriate; no passwords, tokens,
  secrets or unnecessary private data in audit records.
- **Public media:** minimum metadata and storage model for approved public
  assets, keeping every existing private LMS bucket protected.
- **Private by default:** every new website table is unreadable by
  anonymous users; public reads come only through the Phase 22C contract.

The concrete tables, columns, constraints and policies are designed and
reviewed in Phase 22A itself.

---

## 6. Program portfolio and display groups (P22-06, P22-07)

### 6.1 Launch portfolio (ten Programs)

**Group 1 — Career & Technology Programs**

1. AI-Powered Software Testing & QA
2. Data Analytics with AI
3. Cybersecurity & SOC Analyst
4. Cloud & DevOps Engineering
5. Applied AI & Machine Learning
6. Generative AI & LLMOps Engineering

**Group 2 — Specialist & Professional Programs**

7. Data Engineering & Cloud Platforms
8. API Integration & Automation
9. Business Analysis with AI
10. Generative AI & AI Agents for Business Professionals

### 6.2 Management rules

- These are the two **initial** display groups. Group names are editable by
  Admin and Super Admin and are never permanent database enums.
- Authorized users can add, edit, publish, unpublish, archive and restore
  Programs; change display order; select featured Programs; create, rename,
  reorder, hide or archive groups; and move Programs between groups.
- The ten Programs are never hard-coded into website components.
- No unapproved curricula, durations, dates or marketing descriptions are
  seeded. Programs are entered and maintained through the Admin portal.
- GCC is an audience for Corporate Training (for example "GenAI & LLMOps for
  GCC Teams"), not a student Program name.

### 6.3 Removed

"AI Quality Engineering: Testing LLMs, RAG & AI Agents" is not in the launch
portfolio. Its subject is **not** incorporated into AI-Powered Software
Testing & QA; no curriculum change is authorized.

---

## 7. Program archive and deletion (P22-08, revised)

**Policy:** Archive-first. Admin and Super Admin may archive and restore.
Only Super Admin may permanently delete a verified safe, unused archived
Program. Programs with training or financial history, or other protected
dependencies, remain archived.

Implementation status:

- **Existing (Phase 7 Program management), reused as is:** archiving and restoring a
  Program through its `status` (`archived` and back to an operational
  status), available to Admin and Super Admin with audit. It is not
  rebuilt.
- **Approved, not implemented:** the controlled Super Admin deletion
  workflow, the eligibility checks, the database enforcement that replaces
  the current broad delete policy, and the blocked-deletion explanations
  (§7.2–§7.5). Implementing them needs separate authorization; until then
  the enforcement gap in §7.6 remains open.

### 7.1 Rules

1. Admin and Super Admin archive a Program by setting its existing
   `status` to `archived`, and restore it to an operational status. A
   non-active Program never appears on the public website.
2. A Program must already be archived before permanent deletion can be
   considered. There is no direct deletion of an unarchived Program.
3. Only Super Admin may initiate a permanent deletion, and only for an
   archived Program the system has verified as safe and unused (§7.2).
4. Super Admin authority permits initiating a controlled deletion. It does
   not permit bypassing dependency or history protections: there is no
   "Delete anyway" override.
5. Admin has no permanent-delete permission.
6. There is no automatic deletion after a period of time and no bulk
   Program deletion in this approved scope.
7. This rule is Program-specific. It does not change the deletion rules for
   other record types (`SECURITY_PLAN.md` §15).

### 7.2 What "safe and unused" means

Archiving alone does not make a Program safe to delete. Eligibility is
decided from actual relationships and retained history, never from current
enrollment counts or a UI flag. "No active students" is not the same as
"unused". If eligibility cannot be established confidently, deletion stays
blocked and archiving remains the option.

Protected dependencies, from the current schema (migrations 1–39) — any one
of them blocks deletion (audit records are a separate case, see "Audit
records" below):

| Dependency | How it reaches a Program | Current `ON DELETE` behavior |
|---|---|---|
| Batches (any lifecycle status) | `batches.program_id` | RESTRICT (blocks) |
| Under Batches: Trainer assignments, class sessions, attendance, Batch-level materials and assignments | via `batches` | CASCADE from the Batch |
| Enrollments (including cancelled, withdrawn, completed) | `enrollments.program_id` | RESTRICT (blocks) |
| Under Enrollments: payment plans and instalments, payments, refunds, receipts, Razorpay payment orders, certificates, attendance, submissions | via `enrollments` | mostly RESTRICT; plans, attendance and submissions CASCADE |
| Certificates (including revoked or replaced) | `certificates.program_id` | RESTRICT (blocks) |
| Program modules | `program_modules.program_id` | **CASCADE (silently deleted)** |
| Program-level learning materials and their Storage files | `materials.program_id` | **CASCADE for the row; the Storage file is not removed** |
| Assignments (and their submissions) | `assignments.program_id` | **CASCADE (silently deleted)** |
| Enquiry/lead references | `leads.program_id` (table currently unused) | **SET NULL (silently detached)** |

Other operational or historical references that cannot safely survive the
deletion also block it, including references added by the Phase 22 website
tables (§7.3). This table is the analysis of the current schema; the
implementation re-verifies it against the schema at that time rather than
treating it as final.

Protected dependencies are never deleted, detached or rewritten to make a
Program pass the check. A Program known to have training or financial
history does not become "unused" because related records are hidden in an
operational screen.

**Audit records — retained, not a blocking dependency on their own.**
`audit_logs` refers to a Program by `entity_id` with no foreign key, so a
deletion leaves those rows untouched.

- Routine audit records of the Program's creation, editing, archiving and
  restoration must survive the deletion.
- The existence of those routine records alone does **not** make an
  otherwise safe, unused archived Program ineligible.
- Audit evidence of training, financial history or another protected
  relationship is still considered by the eligibility check: such evidence
  blocks deletion even where the related records are no longer visible in
  ordinary views. Unresolved eligibility stays blocked.
- Audit records are never deleted or altered to make a Program eligible.
- A successful deletion itself leaves a durable audit record (§7.4).

### 7.3 Previously published Programs and stored files

A previously published but otherwise unused Program can qualify only after
additional checks, and deletion stays blocked until each can be handled
safely:

- its old public slug and URL, and any redirects;
- website links and content references (pages, sections, menus, featured
  lists, groups);
- enquiry references, where applicable;
- public website assets it owns or shares.

This is not reduced to "never-published Programs only"; the unresolved
handling is tracked as TI-7 (§16).

Stored files: deleting a database row does not delete its Storage object.
The approved solution never silently cascade-deletes protected learning
content. Any cleanup of eligible **public website** assets must establish
ownership, protect shared assets and use an explicitly designed cleanup
process; it never touches private learning-material, assignment, receipt,
certificate or student-document storage.

### 7.4 Required deletion workflow

1. The Program is archived.
2. Super Admin requests an eligibility check.
3. The system verifies dependencies and history (§7.2–§7.3).
4. Super Admin reviews the result.
5. Super Admin enters a reason and confirms by typing the Program code.
6. The system rechecks eligibility and performs the controlled deletion.
7. A durable audit record remains.

When deletion is blocked, the explanation names the reason and the
alternative, for example: "This Program cannot be permanently deleted
because it has linked Batches and enrollments. It can remain archived, and
its historical records will be preserved."

Enforcement requirements:

- Authorization and eligibility are enforced on the server and through
  database controls; hiding a button is not enough.
- A privileged server operation independently verifies the caller's Super
  Admin authority; ordinary Admins keep no broad direct Program DELETE
  permission.
- The check and the deletion are concurrency-safe: no request can create a
  protected dependency between a successful check and the deletion.
- The audit record survives the deletion and keeps the actor, timestamp,
  Program identifier and code, reason, and the minimum necessary detail.
- No sequence is reset, no audit history is deleted, and no unnecessary
  personal data, secrets or document contents are logged.

### 7.5 Acceptance criteria (for the future implementation)

1. Admin cannot permanently delete a Program.
2. Super Admin cannot delete an unarchived Program.
3. A verified safe, unused archived Program can be deleted by Super Admin.
4. Any protected dependency blocks deletion.
5. Academic and financial history remains protected and unchanged.
6. Concurrent changes cannot bypass eligibility.
7. The audit history, including the deletion record, survives.
8. Unsafe public references or unresolved file cleanup block deletion.
9. For an otherwise eligible unused, archived Program whose only history is
   routine create, edit, archive and restore audit records, those records
   survive the deletion and do not by themselves prevent the controlled
   deletion.
10. Actual protected academic or financial history — including history
    known only from audit evidence — blocks deletion (complements 4 and 5).

### 7.6 Existing enforcement gap (not fixed)

The current database does **not** meet this policy. Migration 14 still
grants a broad `programs_delete_admin` DELETE policy to Admin and Super
Admin, and a Program delete would cascade into modules, program-level
materials and assignments, detach `leads`, and leave Storage files behind
(TI-1, §16). No application screen offers Program deletion today, but this
documentation change does not make the database behavior safe. A future,
separately authorized implementation must replace the broad deletion
behavior with the controlled workflow above, with regression tests.
Existing migrations are not edited.

### 7.7 Decision history

- 2026-10-17 (initial Phase 22 approval): archive and restore only; no
  permanent Program deletion by any role, including Super Admin.
- 2026-10-17 (owner revision, supersedes the above): archive-first;
  Super Admin may permanently delete only a verified safe, unused archived
  Program through the controlled workflow in §7.4.

## 8. Public pricing (P22-09)

**No course pricing or LMS financial information appears anywhere on the
public website.** Never published:

- Regular fee, registration fee, tax rate
- Discounts, instalment availability, EMI
- Enrollment financial values, outstanding balances, internal payment
  calculations
- Price labels or "Starting at ₹…" text
- Price-based `Offer` structured data

There is no per-Program "show fee / enquire" option. Pricing questions go
through the enquiry CTAs (§13).

This restriction applies **only to the public website.** Internal Program
fee columns, payments, receipts, refunds, financial reports and every
authorized financial function in the private portals are unchanged.

---

## 9. Public Batch information and Coming Soon (P22-10, P22-11)

### 9.1 Never public

- Capacity
- Planned cohort size
- Enrollment count
- Seats remaining
- Private meeting links
- Internal Batch names
- Internal notes
- Private location information
- Private Trainer information

### 9.2 Public registration state

**Open**, **Closed** or **Full**. "Full" is set by an Admin or Super Admin;
it is a registration state, not a published count, and no number behind it
is ever exposed.

### 9.3 Coming Soon

When a published Program has **no published upcoming Batch**, the website
shows:

> **Next Cohort: Coming Soon**
> **Join Interest List**

An unpublished Batch is never exposed to create this state, and there is no
Batch-level "Coming Soon" state at launch.

**Technical issue TI-3 (to specify before 22E/22F):** how Batches already in
progress, registration date boundaries and timezones are treated (for
example whether an `active` Batch with Open registration still counts as
"upcoming", and in which timezone "today" is evaluated), without inventing
any new public state.

---

## 10. Visual design (P22-12, P22-13)

### 10.1 Approved direction

**Concept A — Refined Enterprise Tech**, with restrained elements from
**Concept B — Tech-Forward / Digital**:

- Primarily light, professional enterprise-technology appearance
- Generous whitespace and clear typography
- Flat, lightly bordered Program cards
- Limited visual clutter
- Restrained technical diagrams
- Small monospaced metadata labels
- One dark-navy Corporate/GCC section
- Mobile-first layouts
- Subtle motion that respects reduced-motion preferences

**Avoid:** full-dark startup styling, heavy gradients or glow, excessive
animation, generic AI robots, unapproved stock photography, and unapproved
testimonials, people, logos or outcomes.

### 10.2 Suggested starting tokens

| Token | Value |
|---|---|
| Background | `#F8F8F5` |
| Ink | `#0E1A2B` |
| Accent (cobalt) | `#2347D0` |
| Optional restrained brass | `#8A6A2F` |
| Fonts | Instrument Sans, Inter, limited Geist Mono |

The direction is approved; exact graphic assets and token refinements may be
adjusted after reviewing the authorized logo files. Design tokens apply to
the public website only; the existing private portals and the Canada website
are not redesigned.

### 10.3 Calls to action

- **Talk to an Advisor** — the consistent primary conversion CTA.
- **Explore Programs** — the secondary browsing CTA.
- Context labels where relevant: Enquire About This Program, Enquire About
  This Batch, Join Interest List.

A non-production homepage mockup used during design review exists outside
the repository; it contains sample data and draft copy and is **not**
approved launch content.

---

## 11. Public website scope (P22-14)

- Home
- Programs
- Dynamic Program Detail (one template, `/programs/[slug]`)
- Upcoming Batches
- Corporate Training
- For Institutions
- About
- Contact
- Approved FAQ and legal content
- Public certificate verification (existing `/verify-certificate`, behavior
  preserved)
- Student and Trainer login entry points

Admin login is not publicly promoted. There is one dynamic Program template,
never one hard-coded source file per Program. Program content comes from
Website Management; public Batch facts from published Batch data; homepage,
menus and other content from Website Management where appropriate.

Only approved, factual claims are published. Nothing is invented: no
placement success, employer partnerships, student counts, instructor
credentials, certificates, dates or testimonials. A section with no approved
content is omitted rather than filled with placeholders.

---

## 12. Delivery (P22-15)

Launch is primarily **online training**. The design keeps flexibility for
future in-person and hybrid delivery. No physical training location is
invented and no private classroom information is exposed; public city or
campus information needs its own approved scope.

---

## 13. Enquiries and Zoho (P22-16)

**Zoho CRM remains the CRM.** Phase 22 builds the public enquiry interfaces
and a safe integration boundary; **Phase 23** implements the Zoho
integration.

Approved enquiry types:

1. Talk to an Advisor
2. Program enquiry
3. Batch enquiry
4. Join Interest List
5. Corporate Training enquiry
6. Institutional enquiry

Rules:

- No parallel LMS CRM and no new lead-management pipeline.
- The existing `leads` table and historical migrations stay as they are;
  `leads` remains unused.
- Forms have validation, spam protection and consent (consent wording needs
  legal approval, §17).
- Before Zoho integration, the site never shows a successful submission when
  nothing was delivered.
- No temporary CRM storage and no production form that silently discards
  enquiries.

---

## 14. Safe published-data contract (P22-17)

- The India LMS is the authoritative source for operational Program and
  Batch facts.
- The website consumes only expressly published, permitted fields.
- Anonymous users never get direct access to private LMS operational tables;
  no `anon` policy is added to those tables.
- The Supabase service-role key is never exposed to browser code.
- No confidential LMS value may leak through HTML, API responses, caches,
  preview pages, metadata, structured data, sitemaps or URLs.
- The contract is narrow and stable so the website could move to its own
  repository later without changing the business data model.

The historical comment in migration 14 (`programs_select_published`)
anticipating a public `anon` policy on `programs` is **superseded**: no such
policy will be added. The migration itself is immutable and is not edited.

Detailed public-read implementation belongs to **Phase 22C**.

---

## 15. Implementation stages (P22-18)

| Stage | Scope |
|---|---|
| 22A | Publication and structured Website Management data model |
| 22B | Admin Website Management, drafts, preview and publishing |
| 22C | Safe server-only published-data contract |
| 22D | Website foundation and multi-subdomain routing |
| 22E | Programs listing and Program detail pages |
| 22F | Homepage and Upcoming Batches |
| 22G | Corporate, Institutions, About and Contact |
| 22H | Enquiry interfaces prepared for Zoho |
| 22I | SEO, accessibility and performance |
| 22J | Browser acceptance and security audit |

- Migration 40 is only the expected next number, based on the migration-39
  checkpoint. The next unused number is verified when Phase 22A is
  authorized; nothing is created before then.
- Every stage preserves the accepted functionality of Phases 1–21C.
- No stage starts automatically and nothing is merged without explicit
  approval.

**Proposal (targets for 22I):** WCAG 2.2 AA; Lighthouse mobile ≥ 90;
LCP < 2.5 s; CLS < 0.1.

---

## 16. Technical issues requiring verification

| ID | Issue | Resolve in |
|---|---|---|
| TI-1 | Enforcement gap, **not fixed**: `programs_delete_admin` (migration 14) still allows Admin and Super Admin DELETE; a Program delete cascades to `program_modules`, program-level `materials` and `assignments`, sets `leads.program_id` to null and leaves Storage files behind. Conflicts with P22-08. | Separately authorized implementation (expected 22A database enforcement + 22B Super Admin workflow), with regression tests |
| TI-7 | Handling of a previously published Program's slug, redirects, website references, enquiry references and owned or shared public assets before deletion (§7.3). Until designed, such deletion stays blocked. | 22A/22B design |
| TI-2 | Migration 14 comment anticipates an `anon` policy on `programs`; superseded by §14 through documentation only. | Closed by this document |
| TI-3 | Public "upcoming" rule: in-progress Batches, registration date boundaries, timezone of "today". | Before 22E/22F |
| TI-4 | Supabase Auth redirect URLs, cookie scoping and activation-link host per subdomain. | 22D (and Phase 25 configuration) |
| TI-5 | The current middleware (`proxy.ts`) refreshes the Supabase session on every request; public website routes must skip it. | 22D |
| TI-6 | Preview and cache isolation: drafts must never reach a shared cache, sitemap or metadata. | 22B/22C |

---

## 17. Outstanding decisions and launch dependencies

| Item | Needed by |
|---|---|
| Authorized ROICIANS TECH logo files (SVG, light/dark if available) | 22D |
| Final design tokens after logo review | 22D |
| Approved content for each Program (summary, outcomes, curriculum overview, audience, prerequisites, FAQs) | 22E launch |
| Approved homepage, About, Corporate, Institutions and FAQ copy | 22F–22G launch |
| Privacy policy, terms and enquiry consent wording (including India DPDP requirements) | 22H launch |
| Approved public contact details | 22G launch |
| Approved claims, testimonials or proof points (none approved yet) | Optional sections |
| D2 — GST/tax applicability (unchanged; no tax is shown publicly regardless) | Finance, not Phase 22 |
| D6 — mandatory Program-code format (unchanged) | Not Phase 22 |
| DNS, hosting and `www.roicians.in` redirect verification | Phase 25 |
| Zoho account, credentials and field mapping | Phase 23 |

---

## 18. Cross-references

| Document | Phase 22 coverage |
|---|---|
| [`REQUIREMENTS.md`](../../REQUIREMENTS.md) | §2.14 FR-130–FR-139 summary |
| [`IMPLEMENTATION_PLAN.md`](../../IMPLEMENTATION_PLAN.md) | Roadmap and Phase 22 stages |
| [`DECISIONS_NEEDED.md`](../../DECISIONS_NEEDED.md) | D11 (Phase 22 decisions resolved) and open items |
| [`ARCHITECTURE.md`](../../ARCHITECTURE.md) | §1a country catalogues, §1b hostnames, §3 routes |
| [`DATABASE_SCHEMA.md`](../../DATABASE_SCHEMA.md) | Program/Batch notes, `leads`, planned website tables |
| [`USER_ROLES_AND_PERMISSIONS.md`](../../USER_ROLES_AND_PERMISSIONS.md) | Website Management rows in the permission matrix |
| [`SECURITY_PLAN.md`](../../SECURITY_PLAN.md) | §9f public website security |
| [`API_AND_INTEGRATIONS.md`](../../API_AND_INTEGRATIONS.md) | §8 website and Zoho rows |

Historical context only (not authoritative): the "Roicians Tech LMS —
Project Record & Phase 22 Plan" document maintained outside the repository
during the design discussions. Where it differs from this document — for
example on pricing display, deletion or launch grouping — this document
wins.
