import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentDocumentsSection } from "@/components/admin/students/student-documents-section";
import { deleteStudentDocumentAction } from "@/lib/actions/students";
import { formatDisplayTimestamp } from "@/lib/domain/students";
import type { StudentDocumentRow } from "@/lib/data/students";

// lib/actions/students.ts is a "use server" module that imports
// lib/data/students.ts (guarded by `import "server-only"`). Next's bundler
// swaps a "use server" import for a client-safe RPC stub automatically;
// Vitest doesn't, so it would otherwise execute the real server-only module
// and fail. Mocked here so this component test can render and so the delete
// button's confirm-then-call-the-action wiring can be observed directly.
vi.mock("@/lib/actions/students", () => ({
  uploadStudentDocumentAction: vi.fn(),
  deleteStudentDocumentAction: vi.fn(),
}));

const sample: StudentDocumentRow = {
  id: "1",
  documentType: "ID proof",
  filePath: "student-1/abc-id.pdf",
  fileName: "passport.pdf",
  createdAt: "2026-09-01T00:00:00Z",
};

describe("StudentDocumentsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty state when there are no documents", () => {
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);
    expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument();
  });

  it("lists an existing document with its filename and a delete control", () => {
    render(<StudentDocumentsSection studentId="student-1" documents={[sample]} />);
    expect(screen.getByText("ID proof")).toBeInTheDocument();
    expect(screen.getByText("passport.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("renders the upload timestamp using the deterministic shared formatter", () => {
    // Same hydration-bug class as student-notes-section.tsx: this used to
    // call `new Date(...).toLocaleString()` directly. Asserting the exact
    // expected string from the shared formatter, not just "some date text",
    // is what catches any drift back to a locale-dependent call.
    render(<StudentDocumentsSection studentId="student-1" documents={[sample]} />);
    expect(
      screen.getByText(formatDisplayTimestamp(sample.createdAt)),
    ).toBeInTheDocument();
    expect(screen.getByText("1 Sep 2026, 00:00 UTC")).toBeInTheDocument();
  });

  it("always shows the admin-only upload form", () => {
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);
    expect(screen.getByPlaceholderText(/Document type/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument();
  });

  it("notes this is admin/super-admin only, never shown to the student portal", () => {
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);
    expect(screen.getByText(/Admin\/Super Admin only/)).toBeInTheDocument();
  });

  it("asks for confirmation before deleting, and does not call the action when cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<StudentDocumentsSection studentId="student-1" documents={[sample]} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("passport.pdf"));
    expect(deleteStudentDocumentAction).not.toHaveBeenCalled();
  });

  it("calls the delete action once confirmed, and shows a visible error if it fails", async () => {
    vi.mocked(deleteStudentDocumentAction).mockResolvedValue({
      formError: "Could not delete the document. Please try again.",
    });
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StudentDocumentsSection studentId="student-1" documents={[sample]} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteStudentDocumentAction).toHaveBeenCalled());
    expect(
      await screen.findByText("Could not delete the document. Please try again."),
    ).toBeInTheDocument();
  });
});
