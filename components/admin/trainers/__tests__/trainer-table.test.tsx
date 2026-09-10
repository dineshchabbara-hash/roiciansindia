import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrainerTable } from "@/components/admin/trainers/trainer-table";
import type { TrainerListRow } from "@/lib/data/trainers";

const sample: TrainerListRow = {
  id: "1",
  firstName: "Priya",
  lastName: "Sharma",
  email: "priya@example.com",
  phone: "+919876543210",
  status: "active",
};

describe("TrainerTable", () => {
  it("shows an empty state when there are no trainers", () => {
    render(<TrainerTable trainers={[]} />);
    expect(screen.getByText("No trainers found.")).toBeInTheDocument();
  });

  it("renders a trainer row with a link to their profile", () => {
    render(<TrainerTable trainers={[sample]} />);
    const link = screen.getByRole("link", { name: "Priya Sharma" });
    expect(link).toHaveAttribute("href", "/admin/trainers/1");
    expect(screen.getByText("priya@example.com")).toBeInTheDocument();
    expect(screen.getByText("+919876543210")).toBeInTheDocument();
  });

  it("shows an em-dash for a missing phone rather than blank", () => {
    render(<TrainerTable trainers={[{ ...sample, phone: null }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
