// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The export route's own authorization and streaming behavior. The data
 * layer (fetchReportRange) and session lookup are mocked; the real filter
 * parser, CSV serializer and row-to-cell mapping run.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/data/reports", () => ({ fetchReportRange: vi.fn() }));

import { NextRequest } from "next/server";
import { getCurrentUserContext } from "@/lib/auth/session";
import { fetchReportRange } from "@/lib/data/reports";
import { GET } from "@/app/api/exports/[report]/route";
import type { Role } from "@/lib/domain/rbac";

function asRole(role: Role) {
  vi.mocked(getCurrentUserContext).mockResolvedValue({
    authUserId: "u1",
    email: "x@example.com",
    role,
    profileId: "p1",
    displayName: "X",
  });
}

function call(report: string, query = "") {
  const request = new NextRequest(`http://localhost/api/exports/${report}${query}`);
  return GET(request, { params: Promise.resolve({ report }) });
}

function student(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `s${i}`,
    studentCode: `ROI-STU-${i}`,
    firstName: "Asha",
    lastName: "Rao",
    email: null,
    phone: "9876543210",
    status: "active",
    registrationDate: "2026-01-02",
    enrollmentCount: 1,
    ...overrides,
  };
}

// Response.text() strips a leading BOM while decoding; read the raw bytes
// so the BOM the route actually sends is asserted.
async function rawBody(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorization (independent of the /admin layout)", () => {
  it("returns 401 with no session and never queries", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    const response = await call("students");
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(fetchReportRange).not.toHaveBeenCalled();
  });

  it.each(["trainer", "student"] as const)(
    "returns 403 for a %s and never queries",
    async (role) => {
      asRole(role);
      const response = await call("financial");
      expect(response.status).toBe(403);
      expect(await response.text()).not.toMatch(/,/);
      expect(fetchReportRange).not.toHaveBeenCalled();
    },
  );

  it("checks authorization before validating the report name", async () => {
    asRole("student");
    expect((await call("nope")).status).toBe(403);
  });

  it("returns 404 for an unknown report for an Admin", async () => {
    asRole("admin");
    expect((await call("payments")).status).toBe(404);
    expect((await call("__proto__")).status).toBe(404);
    expect(fetchReportRange).not.toHaveBeenCalled();
  });
});

describe("CSV output", () => {
  it.each(["admin", "super_admin"] as const)(
    "streams a UTF-8 CSV with BOM, header and rows for %s",
    async (role) => {
      asRole(role);
      vi.mocked(fetchReportRange).mockResolvedValue({
        ok: true,
        data: {
          total: 2,
          rows: [
            student(1, { firstName: "आशा", lastName: "Rao, Jr." }),
            student(2, { firstName: "=cmd|' /C calc'!A0", email: "line1\nline2" }),
          ],
        },
      } as never);

      const response = await call("students", "?status=active&sort=name&dir=asc&page=7");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
      expect(response.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="students-report-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store, private");
      expect(response.headers.get("X-Report-Row-Count")).toBe("2");

      const body = await rawBody(response);
      expect(body.charCodeAt(0)).toBe(0xfeff);
      expect(body.slice(1)).toBe(
        "Student code,First name,Last name,Email,Phone,Status,Registration date,Enrollments\r\n" +
          'ROI-STU-1,आशा,"Rao, Jr.",,9876543210,Active,2026-01-02,1\r\n' +
          "ROI-STU-2,'=cmd|' /C calc'!A0,Rao,\"line1\nline2\",9876543210,Active,2026-01-02,1\r\n",
      );

      // Same parsed filters as the page; export always starts at row 0 —
      // the page number never limits an export.
      const [kind, filters, from, to] = vi.mocked(fetchReportRange).mock.calls[0];
      expect(kind).toBe("students");
      expect(filters).toMatchObject({ status: "active", sort: "name", dir: "asc" });
      expect([from, to]).toEqual([0, 499]);
    },
  );

  it("writes only the header row for an empty result", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange).mockResolvedValue({
      ok: true,
      data: { total: 0, rows: [] },
    } as never);
    const body = await rawBody(await call("certificates"));
    expect(body).toBe(
      "﻿Certificate number,Status,Issue date,Completion date,Revoked on,Student code,Student name,Program,Enrollment code\r\n",
    );
  });

  it("iterates in bounded batches until every counted row is written", async () => {
    asRole("admin");
    const all = Array.from({ length: 501 }, (_, i) => student(i));
    vi.mocked(fetchReportRange).mockImplementation(
      async (_kind, _filters, from, to) =>
        ({
          ok: true,
          data: { total: 501, rows: all.slice(from, to + 1) },
        }) as never,
    );

    const body = await (await call("students")).text();
    expect(body.split("\r\n").filter(Boolean)).toHaveLength(502);
    expect(vi.mocked(fetchReportRange).mock.calls.map((c) => [c[2], c[3]])).toEqual([
      [0, 499],
      [500, 999],
    ]);
  });
});

