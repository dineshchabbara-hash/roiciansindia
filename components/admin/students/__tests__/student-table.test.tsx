import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentTable } from "@/components/admin/students/student-table";
import type { StudentListRow } from "@/lib/data/students";

const sample: StudentListRow = {
  id: "1",
  studentCode: "10001",
  firstName: "Priya",
  lastName: "Sharma",
  email: "priya@example.com",
  phone: "9876543210",
  status: "active",
  registrationDate: "2026-09-01",
};

describe("StudentTable", () => {
  it("shows an empty state when there are no students", () => {
    render(<StudentTable students={[]} />);
    expect(screen.getByText("No students found.")).toBeInTheDocument();
  });

  it("renders a student row with a link to their profile", () => {
    render(<StudentTable students={[sample]} />);
    const link = screen.getByRole("link", { name: "Priya Sharma" });
    expect(link).toHaveAttribute("href", "/admin/students/1");
    expect(screen.getByText("10001")).toBeInTheDocument();
    expect(screen.getByText("9876543210")).toBeInTheDocument();
  });

  it("shows an em-dash for a missing email rather than blank", () => {
    render(<StudentTable students={[{ ...sample, email: null }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
