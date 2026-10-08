// Playwright's `webServer.command` entry point (playwright.config.ts) — NOT
// used by any real deployment; `npm run build`/`npm run start` stay exactly
// as Vercel or any other host invokes them. This script exists only to make
// the LOCAL acceptance-test server start reliably and quickly across many
// separate `npx playwright test -g "<one test>"` invocations in the same
// sitting (the documented acceptance protocol), which the previous plain
// `npm run build && npm run start` command could not do safely:
//
//   1. Build only when no build output already exists (checked via
//      `.next/BUILD_ID`, the exact marker `next start` itself requires).
//      Playwright owns the lifecycle of the process it spawns — it kills
//      this script's whole process tree when a test run ends, so every
//      separate `-g` invocation previously re-ran the FULL production
//      build from nothing, even though nothing in the source had changed
//      between one test and the next in the same acceptance sitting. That
//      is real, unnecessary, repeated heavy work, not a safety net.
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
// Together, these mean: the first `-g` invocation in an acceptance sitting
// does one full (webpack) build, exactly once; every subsequent individual
// `-g` invocation in that same sitting just runs `next start` against the
// already-built output — materially lighter than a full bundler pass, and
// outside the class of failures a bundler invocation can hit at all.
//
// A genuinely fresh build (after pulling new code) is one `rm -rf .next` —
// or simply starting a new acceptance sitting in a freshly checked-out
// copy — away; this script deliberately does not try to detect "is the
// existing build stale relative to the current source," since the actual
// acceptance workflow is "build once per sitting, then run each individual
// test against that one stable build," not "rebuild on every invocation
// regardless of whether anything changed."

import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const BUILD_MARKER = ".next/BUILD_ID";

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (!existsSync(BUILD_MARKER)) {
  // Clears out any half-written build from an interrupted previous attempt
  // (e.g. a prior crash mid-build) before starting a real one — never
  // reached at all once a complete build already exists, since the marker
  // check above short-circuits.
  rmSync(".next", { recursive: true, force: true });
  const buildStatus = run("npm", ["run", "build", "--", "--webpack"]);
  if (buildStatus !== 0) process.exit(buildStatus);
}

process.exit(run("npm", ["run", "start"]));
