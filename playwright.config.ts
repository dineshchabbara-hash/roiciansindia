import { defineConfig, devices } from "@playwright/test";

// Makes .env.local visible to the Playwright test runner's own Node process
// (Next.js loads it automatically for the app itself via `npm run dev`/
// `next build`, but a separately-invoked `npx playwright test` does not) —
// needed by e2e/support/phase5-fixtures.ts, which talks to Supabase
// directly (service-role) to set up/tear down test accounts and data.
// Safe to skip silently: without a real project configured, the Phase 5
// live-data suite just reports itself skipped (see hasRealSupabaseCredentials
// in that file) rather than failing.
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local not present — fine, e.g. in CI without live credentials.
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
