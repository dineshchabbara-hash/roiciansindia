import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_STATUSES,
  isAttendanceStatus,
  markedByTypeForRole,
} from "@/lib/domain/attendance";

describe("isAttendanceStatus", () => {
  it("accepts exactly the four CHECK-constraint values", () => {
    for (const status of ATTENDANCE_STATUSES) {
      expect(isAttendanceStatus(status)).toBe(true);
    }
  });

  it("rejects anything else, including case variants", () => {
    expect(isAttendanceStatus("Present")).toBe(false);
    expect(isAttendanceStatus("PRESENT")).toBe(false);
    expect(isAttendanceStatus("tardy")).toBe(false);
    expect(isAttendanceStatus(null)).toBe(false);
    expect(isAttendanceStatus(undefined)).toBe(false);
    expect(isAttendanceStatus(42)).toBe(false);
  });
});

describe("markedByTypeForRole", () => {
  it("maps both admin and super_admin to 'admin'", () => {
    expect(markedByTypeForRole("admin")).toBe("admin");
    expect(markedByTypeForRole("super_admin")).toBe("admin");
  });

  it("maps trainer to 'trainer'", () => {
    expect(markedByTypeForRole("trainer")).toBe("trainer");
  });

  it("returns null for student (never an authorized marker)", () => {
    expect(markedByTypeForRole("student")).toBeNull();
  });
});
