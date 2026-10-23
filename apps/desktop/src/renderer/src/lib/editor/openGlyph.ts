import type { Editor } from "@shift/editor";
import type { GlyphNode, TextRunNode } from "@shift/editor/types";
import type { GlyphId } from "@shift/types";

/**
 * Opens a glyph from the grid: the active page's run becomes that glyph, edited in place.
 *
 * @remarks
 * The interim policy until runs are placed by the user. Each page has at most
 * one run at its origin; the first open on a page creates it. Opening the
 * glyph the run already edits re-enters it. Writes scene and text records, so
 * call it inside `history.withoutRecording` when it is navigation.
 *
 * @param editor - editor whose active page receives the glyph.
 * @param glyphId - a loaded glyph.
 * @returns the edited glyph node, or null when the glyph is not loaded.
 */
export function openGlyphInRun(editor: Editor, glyphId: GlyphId): GlyphNode | null {
  const page = editor.pages.ensure();
  const runs = editor.nodeDefinition("textRun");
  const run =
    editor.scene.first("textRun") ??
    editor.scene.createNode<TextRunNode>({
      kind: "textRun",
      parentId: page.id,
      runId: editor.text.createRun([]).id,
      size: editor.font.metricsCell.peek().unitsPerEm,
      width: { kind: "hug" },
      height: { kind: "hug" },
      rotation: 0,
      verticalAlign: "top",
      // The box's top sits the ascender above the first baseline, which stays at the scene origin.
      position: { x: 0, y: -editor.font.metricsForSource(editor.font.defaultSource.id).ascender },
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
