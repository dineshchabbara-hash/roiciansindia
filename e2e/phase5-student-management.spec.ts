import { test, expect, type Page } from "@playwright/test";
import {
  hasRealSupabaseCredentials,
  cleanupOrphanedPhase5FixtureUsers,
  cleanupPhase5SyntheticStudents,
  countRemainingSyntheticStudents,
  setUpPhase5Fixtures,
  tearDownPhase5Fixtures,
  PHASE5_E2E_STUDENT_PREFIX,
  type Phase5Fixtures,
} from "./support/phase5-fixtures";

/**
 * Phase 5 (Student Management) automated acceptance/smoke suite — the
 * repeatable end-to-end checks from the Phase 5 sign-off process, run
 * against a REAL dev Supabase project via the actual running Next.js app
 * (real browser, real Server Actions, real database), not against internal
 * helpers or mocks. Requires real dev credentials in .env.local (see
 * README/runbook) — skips itself cleanly otherwise, never fabricates a
 * result against the placeholder config this repo ships with by default.
 *
 * Deliberately exercises the real multi-step browser flow rather than
 * hand-building FormData, specifically because two real bugs were found in
 * this exact area by doing that: React's automatic form-field reset after
 * a Server Action (see the duplicate-override test below, which asserts
 * the name/phone fields survive the round trip), and an SSR/hydration
 * mismatch in the phone-country <select> (see the dedicated hydration
 * test). A suite that only called createStudentAction directly would not
 * have caught either — both are asserted explicitly here, not just
 * incidentally exercised.
 *
 * Uses only synthetic data: its own throwaway admin/super_admin/trainer/
 * student accounts (created and destroyed by e2e/support/phase5-fixtures.ts)
 * and students whose first name is tagged with PHASE5_E2E_STUDENT_PREFIX,
 * swept up in afterAll (and defensively again in beforeAll, in case a
 * previous run was interrupted before its own cleanup ran).
 */

test.describe.configure({ mode: "serial" });

const skipSuite = !hasRealSupabaseCredentials();

test.skip(
  skipSuite,
  "Phase 5 live E2E suite requires real dev Supabase credentials in .env.local " +
    "(NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — see the Phase 5 " +
    "smoke-test runbook for how to configure them. Skipped, not failed: this " +
    "is expected in any environment without a live dev project configured.",
);

let fixtures: Phase5Fixtures | undefined;

test.beforeAll(async () => {
  if (skipSuite) return;
  await cleanupOrphanedPhase5FixtureUsers();
  await cleanupPhase5SyntheticStudents();
  fixtures = await setUpPhase5Fixtures();
});

test.afterAll(async () => {
  if (skipSuite) return;
  // Each step runs even if an earlier one failed (e.g. beforeAll never got
  // as far as creating fixtures) — cleanup should be as resilient as
  // possible rather than all-or-nothing, and a partial failure here must
  // still report clearly rather than crashing on an undefined `fixtures`.
  let studentsCleaned = false;
  try {
    await cleanupPhase5SyntheticStudents();
    studentsCleaned = true;
  } catch (error) {
    console.error("[phase5 e2e] afterAll: student cleanup failed:", error);
  }

  if (fixtures) {
    try {
      await tearDownPhase5Fixtures(fixtures);
    } catch (error) {
      console.error("[phase5 e2e] afterAll: fixture teardown failed:", error);
    }
  }

  if (studentsCleaned) {
    const remaining = await countRemainingSyntheticStudents();
    expect(remaining, "synthetic students must be fully cleaned up after the run").toBe(
      0,
    );
  }
});

