import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentNotesSection } from "@/components/admin/students/student-notes-section";
import { formatDisplayTimestamp } from "@/lib/domain/students";
import type { StudentNoteRow } from "@/lib/data/students";

// lib/actions/students.ts is a "use server" module that imports
// lib/data/students.ts (guarded by `import "server-only"`). Next's bundler
// swaps a "use server" import for a client-safe RPC stub automatically;
// Vitest doesn't, so it would otherwise execute the real server-only module
// and fail. Mocked here purely so this component test can render.
vi.mock("@/lib/actions/students", () => ({
  addStudentNoteAction: vi.fn(),
}));

const sample: StudentNoteRow = {
  id: "note-1",
  note: "Called to confirm batch timing.",
  createdByName: "Test Admin",
  createdAt: "2026-09-09T12:58:52.000Z",
};

describe("StudentNotesSection", () => {
  it("shows the empty state when there are no notes", () => {
    render(<StudentNotesSection studentId="student-1" notes={[]} />);
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
  });

  it("renders a note's timestamp using the deterministic shared formatter", () => {
    render(<StudentNotesSection studentId="student-1" notes={[sample]} />);

    // Regression for the hydration bug: the server rendered
    // "2026-09-09, 12:58:52 p.m." while the browser hydrated
    // "9/9/2026, 12:58:52 PM" for the exact same note, because the old code
    // called `new Date(...).toLocaleString()` directly (locale/time-zone
    // dependent). Asserting the exact expected string from the shared
    // formatter — not just "some date text is present" — is what would
    // have caught that: any drift back to a locale-dependent call would
    // fail this on the very next environment it runs in.
    expect(screen.getByText("Called to confirm batch timing.")).toBeInTheDocument();
    expect(
      screen.getByText(`Test Admin · ${formatDisplayTimestamp(sample.createdAt)}`),
    ).toBeInTheDocument();
    expect(screen.getByText("Test Admin · 9 Sep 2026, 12:58 UTC")).toBeInTheDocument();
  });

  it("always shows the note-adding form", () => {
    render(<StudentNotesSection studentId="student-1" notes={[]} />);
    expect(screen.getByPlaceholderText("Add a note...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
  });

  it("notes this is staff-only, never shown to the student", () => {
    render(<StudentNotesSection studentId="student-1" notes={[]} />);
    expect(screen.getByText(/Staff-only/)).toBeInTheDocument();
  });
});
