import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const { MobileNav } = await import("@/components/admin/mobile-nav");

describe("MobileNav", () => {
  it("drawer is closed by default", () => {
    render(<MobileNav companyName="Roicians Tech" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the drawer when the menu button is clicked, showing all nav items", async () => {
    render(<MobileNav companyName="Roicians Tech" />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(14);
  });

  it("closes the drawer when a nav link is clicked", async () => {
    render(<MobileNav companyName="Roicians Tech" />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");

    await userEvent.click(screen.getByRole("link", { name: /Students/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the drawer on Escape (Radix Dialog default behavior)", async () => {
    render(<MobileNav companyName="Roicians Tech" />);
    await userEvent.click(screen.getByRole("button", { name: "Open menu" }));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
