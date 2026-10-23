import { describe, expect, it } from "vitest";
import {
  STAGING_NOINDEX,
  applyStagingHeaders,
  hasStagingCredentials,
  stagingAccess,
  stagingGateResponse,
} from "../staging-access";

const PASSWORD = "correct-horse-battery-staple";
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;

describe("stagingAccess", () => {
  it("is off when no password is set (local, tests, DEV, production)", () => {
    expect(stagingAccess({})).toEqual({ mode: "off" });
    expect(stagingAccess({ STAGING_ACCESS_PASSWORD: "" })).toEqual({ mode: "off" });
  });

  it("fails closed on a short password", () => {
    expect(stagingAccess({ STAGING_ACCESS_PASSWORD: "short" })).toEqual({
      mode: "misconfigured",
    });
  });

  it("uses the configured user, or the default", () => {
    expect(stagingAccess({ STAGING_ACCESS_PASSWORD: PASSWORD })).toEqual({
      mode: "on",
      user: "staging",
      password: PASSWORD,
    });
    expect(
      stagingAccess({
        STAGING_ACCESS_PASSWORD: PASSWORD,
        STAGING_ACCESS_USER: " owner ",
      }),
    ).toMatchObject({ user: "owner" });
  });
});

describe("stagingGateResponse", () => {
  const on = stagingAccess({ STAGING_ACCESS_PASSWORD: PASSWORD });

  it("lets every request through when off", () => {
    expect(stagingGateResponse(null, { mode: "off" })).toBeNull();
  });

  it("asks for credentials, without caching or indexing", () => {
    const res = stagingGateResponse(null, on)!;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^Basic realm=/);
    expect(res.headers.get("X-Robots-Tag")).toBe(STAGING_NOINDEX);
    expect(res.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("accepts the right credentials", () => {
    expect(stagingGateResponse(basic("staging", PASSWORD), on)).toBeNull();
  });

  it("refuses a wrong password, wrong user, or malformed header", () => {
    for (const header of [
      basic("staging", `${PASSWORD}x`),
      basic("staging", PASSWORD.slice(0, -1)),
      basic("admin", PASSWORD),
      basic("", ""),
      `Bearer ${PASSWORD}`,
      "Basic not-base64!!",
      `Basic ${Buffer.from("no-colon").toString("base64")}`,
    ]) {
      expect(stagingGateResponse(header, on)?.status).toBe(401);
    }
  });

  it("allows a colon inside the password", () => {
    const access = stagingAccess({ STAGING_ACCESS_PASSWORD: "abc:def:ghi:jkl:mno" });
    expect(
      stagingGateResponse(basic("staging", "abc:def:ghi:jkl:mno"), access),
    ).toBeNull();
  });

  it("refuses everything when misconfigured, even with matching credentials", () => {
    const res = stagingGateResponse(basic("staging", "short"), {
      mode: "misconfigured",
    })!;
    expect(res.status).toBe(503);
  });

  it("hasStagingCredentials handles non-ASCII passwords", () => {
    const access = {
      mode: "on" as const,
      user: "staging",
      password: "pässwörd-ñ-0123456",
    };
    expect(hasStagingCredentials(basic("staging", "pässwörd-ñ-0123456"), access)).toBe(
      true,
    );
  });
});

describe("applyStagingHeaders", () => {
  it("marks responses noindex only when the gate is on or misconfigured", () => {
    const off = new Headers();
    applyStagingHeaders(off, { mode: "off" });
    expect(off.get("X-Robots-Tag")).toBeNull();
    const on = new Headers();
    applyStagingHeaders(on, stagingAccess({ STAGING_ACCESS_PASSWORD: PASSWORD }));
    expect(on.get("X-Robots-Tag")).toBe(STAGING_NOINDEX);
  });
});