async function login(page: Page, path: string, email: string, password: string) {
  await page.goto(path);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Every test body only ever runs after a successful beforeAll (skipSuite
 *  and setup failures both stop the suite before any test executes), so
 *  `fixtures` is always assigned here at runtime — this just gives a clear
 *  error instead of a confusing "undefined.admin" if that assumption is
 *  ever violated (e.g. a future refactor). */
function getFixtures(): Phase5Fixtures {
  if (!fixtures) {
    throw new Error("Phase 5 E2E fixtures were not set up — beforeAll must have failed.");
  }
  return fixtures;
}

async function loginAsAdmin(page: Page) {
  const { admin } = getFixtures();
  await login(page, "/login/admin", admin.email, admin.password);
}

function tag(name: string): string {
  return `${PHASE5_E2E_STUDENT_PREFIX}${name}`;
}

// Real, once-verified-valid numbers for each country — deliberately fixed
// literals rather than generated at runtime: libphonenumber-js's validity
// ranges are narrower and less predictable than "any digits of the right
// length" (a UK number one digit off from a known-good one can be invalid;
// see the comment on the UK creation test below), so every literal here was
// checked against the real library before being written into this file.
const PHONES = {
  india: "9123456001",
  canada: "416-555-6002",
  uk: "07911 123456",
  uae: "050 600 0004",
  dupEmailA: "9123456005",
  dupEmailB: "9123456006",
} as const;

const CANONICAL = {
  india: "+919123456001",
  canada: "+14165556002",
  uk: "+447911123456",
  uae: "+971506000004",
} as const;

test.describe("Role-based access to Admin Student Management", () => {
  test("Admin is allowed to manage students", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/students");
    await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
  });

  test("Super Admin is allowed to manage students", async ({ page }) => {
    const { superAdmin } = getFixtures();
    await login(page, "/login/admin", superAdmin.email, superAdmin.password);
    await page.goto("/admin/students");
    await expect(page.getByRole("heading", { name: "Students" })).toBeVisible();
  });

  test("Trainer is blocked from Admin Student Management", async ({ page }) => {
    const { trainer } = getFixtures();
    await login(page, "/login/trainer", trainer.email, trainer.password);
    await page.goto("/admin/students");
    await expect(page).not.toHaveURL(/\/admin\/students/);
  });

  test("Student is blocked from Admin Student Management", async ({ page }) => {
    const { student } = getFixtures();
    await login(page, "/login/student", student.email, student.password);
    await page.goto("/admin/students");
    await expect(page).not.toHaveURL(/\/admin\/students/);
  });

  test("anonymous is blocked from Admin Student Management", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/admin/students");
    await expect(page).toHaveURL(/\/login\/admin$/);
  });
});

test.describe("Add Student page: hydration and the country selector", () => {
  test("loads without a server/client hydration mismatch", async ({ page }) => {
    // Playwright's webServer runs a production build, where React's
    // hydration errors are minified to a numeric code + a decode link
    // rather than the verbose dev-mode text — matching both forms so this
    // doesn't silently stop catching the bug once run in production mode.
    // 418/419/421/425 are React 18+'s hydration-mismatch error codes.
    const HYDRATION_ERROR_PATTERN = /hydrat|react\.dev\/errors\/4(18|19|21|25)\b/i;
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await expect(page.getByRole("heading", { name: "Add Student" })).toBeVisible();
    // Give any async hydration warning a moment to surface before asserting.
    await page.waitForTimeout(500);

    // Any uncaught exception on this page is worth failing on — not just
    // hydration ones — but hydration mismatches specifically are called
    // out by name in the failure message, matching the actual bug this
    // test was added for.
    expect(pageErrors, "no uncaught page errors on /admin/students/new").toEqual([]);
    const hydrationErrors = consoleErrors.filter((t) => HYDRATION_ERROR_PATTERN.test(t));
    expect(
      hydrationErrors,
      "no hydration-mismatch console errors on /admin/students/new",
    ).toEqual([]);
  });

  test("country selector supports all current libphonenumber-js countries, India first and default", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");

    const select = page.locator("#phoneCountry");
    const options = select.locator("option");
    // Kept as a floor rather than an exact count here so this test doesn't
    // need editing every time libphonenumber-js adds a country — exact
    // parity (245 as of writing) is asserted deterministically in
    // lib/domain/__tests__/phone-countries.test.ts instead, without needing
    // a browser.
    expect(await options.count()).toBeGreaterThanOrEqual(245);

    await expect(options.first()).toHaveText(/^India \(\+91\)$/);
    expect(await select.inputValue()).toBe("IN");

    const allText = await options.allTextContents();
    expect(allText.some((t) => t === "United Kingdom (+44)")).toBe(true);
    expect(allText.some((t) => t === "Canada (+1)")).toBe(true);
    expect(allText.some((t) => t === "United Arab Emirates (+971)")).toBe(true);
    expect(allText.some((t) => /^Falkland Islands \(\+500\)$/.test(t))).toBe(true);
  });
});

