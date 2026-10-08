import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  encodeRecipientRef,
  formatUnreadCount,
  parseRecipientRef,
  sanitizeRecipientSearch,
} from "@/lib/domain/notifications";
import {
  parseNotificationIdFormData,
  parseSendNotificationFormData,
} from "@/lib/validation/notifications";

const STUDENT_ID = "11111111-2222-4333-8444-555555555555";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("recipient references", () => {
  it("round-trips a student and a trainer reference", () => {
    expect(
      parseRecipientRef(encodeRecipientRef({ kind: "student", profileId: STUDENT_ID })),
    ).toEqual({
      kind: "student",
      profileId: STUDENT_ID,
    });
    expect(parseRecipientRef(`trainer:${STUDENT_ID}`)).toEqual({
      kind: "trainer",
      profileId: STUDENT_ID,
    });
  });

  it("rejects admin/unknown kinds, non-uuid ids, and raw auth user ids", () => {
    expect(parseRecipientRef(`admin:${STUDENT_ID}`)).toBeNull();
    expect(parseRecipientRef(`student:not-a-uuid`)).toBeNull();
    expect(parseRecipientRef(STUDENT_ID)).toBeNull();
    expect(parseRecipientRef("")).toBeNull();
  });
});

describe("sanitizeRecipientSearch", () => {
  it("keeps names and email characters", () => {
    expect(sanitizeRecipientSearch("  Asha  Rao ")).toBe("Asha Rao");
    expect(sanitizeRecipientSearch("a.b+c@x-y.test")).toBe("a.b+c@x-y.test");
  });

  it("strips PostgREST filter syntax characters", () => {
    expect(sanitizeRecipientSearch("x,id.eq.1)")).toBe("xid.eq.1");
    expect(sanitizeRecipientSearch("%*()\\'\"")).toBe("");
  });
});

describe("formatUnreadCount", () => {
  it("pluralises correctly", () => {
    expect(formatUnreadCount(0)).toBe("No unread notifications");
    expect(formatUnreadCount(1)).toBe("1 unread notification");
    expect(formatUnreadCount(3)).toBe("3 unread notifications");
  });
});

describe("parseSendNotificationFormData", () => {
  it("accepts a valid send and trims title/body", () => {
    const result = parseSendNotificationFormData(
      form({ recipient: `student:${STUDENT_ID}`, title: "  Hello ", body: " World  " }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        recipient: { kind: "student", profileId: STUDENT_ID },
        title: "Hello",
        body: "World",
      });
    }
  });

  it("rejects missing/invalid recipient, blank title/body, and over-length content", () => {
    expect(parseSendNotificationFormData(form({ title: "t", body: "b" })).success).toBe(
      false,
    );
    expect(
      parseSendNotificationFormData(form({ recipient: "admin:x", title: "t", body: "b" }))
        .success,
    ).toBe(false);
    expect(
      parseSendNotificationFormData(
        form({ recipient: `student:${STUDENT_ID}`, title: "   ", body: "b" }),
      ).success,
    ).toBe(false);
    expect(
      parseSendNotificationFormData(
        form({ recipient: `student:${STUDENT_ID}`, title: "t", body: " " }),
      ).success,
    ).toBe(false);
    expect(
      parseSendNotificationFormData(
        form({
          recipient: `student:${STUDENT_ID}`,
          title: "x".repeat(NOTIFICATION_TITLE_MAX + 1),
          body: "b",
        }),
      ).success,
    ).toBe(false);
    expect(
      parseSendNotificationFormData(
        form({
          recipient: `student:${STUDENT_ID}`,
          title: "t",
          body: "x".repeat(NOTIFICATION_BODY_MAX + 1),
        }),
      ).success,
    ).toBe(false);
  });
});

describe("parseNotificationIdFormData", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(parseNotificationIdFormData(form({ notificationId: STUDENT_ID }))).toBe(
      STUDENT_ID,
    );
    expect(parseNotificationIdFormData(form({ notificationId: "1 or 1=1" }))).toBeNull();
    expect(parseNotificationIdFormData(form({}))).toBeNull();
  });
});
