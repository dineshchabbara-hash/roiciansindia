// Playwright's `webServer.command` entry point (playwright.config.ts) — NOT
// used by any real deployment; `npm run build`/`npm run start` stay exactly
// as Vercel or any other host invokes them. This script exists only to make
// the LOCAL acceptance-test server start reliably and quickly across many
// separate `npx playwright test -g "<one test>"` invocations in the same
// sitting (the documented acceptance protocol), which the previous plain
// `npm run build && npm run start` command could not do safely:
//
//   1. Build only when no current build output already exists for the
//      CURRENT Git commit (see "build provenance" below) — Playwright owns
//      the lifecycle of the process it spawns (it kills this script's whole
//      process tree when a test run ends), so every separate `-g`
//      invocation previously re-ran the FULL production build from nothing,
//      even though nothing in the source had changed between one test and
//      the next in the same acceptance sitting. That is real, unnecessary,
//      repeated heavy work, not a safety net.
//
//   2. Build with webpack, not Turbopack, for this one local entry point.
//      The concrete Windows failure this fixes: "[WebServer] memory
//      allocation of 3483212560 bytes failed" immediately followed by
//      "skipping backtrace printing to avoid potential recursion" — that
//      second line is characteristic Rust-panic-on-allocation-failure
//      output, not a Node/V8 error (V8's own OOM fatal error prints
//      "FATAL ERROR: ... Allocation failed - JavaScript heap out of
//      memory", a different, already-seen message this project already
//      has a fix for). Turbopack (Next 16's default bundler, confirmed by
//      every build's own "▲ Next.js 16.3.4 (Turbopack)" banner) is
//      implemented in Rust and manages its own native memory entirely
//      independently of Node's heap — so NODE_OPTIONS=--max-old-space-size
//      (playwright.config.ts's own `webServer.env`) cannot influence it at
//      all; it was never the wrong fix for the problem it targeted (real
//      V8 OOM, from an earlier Windows run), but it is simply irrelevant to
//      THIS crash. `next build --webpack` (a first-class, officially
//      supported Next.js CLI flag — `next build --help`) uses the older,
//      mature, pure-Node/V8 bundler instead, for which NODE_OPTIONS's heap
//      ceiling genuinely governs 100% of the build's own memory use, and
//      which has no separate native allocator of its own to fail
//      independently of Node. This changes which BUILD TOOL compiles the
//      app for this one local test entry point only — package.json's own
//      "build" script (what a real deployment host runs) still defaults to
//      Turbopack, Next's own recommended default, untouched. The compiled
//      production output's actual runtime behavior is identical either way
//      (both are standards-compliant Next.js production builds); no
//      application code, business rule, or feature is affected.
//
// --- Build provenance (corrects this script's own earlier design) -------
//
// This script previously reused ANY existing `.next/BUILD_ID` unconditionally,
// on the stated assumption that "a genuinely fresh build after pulling new
// code is one `rm -rf .next` away" — i.e. that staleness was the caller's
// problem to avoid, not this script's to detect. That assumption was wrong
// in practice: a Windows acceptance run on commit 05cfa5d showed none of
// that commit's own temporary `[cert-diag]` diagnostic log lines, even
// though PHASE17_CERT_DIAG=1 was correctly wired into webServer.env — the
// one explanation consistent with "code demonstrably in the committed
// source never produces its own logging at runtime" is that `.next/BUILD_ID`
// was left over from a build done at an OLDER commit (e.g. from testing
// before this session's commits landed), and `git pull`/`checkout` to a
// newer commit does not touch `.next` at all, so the marker this script
// checked kept reporting "already built" for a build that was no longer
// current. This can only be ruled out, not assumed, by tying build reuse
// to the exact source revision instead of merely "a build exists":
//
//   - `.next/BUILD_ID` must exist (Next's own "a complete build finished"
//     marker — still required; rules out a half-written build from an
//     interrupted previous attempt).
//   - `.next/BUILD_HEAD` (this script's own marker, written only after a
//     build completes successfully) must also exist and must equal the
//     current `git rev-parse HEAD`.
//
// Both together mean: a build is reused only when it is both complete AND
// provably built from the exact commit currently checked out. Any mismatch
// (marker missing, BUILD_ID missing, or HEAD differs) forces exactly one
// fresh build before serving. The acceptance workflow runs against a clean
// working tree (per the documented protocol), so HEAD alone is a sufficient
// build identity — no need to additionally hash package.json/lockfile/config,
// since those are only ever reached via a commit anyway and a clean tree
// means HEAD already captures them.
//
// Together with (2) above, this means: the first `-g` invocation after
// checking out a given commit does one full (webpack) build, exactly once;
// every subsequent individual `-g` invocation against that SAME commit just
// runs `next start` against the already-built output — materially lighter
// than a full bundler pass. Checking out a different commit (including
// `git pull` to a newer one) forces exactly one rebuild on the next
// invocation, never a silent stale reuse.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { needsRebuild } from "./e2e-webserver-provenance.mjs";

const BUILD_MARKER = ".next/BUILD_ID";
const HEAD_MARKER = ".next/BUILD_HEAD";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function currentGitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout?.trim()) {
    throw new Error(
      "Could not determine the current Git HEAD commit (git rev-parse HEAD failed) " +
        "— refusing to guess whether an existing .next build is current.",
    );
  }
  return result.stdout.trim();
}

function storedBuildHead() {
  if (!existsSync(HEAD_MARKER)) return null;
  try {
    return readFileSync(HEAD_MARKER, "utf8").trim();
  } catch {
    return null;
  }
}

const head = currentGitHead();

if (
  needsRebuild({
    buildIdExists: existsSync(BUILD_MARKER),
    storedHead: storedBuildHead(),
    currentHead: head,
  })
) {
  // Clears out any stale or half-written build — either an interrupted
  // previous attempt, or (the bug this corrects) a complete build left
  // over from a different, now-superseded commit.
  rmSync(".next", { recursive: true, force: true });
  const buildStatus = run("npm", ["run", "build", "--", "--webpack"]);
  if (buildStatus !== 0) process.exit(buildStatus);
  // Only recorded once the build actually succeeded — a failed build
  // leaves no marker, so the next invocation correctly retries rather than
  // trusting a build that never completed.
  writeFileSync(HEAD_MARKER, head);
}

process.exit(run("npm", ["run", "start"]));
