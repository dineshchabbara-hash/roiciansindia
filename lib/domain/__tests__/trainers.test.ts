import { describe, expect, it } from "vitest";
import {
  isTrainerStatus,
  TRAINER_STATUSES,
  findTrainerDuplicateReasons,
  findTrainerDuplicateMatches,
  parseSpecializationInput,
  formatSpecializationForDisplay,
  type TrainerDuplicateCandidate,
  type NewTrainerInput,
} from "@/lib/domain/trainers";

describe("TRAINER_STATUSES / isTrainerStatus", () => {
  it("only supports active and inactive — no archived, matching the actual schema CHECK constraint", () => {
    expect(TRAINER_STATUSES).toEqual(["active", "inactive"]);
  });

  it.each(["active", "inactive"])("accepts %s", (status) => {
    expect(isTrainerStatus(status)).toBe(true);
  });

  it.each(["archived", "pending", "", null, undefined, 42])("rejects %s", (value) => {
    expect(isTrainerStatus(value)).toBe(false);
  });
});

describe("findTrainerDuplicateReasons", () => {
  const existing: TrainerDuplicateCandidate = {
    id: "trainer-1",
    firstName: "Asha",
    lastName: "Rao",
    email: "asha.rao@example.com",
    phone: "+919876543210",
  };

  it("matches on phone (canonical E.164 comparison)", () => {
    const input: NewTrainerInput = {
      email: "different@example.com",
      phone: "+919876543210",
    };
    expect(findTrainerDuplicateReasons(input, existing)).toEqual(["phone"]);
  });

  it("matches on email case/whitespace-insensitively", () => {
    const input: NewTrainerInput = { email: "  ASHA.RAO@EXAMPLE.COM  ", phone: null };
    expect(findTrainerDuplicateReasons(input, existing)).toEqual(["email"]);
  });

  it("matches on both phone and email at once", () => {
    const input: NewTrainerInput = {
      email: "asha.rao@example.com",
      phone: "+919876543210",
    };
    expect(findTrainerDuplicateReasons(input, existing)).toEqual(
      expect.arrayContaining(["phone", "email"]),
    );
  });

  it("never matches when neither phone nor email align", () => {
    const input: NewTrainerInput = {
      email: "someone.else@example.com",
      phone: "+14165556002",
    };
    expect(findTrainerDuplicateReasons(input, existing)).toEqual([]);
  });

  it("does not match on phone when either side has no phone on file", () => {
    const noPhoneExisting = { ...existing, phone: null };
    const input: NewTrainerInput = {
      email: "someone.else@example.com",
      phone: "+919876543210",
    };
    expect(findTrainerDuplicateReasons(input, noPhoneExisting)).toEqual([]);
  });
});

describe("findTrainerDuplicateMatches", () => {
  it("only returns candidates with at least one matching reason", () => {
    const candidates: TrainerDuplicateCandidate[] = [
      { id: "1", firstName: "A", lastName: "B", email: "match@example.com", phone: null },
      {
        id: "2",
        firstName: "C",
        lastName: "D",
        email: "nomatch@example.com",
        phone: null,
      },
    ];
    const input: NewTrainerInput = { email: "match@example.com", phone: null };
    const matches = findTrainerDuplicateMatches(input, candidates);
    expect(matches).toHaveLength(1);
    expect(matches[0].candidate.id).toBe("1");
    expect(matches[0].reasons).toEqual(["email"]);
  });
});

describe("parseSpecializationInput / formatSpecializationForDisplay", () => {
  it("splits, trims, and de-duplicates comma-separated skills", () => {
    expect(parseSpecializationInput("React, Node.js,  React ,Testing")).toEqual([
      "React",
      "Node.js",
      "Testing",
    ]);
  });

  it("drops empty entries from stray commas", () => {
    expect(parseSpecializationInput("React,, ,Node.js")).toEqual(["React", "Node.js"]);
  });

  it("returns an empty array for blank input", () => {
    expect(parseSpecializationInput("")).toEqual([]);
  });

  it("formats back to a comma-separated string for display/edit prefill", () => {
    expect(formatSpecializationForDisplay(["React", "Node.js"])).toBe("React, Node.js");
  });
});