describe("no silent truncation", () => {
  it("refuses an export above the row cap with 413 and no CSV", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange).mockResolvedValue({
      ok: true,
      data: { total: 5001, rows: [student(1)] },
    } as never);
    const response = await call("students");
    expect(response.status).toBe(413);
    expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
    expect(await response.text()).toBe(
      "This export would contain 5001 rows, above the 5000-row limit. Narrow the filters and export again.",
    );
    expect(fetchReportRange).toHaveBeenCalledTimes(1);
  });

  it("allows an export of exactly the cap", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange).mockImplementation(
      async (_kind, _filters, from, to) =>
        ({
          ok: true,
          data: {
            total: 5000,
            rows: Array.from({ length: to - from + 1 }, (_, i) => student(from + i)),
          },
        }) as never,
    );
    const response = await call("students");
    expect(response.status).toBe(200);
    expect((await response.text()).split("\r\n").filter(Boolean)).toHaveLength(5001);
  });

  it("returns 500 when the first batch fails", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange).mockResolvedValue({
      ok: false,
      error: "Could not load the student report.",
    });
    const response = await call("students");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Could not load the student report.");
  });

  it("errors the stream when a later batch fails", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange)
      .mockResolvedValueOnce({
        ok: true,
        data: { total: 600, rows: Array.from({ length: 500 }, (_, i) => student(i)) },
      } as never)
      .mockResolvedValueOnce({ ok: false, error: "boom" });
    const response = await call("students");
    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow();
  });

  it("errors the stream when the row count changes mid-export", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange)
      .mockResolvedValueOnce({
        ok: true,
        data: { total: 600, rows: Array.from({ length: 500 }, (_, i) => student(i)) },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        data: { total: 601, rows: Array.from({ length: 101 }, (_, i) => student(i)) },
      } as never);
    await expect((await call("students")).text()).rejects.toThrow();
  });

  it("errors the stream when fewer rows arrive than were counted", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange).mockResolvedValue({
      ok: true,
      data: { total: 3, rows: [student(1)] },
    } as never);
    await expect((await call("students")).text()).rejects.toThrow();
  });
});

describe("trainer report export (FR-120)", () => {
  const TRAINER_HEADER =
    "First name,Last name,Email,Phone,Status,Specialization,Date added,Assigned batches\r\n";

  function trainer(overrides: Record<string, unknown> = {}) {
    return {
      id: "t1",
      firstName: "Meera",
      lastName: "Iyer",
      email: "meera@example.com",
      phone: null,
      status: "active",
      specialization: ["QA", "Selenium"],
      createdAt: "2026-03-01T20:00:00Z",
      assignedBatchCount: 2,
      ...overrides,
    };
  }

  it.each(["admin", "super_admin"] as const)(
    "lets %s export the filtered trainer rows through the shared route",
    async (role) => {
      asRole(role);
      vi.mocked(fetchReportRange).mockResolvedValue({
        ok: true,
        data: {
          total: 2,
          rows: [
            trainer(),
            trainer({
              id: "t2",
              firstName: '=HYPERLINK("http://x")',
              lastName: "+Iyer",
              email: "@evil",
              phone: "-1",
              specialization: ["=1+1", "Data, Analytics"],
              assignedBatchCount: 0,
            }),
          ],
        },
      } as never);

      const response = await call(
        "trainers",
        "?status=active&q=meera&sort=joined&page=4",
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Disposition")).toMatch(
        /^attachment; filename="trainers-report-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      const body = await rawBody(response);
      expect(body).toBe(
        "﻿" +
          TRAINER_HEADER +
          "Meera,Iyer,meera@example.com,,Active,QA; Selenium,2026-03-02,2\r\n" +
          '"\'=HYPERLINK(""http://x"")",\'+Iyer,\'@evil,\'-1,Active,"\'=1+1; Data, Analytics",2026-03-02,0\r\n',
      );

      const [kind, filters, from, to] = vi.mocked(fetchReportRange).mock.calls[0];
      expect(kind).toBe("trainers");
      expect(filters).toMatchObject({ status: "active", q: "meera", sort: "joined" });
      expect([from, to]).toEqual([0, 499]);
    },
  );

  it("writes only the header for an empty trainer result", async () => {
    asRole("admin");
    vi.mocked(fetchReportRange).mockResolvedValue({
      ok: true,
      data: { total: 0, rows: [] },
    } as never);
    expect(await rawBody(await call("trainers"))).toBe("﻿" + TRAINER_HEADER);
  });

  it.each(["trainer", "student"] as const)(
    "denies a %s the trainer export with 403 and never queries",
    async (role) => {
      asRole(role);
      const response = await call("trainers");
      expect(response.status).toBe(403);
      expect(response.headers.get("Content-Disposition")).toBeNull();
      expect(fetchReportRange).not.toHaveBeenCalled();
    },
  );

  it("denies an anonymous trainer export with 401 and never queries", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(null);
    const response = await call("trainers");
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(fetchReportRange).not.toHaveBeenCalled();
  });
});
