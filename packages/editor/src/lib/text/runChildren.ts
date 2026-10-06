import type { GlyphName, RunId, SourceId, TextItemId } from "@shift/types";
import type { Editor } from "../editor/Editor";
import type { GlyphNode, TextRunNode } from "../../types/node";

/**
 * Makes one of a run's items its child glyph, replacing any previous child.
 *
 * @remarks
 * Replaces rather than re-points the child (delete and create), so per-node
 * caches never see a node change glyph. Changes records only: the caller
 * enters the returned node and decides whether this is one history step.
 *
 * @param run - the run node holding the item.
 * @param itemId - a glyph item in the run.
 * @param sourceId - authored source the child glyph shows.
 * @returns null when the item is not a glyph in the run or its glyph is not loaded.
 */
export function editRunItem(
  editor: Editor,
  run: TextRunNode,
  itemId: TextItemId,
  sourceId: SourceId,
): GlyphNode | null {
  const item = editor.text.run(run.runId)?.items.find((candidate) => candidate.id === itemId);
  if (item?.kind !== "glyph") return null;

  const current = editor.nodeDefinition("textRun").childGlyph(run);
  if (current?.itemId === itemId) return current;

  const record = editor.font.recordForName(item.glyphName as GlyphName);
  if (!record || !editor.glyphForId(record.id)) return null;

  if (current) editor.scene.deleteNode(current.id);
  return editor.scene.createNode({
    kind: "glyph",
    parentId: run.id,
    itemId,
    glyphId: record.id,
    sourceId,
    position: { x: 0, y: 0 },
  });
}

/**
 * Deletes child glyph nodes whose item is no longer in their run.
 *
 * @remarks
 * Call after removing items from a run, inside the same history capture, so
 * undo restores an item and its child together.
 */
export function removeDetachedChildren(editor: Editor, runId: RunId): void {
  const kept = new Set(editor.text.run(runId)?.items.map((item) => item.id) ?? []);
  for (const node of editor.scene.nodesOfKind("textRun")) {
    if (node.runId !== runId) continue;
    for (const child of editor.scene.children(node.id)) {
      if (child.kind === "glyph" && child.itemId && !kept.has(child.itemId)) {
        editor.scene.deleteNode(child.id);
      }
    }
  }
}
