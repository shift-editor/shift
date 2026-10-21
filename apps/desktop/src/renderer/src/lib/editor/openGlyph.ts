import type { Editor } from "@shift/editor";
import type { GlyphNode, TextRunNode } from "@shift/editor/types";
import type { GlyphId } from "@shift/types";

/**
 * Opens a glyph on the canvas: the canvas run shows it, and its child glyph
 * node is entered for editing.
 *
 * @remarks
 * Until pages exist the canvas has one text run at the scene origin. The run
 * is created on the first open and otherwise reused, so a restored run keeps
 * its text: opening the glyph its child already edits only enters the child.
 * Opening another glyph replaces the run's text with that glyph. Writes scene
 * records; the caller decides whether that is a history entry. The glyph
 * must already be loaded.
 *
 * @param editor - Editor whose canvas shows the glyph.
 * @param glyphId - Loaded glyph to open.
 * @returns the entered child glyph node, or null when the glyph is not in the font or not loaded.
 */
export function openGlyph(editor: Editor, glyphId: GlyphId): GlyphNode | null {
  const runs = editor.nodeDefinition("textRun");
  const run =
    editor.scene.first("textRun") ??
    editor.scene.createNode<TextRunNode>({
      kind: "textRun",
      runId: editor.text.createRun([]).id,
      size: editor.font.metricsCell.peek().unitsPerEm,
      position: { x: 0, y: 0 },
    });

  const previous = runs.childGlyph(run);
  if (previous?.glyphId === glyphId) {
    editor.enterNode(previous.id);
    return previous;
  }

  const item = editor.text.glyphItem(glyphId);
  if (!item) return null;

  editor.text.setItems(run.runId, [item]);
  const child = runs.editItem(run, item.id);
  if (child) editor.enterNode(child.id);
  return child;
}
