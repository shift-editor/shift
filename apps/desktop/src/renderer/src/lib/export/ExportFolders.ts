import type { WorkspaceDocumentState } from "@shift/types";
import { DocumentViews, documentViewKey } from "@/lib/workspace/documentViews";
import type { ExportTarget } from "@/types/export";
import { childPath, parentFolder } from "./exportPaths";

/** The folder beside a saved document that each target suggests until one is chosen. */
const DEFAULT_SUBFOLDER = {
  variable: "fonts",
  static: "fonts",
  ufo: "sources",
} as const satisfies Record<ExportTarget, string>;

/**
 * The folder each Export dialog target writes into, remembered per document.
 *
 * @remarks
 * Folders are personal view state kept in {@link DocumentViews}, never in the
 * document. A target without a remembered folder suggests `fonts` or
 * `sources` beside the saved document; an unsaved document suggests none.
 */
export class ExportFolders {
  readonly #views: DocumentViews;

  constructor(views: DocumentViews = new DocumentViews()) {
    this.#views = views;
  }

  /** The folder `target` exports into for `document`, or null when there is none yet. */
  folder(document: WorkspaceDocumentState, target: ExportTarget): string | null {
    const remembered = this.#views.read(documentViewKey(document))?.exportFolders?.[target];
    if (remembered !== undefined) return remembered;

    const documentFolder = document.saveTarget === null ? null : parentFolder(document.saveTarget);
    return documentFolder === null ? null : childPath(documentFolder, DEFAULT_SUBFOLDER[target]);
  }

  /** Remembers `folder` as where `target` exports for `document`. */
  remember(document: WorkspaceDocumentState, target: ExportTarget, folder: string): void {
    const key = documentViewKey(document);
    const exportFolders = { ...this.#views.read(key)?.exportFolders, [target]: folder };
    this.#views.update(key, { exportFolders });
  }
}