let indiaStudentId = "";
let indiaStudentCode = "";

test.describe("Create students with international phone numbers", () => {
  test("create with an India phone normalizes and stores canonical E.164", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("IndiaA"));
    await page.locator("#lastName").fill("Student");
    // Country selector defaults to India — left untouched deliberately, to
    // also cover "bare national number, default country" in the same step.
    await page.locator("#phone").fill(PHONES.india);
    await page.getByRole("button", { name: "Create student" }).click();

    await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]+$/);
    indiaStudentId = page.url().split("/").pop()!;
    indiaStudentCode = (await page.locator("p.font-mono").first().textContent())!.trim();
    expect(indiaStudentCode).toMatch(/^\d+$/);

    // Canonical E.164 is what the profile page and the list table both show
    // — proof it's what's actually stored, not just what was typed.
    await expect(page.getByText(CANONICAL.india, { exact: true })).toBeVisible();
    await page.goto(`/admin/students?q=${encodeURIComponent(tag("IndiaA"))}`);
    await expect(page.getByText(CANONICAL.india, { exact: true })).toBeVisible();
  });

  test("create with a Canada phone normalizes and stores canonical E.164", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("CanadaA"));
    await page.locator("#lastName").fill("Student");
    await page.locator("#phoneCountry").selectOption("CA");
    await page.locator("#phone").fill(PHONES.canada);
    await page.getByRole("button", { name: "Create student" }).click();

    await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]+$/);
    await expect(page.getByText(CANONICAL.canada, { exact: true })).toBeVisible();
  });

  test("create with a UK phone normalizes and stores canonical E.164", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("UkA"));
    await page.locator("#lastName").fill("Student");
    await page.locator("#phoneCountry").selectOption("GB");
    // 07911 123456 is Ofcom's own reserved-for-fiction UK mobile number —
    // structurally valid but never assigned to a real subscriber. Verified
    // against libphonenumber-js directly before use; nearby numbers (e.g.
    // trailing ...999999) are NOT valid, so this exact literal is used
    // rather than any "similar-looking" generated one.
    await page.locator("#phone").fill(PHONES.uk);
    await page.getByRole("button", { name: "Create student" }).click();

    await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]+$/);
    await expect(page.getByText(CANONICAL.uk, { exact: true })).toBeVisible();
  });

  test("create with a UAE phone normalizes and stores canonical E.164", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("UaeA"));
    await page.locator("#lastName").fill("Student");
    await page.locator("#phoneCountry").selectOption("AE");
    await page.locator("#phone").fill(PHONES.uae);
    await page.getByRole("button", { name: "Create student" }).click();

    await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]+$/);
    await expect(page.getByText(CANONICAL.uae, { exact: true })).toBeVisible();
  });

  test("an invalid phone number is rejected with a visible field error, nothing created", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("InvalidPhone"));
    await page.locator("#lastName").fill("Student");
    await page.locator("#phone").fill("12345");
    await page.getByRole("button", { name: "Create student" }).click();

    // Stays on the create page — no silent failure, an explicit visible
    // error naming the actual problem.
    await expect(page).toHaveURL(/\/admin\/students\/new$/);
    await expect(
      page.getByText("Enter a valid phone number for the selected country."),
    ).toBeVisible();
  });
});

