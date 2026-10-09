import { readFile } from "node:fs/promises";
import { test, expect, type Download, type Locator, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  cleanupPhase19,
  createPhase19Enrollment,
  createPhase19Identity,
  createPhase19Payment,
  createPhase19Refund,
  createPhase19Student,
  findExistingProgramWithBatch,
  newPhase19Tracked,
  Phase19PartialIdentityError,
  phase19Marker,
  type ExistingProgramWithBatch,
  type Phase19Enrollment,
  type Phase19Identity,
  type Phase19Role,
  type Phase19Student,
  type Phase19Tracked,
} from "./support/phase19-fixtures";

/**
 * Phase 19 (Reports & Analytics) acceptance suite, run against the real dev
 * Supabase project through the running app. Three independent describe
 * blocks; each owns its own synthetic rows (no shared state, no ordering
 * dependency), so each test can run on its own with `-g`.
 *
 *   1. Admin filters the Student and Enrollment reports and the CSV export
 *      contains exactly the rows/cells the screen shows; the Admin also
 *      opens the FR-120 Trainer report, filters it to a synthetic Trainer,
 *      and its export matches the screen too.
 *   2. The Financial report reconciles with the Phase 14 engine: report row,
 *      filtered totals, CSV and the Enrollment page's Financial Position
 *      all agree; pending payments and non-processed refunds are excluded.
 *   3. Trainer, Student and anonymous requests are denied the Reports area
 *      and every export.
 *
 * Every report/export assertion goes through a real signed-in browser
 * session; the service role only creates and removes this suite's own
 * synthetic rows (e2e/support/phase19-fixtures.ts). Assertions wait on
 * durable, server-rendered state (the row-count text, table cells, the
 * downloaded file) — never a sleep.
 */

test.describe.configure({ mode: "serial" });

test.skip(
  !hasRealSupabaseCredentials(),
  "Phase 19 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY). " +
    "Skipped, not failed, without a live dev project.",
);

// ---------------------------------------------------------------------------
// Shared helpers.

async function login(page: Page, identity: Phase19Identity) {
  await page.goto(`/login/${identity.role}`);
  await page.locator("#email").fill(identity.email);
  await page.locator("#password").fill(identity.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Login is complete on authentication evidence alone — never on the
  // dashboard's streamed sections finishing (they are optional content and
  // may still be loading): the role's protected home URL, the role's portal
  // navigation (rendered only by that role's server-side role-gated layout),
  // and the Supabase session cookie the server set. Never display text such
  // as a greeting.
  if (identity.role === "admin") {
    await expect(page).toHaveURL(/\/admin$/);
    await expect(
      page.getByRole("heading", { name: "Dashboard", level: 1 }),
    ).toBeVisible();
    await expect(adminNav(page)).toBeVisible();
  } else {
    await expect(page).toHaveURL(new RegExp(`/${identity.role}$`));
    // The Trainer/Student home has no streaming boundary, so its shell
    // arrives only once all of its data has loaded — measured 3.6–4.7s after
    // sign-in on the Windows + remote dev setup, at the edge of the default
    // 5s window. This one check gets an approved 15s ceiling; it returns as
    // soon as the navigation renders.
    await expect(portalNav(page, identity.role)).toBeVisible({ timeout: 15_000 });
  }
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames.some((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name))).toBe(true);
}

function portalNav(page: Page, role: "trainer" | "student"): Locator {
  return page.getByRole("navigation", {
    name: role === "trainer" ? "Trainer navigation" : "Student navigation",
  });
}

function adminNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Admin navigation" });
}

/**
 * Opens the Reports area the way an Admin does: the "Reports" entry in the
 * Admin navigation. This is a client-side navigation, so the page stays
 * alive and the sign-in response (which streams the dashboard's Suspense
 * sections) finishes in the background instead of being torn down
 * mid-render — a full page.goto() here would abort it and the server would
 * log "The destination stream closed early."
 */
