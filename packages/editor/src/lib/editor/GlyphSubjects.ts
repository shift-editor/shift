import type { GlyphId } from "@shift/types";
import { computed, effect, track, untracked } from "../signals";
import type { Effect, Signal } from "../signals";
import type { GlyphNode } from "../../types/node";
import type { Editor } from "./Editor";

/**
 * The glyph nodes the sidebar and metric edits describe, and the selection
 * kept in step with the glyphs those nodes show.
 *
 * @remarks
 * A glyph node edits a slot of a run, so shaping can change the glyph it
 * shows. When it does, the points, segments, and anchors selected on the
 * glyph it showed no longer exist; they are deselected, and everything
 * selected on other glyphs stays selected.
 */
export class GlyphSubjects {
  /** See {@link Editor.subjectGlyphNodesCell}. */
  readonly nodesCell: Signal<readonly GlyphNode[]>;
  /** See {@link Editor.subjectGlyphIdsCell}. */
  readonly glyphIdsCell: Signal<readonly GlyphId[]>;
  /** The glyph each glyph node shows, in scene order. */
  readonly #shownCell: Signal<readonly (GlyphId | null)[]>;
  readonly #swaps: Effect;

  constructor(editor: Editor) {
    this.nodesCell = computed(
      () => {
        track(editor.scene.cell);
        const glyphNodes = editor.scene.nodesOfKind("glyph");
        const owners = new Set<GlyphNode>();
        for (const id of editor.selection.stateCell.value.ids) {
          const node = editor.object(id)?.node;
          if (node?.kind === "glyph") owners.add(node);
        }
        if (owners.size > 0) return [...owners];

        const edited = new Set(editor.editing.stateCell.value.nodeIds);
        const editedGlyphs = glyphNodes.filter((node) => edited.has(node.id));
        return editedGlyphs.length > 0 ? editedGlyphs : glyphNodes;
      },
      { name: "editor.subjectGlyphNodes", equals: sameItems },
    );
    this.glyphIdsCell = computed(
      () => this.nodesCell.value.flatMap((node) => editor.glyphIdOf(node) ?? []),
      { name: "editor.subjectGlyphIds", equals: sameItems },
    );
    this.#shownCell = computed(
      () => {
        track(editor.scene.cell);
        return editor.scene.nodesOfKind("glyph").map((node) => editor.glyphIdOf(node));
      },
      { name: "editor.shownGlyphIds", equals: sameItems },
    );
    this.#swaps = effect(
      () => {
        track(this.#shownCell);
        untracked(() => dropUnresolvedSelection(editor));
      },
      { name: "editor.glyphSwap" },
    );
  }

  dispose(): void {
    this.#swaps.dispose();
  }
}

/** Deselects what nothing shown has any more, such as the points of a glyph shaping swapped out. */
function dropUnresolvedSelection(editor: Editor): void {
  const ids = editor.selection.ids;
  const kept = ids.filter((id) => editor.object(id) !== null);
  if (kept.length !== ids.length) editor.selection.select(kept);
}

/** Whether two lists hold the same items in the same order. */
function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
