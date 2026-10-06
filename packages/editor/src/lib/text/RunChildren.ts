import type { GlyphName, RunId, SourceId, TextItemId } from "@shift/types";
import type { Editor } from "../editor/Editor";
import type { GlyphNode, TextRunNode } from "../../types/node";

/**
 * Keeps a text run's child glyph node in step with the run's items.
 *
 * @remarks
 * A run edits one of its glyphs in place through a child `GlyphNode` that
 * points at an item; the run's layout places it and the run stops drawing that
 * item. A run has at most one child: editing another item replaces it (delete
 * and create), so per-node caches never see a node change glyph. These methods
 * change records only; callers decide whether to enter the child and whether
 * a change is one history step.
 */
export class RunChildren {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /** Returns the run's child glyph node, or null when no item is edited in place. */
  glyph(run: TextRunNode): GlyphNode | null {
    for (const child of this.#editor.scene.children(run.id)) {
      if (child.kind === "glyph") return child;
    }
    return null;
  }

  /**
   * Makes one of the run's items its child glyph, replacing any previous child.
   *
   * @param run - the run node holding the item.
   * @param itemId - a glyph item in the run.
   * @param sourceId - authored source the child glyph shows.
   * @returns null when the item is not a glyph in the run or its glyph is not loaded.
   */
  editItem(run: TextRunNode, itemId: TextItemId, sourceId: SourceId): GlyphNode | null {
    const item = this.#editor.text
      .run(run.runId)
      ?.items.find((candidate) => candidate.id === itemId);
    if (item?.kind !== "glyph") return null;

    const current = this.glyph(run);
    if (current?.itemId === itemId) return current;

    const record = this.#editor.font.recordForName(item.glyphName as GlyphName);
    if (!record || !this.#editor.glyphForId(record.id)) return null;

    if (current) this.#editor.scene.deleteNode(current.id);
    return this.#editor.scene.createNode({
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
  removeDetached(runId: RunId): void {
    const kept = new Set(this.#editor.text.run(runId)?.items.map((item) => item.id) ?? []);
    for (const node of this.#editor.scene.nodesOfKind("textRun")) {
      if (node.runId !== runId) continue;
      for (const child of this.#editor.scene.children(node.id)) {
        if (child.kind === "glyph" && child.itemId && !kept.has(child.itemId)) {
          this.#editor.scene.deleteNode(child.id);
        }
      }
    }
  }
}
