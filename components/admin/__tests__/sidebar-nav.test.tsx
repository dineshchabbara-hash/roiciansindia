import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUsePathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// Imported after the mock so the component picks up the mocked hook.
const { SidebarNav } = await import("@/components/admin/sidebar-nav");

describe("SidebarNav", () => {
  it("renders all 14 admin nav items", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<SidebarNav />);
    expect(screen.getAllByRole("link")).toHaveLength(14);
  });

  it("marks the Dashboard link as the current page when on /admin", () => {
    mockUsePathname.mockReturnValue("/admin");
    render(<SidebarNav />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /Students/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks the Students link as current on /admin/students, and Dashboard as not current", () => {
    mockUsePathname.mockReturnValue("/admin/students");
    render(<SidebarNav />);
    expect(screen.getByRole("link", { name: /Students/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^Dashboard/ })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("calls onNavigate when a link is clicked (used to close the mobile drawer)", async () => {
    mockUsePathname.mockReturnValue("/admin");
    const onNavigate = vi.fn();
    render(<SidebarNav onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("link", { name: /Students/ }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