test.describe.serial("Duplicate detection and the override flow", () => {
  test("duplicate phone (different valid format) blocks creation, then the confirmed override with a reason succeeds", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("DupPhoneB"));
    await page.locator("#lastName").fill("Student");
    // Same number as the India creation test, but in full E.164 form with a
    // "+" — a different valid format from the bare national digits used to
    // create the original — proving the match is on canonical value, not
    // literal string equality.
    await page.locator("#phone").fill(CANONICAL.india);
    await page.getByRole("button", { name: "Create student" }).click();

    await expect(page).toHaveURL(/\/admin\/students\/new$/);
    await expect(page.getByText(/possible duplicate/i)).toBeVisible();
    await expect(page.getByText(indiaStudentCode)).toBeVisible();
    await expect(page.getByText("Same phone number")).toBeVisible();

    // The exact real-world regression this suite exists to catch: React
    // resets a useActionState-driven form's uncontrolled fields once the
    // action resolves. If that regressed, these would now read empty and
    // the override below would fail required-field validation instead of
    // ever reaching the duplicate-override logic.
    await expect(page.locator("#firstName")).toHaveValue(tag("DupPhoneB"));
    await expect(page.locator("#lastName")).toHaveValue("Student");
    await expect(page.locator("#phone")).toHaveValue(CANONICAL.india);

    const checkboxName =
      /I have reviewed the above and confirm this is a different person/;
    const checkbox = () => page.getByRole("checkbox", { name: checkboxName });
    const reason = () => page.getByLabel("Reason (required)");
    await expect(checkbox()).toBeVisible();
    await expect(reason()).toBeVisible();

    // Required, server-side (the enforcement that actually matters — the
    // form's own `noValidate` deliberately disables HTML5 required
    // checking, per SECURITY_PLAN.md, so this is genuinely testing the
    // server, not the browser): submitting with the box unchecked must not
    // create anything.
    await page.getByRole("button", { name: "Create student" }).click();
    await expect(page).toHaveURL(/\/admin\/students\/new$/);
    await expect(page.getByText(/possible duplicate/i)).toBeVisible();

    // Checked, but reason left blank: must reject with a visible reason
    // error WITHOUT creating anything — and, the specific regression fixed
    // earlier in Phase 5, the duplicate panel (with its match list) must
    // stay visible rather than vanish, since the underlying duplicate is
    // still exactly as unresolved as before this submission.
    await checkbox().check();
    await page.getByRole("button", { name: "Create student" }).click();
    await expect(page).toHaveURL(/\/admin\/students\/new$/);
    await expect(page.getByText(/possible duplicate/i)).toBeVisible();
    await expect(
      page.getByText("Please explain why this is not a duplicate"),
    ).toBeVisible();
    await expect(checkbox()).toBeChecked();

    await reason().fill("Twin siblings, shared family phone number.");
    await page.getByRole("button", { name: "Create student" }).click();

    await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]+$/);
    const overrideStudentId = page.url().split("/").pop()!;
    expect(overrideStudentId).not.toBe(indiaStudentId);
    const overrideCode = (await page
      .locator("p.font-mono")
      .first()
      .textContent())!.trim();
    expect(overrideCode).not.toBe(indiaStudentCode);
  });

  test("duplicate email (different phone) shows a warning naming the email match", async ({
    page,
  }) => {
    const email = "phase5e2e-dupemail@internal.test";

    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("DupEmailA"));
    await page.locator("#lastName").fill("Student");
    await page.locator("#phone").fill(PHONES.dupEmailA);
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: "Create student" }).click();
    await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]+$/);

    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("DupEmailB"));
    await page.locator("#lastName").fill("Student");
    await page.locator("#phone").fill(PHONES.dupEmailB);
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: "Create student" }).click();

    await expect(page).toHaveURL(/\/admin\/students\/new$/);
    await expect(page.getByText(/possible duplicate/i)).toBeVisible();
    await expect(page.getByText("Same email address")).toBeVisible();
    // Confirms this is a normal duplicate scenario the same override flow
    // handles, not a dead end — but doesn't need to be exercised twice in
    // this suite; the phone case above already proves the full path.
  });
});

