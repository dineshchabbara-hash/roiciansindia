import { describe, expect, it } from "vitest";
import { isSeedEmail, stagingTargetProblems } from "../staging/staging-guard.mjs";

const REF = "abcdefghijklmnopqrst";
const DEV = "devdevdevdevdevdevde";
const jwt = (payload: object) =>
  ["e30", Buffer.from(JSON.stringify(payload)).toString("base64url"), "sig"].join(".");

const ok = {
  target: "staging",
  url: `https://${REF}.supabase.co`,
  stagingRef: REF,
  confirmRef: REF,
  protectedRefs: `${DEV},prodprodprodprodprod`,
  serviceKey: jwt({ role: "service_role", ref: REF }),
};

describe("stagingTargetProblems", () => {
  it("passes only when every check holds", () => {
    expect(stagingTargetProblems(ok)).toEqual([]);
    expect(stagingTargetProblems({ ...ok, serviceKey: "sb_secret_abc" })).toEqual([]);
  });

  it.each([
    ["no explicit target", { target: undefined }],
    ["another target", { target: "dev" }],
    ["missing ref", { stagingRef: "" }],
    ["malformed ref", { stagingRef: "short", confirmRef: "short" }],
    ["URL of another project", { url: `https://${DEV}.supabase.co` }],
    ["http URL", { url: `http://${REF}.supabase.co` }],
    ["look-alike host", { url: `https://${REF}.supabase.co.evil.example` }],
    ["no confirmation", { confirmRef: undefined }],
    ["wrong confirmation", { confirmRef: DEV }],
    ["no protected refs", { protectedRefs: "" }],
    ["staging ref is protected", { protectedRefs: `${DEV},${REF}` }],
    ["no service key", { serviceKey: "" }],
    ["anon key", { serviceKey: jwt({ role: "anon", ref: REF }) }],
    ["key for DEV", { serviceKey: jwt({ role: "service_role", ref: DEV }) }],
  ])("refuses: %s", (_label, change) => {
    expect(stagingTargetProblems({ ...ok, ...change }).length).toBeGreaterThan(0);
  });
});

describe("isSeedEmail", () => {
  it("recognises only the seeder's own fictional accounts", () => {
    expect(isSeedEmail("admin@roicians-staging.example")).toBe(true);
    expect(isSeedEmail("Admin@Roicians-Staging.Example")).toBe(true);
    expect(isSeedEmail("admin@roicians.in")).toBe(false);
    expect(isSeedEmail("admin@roicians-staging.example.com")).toBe(false);
    expect(isSeedEmail(null)).toBe(false);
  });
});
