import "server-only";

// TEMP-DIAGNOSTIC(phase17-cert-issue-hang): every prior Windows-acceptance
// round on this hang diagnosed the cause purely from after-the-fact remote
// DB state (an audit_logs row existing) or static code reading — never from
// an actual timestamp recorded while the hang was happening. Both of the
// last two "fixes" (test.setTimeout(90_000), then writeAuditLog's own
// withTimeout) were built on inference, and the second one is now proven
// (by the user's own re-run) not to have touched the real stall. This
// module exists to stop guessing: every await on the Issue/Revoke/Reissue
// path logs a `[cert-diag]` line with a wall-clock timestamp via
// console.error, which Playwright's webServer plugin already forwards to
// the terminal live (confirmed from node_modules/playwright/lib/plugins/
// webServerPlugin.js: stderr is piped by default — `!this._options.stderr`
// — unlike stdout, which is not; this is exactly how the earlier Turbopack
// native-allocator crash message was visible in a prior round without any
// Playwright config change). Comparing consecutive lines' timestamps on the
// next failing run pinpoints the exact await that never returns, instead of
// inferring it from which DB rows happen to exist afterward.
//
// Only active when PHASE17_CERT_DIAG=1 (set in playwright.config.ts's
// webServer.env for local acceptance runs only — never set by any real
// deploy script, so this is inert in production regardless). Delete this
// module, its call sites, and the env var once the real stalling stage is
// confirmed and has its own permanent, evidence-justified fix.
const ENABLED = process.env.PHASE17_CERT_DIAG === "1";

export function certDiag(label: string): void {
  if (!ENABLED) return;
  console.error(`[cert-diag] ${new Date().toISOString()} ${label}`);
}
