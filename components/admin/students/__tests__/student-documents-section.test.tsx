import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentDocumentsSection } from "@/components/admin/students/student-documents-section";
import {
  deleteStudentDocumentAction,
  uploadStudentDocumentAction,
} from "@/lib/actions/students";
import {
  formatDisplayTimestamp,
  MAX_DOCUMENT_FILE_SIZE_LABEL,
} from "@/lib/domain/students";
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

  it("shows a real accessible file chooser with the current size limit, and no file chosen initially", () => {
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);
    // A real, labeled <input type="file"> — not a fake/decorative control —
    // is what makes clicking the styled "Select file" control open the
    // native OS picker and stay keyboard/screen-reader accessible.
    const input = screen.getByLabelText("Select file");
    expect(input).toHaveAttribute("type", "file");
    expect(screen.getByText("No file chosen")).toBeInTheDocument();
    expect(
      screen.getByText(`Maximum file size: ${MAX_DOCUMENT_FILE_SIZE_LABEL}`),
    ).toBeInTheDocument();
  });

  it("shows the selected filename once a file is chosen", async () => {
    const user = userEvent.setup();
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);

    const file = new File(["hello"], "passport-scan.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Select file"), file);

    expect(screen.getByText("passport-scan.pdf")).toBeInTheDocument();
    expect(screen.queryByText("No file chosen")).not.toBeInTheDocument();
  });

  it("submits a real file through to the action and shows success feedback", async () => {
    vi.mocked(uploadStudentDocumentAction).mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);

    const file = new File(["hello"], "id.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Select file"), file);
    await user.type(screen.getByPlaceholderText(/Document type/), "ID proof");
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    await waitFor(() => expect(uploadStudentDocumentAction).toHaveBeenCalled());
    // bound as uploadStudentDocumentAction.bind(null, studentId), so the
    // mock records (studentId, prevState, formData) — formData is the 3rd.
    // (Not asserting the File's .name survives here: jsdom's own
    // `new FormData(formElement)` doesn't copy a file input's File name —
    // a jsdom limitation, not app behavior — so this checks what a real
    // browser and this test environment can both actually prove: a real
    // File instance reaches the action boundary through the real form.)
    const formData = vi.mocked(uploadStudentDocumentAction).mock.calls[0][2];
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(formData.get("documentType")).toBe("ID proof");
    expect(await screen.findByText("Uploaded")).toBeInTheDocument();
  });

  it("blocks an oversized file client-side with a visible error, and never calls the action", async () => {
    // Real Phase 5 bug: an oversized file used to reach (and be rejected
    // by) Next's own Server Action body-size transport limit, crashing the
    // page. This proves the fix at the form boundary: the request is never
    // even sent for a file over the limit.
    const user = userEvent.setup();
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);

    const oversizedFile = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(oversizedFile, "size", { value: 50_000_000 });
    await user.upload(screen.getByLabelText("Select file"), oversizedFile);
    await user.type(screen.getByPlaceholderText(/Document type/), "ID proof");
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    expect(screen.getByText(/too large/i)).toBeInTheDocument();
    expect(uploadStudentDocumentAction).not.toHaveBeenCalled();
  });

  it("shows a visible error, not a crash, when the upload action itself reports a failure", async () => {
    vi.mocked(uploadStudentDocumentAction).mockResolvedValue({
      formError: "Could not upload the document. Please try again.",
    });
    const user = userEvent.setup();
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);

    const file = new File(["hello"], "id.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Select file"), file);
    await user.type(screen.getByPlaceholderText(/Document type/), "ID proof");
    await user.click(screen.getByRole("button", { name: "Upload document" }));

    expect(
      await screen.findByText("Could not upload the document. Please try again."),
    ).toBeInTheDocument();
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
