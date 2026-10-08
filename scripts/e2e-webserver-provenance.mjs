// Pure decision logic for scripts/e2e-webserver.mjs's build-reuse check,
// split out so it can be unit-tested without actually touching the
// filesystem or spawning git/npm. See that script's own header comment for
// the full incident this fixes (a stale `.next` build silently reused
// across a `git pull` to a newer commit, with no diagnostic evidence that
// commit's own code was ever running).
export function needsRebuild({ buildIdExists, storedHead, currentHead }) {
  if (!buildIdExists) return true;
  if (storedHead === null) return true;
  return storedHead !== currentHead;
}
