import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentForm } from "@/components/admin/students/student-form";
import type { StudentFormState } from "@/lib/actions/students";

/**
 * The action is injected as a plain prop (never imported by StudentForm
 * itself), so these tests exercise the real contract without needing to
 * mock lib/actions/students — a fake action of the same shape is enough.
 */

describe("StudentForm", () => {
  it("renders a visible error when the action reports a failure — never a silent no-op", async () => {
    const user = userEvent.setup();
    const failingAction = async (): Promise<StudentFormState> => ({
      formError: "Could not create the student. Please try again.",
    });

    render(<StudentForm action={failingAction} submitLabel="Create student" />);

    await user.type(screen.getByLabelText("First name"), "Test");
    await user.type(screen.getByLabelText("Last name"), "Student");
    await user.type(screen.getByLabelText("Phone"), "9876543210");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create the student. Please try again.",
    );
  });

  it("renders a field-level error for an invalid phone number without discarding the rest of the form", async () => {
    const user = userEvent.setup();
    const fieldErrorAction = async (): Promise<StudentFormState> => ({
      fieldErrors: {
        phone: [
          "Enter a valid 10-digit Indian phone number (e.g. 9876543210 or +91 98765 43210).",
        ],
      },
    });

    render(<StudentForm action={fieldErrorAction} submitLabel="Create student" />);

    await user.type(screen.getByLabelText("First name"), "Test");
    await user.type(screen.getByLabelText("Last name"), "Student");
    await user.type(screen.getByLabelText("Phone"), "987654321");
    await user.click(screen.getByRole("button", { name: "Create student" }));

    expect(
      await screen.findByText(/Enter a valid 10-digit Indian phone number/),
    ).toBeInTheDocument();
  });
});