async function openReportsFromAdminNav(page: Page) {
  await adminNav(page).getByRole("link", { name: "Reports", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
}

async function createIdentity(
  tracked: Phase19Tracked,
  role: Phase19Role,
  tag: string,
): Promise<Phase19Identity> {
  try {
    const identity = await createPhase19Identity(role, tag);
    tracked.identities.push(identity);
    return identity;
  } catch (err) {
    if (err instanceof Phase19PartialIdentityError) tracked.identities.push(err.partial);
    throw err;
  }
}

async function cleanup(tracked: Phase19Tracked) {
  const failures = await cleanupPhase19(tracked);
  expect(
    failures,
    failures.length > 0
      ? "One or more synthetic Phase 19 records failed to clean up. Verify by exact id " +
          `only; never broaden deletion:\n${failures.join("\n")}`
      : undefined,
  ).toEqual([]);
}

async function requireProgramWithBatch(): Promise<ExistingProgramWithBatch> {
  const found = await findExistingProgramWithBatch();
  if (!found) throw new Error("No existing Batch was found on the dev project.");
  return found;
}

/** Applies the report filter form (search + optional selects) via the real UI. */
async function applyFilters(
  page: Page,
  input: { search?: string; selects?: Record<string, string> },
) {
  const form = page.getByRole("form", { name: /filters$/ });
  if (input.search !== undefined) await form.getByLabel("Search").fill(input.search);
  for (const [label, option] of Object.entries(input.selects ?? {})) {
    await form.getByLabel(label, { exact: true }).selectOption({ label: option });
  }
  await form.getByRole("button", { name: "Apply filters" }).click();
}

function reportTable(page: Page, title: string): Locator {
  return page.getByRole("table", { name: title });
}

async function tableBodyCells(table: Locator): Promise<string[][]> {
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  const out: string[][] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(await rows.nth(i).locator("td").allTextContents());
  }
  return out;
}

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF records). */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += 1;
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) throw new Error("CSV did not end with CRLF");
  return records;
}

