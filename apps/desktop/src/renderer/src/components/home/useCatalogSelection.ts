import { useState } from "react";
import { glyphColorCommands, type CommandId } from "@shared/commands";
import type { Point2D, Rect2D } from "@shift/geo";
import type { GlyphId } from "@shift/types";
import type { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { useGlyphSelection, type GlyphSelectionHandlers } from "../glyph-grid/useGlyphSelection";
import { getShiftHost } from "@/host/shiftHost";
import type { GlyphSelection } from "@/lib/glyph-grid/GlyphSelection";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";

interface CatalogSelectionOptions {
  /** The catalog's scrolling element. */
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly layout: GlyphCatalogLayout;
  /** The glyphs shown, in catalog order. */
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly selection: GlyphSelection;
  readonly selectGlyphs: (selection: GlyphSelection) => void;
  /** Opens a glyph in a tab of its own, on Enter. */
  readonly openGlyph: (glyph: GlyphCatalogItem) => Promise<void>;
}

/** What selecting in the catalog needs from the surface that draws it. */
export interface CatalogSelection {
  /** Handlers for the catalog's scrolling element, which must be focusable. */
  readonly handlers: GlyphSelectionHandlers;
  /** The box being dragged to select glyphs, in the scrolled content; null when none is. */
  readonly box: Rect2D | null;
  /** The glyph whose preview is under a point in client pixels, or null. */
  glyphAt(clientX: number, clientY: number): GlyphCatalogItem | null;
}

/**
 * Selects glyphs in the font overview's grid, whichever renderer draws it:
 * a press on a glyph's preview selects it and a drag from there sweeps a
 * range, a drag from a gap boxes glyphs, Shift extends and ⌘ toggles, and the
 * arrow keys move by glyph and by row and Enter opens the glyph they reached.
 * A press on a glyph's name is left to renaming, and ⌘C copies the selected
 * glyphs' names separated by spaces.
 */
export function useCatalogSelection({
  containerRef,
  layout,
  glyphs,
  selection,
  selectGlyphs,
  openGlyph,
}: CatalogSelectionOptions): CatalogSelection {
  const [box, setBox] = useState<Rect2D | null>(null);
  /** A point in client pixels as a point in the catalog's scrolled content. */
  const contentPoint = (clientX: number, clientY: number): Point2D | null => {
    const container = containerRef.current;
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    return { x: clientX - bounds.left, y: clientY - bounds.top + container.scrollTop };
  };
  const glyphIdAt = (index: number | null): GlyphId | null =>
    index === null ? null : (glyphs[index]?.id ?? null);
  const glyphAt = (clientX: number, clientY: number): GlyphCatalogItem | null => {
    const point = contentPoint(clientX, clientY);
    const index = point ? layout.indexAt(point, "preview") : null;
    return index === null ? null : (glyphs[index] ?? null);
  };

  const handlers = useGlyphSelection({
    selection,
    onSelect: selectGlyphs,
    containerRef,
    columns: layout.columns,
    glyphAt: (clientX, clientY) => glyphAt(clientX, clientY)?.id ?? null,
    ignores: (clientX, clientY) => {
      const container = containerRef.current;
      const point = contentPoint(clientX, clientY);
      if (!container || !point) return true;
      // The scrollbar is the container's own; a name is renamed by its click.
      return point.x >= container.clientWidth || layout.indexAt(point, "name") !== null;
    },
    box: {
      glyphsIn: (dragged) =>
        layout
          .indicesIn(dragged)
          .map(glyphIdAt)
          .filter((glyphId) => glyphId !== null),
      onChange: setBox,
    },
    onCopy: () => void copyNames(glyphs.filter((glyph) => selection.has(glyph.id))),
  });

  const primary = glyphs.find((glyph) => glyph.id === selection.primary) ?? null;
  const onKeyDown = (event: React.KeyboardEvent): void => {
    // Control and a digit tags the selection; the editor's keyboard router is not mounted here.
    const plainControl = event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    const tag = plainControl ? glyphColorCommands.find(({ digit }) => digit === event.key) : null;
    if (tag) {
      event.preventDefault();
      void runCommand(tag.id);
      return;
    }
    if (event.key !== "Enter" || !primary) {
      handlers.onKeyDown(event);
      return;
    }
    event.preventDefault();
    void open(openGlyph, primary);
  };

  return { handlers: { ...handlers, onKeyDown }, box, glyphAt };
}

async function runCommand(id: CommandId): Promise<void> {
  try {
    await getShiftHost().commands.run(id);
  } catch (error) {
    console.error("glyph grid command failed", id, error);
  }
}

async function open(
  openGlyph: (glyph: GlyphCatalogItem) => Promise<void>,
  glyph: GlyphCatalogItem,
): Promise<void> {
  try {
    await openGlyph(glyph);
  } catch (error) {
    console.error("failed to open catalog Glyph", error);
  }
}

/** Copies glyph names to the clipboard, separated by spaces, in the order given. */
async function copyNames(glyphs: readonly GlyphCatalogItem[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(glyphs.map((glyph) => glyph.name).join(" "));
  } catch (error) {
    console.error("copying glyph names failed", error);
  }
}
