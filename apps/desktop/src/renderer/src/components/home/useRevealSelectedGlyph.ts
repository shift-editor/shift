import { useLayoutEffect } from "react";
import type { GlyphCatalogLayout } from "./glyphCatalogLayout";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";

interface RevealSelectedGlyphOptions {
  /** The catalog's scrolling element. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly layout: GlyphCatalogLayout;
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly selection: GlyphSelection;
  /** Whether a box is being dragged, which scrolls the catalog itself. */
  readonly dragging: boolean;
}

/**
 * Scrolls the glyph the selection last moved to into view, such as one just
 * created or reached with the arrow keys; one already visible stays put.
 */
export function useRevealSelectedGlyph({
  containerRef,
  layout,
  glyphs,
  selection,
  dragging,
}: RevealSelectedGlyphOptions): void {
  const focus = selection.focus;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || focus === null || dragging) return;

    const index = glyphs.findIndex((glyph) => glyph.id === focus);
    const scrollTop = layout.scrollTopToReveal(index, container.scrollTop);
    if (scrollTop !== null) container.scrollTop = scrollTop;
    // Only a change of selection reveals; scrolling away from the selection is the user's.
  }, [focus]);
}
