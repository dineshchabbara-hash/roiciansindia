import { z } from "zod";

/**
 * Phase 21C account forms. Only identifiers and names are ever submitted —
 * never a role, a login id or a password: the operation fixes the role and
 * the server resolves the login.
 */

const UUID_MESSAGE = "This form is out of date. Reload the page and try again.";

export const studentPortalAccessSchema = z.object({
  studentId: z.string().uuid(UUID_MESSAGE),
});

export const adminAccountSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "Enter the first name.")
    .max(80, "First name must be at most 80 characters."),
  lastName: z
    .string()
    .trim()
    .min(1, "Enter the last name.")
    .max(80, "Last name must be at most 80 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Email must be at most 254 characters.")
    .pipe(z.email("Enter a valid email address.")),
});

export const adminStatusSchema = z.object({
  adminId: z.string().uuid(UUID_MESSAGE),
  status: z.enum(["active", "inactive"]),
});
