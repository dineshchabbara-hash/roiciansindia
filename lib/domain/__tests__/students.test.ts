import { describe, expect, it } from "vitest";
import {
  normalizeIndianPhone,
  findDuplicateReasons,
  findDuplicateMatches,
  formatStudentCode,
  isStudentStatus,
  sanitizeFileNameForStorage,
  buildStudentDocumentPath,
  type DuplicateCandidate,
  type NewStudentInput,
} from "@/lib/domain/students";

const baseInput: NewStudentInput = {
  firstName: "Asha",
  lastName: "Rao",
  email: "asha.rao@example.com",
  phone: "9876543210",
  dateOfBirth: "2000-01-15",
};

const existing = (overrides: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: "11111111-1111-1111-1111-111111111111",
  studentCode: "10001",
  firstName: "Asha",
  lastName: "Rao",
  email: "asha.rao@example.com",
  phone: "9876543210",
  dateOfBirth: "2000-01-15",
  ...overrides,
});

describe("normalizeIndianPhone", () => {
  it("accepts a valid bare 10-digit India number", () => {
    expect(normalizeIndianPhone("9898595069")).toBe("+919898595069");
  });

  it("accepts a valid +91-prefixed number", () => {
    expect(normalizeIndianPhone("+919898595069")).toBe("+919898595069");
  });

  it("accepts a valid number with spaces and a + prefix", () => {
    expect(normalizeIndianPhone("+91 98985 95069")).toBe("+919898595069");
  });

  it("accepts a valid number with a dash and no +", () => {
    expect(normalizeIndianPhone("91-9898595069")).toBe("+919898595069");
  });

  it("rejects a 9-digit number", () => {
    expect(normalizeIndianPhone("987654321")).toBeNull();
  });

  it("rejects a subscriber number longer than 10 digits", () => {
    expect(normalizeIndianPhone("98765432109")).toBeNull();
    expect(normalizeIndianPhone("+9198765432109")).toBeNull();
  });

  it("rejects alphabetic input", () => {
    expect(normalizeIndianPhone("98NOTANUM1")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeIndianPhone("   ")).toBeNull();
  });

  it("rejects a non-Indian country code", () => {
    expect(normalizeIndianPhone("+12345678901")).toBeNull();
  });

  it("never guesses — an ambiguous invalid number returns null, not a best-effort fix", () => {
    expect(normalizeIndianPhone("123456")).toBeNull();
  });
});

describe("findDuplicateReasons", () => {
  it("matches on exact normalized phone", () => {
    const reasons = findDuplicateReasons(
      baseInput,
      existing({ email: null, dateOfBirth: null }),
    );
    expect(reasons).toEqual(["phone"]);
  });

  it("matches phone even when one side has a country code and the other doesn't", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "+919876543210" },
      existing({ phone: "9876543210", email: null, dateOfBirth: null }),
    );
    expect(reasons).toEqual(["phone"]);
  });

  it("matches phone across differently-formatted input on both sides", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "91-9876543210" },
      existing({ phone: "+91 98765 43210", email: null, dateOfBirth: null }),
    );
    expect(reasons).toEqual(["phone"]);
  });

  it("does not match phone when a stored legacy value doesn't parse as a valid number", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "9876543210" },
      existing({ phone: "not-a-number", email: null, dateOfBirth: null }),
    );
    expect(reasons).not.toContain("phone");
  });

  it("matches on case-insensitive email", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "0000000000" },
      existing({
        phone: "1111111111",
        email: "ASHA.RAO@EXAMPLE.COM",
        dateOfBirth: "1990-01-01",
      }),
    );
    expect(reasons).toEqual(["email"]);
  });

  it("does not match email when either side lacks one", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "0000000000", email: null },
      existing({ phone: "1111111111" }),
    );
    expect(reasons).not.toContain("email");
  });

  it("matches on name + DOB together", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "0000000000", email: null },
      existing({ phone: "1111111111", email: null }),
    );
    expect(reasons).toEqual(["name_and_dob"]);
  });

  it("does NOT match on name alone when DOB differs", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "0000000000", email: null },
      existing({ phone: "1111111111", email: null, dateOfBirth: "1999-05-05" }),
    );
    expect(reasons).toEqual([]);
  });

  it("does NOT match on name alone when either side has no DOB", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "0000000000", email: null, dateOfBirth: null },
      existing({ phone: "1111111111", email: null }),
    );
    expect(reasons).toEqual([]);
  });

  it("is case/whitespace-insensitive for name matching", () => {
    const reasons = findDuplicateReasons(
      {
        ...baseInput,
        phone: "0000000000",
        email: null,
        firstName: "  ASHA  ",
        lastName: "rao",
      },
      existing({ phone: "1111111111", email: null }),
    );
    expect(reasons).toEqual(["name_and_dob"]);
  });

  it("can match on more than one rule at once", () => {
    const reasons = findDuplicateReasons(baseInput, existing());
    expect(reasons).toEqual(expect.arrayContaining(["phone", "email", "name_and_dob"]));
    expect(reasons).toHaveLength(3);
  });

  it("returns no reasons for an unrelated person", () => {
    const reasons = findDuplicateReasons(baseInput, {
      id: "22222222-2222-2222-2222-222222222222",
      studentCode: "10002",
      firstName: "Vikram",
      lastName: "Singh",
      email: "vikram@example.com",
      phone: "1234567890",
      dateOfBirth: "1998-03-03",
    });
    expect(reasons).toEqual([]);
  });
});

