import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getCurrentUserContext: vi.fn() }));
vi.mock("@/lib/data/company-settings", () => ({
  getCompanySettings: vi.fn(),
  updateCompanySettings: vi.fn(),
  replaceCompanyLogo: vi.fn(),
  removeCompanyLogo: vi.fn(),
}));
vi.mock("@/lib/data/audit-log", () => ({ writeAuditLog: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  removeCompanyLogoAction,
  updateCompanySettingsAction,
  uploadCompanyLogoAction,
} from "@/lib/actions/company-settings";
import { getCurrentUserContext } from "@/lib/auth/session";
import {
  getCompanySettings,
  replaceCompanyLogo,
  updateCompanySettings,
} from "@/lib/data/company-settings";
import { writeAuditLog } from "@/lib/data/audit-log";
import type { CompanySettings } from "@/lib/domain/company-settings";

function context(role: "admin" | "super_admin" | "trainer" | "student") {
  return {
    authUserId: `${role}-auth-1`,
    email: `${role}@example.com`,
    role,
    profileId: `${role}-profile-1`,
    displayName: `Test ${role}`,
  };
}

const current: CompanySettings = {
  id: "settings-1",
  companyName: "Roicians Tech",
  legalName: "Roicians Tech Pvt. Ltd.",
  address: null,
  phone: null,
  email: null,
  website: null,
  country: "India",
  gstin: null,
  taxEnabled: false,
  taxLabel: "GST",
  receiptNumberFormat: "REC-{year}-{seq:6}",
  certificateNumberFormat: "CERT-{year}-{seq:6}",
  certificateSignatoryName: null,
  certificateSignatoryTitle: null,
  socialLinks: {},
  logoPath: null,
  updatedAt: "2026-10-13T00:00:00Z",
};

function settingsForm(values: Record<string, string> = {}) {
  const fd = new FormData();
  const all: Record<string, string> = {
    companyName: current.companyName,
    legalName: current.legalName,
    receiptNumberFormat: current.receiptNumberFormat,
    certificateNumberFormat: current.certificateNumberFormat,
    ...values,
  };
  for (const [k, v] of Object.entries(all)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCompanySettings).mockResolvedValue({ ok: true, data: current });
});

describe("updateCompanySettingsAction", () => {
  it.each(["admin", "trainer", "student"] as const)(
    "refuses a %s (Admin is read-only)",
    async (role) => {
      vi.mocked(getCurrentUserContext).mockResolvedValue(context(role));
      const state = await updateCompanySettingsAction({}, settingsForm({ address: "X" }));
      expect(state.formError).toBe("Only a Super Admin can change company settings.");
      expect(updateCompanySettings).not.toHaveBeenCalled();
    },
  );

  it("saves a Super Admin change and audits exactly the changed fields", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    vi.mocked(updateCompanySettings).mockResolvedValue({
      ok: true,
      data: { ...current, address: "12 MG Road" },
    });
    const state = await updateCompanySettingsAction(
      {},
      settingsForm({ address: "12 MG Road" }),
    );
    expect(state.message).toBe("Company settings saved.");
    expect(writeAuditLog).toHaveBeenCalledWith({
      actorAuthUserId: "super_admin-auth-1",
      actorRole: "super_admin",
      action: "company_settings.updated",
      entityType: "company_settings",
      entityId: "settings-1",
      before: { fields: ["address"], address: null },
      after: { fields: ["address"], address: "12 MG Road" },
    });
  });

  it("does not write or audit when nothing changed", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    const state = await updateCompanySettingsAction({}, settingsForm());
    expect(state.message).toBe("No changes to save.");
    expect(updateCompanySettings).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("returns field errors and saves nothing for invalid values", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    const state = await updateCompanySettingsAction(
      {},
      settingsForm({ receiptNumberFormat: "REC-{year}", social_x: "http://x.com" }),
    );
    expect(state.fieldErrors?.receiptNumberFormat).toBeTruthy();
    expect(state.fieldErrors?.social_x).toBeTruthy();
    expect(updateCompanySettings).not.toHaveBeenCalled();
  });
});

describe("logo actions", () => {
  it("are Super Admin only", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("admin"));
    const fd = new FormData();
    fd.set(
      "logo",
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        "l.png",
      ),
    );
    expect((await uploadCompanyLogoAction({}, fd)).formError).toBeTruthy();
    expect((await removeCompanyLogoAction({}, new FormData())).formError).toBeTruthy();
    expect(replaceCompanyLogo).not.toHaveBeenCalled();
  });

  it("rejects an SVG/non-image upload by its bytes", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    const fd = new FormData();
    fd.set(
      "logo",
      new File(["<svg><script>alert(1)</script></svg>"], "logo.png", {
        type: "image/png",
      }),
    );
    const state = await uploadCompanyLogoAction({}, fd);
    expect(state.formError).toBe("Upload a PNG, JPEG or WebP image.");
    expect(replaceCompanyLogo).not.toHaveBeenCalled();
  });

  it("stores a PNG and audits the change", async () => {
    vi.mocked(getCurrentUserContext).mockResolvedValue(context("super_admin"));
    vi.mocked(replaceCompanyLogo).mockResolvedValue({
      ok: true,
      data: { logoPath: "logo/x.png", previousPath: null },
    });
    const fd = new FormData();
    fd.set(
      "logo",
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
        "l.png",
      ),
    );
    const state = await uploadCompanyLogoAction({}, fd);
    expect(state.message).toBe("Logo updated.");
    expect(replaceCompanyLogo).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "png",
      "image/png",
    );
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "company_settings.logo_updated" }),
    );
  });
});
