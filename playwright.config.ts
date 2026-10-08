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
    // See scripts/e2e-webserver.mjs for the full architecture and the
    // evidence behind it (summary: build at most once per acceptance
    // sitting, via webpack rather than Turbopack, specifically for this
    // local test entry point — package.json's own "build"/"start" scripts,
    // what a real deployment host runs, are untouched). This superseded an
    // earlier attempt that instead deleted `.next` and ran a full Turbopack
    // rebuild before EVERY individual `-g` invocation: that was reasonable
    // given the evidence at the time (a build that crashed once, then
    // succeeded, read as possible stale-cache corruption), but further
    // Windows runs showed the repeated full rebuilds were themselves the
    // dominant cost, next surfacing as a direct native allocation failure
    // ("memory allocation of 3483212560 bytes failed") — this is corrected
    // here, not layered on top of.
    command: "node scripts/e2e-webserver.mjs",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // NODE_OPTIONS now genuinely governs the whole build's memory, because
    // scripts/e2e-webserver.mjs builds with webpack (a pure Node/V8
    // process) rather than Turbopack (a separate native Rust binary with
    // its own allocator that NODE_OPTIONS cannot influence at all — see
    // that script's own header comment for the full reasoning). Kept at
    // the same 4096 MB this repo already validated builds successfully
    // under, not raised speculatively.
    env: { NODE_OPTIONS: "--max-old-space-size=4096" },
  },
});
