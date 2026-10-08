import { z } from "zod";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  isUuid,
  parseRecipientRef,
} from "@/lib/domain/notifications";

export const sendNotificationSchema = z.object({
  recipient: z
    .string({ error: "Choose a recipient." })
    .trim()
    .min(1, "Choose a recipient.")
    .transform((value, ctx) => {
      const ref = parseRecipientRef(value);
      if (!ref) {
        ctx.addIssue({ code: "custom", message: "Choose a valid recipient." });
        return z.NEVER;
      }
      return ref;
    }),
  title: z
    .string({ error: "Enter a title." })
    .trim()
    .min(1, "Enter a title.")
    .max(
      NOTIFICATION_TITLE_MAX,
      `Title must be ${NOTIFICATION_TITLE_MAX} characters or fewer.`,
    ),
  body: z
    .string({ error: "Enter a message." })
    .trim()
    .min(1, "Enter a message.")
    .max(
      NOTIFICATION_BODY_MAX,
      `Message must be ${NOTIFICATION_BODY_MAX} characters or fewer.`,
    ),
});

export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;

export function parseSendNotificationFormData(formData: FormData) {
  return sendNotificationSchema.safeParse({
    recipient: formData.get("recipient") ?? undefined,
    title: formData.get("title") ?? undefined,
    body: formData.get("body") ?? undefined,
  });
}

export function parseNotificationIdFormData(formData: FormData): string | null {
  const value = formData.get("notificationId");
  if (typeof value !== "string") return null;
  const id = value.trim();
  return isUuid(id) ? id : null;
}
