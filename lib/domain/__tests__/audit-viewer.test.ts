import { describe, expect, it } from "vitest";
import {
  auditFilterQuery,
  istDayStartIso,
  istNextDayStartIso,
  parseAuditFilters,
  summarizeAuditData,
} from "@/lib/domain/audit-viewer";

describe("parseAuditFilters", () => {
  it("keeps valid filters", () => {
    expect(
      parseAuditFilters({
        from: "2026-10-01",
        to: "2026-10-13",
        action: "refund.",
        entity: "refund",
        role: "admin",
        id: "AAAAAAAA-BBBB-4CCC-8DDD-000000000001",
        page: "3",
      }),
    ).toEqual({
      from: "2026-10-01",
      to: "2026-10-13",
      action: "refund.",
      entityType: "refund",
      actorRole: "admin",
      entityId: "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
      page: 3,
    });
  });

  it("drops anything malformed instead of passing it to the query", () => {
    expect(
      parseAuditFilters({
        from: "13/10/2026",
        action: "refund.processed'; drop table",
        entity: "Refund!",
        role: "hacker",
        id: "not-a-uuid",
        page: "-2",
      }),
    ).toEqual({
      from: null,
      to: null,
      action: null,
      entityType: null,
      actorRole: null,
      entityId: null,
      page: 1,
    });
  });
});

describe("IST day bounds", () => {
  it("uses Asia/Kolkata midnight", () => {
    expect(istDayStartIso("2026-10-13")).toBe("2026-10-12T18:30:00.000Z");
    expect(istNextDayStartIso("2026-10-13")).toBe("2026-10-13T18:30:00.000Z");
  });
});

describe("summarizeAuditData", () => {
  it("masks credential-like keys and flattens values", () => {
    expect(
      summarizeAuditData({
        amount: "2000.00",
        password: "x",
        razorpay_signature: "abc",
        apiKey: "k",
        nested: { a: 1 },
        flag: true,
        empty: null,
      }),
    ).toEqual([
      { key: "amount", value: "2000.00" },
      { key: "password", value: "[hidden]" },
      { key: "razorpay_signature", value: "[hidden]" },
      { key: "apiKey", value: "[hidden]" },
      { key: "nested", value: '{"a":1}' },
      { key: "flag", value: "true" },
      { key: "empty", value: "—" },
    ]);
  });

  it("truncates long values and ignores non-objects", () => {
    const [entry] = summarizeAuditData({ note: "x".repeat(300) });
    expect(entry.value).toHaveLength(121);
    expect(summarizeAuditData(null)).toEqual([]);
    expect(summarizeAuditData(["a"])).toEqual([]);
  });
});

describe("auditFilterQuery", () => {
  it("round-trips filters into a page link", () => {
    const filters = parseAuditFilters({ action: "refund.", role: "system" });
    expect(auditFilterQuery(filters, 2)).toBe("?action=refund.&role=system&page=2");
    expect(auditFilterQuery(parseAuditFilters({}), 1)).toBe("");
  });
});