describe("findDuplicateMatches", () => {
  it("filters candidates down to only those with at least one matching reason", () => {
    const matches = findDuplicateMatches(baseInput, [
      existing(),
      {
        id: "33333333-3333-3333-3333-333333333333",
        studentCode: "10003",
        firstName: "Nobody",
        lastName: "Else",
        email: "nobody@example.com",
        phone: "5555555555",
        dateOfBirth: null,
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.studentCode).toBe("10001");
  });
});

describe("formatStudentCode", () => {
  it("formats with an empty prefix by default", () => {
    expect(formatStudentCode("", 10001)).toBe("10001");
  });

  it("formats with a configured prefix", () => {
    expect(formatStudentCode("RT-", 10001)).toBe("RT-10001");
  });
});

describe("isStudentStatus", () => {
  it("accepts the three valid statuses", () => {
    expect(isStudentStatus("active")).toBe(true);
    expect(isStudentStatus("inactive")).toBe(true);
    expect(isStudentStatus("archived")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isStudentStatus("deleted")).toBe(false);
    expect(isStudentStatus(null)).toBe(false);
  });
});

describe("sanitizeFileNameForStorage", () => {
  it("replaces unsafe characters with underscores", () => {
    expect(sanitizeFileNameForStorage("my resume (final).pdf")).toBe(
      "my_resume__final_.pdf",
    );
  });

  it("keeps safe characters as-is", () => {
    expect(sanitizeFileNameForStorage("id-proof_2026.pdf")).toBe("id-proof_2026.pdf");
  });

  it("replaces every character of an all-separator name, without collapsing to empty", () => {
    expect(sanitizeFileNameForStorage("///")).toBe("___");
  });

  it("falls back to a default name for an empty input", () => {
    expect(sanitizeFileNameForStorage("")).toBe("file");
  });

  it("caps extremely long names", () => {
    const long = "a".repeat(500) + ".pdf";
    expect(sanitizeFileNameForStorage(long).length).toBeLessThanOrEqual(100);
  });
});

describe("buildStudentDocumentPath", () => {
  it("scopes the path to the server-verified studentId, not client input", () => {
    const path = buildStudentDocumentPath("student-123", "obj-456", "resume.pdf");
    expect(path).toBe("student-123/obj-456-resume.pdf");
  });

  it("sanitizes the original filename component", () => {
    const path = buildStudentDocumentPath("student-123", "obj-456", "../../etc/passwd");
    expect(path.startsWith("student-123/obj-456-")).toBe(true);
    expect(path).not.toContain("..");
    expect(path).not.toContain("/etc/");
  });
});
