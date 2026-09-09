import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentStatusBadge } from "@/components/admin/students/student-status-badge";

describe("StudentStatusBadge", () => {
  it("renders each status label", () => {
    render(<StudentStatusBadge status="active" />);
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("renders inactive and archived too", () => {
    const { rerender } = render(<StudentStatusBadge status="inactive" />);
    expect(screen.getByText("inactive")).toBeInTheDocument();
    rerender(<StudentStatusBadge status="archived" />);
    expect(screen.getByText("archived")).toBeInTheDocument();
  });
});
