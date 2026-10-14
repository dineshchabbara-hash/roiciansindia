import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/actions/accounts", () => ({
  createAdminAccountAction: vi.fn(),
  setAdminAccountStatusAction: vi.fn(),
  provisionStudentPortalAccessAction: vi.fn(),
}));

import { CreateAdminForm } from "@/components/admin/accounts/create-admin-form";
import { AdminStatusButton } from "@/components/admin/accounts/admin-status-button";
import { PortalAccessCard } from "@/components/admin/students/portal-access-card";
import {
  createAdminAccountAction,
  provisionStudentPortalAccessAction,
} from "@/lib/actions/accounts";

const STUDENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";

beforeEach(() => vi.clearAllMocks());

describe("CreateAdminForm", () => {
  it("asks only for names and email — no role, no password", () => {
    render(<CreateAdminForm />);
    const form = screen.getByRole("form", { name: "Create admin account" });
    const names = Array.from(form.querySelectorAll("input")).map((i) =>
      i.getAttribute("name"),
    );
    expect(names).toEqual(["firstName", "lastName", "email"]);
    expect(form.querySelector('input[type="password"]')).toBeNull();
    expect(form).toHaveTextContent("The account gets the Admin role.");
  });

  it("submits and shows the result", async () => {
    vi.mocked(createAdminAccountAction).mockResolvedValue({
      message: "Admin account created for asha@example.com.",
    });
    render(<CreateAdminForm />);
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Asha" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Rao" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "asha@example.com" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create admin account" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Admin account created for asha@example.com.",
      ),
    );
  });
});

describe("AdminStatusButton", () => {
  it("submits the opposite status for one admin", () => {
    const { container, rerender } = render(
      <AdminStatusButton adminId="adm-1" name="Asha Rao" status="active" />,
    );
    expect(
      screen.getByRole("button", { name: "Deactivate Asha Rao" }),
    ).toBeInTheDocument();
    expect(container.querySelector('input[name="status"]')).toHaveValue("inactive");
    rerender(<AdminStatusButton adminId="adm-1" name="Asha Rao" status="inactive" />);
    expect(
      screen.getByRole("button", { name: "Reactivate Asha Rao" }),
    ).toBeInTheDocument();
    expect(container.querySelector('input[name="status"]')).toHaveValue("active");
  });
});

describe("PortalAccessCard", () => {
  const base = {
    studentId: STUDENT_ID,
    studentEmail: "asha@example.com",
    studentStatus: "active",
    hasPhoto: false,
  };

  it("offers provisioning for an active student with an email, submitting only the id", async () => {
    vi.mocked(provisionStudentPortalAccessAction).mockResolvedValue({
      message: "Portal access created for asha@example.com.",
    });
    render(<PortalAccessCard {...base} access={{ status: "none" }} />);
    expect(screen.getByText("No portal access")).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Give portal access" });
    const fields = Array.from(form.querySelectorAll("input")).map((i) => [
      i.name,
      i.value,
    ]);
    expect(fields).toEqual([["studentId", STUDENT_ID]]);
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Give portal access" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Portal access created for asha@example.com.",
      ),
    );
  });

  it("explains why it cannot provision without an email or for an inactive student", () => {
    const { rerender } = render(
      <PortalAccessCard {...base} studentEmail={null} access={{ status: "none" }} />,
    );
    expect(screen.getByText(/Add the student's email address first/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <PortalAccessCard {...base} studentStatus="inactive" access={{ status: "none" }} />,
    );
    expect(screen.getByText(/only be given to an active student/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows awaiting activation and active states with no provisioning button", () => {
    const { rerender } = render(
      <PortalAccessCard
        {...base}
        access={{ status: "awaiting_activation", email: "asha@example.com" }}
      />,
    );
    expect(screen.getByText("Awaiting activation")).toBeInTheDocument();
    expect(screen.getByText("Login: asha@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <PortalAccessCard
        {...base}
        hasPhoto
        access={{
          status: "active",
          email: "asha@example.com",
          lastSignInAt: "2026-10-13T05:00:00Z",
        }}
      />,
    );
    expect(screen.getByText(/^Active/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Student profile photo" })).toHaveAttribute(
      "src",
      `/api/students/${STUDENT_ID}/photo`,
    );
  });
});
