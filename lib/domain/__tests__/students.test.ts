import { describe, expect, it } from "vitest";
import {
  normalizeInternationalPhone,
  findDuplicateReasons,
  findDuplicateMatches,
  formatStudentCode,
  isStudentStatus,
  sanitizeFileNameForStorage,
  buildStudentDocumentPath,
  documentDisplayFileName,
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

describe("normalizeInternationalPhone", () => {
  it("accepts a valid bare 10-digit India number given India as the country hint", () => {
    expect(normalizeInternationalPhone("9898595069", "IN")).toBe("+919898595069");
  });

  it("accepts a valid +91 India number with no country hint needed", () => {
    expect(normalizeInternationalPhone("+919898595069")).toBe("+919898595069");
  });

  it("accepts a valid India number with spaces and a + prefix", () => {
    expect(normalizeInternationalPhone("+91 98985 95069")).toBe("+919898595069");
  });

  it("accepts a valid India number with a dash and no +, given the country hint", () => {
    expect(normalizeInternationalPhone("91-9898595069", "IN")).toBe("+919898595069");
  });

  it("accepts a valid Canada number in full E.164 form", () => {
    expect(normalizeInternationalPhone("+14165551234")).toBe("+14165551234");
  });

  it("accepts a valid Canada national number given Canada as the country hint", () => {
    expect(normalizeInternationalPhone("416-555-1234", "CA")).toBe("+14165551234");
  });

  it("accepts a valid UK number in full E.164 form", () => {
    expect(normalizeInternationalPhone("+447911123456")).toBe("+447911123456");
  });

  it("accepts a valid UK national number (with trunk 0) given the UK as the country hint", () => {
    expect(normalizeInternationalPhone("07911 123456", "GB")).toBe("+447911123456");
  });

  it("accepts a valid UAE number in full E.164 form", () => {
    expect(normalizeInternationalPhone("+971501234567")).toBe("+971501234567");
  });

  it("accepts a valid UAE national number (with trunk 0) given the UAE as the country hint", () => {
    expect(normalizeInternationalPhone("0501234567", "AE")).toBe("+971501234567");
  });

  it("accepts a number formatted with parentheses and dashes, given the country hint", () => {
    expect(normalizeInternationalPhone("(416) 555-1234", "CA")).toBe("+14165551234");
  });

  it("accepts a number formatted with extra dashes throughout", () => {
    expect(normalizeInternationalPhone("98-98-59-50-69", "IN")).toBe("+919898595069");
  });

  it("rejects a 9-digit India number", () => {
    expect(normalizeInternationalPhone("987654321", "IN")).toBeNull();
  });

  it("rejects an India subscriber number longer than 10 digits", () => {
    expect(normalizeInternationalPhone("98765432109", "IN")).toBeNull();
  });

  it("rejects a UK number that is too short to be real", () => {
    expect(normalizeInternationalPhone("+4479", "GB")).toBeNull();
  });

  it("rejects a Canada number with too few digits", () => {
    expect(normalizeInternationalPhone("416-555", "CA")).toBeNull();
  });

  it("rejects alphabetic input", () => {
    expect(normalizeInternationalPhone("98NOTANUM1", "IN")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeInternationalPhone("   ", "IN")).toBeNull();
  });

  it("rejects a bare national number with no leading + and no country hint — never guesses", () => {
    expect(normalizeInternationalPhone("9876543210")).toBeNull();
  });

  it("ignores an unsupported country hint rather than guessing with it", () => {
    expect(normalizeInternationalPhone("9876543210", "ZZ")).toBeNull();
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

  it("matches a duplicate UK number entered in two different valid formats", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "+447911123456" },
      existing({ phone: "+44 7911 123456", email: null, dateOfBirth: null }),
    );
    expect(reasons).toEqual(["phone"]);
  });

  it("matches a duplicate Canada number entered in two different valid formats", () => {
    const reasons = findDuplicateReasons(
      { ...baseInput, phone: "+14165551234" },
      existing({ phone: "+1 (416) 555-1234", email: null, dateOfBirth: null }),
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

describe("documentDisplayFileName", () => {
  it("recovers the original filename from a real stored path", () => {
    const objectId = crypto.randomUUID();
    const path = buildStudentDocumentPath("student-123", objectId, "passport.pdf");
    expect(documentDisplayFileName(path)).toBe("passport.pdf");
  });

  it("preserves dashes that were part of the original filename", () => {
    const objectId = crypto.randomUUID();
    const path = buildStudentDocumentPath("student-123", objectId, "id-proof-2026.pdf");
    expect(documentDisplayFileName(path)).toBe("id-proof-2026.pdf");
  });

  it("falls back to the whole last path segment if there is no UUID prefix", () => {
    expect(documentDisplayFileName("student-123/not-a-uuid.pdf")).toBe("not-a-uuid.pdf");
  });
});
