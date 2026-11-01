import type { GlyphCatalogItem, GlyphCatalogControllerFrame } from "./glyphCatalog";

export type GlyphCatalogRendererKind = "slug" | "svg";

/** Owns the imperative resources of the selected Slug catalog backend. */
export interface GlyphCatalogRenderer {
  /** Applies the latest catalog frame and optional inline-name input host. */
  update(frame: GlyphCatalogControllerFrame, inputContainer: HTMLDivElement | null): void;

  /** Returns the glyph whose cell is under a viewport point, or null over empty space. */
  glyphAt(clientX: number, clientY: number): GlyphCatalogItem | null;

  /** Releases rendering resources and catalog event subscriptions. Idempotent. */
  destroy(): void;
}

/** Reports whether Slug claimed the session or React must render the SVG fallback. */
export type GlyphCatalogRendererSelection =
  | { readonly kind: "slug"; readonly renderer: GlyphCatalogRenderer }
  | { readonly kind: "svg" };
