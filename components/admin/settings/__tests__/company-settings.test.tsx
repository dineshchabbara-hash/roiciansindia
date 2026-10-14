import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/actions/company-settings", () => ({
  updateCompanySettingsAction: vi.fn(),
  uploadCompanyLogoAction: vi.fn(),
  removeCompanyLogoAction: vi.fn(),
}));

import { CompanySettingsForm } from "@/components/admin/settings/company-settings-form";
import { CompanySettingsView } from "@/components/admin/settings/company-settings-view";
import { CompanyLogoForm } from "@/components/admin/settings/company-logo-form";
import { updateCompanySettingsAction } from "@/lib/actions/company-settings";
import type { CompanySettings } from "@/lib/domain/company-settings";

const settings: CompanySettings = {
  id: "settings-1",
  companyName: "Roicians Tech",
  legalName: "Roicians Tech Pvt. Ltd.",
  address: "12 MG Road",
  phone: null,
  email: "hello@roicians.example",
  website: null,
  country: "India",
  gstin: "29ABCDE1234F1Z5",
  taxEnabled: false,
  taxLabel: "GST",
  receiptNumberFormat: "REC-{year}-{seq:6}",
  certificateNumberFormat: "CERT-{year}-{seq:6}",
  certificateSignatoryName: "A. Director",
  certificateSignatoryTitle: null,
  socialLinks: { linkedin: "https://linkedin.com/company/roicians" },
  logoPath: null,
  updatedAt: "2026-10-13T00:00:00Z",
};

beforeEach(() => vi.clearAllMocks());

describe("CompanySettingsForm (Super Admin)", () => {
  it("pre-fills every editable field and previews numbering", () => {
    render(<CompanySettingsForm settings={settings} year={2026} />);
    const form = screen.getByRole("form", { name: "Company settings" });
    expect(within(form).getByLabelText("Brand name")).toHaveValue("Roicians Tech");
    expect(within(form).getByLabelText("Legal name")).toHaveValue(
      "Roicians Tech Pvt. Ltd.",
    );
    expect(within(form).getByLabelText("Address")).toHaveValue("12 MG Road");
    expect(within(form).getByLabelText("GSTIN")).toHaveValue("29ABCDE1234F1Z5");
    expect(within(form).getByLabelText("LinkedIn")).toHaveValue(
      "https://linkedin.com/company/roicians",
    );
    expect(form).toHaveTextContent("Example: REC-2026-000245");
    expect(within(form).queryByLabelText(/tax/i)).not.toBeInTheDocument();
    expect(within(form).queryByLabelText(/role/i)).not.toBeInTheDocument();
  });

  it("keeps the submitted values and shows field errors when the save is refused", async () => {
    vi.mocked(updateCompanySettingsAction).mockResolvedValue({
      formError: "Check the highlighted fields.",
      fieldErrors: { gstin: ["Enter a valid 15-character GSTIN."] },
      values: {
        companyName: "Roicians Tech",
        legalName: "Roicians Tech Pvt. Ltd.",
        gstin: "BAD",
        receiptNumberFormat: "REC-{year}-{seq:6}",
        certificateNumberFormat: "CERT-{year}-{seq:6}",
      },
      attempt: 1,
    });
    render(<CompanySettingsForm settings={settings} year={2026} />);
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: "BAD" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Check the highlighted fields.",
      ),
    );
    expect(screen.getByLabelText("GSTIN")).toHaveValue("BAD");
    expect(screen.getByText("Enter a valid 15-character GSTIN.")).toBeInTheDocument();
  });
});

describe("CompanySettingsView (Admin, read-only)", () => {
  it("shows values with no inputs or buttons", () => {
    const { container } = render(<CompanySettingsView settings={settings} />);
    expect(container.querySelector('dl[aria-label="Company settings"]')).not.toBeNull();
    expect(screen.getByText("Roicians Tech Pvt. Ltd.")).toBeInTheDocument();
    expect(screen.getByText("29ABCDE1234F1Z5")).toBeInTheDocument();
    expect(container.querySelectorAll("input, textarea, button, form")).toHaveLength(0);
  });
});

describe("CompanyLogoForm", () => {
  it("accepts only PNG/JPEG/WebP and offers removal only when a logo exists", () => {
    const { rerender } = render(<CompanyLogoForm logoUrl={null} />);
    expect(screen.getByLabelText("Logo image")).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/webp",
    );
    expect(screen.queryByRole("button", { name: "Remove logo" })).not.toBeInTheDocument();
    rerender(
      <CompanyLogoForm logoUrl="https://x.supabase.co/storage/v1/object/public/branding/logo/a.png" />,
    );
    expect(screen.getByRole("img", { name: "Current company logo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeInTheDocument();
  });
});
