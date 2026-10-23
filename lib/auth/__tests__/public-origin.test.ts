import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "../public-origin";

describe("publicOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured public URL behind a proxy", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.in");
    expect(publicOrigin("https://localhost:3123/auth/callback?code=x")).toBe(
      "https://staging.example.in",
    );
  });

  it("uses only the origin of the configured URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.in/some/path/");
    expect(publicOrigin("http://localhost:3000/auth/confirm")).toBe(
      "https://staging.example.in",
    );
  });

  it("falls back to the request origin when nothing is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(publicOrigin("http://localhost:3000/auth/callback")).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores a value that is not an http(s) URL", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "javascript:alert(1)");
    expect(publicOrigin("http://localhost:3000/auth/callback")).toBe(
      "http://localhost:3000",
    );
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "not a url");
    expect(publicOrigin("http://localhost:3000/auth/callback")).toBe(
      "http://localhost:3000",
    );
  });
});
