import type { GlyphName, SourceId, TextItemId } from "@shift/types";
import type { Editor } from "../editor/Editor";
import type { GlyphNode, NodeTransaction, TextRunNode } from "../../types/node";

/**
 * Makes one of a run's items its child glyph, replacing any previous child.
 *
 * @remarks
 * Replaces rather than re-points the child (delete and create), so per-node
 * caches never see a node change glyph. Does not enter the child.
 *
 * @param tx - the edit this belongs to; see `Editor.editNodes`.
 * @param run - the run node holding the item.
 * @param itemId - a glyph item in the run.
 * @param sourceId - authored source the child glyph shows.
 * @returns null when the item is not a glyph in the run or its glyph is not loaded.
 */
export function editRunItem(
  editor: Editor,
  tx: NodeTransaction,
  run: TextRunNode,
  itemId: TextItemId,
  sourceId: SourceId,
): GlyphNode | null {
  const item = editor.text.run(run.runId)?.items.find((candidate) => candidate.id === itemId);
  if (item?.kind !== "glyph") return null;

  const current = editor.nodeDefinition("textRun").childGlyph(run);
  if (current?.itemId === itemId) return current;

  const entry = editor.font.entryForName(item.glyphName as GlyphName);
  if (!entry || !editor.glyphForId(entry.id)) return null;

  if (current) tx.deleteNode(current.id);
  return tx.createNode<GlyphNode>({
    kind: "glyph",
    parentId: run.id,
    itemId,
    glyphId: entry.id,
    sourceId,
    position: { x: 0, y: 0 },
  });
}
