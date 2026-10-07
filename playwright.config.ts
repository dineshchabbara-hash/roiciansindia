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
    // V8's default --max-old-space-size is sized from the HOST's own
    // detected physical memory, not a fixed number — this repo sets no
    // NODE_OPTIONS/heap-size anywhere else (verified), so a build that
    // completes fine on a high-memory machine can still legitimately hit
    // "Allocation failed - JavaScript heap out of memory" on a more
    // memory-constrained Windows machine, purely because that machine's
    // own auto-sized default heap is smaller, combined with Next's own
    // multiple concurrent build-worker processes each needing their own
    // share of it. Phase 17 (Certificates) is the first phase to add a
    // genuinely large dependency subtree (@react-pdf/renderer and its own
    // ~10 sub-packages, fontkit, yoga-layout) for Turbopack to bundle,
    // which raises the real, legitimate peak memory the build needs.
    // Raising the ceiling here — passed only to this Playwright-spawned
    // webServer process via Playwright's own cross-platform `env` option
    // (works identically under cmd.exe/PowerShell/bash, no shell-specific
    // VAR=value syntax) — is Next.js's own documented remedy for this
    // exact V8 fatal error. This intentionally does NOT touch package.json's
    // "build"/"start" scripts, so a real deployment host (Vercel or any
    // other platform actually running `npm run build`/`npm run start` in
    // production) is completely unaffected; only the local Playwright
    // acceptance run gets the larger heap.
    env: { NODE_OPTIONS: "--max-old-space-size=4096" },
  },
});
