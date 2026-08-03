import type { FontSessionMode } from "@shared/workspace/protocol";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import type { GlyphCatalogSource } from "@/types/glyphCatalog";
import type { Workspace } from "./Workspace";

/** Immutable renderer composition for one connected font session. */
export class FontSession {
  readonly mode: FontSessionMode;
  readonly catalog: GlyphCatalogSource;
  readonly workspace: Workspace | null;
  readonly #client: FontSessionClient;

  constructor(
    mode: FontSessionMode,
    catalog: GlyphCatalogSource,
    workspace: Workspace | null,
    client: FontSessionClient,
  ) {
    this.mode = mode;
    this.catalog = catalog;
    this.workspace = workspace;
    this.#client = client;
  }

  dispose(): void {
    this.catalog.dispose();
    this.workspace?.dispose();
    this.#client.dispose();
  }
}
