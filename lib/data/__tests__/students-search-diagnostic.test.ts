import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the targeted PHASE5_E2E_DEBUG_AUTH diagnostic in
 * searchStudents()'s catch block: verifies logging is off by default and on
 * only behind the flag, that only a bounded code/message pair is written
 * (never details/hint/stack/raw error), that a JWT-shaped substring gets
 * redacted, and that the flag never changes the real, user-facing result.
 * node:fs is mocked entirely — no test here touches a real file.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("node:fs", () => {
  const appendFileSync = vi.fn();
  return { appendFileSync, default: { appendFileSync } };
});

import { appendFileSync } from "node:fs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { searchStudents } from "@/lib/data/students";

function mockFailingStudentsQuery(error: { code: string; message: string }) {
  const range = vi.fn().mockResolvedValue({ data: null, error, count: null });
  const order = vi.fn().mockReturnValue({ range });
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ from } as never);
}

describe("searchStudents diagnostic error capture", () => {
  const originalDebugFlag = process.env.PHASE5_E2E_DEBUG_AUTH;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalDebugFlag === undefined) {
      delete process.env.PHASE5_E2E_DEBUG_AUTH;
    } else {
      process.env.PHASE5_E2E_DEBUG_AUTH = originalDebugFlag;
    }
  });

  it("does not write a diagnostic file when the debug flag is unset", async () => {
    delete process.env.PHASE5_E2E_DEBUG_AUTH;
    mockFailingStudentsQuery({ code: "42501", message: "permission denied" });

    const result = await searchStudents({});

    expect(result.ok).toBe(false);
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("does not write a diagnostic file when the debug flag is explicitly disabled", async () => {
    process.env.PHASE5_E2E_DEBUG_AUTH = "0";
    mockFailingStudentsQuery({ code: "42501", message: "permission denied" });

    const result = await searchStudents({});

    expect(result.ok).toBe(false);
    expect(appendFileSync).not.toHaveBeenCalled();
  });

  it("writes a bounded code/message diagnostic entry when the debug flag is enabled", async () => {
    process.env.PHASE5_E2E_DEBUG_AUTH = "1";
    mockFailingStudentsQuery({
      code: "42501",
      message: "permission denied for function is_admin_or_super",
    });

    const result = await searchStudents({});

    expect(result.ok).toBe(false);
    expect(appendFileSync).toHaveBeenCalledTimes(1);
    const [filePath, entry] = vi.mocked(appendFileSync).mock.calls[0] as [string, string];
    expect(filePath).toContain("phase5-e2e-searchStudents-error.log");
    expect(entry).toContain("[searchStudents]");
    expect(entry).toContain("code=42501");
    expect(entry).toContain("permission denied for function is_admin_or_super");
    expect(entry).not.toContain("details=");
    expect(entry).not.toContain("hint=");
  });

  it("redacts a JWT-shaped substring inside the error message before writing", async () => {
    process.env.PHASE5_E2E_DEBUG_AUTH = "1";
    const fakeJwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYE";
    mockFailingStudentsQuery({ code: "PGRST301", message: `token rejected: ${fakeJwt}` });

    await searchStudents({});

    const [, entry] = vi.mocked(appendFileSync).mock.calls[0] as [string, string];
    expect(entry).not.toContain(fakeJwt);
    expect(entry).toContain("[REDACTED-JWT]");
  });

  it("never changes the user-facing result shape regardless of the debug flag", async () => {
    mockFailingStudentsQuery({ code: "42501", message: "permission denied" });
    process.env.PHASE5_E2E_DEBUG_AUTH = "1";
    const withDebug = await searchStudents({});

    mockFailingStudentsQuery({ code: "42501", message: "permission denied" });
    delete process.env.PHASE5_E2E_DEBUG_AUTH;
    const withoutDebug = await searchStudents({});

    expect(withDebug).toEqual(withoutDebug);
    expect(withDebug).toEqual({ ok: false, error: "Could not load the student list." });
  });
});
