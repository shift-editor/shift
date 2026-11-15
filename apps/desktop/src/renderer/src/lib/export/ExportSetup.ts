import type { WorkspaceDocumentState } from "@shift/types";
import { DocumentViews, documentViewKey } from "@/lib/workspace/documentViews";
import { isOutputOf, type ExportRow } from "@/types/export";

/** The rows a document starts with before any are changed: one variable TrueType. */
const DEFAULT_ROWS = [{ target: "variable", output: "ttf" }] as const;

/**
 * The Export section's rows and whether it is open, remembered per document.
 *
 * @remarks
 * Like {@link ExportFolders}, this is personal view state kept in
 * {@link DocumentViews}, never in the document.
 */
export class ExportSetup {
  readonly #views: DocumentViews;

  constructor(views: DocumentViews = new DocumentViews()) {
    this.#views = views;
  }

  /** The rows `document` exports, each with a fresh id. */
  rows(document: WorkspaceDocumentState | null): readonly ExportRow[] {
    const stored =
      document === null ? undefined : this.#views.read(documentViewKey(document))?.exportRows;
    const rows = (stored ?? DEFAULT_ROWS).filter((row) => isOutputOf(row.target, row.output));
    return rows.map((row) => ({ ...row, id: newRowId() }));
  }

  /** Remembers `rows` as what `document` exports. */
  rememberRows(document: WorkspaceDocumentState, rows: readonly ExportRow[]): void {
    const exportRows = rows.map(({ target, output }) => ({ target, output }));
    this.#views.update(documentViewKey(document), { exportRows });
  }

  /** Whether the section was left open for `document`; open until it is first closed. */
  isOpen(document: WorkspaceDocumentState | null): boolean {
    if (document === null) return true;
    return this.#views.read(documentViewKey(document))?.exportOpen ?? true;
  }

  /** Remembers whether the section is open for `document`. */
  rememberOpen(document: WorkspaceDocumentState, open: boolean): void {
    this.#views.update(documentViewKey(document), { exportOpen: open });
  }
}

/** A new row id, unique within the window. */
export function newRowId(): string {
  return crypto.randomUUID();
}
