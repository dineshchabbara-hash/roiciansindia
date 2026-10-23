import { describe, expect, it } from "vitest";
import {
  STAGING_CACHE_CONTROL,
  STAGING_NOINDEX,
  applyStagingHeaders,
  hasStagingCredentials,
  skipsSessionRefresh,
  stagingAccess,
  stagingGateResponse,
} from "../staging-access";

const USER = "roicians-preview";
const PASSWORD = "correct-horse-battery-staple";
const ON = {
  STAGING_MODE: "1",
  STAGING_ACCESS_USER: USER,
  STAGING_ACCESS_PASSWORD: PASSWORD,
};
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;

describe("stagingAccess: off", () => {
  it("is off with no staging settings (local, tests, DEV, production)", () => {
    expect(stagingAccess({})).toEqual({ mode: "off" });
    expect(stagingAccess({ STAGING_MODE: "" })).toEqual({ mode: "off" });
    expect(stagingAccess({ STAGING_MODE: "0" })).toEqual({ mode: "off" });
    expect(stagingAccess({ STAGING_MODE: "false" })).toEqual({ mode: "off" });
  });
});

describe("stagingAccess: explicit staging mode fails closed", () => {
  it("is on with valid credentials", () => {
    expect(stagingAccess(ON)).toEqual({ mode: "on", user: USER, password: PASSWORD });
    expect(stagingAccess({ ...ON, STAGING_MODE: "TRUE" }).mode).toBe("on");
  });

  it.each([
    ["no credentials", { STAGING_MODE: "1" }],
    ["missing user", { STAGING_MODE: "1", STAGING_ACCESS_PASSWORD: PASSWORD }],
    ["empty user", { ...ON, STAGING_ACCESS_USER: "   " }],
    ["user with a colon", { ...ON, STAGING_ACCESS_USER: "a:b" }],
    ["user with a control character", { ...ON, STAGING_ACCESS_USER: "a\nb" }],
    ["missing password", { STAGING_MODE: "1", STAGING_ACCESS_USER: USER }],
    ["empty password", { ...ON, STAGING_ACCESS_PASSWORD: "" }],
    ["short password", { ...ON, STAGING_ACCESS_PASSWORD: "short-password" }],
    [
      "password with surrounding spaces",
      { ...ON, STAGING_ACCESS_PASSWORD: ` ${PASSWORD} ` },
    ],
    [
      "password containing the user",
      { ...ON, STAGING_ACCESS_PASSWORD: `${USER}-2026-pw` },
    ],
    [
      "password with a control character",
      { ...ON, STAGING_ACCESS_PASSWORD: `${PASSWORD}\u0000` },
    ],
    ["oversized password", { ...ON, STAGING_ACCESS_PASSWORD: "x".repeat(257) }],
    ["unrecognised mode", { ...ON, STAGING_MODE: "maybe" }],
    ["mode off but credentials set", { ...ON, STAGING_MODE: "off" }],
  ])("refuses all access: %s", (_label, env) => {
    const access = stagingAccess(env);
    expect(access.mode).toBe("misconfigured");
    const res = stagingGateResponse(basic(USER, PASSWORD), access)!;
    expect(res.status).toBe(503);
    expect(res.headers.get("X-Robots-Tag")).toBe(STAGING_NOINDEX);
  });

  it("turns on (and fails closed) when only a credential is present", () => {
    expect(stagingAccess({ STAGING_ACCESS_PASSWORD: PASSWORD }).mode).toBe(
      "misconfigured",
    );
    expect(stagingAccess({ STAGING_ACCESS_USER: USER }).mode).toBe("misconfigured");
    expect(
      stagingAccess({ STAGING_ACCESS_USER: USER, STAGING_ACCESS_PASSWORD: PASSWORD })
        .mode,
    ).toBe("on");
  });

  it("never reveals the misconfiguration reason to the visitor", async () => {
    const res = stagingGateResponse(null, stagingAccess({ STAGING_MODE: "1" }))!;
    expect(await res.text()).not.toMatch(/STAGING_|password|user/i);
  });
});

describe("stagingGateResponse with valid settings", () => {
  const on = stagingAccess(ON);

  it("lets every request through when off", () => {
    expect(stagingGateResponse(null, { mode: "off" })).toBeNull();
  });

  it("asks for credentials, without caching or indexing", () => {
    const res = stagingGateResponse(null, on)!;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Basic realm=/);
    expect(res.headers.get("X-Robots-Tag")).toBe(STAGING_NOINDEX);
    expect(res.headers.get("Cache-Control")).toBe(STAGING_CACHE_CONTROL);
  });

  it("accepts the right credentials", () => {
    expect(stagingGateResponse(basic(USER, PASSWORD), on)).toBeNull();
  });

  it("refuses a wrong password, wrong user, or malformed header", () => {
    for (const header of [
      basic(USER, `${PASSWORD}x`),
      basic(USER, PASSWORD.slice(0, -1)),
      basic("staging", PASSWORD),
      basic(USER.toUpperCase(), PASSWORD),
      basic("", ""),
      `Bearer ${PASSWORD}`,
      "Basic not-base64!!",
      "Basic ",
      `Basic ${Buffer.from("no-colon").toString("base64")}`,
    ]) {
      expect(stagingGateResponse(header, on)?.status).toBe(401);
    }
  });

  it("allows a colon inside the password", () => {
    const access = stagingAccess({
      ...ON,
      STAGING_ACCESS_PASSWORD: "abc:def:ghi:jkl:mno",
    });
    expect(stagingGateResponse(basic(USER, "abc:def:ghi:jkl:mno"), access)).toBeNull();
  });

  it("handles non-ASCII passwords", () => {
    const access = { mode: "on" as const, user: USER, password: "pässwörd-ñ-0123456" };
    expect(hasStagingCredentials(basic(USER, "pässwörd-ñ-0123456"), access)).toBe(true);
  });
});

describe("applyStagingHeaders", () => {
  it("marks responses noindex and uncacheable only in staging mode", () => {
    const off = new Headers({ "Cache-Control": "public, max-age=31536000, immutable" });
    applyStagingHeaders(off, { mode: "off" });
    expect(off.get("X-Robots-Tag")).toBeNull();
    expect(off.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const on = new Headers({ "Cache-Control": "public, max-age=31536000, immutable" });
    applyStagingHeaders(on, stagingAccess(ON));
    expect(on.get("X-Robots-Tag")).toBe(STAGING_NOINDEX);
    expect(on.get("Cache-Control")).toBe(STAGING_CACHE_CONTROL);
  });
});

describe("skipsSessionRefresh", () => {
  it("covers the paths proxy.ts used to exclude, and nothing else", () => {
    for (const p of [
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/favicon.ico",
      "/logo.svg",
      "/a/b.PNG",
    ]) {
      expect(skipsSessionRefresh(p)).toBe(true);
    }
    for (const p of [
      "/",
      "/admin",
      "/api/students/x/photo",
      "/favicon.icox",
      "/_next/imagex",
    ]) {
      expect(skipsSessionRefresh(p)).toBe(false);
    }
  });
});
