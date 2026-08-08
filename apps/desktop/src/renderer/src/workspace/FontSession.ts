import type { FontSessionMode } from "@shared/workspace/protocol";
import type { Editor } from "@/lib/editor/Editor";
import type { Font } from "@/lib/model/Font";
import type { GlyphCatalog } from "@/lib/catalog/GlyphCatalog";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import type { Workspace } from "./Workspace";

/** Immutable renderer composition for one connected font session. */
export class FontSession {
  readonly mode: FontSessionMode;
  /** Whether this immutable session permits durable authoring operations. */
  readonly canAuthor: boolean;
  readonly catalog: GlyphCatalog;
  readonly workspace: Workspace | null;
  readonly font: Font;
  readonly editor: Editor;
  readonly #client: FontSessionClient;

  constructor(
    mode: FontSessionMode,
    catalog: GlyphCatalog,
    workspace: Workspace | null,
    client: FontSessionClient,
    font: Font,
    editor: Editor,
  ) {
    this.mode = mode;
    this.canAuthor = mode === "authored";
    this.catalog = catalog;
    this.workspace = workspace;
    this.font = font;
    this.editor = editor;
    this.#client = client;
  }

  dispose(): void {
    this.catalog.dispose();
    if (this.workspace) {
      this.workspace.dispose();
    } else {
      this.font.dispose();
    }
    this.#client.dispose();
  }
}
