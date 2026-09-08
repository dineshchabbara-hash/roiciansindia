import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentDocumentsSection } from "@/components/admin/students/student-documents-section";
import type { StudentDocumentRow } from "@/lib/data/students";

// lib/actions/students.ts is a "use server" module that imports
// lib/data/students.ts (guarded by `import "server-only"`). Next's bundler
// swaps a "use server" import for a client-safe RPC stub automatically;
// Vitest doesn't, so it would otherwise execute the real server-only module
// and fail. Mocked here purely so this component test can render — none of
// these tests exercise action behavior.
vi.mock("@/lib/actions/students", () => ({
  uploadStudentDocumentAction: vi.fn(),
  deleteStudentDocumentAction: vi.fn(),
}));

const sample: StudentDocumentRow = {
  id: "1",
  documentType: "ID proof",
  filePath: "student-1/abc-id.pdf",
  createdAt: "2026-09-01T00:00:00Z",
};

describe("StudentDocumentsSection", () => {
  it("shows the empty state when there are no documents", () => {
    render(<StudentDocumentsSection studentId="student-1" documents={[]} />);
    expect(screen.getByText("No documents uploaded yet.")).toBeInTheDocument();
  });

  it("lists an existing document with a delete control", () => {
    render(<StudentDocumentsSection studentId="student-1" documents={[sample]} />);
    expect(screen.getByText("ID proof")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
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
});
