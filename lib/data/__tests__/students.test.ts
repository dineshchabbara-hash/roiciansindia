import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Real regression coverage for a Phase 5 bug: a real file upload crashed
 * the Student Profile page to the Admin error boundary instead of showing
 * an inline error. lib/actions/__tests__/students.test.ts's
 * uploadStudentDocumentAction/deleteStudentDocumentAction tests mock this
 * whole module (lib/data/students.ts), which is right for testing the
 * action's own control flow — but it means the rollback/error-handling
 * logic actually living *inside* uploadStudentDocument/deleteStudentDocument
 * (Storage upload failure, metadata-insert failure triggering a Storage
 * cleanup, ownership re-verification before deleting) was never itself
 * exercised against anything. This file mocks only the true I/O boundary —
 * createSupabaseServerClient — so the real functions run for real.
 */

// lib/data/students.ts (and lib/supabase/admin.ts, which it also imports)
// both start with `import "server-only"` — a build-time bundler-condition
// marker that unconditionally throws under Vitest's plain Node/jsdom
// resolution (there's no bundler swapping it for the no-op build). Every
// other test that touches this module mocks the whole thing instead of
// importing it for real; mocking the marker package itself is what lets
// this file import the REAL uploadStudentDocument/deleteStudentDocument.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { uploadStudentDocument, deleteStudentDocument } from "@/lib/data/students";

type MockResult<T> = { data: T; error: unknown };

function mockSupabase(overrides: {
  storageUpload?: { error: unknown };
  storageRemove?: { error: unknown };
  insertResult?: MockResult<{ id: string } | null>;
  selectResult?: MockResult<unknown>;
  deleteResult?: { error: unknown };
}) {
  const storageUpload = vi
    .fn()
    .mockResolvedValue(overrides.storageUpload ?? { error: null });
  const storageRemove = vi
    .fn()
    .mockResolvedValue(overrides.storageRemove ?? { error: null });

  const insertChain = {
    select: vi.fn().mockReturnValue({
      single: vi
        .fn()
        .mockResolvedValue(
          overrides.insertResult ?? { data: { id: "doc-new" }, error: null },
        ),
    }),
  };

  const selectChain = {
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi
        .fn()
        .mockResolvedValue(overrides.selectResult ?? { data: null, error: null }),
    }),
  };

  const deleteChain = {
    eq: vi.fn().mockResolvedValue(overrides.deleteResult ?? { error: null }),
  };

  const from = vi.fn().mockReturnValue({
    insert: vi.fn().mockReturnValue(insertChain),
    select: vi.fn().mockReturnValue(selectChain),
    delete: vi.fn().mockReturnValue(deleteChain),
  });

  const client = {
    storage: {
      from: vi.fn().mockReturnValue({ upload: storageUpload, remove: storageRemove }),
    },
    from,
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return { storageUpload, storageRemove, from };
}

function testFile(): File {
  return new File(["hello"], "id.pdf", { type: "application/pdf" });
}

describe("uploadStudentDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads to Storage then inserts metadata, returning the new document id", async () => {
    const { storageUpload, from } = mockSupabase({});

    const result = await uploadStudentDocument(
      "student-1",
      "ID proof",
      testFile(),
      "admin-1",
    );

    expect(result).toEqual({ ok: true, data: { id: "doc-new" } });
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("student_documents");
  });

  it("returns a controlled error (never throws) when the Storage upload fails, and never attempts the metadata insert", async () => {
    const { from } = mockSupabase({
      storageUpload: { error: new Error("storage down") },
    });

    const result = await uploadStudentDocument(
      "student-1",
      "ID proof",
      testFile(),
      "admin-1",
    );

    expect(result).toEqual({
      ok: false,
      error: "Could not upload the document. Please try again.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("removes the already-uploaded Storage object when the metadata insert fails, leaving no orphan", async () => {
    const { storageUpload, storageRemove } = mockSupabase({
      insertResult: { data: null, error: new Error("insert failed") },
    });

    const result = await uploadStudentDocument(
      "student-1",
      "ID proof",
      testFile(),
      "admin-1",
    );

    expect(result.ok).toBe(false);
    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(storageRemove).toHaveBeenCalledTimes(1);
    const [removedPaths] = storageRemove.mock.calls[0] as [string[]];
    expect(removedPaths[0]).toMatch(/^student-1\//);
  });
});

describe("deleteStudentDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes the Storage object then the metadata row", async () => {
    const { storageRemove, from } = mockSupabase({
      selectResult: {
        data: { id: "doc-1", student_id: "student-1", file_path: "student-1/x-file.pdf" },
        error: null,
      },
    });

    const result = await deleteStudentDocument("student-1", "doc-1");

    expect(result).toEqual({ ok: true, data: null });
    expect(storageRemove).toHaveBeenCalledWith(["student-1/x-file.pdf"]);
    expect(from).toHaveBeenCalledTimes(2); // the select, then the delete
  });

  it("re-verifies ownership and rejects a mismatched studentId before ever touching Storage", async () => {
    const { storageRemove } = mockSupabase({
      selectResult: {
        data: { id: "doc-1", student_id: "some-other-student", file_path: "x" },
        error: null,
      },
    });

    const result = await deleteStudentDocument("student-1", "doc-1");

    expect(result).toEqual({ ok: false, error: "Document not found." });
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("returns a controlled error (never throws) when Storage removal fails, and never deletes the metadata row", async () => {
    const { from } = mockSupabase({
      selectResult: {
        data: { id: "doc-1", student_id: "student-1", file_path: "student-1/x-file.pdf" },
        error: null,
      },
      storageRemove: { error: new Error("storage down") },
    });

    const result = await deleteStudentDocument("student-1", "doc-1");

    expect(result.ok).toBe(false);
    expect(from).toHaveBeenCalledTimes(1); // only the initial select — delete() never reached
  });
});
