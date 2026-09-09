import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DuplicateWarningPanel } from "@/components/admin/students/duplicate-warning-panel";
import type { StudentFormState } from "@/lib/actions/students";

const duplicates: NonNullable<StudentFormState["duplicates"]> = [
  {
    studentId: "1",
    studentCode: "10001",
    name: "Priya Sharma",
    reasons: ["phone"],
    reasonLabels: ["Same phone number"],
  },
];

describe("DuplicateWarningPanel", () => {
  it("lists the matched student and reason", () => {
    render(<DuplicateWarningPanel duplicates={duplicates} />);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("(10001)")).toBeInTheDocument();
    expect(screen.getByText("Same phone number")).toBeInTheDocument();
  });

  it("requires the confirmation checkbox and a reason", () => {
    render(<DuplicateWarningPanel duplicates={duplicates} />);
    expect(screen.getByRole("checkbox")).toBeRequired();
    expect(screen.getByPlaceholderText(/twin siblings/)).toBeRequired();
  });

  it("uses singular wording for exactly one match", () => {
    render(<DuplicateWarningPanel duplicates={duplicates} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A possible duplicate student was found",
    );
  });

  it("uses plural wording for more than one match", () => {
    render(
      <DuplicateWarningPanel
        duplicates={[
          ...duplicates,
          {
            ...duplicates[0],
            studentId: "2",
            studentCode: "10002",
            name: "Someone Else",
          },
        ]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Possible duplicate students were found",
    );
  });
});
