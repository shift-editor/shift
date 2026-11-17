import type { Editor } from "@shift/editor";
import type { GlyphId } from "@shift/types";

/** The drag payload type a glyph tile carries: the glyph's id. */
export const GLYPH_DRAG_TYPE = "application/x-shift-glyph";

/**
 * Adds a glyph to the end of the text on the page the canvas shows, as one
 * undo step, starting a line of text when the page has none.
 *
 * @remarks
 * The glyph must be loaded.
 *
 * @returns false when the canvas shows no page or the glyph cannot be set as text.
 */
export function insertGlyphIntoText(editor: Editor, glyphId: GlyphId): boolean {
  const { text, scene, history } = editor;
  const item = text.glyphItem(glyphId);
  const page = scene.shownPageCell.peek();
  if (!item || !page) return false;

  const run = scene.first("textRun");
  if (!run) {
    // Adding a run is its own undo step.
    text.addRun({ page, at: { x: 0, y: 0 }, items: [item] });
    return true;
  }

  history.capture("Insert Glyph", () => text.setItems(run.runId, [...text.items(run), item]));
  return true;
}
