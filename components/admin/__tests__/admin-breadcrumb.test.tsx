import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

const { AdminBreadcrumb } = await import("@/components/admin/admin-breadcrumb");

describe("AdminBreadcrumb", () => {
  it("shows just 'Admin' on the dashboard root", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<AdminBreadcrumb />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("shows 'Admin / <Section>' on a module page", () => {
    mockUsePathname.mockReturnValue("/admin/students");
    render(<AdminBreadcrumb />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Students")).toBeInTheDocument();
  });
});
