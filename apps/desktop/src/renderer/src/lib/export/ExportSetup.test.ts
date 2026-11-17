import { describe, expect, it } from "vitest";
import type { WorkspaceDocumentState } from "@shift/types";
import { DocumentViews } from "@/lib/workspace/documentViews";
import { exportRequestFor } from "@/types/export";
import { ExportSetup } from "./ExportSetup";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

function document(documentId: string, saveTarget: string | null): WorkspaceDocumentState {
  return {
    workspaceId: `workspace-${documentId}`,
    sourceKind: saveTarget === null ? "untitled" : "document",
    documentId,
    saveTarget,
    canonicalPath: saveTarget,
    dirty: false,
    needsSaveAs: false,
  };
}

const kinds = (rows: readonly { target: string; output: string }[]) =>
  rows.map(({ target, output }) => `${target}:${output}`);

describe("the Export section's rows are remembered per document", () => {
  it("starts a document with one variable TrueType row, open", () => {
    const setup = new ExportSetup(new DocumentViews(memoryStorage));
    const saved = document("doc-1", "/type/Solenoid/Solenoid.shift");

    expect(kinds(setup.rows(saved))).toEqual(["variable:ttf"]);
    expect(kinds(setup.rows(null))).toEqual(["variable:ttf"]);
    expect(setup.isOpen(saved)).toBe(true);
  });

  it("keeps a document's rows, in order, and whether the section is open, across sessions", () => {
    const storage = memoryStorage();
    const saved = document("doc-1", "/type/Solenoid/Solenoid.shift");
    const other = document("doc-2", "/type/Other/Other.shift");
    const first = new ExportSetup(new DocumentViews(() => storage));
    first.rememberRows(saved, [
      { id: "a", target: "static", output: "woff2" },
      { id: "b", target: "ufo", output: "designspace" },
    ]);
    first.rememberOpen(saved, false);

    const reopened = new ExportSetup(new DocumentViews(() => storage));

    expect(kinds(reopened.rows(saved))).toEqual(["static:woff2", "ufo:designspace"]);
    expect(reopened.isOpen(saved)).toBe(false);
    expect(kinds(reopened.rows(other))).toEqual(["variable:ttf"]);
    expect(reopened.isOpen(other)).toBe(true);
  });

  it("gives every row it reads its own id", () => {
    const storage = memoryStorage();
    const setup = new ExportSetup(new DocumentViews(() => storage));
    const saved = document("doc-1", "/type/Solenoid/Solenoid.shift");
    setup.rememberRows(saved, [
      { id: "a", target: "variable", output: "ttf" },
      { id: "b", target: "variable", output: "ttf" },
    ]);

    const ids = setup.rows(saved).map((row) => row.id);

    expect(new Set(ids).size).toBe(2);
  });
});

describe("each row asks the workspace for one export", () => {
  it("writes binaries in the row's encoding and sources in the row's layout", () => {
    expect(exportRequestFor({ target: "variable", output: "woff2" })).toEqual({
      format: "ttf",
      encodings: ["woff2"],
    });
    expect(exportRequestFor({ target: "static", output: "ttf" })).toEqual({
      format: "static-ttf",
      encodings: ["ttf"],
    });
    expect(exportRequestFor({ target: "ufo", output: "designspace" }).format).toBe("designspace");
    expect(exportRequestFor({ target: "ufo", output: "ufo" }).format).toBe("ufo");
  });
});