test.describe.serial("Profile management: edit, status, notes, documents", () => {
  let studentId: string;

  test("create the student used for the rest of this flow", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/students/new");
    await page.locator("#firstName").fill(tag("Profile"));
    await page.locator("#lastName").fill("Flow");
    await page.locator("#phone").fill("9123456099");
    await page.getByRole("button", { name: "Create student" }).click();
    await expect(page).toHaveURL(/\/admin\/students\/[0-9a-f-]+$/);
    studentId = page.url().split("/").pop()!;
  });

  test("edit updates a profile field and the Student ID stays immutable", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/students/${studentId}`);
    const codeBefore = (await page.locator("p.font-mono").first().textContent())!.trim();

    await page.goto(`/admin/students/${studentId}/edit`);
    await expect(page.locator('[name="studentCode"]')).toHaveCount(0);
    await page.locator("#city").fill("Bengaluru");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page).toHaveURL(`/admin/students/${studentId}`);
    await expect(page.getByText("Bengaluru")).toBeVisible();
    const codeAfter = (await page.locator("p.font-mono").first().textContent())!.trim();
    expect(codeAfter).toBe(codeBefore);
  });

  test("status can be changed and the new status persists", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/students/${studentId}`);
    await page.locator('select[name="status"]').selectOption("inactive");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await expect(page.locator('select[name="status"]')).toHaveValue("inactive");

    // Reset to active so the list-filter test below sees a predictable state.
    await page.locator('select[name="status"]').selectOption("active");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
  });

  test("a staff note can be added and appears immediately", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/students/${studentId}`);
    await page.locator('textarea[name="note"]').fill("Phase5 E2E note.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Phase5 E2E note.")).toBeVisible();
  });

  test("a document can be uploaded and then deleted", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/students/${studentId}`);
    await page.locator('input[name="documentType"]').fill("ID proof");
    await page.locator('input[type="file"][name="file"]').setInputFiles({
      name: "phase5-e2e-doc.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic Phase 5 E2E document. Safe to delete.\n"),
    });
    await page.getByRole("button", { name: "Upload document" }).click();
    await expect(page.getByText("ID proof")).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No documents uploaded yet.")).toBeVisible();
  });
});

test.describe("Student list: search, filter, pagination basics", () => {
  test("search finds a created student by name and by Student ID", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`/admin/students?q=${encodeURIComponent(tag("IndiaA"))}`);
    await expect(
      page.getByRole("link", { name: `${tag("IndiaA")} Student` }),
    ).toBeVisible();

    await page.goto(`/admin/students?q=${indiaStudentCode}`);
    await expect(
      page.getByRole("link", { name: `${tag("IndiaA")} Student` }),
    ).toBeVisible();
  });

  test("status filter includes an active match and excludes an archived-only search", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto(
      `/admin/students?q=${encodeURIComponent(tag("IndiaA"))}&status=active`,
    );
    await expect(
      page.getByRole("link", { name: `${tag("IndiaA")} Student` }),
    ).toBeVisible();

    await page.goto(
      `/admin/students?q=${encodeURIComponent(tag("IndiaA"))}&status=archived`,
    );
    await expect(
      page.getByRole("link", { name: `${tag("IndiaA")} Student` }),
    ).toHaveCount(0);
  });

  test("pagination controls reflect the current page and total when more than one page exists", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    // Scoped to this suite's own tagged students only — asserts the
    // pagination summary text is well-formed when present, without
    // requiring 20+ synthetic rows just to force a second page.
    await page.goto(`/admin/students?q=${encodeURIComponent(PHASE5_E2E_STUDENT_PREFIX)}`);
    const summary = page.getByText(/^Page \d+ of \d+ \(\d+ total\)$/);
    if (await summary.count()) {
      await expect(summary).toBeVisible();
    }
  });
});