/** Clicks Export CSV, waits for the real download, returns its parsed rows. */
async function exportCsv(page: Page, kind: string): Promise<string[][]> {
  const [download]: [Download, void] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^${kind}-report-\\d{4}-\\d{2}-\\d{2}\\.csv$`),
  );
  const path = await download.path();
  const bytes = await readFile(path);
  // UTF-8 BOM, then the CSV.
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return parseCsv(bytes.subarray(3).toString("utf-8"));
}

/** The table shows "—" for an empty cell; the CSV writes it as empty. */
function asCsvCells(rows: string[][]): string[][] {
  return rows.map((row) => row.map((cell) => (cell === "—" ? "" : cell)));
}

// ---------------------------------------------------------------------------
// 1. Student + Enrollment reports: filter, then export the same data.

test.describe("Admin — Student and Enrollment reports filter and export", () => {
  const tracked = newPhase19Tracked();
  const marker = phase19Marker("Filter");
  let admin: Phase19Identity;
  let programBatch: ExistingProgramWithBatch;
  let alpha: Phase19Student;
  let beta: Phase19Student;
  let alphaEnrollment: Phase19Enrollment;
  let reportTrainer: Phase19Identity;

  test.beforeAll(async () => {
    admin = await createIdentity(tracked, "admin", "ReportsAdminA");
    // A synthetic Trainer row for the Trainer report (never logs in here).
    reportTrainer = await createIdentity(tracked, "trainer", "ReportsTrainerRow");
    programBatch = await requireProgramWithBatch();
    alpha = await createPhase19Student(tracked, {
      marker,
      lastName: "Alpha",
      status: "active",
    });
    beta = await createPhase19Student(tracked, {
      marker,
      lastName: "Beta",
      status: "inactive",
    });
    alphaEnrollment = await createPhase19Enrollment(tracked, {
      studentId: alpha.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "1000.00",
      status: "active",
    });
    await createPhase19Enrollment(tracked, {
      studentId: beta.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "2000.00",
      status: "cancelled",
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("Admin filters the Student and Enrollment reports and exports the same data", async ({
    page,
  }) => {
    // Scoped to this test only (approved): its valid workload — sign-in,
    // three reports, three filtered views and four CSV downloads — measured
    // ~40s against the remote dev project (dev API logs: ~30.3s used before
    // the Trainer section, which adds ~9s). Not a hang workaround; every
    // assertion is unchanged.
    test.setTimeout(90_000);
    await login(page, admin);

    await openReportsFromAdminNav(page);
    await page.getByRole("link", { name: "Student report" }).click();
    await expect(page).toHaveURL(/\/admin\/reports\/students$/);
    await expect(
      page.getByRole("heading", { name: "Student report", level: 1 }),
    ).toBeVisible();

    // Filter: this run's marker + Active -> exactly Alpha.
    await applyFilters(page, {
      search: marker,
      selects: { Status: "Active" },
    });
    await expect(page).toHaveURL(/status=active/);
    await expect(page.getByText("Showing 1–1 of 1 row.")).toBeVisible();
    const studentTable = reportTable(page, "Student report");
    const activeRows = await tableBodyCells(studentTable);
    expect(activeRows).toEqual([
      [
        alpha.studentCode,
        marker,
        "Alpha",
        alpha.email,
        alpha.phone,
        "Active",
        alpha.registrationDate,
        "1",
      ],
    ]);

    const activeCsv = await exportCsv(page, "students");
    expect(activeCsv[0]).toEqual([
      "Student code",
      "First name",
      "Last name",
      "Email",
      "Phone",
      "Status",
      "Registration date",
      "Enrollments",
    ]);
    expect(activeCsv.slice(1)).toEqual(asCsvCells(activeRows));

    // Widen to all statuses -> both students, same order on screen and in CSV.
    await applyFilters(page, { selects: { Status: "All statuses" } });
    await expect(page.getByText("Showing 1–2 of 2 rows.")).toBeVisible();
    const allRows = await tableBodyCells(studentTable);
    expect(allRows.map((r) => r[0]).sort()).toEqual(
      [alpha.studentCode, beta.studentCode].sort(),
    );
    const allCsv = await exportCsv(page, "students");
    expect(allCsv.slice(1)).toEqual(asCsvCells(allRows));

    // Enrollment report: marker + Active -> only Alpha's enrollment.
    await page.getByRole("link", { name: "← All reports" }).click();
    await page.getByRole("link", { name: "Enrollment report" }).click();
    await expect(
      page.getByRole("heading", { name: "Enrollment report", level: 1 }),
    ).toBeVisible();
    await applyFilters(page, {
      search: marker,
      selects: { Status: "Active" },
    });
    await expect(page.getByText("Showing 1–1 of 1 row.")).toBeVisible();
    const enrollmentRows = await tableBodyCells(reportTable(page, "Enrollment report"));
    expect(enrollmentRows).toEqual([
      [
        alphaEnrollment.enrollmentCode,
        alphaEnrollment.enrollmentDate,
        "Active",
        alpha.studentCode,
        `${marker} Alpha`,
        programBatch.programName,
        programBatch.batchName,
      ],
    ]);
    const enrollmentCsv = await exportCsv(page, "enrollments");
    expect(enrollmentCsv.slice(1)).toEqual(asCsvCells(enrollmentRows));

    // Trainer report (FR-120): the email's run-unique local part (no `.` or
    // `@`, so the search term is plain text) + Active -> exactly the
    // synthetic Trainer (no phone, no specialization, no batch assignment).
    await page.getByRole("link", { name: "← All reports" }).click();
    await page.getByRole("link", { name: "Trainer report" }).click();
    await expect(page).toHaveURL(/\/admin\/reports\/trainers$/);
    await expect(
      page.getByRole("heading", { name: "Trainer report", level: 1 }),
    ).toBeVisible();
    const trainerSearch = reportTrainer.email.split("@")[0];
    await applyFilters(page, { search: trainerSearch, selects: { Status: "Active" } });
    // Wait for the filtered page itself (the unfiltered list could also
    // show a single row if dev holds exactly one trainer).
    await expect(page).toHaveURL(new RegExp(`[?&]q=${trainerSearch}(&|$)`));
    await expect(page).toHaveURL(/[?&]status=active(&|$)/);
    await expect(page.getByText("Showing 1–1 of 1 row.")).toBeVisible();
    const trainerRows = await tableBodyCells(reportTable(page, "Trainer report"));
    expect(trainerRows).toHaveLength(1);
    const [trainerRow] = trainerRows;
    expect(trainerRow.slice(0, 6)).toEqual([
      reportTrainer.firstName,
      reportTrainer.lastName,
      reportTrainer.email,
      "—",
      "Active",
      "—",
    ]);
    expect(trainerRow[6]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(trainerRow[7]).toBe("0");
    const trainerCsv = await exportCsv(page, "trainers");
    expect(trainerCsv[0]).toEqual([
      "First name",
      "Last name",
      "Email",
      "Phone",
      "Status",
      "Specialization",
      "Date added",
      "Assigned batches",
    ]);
    expect(trainerCsv.slice(1)).toEqual(asCsvCells(trainerRows));
  });
});

// ---------------------------------------------------------------------------
// 2. Financial report reconciles with the Phase 14 engine.

test.describe("Admin — Financial report reconciles", () => {
  const tracked = newPhase19Tracked();
  const marker = phase19Marker("Finance");
  let admin: Phase19Identity;
  let enrollment: Phase19Enrollment;

  test.beforeAll(async () => {
    admin = await createIdentity(tracked, "admin", "ReportsAdminF");
    const programBatch = await requireProgramWithBatch();
    const gamma = await createPhase19Student(tracked, {
      marker,
      lastName: "Gamma",
      status: "active",
    });
    enrollment = await createPhase19Enrollment(tracked, {
      studentId: gamma.id,
      programId: programBatch.programId,
      batchId: programBatch.batchId,
      totalPayable: "50000.00",
      status: "active",
    });
    const paidOne = await createPhase19Payment(tracked, {
      enrollmentId: enrollment.id,
      studentId: gamma.id,
      totalAmount: "20000.00",
      status: "paid",
    });
    const paidTwo = await createPhase19Payment(tracked, {
      enrollmentId: enrollment.id,
      studentId: gamma.id,
      totalAmount: "5000.00",
      status: "paid",
    });
    // Must NOT count: a pending payment and a not-yet-processed refund.
    await createPhase19Payment(tracked, {
      enrollmentId: enrollment.id,
      studentId: gamma.id,
      totalAmount: "7000.00",
      status: "pending",
    });
    await createPhase19Refund(tracked, {
      paymentId: paidOne,
      amount: "1000.00",
      status: "processed",
    });
    await createPhase19Refund(tracked, {
      paymentId: paidTwo,
      amount: "300.00",
      status: "initiated",
    });
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  test("Financial report row, totals, CSV and enrollment page all agree", async ({
    page,
  }) => {
    await login(page, admin);

    await openReportsFromAdminNav(page);
    await page.getByRole("link", { name: "Financial report" }).click();
    await expect(page).toHaveURL(/\/admin\/reports\/financial$/);
    await expect(
      page.getByRole("heading", { name: "Financial report", level: 1 }),
    ).toBeVisible();
    await applyFilters(page, { search: marker });
    await expect(page.getByText("Showing 1–1 of 1 row.")).toBeVisible();

    // payable 50000; paid 20000 + 5000 (pending 7000 excluded); refunded
    // 1000 (initiated 300 excluded); outstanding 50000 - 25000 + 1000.
    const [row] = await tableBodyCells(reportTable(page, "Financial report"));
    expect(row[0]).toBe(enrollment.enrollmentCode);
    expect(row[2]).toBe("Active");
    expect(row.slice(7)).toEqual(["₹50,000.00", "₹25,000.00", "₹1,000.00", "₹26,000.00"]);

    const totals = page.getByRole("region", { name: /^Totals for Confirmed/ });
    await expect(totals.getByRole("definition")).toHaveText([
      "1",
      "₹50,000.00",
      "₹25,000.00",
      "₹1,000.00",
      "₹26,000.00",
    ]);

    const csv = await exportCsv(page, "financial");
    expect(csv).toHaveLength(2);
    expect(csv[0].slice(7)).toEqual([
      "Total payable",
      "Total paid",
      "Total refunded",
      "Outstanding",
    ]);
    expect(csv[1][0]).toBe(enrollment.enrollmentCode);
    expect(csv[1].slice(7)).toEqual(["50000.00", "25000.00", "1000.00", "26000.00"]);

    // Group filter: an Active enrollment is not in the Pipeline group.
    await applyFilters(page, {
      selects: { "Enrollment group": "Pipeline (Lead, Applicant)" },
    });
    await expect(
      page.getByText("0 rows match these filters.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No rows match these filters.", { exact: true }),
    ).toBeVisible();

    // The Enrollment page's Financial Position (getEnrollmentFinancialSummary)
    // shows the same four figures (whole-rupee display there).
    await page.goto(`/admin/enrollments/${enrollment.id}`);
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByText("Financial Position", { exact: true }) });
    const figure = (label: string) =>
      card.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
    await expect(figure("Total payable")).toHaveText("₹50,000");
    await expect(figure("Total paid")).toHaveText("₹25,000");
    await expect(figure("Total refunded")).toHaveText("₹1,000");
    await expect(figure("Outstanding")).toHaveText("₹26,000");
  });
});

// ---------------------------------------------------------------------------
// 3. Trainer, Student and anonymous requests are denied.

test.describe("Reports access is denied to non-Admin roles", () => {
  const tracked = newPhase19Tracked();
  let trainer: Phase19Identity;
  let student: Phase19Identity;

  test.beforeAll(async () => {
    trainer = await createIdentity(tracked, "trainer", "ReportsTrainer");
    student = await createIdentity(tracked, "student", "ReportsStudent");
  });

  test.afterAll(async () => {
    await cleanup(tracked);
  });

  // Every Admin report, by URL slug and its exact page title (FR-120).
  const REPORT_PAGES = [
    { slug: "students", title: "Student report" },
    { slug: "enrollments", title: "Enrollment report" },
    { slug: "attendance", title: "Attendance report" },
    { slug: "financial", title: "Financial report" },
    { slug: "certificates", title: "Certificate report" },
    { slug: "trainers", title: "Trainer report" },
  ] as const;
  const titles = REPORT_PAGES.map((r) => r.title).join("|");

  /**
   * None of the Admin Reports UI is on the page, matched by its exact
   * identities — never a generic "report" word search, since a legitimate
   * destination can contain it (the portal home greets the user by first
   * name, and these synthetic users are named Phase19E2EReports…).
   */
  async function expectNoAdminReportsUi(page: Page) {
    await expect(
      page.getByRole("heading", { level: 1, name: new RegExp(`^(Reports|${titles})$`) }),
    ).toHaveCount(0);
    await expect(adminNav(page)).toHaveCount(0);
    await expect(page.getByRole("form", { name: / report filters$/ })).toHaveCount(0);
    await expect(
      page.getByRole("table", { name: new RegExp(`^(${titles})$`) }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveCount(0);
  }

  async function expectDenied(page: Page, homePath: string, exportStatus: number) {
    // A real browser visit to the Reports area ends on the role's own
    // destination, with no Admin Reports UI rendered.
    await page.goto("/admin/reports");
    await expect(page).toHaveURL(new RegExp(`${homePath.replace(/\//g, "\\/")}$`));
    // A signed-in Trainer/Student lands on their own real portal (its role
    // navigation is rendered; page.goto has already waited for the load).
    if (homePath === "/trainer" || homePath === "/student") {
      await expect(
        portalNav(page, homePath === "/trainer" ? "trainer" : "student"),
      ).toBeVisible();
    }
    await expectNoAdminReportsUi(page);

    // The overview and every individual report page are refused by the
    // server before rendering: 307 to the same destination, and the
    // response carries no report content.
    await Promise.all(
      ["/admin/reports", ...REPORT_PAGES.map((r) => `/admin/reports/${r.slug}`)].map(
        async (path) => {
          const response = await page.request.get(path, { maxRedirects: 0 });
          expect(response.status(), path).toBe(307);
          expect(
            new URL(response.headers()["location"] ?? "", page.url()).pathname,
            path,
          ).toBe(homePath);
          const body = await response.text();
          for (const marker of [...REPORT_PAGES.map((r) => r.title), "Export CSV"]) {
            expect(body, `${path} must not contain "${marker}"`).not.toContain(marker);
          }
        },
      ),
    );

    // Every report's CSV export is refused with no file.
    await Promise.all(
      REPORT_PAGES.map(async ({ slug }) => {
        const path = `/api/exports/${slug}${slug === "financial" ? "?group=all" : ""}`;
        const response = await page.request.get(path, { maxRedirects: 0 });
        expect(response.status(), path).toBe(exportStatus);
        expect(response.headers()["content-type"], path).toMatch(/^text\/plain/);
        expect(response.headers()["content-disposition"], path).toBeUndefined();
      }),
    );
  }

  test("Trainer, Student and anonymous users cannot open Reports or export", async ({
    page,
  }) => {
    // Scoped to this test only (approved): two real non-Admin logins whose
    // home pages each take ~4–5s to render on the Windows + remote dev
    // setup, plus per-role denial checks, measured/estimated at ~28–32s.
    test.setTimeout(60_000);
    await login(page, trainer);
    await expectDenied(page, "/trainer", 403);

    await page.context().clearCookies();
    await login(page, student);
    await expectDenied(page, "/student", 403);

    await page.context().clearCookies();
    await expectDenied(page, "/login/admin", 401);
  });
});
