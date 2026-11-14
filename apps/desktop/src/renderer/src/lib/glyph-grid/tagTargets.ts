import type { GlyphId } from "@shift/types";
import type { FontSession } from "@/types/fontSession";

/** The route of the font overview, where the grid's selection is what a colour applies to. */
const OVERVIEW_PATH = "/home";

/**
 * The glyphs a colour command or the sidebar's swatches tag: on the font
 * overview the grid's selection, and elsewhere, or with nothing selected, the
 * one glyph the canvas shows. Empty when there is neither.
 *
 * @param selected - the glyphs selected in the overview's grid.
 * @param shown - the one glyph the canvas shows, or null.
 */
export function tagTargetsOf(
  pathname: string,
  selected: readonly GlyphId[],
  shown: GlyphId | null,
): readonly GlyphId[] {
  if (pathname === OVERVIEW_PATH && selected.length > 0) return selected;

  return shown === null ? [] : [shown];
}

/** {@link tagTargetsOf} for a window's session as it is now. */
export function tagTargets(session: FontSession, pathname: string): readonly GlyphId[] {
  return tagTargetsOf(
    pathname,
    session.tabs.gridSelectionCell.peek().ids,
    session.editor.scene.only("glyph")?.glyphId ?? null,
  );
}
