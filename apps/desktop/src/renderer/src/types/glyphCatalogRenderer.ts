import type { GlyphCatalogControllerFrame } from "./glyphCatalog";

export type GlyphCatalogRendererKind = "slug" | "svg";

/** Owns one session-fixed glyph catalog rendering implementation. */
export interface GlyphCatalogRenderer {
  readonly kind: GlyphCatalogRendererKind;

  /** Applies the latest catalog frame and optional inline-name input host. */
  update(frame: GlyphCatalogControllerFrame, inputContainer: HTMLDivElement | null): void;

  /** Releases rendering resources and catalog event subscriptions. Idempotent. */
  destroy(): void;
}

/** Couples the selected session renderer with its stable implementation kind. */
export interface GlyphCatalogRendererSelection {
  readonly kind: GlyphCatalogRendererKind;
  readonly renderer: GlyphCatalogRenderer;
}
